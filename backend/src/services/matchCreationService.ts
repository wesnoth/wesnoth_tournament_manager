/**
 * Shared service for creating ranked matches from parsed replays.
 * Tournament phase games are progressed by competitionProgression; this
 * service only owns the global match/ELO record and never touches legacy
 * tournament tables.
 */

import { query } from '../config/database.js';
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

/** Create a global match record and update the two players' ratings. */
export async function createMatch(input: CreateMatchInput): Promise<CreateMatchResult> {
  try {
    const [winnerResult, loserResult] = await Promise.all([
      query(
        `SELECT id, elo_rating, level, matches_played, is_rated, trend
         FROM users_extension WHERE id = ?`,
        [input.winnerId]
      ),
      query(
        `SELECT id, elo_rating, level, matches_played, is_rated, trend
         FROM users_extension WHERE id = ?`,
        [input.loserId]
      ),
    ]);
    const winner = (winnerResult as any).rows?.[0];
    const loser = (loserResult as any).rows?.[0];
    if (!winner || !loser) {
      return { success: false, error: 'Could not fetch winner/loser from users_extension' };
    }

    const winnerPosBefore = await getPlayerRankingPosition(query, input.winnerId, winner.elo_rating);
    const loserPosBefore = await getPlayerRankingPosition(query, input.loserId, loser.elo_rating);
    const winnerNewRating = calculateNewRating(winner.elo_rating, loser.elo_rating, 'win', winner.matches_played);
    const loserNewRating = calculateNewRating(loser.elo_rating, winner.elo_rating, 'loss', loser.matches_played);
    const winnerPosAfter = await getPlayerRankingPosition(query, input.winnerId, winnerNewRating);
    const loserPosAfter = await getPlayerRankingPosition(query, input.loserId, loserNewRating);
    const winnerRankingChange = winnerPosBefore - winnerPosAfter;
    const loserRankingChange = loserPosBefore - loserPosAfter;
    const winnerTrend = calculateTrend(winner.trend || '-', true);
    const loserTrend = calculateTrend(loser.trend || '-', false);
    const matchId = uuidv4();

    await query(
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
    await query(
      `UPDATE users_extension
       SET elo_rating = ?, is_rated = ?, matches_played = ?,
           total_wins = total_wins + 1, trend = ?, level = ?,
           is_active = 1, last_match_date = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [winnerNewRating, resolveRated(winner.is_rated, winnerNewRating, newWinnerMatches), newWinnerMatches,
        winnerTrend, getUserLevel(winnerNewRating), winner.id]
    );
    await query(
      `UPDATE users_extension
       SET elo_rating = ?, is_rated = ?, matches_played = ?,
           total_losses = total_losses + 1, trend = ?, level = ?,
           is_active = 1, last_match_date = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [loserNewRating, resolveRated(loser.is_rated, loserNewRating, newLoserMatches), newLoserMatches,
        loserTrend, getUserLevel(loserNewRating), loser.id]
    );
    return { success: true, matchId };
  } catch (error) {
    return { success: false, error: (error as Error).message || String(error) };
  }
}

function resolveRated(currentlyRated: boolean, newElo: number, matchesPlayed: number): boolean {
  if (currentlyRated && newElo < 1400) return false;
  if (!currentlyRated && matchesPlayed >= 10 && newElo >= 1400) return true;
  return currentlyRated;
}
