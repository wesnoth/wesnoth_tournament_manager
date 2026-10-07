/**
 * Shared service for creating ranked matches from parsed replays.
 * Tournament phase games are progressed by competitionProgression; this
 * service only owns the global match/ELO record and never touches legacy
 * tournament tables.
 */

import { pool } from '../config/database.js';
import { calculateNewRating, calculateTrend, getPlayerRankingPosition } from '../utils/elo.js';
import { getUserLevel } from '../utils/auth.js';
import { v4 as uuidv4 } from 'uuid';

export interface CreateMatchInput {
  winnerId: string;
  loserId: string;
  winnerFaction: string;
  loserFaction: string;
  map: string;
  winnerSide: number;
  replayRowId: string | null;
  replayFilePath: string | null;
  /** 'ranked' | 'tournament_ranked' | 'tournament_unranked' */
  matchType: string;
  /** Tournament ID to retain on the global match record. */
  linkedTournamentId: string | null;
  /** Phase-engine game ID, when the replay belongs to a tournament game. */
  linkedTournamentGameId?: string | null;
  gameId: number | null;
  wesnothVersion: string | null;
  instanceUuid: string | null;
  /** Replay-created matches use 1; test simulations deliberately use 0. */
  autoReported?: boolean;
}

export interface CreateMatchResult {
  success: boolean;
  matchId?: string;
  error?: string;
}

function getTournamentType(matchType: string): string | null {
  if (matchType === 'tournament_ranked') return 'ranked';
  if (matchType === 'tournament_unranked') return 'unranked';
  return null;
}

function getTournamentMode(matchType: string): string | null {
  if (matchType === 'ranked') return 'ladder';
  if (matchType === 'tournament_ranked') return 'ranked';
  if (matchType === 'tournament_unranked') return 'unranked';
  return null;
}

/** The subset of a mysql2 connection the transaction-scoped writers use. */
export interface SqlExecutor {
  execute(sql: string, values?: any[]): Promise<[any, any]>;
}

/**
 * Create a global match record and update the two players' ratings inside
 * the caller's transaction (audit finding 4).
 *
 * Both user rows are locked with SELECT ... FOR UPDATE in ascending id order
 * before any rating is read. Two concurrent integrations for one player
 * therefore serialize on that row instead of both reading the same rating
 * and losing one update, and the fixed order prevents the two-player lock
 * cycle that would deadlock two matches between the same players. Ranking
 * positions are read on the same connection, so they see the locked state.
 *
 * Any failure throws: the caller owns the transaction and must roll back.
 * Nothing here commits.
 *
 * @returns the new match id.
 */
export async function createMatchInTransaction(connection: SqlExecutor, input: CreateMatchInput): Promise<string> {
  const [first, second] = [input.winnerId, input.loserId].sort();
  const [lockedRows] = await connection.execute(
    `SELECT id, elo_rating, level, matches_played, is_rated, trend
     FROM users_extension WHERE id IN (?, ?) ORDER BY id FOR UPDATE`,
    [first, second]
  );
  const winner = (lockedRows as any[]).find((row) => row.id === input.winnerId);
  const loser = (lockedRows as any[]).find((row) => row.id === input.loserId);
  if (!winner || !loser) {
    throw new Error('Could not fetch winner/loser from users_extension');
  }

  // getPlayerRankingPosition expects the pg-style { rows } query interface.
  const txQuery = async (sql: string, values?: any[]) => {
    const [rows] = await connection.execute(sql, values);
    return { rows: rows as any[] };
  };
  const winnerPosBefore = await getPlayerRankingPosition(txQuery, input.winnerId, winner.elo_rating);
  const loserPosBefore = await getPlayerRankingPosition(txQuery, input.loserId, loser.elo_rating);
  const winnerNewRating = calculateNewRating(winner.elo_rating, loser.elo_rating, 'win', winner.matches_played);
  const loserNewRating = calculateNewRating(loser.elo_rating, winner.elo_rating, 'loss', loser.matches_played);
  const winnerPosAfter = await getPlayerRankingPosition(txQuery, input.winnerId, winnerNewRating);
  const loserPosAfter = await getPlayerRankingPosition(txQuery, input.loserId, loserNewRating);
  const winnerRankingChange = winnerPosBefore - winnerPosAfter;
  const loserRankingChange = loserPosBefore - loserPosAfter;
  const winnerTrend = calculateTrend(winner.trend || '-', true);
  const loserTrend = calculateTrend(loser.trend || '-', false);
  const matchId = uuidv4();

  await connection.execute(
    `INSERT INTO matches (
       id, winner_id, loser_id, winner_faction, loser_faction, map,
       replay_id, replay_file_path, auto_reported, status,
       tournament_type, tournament_mode, tournament_id,
       winner_elo_before, loser_elo_before, winner_level_before, loser_level_before,
       winner_elo_after, loser_elo_after, winner_level_after, loser_level_after,
       winner_ranking_pos, winner_ranking_change, loser_ranking_pos, loser_ranking_change,
       winner_side, game_id, wesnoth_version, instance_uuid, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reported', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      matchId, winner.id, loser.id, input.winnerFaction, input.loserFaction, input.map,
      input.replayRowId, input.replayFilePath, input.autoReported === false ? 0 : 1,
      getTournamentType(input.matchType), getTournamentMode(input.matchType), input.linkedTournamentId,
      winner.elo_rating, loser.elo_rating,
      getUserLevel(winner.elo_rating), getUserLevel(loser.elo_rating),
      winnerNewRating, loserNewRating,
      getUserLevel(winnerNewRating), getUserLevel(loserNewRating),
      winnerPosAfter, winnerRankingChange, loserPosAfter, loserRankingChange,
      input.winnerSide, input.gameId, input.wesnothVersion, input.instanceUuid,
    ]
  );

  const newWinnerMatches = winner.matches_played + 1;
  const newLoserMatches = loser.matches_played + 1;
  await connection.execute(
    `UPDATE users_extension
     SET elo_rating = ?, is_rated = ?, matches_played = ?,
         total_wins = total_wins + 1, trend = ?, level = ?,
         is_active = 1, last_match_date = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [winnerNewRating, resolveRated(winner.is_rated, winnerNewRating, newWinnerMatches), newWinnerMatches,
      winnerTrend, getUserLevel(winnerNewRating), winner.id]
  );
  await connection.execute(
    `UPDATE users_extension
     SET elo_rating = ?, is_rated = ?, matches_played = ?,
         total_losses = total_losses + 1, trend = ?, level = ?,
         is_active = 1, last_match_date = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [loserNewRating, resolveRated(loser.is_rated, loserNewRating, newLoserMatches), newLoserMatches,
      loserTrend, getUserLevel(loserNewRating), loser.id]
  );
  return matchId;
}

/**
 * Create a global match record and update the two players' ratings in a
 * transaction of its own.
 *
 * Kept for callers that do not integrate a replay (test simulations). It
 * preserves the historical { success, error } contract: on any failure the
 * transaction is rolled back, so no match row or rating change survives.
 */
export async function createMatch(input: CreateMatchInput): Promise<CreateMatchResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const matchId = await createMatchInTransaction(connection, input);
    await connection.commit();
    return { success: true, matchId };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    return { success: false, error: (error as Error).message || String(error) };
  } finally {
    connection.release();
  }
}

/**
 * Whether a player is rated after a match. A rated player drops out below
 * 1400; an unrated player becomes rated once they reach 10 matches with at
 * least 1400. Exported for its unit tests (matchCreationService.test.ts).
 */
export function resolveRated(currentlyRated: boolean, newElo: number, matchesPlayed: number): boolean {
  if (currentlyRated && newElo < 1400) return false;
  if (!currentlyRated && matchesPlayed >= 10 && newElo >= 1400) return true;
  return currentlyRated;
}
