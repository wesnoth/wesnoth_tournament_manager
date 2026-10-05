/**
 * Integrate one replay result in a single transaction (audit findings 3–4).
 *
 * Every replay result, whether integrated automatically by the parse job
 * (confidence 2) or confirmed by a participant (confidence 1), goes through
 * integrateReplayResult. It writes, atomically:
 *   - the global match and both players' ELO (ranked and tournament ranked),
 *   - the tournament game result and its series/standings progression,
 *   - the replay row as `completed` with its match link.
 * Either everything is stored or nothing is: a failure after the ELO update
 * rolls the match back too, so a failed replay never keeps a match_id and the
 * admin Reprocess action stays available for it.
 *
 * Lock order is fixed: replay -> tournament -> tournament game -> users
 * (ascending id). The replay lock makes concurrent confirmations of one
 * replay serialize; the second one re-reads the state and is refused with
 * ReplayAlreadyIntegratedError (HTTP 409). This reduces deadlock risk but
 * cannot rule it out, because tournament progression also locks series and
 * standings, so deadlocks and lock-wait timeouts are retried.
 *
 * Post-commit tournament work (notifications, next phase, completion) runs
 * after the commit and never changes the replay: the result is already
 * durable. Its failures are audited as TOURNAMENT_PROGRESSION_FAILED so an
 * organizer or admin can recover with the advance action.
 */
import type { PoolConnection } from 'mysql2/promise';
import { pool, query } from '../config/database.js';
import { logAuditEvent } from '../middleware/audit.js';
import { createMatchInTransaction, type CreateMatchInput } from './matchCreationService.js';
import {
  recordPhaseGameResultInTransaction,
  runPhaseGameResultFollowUp,
  type PhaseGameConfirmation,
  type PhaseGameResultMetadata,
  type PhaseGameResultOutcome,
} from '../tournament-engine/competitionProgression.js';

/** The replay was integrated concurrently or is no longer in the expected state. */
export class ReplayAlreadyIntegratedError extends Error {
  constructor(message = 'This replay result has already been confirmed') {
    super(message);
    this.name = 'ReplayAlreadyIntegratedError';
  }
}

/**
 * Deterministic data problem (game not pending, winner not in the game,
 * missing user). Retrying cannot fix it; the job marks the replay `error`
 * and an admin can reprocess it once the cause is fixed.
 */
export class ReplayResultDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayResultDataError';
  }
}

export interface ReplayResultInput {
  replayId: string;
  /** The state the caller saw: `new` for the parse job, `parsed` for a manual confirmation. */
  expectedStatus: 'new' | 'parsed';
  /** Global match and ELO; omitted for tournament unranked and team games. */
  match?: CreateMatchInput | null;
  tournament?: {
    tournamentId: string;
    gameId: string;
    winnerEntryId: string;
    metadata?: PhaseGameResultMetadata | null;
    /** A participant's confirmation (comments/rating) for the manual path. */
    confirmation?: PhaseGameConfirmation | null;
    /**
     * Automatic integration records the result but must not impersonate the
     * winner's report, so the job leaves the game `unconfirmed`.
     */
    markUnconfirmed?: boolean;
  } | null;
  /** Extra replay columns the parse job stores on completion. */
  completion?: {
    integrationConfidence?: number;
    tournamentLinkMethod?: string | null;
    parseSummary?: string | null;
  };
}

export interface ReplayResultOutcome {
  matchId: string | null;
  /** False when the post-commit tournament follow-up failed (audited). */
  followUpCompleted: boolean;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300];

/** Deadlock (1213) and lock-wait timeout (1205) are safe to retry after rollback. */
function isTransientLockError(error: any): boolean {
  return error?.errno === 1213 || error?.errno === 1205
    || error?.code === 'ER_LOCK_DEADLOCK' || error?.code === 'ER_LOCK_WAIT_TIMEOUT';
}

/** Errors thrown by the tournament writer that mean "someone else got there first". */
function isAlreadyRecordedError(error: any): boolean {
  return /already recorded/i.test(String(error?.message || ''));
}

/** Errors thrown by the writers that describe bad or stale data, not a transient failure. */
function isDataError(error: any): boolean {
  return /not found|not part of this game|Could not fetch winner\/loser/i.test(String(error?.message || ''));
}

async function runIntegration(connection: PoolConnection, input: ReplayResultInput): Promise<{
  matchId: string | null;
  tournamentOutcome: PhaseGameResultOutcome | null;
}> {
  // 1. Replay first: concurrent integrations of one replay serialize here.
  const [replayRows] = await connection.execute<any[]>(
    `SELECT parse_status, match_id FROM replays WHERE id = ? FOR UPDATE`,
    [input.replayId]
  );
  const replay = replayRows[0];
  if (!replay) throw new ReplayResultDataError('Replay not found');
  if (replay.parse_status !== input.expectedStatus || replay.match_id) {
    throw new ReplayAlreadyIntegratedError();
  }

  // 2. Tournament and game before users, and verify the game is still open
  //    before the ELO is touched.
  if (input.tournament) {
    await connection.execute(`SELECT id FROM tournaments WHERE id = ? FOR UPDATE`, [input.tournament.tournamentId]);
    const [gameRows] = await connection.execute<any[]>(
      `SELECT status FROM tournament_games WHERE id = ? FOR UPDATE`,
      [input.tournament.gameId]
    );
    if (!gameRows[0]) throw new ReplayResultDataError('Tournament game not found');
    if (gameRows[0].status !== 'pending') throw new ReplayAlreadyIntegratedError('Tournament game is no longer pending');
  }

  // 3. Match and ELO (locks both users in ascending id order).
  const matchId = input.match ? await createMatchInTransaction(connection, input.match) : null;

  // 4. Tournament result on the same connection (its locks are already held).
  let tournamentOutcome: PhaseGameResultOutcome | null = null;
  if (input.tournament) {
    const t = input.tournament;
    tournamentOutcome = await recordPhaseGameResultInTransaction(
      connection, t.tournamentId, t.gameId, t.winnerEntryId, matchId, undefined, t.metadata ?? null, t.confirmation ?? null
    );
    if (t.markUnconfirmed) {
      await connection.execute(`UPDATE tournament_games SET confirmation_status = 'unconfirmed' WHERE id = ?`, [t.gameId]);
    }
  }

  // 5. The replay is completed in the same transaction as its effects.
  const c = input.completion || {};
  await connection.execute(
    `UPDATE replays
     SET parse_status = 'completed', parsed = 1, need_integration = 0, match_id = ?,
         integration_confidence = COALESCE(?, integration_confidence),
         tournament_id = COALESCE(?, tournament_id),
         tournament_game_id = COALESCE(?, tournament_game_id),
         tournament_link_method = COALESCE(?, tournament_link_method),
         tournament_linked_at = CASE WHEN ? IS NULL THEN tournament_linked_at ELSE CURRENT_TIMESTAMP END,
         parse_summary = COALESCE(?, parse_summary),
         parse_error_message = NULL, updated_at = NOW()
     WHERE id = ?`,
    [
      matchId,
      c.integrationConfidence ?? null,
      input.tournament?.tournamentId ?? null,
      input.tournament?.gameId ?? null,
      c.tournamentLinkMethod ?? null,
      input.tournament?.gameId ?? null,
      c.parseSummary ?? null,
      input.replayId,
    ]
  );
  return { matchId, tournamentOutcome };
}

/**
 * Re-read a replay on a fresh connection after a commit whose outcome is
 * unknown (for example a lost connection while committing). A `completed`
 * replay means the commit landed.
 */
async function readReplayAfterUncertainCommit(replayId: string): Promise<{ completed: boolean; matchId: string | null }> {
  const result = await query(`SELECT parse_status, match_id FROM replays WHERE id = ?`, [replayId]);
  const row = result.rows[0];
  return { completed: row?.parse_status === 'completed', matchId: row?.match_id ?? null };
}

/**
 * Integrate one replay result atomically; see the module comment.
 *
 * @throws ReplayAlreadyIntegratedError when the replay or its tournament game
 *   was integrated concurrently (map to HTTP 409).
 * @throws ReplayResultDataError for deterministic data problems.
 * @throws the last database error when transient failures persist.
 */
export async function integrateReplayResult(input: ReplayResultInput): Promise<ReplayResultOutcome> {
  let committed: { matchId: string | null; tournamentOutcome: PhaseGameResultOutcome | null } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !committed; attempt += 1) {
    const connection = await pool.getConnection();
    let commitStarted = false;
    try {
      await connection.beginTransaction();
      const result = await runIntegration(connection, input);
      commitStarted = true;
      await connection.commit();
      committed = result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if (commitStarted) {
        // The commit may have landed even though it reported an error.
        const state = await readReplayAfterUncertainCommit(input.replayId);
        if (state.completed) {
          console.warn(`[REPLAY RESULT] Commit outcome for replay ${input.replayId} was uncertain; it is completed`);
          return { matchId: state.matchId, followUpCompleted: false };
        }
      }
      if (error instanceof ReplayAlreadyIntegratedError || error instanceof ReplayResultDataError) throw error;
      if (isAlreadyRecordedError(error)) throw new ReplayAlreadyIntegratedError();
      if (isDataError(error)) throw new ReplayResultDataError((error as Error).message);
      if (!isTransientLockError(error) || attempt === MAX_ATTEMPTS) throw error;
      console.warn(`[REPLAY RESULT] Transient lock error for replay ${input.replayId} (attempt ${attempt}); retrying`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1] ?? 300));
    } finally {
      connection.release();
    }
  }

  let followUpCompleted = true;
  if (committed?.tournamentOutcome && input.tournament) {
    try {
      await runPhaseGameResultFollowUp(input.tournament.tournamentId, committed.tournamentOutcome);
    } catch (error) {
      followUpCompleted = false;
      console.error(`[REPLAY RESULT] Tournament follow-up failed for replay ${input.replayId}:`, error);
      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        username: 'Background job',
        ip_address: 'localhost',
        details: {
          action: 'TOURNAMENT_PROGRESSION_FAILED',
          tournament_id: input.tournament.tournamentId,
          tournament_game_id: input.tournament.gameId,
          replay_id: input.replayId,
          completed_phase_id: committed.tournamentOutcome.completedPhaseId,
          // The organizer's advance action reruns next-phase compilation and
          // tournament completion; the recorded result itself is final.
          recovery: 'advance',
        },
      });
    }
  }
  return { matchId: committed?.matchId ?? null, followUpCompleted };
}
