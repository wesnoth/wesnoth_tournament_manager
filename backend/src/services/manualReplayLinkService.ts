/**
 * Manual replay link: attach a misconfigured game to a pending tournament game
 * from its replays.wesnoth.org URL (issue #5).
 *
 * Automatic tournament detection fails when a game was hosted with a wrong
 * game name, with the tournament flag off, or (unranked/team tournaments)
 * without the Ranked add-on. This service lets the tournament organizer or a
 * player of the game point at the replay instead, either by pasting its URL
 * or by choosing it from the recent server games of the players (issue #6).
 *
 * Trust model:
 * - The user's URL is never downloaded. Only identifiers are parsed from it
 *   (base version, UTC end date, replay file name, game id) and the game is
 *   looked up in the forum's `wesnothd_game_info`. The replay file is later
 *   fetched by the parse job from the URL the server builds from that row, so
 *   a tampered file cannot be submitted.
 * - The forum players of that game must be exactly the players (1v1) or
 *   members of the two teams (team tournaments) of the pending tournament game.
 * - There is no time-window check: round dates are informational. Reuse is
 *   prevented by the replays uniqueness (`instance_uuid`, `game_id`) and by
 *   refusing replays that are already linked to a tournament game.
 *
 * Outcomes:
 * - `queued`: the replay row is (re)set to `new` with explicit tournament
 *   overrides. The normal parse job then validates ranked assets, determines
 *   confidence, and either integrates the result (confidence 2) or leaves it
 *   for the usual confidence-one confirmation flow.
 * - `associated`: the game was already counted as a normal ranked match (a
 *   ranked tournament hosted with the flag off or a wrong name). The existing
 *   match is attached to the tournament and the tournament game is recorded
 *   with that match id. ELO does not depend on the tournament fields, so no
 *   rating recalculation is needed.
 */
import { v4 as uuidv4 } from 'uuid';
import { pool, query } from '../config/database.js';
import { getGamePlayers, getCompetitiveGameData, hasGameTournamentAddon, queryForum } from '../config/forumDatabase.js';
import { getBaseVersion } from '../utils/versionParser.js';
import { DomainError } from '../utils/clientError.js';
import { parseReplayServerUrl, REPLAY_HOST, type ReplayServerUrlParts } from '../utils/replayServerUrl.js';
import { matchesTournamentGamePlayers, type ExpectedReplayPlayer } from '../utils/replayCandidateMatch.js';
import { queryPhpbb } from '../config/phpbbDatabase.js';
import { isTournamentOrganizer } from './tournamentAuthorizationService.js';
import {
  recordPhaseGameResultInTransaction,
  runPhaseGameResultFollowUp,
} from '../tournament-engine/competitionProgression.js';

/** Replay statuses that may be re-queued, the same set the admin Reprocess action accepts. */
const REQUEUEABLE_STATUSES = ['error', 'failed', 'rejected', 'parsed', 'skipped', 'discarded'];

/** Error raised for a request that is not allowed for this user (HTTP 403). */
export class ManualReplayLinkForbiddenError extends DomainError {}
/** Error raised when the referenced game or replay does not exist (HTTP 404). */
export class ManualReplayLinkNotFoundError extends DomainError {}
/** Error raised when the current state forbids the link (HTTP 409). */
export class ManualReplayLinkConflictError extends DomainError {}

/** `YYYY-MM-DD HH:MM:SS` in UTC, shifted by whole days, for the forum END_TIME bounds. */
function utcDayBound(endDate: string, dayOffset: number): string {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** `YYYY/MM/DD` of a date in UTC, the replay server's directory layout. */
function utcPathDate(value: Date): string {
  return `${value.getUTCFullYear()}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${String(value.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Find the single forum game the URL identifies.
 *
 * The URL has no INSTANCE_UUID, so the game is matched on GAME_ID, the exact
 * REPLAY_NAME, the base version and END_TIME within one day of the URL date
 * (the URL day is UTC while END_TIME may be stored in another zone). Game ids
 * restart when wesnothd restarts, so more than one row is possible; that case
 * is ambiguous and refused rather than guessed.
 */
async function findForumGame(parts: ReplayServerUrlParts): Promise<any> {
  const rows = await queryForum(
    `SELECT INSTANCE_UUID, GAME_ID, INSTANCE_VERSION AS wesnoth_version, GAME_NAME AS game_name,
            START_TIME AS start_time, END_TIME AS end_time, REPLAY_NAME AS replay_filename,
            OOS AS oos, RELOAD AS is_reload
     FROM wesnothd_game_info
     WHERE GAME_ID = ? AND REPLAY_NAME = ?
       AND END_TIME >= ? AND END_TIME < ?
       AND (INSTANCE_VERSION = ? OR INSTANCE_VERSION LIKE ? OR INSTANCE_VERSION LIKE ?)
     LIMIT 2`,
    [
      parts.gameId, parts.replayName,
      utcDayBound(parts.endDate, -1), utcDayBound(parts.endDate, 2),
      parts.baseVersion, `${parts.baseVersion}.%`, `${parts.baseVersion}-%`,
    ]
  );
  if (rows.length === 0) throw new ManualReplayLinkNotFoundError('No game on the Wesnoth server matches this replay URL');
  if (rows.length > 1) throw new ManualReplayLinkConflictError('Several server games match this replay URL; ask an administrator');
  return rows[0];
}

/** mysql2 returns BIT(1) columns as a Buffer. */
function bitValue(value: unknown): number {
  if (Buffer.isBuffer(value)) return value[0] ? 1 : 0;
  return value ? 1 : 0;
}

/** Pending tournament game with its two entries, scoped to an in-progress tournament and round. */
async function loadPendingGame(tournamentId: string, tournamentGameId: string): Promise<any> {
  const result = await query(
    `SELECT games.id, games.status, games.entry1_id, games.entry2_id,
            entry1.participant_id AS participant1_id, entry2.participant_id AS participant2_id,
            entry1.team_id AS team1_id, entry2.team_id AS team2_id,
            participant1.user_id AS user1_id, participant2.user_id AS user2_id,
            rounds.status AS round_status,
            tournament.name AS tournament_name, tournament.status AS tournament_status,
            tournament.tournament_mode
     FROM tournament_games games
     JOIN tournament_series series ON series.id = games.series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     JOIN tournaments tournament ON tournament.id = phases.tournament_id
     JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
     JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
     LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
     LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
     WHERE games.id = ? AND phases.tournament_id = ?
     LIMIT 1`,
    [tournamentGameId, tournamentId]
  );
  const game = result.rows?.[0];
  if (!game) throw new ManualReplayLinkNotFoundError('Tournament game not found');
  if (game.tournament_status !== 'in_progress') throw new ManualReplayLinkConflictError('The tournament is not in progress');
  // A ready phase must be started first: its games exist but are not playable yet.
  if (game.round_status !== 'in_progress') throw new ManualReplayLinkConflictError('The round of this game has not started');
  if (game.status !== 'pending') throw new ManualReplayLinkConflictError('This tournament game already has a result');
  return game;
}

/**
 * Whether the user may link a replay to this game: an organizer of the
 * tournament, or an accepted participant of one of its two entries (directly
 * for 1v1, through the team for team tournaments).
 */
async function canLinkGame(tournamentId: string, game: any, userId: string): Promise<boolean> {
  if (await isTournamentOrganizer(tournamentId, userId)) return true;
  const result = await query(
    `SELECT 1 FROM tournament_participants
     WHERE tournament_id = ? AND user_id = ? AND participation_status = 'accepted'
       AND (id IN (?, ?) OR team_id IN (?, ?))
     LIMIT 1`,
    [tournamentId, userId, game.participant1_id, game.participant2_id, game.team1_id, game.team2_id]
  );
  return Boolean(result.rows?.length);
}

/**
 * Check that the forum players are exactly the players of the tournament game.
 *
 * 1v1: two forum players whose accounts are the two entry users.
 * Team: every forum player is an accepted, active member of one of the two
 * entry teams, and both teams are represented. Team rosters may be larger
 * than the number of sides, so not every member must have played.
 *
 * @returns the user id of each forum player, keyed by lower-case nickname.
 */
async function assertSamePlayers(tournamentId: string, game: any, forumPlayers: any[]): Promise<Map<string, string>> {
  const nicknames = forumPlayers.map(player => String(player.username || '')).filter(Boolean);
  if (nicknames.length < 2 || nicknames.length !== forumPlayers.length) {
    throw new ManualReplayLinkConflictError('The server game does not have two identified players');
  }
  if (new Set(nicknames.map(name => name.toLowerCase())).size !== nicknames.length) {
    throw new ManualReplayLinkConflictError('The same player appears more than once in the server game');
  }
  const users = await query(
    `SELECT id, nickname FROM users_extension
     WHERE LOWER(nickname) IN (${nicknames.map(() => 'LOWER(?)').join(', ')})`,
    nicknames
  );
  const userIdByNickname = new Map<string, string>(
    (users.rows || []).map((row: any) => [String(row.nickname).toLowerCase(), row.id])
  );
  if (userIdByNickname.size !== nicknames.length) {
    throw new ManualReplayLinkConflictError('Some players of the server game have no account on this site');
  }

  const isTeamGame = Boolean(game.team1_id || game.team2_id) || game.tournament_mode === 'team';
  if (!isTeamGame) {
    const expected = [game.user1_id, game.user2_id].filter(Boolean).sort();
    const actual = Array.from(userIdByNickname.values()).sort();
    if (expected.length !== 2 || actual.length !== 2 || expected[0] !== actual[0] || expected[1] !== actual[1]) {
      throw new ManualReplayLinkConflictError('The players of the server game are not the players of this tournament game');
    }
    return userIdByNickname;
  }

  const userIds = Array.from(userIdByNickname.values());
  const members = await query(
    `SELECT user_id, team_id FROM tournament_participants
     WHERE tournament_id = ? AND user_id IN (${userIds.map(() => '?').join(', ')})
       AND status = 'active' AND participation_status = 'accepted' AND team_id IN (?, ?)`,
    [tournamentId, ...userIds, game.team1_id, game.team2_id]
  );
  const teamByUser = new Map<string, string>((members.rows || []).map((row: any) => [row.user_id, row.team_id]));
  const teamsSeen = new Set(teamByUser.values());
  if (teamByUser.size !== userIds.length || !teamsSeen.has(game.team1_id) || !teamsSeen.has(game.team2_id)) {
    throw new ManualReplayLinkConflictError('The players of the server game are not the members of these two teams');
  }
  return userIdByNickname;
}

export interface ManualReplayLinkInput {
  tournamentId: string;
  tournamentGameId: string;
  replayUrl: unknown;
  userId: string;
}

export interface ManualReplayLinkResult {
  /** `queued` for the parse job, or `associated` to an existing ranked match. */
  status: 'queued' | 'associated';
  replayId: string;
  /** Forum game name, shown only as information (it may be the very error). */
  gameName: string | null;
  matchId?: string;
}

/**
 * Link a replay-server game to a pending tournament game.
 *
 * Validates permissions, the URL, the forum game, and its players, then either
 * queues the replay for the parse job with explicit tournament overrides or
 * attaches an already counted ranked match. See the module comment.
 */
export async function linkReplayByUrl(input: ManualReplayLinkInput): Promise<ManualReplayLinkResult> {
  const game = await loadAuthorizedPendingGame(input);
  const parts = parseReplayServerUrl(input.replayUrl);
  const forumGame = await findForumGame(parts);
  return linkForumGame(input, game, forumGame);
}

/** Pending tournament game the user may link a replay to, or a 403/404/409 error. */
async function loadAuthorizedPendingGame(input: { tournamentId: string; tournamentGameId: string; userId: string }): Promise<any> {
  const game = await loadPendingGame(input.tournamentId, input.tournamentGameId);
  if (!(await canLinkGame(input.tournamentId, game, input.userId))) {
    throw new ManualReplayLinkForbiddenError('Only the tournament organizers and the players of this game can link its replay');
  }
  return game;
}

/** Columns of `wesnothd_game_info` read for a link, aliased as the link path expects. */
const FORUM_GAME_COLUMNS = `g.INSTANCE_UUID, g.GAME_ID, g.INSTANCE_VERSION AS wesnoth_version, g.GAME_NAME AS game_name,
            g.START_TIME AS start_time, g.END_TIME AS end_time, g.REPLAY_NAME AS replay_filename,
            g.OOS AS oos, g.RELOAD AS is_reload`;

export interface ServerGameLinkInput {
  tournamentId: string;
  tournamentGameId: string;
  instanceUuid: unknown;
  gameId: unknown;
  userId: string;
}

/**
 * Link a server game chosen in the replay picker (issue #6) to a pending
 * tournament game.
 *
 * The client only sends the server identifiers of the chosen candidate. The
 * candidate list is never trusted: the game is read again from the forum and
 * goes through exactly the same validations and outcomes as a pasted URL.
 */
export async function linkReplayByServerGame(input: ServerGameLinkInput): Promise<ManualReplayLinkResult> {
  const instanceUuid = typeof input.instanceUuid === 'string' ? input.instanceUuid.trim() : '';
  const gameId = Number(input.gameId);
  if (!/^[0-9a-fA-F-]{36}$/.test(instanceUuid) || !Number.isInteger(gameId) || gameId < 0) {
    throw new DomainError('instance_uuid and game_id identify the server game');
  }
  const game = await loadAuthorizedPendingGame(input);
  const rows = await queryForum(
    `SELECT ${FORUM_GAME_COLUMNS} FROM wesnothd_game_info g
     WHERE g.INSTANCE_UUID = ? AND g.GAME_ID = ? LIMIT 1`,
    [instanceUuid, gameId]
  );
  const forumGame = rows[0];
  if (!forumGame) throw new ManualReplayLinkNotFoundError('The server game was not found');
  // A game without an end time or replay file is still running or was never saved.
  if (!forumGame.end_time || !forumGame.replay_filename) {
    throw new ManualReplayLinkConflictError('The server game has not finished or has no replay');
  }
  return linkForumGame(input, game, forumGame);
}

/**
 * Validate a located forum game against the pending tournament game and link
 * it. Shared by the URL and the picker paths, so both enforce the same rules.
 */
async function linkForumGame(
  input: { tournamentId: string; tournamentGameId: string },
  game: any,
  forumGame: any
): Promise<ManualReplayLinkResult> {
  if (bitValue(forumGame.oos)) throw new ManualReplayLinkConflictError('The server game ended with an out-of-sync error');
  if (String(forumGame.replay_filename).includes('Turn_1_')) {
    throw new ManualReplayLinkConflictError('The game ended on turn 1 and cannot count as a result');
  }

  const forumPlayers = (await getGamePlayers(forumGame.INSTANCE_UUID, forumGame.GAME_ID))
    .filter((player: any) => player.user_id !== -1 && player.user_id !== null);
  await assertSamePlayers(input.tournamentId, game, forumPlayers);

  // Ranked tournament results change ELO, so they keep the ranked add-on
  // requirement (or the server-side competitive model). Unranked and team
  // tournaments accept games hosted without it.
  if (game.tournament_mode === 'ranked') {
    if (!(await hasRankedMarker(forumGame.INSTANCE_UUID, forumGame.GAME_ID))) {
      throw new ManualReplayLinkConflictError('Ranked tournament games must be played with the Ranked add-on');
    }
  }

  const existing = await query(
    `SELECT id, parse_status, match_id, tournament_id, tournament_game_id, deleted_at
     FROM replays WHERE instance_uuid = ? AND game_id = ? LIMIT 1`,
    [forumGame.INSTANCE_UUID, forumGame.GAME_ID]
  );
  const replay = existing.rows?.[0];

  const overrides = JSON.stringify({
    rankedMode: game.tournament_mode === 'ranked',
    tournament: true,
    tournamentName: game.tournament_name,
    tournamentId: input.tournamentId,
    tournamentGameId: input.tournamentGameId,
    manualLink: true,
  });

  if (!replay) {
    // The forum sync skipped this game (no Ranked add-on). Insert it the way
    // the sync does, with a replay URL built from server data only.
    const replayId = uuidv4();
    const baseVersion = getBaseVersion(forumGame.wesnoth_version);
    const replayUrl = `https://${REPLAY_HOST}/${baseVersion}/${utcPathDate(new Date(forumGame.end_time))}/${forumGame.replay_filename}`;
    try {
      await query(
      `INSERT INTO replays (
         id, instance_uuid, game_id, replay_filename, replay_path, wesnoth_version, game_name,
         start_time, end_time, oos, is_reload, integration_confidence, detected_from, replay_url,
         parse_status, parsed, need_integration, reprocess_overrides, created_at, updated_at, last_checked_at
       ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?, 0, 'manual_url', ?, 'new', 0, 1, ?, NOW(), NOW(), NOW())`,
      [
        replayId, forumGame.INSTANCE_UUID, forumGame.GAME_ID, forumGame.replay_filename, baseVersion,
        forumGame.game_name, forumGame.start_time, forumGame.end_time, bitValue(forumGame.is_reload),
        replayUrl, overrides,
      ]
      );
    } catch (error: any) {
      // The forum sync inserted the same game in the meantime (uq_instance_game).
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new ManualReplayLinkConflictError('This replay is being processed; try again in a few minutes');
      }
      throw error;
    }
    return { status: 'queued', replayId, gameName: forumGame.game_name ?? null };
  }

  if (replay.deleted_at) throw new ManualReplayLinkConflictError('This replay was deleted and cannot be linked');
  if (replay.tournament_game_id || replay.tournament_id) {
    throw new ManualReplayLinkConflictError('This replay is already linked to a tournament');
  }

  if (replay.match_id) {
    if (game.tournament_mode !== 'ranked') {
      throw new ManualReplayLinkConflictError('This game was already counted as a ranked match and cannot become an unranked tournament game');
    }
    const matchId = await associateExistingRankedMatch(input.tournamentId, game, replay.id, replay.match_id);
    return { status: 'associated', replayId: replay.id, gameName: forumGame.game_name ?? null, matchId };
  }

  if (!REQUEUEABLE_STATUSES.includes(replay.parse_status)) {
    // `new`/`processing`: the parse job owns the row right now.
    throw new ManualReplayLinkConflictError('This replay is being processed; try again in a few minutes');
  }

  // Same reset as the admin Reprocess action; the condition on parse_status
  // and match_id keeps a concurrent integration from being overwritten.
  const update = await query(
    `UPDATE replays
     SET parse_status = 'new', parsed = 0, parse_error_message = NULL, parse_summary = NULL,
         reprocess_overrides = ?, integration_confidence = NULL, need_integration = 0,
         parsing_started_at = NULL, parsing_completed_at = NULL, updated_at = NOW()
     WHERE id = ? AND parse_status = ? AND match_id IS NULL AND tournament_game_id IS NULL`,
    [overrides, replay.id, replay.parse_status]
  );
  if (!update.rowCount) {
    throw new ManualReplayLinkConflictError('This replay changed while linking; try again');
  }
  return { status: 'queued', replayId: replay.id, gameName: forumGame.game_name ?? null };
}

/**
 * Whether a server game qualifies as ranked: the server-side competitive model
 * (when deployed) or the legacy Ranked add-on content marker.
 */
async function hasRankedMarker(instanceUuid: string, gameId: number): Promise<boolean> {
  const competitive = await getCompetitiveGameData(instanceUuid, gameId);
  return competitive ? true : hasGameTournamentAddon(instanceUuid, gameId, 'Ranked');
}

/** How far back the replay picker looks, in days. Older games are linked by URL. */
export const REPLAY_CANDIDATE_DAYS = 15;
/** Upper bound of server games read per picker request, newest first. */
const REPLAY_CANDIDATE_SCAN_LIMIT = 200;

/**
 * Why a candidate can or cannot be linked. The order of the checks below
 * mirrors `linkForumGame`, so the reason shown is the error the link would give.
 * - `linkable`: not processed yet, or processed without a match (re-queued).
 * - `ranked_match`: already counted as a ranked match; linking attaches it (ranked tournaments only).
 * - `processing`: the parse job owns the replay right now.
 * - `counted_as_ranked`: already a ranked match, cannot become an unranked tournament game.
 * - `oos`, `turn_one`, `no_ranked_addon`: refused by the link validations.
 */
export type ReplayCandidateStatus =
  | 'linkable' | 'ranked_match' | 'processing' | 'counted_as_ranked' | 'oos' | 'turn_one' | 'no_ranked_addon';

export interface ReplayCandidate {
  instance_uuid: string;
  game_id: number;
  game_name: string | null;
  scenario: string | null;
  end_time: string;
  replay_url: string;
  players: { nickname: string; side: number; faction: string | null }[];
  status: ReplayCandidateStatus;
  linkable: boolean;
}

/** OR-chain of `(INSTANCE_UUID, GAME_ID)` pairs, which uses the primary key of the forum tables. */
function gamePairsCondition(games: any[]): { sql: string; params: any[] } {
  return {
    sql: games.map(() => '(INSTANCE_UUID = ? AND GAME_ID = ?)').join(' OR '),
    params: games.flatMap(row => [row.INSTANCE_UUID, row.GAME_ID]),
  };
}

/**
 * Participants of the tournament game, keyed by lower-case nickname: the two
 * entry users in 1v1, the accepted active members of both teams otherwise.
 */
async function loadExpectedPlayers(tournamentId: string, game: any, isTeamGame: boolean): Promise<Map<string, ExpectedReplayPlayer>> {
  const result = isTeamGame
    ? await query(
      `SELECT participants.user_id, participants.team_id, users.nickname
       FROM tournament_participants participants
       JOIN users_extension users ON users.id = participants.user_id
       WHERE participants.tournament_id = ? AND participants.team_id IN (?, ?)
         AND participants.status = 'active' AND participants.participation_status = 'accepted'`,
      [tournamentId, game.team1_id, game.team2_id]
    )
    : await query(
      `SELECT id AS user_id, NULL AS team_id, nickname FROM users_extension WHERE id IN (?, ?)`,
      [game.user1_id, game.user2_id]
    );
  return new Map((result.rows || [])
    .filter((row: any) => row.nickname)
    .map((row: any) => [String(row.nickname).toLowerCase(), { userId: row.user_id, teamId: row.team_id ?? null }]));
}

/**
 * Server games of the last {@link REPLAY_CANDIDATE_DAYS} days that could be
 * linked to a pending tournament game (issue #6), newest first.
 *
 * Source of truth is the forum (`wesnothd_game_*`), not the local `replays`
 * table: games hosted without the Ranked add-on are never synced locally, and
 * those are exactly the misconfigured games this feature recovers.
 *
 * Steps:
 * 1. Resolve the forum user ids of the expected players through phpBB
 *    (`username_clean` is the lower-case form phpBB stores). One resolved
 *    player is enough to find the games; unresolved nicknames only narrow the
 *    search, and the URL fallback remains for those cases.
 * 2. Read their finished games with a replay since the cut-off, driven by the
 *    `USER_ID` index of `wesnothd_game_player_info`.
 * 3. Keep the games whose identified players are exactly the players or teams
 *    of the tournament game.
 * 4. Drop games already linked to a tournament or deleted locally, and give
 *    the rest a status that predicts the link outcome.
 *
 * The list is informational only: linking re-validates everything.
 */
export async function listReplayCandidates(input: {
  tournamentId: string;
  tournamentGameId: string;
  userId: string;
}): Promise<ReplayCandidate[]> {
  const game = await loadAuthorizedPendingGame(input);
  const isTeamGame = Boolean(game.team1_id || game.team2_id) || game.tournament_mode === 'team';
  const expected = await loadExpectedPlayers(input.tournamentId, game, isTeamGame);
  if (expected.size < 2) return [];

  const cleanNames = Array.from(expected.keys());
  const forumUsers = await queryPhpbb(
    `SELECT user_id FROM phpbb3_users WHERE username_clean IN (${cleanNames.map(() => '?').join(', ')})`,
    cleanNames
  ) as any[];
  const forumUserIds = (forumUsers || []).map((row: any) => Number(row.user_id)).filter(Number.isInteger);
  if (forumUserIds.length === 0) return [];

  const cutoff = new Date(Date.now() - REPLAY_CANDIDATE_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const games = await queryForum(
    `SELECT DISTINCT ${FORUM_GAME_COLUMNS}
     FROM wesnothd_game_player_info p
     JOIN wesnothd_game_info g ON g.INSTANCE_UUID = p.INSTANCE_UUID AND g.GAME_ID = p.GAME_ID
     WHERE p.USER_ID IN (${forumUserIds.map(() => '?').join(', ')})
       AND g.START_TIME >= ? AND g.END_TIME IS NOT NULL AND g.REPLAY_NAME IS NOT NULL
     ORDER BY g.END_TIME DESC
     LIMIT ${REPLAY_CANDIDATE_SCAN_LIMIT}`,
    [...forumUserIds, cutoff]
  );
  if (games.length === 0) return [];

  const pairs = gamePairsCondition(games);
  const playerRows = await queryForum(
    `SELECT INSTANCE_UUID, GAME_ID, USER_ID AS user_id, SIDE_NUMBER AS side_number, FACTION AS faction, USER_NAME AS username
     FROM wesnothd_game_player_info WHERE ${pairs.sql} ORDER BY SIDE_NUMBER`,
    pairs.params
  );
  const keyOf = (row: any) => `${row.INSTANCE_UUID}:${row.GAME_ID}`;
  const playersByGame = new Map<string, any[]>();
  for (const row of playerRows) {
    const list = playersByGame.get(keyOf(row)) ?? [];
    list.push(row);
    playersByGame.set(keyOf(row), list);
  }

  const shape = {
    isTeamGame,
    user1Id: game.user1_id ?? null,
    user2Id: game.user2_id ?? null,
    team1Id: game.team1_id ?? null,
    team2Id: game.team2_id ?? null,
  };
  const matching = games.filter(row => matchesTournamentGamePlayers(playersByGame.get(keyOf(row)) ?? [], expected, shape));
  if (matching.length === 0) return [];

  const matchingPairs = gamePairsCondition(matching);
  const [contentRows, localRows] = await Promise.all([
    queryForum(
      `SELECT INSTANCE_UUID, GAME_ID, TYPE, ADDON_ID, NAME FROM wesnothd_game_content_info
       WHERE (${matchingPairs.sql}) AND (TYPE = 'scenario' OR ADDON_ID = 'Ranked')`,
      matchingPairs.params
    ),
    query(
      `SELECT instance_uuid, game_id, parse_status, match_id, tournament_id, tournament_game_id, deleted_at
       FROM replays WHERE ${matching.map(() => '(instance_uuid = ? AND game_id = ?)').join(' OR ')}`,
      matchingPairs.params
    ),
  ]);
  const scenarioByGame = new Map<string, string>();
  const rankedAddonGames = new Set<string>();
  for (const row of contentRows) {
    if (row.TYPE === 'scenario' && row.NAME) scenarioByGame.set(keyOf(row), row.NAME);
    if (row.ADDON_ID === 'Ranked') rankedAddonGames.add(keyOf(row));
  }
  const localByGame = new Map<string, any>(
    (localRows.rows || []).map((row: any) => [`${row.instance_uuid}:${row.game_id}`, row])
  );

  const candidates: ReplayCandidate[] = [];
  for (const row of matching) {
    const key = keyOf(row);
    const local = localByGame.get(key);
    // Already used or deleted: the link would always refuse it, so hide it.
    if (local && (local.deleted_at || local.tournament_id || local.tournament_game_id)) continue;

    let status: ReplayCandidateStatus;
    if (bitValue(row.oos)) status = 'oos';
    else if (String(row.replay_filename).includes('Turn_1_')) status = 'turn_one';
    else if (game.tournament_mode === 'ranked' && !rankedAddonGames.has(key)
      && !(await hasRankedMarker(row.INSTANCE_UUID, row.GAME_ID))) status = 'no_ranked_addon';
    else if (local?.match_id) status = game.tournament_mode === 'ranked' ? 'ranked_match' : 'counted_as_ranked';
    else if (local && !REQUEUEABLE_STATUSES.includes(local.parse_status)) status = 'processing';
    else status = 'linkable';

    const endTime = new Date(row.end_time);
    candidates.push({
      instance_uuid: row.INSTANCE_UUID,
      game_id: Number(row.GAME_ID),
      game_name: row.game_name ?? null,
      scenario: scenarioByGame.get(key) ?? null,
      end_time: endTime.toISOString(),
      replay_url: `https://${REPLAY_HOST}/${getBaseVersion(row.wesnoth_version)}/${utcPathDate(endTime)}/${encodeURIComponent(row.replay_filename)}`,
      players: (playersByGame.get(key) ?? [])
        .filter((player: any) => player.user_id !== -1 && player.user_id !== null)
        .map((player: any) => ({ nickname: player.username, side: Number(player.side_number), faction: player.faction || null })),
      status,
      linkable: status === 'linkable' || status === 'ranked_match',
    });
  }
  return candidates;
}

/**
 * Attach a match that was already counted as a plain ranked match to a ranked
 * tournament game, in one transaction: the tournament game result (with the
 * match id and its map, factions and side), the match tournament fields, and
 * the replay link. Progression follow-up (notifications, next phase) runs after
 * the commit, as for every other result.
 *
 * @returns the match id.
 */
async function associateExistingRankedMatch(
  tournamentId: string,
  game: any,
  replayId: string,
  matchId: string
): Promise<string> {
  const connection = await pool.getConnection();
  let outcome;
  try {
    await connection.beginTransaction();
    const [matchRows] = await connection.execute<any[]>(
      `SELECT id, winner_id, loser_id, map, winner_faction, loser_faction, winner_side, status, tournament_id
       FROM matches WHERE id = ? FOR UPDATE`,
      [matchId]
    );
    const match = matchRows[0];
    if (!match) throw new ManualReplayLinkNotFoundError('The ranked match of this replay was not found');
    if (match.tournament_id) throw new ManualReplayLinkConflictError('This match is already part of a tournament');
    if (match.status === 'cancelled') throw new ManualReplayLinkConflictError('This ranked match was cancelled');

    const winnerEntryId = match.winner_id === game.user1_id ? game.entry1_id
      : match.winner_id === game.user2_id ? game.entry2_id : null;
    const loserInGame = [game.user1_id, game.user2_id].includes(match.loser_id);
    if (!winnerEntryId || !loserInGame) {
      throw new ManualReplayLinkConflictError('The players of the ranked match are not the players of this tournament game');
    }

    outcome = await recordPhaseGameResultInTransaction(
      connection, tournamentId, game.id, winnerEntryId, matchId, undefined,
      { map: match.map, winnerFaction: match.winner_faction, loserFaction: match.loser_faction, winnerSide: match.winner_side }
    );
    await connection.execute(
      `UPDATE matches SET tournament_id = ?, tournament_type = 'ranked', tournament_mode = 'ranked' WHERE id = ?`,
      [tournamentId, matchId]
    );
    await connection.execute(
      `UPDATE replays
       SET tournament_id = ?, tournament_game_id = ?, tournament_link_method = 'manual_url',
           tournament_linked_at = CURRENT_TIMESTAMP, updated_at = NOW()
       WHERE id = ?`,
      [tournamentId, game.id, replayId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await runPhaseGameResultFollowUp(tournamentId, outcome);
  return matchId;
}
