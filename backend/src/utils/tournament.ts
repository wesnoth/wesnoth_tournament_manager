/**
 * Tournament match generation utilities
 * Generates tournament matches based on tournament type and participants
 */



import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import discordService from '../services/discordService.js';
import {
  calculateTeamSwissTiebreakers,
  calculateLeagueTiebreakers,
} from '../services/statisticsCalculator.js';

interface Participant {
  id: string;
  user_id: string;
  elo_rating?: number;
}

/**
 * Select top players for elimination phase in Swiss-Elimination Mix
 * This function is called before activating the first elimination round
 * It calculates how many players should advance based on elimination rounds
 * and marks the rest as eliminated
 */
export async function selectPlayersForEliminationPhase(
  tournamentId: string,
  finalRounds: number
): Promise<boolean> {
  try {
    // Calculate how many players should advance to elimination
    // With N final rounds in elimination format:
    // - 1 final round: 2 players
    // - 2 final rounds: 4 players
    // - 3 final rounds: 8 players
    const playersToAdvance = Math.pow(2, finalRounds);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 [SELECT_PLAYERS] STARTING PLAYER SELECTION FOR ELIMINATION PHASE`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Tournament ID: ${tournamentId}`);
    console.log(`Final Rounds: ${finalRounds}`);
    console.log(`Players to Advance: ${playersToAdvance}`);
    
    // Get tournament mode to determine which table to use
    const tournResultFirst = await query(
      'SELECT tournament_mode, tournament_type FROM tournaments WHERE id = ?',
      [tournamentId]
    );
    const tournamentMode = tournResultFirst.rows[0]?.tournament_mode || 'ranked';
    const tournamentType = tournResultFirst.rows[0]?.tournament_type || 'swiss';
    console.log(`Tournament Mode: ${tournamentMode}`);
    console.log(`Tournament Type: ${tournamentType}`);
    console.log(`[DEBUG] selectPlayersForEliminationPhase() - Starting with tourney mode: ${tournamentMode}`);
    
    // Calculate tiebreakers FIRST before selecting players
    console.log(`\n🎲 [TIEBREAKERS] Calculating tiebreakers (OMP, GWP, OGP)...`);
    try {
      if (tournamentMode === 'team') {
        console.log(`🎲 [TIEBREAKERS] Calculating team tournament tiebreakers`);
        const tiebreakersResult = await calculateTeamSwissTiebreakers(tournamentId);
        console.log(`✅ [TIEBREAKERS] Calculated tiebreakers for ${tiebreakersResult.length} teams`);
        
        // Update database with calculated tiebreakers
        for (const tb of tiebreakersResult) {
          await query(
            `UPDATE tournament_teams SET omp = ?, gwp = ?, ogp = ? WHERE tournament_id = ? AND id = ?`,
            [tb.omp, tb.gwp, tb.ogp, tournamentId, tb.team_id]
          );
        }
      } else {
        const tiebreakersResult = await calculateLeagueTiebreakers(tournamentId);
        console.log(`✅ [TIEBREAKERS] Calculated tiebreakers for ${tiebreakersResult.length} participants`);
        
        // Update database with calculated tiebreakers
        for (const tb of tiebreakersResult) {
          await query(
            `UPDATE tournament_participants SET omp = ?, gwp = ?, ogp = ? WHERE tournament_id = ? AND user_id = ?`,
            [tb.omp, tb.gwp, tb.ogp, tournamentId, tb.user_id]
          );
        }
      }
    } catch (tiebreakersErr) {
      console.error('[TIEBREAKERS] Error calculating tiebreakers:', tiebreakersErr);
      // Don't fail the tournament if tiebreakers calculation fails
    }

    let topPlayerIds: string[];
    let fullRankingResult: any;

    // Get top players based on tournament mode
    console.log(`[DEBUG] Checking tournament mode: is team mode? ${tournamentMode === 'team'}`);
    if (tournamentMode === 'team') {
      // Team mode: select from tournament_teams
      console.log(`\n[SELECT_PLAYERS] Using TEAM MODE - querying tournament_teams`);
      
      const topPlayersResult = await query(
        `SELECT tt.id as user_id FROM tournament_teams tt
         WHERE tt.tournament_id = ? AND tt.status = 'active'
         ORDER BY tt.tournament_points DESC, tt.tournament_wins DESC,
                  COALESCE(tt.omp, 0) DESC, COALESCE(tt.gwp, 0) DESC, COALESCE(tt.ogp, 0) DESC,
                  COALESCE(tt.team_elo, 0) DESC, tt.id
         LIMIT ?`,
        [tournamentId, playersToAdvance]
      );

      if (topPlayersResult.rows.length === 0) {
        console.log(`❌ [SELECT_PLAYERS] No teams found to advance to elimination phase`);
        return false;
      }

      topPlayerIds = topPlayersResult.rows.map((row: any) => row.user_id);
      console.log(`✅ [SELECT_PLAYERS] Top ${topPlayerIds.length} teams advancing: ${topPlayerIds.join(', ')}`);

      // Get full ranking for verification
      fullRankingResult = await query(
        `SELECT tt.id as user_id, tt.tournament_points, tt.tournament_wins, tt.omp, tt.gwp, tt.ogp, tt.team_elo as elo_rating, tt.name as team_name
         FROM tournament_teams tt
         WHERE tt.tournament_id = ? AND tt.status = 'active'
         ORDER BY tt.tournament_points DESC, tt.tournament_wins DESC,
                  COALESCE(tt.omp, 0) DESC, COALESCE(tt.gwp, 0) DESC, COALESCE(tt.ogp, 0) DESC,
                  COALESCE(tt.team_elo, 0) DESC, tt.id`,
        [tournamentId]
      );

      console.log(`\n[SELECT_PLAYERS] Full team ranking (for verification):`);
      fullRankingResult.rows.forEach((row: any, idx: number) => {
        const isAdvancing = topPlayerIds.includes(row.user_id) ? '✅' : '❌';
        console.log(`  ${isAdvancing} #${idx + 1} ${row.team_name} (${row.user_id}): ${row.tournament_points}pts, ${row.tournament_wins}W, OMP=${row.omp}, GWP=${row.gwp}, OGP=${row.ogp}, ELO=${row.elo_rating}`);
      });

      // Mark advancing teams as 'active' and others as 'eliminated'
      console.log(`\n[SELECT_PLAYERS] Updating status for advancing teams...`);
      const activateResult = await query(
        `UPDATE tournament_teams
         SET status = 'active'
         WHERE tournament_id = ? 
         AND id IN (${topPlayerIds.map((_, i) => `$${i + 2}`).join(',')})`,
        [tournamentId, ...topPlayerIds]
      );
      console.log(`✅ [SELECT_PLAYERS] Updated ${activateResult.rowCount} advancing teams to ACTIVE`);

      console.log(`\n[SELECT_PLAYERS] Updating status for eliminated teams...`);
      const result = await query(
        `UPDATE tournament_teams
         SET status = 'eliminated'
         WHERE tournament_id = ? 
         AND id NOT IN (${topPlayerIds.map((_, i) => `$${i + 2}`).join(',')})`,
        [tournamentId, ...topPlayerIds]
      );
      console.log(`🚫 [SELECT_PLAYERS] Updated ${result.rowCount} eliminated teams`);

      // Verify the update
      const verifyResult = await query(
        `SELECT status, COUNT(*) as count FROM tournament_teams
         WHERE tournament_id = ?
         GROUP BY status`,
        [tournamentId]
      );

      console.log(`\n[SELECT_PLAYERS] Verification - Final team status distribution:`);
      verifyResult.rows.forEach((row: any) => {
        console.log(`  ${row.status}: ${row.count} teams`);
      });
    } else {
      // Ranked/Unranked 1v1 mode: select from tournament_participants
      console.log(`\n[SELECT_PLAYERS] Using 1V1 MODE (ranked/unranked) - querying tournament_participants`);

      const topPlayersResult = await query(
        `SELECT tp.user_id FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'
         ORDER BY tp.tournament_points DESC, tp.tournament_wins DESC, 
                  COALESCE(tp.omp, 0) DESC, COALESCE(tp.gwp, 0) DESC, COALESCE(tp.ogp, 0) DESC, 
                  COALESCE(u.elo_rating, 0) DESC, tp.user_id
         LIMIT ?`,
        [tournamentId, playersToAdvance]
      );

      console.log(`[DEBUG] 1v1 query returned ${topPlayersResult.rows.length} rows`);
      if (topPlayersResult.rows.length === 0) {
        console.log(`❌ [SELECT_PLAYERS] No players found to advance to elimination phase`);
        return false;
      }

      topPlayerIds = topPlayersResult.rows.map((row: any) => row.user_id);
      console.log(`✅ [SELECT_PLAYERS] Top ${topPlayerIds.length} players advancing: ${topPlayerIds.join(', ')}`);

      // Get full ranking for verification
      fullRankingResult = await query(
        `SELECT tp.user_id, tp.tournament_points, tp.tournament_wins, tp.omp, tp.gwp, tp.ogp, u.elo_rating
         FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'
         ORDER BY tp.tournament_points DESC, tp.tournament_wins DESC, 
                  COALESCE(tp.omp, 0) DESC, COALESCE(tp.gwp, 0) DESC, COALESCE(tp.ogp, 0) DESC, 
                  COALESCE(u.elo_rating, 0) DESC, tp.user_id`,
        [tournamentId]
      );

      console.log(`\n[SELECT_PLAYERS] Full player ranking (for verification):`);
      fullRankingResult.rows.forEach((row: any, idx: number) => {
        const isAdvancing = topPlayerIds.includes(row.user_id) ? '✅' : '❌';
        console.log(`  ${isAdvancing} #${idx + 1} ${row.user_id}: ${row.tournament_points}pts, ${row.tournament_wins}W, OMP=${row.omp}, GWP=${row.gwp}, OGP=${row.ogp}, ELO=${row.elo_rating}`);
      });

      // Mark advancing players as 'active'
      console.log(`\n[SELECT_PLAYERS] Updating status for advancing players...`);
      const activateResult = await query(
        `UPDATE tournament_participants
         SET status = 'active'
         WHERE tournament_id = ? 
         AND participation_status = 'accepted'
         AND user_id IN (${topPlayerIds.map((_, i) => `$${i + 2}`).join(',')})`,
        [tournamentId, ...topPlayerIds]
      );
      console.log(`[DEBUG] UPDATE active result - rowCount: ${activateResult.rowCount}`);
      console.log(`✅ [SELECT_PLAYERS] Updated ${activateResult.rowCount} advancing players to ACTIVE`);

      // Mark all other players as eliminated
      console.log(`\n[SELECT_PLAYERS] Updating status for eliminated players...`);
      const result = await query(
        `UPDATE tournament_participants
         SET status = 'eliminated'
         WHERE tournament_id = ? 
         AND participation_status = 'accepted'
         AND user_id NOT IN (${topPlayerIds.map((_, i) => `$${i + 2}`).join(',')})`,
        [tournamentId, ...topPlayerIds]
      );
      console.log(`[DEBUG] UPDATE eliminated result - rowCount: ${result.rowCount}`);
      console.log(`🚫 [SELECT_PLAYERS] Updated ${result.rowCount} eliminated players`);

      // Verify the update
      const verifyResult = await query(
        `SELECT status, COUNT(*) as count FROM tournament_participants
         WHERE tournament_id = ?
         GROUP BY status`,
        [tournamentId]
      );

      console.log(`\n[SELECT_PLAYERS] Verification - Final player status distribution:`);
      verifyResult.rows.forEach((row: any) => {
        console.log(`  ${row.status}: ${row.count} players`);
      });
    }

    console.log(`${'='.repeat(80)}\n`);
    
    return true;
  } catch (error) {
    console.error('[SELECT_PLAYERS] Error selecting players for elimination phase:', error);
    return false;
  }
}

/**
 * Generates all matches for a tournament round
 * For the first round, matches are generated for all accepted participants
 * For subsequent rounds, matches depend on previous round results
 */
export async function generateRoundMatches(
  tournamentId: string,
  roundId: string,
  roundNumber: number,
  tournamentType: string,
  participants: Participant[]
): Promise<{ matches: any[], count: number }> {
  const matches = [];

  try {
    // If first round, generate matches from all participants
    if (roundNumber === 1) {
      matches.push(...generateFirstRoundMatches(participants, tournamentId, roundId));
    } else {
      // For subsequent rounds, get winners from previous round
      const previousRoundMatches = await query(
        `SELECT winner_id, player1_id, player2_id FROM tournament_matches 
         WHERE round_id = (
           SELECT id FROM tournament_rounds 
           WHERE tournament_id = ? AND round_number = ?
         )`,
        [tournamentId, roundNumber - 1]
      );

      const winners = previousRoundMatches.rows
        .filter((m: any) => m.winner_id)
        .map((m: any) => ({ user_id: m.winner_id }));

      if (tournamentType.toLowerCase() === 'elimination') {
        matches.push(...generateEliminationMatches(winners, tournamentId, roundId));
      } else {
        matches.push(...generateRoundRobinMatches(winners, tournamentId, roundId));
      }
    }

    // Insert all matches
    for (const match of matches) {
      await query(
        `INSERT INTO tournament_matches (id, tournament_id, round_id, player1_id, player2_id, match_status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [randomUUID(), match.tournament_id, match.round_id, match.player1_id, match.player2_id]
      );
    }

    return { matches, count: matches.length };
  } catch (error) {
    console.error('Error generating round matches:', error);
    throw error;
  }
}

/**
 * Generates first round matches
 * Shuffles participants and pairs them up
 * If odd number, the player with highest ELO advances automatically (bye)
 */
function generateFirstRoundMatches(
  participants: Participant[],
  tournamentId: string,
  roundId: string,
  tournamentMode: string = 'ranked',
  tournamentRoundMatches: any[] = []
): any[] {
  const matches = [];
  
  // Sort by ELO rating (descending) for consistency when handling byes
  const sorted = [...participants].sort((a, b) => (b.elo_rating || 0) - (a.elo_rating || 0));
  
  let playersToMatch = sorted;
  let byePlayer: any = null;
  
  // If odd number of participants, highest ELO gets a bye (automatic advancement)
  if (sorted.length % 2 === 1) {
    byePlayer = sorted[0]; // Highest ELO player gets bye
    playersToMatch = sorted.slice(1); // Exclude bye player from pairings
    console.log(`🎯 Odd number of participants (${sorted.length}). ${tournamentMode === 'team' ? 'Team' : 'Player'} ${byePlayer.user_id} (ELO: ${byePlayer.elo_rating}) advances automatically (BYE)`);
  }
  
  // Shuffle the remaining players for pairings
  const shuffled = playersToMatch.sort(() => Math.random() - 0.5);

  // Pair up participants
  for (let i = 0; i < shuffled.length - 1; i += 2) {
    // For team tournaments, shuffled[i].user_id contains the team_id
    // For 1v1 tournaments, shuffled[i].user_id contains the user_id
    // ARCHITECTURE NOTE (Option B): In team mode, player_id1/2 columns store team_id, not user_id
    // This is intentional and documented - it allows reusing existing match infrastructure
    matches.push({
      tournament_id: tournamentId,
      round_id: roundId,
      player1_id: shuffled[i].user_id,
      player2_id: shuffled[i + 1].user_id,
    });
  }

  // If there's a bye player, add them to the matches
  if (byePlayer) {
    matches.push({
      tournament_id: tournamentId,
      round_id: roundId,
      player1_id: byePlayer.user_id,
      player2_id: null, // Null indicates bye/automatic advancement
      is_bye: true,
    });
  }

  return matches;
}

/**
 * Generates elimination bracket matches
 * If odd number of remaining players, highest ELO advances automatically (bye)
 * For team mode: player_id1/2 contain team_id (Option B architecture)
 */
function generateEliminationMatches(
  winners: any[],
  tournamentId: string,
  roundId: string,
  tournamentMode: string = 'ranked',
  useSeeding: boolean = false
): any[] {
  const matches = [];
  
  // For Swiss-Elimination final rounds or when explicitly requested, use proper seeding (1v4, 2v3, etc)
  // Otherwise use random shuffling (for pure elimination tournaments from previous round winners)
  let pairedPlayers: any[];
  
  if (useSeeding && winners.length > 2) {
    // Proper seeding for elimination brackets: 1 vs (n), 2 vs (n-1), etc
    console.log(`[SEEDING] Using Swiss-based seeding for elimination bracket with ${winners.length} participants`);
    
    let playersToMatch = winners;
    let byePlayer: any = null;
    
    // If odd number, highest seed (first in list) gets bye
    if (winners.length % 2 === 1) {
      byePlayer = winners[0]; // Top seed advances with bye
      playersToMatch = winners.slice(1); // Exclude bye player from pairings
      console.log(`🏆 Elimination round with odd players (${winners.length}). ${tournamentMode === 'team' ? 'Team' : 'Player'} ${byePlayer.user_id} (Seed 1) advances automatically (BYE)`);
    }
    
    // Pair seeds: 1 vs n, 2 vs (n-1), etc (from remaining players)
    for (let i = 0; i < Math.floor(playersToMatch.length / 2); i++) {
      const seed1Index = i;
      const seed2Index = playersToMatch.length - 1 - i;
      console.log(`[SEEDING] Match ${i + 1}: Seed ${i + 1} (${playersToMatch[seed1Index].user_id}) vs Seed ${playersToMatch.length - i} (${playersToMatch[seed2Index].user_id})`);
      
      matches.push({
        tournament_id: tournamentId,
        round_id: roundId,
        player1_id: playersToMatch[seed1Index].user_id,
        player2_id: playersToMatch[seed2Index].user_id,
      });
    }
    
    // If there's a bye player, add them to the matches
    if (byePlayer) {
      matches.push({
        tournament_id: tournamentId,
        round_id: roundId,
        player1_id: byePlayer.user_id,
        player2_id: null, // Null indicates bye
        is_bye: true,
      });
    }
  } else {
    // Random shuffling for pure elimination tournaments
    // Sort by ELO rating (descending) to identify bye candidate
    const sorted = [...winners].sort((a, b) => (b.elo_rating || 0) - (a.elo_rating || 0));
    
    let playersToMatch = sorted;
    let byePlayer: any = null;
    
    // If odd number, highest ELO gets bye to next round
    if (sorted.length % 2 === 1) {
      byePlayer = sorted[0]; // Highest ELO among remaining
      playersToMatch = sorted.slice(1); // Exclude bye player from pairings
      console.log(`🏆 Elimination round with odd players (${sorted.length}). ${tournamentMode === 'team' ? 'Team' : 'Player'} ${byePlayer.user_id} (ELO: ${byePlayer.elo_rating}) advances automatically (BYE)`);
    }
    
    // Shuffle the remaining players for bracket arrangement
    const shuffled = playersToMatch.sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length - 1; i += 2) {
      // ARCHITECTURE NOTE (Option B): In team mode, player_id1/2 columns store team_id
      matches.push({
        tournament_id: tournamentId,
        round_id: roundId,
        player1_id: shuffled[i].user_id,
        player2_id: shuffled[i + 1].user_id,
      });
    }

    // If there's a bye player, add them to the matches
    if (byePlayer) {
      matches.push({
        tournament_id: tournamentId,
        round_id: roundId,
        player1_id: byePlayer.user_id,
        player2_id: null, // Null indicates bye
        is_bye: true,
      });
    }
  }

  return matches;
}

/**
 * Generates round-robin matches
 * Each player plays against each other player (limited to reasonable count)
 * For team mode: player_id1/2 contain team_id (Option B architecture)
 */
function generateRoundRobinMatches(
  participants: any[],
  tournamentId: string,
  roundId: string,
  tournamentMode: string = 'ranked'
): any[] {
  const matches = [];
  const maxMatches = 20; // Limit matches per round for practical reasons

  // Generate round-robin pairings, limited by maxMatches
  for (let i = 0; i < participants.length - 1 && matches.length < maxMatches; i++) {
    for (let j = i + 1; j < participants.length && matches.length < maxMatches; j++) {
      // ARCHITECTURE NOTE (Option B): In team mode, player_id1/2 columns store team_id
      matches.push({
        tournament_id: tournamentId,
        round_id: roundId,
        player1_id: participants[i].user_id,
        player2_id: participants[j].user_id,
      });
    }
  }

  return matches;
}

/**
 * Generates Swiss system matches
 * Pairs players based on their current score and tiebreakers (OMP, GWP, OGP)
 * Avoids re-pairings when possible
 * For team mode: player_id1/2 contain team_id (Option B architecture)
 */
async function generateSwissMatches(
  participants: any[],
  tournamentId: string,
  roundId: string,
  roundNumber: number,
  tournamentMode: string = 'ranked'
): Promise<any[]> {
  const matches: any[] = [];

  if (participants.length < 2) {
    return matches;
  }

  try {
    // Get player/team standings with scores and tiebreakers
    let standingsResult;
    
    if (tournamentMode === 'team') {
      // Team mode: get standings from tournament_teams (participants are team_ids)
      standingsResult = await query(
        `SELECT 
          tt.id as user_id,
          tt.tournament_wins,
          tt.tournament_losses,
          tt.team_elo as elo_rating,
          tt.omp,
          tt.gwp,
          tt.ogp
         FROM tournament_teams tt
         WHERE tt.tournament_id = ? AND tt.id = ANY(?)
         ORDER BY 
           (tt.tournament_wins - tt.tournament_losses) DESC,
           tt.omp DESC,
           tt.gwp DESC,
           tt.ogp DESC,
           tt.team_elo DESC`,
        [tournamentId, participants.map(p => p.user_id)]
      );
    } else {
      // 1v1 mode: get standings from tournament_participants (participants are user_ids)
      standingsResult = await query(
        `SELECT 
          tp.user_id,
          tp.tournament_wins,
          tp.tournament_losses,
          u.elo_rating,
          tp.omp,
          tp.gwp,
          tp.ogp
         FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.tournament_id = ? AND tp.user_id = ANY(?)
         ORDER BY 
           (tp.tournament_wins - tp.tournament_losses) DESC,
           tp.omp DESC,
           tp.gwp DESC,
           tp.ogp DESC,
           u.elo_rating DESC`,
        [tournamentId, participants.map(p => p.user_id)]
      );
    }

    const standings = standingsResult.rows;
    console.log(`\n🎲 [SWISS PAIRINGS] Round ${roundNumber}: ${standings.length} ${tournamentMode === 'team' ? 'teams' : 'players'}`);
    standings.forEach(p => {
      const score = (p.tournament_wins - p.tournament_losses);
      const label = tournamentMode === 'team' ? 'Team' : 'Player';
      console.log(`  ${label} ${p.user_id}: ${p.tournament_wins}-${p.tournament_losses} (OMP:${p.omp} GWP:${p.gwp} OGP:${p.ogp} ELO:${p.elo_rating})`);
    });

    // Group by score and sort within each group by tiebreakers
    const scoreGroups: { [key: string]: any[] } = {};
    standings.forEach(player => {
      const score = (player.tournament_wins - player.tournament_losses).toString();
      if (!scoreGroups[score]) {
        scoreGroups[score] = [];
      }
      scoreGroups[score].push(player);
    });

    // Sort players within each score group by tiebreakers (OMP, GWP, OGP, ELO)
    Object.keys(scoreGroups).forEach(score => {
      scoreGroups[score].sort((a, b) => {
        // Compare OMP (higher is better)
        if (a.omp !== b.omp) return (b.omp || 0) - (a.omp || 0);
        // Compare GWP (higher is better)
        if (a.gwp !== b.gwp) return (b.gwp || 0) - (a.gwp || 0);
        // Compare OGP (higher is better)
        if (a.ogp !== b.ogp) return (b.ogp || 0) - (a.ogp || 0);
        // Compare ELO (higher is better)
        return (b.elo_rating || 0) - (a.elo_rating || 0);
      });
    });

    console.log(`\n[SCORE GROUPS]:`);
    Object.keys(scoreGroups).sort((a, b) => parseInt(b) - parseInt(a)).forEach(score => {
      console.log(`  Score ${score}: ${scoreGroups[score].length} players`);
    });

    // Get history of pairings to avoid re-matches
    const pairingHistoryResult = await query(
      `SELECT DISTINCT 
        LEAST(player1_id, player2_id) as player_a,
        GREATEST(player1_id, player2_id) as player_b
       FROM tournament_round_matches
       WHERE tournament_id = ? AND player1_id IS NOT NULL AND player2_id IS NOT NULL`,
      [tournamentId]
    );

    const previousPairings = new Set(
      pairingHistoryResult.rows.map(row => `${row.player_a}|${row.player_b}`)
    );

    console.log(`\n[PREVIOUS PAIRINGS]: ${previousPairings.size} historical pairings found`);

    // PHASE 1: Pair within each score group, reserve best if odd
    const paired = new Set<string>();
    const unpairedByScore: { [score: string]: any[] } = {};
    const reservedByScore: { [score: string]: any } = {}; // Best player from each odd score group
    
    for (const score of Object.keys(scoreGroups).sort((a, b) => parseInt(b) - parseInt(a))) {
      const group = scoreGroups[score];
      console.log(`\n[PAIRING GROUP] Score ${score}:`);

      // Get available players in this group
      const available = group.filter(p => !paired.has(p.user_id));
      
      // If odd number of players, reserve the best one for bye (no pairing)
      let reservedForBye: any = null;
      let availableToMatch = available;
      
      if (available.length % 2 === 1 && available.length > 1) {
        // Odd group: reserve the best player (index 0, already sorted by tiebreakers DESC) for bye
        reservedForBye = available[0];
        availableToMatch = available.slice(1);
        reservedByScore[score] = reservedForBye;
        console.log(`  🔄 Odd group of ${available.length}: reserving best player ${reservedForBye.user_id} (ELO:${reservedForBye.elo_rating})`);
      } else if (available.length % 2 === 1 && available.length === 1) {
        // Single player in odd group, reserve it
        reservedForBye = available[0];
        reservedByScore[score] = reservedForBye;
        console.log(`  🔄 Single player group: reserving ${reservedForBye.user_id} (ELO:${reservedForBye.elo_rating})`);
      }
      
      // Pair as many as possible within this score group
      for (let i = 0; i < availableToMatch.length - 1; i++) {
        if (paired.has(availableToMatch[i].user_id)) continue;

        let paired_with = null;

        // Try to pair with next player without creating a re-match
        for (let j = i + 1; j < availableToMatch.length; j++) {
          if (paired.has(availableToMatch[j].user_id)) continue;

          const pairing_key = `${Math.min(availableToMatch[i].user_id, availableToMatch[j].user_id)}|${Math.max(availableToMatch[i].user_id, availableToMatch[j].user_id)}`;
          
          if (!previousPairings.has(pairing_key)) {
            paired_with = availableToMatch[j];
            console.log(`  ✅ Pair ${availableToMatch[i].user_id} vs ${availableToMatch[j].user_id} (new pairing)`);
            break;
          } else {
            console.log(`  ⚠️  Avoid ${availableToMatch[i].user_id} vs ${availableToMatch[j].user_id} (re-match)`);
          }
        }

        // If no new pairing found, use the first available (re-match necessary)
        if (!paired_with) {
          for (let j = i + 1; j < availableToMatch.length; j++) {
            if (!paired.has(availableToMatch[j].user_id)) {
              paired_with = availableToMatch[j];
              console.log(`  ⚠️  Pair ${availableToMatch[i].user_id} vs ${availableToMatch[j].user_id} (unavoidable re-match)`);
              break;
            }
          }
        }

        if (paired_with) {
          matches.push({
            tournament_id: tournamentId,
            round_id: roundId,
            player1_id: availableToMatch[i].user_id,
            player2_id: paired_with.user_id,
          });
          paired.add(availableToMatch[i].user_id);
          paired.add(paired_with.user_id);
        }
      }

      // Collect remaining unpaired from this score group (excluding reserved)
      const remainingUnpaired = availableToMatch.filter(p => !paired.has(p.user_id));
      if (remainingUnpaired.length > 0) {
        unpairedByScore[score] = remainingUnpaired;
        console.log(`  ⏸️  Unpaired in this group: ${remainingUnpaired.map(p => `${p.user_id}(ELO:${p.elo_rating})`).join(', ')}`);
      }
    }

    // PHASE 2: Try to pair unpaired players from different score groups (excluding reserved)
    console.log(`\n[CROSS-GROUP PAIRING] Attempting to pair unpaired players from different score groups...`);
    const scoreList = Object.keys(unpairedByScore).sort((a, b) => parseInt(b) - parseInt(a));
    
    for (let s = 0; s < scoreList.length - 1; s++) {
      const score1 = scoreList[s];
      const score2 = scoreList[s + 1];
      const group1 = unpairedByScore[score1].filter(p => !paired.has(p.user_id));
      const group2 = unpairedByScore[score2].filter(p => !paired.has(p.user_id));

      console.log(`  Trying Score ${score1} vs Score ${score2}: ${group1.length} vs ${group2.length} unpaired`);

      // Pair from score1 with score2
      for (const player1 of group1) {
        if (paired.has(player1.user_id)) continue;

        for (const player2 of group2) {
          if (paired.has(player2.user_id)) continue;

          const pairing_key = `${Math.min(player1.user_id, player2.user_id)}|${Math.max(player1.user_id, player2.user_id)}`;
          
          if (!previousPairings.has(pairing_key)) {
            console.log(`    ✅ Cross-pair ${player1.user_id}(Score ${score1}) vs ${player2.user_id}(Score ${score2}) (new pairing)`);
            matches.push({
              tournament_id: tournamentId,
              round_id: roundId,
              player1_id: player1.user_id,
              player2_id: player2.user_id,
            });
            paired.add(player1.user_id);
            paired.add(player2.user_id);
            break;
          }
        }
      }
    }

    // PHASE 3: Handle reserved players - if total reserved is odd, assign bye to best, pair rest
    const allReserved = Object.values(reservedByScore);
    console.log(`\n[RESERVED PLAYERS ANALYSIS] Total reserved: ${allReserved.length}`);
    
    if (allReserved.length > 0) {
      // Sort reserved players by tiebreakers (best first)
      const sortedReserved = [...allReserved].sort((a, b) => {
        if (a.omp !== b.omp) return (b.omp || 0) - (a.omp || 0);
        if (a.gwp !== b.gwp) return (b.gwp || 0) - (a.gwp || 0);
        if (a.ogp !== b.ogp) return (b.ogp || 0) - (a.ogp || 0);
        return (b.elo_rating || 0) - (a.elo_rating || 0);
      });

      if (allReserved.length % 2 === 1) {
        // Odd number of reserved: give bye to best, pair rest
        const byePlayer = sortedReserved[0];
        console.log(`\n✅ BYE (from reserved players): ${byePlayer.user_id} (${byePlayer.tournament_wins}-${byePlayer.tournament_losses}, ELO: ${byePlayer.elo_rating})`);
        matches.push({
          tournament_id: tournamentId,
          round_id: roundId,
          player1_id: byePlayer.user_id,
          player2_id: null,
          is_bye: true,
        });
        paired.add(byePlayer.user_id);

        // Pair the remaining reserved players
        const remainingReserved = sortedReserved.slice(1);
        for (let i = 0; i < remainingReserved.length - 1; i += 2) {
          matches.push({
            tournament_id: tournamentId,
            round_id: roundId,
            player1_id: remainingReserved[i].user_id,
            player2_id: remainingReserved[i + 1].user_id,
          });
          paired.add(remainingReserved[i].user_id);
          paired.add(remainingReserved[i + 1].user_id);
          console.log(`  ✅ Pair reserved: ${remainingReserved[i].user_id} vs ${remainingReserved[i + 1].user_id}`);
        }
      } else {
        // Even number of reserved: pair them all
        for (let i = 0; i < sortedReserved.length; i += 2) {
          matches.push({
            tournament_id: tournamentId,
            round_id: roundId,
            player1_id: sortedReserved[i].user_id,
            player2_id: sortedReserved[i + 1].user_id,
          });
          paired.add(sortedReserved[i].user_id);
          paired.add(sortedReserved[i + 1].user_id);
          console.log(`  ✅ Pair reserved: ${sortedReserved[i].user_id} vs ${sortedReserved[i + 1].user_id}`);
        }
      }
    }

    console.log(`\n[SWISS PAIRINGS RESULT] Generated ${matches.length} pairings`);
    return matches;
  } catch (error) {
    console.error('❌ Error in generateSwissMatches:', error);
    throw error;
  }
}

/**
 * Generates League matches using Berger (round-robin) algorithm
 * Ensures all participants play against all others exactly once per format
 * Works correctly for both even and odd participant counts
/**
 * Generates League matches using Berger algorithm for a specific round
 * Berger algorithm: Fixed participant at position 0, rotate all others clockwise
 * 
 * Algorithm: Circular rotation (Berger tables)
 * - For N participants: N rounds (with dummy bye for odd counts)
 * - One participant gets a bye each round (odd counts only)
 * - Deterministic: no random shuffle, mathematically complete
 * - All (N choose 2) pairings guaranteed exactly once
 */
function generateLeagueMatchesBerger(
  participants: any[],
  tournamentId: string,
  roundId: string,
  roundNumber: number,
  tournamentMode: string = 'ranked'
): any[] {
  const matches: any[] = [];

  if (participants.length < 2) {
    return matches;
  }

  const n = participants.length;
  const isOdd = n % 2 === 1;
  
  // Build a team list with original participants (with user_id property)
  // Always start fresh from participants, apply rotation based on roundNumber
  let teams = [...participants];
  let byePlayer: any = null;
  
  // If odd count, add a dummy bye marker at the end
  if (isOdd) {
    teams.push({ user_id: 'BYE', elo_rating: 0 });
  }
  
  const numTeams = teams.length;
  
  // BERGER ROTATION: Fix position 0, rotate all others right by (roundNumber - 1)
  // Round 1: no rotation (teams[0] fixed, teams[1..n-1] in original order)
  // Round 2: rotate teams[1..n-1] right by 1
  // Round 3: rotate teams[1..n-1] right by 2
  // etc.
  
  if (roundNumber > 1) {
    // Rotate the list (except position 0): teams[1..n-1] move right by (roundNumber-1) steps
    const fixedFirst = teams[0];
    const rest = teams.slice(1);
    const rotateBy = ((roundNumber - 1) % (numTeams - 1));
    
    // Right rotation: take last rotateBy items and move to front
    const rotated = [
      ...rest.slice(-rotateBy),
      ...rest.slice(0, -rotateBy)
    ];
    
    teams = [fixedFirst, ...rotated];
  }
  
  // Create pairings by mirroring positions
  // Position 0 pairs with position n-1, position 1 pairs with n-2, etc.
  for (let i = 0; i < numTeams / 2; i++) {
    const p1 = teams[i];
    const p2 = teams[numTeams - 1 - i];
    
    // Check if either is the bye marker
    if (p1.user_id === 'BYE') {
      byePlayer = p2;
    } else if (p2.user_id === 'BYE') {
      byePlayer = p1;
    } else {
      // Regular match
      matches.push({
        tournament_id: tournamentId,
        round_id: roundId,
        player1_id: p1.user_id,
        player2_id: p2.user_id,
      });
    }
  }
  
  // Add bye match if odd count
  if (isOdd && byePlayer) {
    matches.push({
      tournament_id: tournamentId,
      round_id: roundId,
      player1_id: byePlayer.user_id,
      player2_id: null,
      is_bye: true,
    });
    console.log(`🎯 League Round ${roundNumber}: ${tournamentMode === 'team' ? 'Team' : 'Player'} ${byePlayer.user_id} (ELO: ${byePlayer.elo_rating}) advances automatically (BYE)`);
  }

  return matches;
}

/**
 * Pre-generates ALL league tournament matches for ALL rounds at tournament preparation time
 * This ensures complete Berger schedule is created upfront, not on-demand per round
 * 
 * For league tournaments:
 * - Fetches all tournament rounds
 * - Fetches all participants
 * - For each round, generates Berger-scheduled matches
 * - Inserts all matches into tournament_round_matches table
 */
export async function preGenerateLeagueMatches(
  tournamentId: string
): Promise<boolean> {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 [PRE_GENERATE] Starting pre-generation of all league matches`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Tournament ID: ${tournamentId}`);

    // Get tournament info
    const tournResult = await query(
      `SELECT tournament_type, tournament_mode FROM tournaments WHERE id = ?`,
      [tournamentId]
    );
    
    if (tournResult.rows.length === 0) {
      throw new Error(`Tournament ${tournamentId} not found`);
    }

    const tournament = tournResult.rows[0];
    if (tournament.tournament_type !== 'league') {
      console.log(`[PRE_GENERATE] Not a league tournament, skipping pre-generation`);
      return true;
    }

    const tournamentMode = tournament.tournament_mode;
    console.log(`Tournament Mode: ${tournamentMode}`);

    // Get all rounds (including format)
    const roundsResult = await query(
      `SELECT id, round_number, match_format FROM tournament_rounds WHERE tournament_id = ? ORDER BY round_number ASC`,
      [tournamentId]
    );
    
    const rounds = roundsResult.rows;
    console.log(`Found ${rounds.length} rounds to generate matches for`);

    if (rounds.length === 0) {
      throw new Error(`No rounds found for tournament ${tournamentId}`);
    }

    // Get all participants (sorted by user_id for consistency)
    let participantsResult;
    if (tournamentMode === 'team') {
      participantsResult = await query(
        `SELECT id as user_id, 0 as elo_rating FROM tournament_teams WHERE tournament_id = ? ORDER BY id ASC`,
        [tournamentId]
      );
    } else {
      participantsResult = await query(
        `SELECT tp.user_id, COALESCE(u.elo_rating, 1600) as elo_rating
         FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'
         ORDER BY tp.user_id ASC`,
        [tournamentId]
      );
    }

    const participants = participantsResult.rows;
    console.log(`Found ${participants.length} participants`);

    if (participants.length < 2) {
      throw new Error(`Not enough participants (${participants.length}) for league tournament`);
    }

    // Map format strings to best_of values
    const formatMap: { [key: string]: number } = {
      'bo1': 1,
      'bo3': 3,
      'bo5': 5,
      'bo7': 7,
    };

    // Pre-generate matches for all rounds
    let totalMatchesCreated = 0;
    for (const round of rounds) {
      const roundNumber = round.round_number;
      console.log(`\n[PRE_GENERATE] Generating matches for Round ${roundNumber}...`);

      // Generate Berger matches for this specific round
      const matches = generateLeagueMatchesBerger(
        participants,
        tournamentId,
        round.id,
        roundNumber,
        tournamentMode
      );

      console.log(`[PRE_GENERATE] Generated ${matches.length} pairings for Round ${roundNumber}`);

      // Insert all matches for this round
      const bestOf = formatMap[round.match_format] || 3;
      const winsRequired = Math.ceil(bestOf / 2);
      
      for (const match of matches) {
        const roundMatchId = randomUUID();
        
        // Skip insertion for bye matches (player2_id is null)
        if (match.player2_id !== null) {
          // Insert into tournament_round_matches
          await query(
            `INSERT INTO tournament_round_matches (id, tournament_id, round_id, player1_id, player2_id, best_of, wins_required, series_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress')`,
            [
              roundMatchId,
              match.tournament_id,
              match.round_id,
              match.player1_id,
              match.player2_id,
              bestOf,
              winsRequired
            ]
          );

          // Insert individual tournament_matches (one per needed win)
          for (let i = 0; i < winsRequired; i++) {
            await query(
              `INSERT INTO tournament_matches (id, tournament_id, round_id, player1_id, player2_id, match_status, tournament_round_match_id)
               VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
              [
                randomUUID(),
                match.tournament_id,
                match.round_id,
                match.player1_id,
                match.player2_id,
                roundMatchId
              ]
            );
          }
        }
      }

      totalMatchesCreated += matches.length;
    }

    console.log(`\n[PRE_GENERATE] ✅ Created ${totalMatchesCreated} total round-matches across all rounds`);
    console.log(`${'='.repeat(80)}\n`);
    return true;

  } catch (error) {
    console.error(`❌ Error in preGenerateLeagueMatches:`, error);
    throw error;
  }
}

/**
 * Generates League matches
 * All participants play each round, new pairings each time
 */
function generateLeagueMatches(
  participants: any[],
  tournamentId: string,
  roundId: string,
  tournamentMode: string = 'ranked'
): any[] {
  const matches: any[] = [];

  if (participants.length < 2) {
    return matches;
  }

  // Sort by ELO rating (descending) to identify bye candidate
  const sorted = [...participants].sort((a, b) => (b.elo_rating || 0) - (a.elo_rating || 0));
  
  let playersToMatch = sorted;
  let byePlayer: any = null;
  
  // If odd number, highest ELO gets bye
  if (sorted.length % 2 === 1) {
    byePlayer = sorted[0];
    playersToMatch = sorted.slice(1); // Exclude bye player from pairings
    console.log(`🎯 League Round: ${tournamentMode === 'team' ? 'Team' : 'Player'} ${byePlayer.user_id} (ELO: ${byePlayer.elo_rating}) advances automatically (BYE)`);
  }
  
  // Shuffle the remaining players for pairings
  const shuffled = playersToMatch.sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < shuffled.length - 1; i += 2) {
    // ARCHITECTURE NOTE (Option B): In team mode, player_id1/2 columns store team_id
    matches.push({
      tournament_id: tournamentId,
      round_id: roundId,
      player1_id: shuffled[i].user_id,
      player2_id: shuffled[i + 1].user_id,
    });
  }

  // If there's a bye player, add them to the matches
  if (byePlayer) {
    matches.push({
      tournament_id: tournamentId,
      round_id: roundId,
      player1_id: byePlayer.user_id,
      player2_id: null,
      is_bye: true,
    });
  }

  return matches;
}

/**
 * Activates a round and generates its matches (for first time only)
 */
export async function activateRound(tournamentId: string, roundNumber: number): Promise<boolean> {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎯 [ACTIVATE_ROUND] Starting activation for tournament=${tournamentId}, round_number=${roundNumber}`);
    console.log(`${'='.repeat(80)}`);
    
    // Get the round with format info
    const roundResult = await query(
      `SELECT tr.id, tr.round_status, tr.tournament_id, t.tournament_type, t.total_rounds,
              CASE 
                -- For pure elimination: use general_rounds_format for all except final round
                WHEN t.tournament_type = 'elimination' 
                THEN CASE 
                  WHEN tr.round_number = t.total_rounds THEN t.final_rounds_format
                  ELSE t.general_rounds_format
                END
                -- For swiss_elimination: use general_rounds_format for Swiss phase, final_rounds_format only for grand final
                WHEN t.tournament_type = 'swiss_elimination' 
                THEN CASE
                  WHEN tr.round_number <= t.general_rounds THEN t.general_rounds_format
                  WHEN tr.round_number = t.total_rounds THEN t.final_rounds_format
                  ELSE t.general_rounds_format
                END
                -- For other types: use the logic based on general/final rounds
                WHEN tr.round_number <= t.general_rounds 
                THEN t.general_rounds_format 
                ELSE t.final_rounds_format 
              END as round_format
       FROM tournament_rounds tr
       JOIN tournaments t ON tr.tournament_id = t.id
       WHERE tr.tournament_id = ? AND tr.round_number = ?`,
      [tournamentId, roundNumber]
    );

    if (roundResult.rows.length === 0) {
      throw new Error('Round not found');
    }

    const round = roundResult.rows[0];
    console.log(`[ACTIVATE_ROUND] Round found: status=${round.round_status}, format=${round.round_format}`);

    if (round.round_status !== 'pending') {
      console.warn(`Round ${roundNumber} is already ${round.round_status}`);
      return false;
    }

    // Get tournament info (including tournament_mode for team tournament handling)
    const tournamentResult = await query(
      `SELECT tournament_type, tournament_mode FROM tournaments WHERE id = ?`,
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      throw new Error('Tournament not found');
    }

    const tournament = tournamentResult.rows[0];

    // Check if this is transitioning from Swiss to Elimination phase
    if (roundNumber > 1) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔄 [ACTIVATE_ROUND] Checking for Swiss→Elimination transition`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Tournament ID: ${tournamentId}`);
      console.log(`Round Number: ${roundNumber}`);
      console.log(`Tournament Type: ${tournament.tournament_type}`);
      
      const tournamentType = tournament.tournament_type?.toLowerCase() || 'elimination';
      const roundTypeResult = await query(
        `SELECT round_type FROM tournament_rounds WHERE id = ?`,
        [round.id]
      );
      const roundType = roundTypeResult.rows[0]?.round_type?.toLowerCase() || 'general';
      
      console.log(`Round Type from DB: ${roundTypeResult.rows[0]?.round_type}`);
      console.log(`Round Type (lowercase): ${roundType}`);
      console.log(`Is elimination phase? ${roundType !== 'general'}`);
      
      // If we're activating the first elimination round in a swiss_elimination tournament,
      // we need to select players if not already done
      if (tournamentType === 'swiss_elimination' && roundType !== 'general') {
        console.log(`\n✅ [ACTIVATE_ROUND] Detected Swiss-Elimination Mix entering elimination phase`);
        
        const tournamentInfo = await query(
          `SELECT general_rounds, final_rounds FROM tournaments WHERE id = ?`,
          [tournamentId]
        );
        const { general_rounds, final_rounds } = tournamentInfo.rows[0];
        
        console.log(`General Rounds (Swiss phase): ${general_rounds}`);
        console.log(`Final Rounds (Elimination phase): ${final_rounds}`);
        console.log(`Players to advance: ${Math.pow(2, final_rounds)}`);
        
        // Check if players have already been selected (should have at least some eliminated)
        console.log(`\n[DEBUG] About to query eliminated players...`);
        const eliminatedCount = await query(
          `SELECT COUNT(*) as count FROM tournament_participants 
           WHERE tournament_id = ? AND status = 'eliminated'`,
          [tournamentId]
        );
        
        const elimCount = parseInt(eliminatedCount.rows[0].count);
        console.log(`[DEBUG] elimCount = ${elimCount}, type: ${typeof elimCount}`);
        console.log(`Currently eliminated players: ${elimCount}`);
        
        // If no players are eliminated yet, run the selection
        console.log(`[DEBUG] Checking condition: elimCount === 0? ${elimCount === 0}`);
        if (elimCount === 0) {
          console.log(`\n⚠️  [ACTIVATE_ROUND] No eliminated players detected. Running selectPlayersForEliminationPhase()...`);
          const selectionResult = await selectPlayersForEliminationPhase(tournamentId, final_rounds);
          console.log(`✅ [ACTIVATE_ROUND] selectPlayersForEliminationPhase() completed with result: ${selectionResult}`);
        } else {
          console.log(`\n⏭️  [ACTIVATE_ROUND] Already have ${elimCount} eliminated players, skipping selection`);
        }
      } else {
        console.log(`\n⏭️  [ACTIVATE_ROUND] NOT a Swiss-Elimination transition. Conditions:`, {
          isSWISSEL: tournamentType === 'swiss_elimination',
          isELIM: roundType !== 'general'
        });
      }
    }

    // Get accepted participants for first round, or based on tournament type for subsequent rounds
    let participants;
    const isteamMode = tournament.tournament_mode === 'team';
    
    if (roundNumber === 1) {
      if (isteamMode) {
        // Team tournament: get teams instead of individual players
        // ARCHITECTURE NOTE (Option B): We'll use team.id as if it were user_id for pairing functions
        // The team_id will be stored in player_id1/2 columns of tournament_matches
        const teamsResult = await query(
          `SELECT tt.id as user_id, tt.team_elo as elo_rating
           FROM tournament_teams tt
           WHERE tt.tournament_id = ? AND tt.status = 'active'`,
          [tournamentId]
        );
        participants = teamsResult.rows;
        console.log(`[ACTIVATE_ROUND] Team mode: ${participants.length} teams for first round`);
      } else {
        // 1v1 tournament: get individual players
        const participantsResult = await query(
          `SELECT tp.id, tp.user_id, u.elo_rating
           FROM tournament_participants tp
           LEFT JOIN users_extension u ON tp.user_id = u.id
           WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'`,
          [tournamentId]
        );
        participants = participantsResult.rows;
      }
    } else {
      // For subsequent rounds, behavior depends on tournament type AND round type
      const tournamentType = tournament.tournament_type?.toLowerCase() || 'elimination';
      
      // Get the round type - must query it since it wasn't in the initial round fetch
      const roundTypeResult = await query(
        `SELECT round_type FROM tournament_rounds WHERE id = ?`,
        [round.id]
      );
      const roundType = roundTypeResult.rows[0]?.round_type?.toLowerCase() || 'general';
      
      console.log(`\n[GET_PARTICIPANTS] Round Type check: "${roundType}" (not 'general'? ${roundType !== 'general'})`);
      
      if (isteamMode) {
        // Team tournament: subsequent rounds
        if (tournamentType === 'elimination') {
          // Team elimination: only get active teams, ordered by ranking
          const teamsResult = await query(
            `SELECT tt.id as user_id, tt.team_elo as elo_rating, tt.tournament_ranking
             FROM tournament_teams tt
             WHERE tt.tournament_id = ? AND tt.status = 'active'
             ORDER BY tt.tournament_ranking ASC`,
            [tournamentId]
          );
          participants = teamsResult.rows;
          console.log(`[GET_PARTICIPANTS] Team mode elimination: ${participants.length} active teams (ordered by ranking)`);
        } else {
          // Team swiss/league: all active teams, ordered by ranking
          const teamsResult = await query(
            `SELECT tt.id as user_id, tt.team_elo as elo_rating, tt.tournament_ranking
             FROM tournament_teams tt
             WHERE tt.tournament_id = ? AND tt.status = 'active'
             ORDER BY tt.tournament_ranking ASC`,
            [tournamentId]
          );
          participants = teamsResult.rows;
          console.log(`[GET_PARTICIPANTS] Team mode swiss/league: ${participants.length} active teams (ordered by ranking)`);
        }
      } else if (tournamentType === 'elimination') {
        // 1v1 Elimination: only get non-eliminated participants (status = 'active')
        const participantsResult = await query(
          `SELECT tp.id, tp.user_id, u.elo_rating
           FROM tournament_participants tp
           LEFT JOIN users_extension u ON tp.user_id = u.id
           WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted' AND status = 'active'`,
          [tournamentId]
        );
        participants = participantsResult.rows;
        console.log(`[GET_PARTICIPANTS] Elimination round: ${participants.length} active participants`);
      } else if (tournamentType === 'swiss_elimination' && roundType !== 'general') {
        // Swiss-Elimination Mix in elimination rounds (not Swiss): only get non-eliminated participants (status = 'active')
        // IMPORTANT: Sort by Swiss ranking (tournament_points, wins, tiebreakers) to ensure proper seeding
        console.log(`[GET_PARTICIPANTS] Swiss-Elimination Mix - ELIMINATION PHASE (roundType="${roundType}")`);
        const participantsResult = await query(
          `SELECT tp.id, tp.user_id, u.elo_rating, tp.tournament_points, tp.tournament_wins, tp.omp, tp.gwp, tp.ogp
           FROM tournament_participants tp
           LEFT JOIN users_extension u ON tp.user_id = u.id
           WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted' AND status = 'active'
           ORDER BY tp.tournament_points DESC, tp.tournament_wins DESC, tp.omp DESC, tp.gwp DESC, tp.ogp DESC, u.elo_rating DESC, tp.user_id`,
          [tournamentId]
        );
        participants = participantsResult.rows;
        console.log(`[GET_PARTICIPANTS] Found ${participants.length} active participants for elimination round`);
        console.log(`[GET_PARTICIPANTS] Players (by ranking): ${participants.map(p => p.user_id).join(', ')}`);
      } else {
        // 1v1 Swiss, League, Swiss-Elimination (general rounds): all accepted participants continue
        console.log(`[GET_PARTICIPANTS] Swiss/League round (tournamentType="${tournamentType}", roundType="${roundType}")`);
        const participantsResult = await query(
          `SELECT tp.id, tp.user_id, u.elo_rating
           FROM tournament_participants tp
           LEFT JOIN users_extension u ON tp.user_id = u.id
           WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'`,
          [tournamentId]
        );
        participants = participantsResult.rows;
        console.log(`[GET_PARTICIPANTS] Swiss/League round: ${participants.length} total participants`);
      }
    }

    if (participants.length === 0) {
      const errorMsg = `No participants available for round ${roundNumber}`;
      console.error(`[ACTIVATE_ROUND] ERROR: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Determine best_of format from round_format (bo1, bo3, bo5)
    const bestOfMap: { [key: string]: 1 | 3 | 5 } = {
      'bo1': 1,
      'bo3': 3,
      'bo5': 5
    };
    const bestOf = bestOfMap[round.round_format] || 3;
    const winsRequired = Math.ceil(bestOf / 2);

    console.log(`[ACTIVATE_ROUND] Retrieved ${participants.length} participants for round ${roundNumber}`);
    console.log(`[ACTIVATE_ROUND] Best Of format: ${bestOf} (wins required: ${winsRequired})`);

    const tournamentType = tournament.tournament_type?.toLowerCase() || 'elimination';

    // For league tournaments, all matches are pre-generated during tournament preparation
    // Just change the status to in_progress
    if (tournamentType === 'league') {
      console.log(`[ACTIVATE_ROUND] League tournament: skipping match generation (pre-generated during preparation)`);
      console.log(`[ACTIVATE_ROUND] Simply marking round as in_progress...`);
    } else {
      // Non-league tournaments: generate matches on-demand

      // Generate pairings based on round number and tournament type
          let pairings;
          if (roundNumber === 1) {
            // First round: pair all participants
            pairings = generateFirstRoundMatches(participants, tournamentId, round.id, tournament.tournament_mode);
          } else {
            // Subsequent rounds: depends on tournament type AND round type
            const tournamentType = tournament.tournament_type?.toLowerCase() || 'elimination';
      
            // Get the round type to determine if we're in final phase
            const roundTypeResult = await query(
              `SELECT round_type FROM tournament_rounds WHERE id = ?`,
              [round.id]
            );
            const roundType = roundTypeResult.rows[0]?.round_type?.toLowerCase() || 'general';
      
            console.log(`\n[GENERATE_PAIRINGS] Round ${roundNumber}:`);
            console.log(`  Tournament Type: ${tournamentType}`);
            console.log(`  Round Type: ${roundType}`);
            console.log(`  Participants: ${participants.length}`);
      
            if (tournamentType === 'elimination') {
              // Elimination: pair winners from previous round
              console.log(`  → Using ELIMINATION pairings`);
              pairings = generateEliminationMatches(participants, tournamentId, round.id, tournament.tournament_mode);
            } else if (tournamentType === 'swiss_elimination' && roundType !== 'general') {
              // Swiss-Elimination Mix in final phase (not Swiss): use elimination pairings with Swiss seeding
              console.log(`  → Using ELIMINATION pairings with Swiss seeding (Swiss-Elimination final phase)`);
              pairings = generateEliminationMatches(participants, tournamentId, round.id, tournament.tournament_mode, true);
            } else if (tournamentType === 'swiss' || tournamentType === 'swiss_elimination') {
              // Swiss: use Swiss pairing system for all participants still in tournament
              console.log(`  → Using SWISS pairings`);
              pairings = await generateSwissMatches(participants, tournamentId, round.id, roundNumber, tournament.tournament_mode);
            } else {
              // League: all participants play each other using Berger algorithm
              console.log(`  → Using LEAGUE pairings (Berger round-robin algorithm)`);
              pairings = generateLeagueMatchesBerger(participants, tournamentId, round.id, roundNumber, tournament.tournament_mode);
            }
      
            console.log(`  Generated ${pairings.length} total pairings`);
            const byeCount = pairings.filter(p => p.is_bye || p.player2_id === null).length;
            const matchCount = pairings.length - byeCount;
            console.log(`  → ${matchCount} actual matches, ${byeCount} byes`);
          }

          console.log(`[ACTIVATE_ROUND] Processing ${pairings.length} pairings...`);
          let matchesCreated = 0;
          let byesProcessed = 0;

          for (const pairing of pairings) {
           // Handle bye (automatic advancement for odd player count)
            if (pairing.is_bye || pairing.player2_id === null) {
              console.log(`✅ BYE: ${tournament.tournament_mode === 'team' ? 'Team' : 'Player'} ${pairing.player1_id} advances automatically to next round`);
              byesProcessed++;
        
              // In League tournaments, byes don't award points (all teams play same number of matches)
              // In Swiss/Swiss-Elimination, byes award 1 point (automatic win)
              const tournamentType = tournament.tournament_type?.toLowerCase() || 'elimination';
              const shouldAwardPointsForBye = tournamentType !== 'league';
        
              // Register automatic win for bye player (unless it's a league tournament)
              if (shouldAwardPointsForBye) {
                if (isteamMode) {
                  await query(
                    `UPDATE tournament_teams 
                     SET tournament_wins = COALESCE(tournament_wins, 0) + 1,
                         tournament_points = COALESCE(tournament_points, 0) + 1
                     WHERE tournament_id = ? AND id = ?`,
                    [tournamentId, pairing.player1_id]
                  );
                  console.log(`  → Team ${pairing.player1_id}: +1 win, +1 point`);
                } else {
                  await query(
                    `UPDATE tournament_participants 
                     SET tournament_wins = COALESCE(tournament_wins, 0) + 1,
                         tournament_points = COALESCE(tournament_points, 0) + 1
                     WHERE tournament_id = ? AND user_id = ?`,
                    [tournamentId, pairing.player1_id]
                  );
                  console.log(`  → Player ${pairing.player1_id}: +1 win, +1 point`);
                }
              } else {
                console.log(`  → League tournament: No automatic points awarded for bye`);
              }
              continue;
            }

            // Create tournament_round_matches entry
            const roundMatchId = randomUUID();
            await query(
              `INSERT INTO tournament_round_matches 
               (id, tournament_id, round_id, player1_id, player2_id, best_of, wins_required, series_status, matches_scheduled)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?)`,
              [roundMatchId, tournamentId, round.id, pairing.player1_id, pairing.player2_id, bestOf, winsRequired, winsRequired]
            );

            // Create initial tournament_matches entries (exactly wins_required matches)
            // For Bo3: 2 matches (need 2 wins), for Bo5: 3 matches (need 3 wins)
            const matchesToCreate = winsRequired;
            for (let i = 0; i < matchesToCreate; i++) {
              await query(
                `INSERT INTO tournament_matches 
                 (id, tournament_id, round_id, player1_id, player2_id, match_status, tournament_round_match_id)
                 VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
                [randomUUID(), tournamentId, round.id, pairing.player1_id, pairing.player2_id, roundMatchId]
              );
            }

            console.log(`Created ${matchesToCreate} initial matches for round_match ${roundMatchId} (Bo${bestOf}, needs ${winsRequired} wins)`);
            matchesCreated++;
          }

          console.log(`[ACTIVATE_ROUND] Summary: Created ${matchesCreated} series, ${byesProcessed} byes`);
    }

    // Update round status to in_progress
    await query(
      `UPDATE tournament_rounds 
       SET round_status = 'in_progress', round_start_date = NOW()
       WHERE id = ?`,
      [round.id]
    );

    // Update current_round and recalculate rankings based on tournament mode
    if (isteamMode) {
      await updateTeamCurrentRound(tournamentId, roundNumber);
      await recalculateTeamRankingsForTournament(tournamentId);
    } else {
      // 1v1 mode
      await updateParticipantCurrentRound(tournamentId, roundNumber);
      await recalculateParticipantRankings(tournamentId);
    }

    // Summary logged in else block for non-league, league tournaments skip match generation
    if (tournamentType !== 'league') {
      console.log(`✅ [ACTIVATE_ROUND] Round ${roundNumber} successfully activated, best_of: ${bestOf}`);
    } else {
      console.log(`✅ [ACTIVATE_ROUND] League Round ${roundNumber} marked as in_progress (matches pre-generated), best_of: ${bestOf}`);
    }
    return true;
  } catch (error) {
    console.error('Error activating round:', error);
    throw error;
  }
}

/**
 * Checks if a round is complete (all matches have winners)
 */
export async function isRoundComplete(roundId: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT COUNT(*) as total, 
              SUM(CASE WHEN winner_id IS NOT NULL THEN 1 ELSE 0 END) as completed
       FROM tournament_matches 
       WHERE round_id = ?`,
      [roundId]
    );

    const { total, completed } = result.rows[0];
    return total > 0 && total === completed;
  } catch (error) {
    console.error('Error checking round completion:', error);
    return false;
  }
}

/**
 * Marks a round as complete and advances to next round
 */
export async function completeRound(roundId: string, tournamentId: string): Promise<void> {
  try {
    // Get current round number
    const roundResult = await query(
      `SELECT round_number FROM tournament_rounds WHERE id = ?`,
      [roundId]
    );

    if (roundResult.rows.length === 0) {
      throw new Error('Round not found');
    }

    const currentRoundNumber = roundResult.rows[0].round_number;

    // Update current round status
    await query(
      `UPDATE tournament_rounds 
       SET round_status = 'completed', round_end_date = NOW()
       WHERE id = ?`,
      [roundId]
    );

    // Check if there are more rounds
    const nextRoundResult = await query(
      `SELECT id FROM tournament_rounds 
       WHERE tournament_id = ? AND round_number = ?`,
      [tournamentId, currentRoundNumber + 1]
    );

    if (nextRoundResult.rows.length > 0) {
      // Activate next round automatically if auto_advance_round is true
      const tournamentResult = await query(
        `SELECT auto_advance_round FROM tournaments WHERE id = ?`,
        [tournamentId]
      );

      if (tournamentResult.rows[0].auto_advance_round) {
        await activateRound(tournamentId, currentRoundNumber + 1);
      }
    } else {
      // No more rounds, tournament is finished
      await query(
        `UPDATE tournaments SET status = 'finished', finished_at = NOW() WHERE id = ?`,
        [tournamentId]
      );

      // Notify Discord of tournament finish
      try {
        const tournamentResult = await query(
          `SELECT name, discord_thread_id FROM tournaments WHERE id = ?`,
          [tournamentId]
        );

        if (tournamentResult.rows.length > 0 && tournamentResult.rows[0].discord_thread_id) {
          // Get winner and runner-up based on tournament type
          const { winner, runnerUp } = await getWinnerAndRunnerUp(tournamentId);

          if (winner) {
            await discordService.postTournamentFinished(
              tournamentResult.rows[0].discord_thread_id,
              tournamentResult.rows[0].name,
              winner.nickname || 'Unknown',
              runnerUp ? runnerUp.nickname : 'N/A'
            );
          }
        }
      } catch (discordErr) {
        console.error('Discord tournament finished notification error:', discordErr);
        // Don't fail the tournament completion if Discord fails
      }
    }
  } catch (error) {
    console.error('Error completing round:', error);
    throw error;
  }
}

/**
 * Check if a round is complete (all matches are done with winners)
 * If complete, mark the round as 'completed' and set round_end_date
 * Also creates any missing matches in incomplete series
 */
export async function checkAndCompleteRound(tournamentId: string, roundNumber: number): Promise<boolean> {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 [CHECK_COMPLETE_ROUND] Checking if Round ${roundNumber} is complete`);
    console.log(`   Tournament: ${tournamentId}`);
    console.log(`${'='.repeat(80)}`);
    
    // Get all matches in this round
    const roundInfo = await query(
      `SELECT id FROM tournament_rounds 
       WHERE tournament_id = ? AND round_number = ?`,
      [tournamentId, roundNumber]
    );

    if (roundInfo.rows.length === 0) {
      console.log(`❌ No round found`);
      return false;
    }

    const roundId = roundInfo.rows[0].id;

    // Get all round matches (Best Of series pairings) and their status
    const matchesResult = await query(
      `SELECT 
        trm.id, 
        trm.series_status, 
        trm.winner_id,
        trm.player1_id,
        trm.player2_id,
        trm.player1_wins,
        trm.player2_wins,
        trm.wins_required,
        trm.best_of,
        (SELECT COUNT(*) FROM tournament_matches tm WHERE tm.tournament_round_match_id = trm.id AND tm.match_status != 'completed') as pending_matches
       FROM tournament_round_matches trm
       WHERE trm.round_id = ?`,
      [roundId]
    );

    if (matchesResult.rows.length === 0) {
      return false;
    }

    // First, check if there are any incomplete series without pending matches
    // and create missing matches if needed
    for (const match of matchesResult.rows) {
      if (match.series_status === 'in_progress' && parseInt(match.pending_matches) === 0) {
        // Series is incomplete but has no pending matches
        // Check if more matches need to be created
        const totalMatchesPlayed = match.player1_wins + match.player2_wins;
        const maxMatches = match.best_of;
        
        if (totalMatchesPlayed < maxMatches && 
            match.player1_wins < match.wins_required && 
            match.player2_wins < match.wins_required) {
          // Create the next match
          console.log(`Creating missing match for series ${match.id}: current score ${match.player1_wins}-${match.player2_wins}, best_of=${match.best_of}`);
          
          await query(
            `INSERT INTO tournament_matches 
             (id, tournament_id, round_id, player1_id, player2_id, match_status, tournament_round_match_id)
             VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
            [randomUUID(), tournamentId, roundId, match.player1_id, match.player2_id, match.id]
          );
        }
      }
    }

    // Re-fetch matches after potentially creating new ones
    const updatedMatchesResult = await query(
      `SELECT 
        trm.id, 
        trm.series_status, 
        trm.winner_id,
        (SELECT COUNT(*) FROM tournament_matches tm WHERE tm.tournament_round_match_id = trm.id AND tm.match_status != 'completed') as pending_matches
       FROM tournament_round_matches trm
       WHERE trm.round_id = ?`,
      [roundId]
    );

    // Check conditions for round completion:
    // 1. ALL series must be completed (series_status = 'completed')
    // 2. Each series must have a winner (winner_id IS NOT NULL)
    // 3. NO pending matches in any series (all tournament_matches must be completed or not exist)
    console.log(`🔍 [CHECK_COMPLETE_ROUND] Checking ${updatedMatchesResult.rows.length} matches:`);
    const allComplete = updatedMatchesResult.rows.every((match: any) => {
      const seriesComplete = match.series_status === 'completed';
      const hasWinner = match.winner_id !== null;
      const noPendingMatches = parseInt(match.pending_matches) === 0;
      console.log(`   Match ${match.id}: series=${seriesComplete}, winner=${hasWinner}, noPending=${noPendingMatches} → ${seriesComplete && hasWinner && noPendingMatches ? '✅' : '❌'}`);
      
      return seriesComplete && hasWinner && noPendingMatches;
    });

    if (allComplete) {
      // Mark round as completed
      await query(
        `UPDATE tournament_rounds 
         SET round_status = 'completed', round_end_date = NOW()
         WHERE id = ?`,
        [roundId]
      );
      console.log(`✅ Round ${roundNumber} marked as completed for tournament ${tournamentId}`);

      // Get tournament mode to recalculate rankings appropriately
      const modeResult = await query(
        `SELECT tournament_mode FROM tournaments WHERE id = ?`,
        [tournamentId]
      );
      const tournMode = modeResult.rows[0]?.tournament_mode || 'ranked';

      // Recalculate rankings after round completion
      try {
        console.log(`\n🔄 [RECALC_RANKINGS] Recalculating ${tournMode === 'team' ? 'team' : 'participant'} rankings for tournament ${tournamentId}`);
        if (tournMode === 'team') {
          await recalculateTeamRankingsForTournament(tournamentId);
        } else {
          await recalculateParticipantRankings(tournamentId);
        }
        console.log(`✅ [RECALC_RANKINGS] Updated ${tournMode === 'team' ? 'team' : 'participant'} rankings after round completion\n`);
      } catch (rankingErr) {
        console.error(`\n❌ Error recalculating rankings after round ${roundNumber}:`, rankingErr);
        // Don't fail the round completion if ranking update fails
      }

      // Check if this is the last Swiss round in a Swiss-Elimination Mix tournament
      const currentRoundInfo = await query(
        `SELECT tr.round_type, t.tournament_type, t.general_rounds, t.final_rounds
         FROM tournament_rounds tr
         JOIN tournaments t ON tr.tournament_id = t.id
         WHERE tr.id = ?`,
        [roundId]
      );

      if (currentRoundInfo.rows.length > 0) {
        const { round_type, tournament_type, general_rounds, final_rounds } = currentRoundInfo.rows[0];
        
        console.log(`\n📋 [DEBUG] Round completion check:`);
        console.log(`   Round Type: ${round_type}`);
        console.log(`   Tournament Type: ${tournament_type}`);
        console.log(`   Round Number: ${roundNumber} / ${general_rounds}`);
        console.log(`   Check 1 - Type is swiss_elimination? ${tournament_type === 'swiss_elimination'}`);
        console.log(`   Check 2 - Round type is general? ${round_type === 'general'}`);
        console.log(`   Check 3 - Is last Swiss round? ${roundNumber === general_rounds}`);
        
        // Only execute if:
        // 1. Tournament type is 'swiss_elimination'
        // 2. Current round type is 'general' (Swiss phase)
        // 3. This is the last Swiss round (roundNumber === general_rounds)
        if (tournament_type === 'swiss_elimination' && round_type === 'general' && roundNumber === general_rounds) {
          console.log(`\n✅ [SWISS_ELIMINATION] Completed last Swiss round (Round ${roundNumber}/${general_rounds})`);
          console.log(`📊 [SWISS_ELIMINATION] Now selecting top ${Math.pow(2, final_rounds)} players for elimination phase...`);
          
          // Execute player selection for elimination phase
          await selectPlayersForEliminationPhase(tournamentId, final_rounds);
          
          // Recalculate rankings after elimination to reflect new status
          console.log(`\n🔄 [SWISS_ELIMINATION] Recalculating rankings after player selection...`);
          try {
            if (tournMode === 'team') {
              await recalculateTeamRankingsForTournament(tournamentId);
            } else {
              await recalculateParticipantRankings(tournamentId);
            }
            console.log(`✅ [SWISS_ELIMINATION] Rankings recalculated after elimination`);
          } catch (rankingErr) {
            console.error(`⚠️  [SWISS_ELIMINATION] Error recalculating rankings after elimination:`, rankingErr);
          }
        } else {
          console.log(`\n⏭️  [SWISS_ELIMINATION] Not executing selectPlayersForEliminationPhase() - conditions not met`);
        }
      }

      // Check if this is the last round
      const totalRoundsResult = await query(
        `SELECT COUNT(*) as total_rounds FROM tournament_rounds WHERE tournament_id = ?`,
        [tournamentId]
      );
      const totalRounds = parseInt(totalRoundsResult.rows[0].total_rounds);

      // Get tournament type (used for both notification and finish logic)
      const tournamentType = currentRoundInfo.rows[0]?.tournament_type;

      // For league tournaments: post round completion notification with standings
      // (skip if last round — postTournamentFinished handles that case)
      if (tournamentType === 'league' && roundNumber < totalRounds) {
        try {
          const leagueTournamentResult = await query(
            `SELECT discord_thread_id, tournament_mode FROM tournaments WHERE id = ?`,
            [tournamentId]
          );
          const discordThreadId = leagueTournamentResult.rows[0]?.discord_thread_id;
          const leagueTournMode = leagueTournamentResult.rows[0]?.tournament_mode || 'ranked';

          if (discordThreadId) {
            // Fetch current standings based on tournament mode
            let standingsRows: any[] = [];
            if (leagueTournMode === 'team') {
              const result = await query(
                `SELECT tt.name as nickname, tt.tournament_points as points,
                        tt.tournament_wins as wins, tt.tournament_losses as losses
                 FROM tournament_teams tt
                 WHERE tt.tournament_id = ?
                 ORDER BY tt.tournament_points DESC, tt.tournament_wins DESC`,
                [tournamentId]
              );
              standingsRows = result.rows;
            } else {
              const result = await query(
                `SELECT u.nickname, tp.tournament_points as points,
                        tp.tournament_wins as wins, tp.tournament_losses as losses
                 FROM tournament_participants tp
                 JOIN users_extension u ON tp.user_id = u.id
                 WHERE tp.tournament_id = ?
                 ORDER BY tp.tournament_points DESC, tp.tournament_wins DESC`,
                [tournamentId]
              );
              standingsRows = result.rows;
            }

            await discordService.postLeagueRoundCompleted(
              discordThreadId,
              roundNumber,
              totalRounds,
              standingsRows
            );
            console.log(`✅ [DISCORD] Posted league round ${roundNumber} completion notification`);
          }
        } catch (discordErr) {
          console.error(`Discord league round completion notification error:`, discordErr);
        }
      }

      // Check if this is the last round or if tournament should finish
      // For league tournaments: only finish if there are NO open rounds remaining
      // For other types: finish if this is the last round number
      let shouldFinishTournament = false;
      
      if (tournamentType === 'league') {
        // For league: check if there are any rounds still open
        const openRoundsResult = await query(
          `SELECT COUNT(*) as open_count FROM tournament_rounds 
           WHERE tournament_id = ? AND round_status IN ('in_progress', 'not_started')`,
          [tournamentId]
        );
        const openCount = parseInt(openRoundsResult.rows[0].open_count);
        shouldFinishTournament = openCount === 0;
        console.log(`\n📊 [LEAGUE_TOURNAMENT] Round ${roundNumber} completed. Open rounds remaining: ${openCount}`);
        if (shouldFinishTournament) {
          console.log(`✅ [LEAGUE_TOURNAMENT] No more open rounds - tournament will finish`);
        } else {
          console.log(`⏭️  [LEAGUE_TOURNAMENT] Other rounds still open - tournament continues`);
        }
      } else {
        // For Swiss/Elimination/Mixed: finish if this is the last round
        shouldFinishTournament = roundNumber === totalRounds;
      }

      if (shouldFinishTournament) {
        // This is the last round - tournament is about to finish
        
        // Get tournament mode
        const tournamentResult = await query(
          `SELECT tournament_mode FROM tournaments WHERE id = ?`,
          [tournamentId]
        );
        const tournMode = tournamentResult.rows[0]?.tournament_mode || 'ranked';
        
        // FIRST: Calculate tiebreakers BEFORE marking as finished
        // This ensures rankings are properly ordered by OMP/GWP/OGP for correct winner selection
        console.log(`\n🎲 [TIEBREAKERS] Calculating tournament tiebreakers (OMP, GWP, OGP) BEFORE finishing...`);
        try {
          if (tournMode === 'team') {
            const tiebreakersResult = await calculateTeamSwissTiebreakers(tournamentId);
            console.log(`✅ [TIEBREAKERS] Calculated tiebreakers for ${tiebreakersResult.length} teams`);
            
            // Update database with calculated tiebreakers
            for (const tb of tiebreakersResult) {
              await query(
                `UPDATE tournament_teams SET omp = ?, gwp = ?, ogp = ? WHERE tournament_id = ? AND id = ?`,
                [tb.omp, tb.gwp, tb.ogp, tournamentId, tb.team_id]
              );
            }
          } else {
            const tiebreakersResult = await calculateLeagueTiebreakers(tournamentId);
            console.log(`✅ [TIEBREAKERS] Calculated tiebreakers for ${tiebreakersResult.length} participants`);
            
            // Update database with calculated tiebreakers
            for (const tb of tiebreakersResult) {
              await query(
                `UPDATE tournament_participants SET omp = ?, gwp = ?, ogp = ? WHERE tournament_id = ? AND user_id = ?`,
                [tb.omp, tb.gwp, tb.ogp, tournamentId, tb.user_id]
              );
            }
          }
        } catch (tiebreakersErr) {
          console.error('[TIEBREAKERS] Error calculating tiebreakers:', tiebreakersErr);
          // Don't fail the tournament finish if tiebreakers calculation fails
        }

        // THEN: Get winner and runner-up based on tournament type
        const { winner, runnerUp } = await getWinnerAndRunnerUp(tournamentId);

        if (winner) {
          // NOW mark as finished
          await query(
            `UPDATE tournaments SET status = 'finished', finished_at = NOW() WHERE id = ?`,
            [tournamentId]
          );
          console.log(`🏆 Tournament ${tournamentId} finished - Winner: ${winner.nickname}`);

          // Notify Discord of tournament finish
          try {
            const tournamentResult = await query(
              `SELECT name, discord_thread_id FROM tournaments WHERE id = ?`,
              [tournamentId]
            );

            if (tournamentResult.rows.length > 0 && tournamentResult.rows[0].discord_thread_id) {
              const winnerNickname = winner.nickname || 'Unknown';
              const runnerUpNickname = runnerUp?.nickname || 'N/A';
              
              await discordService.postTournamentFinished(
                tournamentResult.rows[0].discord_thread_id,
                tournamentResult.rows[0].name,
                winnerNickname,
                runnerUpNickname
              );
            }
          } catch (discordErr) {
            console.error('Discord tournament finished notification error:', discordErr);
            // Don't fail the tournament completion if Discord fails
          }
        }
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking/completing round:', error);
    throw error;
  }
}

/**
 * Calculate and update tournament rankings for team mode
 * Ranks teams based on: wins-losses difference, then OMP, GWP, OGP, ELO
 * Updates tournament_ranking column for UI display
 */
export async function recalculateTeamRankings(tournamentId: string): Promise<void> {
  try {
    console.log(`\n📊 [TEAM_RANKINGS] Recalculating rankings for tournament ${tournamentId}`);

    // Get all active teams ranked by performance
    const teamsResult = await query(
      `SELECT 
        tt.id,
        tt.name,
        tt.tournament_wins,
        tt.tournament_losses,
        tt.tournament_points,
        tt.omp,
        tt.gwp,
        tt.ogp
       FROM tournament_teams tt
       WHERE tt.tournament_id = ? AND tt.status = 'active'
       ORDER BY 
         (tt.tournament_wins - tt.tournament_losses) DESC,
         tt.omp DESC,
         tt.gwp DESC,
         tt.ogp DESC`,
      [tournamentId]
    );

    const teams = teamsResult.rows;
    console.log(`Found ${teams.length} active teams for ranking`);

    // Update ranking for each team
    for (let i = 0; i < teams.length; i++) {
      const ranking = i + 1;
      await query(
        `UPDATE tournament_teams SET tournament_ranking = ? WHERE id = ?`,
        [ranking, teams[i].id]
      );
      console.log(`  Team ${teams[i].team_name}: Rank #${ranking} (${teams[i].tournament_wins}W-${teams[i].tournament_losses}L)`);
    }

    console.log(`✅ Team rankings updated for tournament ${tournamentId}`);
  } catch (error) {
    console.error('Error recalculating team rankings:', error);
    throw error;
  }
}

/**
 * Update current_round for participant (1v1) when advancing to next round
 * Called when a new round is activated
 * For round 1: all participants start at round 1
 * For subsequent rounds: only active participants advance, eliminated stay at elimination round
 */
export async function updateParticipantCurrentRound(tournamentId: string, roundNumber: number): Promise<void> {
  try {
    console.log(`\n🔄 [PARTICIPANT_ROUND] Updating current_round to ${roundNumber} for tournament ${tournamentId}`);

    if (roundNumber === 1) {
      // For round 1, all participants start in round 1
      await query(
        `UPDATE tournament_participants SET current_round = ? WHERE tournament_id = ?`,
        [roundNumber, tournamentId]
      );
      console.log(`✅ All participants set to current_round = ${roundNumber}`);
    } else {
      // Only update active participants (eliminated ones stay at their elimination round)
      await query(
        `UPDATE tournament_participants SET current_round = ? WHERE tournament_id = ? AND status = 'active'`,
        [roundNumber, tournamentId]
      );
      console.log(`✅ Active participants updated to current_round = ${roundNumber}`);
    }
  } catch (error) {
    console.error('Error updating participant current_round:', error);
    throw error;
  }
}

/**
 * Update current_round for team when advancing to next round
 * Called when a new round is activated
 */
export async function updateTeamCurrentRound(tournamentId: string, roundNumber: number): Promise<void> {
  try {
    console.log(`\n🔄 [TEAM_ROUND] Updating current_round to ${roundNumber} for tournament ${tournamentId}`);

    // For round 1, all teams start in round 1
    // For subsequent rounds, only active teams are updated
    if (roundNumber === 1) {
      await query(
        `UPDATE tournament_teams SET current_round = ? WHERE tournament_id = ?`,
        [roundNumber, tournamentId]
      );
      console.log(`✅ All teams set to current_round = ${roundNumber}`);
    } else {
      // Only update active teams (eliminated teams stay at their elimination round)
      await query(
        `UPDATE tournament_teams SET current_round = ? WHERE tournament_id = ? AND status = 'active'`,
        [roundNumber, tournamentId]
      );
      console.log(`✅ Active teams updated to current_round = ${roundNumber}`);
    }
  } catch (error) {
    console.error('Error updating team current_round:', error);
    throw error;
  }
}

/**
 * Get winner and runner-up based on tournament type
 * For elimination/swiss_elimination: uses final match participants
 * For swiss/league: uses statistics-based ranking
 * Handles both team and 1v1 modes
 */
export async function getWinnerAndRunnerUp(
  tournamentId: string
): Promise<{ winner: { id: string; nickname: string } | null; runnerUp: { id: string; nickname: string } | null }> {
  try {
    // Step 1: Detect tournament mode and type
    const tournResult = await query(
      `SELECT tournament_mode, tournament_type FROM tournaments WHERE id = ?`,
      [tournamentId]
    );

    if (tournResult.rows.length === 0) {
      console.error(`Tournament ${tournamentId} not found`);
      return { winner: null, runnerUp: null };
    }

    const isTeamMode = tournResult.rows[0].tournament_mode === 'team';
    const tournamentType = tournResult.rows[0].tournament_type?.toLowerCase() || 'swiss';

    // Step 2: Detect tournament type category
    const isElimination = tournamentType === 'elimination' || tournamentType === 'swiss_elimination';

    console.log(`[WINNER_RUNNERUP] Tournament mode: ${isTeamMode ? 'team' : '1v1'}, Type: ${tournamentType}, IsElimination: ${isElimination}`);

    if (isElimination) {
      // ELIMINATION/SWISS_ELIMINATION: Get final match participants
      console.log(`[WINNER_RUNNERUP] Using ELIMINATION logic - finding final match`);

      if (isTeamMode) {
        // Team mode - final match from tournament_teams
        const finalMatchResult = await query(
          `SELECT trm.winner_id, trm.player1_id, trm.player2_id
           FROM tournament_round_matches trm
           WHERE trm.tournament_id = ? AND trm.series_status = 'completed'
           ORDER BY trm.created_at DESC
           LIMIT 1`,
          [tournamentId]
        );

        if (finalMatchResult.rows.length === 0) {
          console.log(`[WINNER_RUNNERUP] No completed matches found`);
          return { winner: null, runnerUp: null };
        }

        const finalMatch = finalMatchResult.rows[0];
        const winnerId = finalMatch.winner_id;
        const runnerUpId = finalMatch.player1_id === winnerId ? finalMatch.player2_id : finalMatch.player1_id;

        // Get team details
        const winnerResult = await query(
          `SELECT id, name as nickname FROM tournament_teams WHERE id = ?`,
          [winnerId]
        );
        const runnerUpResult = await query(
          `SELECT id, name as nickname FROM tournament_teams WHERE id = ?`,
          [runnerUpId]
        );

        const winner = winnerResult.rows[0] || null;
        const runnerUp = runnerUpResult.rows[0] || null;

        console.log(`[WINNER_RUNNERUP] Winner: ${winner?.nickname}, Runner-up: ${runnerUp?.nickname}`);
        return { winner, runnerUp };
      } else {
        // 1v1 mode - final match from tournament_participants
        const finalMatchResult = await query(
          `SELECT trm.winner_id, trm.player1_id, trm.player2_id
           FROM tournament_round_matches trm
           WHERE trm.tournament_id = ? AND trm.series_status = 'completed'
           ORDER BY trm.created_at DESC
           LIMIT 1`,
          [tournamentId]
        );

        if (finalMatchResult.rows.length === 0) {
          console.log(`[WINNER_RUNNERUP] No completed matches found`);
          return { winner: null, runnerUp: null };
        }

        const finalMatch = finalMatchResult.rows[0];
        const winnerId = finalMatch.winner_id;
        const runnerUpId = finalMatch.player1_id === winnerId ? finalMatch.player2_id : finalMatch.player1_id;

        // Get player details
        const winnerResult = await query(
          `SELECT u.id, u.nickname FROM users_extension u WHERE u.id = ?`,
          [winnerId]
        );
        const runnerUpResult = await query(
          `SELECT u.id, u.nickname FROM users_extension u WHERE u.id = ?`,
          [runnerUpId]
        );

        const winner = winnerResult.rows[0] || null;
        const runnerUp = runnerUpResult.rows[0] || null;

        console.log(`[WINNER_RUNNERUP] Winner: ${winner?.nickname}, Runner-up: ${runnerUp?.nickname}`);
        return { winner, runnerUp };
      }
    } else {
      // SWISS/LEAGUE: Get top 2 by statistics
      console.log(`[WINNER_RUNNERUP] Using SWISS/LEAGUE logic - ranking by statistics`);

      if (isTeamMode) {
        // Team mode - top 2 teams por stats
        const topTeamsResult = await query(
          `SELECT id, name as nickname, tournament_points, tournament_wins, omp, gwp, ogp
           FROM tournament_teams
           WHERE tournament_id = ? AND status = 'active'
           ORDER BY tournament_points DESC, omp DESC, gwp DESC, ogp DESC
           LIMIT 2`,
          [tournamentId]
        );

        if (topTeamsResult.rows.length === 0) {
          console.log(`[WINNER_RUNNERUP] No teams found`);
          return { winner: null, runnerUp: null };
        }

        const winner = topTeamsResult.rows[0] || null;
        const runnerUp = topTeamsResult.rows[1] || null;

        console.log(`[WINNER_RUNNERUP] Winner: ${winner?.nickname}, Runner-up: ${runnerUp?.nickname}`);
        return { winner, runnerUp };
      } else {
        // 1v1 mode - top 2 players por stats
        const topPlayersResult = await query(
          `SELECT u.id, u.nickname, tp.tournament_points, tp.tournament_wins, tp.omp, tp.gwp, tp.ogp
           FROM tournament_participants tp
           LEFT JOIN users_extension u ON tp.user_id = u.id
           WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'
           ORDER BY tp.tournament_points DESC, tp.omp DESC, tp.gwp DESC, tp.ogp DESC
           LIMIT 2`,
          [tournamentId]
        );

        if (topPlayersResult.rows.length === 0) {
          console.log(`[WINNER_RUNNERUP] No players found`);
          return { winner: null, runnerUp: null };
        }

        const winner = topPlayersResult.rows[0] || null;
        const runnerUp = topPlayersResult.rows[1] || null;

        console.log(`[WINNER_RUNNERUP] Winner: ${winner?.nickname}, Runner-up: ${runnerUp?.nickname}`);
        return { winner, runnerUp };
      }
    }
  } catch (error) {
    console.error('[WINNER_RUNNERUP] Error getting winner and runner-up:', error);
    return { winner: null, runnerUp: null };
  }
}

/**
 * Check if tournament is currently in elimination phase
 * Used to determine ranking logic (elimination vs swiss/league)
 */
export async function isInEliminationPhase(tournamentId: string): Promise<boolean> {
  try {
    // Check for active rounds in elimination phase
    const activeElimResult = await query(
      `SELECT COUNT(*) as count FROM tournament_rounds 
       WHERE tournament_id = ? AND round_status = 'in_progress' 
       AND round_classification IN ('semifinal', 'final')`,
      [tournamentId]
    );

    if (parseInt(activeElimResult.rows[0].count) > 0) {
      return true;
    }

    // Check if latest completed round is in elimination phase
    const latestRoundResult = await query(
      `SELECT round_classification FROM tournament_rounds 
       WHERE tournament_id = ? AND round_status = 'completed'
       ORDER BY round_number DESC LIMIT 1`,
      [tournamentId]
    );

    if (latestRoundResult.rows.length > 0) {
      return ['semifinal', 'final'].includes(latestRoundResult.rows[0].round_classification);
    }

    return false;
  } catch (error) {
    console.error('[IS_ELIMINATION_PHASE] Error checking elimination phase:', error);
    return false;
  }
}

/**
 * Recalculate and update tournament rankings for 1v1 mode
 * Ranks participants based on:
 * - Elimination phase: by status (active first), current_round (higher first), then statistics
 * - Swiss/League phase: by statistics (tournament_points, omp, gwp, ogp)
 * Updates tournament_ranking column for UI display and includes both active and eliminated
 */
export async function recalculateParticipantRankings(tournamentId: string): Promise<void> {
  try {
    console.log(`\n📊 [RECALC_RANKINGS_1V1] Recalculating rankings for 1v1 tournament ${tournamentId}`);

    const isElimination = await isInEliminationPhase(tournamentId);
    console.log(`   Phase: ${isElimination ? 'ELIMINATION' : 'SWISS/LEAGUE'}`);

    let participantsResult;

    if (isElimination) {
      // Elimination phase: active participants first, then by current_round desc, then by stats, then by ELO
      participantsResult = await query(
        `SELECT 
          tp.id,
          tp.status,
          tp.current_round,
          tp.tournament_points,
          tp.omp,
          tp.gwp,
          tp.ogp,
          u.nickname,
          u.elo_rating
         FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'
         ORDER BY 
           CASE WHEN tp.status = 'active' THEN 0 ELSE 1 END,
           tp.current_round DESC,
           tp.tournament_points DESC,
           tp.omp DESC,
           tp.gwp DESC,
           tp.ogp DESC,
           u.elo_rating DESC`,
        [tournamentId]
      );
      console.log(`   Sorting by: status (active first) → current_round DESC → statistics → ELO DESC`);
    } else {
      // Swiss/League phase: by statistics only, then by ELO as tiebreaker
      participantsResult = await query(
        `SELECT 
          tp.id,
          tp.status,
          tp.current_round,
          tp.tournament_points,
          tp.omp,
          tp.gwp,
          tp.ogp,
          u.nickname,
          u.elo_rating
         FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'
         ORDER BY 
           tp.tournament_points DESC,
           tp.omp DESC,
           tp.gwp DESC,
           tp.ogp DESC,
           u.elo_rating DESC`,
        [tournamentId]
      );
      console.log(`   Sorting by: statistics (points → omp → gwp → ogp) → ELO DESC`);
    }

    const participants = participantsResult.rows;
    console.log(`   Found ${participants.length} participants for ranking`);

    // Update ranking for each participant
    for (let i = 0; i < participants.length; i++) {
      const ranking = i + 1;
      await query(
        `UPDATE tournament_participants SET tournament_ranking = ? WHERE id = ?`,
        [ranking, participants[i].id]
      );
      console.log(`   ${participants[i].nickname}: Rank #${ranking} (${participants[i].status}, Round ${participants[i].current_round}, ${participants[i].tournament_points}pts, ELO: ${participants[i].elo_rating})`);
    }

    console.log(`✅ [RECALC_RANKINGS_1V1] Participant rankings updated`);
  } catch (error) {
    console.error('[RECALC_RANKINGS_1V1] Error recalculating participant rankings:', error);
    throw error;
  }
}

/**
 * Recalculate and update tournament rankings for team mode
 * Ranks teams based on:
 * - Elimination phase: by status (active first), current_round (higher first), then statistics
 * - Swiss/League phase: by statistics (tournament_points, omp, gwp, ogp)
 * Updates tournament_ranking column for UI display and includes both active and eliminated
 */
export async function recalculateTeamRankingsForTournament(tournamentId: string): Promise<void> {
  try {
    console.log(`\n📊 [RECALC_RANKINGS_TEAM] Recalculating rankings for team tournament ${tournamentId}`);

    const isElimination = await isInEliminationPhase(tournamentId);
    console.log(`   Phase: ${isElimination ? 'ELIMINATION' : 'SWISS/LEAGUE'}`);

    let teamsResult;

    if (isElimination) {
      // Elimination phase: active teams first, then by current_round desc, then by stats
      teamsResult = await query(
        `SELECT 
          tt.id,
          tt.name,
          tt.status,
          tt.current_round,
          tt.tournament_points,
          tt.omp,
          tt.gwp,
          tt.ogp,
          COALESCE(SUM(u.elo_rating), 0) as team_total_elo
         FROM tournament_teams tt
         LEFT JOIN tournament_participants tp ON tt.id = tp.team_id
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tt.tournament_id = ?
         GROUP BY tt.id, tt.name, tt.status, tt.current_round, tt.tournament_points, tt.omp, tt.gwp, tt.ogp
         ORDER BY 
           CASE WHEN tt.status = 'active' THEN 0 ELSE 1 END,
           tt.current_round DESC,
           tt.tournament_points DESC,
           tt.omp DESC,
           tt.gwp DESC,
           tt.ogp DESC,
           team_total_elo DESC`,
        [tournamentId]
      );
      console.log(`   Sorting by: status (active first) → current_round DESC → statistics → team ELO sum DESC`);
    } else {
      // Swiss/League phase: by statistics only, then by team ELO sum as tiebreaker
      teamsResult = await query(
        `SELECT 
          tt.id,
          tt.name,
          tt.status,
          tt.current_round,
          tt.tournament_points,
          tt.omp,
          tt.gwp,
          tt.ogp,
          COALESCE(SUM(u.elo_rating), 0) as team_total_elo
         FROM tournament_teams tt
         LEFT JOIN tournament_participants tp ON tt.id = tp.team_id
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tt.tournament_id = ?
         GROUP BY tt.id, tt.name, tt.status, tt.current_round, tt.tournament_points, tt.omp, tt.gwp, tt.ogp
         ORDER BY 
           tt.tournament_points DESC,
           tt.omp DESC,
           tt.gwp DESC,
           tt.ogp DESC,
           team_total_elo DESC`,
        [tournamentId]
      );
      console.log(`   Sorting by: statistics (points → omp → gwp → ogp) → team ELO sum DESC`);
    }

    const teams = teamsResult.rows;
    console.log(`   Found ${teams.length} teams for ranking`);

    // Update ranking for each team
    for (let i = 0; i < teams.length; i++) {
      const ranking = i + 1;
      await query(
        `UPDATE tournament_teams SET tournament_ranking = ? WHERE id = ?`,
        [ranking, teams[i].id]
      );
      console.log(`   ${teams[i].name}: Rank #${ranking} (${teams[i].status}, Round ${teams[i].current_round}, ${teams[i].tournament_points}pts, Team ELO sum: ${teams[i].team_total_elo})`);
    }

    console.log(`✅ [RECALC_RANKINGS_TEAM] Team rankings updated`);
  } catch (error) {
    console.error('[RECALC_RANKINGS_TEAM] Error recalculating team rankings:', error);
    throw error;
  }
}
