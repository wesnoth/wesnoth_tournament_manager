import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { adminMiddleware, authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getUserIP, getUserAgent, logAuditEvent } from '../middleware/audit.js';
import {
  getBalanceTrend,
  getBalanceEventSnapshotImpact,
  getBalanceEventIntervalImpact,
  createFactionMapStatisticsSnapshot,
} from '../services/statisticsCalculator.js';
import {
  getGlobalStatisticsFromCache,
  calculateGlobalStatistics,
  updateGlobalStatisticsCache,
} from '../services/globalStatisticsService.js';

const router = Router();

const BALANCE_EVENT_TYPES = new Set(['BUFF', 'NERF', 'REWORK', 'HOTFIX', 'GENERAL_BALANCE_CHANGE']);

/** Validate an ISO calendar date without allowing MariaDB to normalize invalid input. */
function parseBalanceDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

/** Parse bounded pagination values used by public balance-history lists. */
function parseBalancePagination(limitValue: unknown, offsetValue: unknown): { limit: number; offset: number } | null {
  const limit = limitValue === undefined ? 50 : Number(limitValue);
  const offset = offsetValue === undefined ? 0 : Number(offsetValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return null;
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000_000) return null;
  return { limit, offset };
}

/**
 * Get global site statistics (public endpoint)
 * Returns cached statistics from global_statistics table
 * Accepts ?force=true query parameter to recalculate immediately
 */
router.get('/global', async (req, res) => {
  try {
    const forceRecalculate = req.query.force === 'true';

    if (forceRecalculate) {
      // Recalculate statistics
      const stats = await calculateGlobalStatistics();
      await updateGlobalStatisticsCache(stats);
      return res.json(stats);
    }

    // Get from cache
    const stats = await getGlobalStatisticsFromCache();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching global statistics:', error);
    res.status(500).json({ error: 'Failed to fetch global statistics' });
  }
});

/**
 * Get statistics configuration
 * Returns settings like minimum games threshold for comparisons
 */
router.get('/config', async (req, res) => {
  try {
    // Get config from environment variables or use defaults
    const minGamesThreshold = parseInt(process.env.BALANCE_MIN_GAMES_THRESHOLD || '5');
    
    res.json({
      minGamesThreshold,
    });
  } catch (error) {
    console.error('Error fetching statistics config:', error);
    res.status(500).json({ error: 'Failed to fetch statistics configuration' });
  }
});

/**
 * Get faction statistics by map
 * Returns winrates for each faction on each map
 */
router.get('/faction-by-map', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        gm.id as map_id,
        gm.name as map_name,
        f.id as faction_id,
        f.name as faction_name,
        fms.total_games,
        fms.wins,
        fms.losses,
        fms.winrate,
        fms.last_updated
      FROM faction_map_statistics fms
      JOIN game_maps gm ON fms.map_id = gm.id
      JOIN factions f ON fms.faction_id = f.id
      WHERE fms.total_games >= 2
      ORDER BY gm.name, fms.winrate DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching faction statistics by map:', error);
    res.status(500).json({ error: 'Failed to fetch faction statistics' });
  }
});

/**
 * Get matchup statistics (faction A vs faction B)
 * Shows which matchups are most unbalanced
 * Only shows one direction (faction_id < opponent_faction_id) to avoid duplicates
 */
router.get('/matchups', async (req, res) => {
  try {
    const minGames = req.query.minGames === undefined ? 5 : Number(req.query.minGames);
    if (!Number.isInteger(minGames) || minGames < 1 || minGames > 1000000) {
      return res.status(400).json({ error: 'minGames must be a positive integer' });
    }
    // Get matchups - including both non-mirror (faction_id < opponent_faction_id) and mirror matchups
    // Aggregate across faction_side dimension, but also expose per-side winrates for bias analysis
    const queryText = `SELECT 
      fms.map_id,
      gm.name as map_name,
      fms.faction_id as f1_id,
      fms.opponent_faction_id as f2_id,
      f1.id as faction_1_id,
      f1.name as faction_1_name,
      f2.id as faction_2_id,
      f2.name as faction_2_name,
      SUM(fms.total_games) as total_games,
      SUM(fms.wins) as faction_1_wins,
      SUM(fms.losses) as faction_2_wins,
      ROUND(100.0 * SUM(fms.wins) / NULLIF(SUM(fms.total_games), 0), 2) as faction_1_winrate,
      ROUND(100.0 * SUM(fms.losses) / NULLIF(SUM(fms.total_games), 0), 2) as faction_2_winrate,
      ABS(SUM(fms.wins) - SUM(fms.losses)) as imbalance,
      -- Side 1 breakdown (faction_1 playing as side 1)
      SUM(CASE WHEN fms.faction_side = 1 THEN fms.total_games ELSE 0 END) as side1_games,
      ROUND(100.0 * SUM(CASE WHEN fms.faction_side = 1 THEN fms.wins ELSE 0 END) / NULLIF(SUM(CASE WHEN fms.faction_side = 1 THEN fms.total_games ELSE 0 END), 0), 2) as f1_side1_winrate,
      -- Side 2 breakdown (faction_1 playing as side 2)
      SUM(CASE WHEN fms.faction_side = 2 THEN fms.total_games ELSE 0 END) as side2_games,
      ROUND(100.0 * SUM(CASE WHEN fms.faction_side = 2 THEN fms.wins ELSE 0 END) / NULLIF(SUM(CASE WHEN fms.faction_side = 2 THEN fms.total_games ELSE 0 END), 0), 2) as f1_side2_winrate,
      CURRENT_TIMESTAMP as last_updated
    FROM faction_map_statistics fms
    JOIN game_maps gm ON fms.map_id = gm.id
    JOIN factions f1 ON fms.faction_id = f1.id
    JOIN factions f2 ON fms.opponent_faction_id = f2.id
    WHERE (fms.faction_id < fms.opponent_faction_id OR fms.faction_id = fms.opponent_faction_id)
    GROUP BY fms.map_id, gm.name, fms.faction_id, fms.opponent_faction_id, f1.id, f1.name, f2.id, f2.name
    HAVING SUM(fms.total_games) >= ?
    ORDER BY imbalance DESC, gm.name, f1.name`;
    
    const result = await query(queryText, [minGames]);
    
    res.json(result.rows);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[MATCHUPS] Error caught:', errorMsg);
    console.error('[MATCHUPS] Full error:', error);
    res.status(500).json({ error: `Failed to fetch matchup statistics: ${errorMsg}` });
  }
});

/**
 * Get faction winrates across all maps (global stats)
 * Sums wins from both perspectives (when faction_id is winner or when winning against opponent)
 */
router.get('/faction-global', async (req, res) => {
  try {
    const minGames = req.query.minGames === undefined ? 5 : Number(req.query.minGames);
    if (!Number.isInteger(minGames) || minGames < 1 || minGames > 1000000) {
      return res.status(400).json({ error: 'minGames must be a positive integer' });
    }
    const result = await query(
      `SELECT 
        f.id as faction_id,
        f.name as faction_name,
        SUM(fms.total_games) as total_games,
        SUM(fms.wins) as wins,
        SUM(fms.losses) as losses,
        ROUND(100.0 * SUM(fms.wins) / SUM(fms.total_games), 2) as global_winrate,
        COUNT(DISTINCT fms.map_id) as maps_played,
        SUM(CASE WHEN fms.faction_side = 1 THEN fms.total_games ELSE 0 END) as side1_games,
        SUM(CASE WHEN fms.faction_side = 1 THEN fms.wins ELSE 0 END) as side1_wins,
        CASE WHEN SUM(CASE WHEN fms.faction_side = 1 THEN fms.total_games ELSE 0 END) > 0
          THEN ROUND(100.0 * SUM(CASE WHEN fms.faction_side = 1 THEN fms.wins ELSE 0 END)
            / SUM(CASE WHEN fms.faction_side = 1 THEN fms.total_games ELSE 0 END), 2)
          ELSE NULL END as side1_winrate,
        SUM(CASE WHEN fms.faction_side = 2 THEN fms.total_games ELSE 0 END) as side2_games,
        SUM(CASE WHEN fms.faction_side = 2 THEN fms.wins ELSE 0 END) as side2_wins,
        CASE WHEN SUM(CASE WHEN fms.faction_side = 2 THEN fms.total_games ELSE 0 END) > 0
          THEN ROUND(100.0 * SUM(CASE WHEN fms.faction_side = 2 THEN fms.wins ELSE 0 END)
            / SUM(CASE WHEN fms.faction_side = 2 THEN fms.total_games ELSE 0 END), 2)
          ELSE NULL END as side2_winrate,
        MAX(fms.last_updated) as last_updated
      FROM faction_map_statistics fms
      JOIN factions f ON fms.faction_id = f.id
      GROUP BY f.id, f.name
      HAVING SUM(fms.total_games) >= ?
      ORDER BY global_winrate DESC`,
      [minGames]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching global faction statistics:', error);
    res.status(500).json({ error: 'Failed to fetch global faction statistics' });
  }
});

/**
 * Get map statistics (which maps have best balance)
 * Groups by map only to avoid duplicates from bidirectional matchups
 */
router.get('/map-balance', async (req, res) => {
  try {
    const minGames = req.query.minGames === undefined ? 5 : Number(req.query.minGames);
    if (!Number.isInteger(minGames) || minGames < 1 || minGames > 1000000) {
      return res.status(400).json({ error: 'minGames must be a positive integer' });
    }
    const result = await query(
      `SELECT 
        gm.id as map_id,
        gm.name as map_name,
        COUNT(DISTINCT fms.faction_id) as factions_used,
        ROUND(SUM(fms.total_games) / 2) as total_games,
        ROUND(STDDEV(fms.winrate), 2) as avg_imbalance,
        MIN(fms.winrate) as lowest_winrate,
        MAX(fms.winrate) as highest_winrate,
        MAX(fms.last_updated) as last_updated,
        STDDEV(fms.winrate) as stddev_full_precision
      FROM faction_map_statistics fms
      JOIN game_maps gm ON fms.map_id = gm.id
      GROUP BY gm.id, gm.name
      HAVING SUM(fms.total_games) >= ?
      ORDER BY avg_imbalance ASC`,
      [minGames * 2]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching map balance statistics:', error);
    res.status(500).json({ error: 'Failed to fetch map balance statistics' });
  }
});

/**
 * Get statistics for a specific faction across all maps
 */
router.get('/faction/:factionId', async (req, res) => {
  try {
    const { factionId } = req.params;
    
    const result = await query(
      `SELECT 
        gm.id as map_id,
        gm.name as map_name,
        f2.id as opponent_faction_id,
        f2.name as opponent_faction_name,
        fms.total_games,
        fms.wins,
        fms.losses,
        fms.winrate,
        fms.last_updated
      FROM faction_map_statistics fms
      JOIN game_maps gm ON fms.map_id = gm.id
      JOIN factions f2 ON fms.opponent_faction_id = f2.id
      WHERE fms.faction_id = ?
      AND fms.total_games >= 2
      ORDER BY gm.name, fms.winrate DESC`,
      [factionId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching faction statistics:', error);
    res.status(500).json({ error: 'Failed to fetch faction statistics' });
  }
});

/**
 * Get statistics for a specific map
 */
router.get('/map/:mapId', async (req, res) => {
  try {
    const { mapId } = req.params;
    
    const result = await query(
      `SELECT 
        f.id as faction_id,
        f.name as faction_name,
        fms.total_games,
        fms.wins,
        fms.losses,
        fms.winrate,
        fms.last_updated
      FROM faction_map_statistics fms
      JOIN factions f ON fms.faction_id = f.id
      WHERE fms.map_id = ?
      AND fms.total_games >= 2
      ORDER BY fms.winrate DESC`,
      [mapId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching map statistics:', error);
    res.status(500).json({ error: 'Failed to fetch map statistics' });
  }
});

// ===== BALANCE HISTORY ENDPOINTS =====

/**
 * Get balance history for a specific faction/map matchup
 * Returns daily snapshots of winrate over a date range
 */
router.get('/history/trend', async (req, res) => {
  try {
    const { mapId, factionId, opponentFactionId, dateFrom, dateTo } = req.query;
    
    if (!mapId || !factionId || !opponentFactionId || !dateFrom || !dateTo) {
      return res.status(400).json({ error: 'Missing required parameters: mapId, factionId, opponentFactionId, dateFrom, dateTo' });
    }
    
    const rows = await getBalanceTrend(
      mapId as string,
      factionId as string,
      opponentFactionId as string,
      new Date(dateFrom as string),
      new Date(dateTo as string)
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Error fetching balance trend:', error);
    res.status(500).json({ error: 'Failed to fetch balance trend' });
  }
});

/**
 * Get all balance events with optional filtering
 * Used to mark balance patches and changes
 */
router.get('/history/events', async (req, res) => {
  try {
    const { factionId, mapId, eventType, limit = '50', offset = '0' } = req.query;
    const pagination = parseBalancePagination(limit, offset);
    if (!pagination) {
      return res.status(400).json({ error: 'limit must be 1-1000 and offset must be a non-negative integer' });
    }
    if (eventType && (typeof eventType !== 'string' || !BALANCE_EVENT_TYPES.has(eventType))) {
      return res.status(400).json({ error: 'Invalid eventType' });
    }
    
    let whereClause = '';
    const params: any[] = [];
    
    if (factionId) {
      whereClause += `faction_id = ? `;
      params.push(factionId);
    }
    
    if (mapId) {
      if (whereClause) whereClause += 'AND ';
      whereClause += `map_id = ? `;
      params.push(mapId);
    }
    
    if (eventType) {
      if (whereClause) whereClause += 'AND ';
      whereClause += `event_type = ? `;
      params.push(eventType);
    }
    
    if (whereClause) whereClause = 'WHERE ' + whereClause;
    
    params.push(pagination.limit);
    params.push(pagination.offset);
    
    const result = await query(
      `SELECT 
        be.id,
        be.event_date,
        be.patch_version,
        be.event_type,
        be.description,
        be.snapshot_before_date,
        be.snapshot_after_date,
        (
          SELECT MAX(previous_event.event_date)
          FROM balance_events previous_event
          WHERE previous_event.event_date < be.event_date
        ) AS previous_event_date,
        (
          SELECT MIN(next_event.event_date)
          FROM balance_events next_event
          WHERE next_event.event_date > be.event_date
        ) AS next_event_date,
        f.name as faction_name,
        gm.name as map_name,
        u.nickname as created_by_name
      FROM balance_events be
      LEFT JOIN factions f ON be.faction_id = f.id
      LEFT JOIN game_maps gm ON be.map_id = gm.id
      LEFT JOIN users_extension u ON be.created_by = u.id
      ${whereClause}
      ORDER BY be.event_date DESC
      LIMIT ? OFFSET ?`,
      params
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching balance events:', error);
    res.status(500).json({ error: 'Failed to fetch balance events' });
  }
});

/**
 * Get balance event forward impact (from event onwards)
 * Shows stats from the event date until next event or today
 */
router.get('/history/events/:eventId/impact', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // First, verify the event exists
    const eventCheck = await query(
      `SELECT id, event_date, event_type, description, faction_id, map_id 
       FROM balance_events WHERE id = ?`,
      [eventId]
    );
    
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Balance event not found' });
    }

    const impactRows = await getBalanceEventIntervalImpact(eventId);
    res.json(impactRows);
  } catch (error) {
    console.error('Error fetching event impact:', error);
    res.status(500).json({ error: 'Failed to fetch event impact' });
  }
});

/**
 * Get snapshot data for a specific date (public endpoint)
 * Shows all faction/map combinations as they were on that date
 */
router.get('/history/snapshot', async (req, res) => {
  try {
    const { date, minGames = '2' } = req.query;
    
    const snapshotDate = parseBalanceDate(date);
    const parsedMinGames = Number(minGames);
    if (!snapshotDate) {
      return res.status(400).json({ error: 'Missing required parameter: date' });
    }
    if (!Number.isInteger(parsedMinGames) || parsedMinGames < 1 || parsedMinGames > 1000000) {
      return res.status(400).json({ error: 'minGames must be a positive integer' });
    }
    
    const result = await query(
      `SELECT 
        gm.id as map_id,
        gm.name as map_name,
        f1.id as faction_id,
        f1.name as faction_name,
        f2.id as opponent_faction_id,
        f2.name as opponent_faction_name,
        fms.total_games,
        fms.wins,
        fms.losses,
        fms.winrate,
        fms.sample_size_category,
        fms.confidence_level,
        fms.snapshot_date
      FROM faction_map_statistics_history fms
      JOIN game_maps gm ON fms.map_id = gm.id
      JOIN factions f1 ON fms.faction_id = f1.id
      JOIN factions f2 ON fms.opponent_faction_id = f2.id
      WHERE fms.snapshot_date = CAST(? AS DATE)
      AND fms.total_games >= ?
      ORDER BY gm.name, fms.winrate DESC`,
      [snapshotDate, parsedMinGames]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching snapshot:', error);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

/**
 * Create a new balance event (admin only).
 * Records a patch or balance change
 */
router.post('/history/events', authMiddleware, adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { event_date, patch_version, event_type, description, faction_id, map_id, notes } = req.body;
    const userId = req.userId;
    
    if (!parseBalanceDate(event_date) || !event_type || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'Missing required fields: event_date, event_type, description' });
    }
    
    if (typeof event_type !== 'string' || !BALANCE_EVENT_TYPES.has(event_type)) {
      return res.status(400).json({ error: 'Invalid event_type' });
    }
    if (patch_version !== undefined && patch_version !== null && String(patch_version).length > 20) {
      return res.status(400).json({ error: 'patch_version must be at most 20 characters' });
    }
    
    const eventId = uuidv4();
    
    const params = [eventId, event_date, patch_version ?? null, event_type, description.trim(), faction_id ?? null, map_id ?? null, notes ?? null, userId ?? null];
    
    await query(
      `INSERT INTO balance_events (id, event_date, patch_version, event_type, description, faction_id, map_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
    const inserted = await query(
      'SELECT id, event_date, patch_version, event_type, description, created_at FROM balance_events WHERE id = ?',
      [eventId]
    );

    await logAuditEvent({
      event_type: 'ADMIN_ACTION',
      user_id: req.userId,
      username: req.username,
      ip_address: getUserIP(req),
      user_agent: getUserAgent(req),
      details: { action: 'BALANCE_EVENT_CREATED', event_id: eventId, event_type },
    });
    
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    console.error('Error creating balance event:', error);
    res.status(500).json({ error: 'Failed to create balance event' });
  }
});

/**
 * Update a balance event (admin only)
 * Edit an existing balance event
 */
router.put('/history/events/:eventId', authMiddleware, adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { eventId } = req.params;
    const { event_date, patch_version, event_type, description, faction_id, map_id, notes } = req.body;
    
    if (!parseBalanceDate(event_date) || !event_type || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'Missing required fields: event_date, event_type, description' });
    }
    
    if (typeof event_type !== 'string' || !BALANCE_EVENT_TYPES.has(event_type)) {
      return res.status(400).json({ error: 'Invalid event_type' });
    }
    if (patch_version !== undefined && patch_version !== null && String(patch_version).length > 20) {
      return res.status(400).json({ error: 'patch_version must be at most 20 characters' });
    }
    
    const updateResult = await query(
      `UPDATE balance_events 
       SET event_date = ?, patch_version = ?, event_type = ?, description = ?, faction_id = ?, map_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [event_date, patch_version ?? null, event_type, description.trim(), faction_id ?? null, map_id ?? null, notes ?? null, eventId]
    );
    
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Balance event not found' });
    }
    const updated = await query(
      'SELECT id, event_date, patch_version, event_type, description, updated_at FROM balance_events WHERE id = ?',
      [eventId]
    );

    await logAuditEvent({
      event_type: 'ADMIN_ACTION',
      user_id: req.userId,
      username: req.username,
      ip_address: getUserIP(req),
      user_agent: getUserAgent(req),
      details: { action: 'BALANCE_EVENT_UPDATED', event_id: eventId, event_type },
    });
    
    res.json(updated.rows[0]);
  } catch (error) {
    console.error('Error updating balance event:', error);
    res.status(500).json({ error: 'Failed to update balance event' });
  }
});

/**
 * Manually create a snapshot for a specific date (admin only)
 * Useful for backfilling historical data
 */
router.post('/history/snapshot', authMiddleware, adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { date } = req.body;
    
    const snapshotDate = parseBalanceDate(date);
    if (!snapshotDate) {
      return res.status(400).json({ error: 'Missing required field: date' });
    }
    
    const { snapshots_created, snapshots_skipped } = await createFactionMapStatisticsSnapshot(new Date(`${snapshotDate}T00:00:00Z`));

    await logAuditEvent({
      event_type: 'ADMIN_ACTION',
      user_id: req.userId,
      username: req.username,
      ip_address: getUserIP(req),
      user_agent: getUserAgent(req),
      details: { action: 'BALANCE_SNAPSHOT_BACKFILLED', snapshot_date: snapshotDate, snapshots_created, snapshots_skipped },
    });

    res.json({ 
      message: 'Snapshot created successfully',
      snapshots_created,
      snapshots_skipped,
      date: snapshotDate
    });
  } catch (error) {
    console.error('Error creating snapshot:', error);
    res.status(500).json({ error: 'Failed to create snapshot' });
  }
});

/**
 * Recalculate all historical snapshots (admin only)
 * Creates snapshots for all dates from earliest match to today
 * Useful when adding balance events retroactively
 */
export default router;
