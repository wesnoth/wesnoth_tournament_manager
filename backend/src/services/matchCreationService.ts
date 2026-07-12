/**
 * matchCreationService.ts
 *
 * Shared service for creating a ranked/tournament match from a parsed replay.
 * Used by both the automated parse job (confidence=2) and the manual confirm endpoint (confidence=1).
 */

import { query } from '../config/database.js';
import { calculateNewRating, calculateTrend, getPlayerRankingPosition } from '../utils/elo.js';
import { getUserLevel } from '../utils/auth.js';
import { v4 as uuidv4 } from 'uuid';

export interface CreateTournamentUnrankedMatchInput {
  winnerId: string;
  loserId: string;
  linkedTournamentId: string;
  linkedTournamentRoundMatchId: string;
}

export interface CreateMatchInput {
  winnerId: string;
  loserId: string;
  winnerFaction: string;
  loserFaction: string;
  map: string;
  winnerSide: number;
  /** ID of the replays table row */
  replayRowId: string;
  replayFilePath: string;
  /** 'ranked' | 'tournament_ranked' | 'tournament_unranked' */
  matchType: string;
  /** tournament_id to set on the match (null for direct ranked) */
  linkedTournamentId: string | null;
  /** If set, update win counters in tournament_round_matches after match creation */
  linkedTournamentRoundMatchId: string | null;
  gameId: number;
  wesnothVersion: string;
  instanceUuid: string;
}

export interface CreateMatchResult {
  success: boolean;
  matchId?: string;
  error?: string;
}

function getTournamentType(matchType: string): string | null {
  if (matchType === 'tournament_ranked')   return 'ranked';
  if (matchType === 'tournament_unranked') return 'unranked';
  return null;
}

function getTournamentMode(matchType: string): string | null {
  if (matchType === 'ranked')              return 'ladder';
  if (matchType === 'tournament_ranked')   return 'ranked';
  if (matchType === 'tournament_unranked') return 'unranked';
  return null;
}

/**
 * Create a match record, update ELO/stats for both players,
 * and (if tournament) update tournament_round_match win counters.
 */
export async function createMatch(input: CreateMatchInput): Promise<CreateMatchResult> {
  try {
    const winnerResult = await query(
      `SELECT id, elo_rating, level, matches_played, is_rated, trend FROM users_extension WHERE id = ?`,
      [input.winnerId]
    );
    const loserResult = await query(
      `SELECT id, elo_rating, level, matches_played, is_rated, trend FROM users_extension WHERE id = ?`,
      [input.loserId]
    );

    const winner = (winnerResult as any).rows?.[0];
    const loser  = (loserResult  as any).rows?.[0];

    if (!winner || !loser) {
      return { success: false, error: 'Could not fetch winner/loser from users_extension' };
    }

    // Calculate positions BEFORE the match
    const winnerPosBefore = await getPlayerRankingPosition(query, input.winnerId, winner.elo_rating);
    const loserPosBefore = await getPlayerRankingPosition(query, input.loserId, loser.elo_rating);

    const winnerNewRating = calculateNewRating(winner.elo_rating, loser.elo_rating, 'win',  winner.matches_played);
    const loserNewRating  = calculateNewRating(loser.elo_rating,  winner.elo_rating, 'loss', loser.matches_played);

    // Calculate positions AFTER the match (with new ratings)
    const winnerPosAfter = await getPlayerRankingPosition(query, input.winnerId, winnerNewRating);
    const loserPosAfter = await getPlayerRankingPosition(query, input.loserId, loserNewRating);

    // Calculate position changes (negative means gained positions/improved rank, positive means lost positions)
    const winnerRankingChange = winnerPosBefore - winnerPosAfter;
    const loserRankingChange = loserPosBefore - loserPosAfter;

    const winnerTrend = calculateTrend(winner.trend || '-', true);
    const loserTrend  = calculateTrend(loser.trend  || '-', false);

    const matchId = uuidv4();

    // Keep the column list and positional values aligned explicitly. This
    // insert is used by replay and manual reporting paths, so a new column or
    // value must be added in the same position on both sides. The legacy
    // tournament_type/tournament_mode values are retained for compatibility
    // until their writers and readers are removed in a separate migration.
    await query(
      `INSERT INTO matches (
         id, winner_id, loser_id, winner_faction, loser_faction, map,
         replay_id, replay_file_path, auto_reported, status,
         tournament_type, tournament_mode, tournament_id,
         winner_elo_before, loser_elo_before, winner_level_before, loser_level_before,
         winner_elo_after,  loser_elo_after,  winner_level_after,  loser_level_after,
         winner_ranking_pos, winner_ranking_change, loser_ranking_pos, loser_ranking_change,
         winner_side, game_id, wesnoth_version, instance_uuid,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'reported', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        matchId,
        winner.id, loser.id,
        input.winnerFaction, input.loserFaction,
        input.map,
        input.replayRowId, input.replayFilePath,
        getTournamentType(input.matchType),
        getTournamentMode(input.matchType),
        input.linkedTournamentId,
        winner.elo_rating,             loser.elo_rating,
        getUserLevel(winner.elo_rating), getUserLevel(loser.elo_rating),
        winnerNewRating,               loserNewRating,
        getUserLevel(winnerNewRating),  getUserLevel(loserNewRating),
        winnerPosAfter, winnerRankingChange, loserPosAfter, loserRankingChange,
        input.winnerSide,
        input.gameId, input.wesnothVersion, input.instanceUuid,
      ]
    );

    // Update winner stats
    const newWinnerMatches = winner.matches_played + 1;
    const winnerIsNowRated = resolveRated(winner.is_rated, winnerNewRating, newWinnerMatches);
    await query(
      `UPDATE users_extension
       SET elo_rating = ?, is_rated = ?, matches_played = ?,
           total_wins = total_wins + 1, trend = ?, level = ?, is_active = 1, last_match_date = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [winnerNewRating, winnerIsNowRated, newWinnerMatches, winnerTrend, getUserLevel(winnerNewRating), winner.id]
    );

    // Update loser stats
    const newLoserMatches = loser.matches_played + 1;
    const loserIsNowRated = resolveRated(loser.is_rated, loserNewRating, newLoserMatches);
    await query(
      `UPDATE users_extension
       SET elo_rating = ?, is_rated = ?, matches_played = ?,
           total_losses = total_losses + 1, trend = ?, level = ?, is_active = 1, last_match_date = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [loserNewRating, loserIsNowRated, newLoserMatches, loserTrend, getUserLevel(loserNewRating), loser.id]
    );

    // Update tournament round match if linked
    if (input.linkedTournamentRoundMatchId) {
      await updateTournamentRoundMatch(input.linkedTournamentRoundMatchId, winner.id);
    }

    return { success: true, matchId };
  } catch (err) {
    return { success: false, error: (err as any)?.message || String(err) };
  }
}

function resolveRated(currentlyRated: boolean, newElo: number, matchesPlayed: number): boolean {
  if (currentlyRated && newElo < 1400) return false;
  if (!currentlyRated && matchesPlayed >= 10 && newElo >= 1400) return true;
  return currentlyRated;
}

/**
 * Increment win counters in tournament_round_matches.
 * Closes the series if wins_required is reached.
 */
export async function updateTournamentRoundMatch(
  roundMatchId: string,
  winnerId: string
): Promise<{ seriesCompleted: boolean; shouldCreateNextMatch: boolean; tournamentId: string | null; roundId: string | null; player1Id?: string; player2Id?: string }> {
  const rmResult = await query(
    `SELECT id, tournament_id, round_id, player1_id, player2_id, player1_wins, player2_wins, wins_required, best_of
     FROM tournament_round_matches WHERE id = ?`,
    [roundMatchId]
  );

  const rows = (rmResult as any).rows || [];
  if (rows.length === 0) {
    console.warn(`⚠️  [TOURNAMENT LINK] tournament_round_match not found: ${roundMatchId}`);
    return { seriesCompleted: false, shouldCreateNextMatch: false, tournamentId: null, roundId: null };
  }

  const rm = rows[0];
  console.log(`🔍 [TOURNAMENT LINK] Round match details:`, {
    roundMatchId,
    tournamentId: rm.tournament_id,
    p1Id: rm.player1_id,
    p2Id: rm.player2_id,
    p1Wins: rm.player1_wins,
    p2Wins: rm.player2_wins,
    winsRequired: rm.wins_required,
    winnerId
  });
  
  const winnerIsPlayer1 = rm.player1_id === winnerId;
  const newP1Wins = rm.player1_wins + (winnerIsPlayer1 ? 1 : 0);
  const newP2Wins = rm.player2_wins + (winnerIsPlayer1 ? 0 : 1);

  const seriesOver = newP1Wins >= rm.wins_required || newP2Wins >= rm.wins_required;
  // Can create next match if series not over AND we haven't exceeded max matches for this best_of
  const totalMatchesPlayed = newP1Wins + newP2Wins;
  const shouldCreateNext = !seriesOver && totalMatchesPlayed < rm.best_of;
  console.log(`🔍 [TOURNAMENT LINK] Series check: newP1Wins=${newP1Wins} newP2Wins=${newP2Wins} winsRequired=${rm.wins_required} bestOf=${rm.best_of} seriesOver=${seriesOver} shouldCreateNext=${shouldCreateNext}`);
  
  const newStatus  = seriesOver ? 'completed' : 'in_progress';
  const newWinnerId = seriesOver ? winnerId : null;

  await query(
    `UPDATE tournament_round_matches
     SET player1_wins = ?, player2_wins = ?, series_status = ?, winner_id = ?, updated_at = NOW()
     WHERE id = ?`,
    [newP1Wins, newP2Wins, newStatus, newWinnerId, roundMatchId]
  );

  console.log(`   ✅ [TOURNAMENT LINK] Round match updated: p1_wins=${newP1Wins} p2_wins=${newP2Wins} status=${newStatus}`);

  // When the series ends, update tournament_participants win/loss/points
  if (seriesOver && rm.tournament_id) {
    const loserId = winnerIsPlayer1 ? rm.player2_id : rm.player1_id;

    // Check tournament mode to determine if winner/loser are player UUIDs or team UUIDs
    const modeResult = await query(
      `SELECT tournament_mode FROM tournaments WHERE id = ?`,
      [rm.tournament_id]
    );
    const tournamentMode = (modeResult as any).rows?.[0]?.tournament_mode;
    console.log(`   🔍 [TOURNAMENT LINK] Tournament mode: ${tournamentMode}`);

    if (tournamentMode === 'team') {
      // Team tournament: winnerId and loserId are TEAM UUIDs
      // Update ONLY tournament_teams (not individual players)
      
      console.log(`   🏆 [TOURNAMENT LINK] TEAM TOURNAMENT: Updating tournament_teams`);
      console.log(`      Winner team ID: ${winnerId}`);
      console.log(`      Loser team ID: ${loserId}`);
      
      try {
        await query(
          `UPDATE tournament_teams
           SET tournament_wins = COALESCE(tournament_wins, 0) + 1,
               tournament_points = COALESCE(tournament_points, 0) + 1
           WHERE id = ?`,
          [winnerId]
        );
        console.log(`      ✅ Winner team updated: +1 win, +1 point`);
      } catch (winErr) {
        console.error(`      ❌ Failed to update winner team:`, winErr);
        throw winErr;
      }
      
      try {
        await query(
          `UPDATE tournament_teams
           SET tournament_losses = COALESCE(tournament_losses, 0) + 1
           WHERE id = ?`,
          [loserId]
        );
        console.log(`      ✅ Loser team updated: +1 loss`);
      } catch (loseErr) {
        console.error(`      ❌ Failed to update loser team:`, loseErr);
        throw loseErr;
      }

      // Update last_match_date for all 4 team members
      try {
        await query(
          `UPDATE users_extension ue
           SET ue.last_match_date = NOW(), ue.is_active = 1, ue.updated_at = NOW()
           WHERE ue.id IN (
             SELECT user_id FROM tournament_participants 
             WHERE tournament_id = ? AND team_id = ?
           )`,
          [rm.tournament_id, winnerId]
        );
        console.log(`      ✅ Winner team members marked active`);
      } catch (err) {
        console.error(`      ❌ Failed to update winner team members:`, err);
        throw err;
      }

      try {
        await query(
          `UPDATE users_extension ue
           SET ue.last_match_date = NOW(), ue.is_active = 1, ue.updated_at = NOW()
           WHERE ue.id IN (
             SELECT user_id FROM tournament_participants 
             WHERE tournament_id = ? AND team_id = ?
           )`,
          [rm.tournament_id, loserId]
        );
        console.log(`      ✅ Loser team members marked active`);
      } catch (err) {
        console.error(`      ❌ Failed to update loser team members:`, err);
        throw err;
      }

      console.log(`   ✅ [TOURNAMENT LINK] Team stats and member activity updated successfully`);
    } else {
      // 1v1 tournament: winnerId and loserId are PLAYER UUIDs
      await query(
        `UPDATE tournament_participants
         SET tournament_wins   = COALESCE(tournament_wins, 0) + 1,
             tournament_points = COALESCE(tournament_points, 0) + 1
         WHERE tournament_id = ? AND user_id = ?`,
        [rm.tournament_id, winnerId]
      );
      await query(
        `UPDATE tournament_participants
         SET tournament_losses = COALESCE(tournament_losses, 0) + 1
         WHERE tournament_id = ? AND user_id = ?`,
        [rm.tournament_id, loserId]
      );

      console.log(`   ✅ [TOURNAMENT LINK] 1v1 stats: winner(${winnerId}) +1W+1P, loser(${loserId}) +1L`);
    }
  }

  return { 
    seriesCompleted: seriesOver, 
    shouldCreateNextMatch: shouldCreateNext,
    tournamentId: rm.tournament_id || null, 
    roundId: rm.round_id || null,
    player1Id: rm.player1_id,
    player2Id: rm.player2_id
  };
}

/**
 * Create an unranked tournament match record.
 * Does NOT insert into the `matches` table and does NOT update ELO or global stats.
 * Only inserts into `tournament_matches` and updates the `tournament_round_matches` series counters.
 * Follows the same pattern as the manual confidence-1 confirm flow in routes/matches.ts.
 */
export async function createTournamentUnrankedMatch(
  input: CreateTournamentUnrankedMatchInput
): Promise<CreateMatchResult> {
  try {
    const rmResult = await query(
      `SELECT tournament_id, round_id, player1_id, player2_id
       FROM tournament_round_matches WHERE id = ?`,
      [input.linkedTournamentRoundMatchId]
    );

    const rm = ((rmResult as any).rows || [])[0];
    if (!rm) {
      return { success: false, error: `tournament_round_match not found: ${input.linkedTournamentRoundMatchId}` };
    }

    const tournamentMatchId = uuidv4();
    await query(
      `INSERT INTO tournament_matches
       (id, tournament_id, round_id, player1_id, player2_id, match_id, winner_id, loser_id, match_status, status, tournament_round_match_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'completed', 'unconfirmed', ?, NOW(), NOW())`,
      [
        tournamentMatchId,
        rm.tournament_id,
        rm.round_id,
        rm.player1_id,
        rm.player2_id,
        input.winnerId,
        input.loserId || null,
        input.linkedTournamentRoundMatchId,
      ]
    );

    console.log(`   ✅ [UNRANKED] tournament_matches entry created: ${tournamentMatchId}`);

    await updateTournamentRoundMatch(input.linkedTournamentRoundMatchId, input.winnerId);

    return { success: true, matchId: tournamentMatchId };
  } catch (err) {
    return { success: false, error: (err as any)?.message || String(err) };
  }
}
