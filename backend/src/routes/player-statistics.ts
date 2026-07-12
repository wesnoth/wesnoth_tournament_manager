import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

/** Parse optional ?side query param. Valid values: 0 (all), 1 (side 1), 2 (side 2). Default: 0. */
const parseSide = (raw: unknown): number => {
  const v = parseInt(String(raw));
  return (v === 1 || v === 2) ? v : 0;
};

/**
 * Get global player statistics
 * Returns overall winrate, ELO change, games played
 */
router.get('/player/:playerId/global', async (req, res) => {
  try {
    const { playerId } = req.params;
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT 
        pms.player_id,
        u.nickname as player_name,
        pms.player_side,
        pms.total_games,
        pms.wins,
        pms.losses,
        pms.winrate,
        pms.avg_elo_change,
        pms.last_updated
      FROM player_match_statistics pms
      JOIN users_extension u ON pms.player_id = u.id
      WHERE pms.player_id = ?
      AND pms.opponent_id IS NULL
      AND pms.map_id IS NULL
      AND pms.faction_id IS NULL
      AND pms.player_side = ?`,
      [playerId, side]
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Error fetching player global statistics:', error);
    res.status(500).json({ error: 'Failed to fetch player statistics' });
  }
});

/**
 * Get player statistics by map
 * Shows how a player performs on each map
 */
router.get('/player/:playerId/by-map', async (req, res) => {
  try {
    const { playerId } = req.params;
    const minGames = Math.min(100, Math.max(1, parseInt(req.query.minGames as string) || 2));
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT 
        gm.id as map_id,
        gm.name as map_name,
        pms.player_side,
        pms.total_games,
        pms.wins,
        pms.losses,
        pms.winrate,
        pms.avg_elo_change
      FROM player_match_statistics pms
      JOIN game_maps gm ON pms.map_id = gm.id
      WHERE pms.player_id = ?
      AND pms.opponent_id IS NULL
      AND pms.map_id IS NOT NULL
      AND pms.faction_id IS NULL
      AND pms.player_side = ?
      AND pms.total_games >= ?
      ORDER BY pms.winrate DESC`,
      [playerId, side, minGames]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching player map statistics:', error);
    res.status(500).json({ error: 'Failed to fetch player map statistics' });
  }
});

/**
 * Get player statistics by faction
 * Shows how a player performs with each faction (aggregated across all opponents)
 */
router.get('/player/:playerId/by-faction', async (req, res) => {
  try {
    const { playerId } = req.params;
    const minGames = Math.min(100, Math.max(1, parseInt(req.query.minGames as string) || 2));
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT 
        f.id as faction_id,
        f.name as faction_name,
        SUM(pms.total_games) as total_games,
        SUM(pms.wins) as wins,
        SUM(pms.losses) as losses,
        ROUND(SUM(pms.wins) * 100.0 / SUM(pms.total_games), 2) as winrate,
        ROUND(AVG(pms.avg_elo_change), 2) as avg_elo_change
      FROM player_match_statistics pms
      JOIN factions f ON pms.faction_id = f.id
      WHERE pms.player_id = ?
      AND pms.opponent_id IS NULL
      AND pms.map_id IS NULL
      AND pms.faction_id IS NOT NULL
      AND pms.player_side = ?
      GROUP BY f.id, f.name
      HAVING SUM(pms.total_games) >= ?
      ORDER BY winrate DESC`,
      [playerId, side, minGames]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching player faction statistics:', error);
    res.status(500).json({ error: 'Failed to fetch player faction statistics' });
  }
});

/**
 * Get player statistics by faction matchup
 * Shows matchups with both player faction and opponent faction
 */
router.get('/player/:playerId/by-matchup', async (req, res) => {
  try {
    const { playerId } = req.params;
    const minGames = Math.min(100, Math.max(1, parseInt(req.query.minGames as string) || 2));
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT 
        f.id as faction_id,
        f.name as faction_name,
        opp_f.id as opponent_faction_id,
        opp_f.name as opponent_faction_name,
        pms.total_games,
        pms.wins,
        pms.losses,
        pms.winrate,
        pms.avg_elo_change
      FROM player_match_statistics pms
      JOIN factions f ON pms.faction_id = f.id
      LEFT JOIN factions opp_f ON pms.opponent_faction_id = opp_f.id
      WHERE pms.player_id = ?
      AND pms.opponent_id IS NULL
      AND pms.map_id IS NULL
      AND pms.faction_id IS NOT NULL
      AND pms.opponent_faction_id IS NOT NULL
      AND pms.player_side = ?
      AND pms.total_games >= ?
      ORDER BY pms.winrate DESC, pms.total_games DESC`,
      [playerId, side, minGames]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching player matchup statistics:', error);
    res.status(500).json({ error: 'Failed to fetch player matchup statistics' });
  }
});

/**
 * Get player head-to-head statistics vs a specific opponent
 */
router.get('/player/:playerId/vs-player/:opponentId', async (req, res) => {
  try {
    const { playerId, opponentId } = req.params;
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT 
        pms.player_id,
        u1.nickname as player_name,
        pms.opponent_id,
        u2.nickname as opponent_name,
        pms.player_side,
        pms.total_games,
        pms.wins,
        pms.losses,
        pms.winrate,
        pms.avg_elo_change,
        COUNT(DISTINCT gm.id) as maps_played
      FROM player_match_statistics pms
      JOIN users_extension u1 ON pms.player_id = u1.id
      JOIN users_extension u2 ON pms.opponent_id = u2.id
      LEFT JOIN game_maps gm ON pms.map_id = gm.id
      WHERE pms.player_id = ?
      AND pms.opponent_id = ?
      AND pms.map_id IS NULL
      AND pms.faction_id IS NULL
      AND pms.player_side = ?
      GROUP BY pms.player_id, u1.nickname, pms.opponent_id, u2.nickname, pms.player_side, pms.total_games, pms.wins, pms.losses, pms.winrate, pms.avg_elo_change`,
      [playerId, opponentId, side]
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Error fetching head-to-head statistics:', error);
    res.status(500).json({ error: 'Failed to fetch head-to-head statistics' });
  }
});

/**
 * Get player statistics on a specific map
 */
router.get('/player/:playerId/map/:mapId', async (req, res) => {
  try {
    const { playerId, mapId } = req.params;
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT 
        gm.id as map_id,
        gm.name as map_name,
        pms.player_side,
        pms.total_games,
        pms.wins,
        pms.losses,
        pms.winrate,
        pms.avg_elo_change,
        COUNT(DISTINCT f.id) as factions_used
      FROM player_match_statistics pms
      JOIN game_maps gm ON pms.map_id = gm.id
      LEFT JOIN factions f ON pms.faction_id = f.id AND pms.map_id = gm.id
      WHERE pms.player_id = ?
      AND pms.map_id = ?
      AND pms.opponent_id IS NULL
      AND pms.faction_id IS NULL
      AND pms.player_side = ?
      GROUP BY gm.id, gm.name, pms.player_side, pms.total_games, pms.wins, pms.losses, pms.winrate, pms.avg_elo_change`,
      [playerId, mapId, side]
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Error fetching player map statistics:', error);
    res.status(500).json({ error: 'Failed to fetch player map statistics' });
  }
});

/**
 * Get player statistics with a specific faction
 */
router.get('/player/:playerId/faction/:factionId', async (req, res) => {
  try {
    const { playerId, factionId } = req.params;
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT 
        f.id as faction_id,
        f.name as faction_name,
        pms.player_side,
        pms.total_games,
        pms.wins,
        pms.losses,
        pms.winrate,
        pms.avg_elo_change,
        COUNT(DISTINCT gm.id) as maps_used
      FROM player_match_statistics pms
      JOIN factions f ON pms.faction_id = f.id
      LEFT JOIN game_maps gm ON pms.map_id = gm.id AND pms.faction_id = f.id
      WHERE pms.player_id = ?
      AND pms.faction_id = ?
      AND pms.opponent_id IS NULL
      AND pms.map_id IS NULL
      AND pms.player_side = ?
      GROUP BY f.id, f.name, pms.player_side, pms.total_games, pms.wins, pms.losses, pms.winrate, pms.avg_elo_change`,
      [playerId, factionId, side]
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Error fetching player faction statistics:', error);
    res.status(500).json({ error: 'Failed to fetch player faction statistics' });
  }
});

/**
 * Get player statistics with a specific faction on a specific map
 */
router.get('/player/:playerId/map/:mapId/faction/:factionId', async (req, res) => {
  try {
    const { playerId, mapId, factionId } = req.params;
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT 
        gm.id as map_id,
        gm.name as map_name,
        f.id as faction_id,
        f.name as faction_name,
        pms.player_side,
        pms.total_games,
        pms.wins,
        pms.losses,
        pms.winrate,
        pms.avg_elo_change
      FROM player_match_statistics pms
      JOIN game_maps gm ON pms.map_id = gm.id
      JOIN factions f ON pms.faction_id = f.id
      WHERE pms.player_id = ?
      AND pms.map_id = ?
      AND pms.faction_id = ?
      AND pms.opponent_id IS NULL
      AND pms.player_side = ?`,
      [playerId, mapId, factionId, side]
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Error fetching player map-faction statistics:', error);
    res.status(500).json({ error: 'Failed to fetch player map-faction statistics' });
  }
});

/**
 * Get recent opponents and head-to-head records
 */
router.get('/player/:playerId/recent-opponents', async (req, res) => {
  try {
    const { playerId } = req.params;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
    const side = parseSide(req.query.side);

    const result = await query(
      `SELECT
        pms.opponent_id,
        u.nickname as opponent_name,
        u.elo_rating as current_elo,
        pms.player_side,
        pms.total_games,
        pms.wins,
        pms.losses,
        pms.winrate,
        CAST(COALESCE(pms.elo_gained, 0) AS DECIMAL(8,2)) as elo_gained,
        CAST(COALESCE(pms.elo_lost, 0) AS DECIMAL(8,2)) as elo_lost,
        CAST(pms.last_match_date AS CHAR) as last_match_date,
        pms.last_elo_against_me
      FROM player_match_statistics pms
      JOIN users_extension u ON pms.opponent_id = u.id
      WHERE pms.player_id = ?
      AND pms.opponent_id IS NOT NULL
      AND pms.map_id IS NULL
      AND pms.faction_id IS NULL
      AND pms.opponent_faction_id IS NULL
      AND pms.player_side = ?
      ORDER BY IF(pms.last_match_date IS NULL, 1, 0), pms.last_match_date DESC
      LIMIT ?`,
      [playerId, side, limit]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recent opponents:', error);
    res.status(500).json({ error: 'Failed to fetch recent opponents' });
  }
});

export default router;
