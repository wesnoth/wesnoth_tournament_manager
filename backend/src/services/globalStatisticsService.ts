import { query } from '../config/database.js';

export interface GlobalStatistics {
  users_total: number;
  users_active: number;
  users_ranked: number;
  users_new_month: number;
  users_new_year: number;
  matches_today: number;
  matches_week: number;
  matches_month: number;
  matches_year: number;
  matches_total: number;
  tournament_matches_month: number;
  tournament_matches_year: number;
  tournament_matches_total: number;
  tournaments_month: number;
  tournaments_year: number;
  tournaments_total: number;
  last_updated: string;
}

/**
 * Calculate all global statistics
 */
export async function calculateGlobalStatistics(): Promise<GlobalStatistics> {
  try {
    const stats: GlobalStatistics = {
      users_total: 0,
      users_active: 0,
      users_ranked: 0,
      users_new_month: 0,
      users_new_year: 0,
      matches_today: 0,
      matches_week: 0,
      matches_month: 0,
      matches_year: 0,
      matches_total: 0,
      tournament_matches_month: 0,
      tournament_matches_year: 0,
      tournament_matches_total: 0,
      tournaments_month: 0,
      tournaments_year: 0,
      tournaments_total: 0,
      last_updated: new Date().toISOString(),
    };

    // Users statistics
    const usersResult = await query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN enable_ranked = 1 THEN 1 ELSE 0 END) as ranked,
        SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN 1 ELSE 0 END) as new_month,
        SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 364 DAY) THEN 1 ELSE 0 END) as new_year
       FROM users_extension`
    );

    if (usersResult.rows.length > 0) {
      const row = usersResult.rows[0];
      stats.users_total = row.total || 0;
      stats.users_active = row.active || 0;
      stats.users_ranked = row.ranked || 0;
      stats.users_new_month = row.new_month || 0;
      stats.users_new_year = row.new_year || 0;
    }

    // Ranked matches statistics (from matches table, excluding cancelled)
    // today: only today, week: last 7 days (including today), month: last 30 days, year: last 365 days, total: all
    const matchesResult = await query(
      `SELECT 
        SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN 1 ELSE 0 END) as week,
        SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN 1 ELSE 0 END) as month,
        SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 364 DAY) THEN 1 ELSE 0 END) as year,
        COUNT(*) as total
       FROM matches
       WHERE status != 'cancelled'`
    );

    if (matchesResult.rows.length > 0) {
      const row = matchesResult.rows[0];
      stats.matches_today = row.today || 0;
      stats.matches_week = row.week || 0;
      stats.matches_month = row.month || 0;
      stats.matches_year = row.year || 0;
      stats.matches_total = row.total || 0;
    }

    // Tournament game statistics from the phase-engine model, excluding pending games.
    const tournamentMatchesResult = await query(
      `SELECT 
        SUM(CASE WHEN COALESCE(played_at, created_at) >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN 1 ELSE 0 END) as month,
        SUM(CASE WHEN COALESCE(played_at, created_at) >= DATE_SUB(CURDATE(), INTERVAL 364 DAY) THEN 1 ELSE 0 END) as year,
        COUNT(*) as total
       FROM tournament_games
       WHERE status = 'completed'`
    );

    if (tournamentMatchesResult.rows.length > 0) {
      const row = tournamentMatchesResult.rows[0];
      stats.tournament_matches_month = row.month || 0;
      stats.tournament_matches_year = row.year || 0;
      stats.tournament_matches_total = row.total || 0;
    }

    // Tournaments statistics
    const tournamentsResult = await query(
      `SELECT 
        SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) THEN 1 ELSE 0 END) as month,
        SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 364 DAY) THEN 1 ELSE 0 END) as year,
        COUNT(*) as total
       FROM tournaments`
    );

    if (tournamentsResult.rows.length > 0) {
      const row = tournamentsResult.rows[0];
      stats.tournaments_month = row.month || 0;
      stats.tournaments_year = row.year || 0;
      stats.tournaments_total = row.total || 0;
    }

    return stats;
  } catch (error) {
    console.error('Error calculating global statistics:', error);
    throw error;
  }
}

/**
 * Update global_statistics table with calculated values
 */
export async function updateGlobalStatisticsCache(stats: GlobalStatistics): Promise<void> {
  try {
    const updates = [
      ['users_total', stats.users_total],
      ['users_active', stats.users_active],
      ['users_ranked', stats.users_ranked],
      ['users_new_month', stats.users_new_month],
      ['users_new_year', stats.users_new_year],
      ['matches_today', stats.matches_today],
      ['matches_week', stats.matches_week],
      ['matches_month', stats.matches_month],
      ['matches_year', stats.matches_year],
      ['matches_total', stats.matches_total],
      ['tournament_matches_month', stats.tournament_matches_month],
      ['tournament_matches_year', stats.tournament_matches_year],
      ['tournament_matches_total', stats.tournament_matches_total],
      ['tournaments_month', stats.tournaments_month],
      ['tournaments_year', stats.tournaments_year],
      ['tournaments_total', stats.tournaments_total],
    ];

    for (const [key, value] of updates) {
      await query(
        `UPDATE global_statistics 
         SET statistic_value = ?, calculated_at = NOW()
         WHERE statistic_key = ?`,
        [value, key]
      );
    }

    console.log('[GlobalStats] Statistics cache updated successfully');
  } catch (error) {
    console.error('Error updating global statistics cache:', error);
    throw error;
  }
}

/**
 * Get global statistics from cache
 */
export async function getGlobalStatisticsFromCache(): Promise<GlobalStatistics> {
  try {
    const result = await query(
      `SELECT statistic_key, statistic_value, last_updated
       FROM global_statistics
       ORDER BY statistic_key`
    );

    const stats: GlobalStatistics = {
      users_total: 0,
      users_active: 0,
      users_ranked: 0,
      users_new_month: 0,
      users_new_year: 0,
      matches_today: 0,
      matches_week: 0,
      matches_month: 0,
      matches_year: 0,
      matches_total: 0,
      tournament_matches_month: 0,
      tournament_matches_year: 0,
      tournament_matches_total: 0,
      tournaments_month: 0,
      tournaments_year: 0,
      tournaments_total: 0,
      last_updated: new Date().toISOString(),
    };

    for (const row of result.rows) {
      const key = row.statistic_key as keyof Omit<GlobalStatistics, 'last_updated'>;
      if (key in stats) {
        (stats[key] as number) = row.statistic_value;
      }
      if (!stats.last_updated || new Date(row.last_updated) > new Date(stats.last_updated)) {
        stats.last_updated = row.last_updated;
      }
    }

    return stats;
  } catch (error) {
    console.error('Error retrieving global statistics from cache:', error);
    throw error;
  }
}
