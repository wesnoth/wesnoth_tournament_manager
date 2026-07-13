/**
 * Statistics Calculator Service
 * Migrated from PostgreSQL stored procedures to TypeScript/Node.js
 * 
 * Functions:
 * - Tournament tiebreakers calculations (league, swiss, team swiss)
 * - Balance event snapshots management
 * - Faction/map statistics trend analysis
 * - Team member validation checks
 */

import { query } from '../config/database.js';
import { randomUUID } from 'crypto';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface TiebreakerResult {
  user_id?: string;
  team_id?: string;
  total_points: number;
  omp: number; // Opponent Match Points
  gwp: number; // Game Win Percentage
  ogp: number; // Opponent Game Win Percentage
}

export interface BalanceEventSnapshot {
  snapshot_date: Date;
  map_id: string;
  faction_id: string;
  opponent_faction_id: string;
  total_games: number;
  wins: number;
  losses: number;
  winrate: number;
  sample_size_category: 'small' | 'medium' | 'large';
  confidence_level: number;
}

export interface BalanceEventImpact {
  map_id: string;
  map_name: string;
  faction_id: string;
  faction_name: string;
  opponent_faction_id: string;
  opponent_faction_name: string;
  games_before: number;
  wins_before: number;
  losses_before: number;
  winrate_before: number;
  side1_games_before: number;
  side1_wins_before: number;
  side2_games_before: number;
  side2_wins_before: number;
  games_after: number;
  wins_after: number;
  losses_after: number;
  winrate_after: number;
  side1_games_after: number;
  side1_wins_after: number;
  side2_games_after: number;
  side2_wins_after: number;
  winrate_change: number;
  sample_size_before: number;
  sample_size_after: number;
}

export interface BalanceTrendPoint {
  snapshot_date: Date;
  total_games: number;
  wins: number;
  losses: number;
  winrate: number;
  confidence_level: number;
  sample_size_category: string;
}

// ============================================================================
// TIEBREAKER CALCULATIONS
// ============================================================================

/**
 * Calculate league tournament tiebreakers
 * Returns: total_points, OMP, GWP, OGP for each player
 */
export async function calculateLeagueTiebreakers(
  tournamentId: string
): Promise<TiebreakerResult[]> {
  try {
    // Get all participants
    const participantsResult = await query(
      `SELECT DISTINCT tp.user_id
       FROM tournament_participants tp
       WHERE tp.tournament_id = ?
         AND tp.participation_status = 'accepted'
       ORDER BY tp.user_id`,
      [tournamentId]
    );

    const results: TiebreakerResult[] = [];

    for (const participant of participantsResult.rows) {
      const userId = participant.user_id;

      // 1. TOTAL POINTS = tournament_wins
      const pointsResult = await query(
        `SELECT COALESCE(tp.tournament_wins, 0) as total_points
         FROM tournament_participants tp
         WHERE tp.tournament_id = ? AND tp.user_id = ?`,
        [tournamentId, userId]
      );
      const totalPoints = pointsResult.rows[0]?.total_points || 0;

      // 2. OMP (Opponent Match Points) = Average wins of all opponents faced
      const ompResult = await query(
        `SELECT COALESCE(AVG(COALESCE(tp.tournament_wins, 0)), 0) as omp
         FROM (
           SELECT DISTINCT
             CASE 
               WHEN tm.player1_id = ? THEN tm.player2_id
               ELSE tm.player1_id
             END as opponent_id
           FROM tournament_round_matches tm
           WHERE tm.tournament_id = ?
             AND (tm.player1_id = ? OR tm.player2_id = ?)
             AND tm.series_status = 'completed'
         ) opponents
         LEFT JOIN tournament_participants tp ON tp.tournament_id = ? 
           AND tp.user_id = opponents.opponent_id
           AND tp.participation_status = 'accepted'`,
        [userId, tournamentId, userId, userId, tournamentId]
      );
      const omp = parseFloat(ompResult.rows[0]?.omp || 0);

      // 3. GWP (Game Win Percentage) = (games won / total games) * 100
      const gwpResult = await query(
        `SELECT 
           COALESCE(SUM(CASE WHEN tm.player1_id = ? THEN tm.player1_wins ELSE tm.player2_wins END), 0) as games_won,
           COALESCE(SUM(CASE WHEN tm.player1_id = ? THEN tm.player2_wins ELSE tm.player1_wins END), 0) as games_lost
         FROM tournament_round_matches tm
         WHERE tm.tournament_id = ?
           AND (tm.player1_id = ? OR tm.player2_id = ?)
           AND tm.series_status = 'completed'`,
        [userId, userId, tournamentId, userId, userId]
      );
      
      const gamesWon = gwpResult.rows[0]?.games_won || 0;
      const gamesLost = gwpResult.rows[0]?.games_lost || 0;
      const totalGames = gamesWon + gamesLost;
      const gwp = totalGames > 0 ? Math.round((gamesWon / totalGames) * 10000) / 100 : 0;

      // 4. OGP (Opponent Game Win Percentage) = Average GWP of opponents
      const ogpResult = await query(
        `SELECT COALESCE(AVG(
           CASE 
             WHEN (opp_wins + opp_losses) > 0 
             THEN (opp_wins / (opp_wins + opp_losses) * 100)
             ELSE 0
           END
         ), 0) as ogp
         FROM (
           SELECT DISTINCT
             CASE 
               WHEN tm.player1_id = ? THEN tm.player2_id
               ELSE tm.player1_id
             END as opponent_id,
             CASE 
               WHEN tm.player1_id = ? THEN tm.player2_wins
               ELSE tm.player1_wins
             END as opp_wins,
             CASE 
               WHEN tm.player1_id = ? THEN tm.player1_wins
               ELSE tm.player2_wins
             END as opp_losses
           FROM tournament_round_matches tm
           WHERE tm.tournament_id = ?
             AND (tm.player1_id = ? OR tm.player2_id = ?)
             AND tm.series_status = 'completed'
         ) opponent_data`,
        [userId, userId, userId, tournamentId, userId, userId]
      );
      const ogp = parseFloat(ogpResult.rows[0]?.ogp || 0);

      results.push({
        user_id: userId,
        total_points: totalPoints,
        omp,
        gwp,
        ogp
      });
    }

    return results;
  } catch (error) {
    console.error('Error calculating league tiebreakers:', error);
    throw error;
  }
}

/**
 * Calculate swiss tournament tiebreakers (same as league for now)
 */
export async function calculateSwissTiebreakers(
  tournamentId: string
): Promise<TiebreakerResult[]> {
  // Swiss uses same calculation as league
  return calculateLeagueTiebreakers(tournamentId);
}

/**
 * Calculate team swiss tournament tiebreakers
 */
export async function calculateTeamSwissTiebreakers(
  tournamentId: string
): Promise<TiebreakerResult[]> {
  try {
    // Get all teams
    const teamsResult = await query(
      `SELECT DISTINCT tt.id
       FROM tournament_teams tt
       WHERE tt.tournament_id = ?
         AND tt.status = 'active'
       ORDER BY tt.id`,
      [tournamentId]
    );

    const results: TiebreakerResult[] = [];

    for (const team of teamsResult.rows) {
      const teamId = team.id;

      // 1. TOTAL POINTS = tournament_wins * 3
      const pointsResult = await query(
        `SELECT COALESCE(tt.tournament_wins, 0) * 3 as total_points
         FROM tournament_teams tt
         WHERE tt.tournament_id = ? AND tt.id = ?`,
        [tournamentId, teamId]
      );
      const totalPoints = pointsResult.rows[0]?.total_points || 0;

      // 2. OMP = Average wins of all opponent teams * 3
      const ompResult = await query(
        `SELECT COALESCE(AVG(COALESCE(tt.tournament_wins, 0) * 3), 0) as omp
         FROM (
           SELECT DISTINCT
             CASE 
               WHEN tm.player1_id = ? THEN tm.player2_id
               ELSE tm.player1_id
             END as opponent_id
           FROM tournament_round_matches tm
           WHERE tm.tournament_id = ?
             AND (tm.player1_id = ? OR tm.player2_id = ?)
             AND tm.series_status = 'completed'
         ) opponents
         LEFT JOIN tournament_teams tt ON tt.tournament_id = ? 
           AND tt.id = opponents.opponent_id`,
        [teamId, tournamentId, teamId, teamId, tournamentId]
      );
      const omp = parseFloat(ompResult.rows[0]?.omp || 0);

      // 3. GWP (Game Win Percentage)
      const gwpResult = await query(
        `SELECT 
           COALESCE(SUM(CASE WHEN tm.player1_id = ? THEN tm.player1_wins ELSE tm.player2_wins END), 0) as games_won,
           COALESCE(SUM(CASE WHEN tm.player1_id = ? THEN tm.player2_wins ELSE tm.player1_wins END), 0) as games_lost
         FROM tournament_round_matches tm
         WHERE tm.tournament_id = ?
           AND (tm.player1_id = ? OR tm.player2_id = ?)
           AND tm.series_status = 'completed'`,
        [teamId, teamId, tournamentId, teamId, teamId]
      );
      
      const gamesWon = gwpResult.rows[0]?.games_won || 0;
      const gamesLost = gwpResult.rows[0]?.games_lost || 0;
      const totalGames = gamesWon + gamesLost;
      const gwp = totalGames > 0 ? Math.round((gamesWon / totalGames) * 10000) / 100 : 0;

      // 4. OGP (Opponent Game Win Percentage)
      const ogpResult = await query(
        `SELECT COALESCE(AVG(
           CASE 
             WHEN (opp_wins + opp_losses) > 0 
             THEN (opp_wins / (opp_wins + opp_losses) * 100)
             ELSE 0
           END
         ), 0) as ogp
         FROM (
           SELECT DISTINCT
             CASE 
               WHEN tm.player1_id = ? THEN tm.player2_id
               ELSE tm.player1_id
             END as opponent_id,
             CASE 
               WHEN tm.player1_id = ? THEN tm.player2_wins
               ELSE tm.player1_wins
             END as opp_wins,
             CASE 
               WHEN tm.player1_id = ? THEN tm.player1_wins
               ELSE tm.player2_wins
             END as opp_losses
           FROM tournament_round_matches tm
           WHERE tm.tournament_id = ?
             AND (tm.player1_id = ? OR tm.player2_id = ?)
             AND tm.series_status = 'completed'
         ) opponent_data`,
        [teamId, teamId, teamId, tournamentId, teamId, teamId]
      );
      const ogp = parseFloat(ogpResult.rows[0]?.ogp || 0);

      results.push({
        team_id: teamId,
        total_points: totalPoints,
        omp,
        gwp,
        ogp
      });
    }

    return results;
  } catch (error) {
    console.error('Error calculating team swiss tiebreakers:', error);
    throw error;
  }
}

// ============================================================================
// TEAM MEMBER VALIDATIONS
// ============================================================================

/**
 * Check if team has more than 2 members
 */
export async function checkTeamMemberCount(teamId: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT COUNT(*) as count 
       FROM tournament_participants 
       WHERE team_id = ? AND team_position IS NOT NULL`,
      [teamId]
    );
    
    const count = result.rows[0]?.count || 0;
    return count <= 2;
  } catch (error) {
    console.error('Error checking team member count:', error);
    throw error;
  }
}

/**
 * Check if team has duplicate positions (position must be unique)
 */
export async function checkTeamMemberPositions(
  teamId: string,
  position: number,
  userId: string
): Promise<boolean> {
  try {
    const result = await query(
      `SELECT COUNT(*) as count 
       FROM tournament_participants 
       WHERE team_id = ? 
         AND team_position = ? 
         AND user_id != ?`,
      [teamId, position, userId]
    );
    
    const count = result.rows[0]?.count || 0;
    return count === 0; // Should be 0 duplicates
  } catch (error) {
    console.error('Error checking team member positions:', error);
    throw error;
  }
}

// ============================================================================
// BALANCE EVENT SNAPSHOTS
// ============================================================================

type BalanceEventBoundaryDates = {
  eventDate: string;
  previousEventDate: string | null;
  nextBoundaryDate: string;
};

/** Resolve event-to-event snapshot boundaries using ranked matches as the data source. */
async function getBalanceEventBoundaryDates(eventId: string): Promise<BalanceEventBoundaryDates> {
  const eventsResult = await query(
    `SELECT id, event_date
     FROM balance_events
     ORDER BY event_date ASC`
  );
  const eventIndex = eventsResult.rows.findIndex(row => row.id === eventId);
  if (eventIndex < 0) throw new Error('Balance event not found');

  const toDateString = (value: unknown): string => {
    const date = value instanceof Date ? value : new Date(String(value));
    return date.toISOString().split('T')[0];
  };

  const eventDate = toDateString(eventsResult.rows[eventIndex].event_date);
  const previousEventDate = eventIndex > 0
    ? toDateString(eventsResult.rows[eventIndex - 1].event_date)
    : null;
  let nextBoundaryDate = eventIndex + 1 < eventsResult.rows.length
    ? toDateString(eventsResult.rows[eventIndex + 1].event_date)
    : null;

  if (!nextBoundaryDate) {
    const latestMatchResult = await query(
      `SELECT MAX(DATE(created_at)) AS latest_date
       FROM matches
       WHERE status != 'cancelled'`
    );
    nextBoundaryDate = latestMatchResult.rows[0]?.latest_date
      ? toDateString(latestMatchResult.rows[0].latest_date)
      : eventDate;
  }

  return { eventDate, previousEventDate, nextBoundaryDate };
}

/**
 * Create the cumulative snapshot immediately before a balance event.
 * The date is derived from the event, and the snapshot is rebuilt from all
 * eligible matches recorded up to that date.
 */
export async function createBalanceEventBeforeSnapshot(
  eventId: string
): Promise<number> {
  try {
    const { eventDate } = await getBalanceEventBoundaryDates(eventId);
    const snapshotResult = await createFactionMapStatisticsSnapshot(new Date(`${eventDate}T00:00:00Z`));

    await query(
      `UPDATE balance_events
       SET snapshot_before_date = ?
       WHERE id = ?`,
      [eventDate, eventId]
    );

    return snapshotResult.snapshots_created;
  } catch (error) {
    console.error('Error creating balance event before snapshot:', error);
    throw error;
  }
}

/**
 * Create a cumulative faction/map statistics snapshot for a date.
 * The scheduled job uses this for normal daily history; administrators may
 * also call it through the protected backfill endpoint when correcting data.
 */
export async function createFactionMapStatisticsSnapshot(
  snapshotDate: Date = new Date()
): Promise<{ snapshots_created: number; snapshots_skipped: number }> {
  try {
    const dateStr = snapshotDate.toISOString().split('T')[0];

    // Check if snapshot already exists for this date
    const existingResult = await query(
      `SELECT COUNT(*) as count FROM faction_map_statistics_history WHERE snapshot_date = ?`,
      [dateStr]
    );
    
    if (existingResult.rows[0].count > 0) {
      // Snapshot already exists, skip
      return {
        snapshots_created: 0,
        snapshots_skipped: existingResult.rows[0].count
      };
    }

    // Build the snapshot from matches up to the requested date. Reading the current
    // aggregate table here would make every historical snapshot identical to today.
    const matchesResult = await query(
      `SELECT
         gm.id AS map_id,
         f_w.id AS winner_faction_id,
         f_l.id AS loser_faction_id,
         m.winner_side
       FROM matches m
       JOIN game_maps gm ON gm.name = m.map
       JOIN factions f_w ON f_w.name = m.winner_faction
       JOIN factions f_l ON f_l.name = m.loser_faction
       WHERE m.status != 'cancelled'
         AND m.created_at IS NOT NULL
         AND DATE(m.created_at) <= ?`,
      [dateStr]
    );

    type SnapshotEntry = {
      map_id: string;
      faction_id: string;
      opponent_faction_id: string;
      faction_side: number;
      total_games: number;
      wins: number;
      losses: number;
    };

    const aggregated = new Map<string, SnapshotEntry>();
    const addEntry = (mapId: string, factionId: string, opponentFactionId: string, factionSide: number, isWin: boolean) => {
      const key = `${mapId}|${factionId}|${opponentFactionId}|${factionSide}`;
      const entry = aggregated.get(key);
      if (entry) {
        entry.total_games += 1;
        if (isWin) entry.wins += 1;
        else entry.losses += 1;
        return;
      }
      aggregated.set(key, {
        map_id: mapId,
        faction_id: factionId,
        opponent_faction_id: opponentFactionId,
        faction_side: factionSide,
        total_games: 1,
        wins: isWin ? 1 : 0,
        losses: isWin ? 0 : 1,
      });
    };

    for (const row of matchesResult.rows) {
      const winnerSide = row.winner_side ?? 1;
      const loserSide = winnerSide === 1 ? 2 : winnerSide === 2 ? 1 : 0;
      addEntry(row.map_id, row.winner_faction_id, row.loser_faction_id, winnerSide, true);
      addEntry(row.map_id, row.loser_faction_id, row.winner_faction_id, loserSide, false);
    }

    const { randomUUID } = await import('crypto');
    let snapshotsCreated = 0;
    for (const entry of aggregated.values()) {
      const winrate = Math.round((entry.wins / entry.total_games) * 10000) / 100;
      const sampleSizeCategory = entry.total_games < 10 ? 'small' : entry.total_games < 50 ? 'medium' : 'large';
      const confidenceLevel = entry.total_games < 10 ? 25.0 : entry.total_games < 30 ? 50.0 : entry.total_games < 50 ? 75.0 : 95.0;

      await query(
        `INSERT INTO faction_map_statistics_history (
          id, snapshot_date, snapshot_timestamp, map_id, faction_id,
          opponent_faction_id, faction_side, total_games, wins, losses,
          winrate, sample_size_category, confidence_level
        ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), dateStr, entry.map_id, entry.faction_id, entry.opponent_faction_id,
          entry.faction_side, entry.total_games, entry.wins, entry.losses,
          winrate, sampleSizeCategory, confidenceLevel]
      );
      snapshotsCreated += 1;
    }

    return {
      snapshots_created: snapshotsCreated,
      snapshots_skipped: 0
    };
  } catch (error) {
    console.error('Error creating faction/map statistics snapshot:', error);
    throw error;
  }
}

/**
 * Get balance trend for faction/map over time
 */
export async function getBalanceTrend(
  mapId: string,
  factionId: string,
  opponentFactionId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<BalanceTrendPoint[]> {
  try {
    const result = await query(
      `SELECT
        fms.snapshot_date,
        fms.total_games,
        fms.wins,
        fms.losses,
        fms.winrate,
        fms.confidence_level,
        fms.sample_size_category
      FROM faction_map_statistics_history fms
      WHERE fms.map_id = ?
        AND fms.faction_id = ?
        AND fms.opponent_faction_id = ?
        AND fms.snapshot_date BETWEEN ? AND ?
      ORDER BY fms.snapshot_date ASC`,
      [mapId, factionId, opponentFactionId, dateFrom, dateTo]
    );

    return result.rows as BalanceTrendPoint[];
  } catch (error) {
    console.error('Error getting balance trend:', error);
    throw error;
  }
}

// ============================================================================
// STATISTICS RECALCULATION (10 functions)
// ============================================================================

/**
 * Recalculate all player match statistics
 * Populates 4 types of rows per player:
 *  1. Global  (opponent_id=NULL, map_id=NULL, faction_id=NULL)
 *  2. Per-opponent (opponent_id=set, map_id=NULL, faction_id=NULL, opponent_faction_id=NULL)
 *  3. Per-map      (opponent_id=NULL, map_id=set, faction_id=NULL)
 *  4. Per-faction  (opponent_id=NULL, map_id=NULL, faction_id=set, opponent_faction_id=set)
 */
export async function recalculatePlayerMatchStatistics(): Promise<{ records_updated: number }> {
  try {
    const { randomUUID } = await import('crypto');

    await query('TRUNCATE TABLE player_match_statistics');

    // Fetch all non-cancelled matches with map/faction IDs resolved.
    // We process each row twice (winner + loser perspective) to avoid UNION/subquery complexity.
    const matchesResult = await query(
      `SELECT
         m.winner_id,
         m.loser_id,
         gm.id  AS map_id,
         f_w.id AS winner_faction_id,
         f_l.id AS loser_faction_id,
         m.winner_side,
         m.winner_elo_before,
         m.winner_elo_after,
         m.loser_elo_before,
         m.loser_elo_after,
         m.created_at
       FROM matches m
       LEFT JOIN game_maps gm ON gm.name = m.map
       LEFT JOIN factions f_w ON f_w.name = m.winner_faction
       LEFT JOIN factions f_l ON f_l.name = m.loser_faction
       WHERE m.status != 'cancelled'
       ORDER BY m.created_at ASC`
    );

    // ── Accumulator types ──────────────────────────────────────────────────────

    type GlobalEntry = {
      wins: number; losses: number; elo_sum: number; elo_count: number;
    };
    type OpponentEntry = {
      wins: number; losses: number; elo_sum: number; elo_count: number;
      elo_gained: number; elo_lost: number;
      last_elo_against_me: number | null; last_match_date: string | null;
    };
    type MapEntry = {
      map_id: string;
      wins: number; losses: number; elo_sum: number; elo_count: number;
    };
    type FactionEntry = {
      faction_id: string; opponent_faction_id: string;
      wins: number; losses: number;
    };

    // player_id → side → entry
    const globalMap    = new Map<string, Map<number, GlobalEntry>>();
    // player_id → side → opponent_id → entry
    const opponentMap  = new Map<string, Map<number, Map<string, OpponentEntry>>>();
    // player_id → side → map_id → entry
    const mapMap       = new Map<string, Map<number, Map<string, MapEntry>>>();
    // player_id → side → "faction_id|opp_faction_id" → entry
    const factionMap   = new Map<string, Map<number, Map<string, FactionEntry>>>();

    const SIDES = [0, 1, 2] as const;

    const getOrInit = <K, V>(map: Map<K, V>, key: K, init: () => V): V => {
      let v = map.get(key);
      if (!v) { v = init(); map.set(key, v); }
      return v;
    };

    const addGlobal = (playerId: string, side: number, isWin: boolean, eloChange: number) => {
      const byPlayer = getOrInit(globalMap, playerId, () => new Map());
      const entry    = getOrInit(byPlayer, side, () => ({ wins: 0, losses: 0, elo_sum: 0, elo_count: 0 }));
      if (isWin) entry.wins++; else entry.losses++;
      entry.elo_sum   += eloChange;
      entry.elo_count += 1;
    };

    const addOpponent = (
      playerId: string, side: number, opponentId: string,
      isWin: boolean, eloChange: number,
      opponentEloBefore: number, matchDate: string
    ) => {
      const byPlayer   = getOrInit(opponentMap, playerId, () => new Map());
      const bySide     = getOrInit(byPlayer,   side,     () => new Map());
      const entry      = getOrInit(bySide, opponentId, () => ({
        wins: 0, losses: 0, elo_sum: 0, elo_count: 0,
        elo_gained: 0, elo_lost: 0,
        last_elo_against_me: null as number | null,
        last_match_date: null as string | null,
      }));
      if (isWin) { entry.wins++; if (eloChange > 0) entry.elo_gained += eloChange; }
      else       { entry.losses++; if (eloChange < 0) entry.elo_lost += Math.abs(eloChange); }
      entry.elo_sum   += eloChange;
      entry.elo_count += 1;
      entry.last_elo_against_me = opponentEloBefore;
      entry.last_match_date     = matchDate;
    };

    const addMap = (
      playerId: string, side: number, mapId: string,
      isWin: boolean, eloChange: number
    ) => {
      const byPlayer = getOrInit(mapMap, playerId, () => new Map());
      const bySide   = getOrInit(byPlayer, side,   () => new Map());
      const entry    = getOrInit(bySide, mapId, () => ({ map_id: mapId, wins: 0, losses: 0, elo_sum: 0, elo_count: 0 }));
      if (isWin) entry.wins++; else entry.losses++;
      entry.elo_sum   += eloChange;
      entry.elo_count += 1;
    };

    const addFaction = (
      playerId: string, side: number,
      factionId: string, opponentFactionId: string, isWin: boolean
    ) => {
      const byPlayer = getOrInit(factionMap, playerId, () => new Map());
      const bySide   = getOrInit(byPlayer, side,       () => new Map());
      const key      = `${factionId}|${opponentFactionId}`;
      const entry    = getOrInit(bySide, key, () => ({ faction_id: factionId, opponent_faction_id: opponentFactionId, wins: 0, losses: 0 }));
      if (isWin) entry.wins++; else entry.losses++;
    };

    // ── One-pass accumulation ─────────────────────────────────────────────────
    for (const row of matchesResult.rows) {
      const winnerSide: number = row.winner_side ?? 1;
      const loserSide:  number = winnerSide === 1 ? 2 : 1;

      const winnerEloChange = (row.winner_elo_after  ?? 0) - (row.winner_elo_before ?? 0);
      const loserEloChange  = (row.loser_elo_after   ?? 0) - (row.loser_elo_before  ?? 0);
      const matchDate       = row.created_at
        ? (row.created_at instanceof Date
            ? row.created_at.toISOString().slice(0, 19).replace('T', ' ')
            : String(row.created_at).slice(0, 19).replace('T', ' '))
        : null;

      // ── WINNER perspective ──────────────────────────────────────
      for (const side of SIDES) {
        const sideFilter = side === 0 || side === winnerSide;
        if (!sideFilter) continue;
        addGlobal(row.winner_id, side, true, winnerEloChange);
        addOpponent(row.winner_id, side, row.loser_id, true, winnerEloChange,
          row.loser_elo_before ?? 0, matchDate ?? '');
        if (row.map_id)           addMap(row.winner_id, side, row.map_id, true, winnerEloChange);
        if (row.winner_faction_id && row.loser_faction_id)
          addFaction(row.winner_id, side, row.winner_faction_id, row.loser_faction_id, true);
      }

      // ── LOSER perspective ───────────────────────────────────────
      for (const side of SIDES) {
        const sideFilter = side === 0 || side === loserSide;
        if (!sideFilter) continue;
        addGlobal(row.loser_id, side, false, loserEloChange);
        addOpponent(row.loser_id, side, row.winner_id, false, loserEloChange,
          row.winner_elo_before ?? 0, matchDate ?? '');
        if (row.map_id)           addMap(row.loser_id, side, row.map_id, false, loserEloChange);
        if (row.winner_faction_id && row.loser_faction_id)
          addFaction(row.loser_id, side, row.loser_faction_id, row.winner_faction_id, false);
      }
    }

    // ── INSERT helpers ────────────────────────────────────────────────────────
    let recordsUpdated = 0;

    const insertBase = `INSERT INTO player_match_statistics
      (id, player_id, opponent_id, map_id, faction_id, opponent_faction_id,
       player_side, total_games, wins, losses, winrate, avg_elo_change)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const insertOpponent = `INSERT INTO player_match_statistics
      (id, player_id, opponent_id, map_id, faction_id, opponent_faction_id,
       player_side, total_games, wins, losses, winrate, avg_elo_change,
       elo_gained, elo_lost, last_elo_against_me, last_match_date)
      VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const wr = (w: number, total: number) => total > 0 ? Math.round((w / total) * 10000) / 100 : 0;
    const avg = (sum: number, n: number) => n > 0 ? Math.round((sum / n) * 100) / 100 : 0;

    // 1. Global stats
    for (const [playerId, bySide] of globalMap) {
      for (const [side, e] of bySide) {
        const total = e.wins + e.losses;
        await query(insertBase, [
          randomUUID(), playerId, null, null, null, null,
          side, total, e.wins, e.losses, wr(e.wins, total), avg(e.elo_sum, e.elo_count)
        ]);
        recordsUpdated++;
      }
    }

    // 2. Per-opponent stats
    for (const [playerId, bySide] of opponentMap) {
      for (const [side, byOpponent] of bySide) {
        for (const [opponentId, e] of byOpponent) {
          const total = e.wins + e.losses;
          await query(insertOpponent, [
            randomUUID(), playerId, opponentId,
            side, total, e.wins, e.losses, wr(e.wins, total), avg(e.elo_sum, e.elo_count),
            Math.round(e.elo_gained * 100) / 100,
            Math.round(e.elo_lost   * 100) / 100,
            e.last_elo_against_me !== null ? Math.round(e.last_elo_against_me * 100) / 100 : null,
            e.last_match_date || null
          ]);
          recordsUpdated++;
        }
      }
    }

    // 3. Per-map stats
    for (const [playerId, bySide] of mapMap) {
      for (const [side, byMap] of bySide) {
        for (const [mapId, e] of byMap) {
          const total = e.wins + e.losses;
          await query(insertBase, [
            randomUUID(), playerId, null, mapId, null, null,
            side, total, e.wins, e.losses, wr(e.wins, total), avg(e.elo_sum, e.elo_count)
          ]);
          recordsUpdated++;
        }
      }
    }

    // 4. Per-faction stats
    for (const [playerId, bySide] of factionMap) {
      for (const [side, byFaction] of bySide) {
        for (const e of byFaction.values()) {
          const total = e.wins + e.losses;
          await query(insertBase, [
            randomUUID(), playerId, null, null, e.faction_id, e.opponent_faction_id,
            side, total, e.wins, e.losses, wr(e.wins, total), 0
          ]);
          recordsUpdated++;
        }
      }
    }

    return { records_updated: recordsUpdated };
  } catch (error) {
    console.error('Error recalculating player match statistics:', error);
    throw error;
  }
}

/**
 * Recalculate all faction/map statistics
 */
export async function recalculateFactionMapStatistics(): Promise<{ records_updated: number }> {
  try {
    await query('TRUNCATE TABLE faction_map_statistics');

    // Fetch each non-cancelled match once, resolving map and faction IDs via JOIN.
    // winner_side is now stored on every match (1 = winner played side 1, 2 = side 2).
    // We process each row twice in JS (winner perspective + loser perspective) instead of
    // using a UNION ALL, which avoids SQL aggregation returning mixed types (COUNT→number,
    // SUM→string) that caused JS string-concatenation bugs.
    const matchesResult = await query(
      `SELECT
         gm.id  AS map_id,
         f_w.id AS winner_faction_id,
         f_l.id AS loser_faction_id,
         m.winner_side
       FROM matches m
       JOIN game_maps gm ON gm.name = m.map
       JOIN factions f_w ON f_w.name = m.winner_faction
       JOIN factions f_l ON f_l.name = m.loser_faction
       WHERE m.status != 'cancelled'`
    );

    type Entry = {
      map_id: string;
      faction_id: string;
      opponent_faction_id: string;
      faction_side: number;
      total_games: number;
      wins: number;
      losses: number;
    };

    const aggregated = new Map<string, Entry>();

    const addEntry = (
      map_id: string,
      faction_id: string,
      opponent_faction_id: string,
      faction_side: number,
      isWin: boolean
    ) => {
      const key = `${map_id}|${faction_id}|${opponent_faction_id}|${faction_side}`;
      const entry = aggregated.get(key);
      if (entry) {
        entry.total_games++;
        if (isWin) entry.wins++;
        else entry.losses++;
      } else {
        aggregated.set(key, {
          map_id,
          faction_id,
          opponent_faction_id,
          faction_side,
          total_games: 1,
          wins: isWin ? 1 : 0,
          losses: isWin ? 0 : 1
        });
      }
    };

    for (const row of matchesResult.rows) {
      // If winner_side is unknown (NULL), assume side 1 for the winner (convention for
      // historical matches where side was not recorded).
      const winnerSide: number = row.winner_side ?? 1;
      const loserSide: number  = winnerSide === 1 ? 2 : winnerSide === 2 ? 1 : 0;

      // Winner perspective: faction that won, playing as winnerSide
      addEntry(row.map_id, row.winner_faction_id, row.loser_faction_id, winnerSide, true);
      // Loser perspective: faction that lost, playing as loserSide
      addEntry(row.map_id, row.loser_faction_id, row.winner_faction_id, loserSide, false);
    }

    const { randomUUID } = await import('crypto');
    let recordsInserted = 0;

    for (const stats of aggregated.values()) {
      const winrate = stats.total_games > 0 ? (stats.wins / stats.total_games) * 100 : 0;

      await query(
        `INSERT INTO faction_map_statistics
         (id, map_id, faction_id, opponent_faction_id, faction_side, total_games, wins, losses, winrate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), stats.map_id, stats.faction_id, stats.opponent_faction_id, stats.faction_side,
         stats.total_games, stats.wins, stats.losses, Math.round(winrate * 100) / 100]
      );
      recordsInserted++;
    }

    return { records_updated: recordsInserted };
  } catch (error) {
    console.error('Error recalculating faction/map statistics:', error);
    throw error;
  }
}

/**
 * Update faction/map statistics for a single match
 */
export async function updateFactionMapStatistics(
  map: string,
  winnerFaction: string,
  loserFaction: string,
  winnerSideNumber?: number | null
): Promise<boolean> {
  try {
    // Import randomUUID for ID generation
    const { randomUUID } = await import('crypto');
    
    // Get map and faction IDs
    const mapResult = await query('SELECT id FROM game_maps WHERE name = ?', [map]);
    const winnerFactionResult = await query('SELECT id FROM factions WHERE name = ?', [winnerFaction]);
    const loserFactionResult = await query('SELECT id FROM factions WHERE name = ?', [loserFaction]);

    if (mapResult.rows.length === 0 || winnerFactionResult.rows.length === 0 || loserFactionResult.rows.length === 0) {
      return false;
    }

    const mapId = mapResult.rows[0].id;
    const winnerFactionId = winnerFactionResult.rows[0].id;
    const loserFactionId = loserFactionResult.rows[0].id;

    // faction_side: 0 = unknown, 1 = side 1, 2 = side 2
    const winnerFactionSide = winnerSideNumber ?? 0;
    const loserFactionSide = winnerSideNumber === 1 ? 2 : winnerSideNumber === 2 ? 1 : 0;

    // Update winner stats using ON DUPLICATE KEY UPDATE (requires UNIQUE KEY on map_id+faction_id+opponent_faction_id+faction_side)
    await query(
      `INSERT INTO faction_map_statistics
       (id, map_id, faction_id, opponent_faction_id, faction_side, total_games, wins, losses, winrate)
       VALUES (?, ?, ?, ?, ?, 1, 1, 0, 100.00)
       ON DUPLICATE KEY UPDATE
         total_games = total_games + 1,
         wins = wins + 1,
         winrate = ROUND(100.0 * (wins + 1) / (total_games + 1), 2)`,
      [randomUUID(), mapId, winnerFactionId, loserFactionId, winnerFactionSide]
    );

    // Update loser stats using ON DUPLICATE KEY UPDATE
    await query(
      `INSERT INTO faction_map_statistics
       (id, map_id, faction_id, opponent_faction_id, faction_side, total_games, wins, losses, winrate)
       VALUES (?, ?, ?, ?, ?, 1, 0, 1, 0.00)
       ON DUPLICATE KEY UPDATE
         total_games = total_games + 1,
         losses = losses + 1,
         winrate = ROUND(100.0 * wins / (total_games + 1), 2)`,
      [randomUUID(), mapId, loserFactionId, winnerFactionId, loserFactionSide]
    );

    return true;
  } catch (error) {
    console.error('Error updating faction/map statistics:', error);
    return false;
  }
}

/**
 * Get balance statistics snapshot for a specific date
 */
export async function getBalanceStatisticsSnapshot(
  snapshotDate: Date
): Promise<BalanceEventSnapshot[]> {
  try {
    const dateStr = snapshotDate.toISOString().split('T')[0];

    const result = await query(
      `SELECT
        snapshot_date,
        map_id,
        faction_id,
        opponent_faction_id,
        total_games,
        wins,
        losses,
        winrate,
        sample_size_category,
        confidence_level
       FROM faction_map_statistics_history
       WHERE snapshot_date = ?`,
      [dateStr]
    );

    return result.rows as BalanceEventSnapshot[];
  } catch (error) {
    console.error('Error getting balance statistics snapshot:', error);
    throw error;
  }
}

/**
 * Recalculate all match statistics (calls recalculatePlayerMatchStatistics + recalculateFactionMapStatistics)
 */
export async function recalculateAllMatchStatistics(): Promise<{
  player_records: number;
  faction_map_records: number;
}> {
  try {
    const playerResult = await recalculatePlayerMatchStatistics();
    const factionResult = await recalculateFactionMapStatistics();

    return {
      player_records: playerResult.records_updated,
      faction_map_records: factionResult.records_updated
    };
  } catch (error) {
    console.error('Error recalculating all match statistics:', error);
    throw error;
  }
}

/**
 * Update player ELO in ranking tables after match
 */
export async function updatePlayerElo(
  playerId: string,
  eloChange: number,
  newElo: number
): Promise<boolean> {
  try {
    await query(
      `UPDATE player_rankings
       SET current_elo = ?,
           elo_change = elo_change + ?,
           last_elo_update = CURRENT_TIMESTAMP
       WHERE player_id = ?`,
      [newElo, eloChange, playerId]
    );

    return true;
  } catch (error) {
    console.error('Error updating player ELO:', error);
    return false;
  }
}

/**
 * Update player faction statistics
 */
export async function updatePlayerFactionStats(
  playerId: string,
  factionId: string,
  isWin: boolean
): Promise<boolean> {
  try {
    if (isWin) {
      await query(
        `UPDATE player_faction_statistics
         SET games_played = games_played + 1,
             games_won = games_won + 1,
             winrate = ROUND(100.0 * (games_won + 1) / (games_played + 1), 2)
         WHERE player_id = ? AND faction_id = ?`,
        [playerId, factionId]
      );
    } else {
      await query(
        `UPDATE player_faction_statistics
         SET games_played = games_played + 1,
             games_lost = games_lost + 1,
             winrate = ROUND(100.0 * games_won / (games_played + 1), 2)
         WHERE player_id = ? AND faction_id = ?`,
        [playerId, factionId]
      );
    }

    return true;
  } catch (error) {
    console.error('Error updating player faction statistics:', error);
    return false;
  }
}

/**
 * Calculate faction winrates for a specific map
 */
export async function calculateFactionWinrates(
  mapId: string
): Promise<Map<string, number>> {
  try {
    const result = await query(
      `SELECT
        faction_id,
        winrate
       FROM faction_map_statistics
       WHERE map_id = ?
       ORDER BY faction_id`,
      [mapId]
    );

    const winrates = new Map<string, number>();
    for (const row of result.rows) {
      winrates.set(row.faction_id, row.winrate);
    }

    return winrates;
  } catch (error) {
    console.error('Error calculating faction winrates:', error);
    throw error;
  }
}

/**
 * Update league rankings after tournament completion
 */
export async function updateLeagueRankings(
  tournamentId: string
): Promise<number> {
  try {
    // Get finishing positions from tournament_participants
    const rankingsResult = await query(
      `SELECT
        rank() OVER (ORDER BY
          tournament_wins DESC,
          tournament_losses ASC,
          tournament_omp DESC,
          tournament_gwp DESC,
          tournament_ogp DESC
        ) as final_rank,
        user_id
       FROM tournament_participants
       WHERE tournament_id = ?`,
      [tournamentId]
    );

    let updatedCount = 0;

    for (const row of rankingsResult.rows) {
      // Update player rankings table
      await query(
        `UPDATE player_rankings
         SET league_rank = CASE WHEN ? <= 10 THEN ? ELSE NULL END,
             last_rank_update = CURRENT_TIMESTAMP
         WHERE player_id = ?`,
        [row.final_rank, row.user_id]
      );
      updatedCount++;
    }

    return updatedCount;
  } catch (error) {
    console.error('Error updating league rankings:', error);
    throw error;
  }
}

/**
 * Get tournament statistics snapshot
 */
export async function getTournamentSnapshot(
  tournamentId: string
): Promise<{
  tournament_id: string;
  total_matches: number;
  total_games: number;
  avg_games_per_match: number;
  total_participants: number;
  final_date: Date;
}> {
  try {
    const result = await query(
      `SELECT
        ? as tournament_id,
        COUNT(DISTINCT tm.id) as total_matches,
        SUM(tm.player1_wins + tm.player2_wins) as total_games,
        ROUND(AVG(tm.player1_wins + tm.player2_wins), 2) as avg_games_per_match,
        COUNT(DISTINCT tp.user_id) as total_participants,
        MAX(tm.completed_at) as final_date
       FROM tournament_round_matches tm
       LEFT JOIN tournament_participants tp ON tp.tournament_id = ?
       WHERE tm.tournament_id = ?
       AND tm.series_status = 'completed'`,
      [tournamentId]
    );

    if (result.rows.length === 0) {
      throw new Error('Tournament not found');
    }

    return result.rows[0] as any;
  } catch (error) {
    console.error('Error getting tournament snapshot:', error);
    throw error;
  }
}

/**
 * Create the cumulative snapshot immediately after a balance event.
 * The date is derived from the event and is never supplied by a regular user.
 */
export async function createBalanceEventAfterSnapshot(
  eventId: string
): Promise<number> {
  try {
    const { nextBoundaryDate } = await getBalanceEventBoundaryDates(eventId);
    const snapshotResult = await createFactionMapStatisticsSnapshot(new Date(`${nextBoundaryDate}T00:00:00Z`));

    // Update balance_events to record snapshot date
    await query(
      `UPDATE balance_events
       SET snapshot_after_date = ?
       WHERE id = ?`,
      [nextBoundaryDate, eventId]
    );

    return snapshotResult.snapshots_created;
  } catch (error) {
    console.error('Error creating balance event after snapshot:', error);
    throw error;
  }
}

/**
 * Get balance event impact computed directly from matches.
 * Uses event_date as the dividing line: matches before vs matches after.
 * Each match is processed twice (winner + loser perspective) like recalculateFactionMapStatistics.
 */
export async function getBalanceEventForwardImpact(
  eventId: string
): Promise<BalanceEventImpact[]> {
  try {
    const eventResult = await query(
      'SELECT event_date FROM balance_events WHERE id = ?',
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      return [];
    }

    const eventDate: string = new Date(eventResult.rows[0].event_date).toISOString().split('T')[0];

    const matchesResult = await query(
      `SELECT
         gm.id  AS map_id,
         gm.name AS map_name,
         f_w.id AS winner_faction_id,
         f_w.name AS winner_faction_name,
         f_l.id AS loser_faction_id,
         f_l.name AS loser_faction_name,
         m.winner_side,
         DATE(m.created_at) AS match_date
       FROM matches m
       JOIN game_maps gm ON gm.name = m.map
       JOIN factions f_w ON f_w.name = m.winner_faction
       JOIN factions f_l ON f_l.name = m.loser_faction
       WHERE m.status != 'cancelled'`
    );

    type Entry = {
      map_id: string; map_name: string;
      faction_id: string; faction_name: string;
      opponent_faction_id: string; opponent_faction_name: string;
      games_before: number; wins_before: number; losses_before: number;
      s1_games_before: number; s1_wins_before: number;
      s2_games_before: number; s2_wins_before: number;
      games_after: number; wins_after: number; losses_after: number;
      s1_games_after: number; s1_wins_after: number;
      s2_games_after: number; s2_wins_after: number;
    };

    const aggregated = new Map<string, Entry>();

    const addEntry = (
      map_id: string, map_name: string,
      faction_id: string, faction_name: string,
      opponent_faction_id: string, opponent_faction_name: string,
      matchDate: string, isWin: boolean, factionSide: number
    ) => {
      const key = `${map_id}|${faction_id}|${opponent_faction_id}`;
      let entry = aggregated.get(key);
      if (!entry) {
        entry = {
          map_id, map_name, faction_id, faction_name,
          opponent_faction_id, opponent_faction_name,
          games_before: 0, wins_before: 0, losses_before: 0,
          s1_games_before: 0, s1_wins_before: 0,
          s2_games_before: 0, s2_wins_before: 0,
          games_after: 0, wins_after: 0, losses_after: 0,
          s1_games_after: 0, s1_wins_after: 0,
          s2_games_after: 0, s2_wins_after: 0,
        };
        aggregated.set(key, entry);
      }
      const isBefore = matchDate < eventDate;
      if (isBefore) {
        entry.games_before++;
        if (isWin) entry.wins_before++; else entry.losses_before++;
        if (factionSide === 1) { entry.s1_games_before++; if (isWin) entry.s1_wins_before++; }
        if (factionSide === 2) { entry.s2_games_before++; if (isWin) entry.s2_wins_before++; }
      } else {
        entry.games_after++;
        if (isWin) entry.wins_after++; else entry.losses_after++;
        if (factionSide === 1) { entry.s1_games_after++; if (isWin) entry.s1_wins_after++; }
        if (factionSide === 2) { entry.s2_games_after++; if (isWin) entry.s2_wins_after++; }
      }
    };

    for (const row of matchesResult.rows) {
      const matchDate: string = row.match_date instanceof Date
        ? row.match_date.toISOString().split('T')[0]
        : String(row.match_date).split('T')[0];
      const winnerSide: number = row.winner_side ?? 1;
      const loserSide: number  = winnerSide === 1 ? 2 : 1;

      addEntry(row.map_id, row.map_name, row.winner_faction_id, row.winner_faction_name,
               row.loser_faction_id, row.loser_faction_name, matchDate, true, winnerSide);
      addEntry(row.map_id, row.map_name, row.loser_faction_id, row.loser_faction_name,
               row.winner_faction_id, row.winner_faction_name, matchDate, false, loserSide);
    }

    const wr = (wins: number, games: number) =>
      games > 0 ? Math.round((wins / games) * 10000) / 100 : null;

    return Array.from(aggregated.values()).map(entry => ({
      map_id: entry.map_id,
      map_name: entry.map_name,
      faction_id: entry.faction_id,
      faction_name: entry.faction_name,
      opponent_faction_id: entry.opponent_faction_id,
      opponent_faction_name: entry.opponent_faction_name,
      games_before: entry.games_before,
      wins_before: entry.wins_before,
      losses_before: entry.losses_before,
      winrate_before: wr(entry.wins_before, entry.games_before) ?? 0,
      side1_games_before: entry.s1_games_before,
      side1_wins_before: entry.s1_wins_before,
      side1_winrate_before: wr(entry.s1_wins_before, entry.s1_games_before),
      side2_games_before: entry.s2_games_before,
      side2_wins_before: entry.s2_wins_before,
      side2_winrate_before: wr(entry.s2_wins_before, entry.s2_games_before),
      games_after: entry.games_after,
      wins_after: entry.wins_after,
      losses_after: entry.losses_after,
      winrate_after: wr(entry.wins_after, entry.games_after) ?? 0,
      side1_games_after: entry.s1_games_after,
      side1_wins_after: entry.s1_wins_after,
      side1_winrate_after: wr(entry.s1_wins_after, entry.s1_games_after),
      side2_games_after: entry.s2_games_after,
      side2_wins_after: entry.s2_wins_after,
      side2_winrate_after: wr(entry.s2_wins_after, entry.s2_games_after),
      winrate_change: (entry.games_after > 0 ? (entry.wins_after / entry.games_after) * 100 : 0) -
                      (entry.games_before > 0 ? (entry.wins_before / entry.games_before) * 100 : 0),
      sample_size_before: entry.games_before,
      sample_size_after: entry.games_after,
    }));
  } catch (error) {
    console.error('Error getting balance event impact from matches:', error);
    throw error;
  }
}

/**
 * Read the cumulative snapshots associated with a balance event.
 * This is the statistics-page representation of before/after data; it does not
 * recalculate matches and therefore reflects the repaired snapshot history.
 */
export async function getBalanceEventSnapshotImpact(
  eventId: string
): Promise<BalanceEventImpact[]> {
  try {
    const eventResult = await query(
      'SELECT snapshot_before_date, snapshot_after_date FROM balance_events WHERE id = ?',
      [eventId]
    );
    if (eventResult.rows.length === 0) return [];

    const { snapshot_before_date: beforeDate, snapshot_after_date: afterDate } = eventResult.rows[0];
    // Older events may not have snapshot markers yet. Keep the legacy match
    // calculation as a compatibility fallback until maintenance rebuilds them.
    if (!beforeDate || !afterDate) return getBalanceEventForwardImpact(eventId);

    const result = await query(
      `SELECT
        gm.id AS map_id, gm.name AS map_name,
        f1.id AS faction_id, f1.name AS faction_name,
        f2.id AS opponent_faction_id, f2.name AS opponent_faction_name,
        SUM(CASE WHEN h.snapshot_date = ? THEN h.total_games ELSE 0 END) AS games_before,
        SUM(CASE WHEN h.snapshot_date = ? THEN h.wins ELSE 0 END) AS wins_before,
        SUM(CASE WHEN h.snapshot_date = ? THEN h.losses ELSE 0 END) AS losses_before,
        SUM(CASE WHEN h.snapshot_date = ? AND h.faction_side = 1 THEN h.total_games ELSE 0 END) AS side1_games_before,
        SUM(CASE WHEN h.snapshot_date = ? AND h.faction_side = 1 THEN h.wins ELSE 0 END) AS side1_wins_before,
        SUM(CASE WHEN h.snapshot_date = ? AND h.faction_side = 2 THEN h.total_games ELSE 0 END) AS side2_games_before,
        SUM(CASE WHEN h.snapshot_date = ? AND h.faction_side = 2 THEN h.wins ELSE 0 END) AS side2_wins_before,
        SUM(CASE WHEN h.snapshot_date = ? THEN h.total_games ELSE 0 END) AS games_after,
        SUM(CASE WHEN h.snapshot_date = ? THEN h.wins ELSE 0 END) AS wins_after,
        SUM(CASE WHEN h.snapshot_date = ? THEN h.losses ELSE 0 END) AS losses_after,
        SUM(CASE WHEN h.snapshot_date = ? AND h.faction_side = 1 THEN h.total_games ELSE 0 END) AS side1_games_after,
        SUM(CASE WHEN h.snapshot_date = ? AND h.faction_side = 1 THEN h.wins ELSE 0 END) AS side1_wins_after,
        SUM(CASE WHEN h.snapshot_date = ? AND h.faction_side = 2 THEN h.total_games ELSE 0 END) AS side2_games_after,
        SUM(CASE WHEN h.snapshot_date = ? AND h.faction_side = 2 THEN h.wins ELSE 0 END) AS side2_wins_after
      FROM faction_map_statistics_history h
      JOIN game_maps gm ON gm.id = h.map_id
      JOIN factions f1 ON f1.id = h.faction_id
      JOIN factions f2 ON f2.id = h.opponent_faction_id
      WHERE h.snapshot_date IN (?, ?)
      GROUP BY gm.id, gm.name, f1.id, f1.name, f2.id, f2.name
      HAVING games_before > 0 OR games_after > 0
      ORDER BY gm.name, f1.name, f2.name`,
      [beforeDate, beforeDate, beforeDate, beforeDate, beforeDate, beforeDate, beforeDate,
       afterDate, afterDate, afterDate, afterDate, afterDate, afterDate, afterDate,
       beforeDate, afterDate]
    );

    const number = (value: unknown): number => Number(value) || 0;
    const winrate = (wins: number, games: number): number => games > 0 ? Math.round((wins / games) * 10000) / 100 : 0;

    if (result.rows.length === 0) return getBalanceEventForwardImpact(eventId);

    return result.rows.map(row => {
      const gamesBefore = number(row.games_before);
      const winsBefore = number(row.wins_before);
      const gamesAfter = number(row.games_after);
      const winsAfter = number(row.wins_after);
      return {
        map_id: row.map_id, map_name: row.map_name,
        faction_id: row.faction_id, faction_name: row.faction_name,
        opponent_faction_id: row.opponent_faction_id,
        opponent_faction_name: row.opponent_faction_name,
        games_before: gamesBefore, wins_before: winsBefore,
        losses_before: number(row.losses_before),
        winrate_before: winrate(winsBefore, gamesBefore),
        side1_games_before: number(row.side1_games_before),
        side1_wins_before: number(row.side1_wins_before),
        side2_games_before: number(row.side2_games_before),
        side2_wins_before: number(row.side2_wins_before),
        games_after: gamesAfter, wins_after: winsAfter,
        losses_after: number(row.losses_after),
        winrate_after: winrate(winsAfter, gamesAfter),
        side1_games_after: number(row.side1_games_after),
        side1_wins_after: number(row.side1_wins_after),
        side2_games_after: number(row.side2_games_after),
        side2_wins_after: number(row.side2_wins_after),
        winrate_change: winrate(winsAfter, gamesAfter) - winrate(winsBefore, gamesBefore),
        sample_size_before: gamesBefore, sample_size_after: gamesAfter,
      };
    });
  } catch (error) {
    console.error('Error getting balance event impact from snapshots:', error);
    throw error;
  }
}

/**
 * Compare the periods between consecutive balance events using cumulative
 * snapshots. The current event day belongs to the before period; the next
 * event day belongs to the after period of the previous event.
 */
export async function getBalanceEventIntervalImpact(
  eventId: string
): Promise<BalanceEventImpact[]> {
  const boundaries = await getBalanceEventBoundaryDates(eventId);

  type Aggregate = {
    map_id: string;
    map_name: string;
    faction_id: string;
    faction_name: string;
    opponent_faction_id: string;
    opponent_faction_name: string;
    games: number;
    wins: number;
    losses: number;
    side1_games: number;
    side1_wins: number;
    side2_games: number;
    side2_wins: number;
  };

  const readSnapshot = async (date: string): Promise<Map<string, Aggregate>> => {
    const result = await query(
      `SELECT
        gm.id AS map_id, gm.name AS map_name,
        f1.id AS faction_id, f1.name AS faction_name,
        f2.id AS opponent_faction_id, f2.name AS opponent_faction_name,
        h.faction_side, h.total_games, h.wins, h.losses
      FROM faction_map_statistics_history h
      JOIN game_maps gm ON gm.id = h.map_id
      JOIN factions f1 ON f1.id = h.faction_id
      JOIN factions f2 ON f2.id = h.opponent_faction_id
      WHERE h.snapshot_date = ?`,
      [date]
    );
    const number = (value: unknown): number => Number(value) || 0;
    const snapshots = new Map<string, Aggregate>();

    for (const row of result.rows) {
      const key = `${row.map_id}|${row.faction_id}|${row.opponent_faction_id}`;
      const entry = snapshots.get(key) || {
        map_id: row.map_id,
        map_name: row.map_name,
        faction_id: row.faction_id,
        faction_name: row.faction_name,
        opponent_faction_id: row.opponent_faction_id,
        opponent_faction_name: row.opponent_faction_name,
        games: 0, wins: 0, losses: 0,
        side1_games: 0, side1_wins: 0,
        side2_games: 0, side2_wins: 0,
      };
      const games = number(row.total_games);
      const wins = number(row.wins);
      const losses = number(row.losses);
      entry.games += games;
      entry.wins += wins;
      entry.losses += losses;
      if (Number(row.faction_side) === 1) {
        entry.side1_games += games;
        entry.side1_wins += wins;
      } else if (Number(row.faction_side) === 2) {
        entry.side2_games += games;
        entry.side2_wins += wins;
      }
      snapshots.set(key, entry);
    }
    return snapshots;
  };

  const previous = boundaries.previousEventDate
    ? await readSnapshot(boundaries.previousEventDate)
    : new Map<string, Aggregate>();
  const current = await readSnapshot(boundaries.eventDate);
  const after = await readSnapshot(boundaries.nextBoundaryDate);
  const keys = new Set([...previous.keys(), ...current.keys(), ...after.keys()]);
  const rate = (wins: number, games: number) => games > 0 ? Math.round((wins / games) * 10000) / 100 : 0;
  const result: BalanceEventImpact[] = [];

  for (const key of keys) {
    const currentEntry = current.get(key);
    const previousEntry = previous.get(key);
    const afterEntry = after.get(key);
    const beforeGames = (currentEntry?.games || 0) - (previousEntry?.games || 0);
    const beforeWins = (currentEntry?.wins || 0) - (previousEntry?.wins || 0);
    const afterGames = (afterEntry?.games || 0) - (currentEntry?.games || 0);
    const afterWins = (afterEntry?.wins || 0) - (currentEntry?.wins || 0);
    if (beforeGames <= 0 && afterGames <= 0) continue;

    const base = currentEntry || afterEntry || previousEntry!;
    const beforeSide1Games = (currentEntry?.side1_games || 0) - (previousEntry?.side1_games || 0);
    const beforeSide1Wins = (currentEntry?.side1_wins || 0) - (previousEntry?.side1_wins || 0);
    const beforeSide2Games = (currentEntry?.side2_games || 0) - (previousEntry?.side2_games || 0);
    const beforeSide2Wins = (currentEntry?.side2_wins || 0) - (previousEntry?.side2_wins || 0);
    const afterSide1Games = (afterEntry?.side1_games || 0) - (currentEntry?.side1_games || 0);
    const afterSide1Wins = (afterEntry?.side1_wins || 0) - (currentEntry?.side1_wins || 0);
    const afterSide2Games = (afterEntry?.side2_games || 0) - (currentEntry?.side2_games || 0);
    const afterSide2Wins = (afterEntry?.side2_wins || 0) - (currentEntry?.side2_wins || 0);
    const beforeRate = rate(beforeWins, beforeGames);
    const afterRate = rate(afterWins, afterGames);

    result.push({
      ...base,
      games_before: beforeGames,
      wins_before: beforeWins,
      losses_before: beforeGames - beforeWins,
      winrate_before: beforeRate,
      side1_games_before: beforeSide1Games,
      side1_wins_before: beforeSide1Wins,
      side2_games_before: beforeSide2Games,
      side2_wins_before: beforeSide2Wins,
      games_after: afterGames,
      wins_after: afterWins,
      losses_after: afterGames - afterWins,
      winrate_after: afterRate,
      side1_games_after: afterSide1Games,
      side1_wins_after: afterSide1Wins,
      side2_games_after: afterSide2Games,
      side2_wins_after: afterSide2Wins,
      winrate_change: afterRate - beforeRate,
      sample_size_before: beforeGames,
      sample_size_after: afterGames,
    });
  }

  return result;
}

/**
 * Recalculate balance event snapshots and impacts
 */
export async function recalculateBalanceEventSnapshots(recreateAll: boolean = false): Promise<{
  balance_events_updated: number;
  snapshots_created: number;
}> {
  try {
    if (recreateAll) {
      // Clear all snapshot dates so every event is reprocessed
      await query(`UPDATE balance_events SET snapshot_before_date = NULL, snapshot_after_date = NULL`);
      // Clear the history table so createFactionMapStatisticsSnapshot won't skip existing dates
      await query(`TRUNCATE TABLE faction_map_statistics_history`);
    }

    // Get all balance events without snapshots (after optional clear above, this picks up all)
    const eventsResult = await query(
      `SELECT id FROM balance_events
       WHERE snapshot_before_date IS NULL OR snapshot_after_date IS NULL`
    );

    let eventsUpdated = 0;
    let snapshotsCreated = 0;

    for (const event of eventsResult.rows) {
      try {
        if (!event.snapshot_before_date) {
          const beforeCount = await createBalanceEventBeforeSnapshot(event.id);
          snapshotsCreated += beforeCount;
        }
        if (!event.snapshot_after_date) {
          const afterCount = await createBalanceEventAfterSnapshot(event.id);
          snapshotsCreated += afterCount;
        }
        eventsUpdated++;
      } catch (e) {
        console.error(`Error processing balance event ${event.id}:`, e);
      }
    }

    return {
      balance_events_updated: eventsUpdated,
      snapshots_created: snapshotsCreated
    };
  } catch (error) {
    console.error('Error recalculating balance event snapshots:', error);
    throw error;
  }
}
/**
 * CRITICAL: Recalculate player ELO from match records
 * Takes the FINAL ELO from the last non-cancelled match for each player
 * Updates users_extension with correct ELO, ranking, and level
 */
export async function recalculatePlayerEloSequential(): Promise<{
  players_updated: number;
  total_matches_processed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let playersUpdated = 0;

  try {
    // Get all unique players from non-cancelled matches
    const playersResult = await query(
      `SELECT DISTINCT winner_id as player_id FROM matches
       WHERE status != 'cancelled'
       UNION
       SELECT DISTINCT loser_id FROM matches
       WHERE status != 'cancelled'`
    );

    const totalMatches = await query(
      `SELECT COUNT(*) as count FROM matches
       WHERE status != 'cancelled'`
    );

    // For each player, get their final ELO and stats from their matches
    for (const player of playersResult.rows) {
      const playerId = player.player_id;
      
      try {
        // Get all stats for this player from their matches (non-cancelled only)
        const statsResult = await query(
          `SELECT
             COUNT(CASE WHEN winner_id = ? THEN 1 END) as wins,
             COUNT(CASE WHEN loser_id = ? THEN 1 END) as losses,
             MAX(CASE WHEN winner_id = ? THEN winner_elo_after ELSE NULL END) as final_elo_as_winner,
             MAX(CASE WHEN loser_id = ? THEN loser_elo_after ELSE NULL END) as final_elo_as_loser
           FROM matches
           WHERE (winner_id = ? OR loser_id = ?)
           AND status != 'cancelled'`,
          [playerId, playerId, playerId, playerId, playerId, playerId]
        );

        const stats = statsResult.rows[0];
        const wins = stats.wins || 0;
        const losses = stats.losses || 0;
        const matchesPlayed = wins + losses;

        // Get final ELO (use the most recent match ELO)
        const finalElo = stats.final_elo_as_winner || stats.final_elo_as_loser || 1400;

        // Determine if player should be rated (10+ matches and ELO >= 1400)
        const isRated = matchesPlayed >= 10 && finalElo >= 1400 ? 1 : 0;

        // Calculate level based on ELO
        let level = 'Novato';
        if (finalElo >= 1600) level = 'Experto';
        else if (finalElo >= 1500) level = 'Avanzado';
        else if (finalElo >= 1450) level = 'Iniciado';

        // Get previous ELO for trend calculation
        const prevEloResult = await query(
          `SELECT elo_rating FROM users_extension WHERE id = ?`,
          [playerId]
        );

        const prevElo = prevEloResult.rows[0]?.elo_rating || 1400;
        const trend = finalElo > prevElo ? 1 : (finalElo < prevElo ? -1 : 0);

        // Update users_extension
        await query(
          `UPDATE users_extension
           SET elo_rating = ?,
               matches_played = ?,
               total_wins = ?,
               total_losses = ?,
               is_rated = ?,
               level = ?,
               trend = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [finalElo, matchesPlayed, wins, losses, isRated, level, trend, playerId]
        );

        playersUpdated++;
      } catch (e) {
        const msg = `Error updating player ${playerId}: ${e instanceof Error ? e.message : String(e)}`;
        errors.push(msg);
        console.error(msg);
      }
    }

    return {
      players_updated: playersUpdated,
      total_matches_processed: totalMatches.rows[0]?.count || 0,
      errors
    };
  } catch (error) {
    const msg = `Error in recalculatePlayerEloSequential: ${error instanceof Error ? error.message : String(error)}`;
    errors.push(msg);
    console.error(msg);
    throw error;
  }
}

export default {
  calculateLeagueTiebreakers,
  calculateSwissTiebreakers,
  calculateTeamSwissTiebreakers,
  checkTeamMemberCount,
  checkTeamMemberPositions,
  createBalanceEventBeforeSnapshot,
  createFactionMapStatisticsSnapshot,
  getBalanceTrend,
  recalculatePlayerMatchStatistics,
  recalculateFactionMapStatistics,
  updateFactionMapStatistics,
  getBalanceStatisticsSnapshot,
  recalculateAllMatchStatistics,
  updatePlayerElo,
  updatePlayerFactionStats,
  calculateFactionWinrates,
  updateLeagueRankings,
  getTournamentSnapshot,
  createBalanceEventAfterSnapshot,
  getBalanceEventForwardImpact,
  getBalanceEventSnapshotImpact,
  getBalanceEventIntervalImpact,
  recalculateBalanceEventSnapshots,
  recalculatePlayerEloSequential
};
