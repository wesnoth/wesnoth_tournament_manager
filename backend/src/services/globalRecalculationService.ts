import { pool, query } from '../config/database.js';
import type { GlobalStatsRecalculationProgress, RecalculationResult } from './globalStatsRecalculationJobService.js';
import { activeRatingModel } from './rating/ratingModel.js';
import { replayRatings, type MatchRatingUpdate, type UserRatingResult } from './rating/ratingReplay.js';
import { recalculateFactionMapStatistics, recalculatePlayerMatchStatistics } from './statisticsCalculator.js';
import type { MatchRatingRow, UserRatingRow } from '../types/dbRows.js';

type ProgressCallback = (progress: GlobalStatsRecalculationProgress) => Promise<void>;

/** Progress is reported every this many rows, plus at the end of a phase. */
const PROGRESS_STEP = 500;

/** Column values in UPDATE order, so the same list serves comparison and writing. */
function matchValues(update: MatchRatingUpdate): Array<number | string> {
  return [
    update.winnerRatingBefore, update.winnerRatingAfter,
    update.loserRatingBefore, update.loserRatingAfter,
    update.winnerLevelBefore, update.winnerLevelAfter,
    update.loserLevelBefore, update.loserLevelAfter,
    update.winnerRankingPos, update.winnerRankingChange,
    update.loserRankingPos, update.loserRankingChange,
    update.ratingChange,
  ];
}

function storedMatchValues(row: MatchRatingRow): unknown[] {
  return [
    row.winner_elo_before, row.winner_elo_after,
    row.loser_elo_before, row.loser_elo_after,
    row.winner_level_before, row.winner_level_after,
    row.loser_level_before, row.loser_level_after,
    row.winner_ranking_pos, row.winner_ranking_change,
    row.loser_ranking_pos, row.loser_ranking_change,
    row.elo_change,
  ];
}

function userValues(user: UserRatingResult): Array<number | string | Date | null> {
  return [
    user.rating, user.matchesPlayed, user.totalWins, user.totalLosses,
    user.trend, user.level, user.isRated ? 1 : 0, user.isActive ? 1 : 0, user.lastMatchDate,
  ];
}

function storedUserValues(row: UserRatingRow): unknown[] {
  return [
    row.elo_rating, row.matches_played, row.total_wins, row.total_losses,
    row.trend, row.level,
    row.is_rated,
    row.is_active,
    row.last_match_date,
  ];
}

/**
 * Compare a computed value with the stored one. Numbers may come back from
 * the driver as strings for some column types, booleans as 0/1, and dates as
 * Date objects, so values are normalized before comparing.
 */
function sameValue(computed: unknown, stored: unknown): boolean {
  if (computed instanceof Date || stored instanceof Date) {
    if (!(computed instanceof Date) || !(stored instanceof Date)) return false;
    return computed.getTime() === stored.getTime();
  }
  if (computed === null || stored === null || computed === undefined || stored === undefined) {
    return (computed ?? null) === (stored ?? null);
  }
  if (typeof computed === 'number') return computed === Number(stored);
  return String(computed) === String(stored);
}

function sameValues(computed: unknown[], stored: unknown[]): boolean {
  return computed.every((value, index) => sameValue(value, stored[index]));
}

/**
 * Full global recalculation: replay every non-cancelled match through the
 * active rating model and rewrite ratings, levels, ranking positions, and
 * player totals, then rebuild the derived statistics (audit finding 10).
 *
 * The replay always covers the whole history (full-replay principle); only
 * the writes are limited to rows whose stored values differ from the replay,
 * so a correction that changes a few recent games writes a few rows. All
 * rating writes go in one transaction: a failure leaves the previous
 * consistent history in place instead of a half-rewritten one.
 *
 * Replay processing and the routes that create or confirm matches are paused
 * while a recalculation job is active (`systemPauseService`), so no match is
 * created between the read and the commit.
 *
 * The derived statistics (player aggregates, faction/map balance) are rebuilt
 * afterwards, outside the transaction, by their own services. A failure there
 * is reported as `success: false`; the ratings are already committed.
 */
export async function performGlobalStatsRecalculation(onProgress?: ProgressCallback): Promise<RecalculationResult> {
  const logs: string[] = [];
  const log = (message: string, isError = false) => {
    logs.push(message);
    if (isError) console.error(message);
    else console.log(message);
  };
  const report = async (phase: string, current: number, total: number) => {
    if (onProgress) await onProgress({ phase, current, total });
  };

  let matchesProcessed = 0;
  let matchesUpdated = 0;
  let usersUpdated = 0;
  try {
    const [usersResult, matchesResult] = await Promise.all([
      query<UserRatingRow>(
        `SELECT id, is_blocked, elo_rating, matches_played, total_wins, total_losses,
                trend, level, is_rated, is_active, last_match_date
         FROM users_extension`
      ),
      query<MatchRatingRow>(
        `SELECT id, winner_id, loser_id, created_at,
                winner_elo_before, winner_elo_after, loser_elo_before, loser_elo_after,
                winner_level_before, winner_level_after, loser_level_before, loser_level_after,
                winner_ranking_pos, winner_ranking_change, loser_ranking_pos, loser_ranking_change,
                elo_change
         FROM matches
         WHERE status != 'cancelled'
         ORDER BY created_at ASC, id ASC`
      ),
    ]);
    const storedUsers = usersResult.rows;
    const storedMatches = matchesResult.rows;
    await report('replaying_matches', 0, storedMatches.length);

    const replay = replayRatings(
      activeRatingModel,
      storedUsers.map((row) => ({ id: row.id, isBlocked: Boolean(row.is_blocked) })),
      storedMatches.map((row) => ({
        id: row.id,
        winnerId: row.winner_id,
        loserId: row.loser_id,
        playedAt: new Date(row.created_at),
      })),
      new Date()
    );
    matchesProcessed = replay.matches.length;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // replay.matches follows storedMatches one to one.
      for (let index = 0; index < replay.matches.length; index += 1) {
        const values = matchValues(replay.matches[index]);
        if (!sameValues(values, storedMatchValues(storedMatches[index]))) {
          await connection.execute(
            `UPDATE matches
             SET winner_elo_before = ?, winner_elo_after = ?,
                 loser_elo_before = ?, loser_elo_after = ?,
                 winner_level_before = ?, winner_level_after = ?,
                 loser_level_before = ?, loser_level_after = ?,
                 winner_ranking_pos = ?, winner_ranking_change = ?,
                 loser_ranking_pos = ?, loser_ranking_change = ?,
                 elo_change = ?
             WHERE id = ?`,
            [...values, storedMatches[index].id]
          );
          matchesUpdated += 1;
        }
        const done = index + 1;
        if (done === replay.matches.length || done % PROGRESS_STEP === 0) {
          await report('replaying_matches', done, replay.matches.length);
        }
      }

      // A user found only in matches (no users_extension row) has nothing to
      // update, so it is skipped.
      const storedById = new Map(storedUsers.map((row) => [row.id, row]));
      await report('updating_users', 0, replay.users.length);
      for (let index = 0; index < replay.users.length; index += 1) {
        const user = replay.users[index];
        const stored = storedById.get(user.userId);
        const values = userValues(user);
        if (stored && !sameValues(values, storedUserValues(stored))) {
          await connection.execute(
            `UPDATE users_extension
             SET elo_rating = ?, matches_played = ?, total_wins = ?, total_losses = ?,
                 trend = ?, level = ?, is_rated = ?, is_active = ?, last_match_date = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [...values, user.userId]
          );
          usersUpdated += 1;
        }
        const done = index + 1;
        if (done === replay.users.length || done % PROGRESS_STEP === 0) {
          await report('updating_users', done, replay.users.length);
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    log(`✅ Replayed ${matchesProcessed} matches with ${activeRatingModel.id}: ` +
      `${matchesUpdated} match rows and ${usersUpdated} users changed`);
  } catch (error) {
    log(`✗ Rating replay failed, nothing was written: ${error instanceof Error ? error.message : String(error)}`, true);
    return { success: false, logs, matchesProcessed: 0, matchesUpdated: 0, usersUpdated: 0 };
  }

  let derivedStatisticsFailed = false;
  try {
    const playerResult = await recalculatePlayerMatchStatistics(async (current, total) => {
      await report('recalculating_player_statistics', current, total);
    });
    log(`✓ Recalculated ${playerResult.records_updated} player match statistics`);
  } catch (error) {
    derivedStatisticsFailed = true;
    log(`✗ Error recalculating player match statistics: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
  }

  try {
    const factionResult = await recalculateFactionMapStatistics(async (current, total) => {
      await report('recalculating_faction_statistics', current, total);
    });
    log(`✓ Recalculated ${factionResult.records_updated} faction/map statistics`);
  } catch (error) {
    derivedStatisticsFailed = true;
    log(`✗ Error recalculating faction/map statistics: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
  }

  return { success: !derivedStatisticsFailed, logs, matchesProcessed, matchesUpdated, usersUpdated };
}

/**
 * Executor for queued global recalculations: replay every match, then refresh
 * the player of the month from the rewritten statistics.
 *
 * The player-of-month step is optional (maintainer decision, 2026-10-04): the
 * main replay has already rewritten ELO and statistics correctly, so its
 * failure must not turn the job into `failed`. It is reported instead as the
 * `player_of_month_failed` warning, which the job service persists in
 * `result_json` and in the outcome audit event. Recovery is the admin
 * "recalculate player of the month" action or the monthly cron. The step is
 * skipped when the main replay failed, because it would read inconsistent data.
 */
export async function performQueuedGlobalStatsRecalculation(onProgress: ProgressCallback): Promise<RecalculationResult> {
  const recalcResult = await performGlobalStatsRecalculation(onProgress);
  if (!recalcResult.success) return recalcResult;

  try {
    await onProgress({ phase: 'calculating_player_of_month', current: 0, total: 1 });
    const { calculatePlayerOfMonth } = await import('../jobs/playerOfMonthJob.js');
    await calculatePlayerOfMonth();
    await onProgress({ phase: 'calculating_player_of_month', current: 1, total: 1 });
    return recalcResult;
  } catch (error) {
    console.error('⚠️  Warning: Failed to recalculate player of month after global recalculation:', error);
    return { ...recalcResult, warnings: [...(recalcResult.warnings ?? []), 'player_of_month_failed'] };
  }
}
