import { Router } from 'express';
import { query } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { searchLimiter } from '../middleware/rateLimiter.js';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';
import { avatarManifestService } from '../services/avatarManifestService.js';
import { validateTimezone, validateAvailabilitySchedule } from '../utils/timezoneUtils.js';

const router = Router();

// Get user profile
router.get('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log(`[PROFILE] Fetching profile for userId: ${req.userId}`);
    
    const userResult = await query(
      `SELECT 
        u.id, 
        u.nickname, 
        u.language, 
        u.discord_id, 
        u.elo_rating, 
        u.level, 
        u.is_admin, 
        u.created_at, 
        u.is_rated, 
        u.matches_played, 
        u.total_wins, 
        u.total_losses, 
        u.trend,
        u.is_active,
        u.country,
        u.avatar,
        u.enable_ranked,
        u.timezone,
        u.availability_schedule,
        pms.avg_elo_change
      FROM users_extension u
      LEFT JOIN player_match_statistics pms ON u.id = pms.player_id 
        AND pms.opponent_id IS NULL 
        AND pms.map_id IS NULL 
        AND pms.faction_id IS NULL
      WHERE u.id = ?`,
      [req.userId]
    );

    console.log(`[PROFILE] Query returned ${userResult.rows.length} rows for userId: ${req.userId}`);
    
    if (userResult.rows.length === 0) {
      console.log(`[PROFILE] User not found in users_extension with ID: ${req.userId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get last activity from most recent match (any status except cancelled)
    const lastActivityResult = await query(
      `SELECT created_at FROM matches WHERE (winner_id = ? OR loser_id = ?) AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`,
      [req.userId, req.userId]
    );

    console.log(`[User ${req.userId}] Last activity query result:`, lastActivityResult.rows);

    // Parse JSON fields
    if (user.availability_schedule && typeof user.availability_schedule === 'string') {
      user.availability_schedule = JSON.parse(user.availability_schedule);
    }

    const result = {
      ...user,
      last_activity: lastActivityResult.rows[0]?.created_at || null
    };

    console.log(`[User ${req.userId}] Final result:`, result);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Get user stats
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    const matchesResult = await query(
      `SELECT COUNT(*) as total FROM matches WHERE (winner_id = ? OR loser_id = ?) AND status = 'confirmed'`,
      [id, id]
    );

    const winsResult = await query("SELECT COUNT(*) as wins FROM matches WHERE winner_id = ? AND status = 'confirmed'", [id]);
    const lossesResult = await query("SELECT COUNT(*) as losses FROM matches WHERE loser_id = ? AND status = 'confirmed'", [id]);

    const userResult = await query('SELECT elo_rating, level FROM users_extension WHERE id = ?', [id]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      total_matches: matchesResult.rows[0].total,
      wins: winsResult.rows[0].wins,
      losses: lossesResult.rows[0].losses,
      elo_rating: userResult.rows[0].elo_rating,
      level: userResult.rows[0].level,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get full ELO history for charting (confirmed matches only, no pagination)
router.get('/:id/elo-history', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT
        m.id,
        m.winner_id,
        m.loser_id,
        m.created_at,
        m.winner_elo_after,
        m.loser_elo_after,
        w.nickname AS winner_nickname,
        l.nickname AS loser_nickname
      FROM matches m
      JOIN users_extension w ON m.winner_id = w.id
      JOIN users_extension l ON m.loser_id = l.id
      WHERE (m.winner_id = ? OR m.loser_id = ?)
        AND m.status = 'confirmed'
        AND m.winner_elo_after IS NOT NULL
        AND m.loser_elo_after IS NOT NULL
      ORDER BY m.created_at ASC`,
      [id, id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching ELO history:', error);
    res.status(500).json({ error: 'Failed to fetch ELO history' });
  }
});

// Get user matches with pagination and filters (includes pending replays)
router.get('/:id/matches', async (req, res) => {
  try {
    console.log('🔍🔍🔍 GET /users/:id/matches endpoint called with id:', req.params.id);
    console.log('🔍🔍🔍 Query string:', req.query);
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get filter params from query
    const playerFilter = (req.query.player as string)?.trim() || '';
    const mapFilter = (req.query.map as string)?.trim() || '';
    const statusFilter = (req.query.status as string)?.trim() || '';
    const factionFilter = (req.query.faction as string)?.trim() || '';

    console.log('🔍 GET /users/:id/matches - Filters received:', { playerFilter, mapFilter, statusFilter, factionFilter });

    // Get user nickname to match against replay participants
    const userResult = await query(
      `SELECT nickname FROM users_extension WHERE id = ?`,
      [id]
    );
    const userNickname = userResult.rows[0]?.nickname?.toLowerCase() || '';
    console.log('🔍 User nickname:', userNickname);

    // Build WHERE clause dynamically for matches
    let whereConditions: string[] = ['(m.winner_id = ? OR m.loser_id = ?)'];
    let params: any[] = [id, id];  // id appears twice in WHERE clause

    if (playerFilter) {
      whereConditions.push(`(w.nickname LIKE ? OR l.nickname LIKE ?)`);
      params.push(`%${playerFilter}%`);
      params.push(`%${playerFilter}%`);
    }

    if (mapFilter) {
      whereConditions.push(`m.map LIKE ?`);
      params.push(`%${mapFilter}%`);
    }

    if (statusFilter) {
      whereConditions.push(`m.status = ?`);
      params.push(statusFilter);
    }

    if (factionFilter) {
      whereConditions.push(`(m.winner_faction = ? OR m.loser_faction = ?)`);
      params.push(factionFilter);
      params.push(factionFilter);
      console.log('🔍 Faction filter applied:', factionFilter);
    }

    const whereClause = whereConditions.join(' AND ');

    console.log('🔍 WHERE clause:', whereClause);
    console.log('🔍 Query params (matches):', params);

    // Get total count of filtered matches
    const countQuery = `SELECT COUNT(*) as total FROM matches m 
                        JOIN users_extension w ON m.winner_id = w.id 
                        JOIN users_extension l ON m.loser_id = l.id 
                        WHERE ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get matches for current page with filters
    const matchParams = [...params];
    matchParams.push(limit);
    matchParams.push(offset);
    const result = await query(
      `SELECT 
        m.*,
        w.nickname as winner_nickname,
        l.nickname as loser_nickname
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      matchParams
    );

    console.log('🔍 Query returned', result.rows.length, 'matches');

    // Get pending replays for this user with confidence=1
    let formattedReplays: any[] = [];
    if (userNickname) {
      try {
        const replayResult = await query(
          `SELECT 
            r.id, 
            r.replay_filename,
            r.game_name,
            r.replay_url,
            r.parse_summary,
            r.created_at,
            r.wesnoth_version,
            r.cancel_requested_by
           FROM replays r
           WHERE r.integration_confidence = 1 
             AND r.parsed = 1
             AND r.parse_status != 'rejected'
             AND r.match_id IS NULL
             AND r.tournament_id IS NULL
           ORDER BY r.created_at DESC`,
          []
        );

        console.log(`📋 [USER/MATCHES] Found ${replayResult.rows?.length || 0} confidence=1 replays to check`);

        for (const r of replayResult.rows) {
          try {
            const parseSummary = typeof r.parse_summary === 'string' 
              ? JSON.parse(r.parse_summary) 
              : r.parse_summary;

            const players = parseSummary.forumPlayers || [];
            if (players.length < 2) continue;

            const player1Name = players[0]?.user_name?.toLowerCase() || '';
            const player2Name = players[1]?.user_name?.toLowerCase() || '';

            // Only include replays where this user is a participant
            if (userNickname !== player1Name && userNickname !== player2Name) {
              continue;
            }

            // Apply filters to replay data
            const map = parseSummary.resolvedMap 
              || parseSummary.parsedMap 
              || parseSummary.map 
              || parseSummary.forumMap 
              || parseSummary.scenario
              || 'Unknown Map';

            if (mapFilter && !map.toLowerCase().includes(mapFilter.toLowerCase())) {
              continue;
            }

            // Extract factions
            const resolvedFactions = parseSummary.resolvedFactions || {};
            const winnerName = parseSummary.replayVictory?.winner_name || players[0]?.user_name || 'Unknown';
            const loserName  = parseSummary.replayVictory?.loser_name  || players[1]?.user_name || 'Unknown';

            const winnerPlayer = players.find((p: any) => p.user_name === winnerName);
            const loserPlayer  = players.find((p: any) => p.user_name === loserName);

            const winner_faction = (winnerPlayer ? resolvedFactions[`side${winnerPlayer.side_number}`] : null) || 'Unknown';
            const loser_faction  = (loserPlayer  ? resolvedFactions[`side${loserPlayer.side_number}`]  : null) || 'Unknown';
            const winner_side = winnerPlayer?.side_number || null;
            const loser_side = loserPlayer?.side_number || null;

            if (factionFilter) {
              if (winner_faction.toLowerCase() !== factionFilter.toLowerCase() && 
                  loser_faction.toLowerCase() !== factionFilter.toLowerCase()) {
                continue;
              }
            }

            if (playerFilter) {
              if (!winnerName.toLowerCase().includes(playerFilter.toLowerCase()) &&
                  !loserName.toLowerCase().includes(playerFilter.toLowerCase())) {
                continue;
              }
            }

            const replayData = {
              id: r.id,
              winner_id: null,
              loser_id: null,
              winner_nickname: winnerName,
              loser_nickname: loserName,
              winner_faction: winner_faction,
              loser_faction: loser_faction,
              winner_side: winner_side,
              loser_side: loser_side,
              map: map,
              status: 'pending_report',
              winner_elo_before: null,
              winner_elo_after: null,
              loser_elo_before: null,
              loser_elo_after: null,
              winner_rating: null,
              loser_rating: null,
              winner_comments: null,
              loser_comments: null,
              replay_url: r.replay_url,
              replay_downloads: 0,
              created_at: r.created_at,
              updated_at: r.created_at,
              played_at: null,
              admin_reviewed: false,
              tournament_id: null,
              source_type: 'replay_confidence_1',
              replay_id: r.id,
              confidence_level: 1,
              parse_summary: parseSummary,
              replay_filename: r.replay_filename,
              game_name: r.game_name,
              cancel_requested_by: r.cancel_requested_by || null,
              is_admin_view: false,
              is_participant: true
            };

            console.log(`📋 [REPLAY] ${replayData.winner_nickname} (${winner_faction}) vs ${replayData.loser_nickname} (${loser_faction}) on ${map}`);
            formattedReplays.push(replayData);
          } catch (formatError) {
            console.error('Error formatting replay:', formatError);
          }
        }
      } catch (replayQueryError) {
        console.error('❌ [USER/MATCHES] Error fetching replays:', replayQueryError);
      }
    }

    // Combine matches and replays
    const allResults = [...result.rows, ...formattedReplays];
    
    // Sort by created_at DESC
    allResults.sort((a: any, b: any) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime;
    });

    // Paginate combined results
    const paginatedResults = allResults.slice(0, limit);
    const combinedTotal = total + formattedReplays.length;
    const totalPages = Math.ceil(combinedTotal / limit);

    res.json({
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: combinedTotal,
        totalPages,
        showing: paginatedResults.length
      }
    });
  } catch (error) {
    console.error('Error fetching user matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// Search users - RATE LIMITED
router.get('/search/:searchQuery', searchLimiter, async (req, res) => {
  try {
    const { searchQuery } = req.params;

    const result = await query(
      `SELECT id, nickname, elo_rating, level FROM users_extension 
       WHERE nickname LIKE ? AND is_active = 1 AND is_blocked = 0
       LIMIT 20`,
      [`%${searchQuery}%`]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Update Discord ID
router.put('/profile/discord', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { discord_id } = req.body;
    console.log('Update Discord ID request:', { discord_id, userId: req.userId });

    if (!discord_id || discord_id.trim() === '') {
      return res.status(400).json({ error: 'Discord ID cannot be empty' });
    }

    await query(
      `UPDATE users_extension SET discord_id = ? WHERE id = ?`,
      [discord_id, req.userId]
    );

    const result = await query(
      `SELECT id, nickname, language, discord_id, country, avatar, elo_rating, level, created_at FROM users_extension WHERE id = ?`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('Discord ID updated successfully:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating Discord ID:', error);
    res.status(500).json({ error: 'Failed to update Discord ID' });
  }
});

// Update user profile (country and avatar)
router.put('/profile/update', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { country, avatar, timezone, availability_schedule } = req.body;

    if (!country && !avatar && !timezone && !availability_schedule) {
      return res.status(400).json({ error: 'At least one field is required' });
    }

    let updateFields: string[] = [];
    let params: any[] = [];

    if (country) {
      updateFields.push(`country = ?`);
      params.push(country);
    }

    if (avatar) {
      updateFields.push(`avatar = ?`);
      params.push(avatar);
    }

    // Validate and update timezone
    if (timezone) {
      if (!validateTimezone(timezone)) {
        return res.status(400).json({ error: 'Invalid timezone' });
      }
      updateFields.push(`timezone = ?`);
      params.push(timezone);
    }

    // Validate and update availability_schedule
    if (availability_schedule !== undefined) {
      if (availability_schedule === null) {
        updateFields.push(`availability_schedule = NULL`);
        updateFields.push(`availability_updated_at = NULL`);
      } else {
        const validation = validateAvailabilitySchedule(availability_schedule);
        if (!validation.valid) {
          return res.status(400).json({ 
            error: 'Invalid availability schedule',
            details: validation.errors 
          });
        }
        updateFields.push(`availability_schedule = ?`);
        params.push(JSON.stringify(availability_schedule));
        updateFields.push(`availability_updated_at = CURRENT_TIMESTAMP`);
      }
    }

    params.push(req.userId);

    await query(
      `UPDATE users_extension SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );

    const result = await query(
      `SELECT id, nickname, language, discord_id, country, avatar, timezone, availability_schedule, elo_rating, level, created_at FROM users_extension WHERE id = ?`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    // Parse JSON fields
    if (user.availability_schedule && typeof user.availability_schedule === 'string') {
      user.availability_schedule = JSON.parse(user.availability_schedule);
    }

    res.json(user);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile', details: (error as any).message });
  }
});

// Toggle enable_ranked for the authenticated user
// Once enabled, cannot be disabled (permanent)
router.put('/profile/ranked', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { enable_ranked } = req.body;

    if (typeof enable_ranked !== 'boolean') {
      return res.status(400).json({ error: 'enable_ranked must be a boolean' });
    }

    const userResult = await query(`SELECT nickname, enable_ranked FROM users_extension WHERE id = ?`, [req.userId]);
    const nickname = userResult.rows[0]?.nickname || null;
    const currentEnableRanked = userResult.rows[0]?.enable_ranked;

    // If trying to disable while already enabled, reject
    if (!enable_ranked && currentEnableRanked) {
      return res.status(400).json({ error: 'Ranked matches cannot be disabled once enabled' });
    }

    // Only update if there's an actual change
    if (enable_ranked !== currentEnableRanked) {
      await query(
        `UPDATE users_extension SET enable_ranked = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [enable_ranked ? 1 : 0, req.userId]
      );

      await logAuditEvent({
        event_type: 'PROFILE_UPDATE',
        user_id: req.userId,
        username: nickname,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: { field: 'enable_ranked', value: enable_ranked }
      });
    }

    res.json({ enable_ranked });
  } catch (error) {
    console.error('Error updating enable_ranked:', error);
    res.status(500).json({ error: 'Failed to update ranked preference' });
  }
});

// Get global ranking
router.get('/ranking/global', async (req, res) => {
  try {
    // Get page from query params, default to 1
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // Sort params — whitelist to prevent SQL injection
    const ALLOWED_SORT_COLUMNS: Record<string, string> = {
      elo_rating:     'u.elo_rating',
      nickname:       'u.nickname',
      matches_played: 'u.matches_played',
      total_wins:     'u.total_wins',
      total_losses:   'u.total_losses',
      win_percentage: '(u.total_wins * 1.0 / NULLIF(u.matches_played, 0))',
      trend:          'u.trend',
    };
    const sortByRaw = (req.query.sortBy as string) || 'elo_rating';
    const sortByExpr = ALLOWED_SORT_COLUMNS[sortByRaw] ?? 'u.elo_rating';
    const sortOrder = (req.query.sortOrder as string)?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Get filter params from query
    const nicknameFilter = (req.query.nickname as string)?.trim() || '';
    const minElo = req.query.min_elo ? parseInt(req.query.min_elo as string) : null;
    const maxElo = req.query.max_elo ? parseInt(req.query.max_elo as string) : null;

    // Build WHERE clause dynamically
    let whereConditions: string[] = [
      'u.is_active = 1',
      'u.is_blocked = 0',
      'u.is_rated = 1',
      'u.elo_rating >= 1400',
      'u.matches_played >= 10'
    ];
    let params: any[] = [];

    if (nicknameFilter) {
      whereConditions.push(`u.nickname LIKE ?`);
      params.push(`%${nicknameFilter}%`);
    }

    if (minElo !== null) {
      whereConditions.push(`u.elo_rating >= ?`);
      params.push(minElo);
    }

    if (maxElo !== null) {
      whereConditions.push(`u.elo_rating <= ?`);
      params.push(maxElo);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count of filtered players
    const countQuery = `SELECT COUNT(*) as total FROM users_extension u WHERE ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    // Get players for current page with filters
    params.push(limit);
    params.push(offset);
    const result = await query(
      `SELECT u.id, u.nickname, u.elo_rating, u.level, u.is_rated, u.matches_played, u.total_wins, u.total_losses, u.country, u.avatar, COALESCE(u.trend, '-') as trend 
       FROM users_extension u
       WHERE ${whereClause}
       ORDER BY ${sortByExpr} ${sortOrder}
       LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        showing: result.rows.length
      }
    });
  } catch (error) {
    console.error('Ranking error:', error);
    res.status(500).json({ error: 'Failed to fetch ranking', details: (error as any).message });
  }
});

// Get active ranking (with recent activity filter)
router.get('/ranking/active', async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.nickname, u.elo_rating, u.level, u.is_rated, u.matches_played, u.total_wins, u.total_losses, u.country, u.avatar, COALESCE(u.trend, '-') as trend
       FROM users_extension u
       WHERE u.is_active = 1
         AND u.is_blocked = 0
         AND u.is_rated = 1
         AND u.elo_rating >= 1400
         AND u.matches_played >= 10
       ORDER BY u.elo_rating DESC
       LIMIT 100`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Active ranking error:', error);
    res.status(500).json({ error: 'Failed to fetch active ranking', details: (error as any).message });
  }
});

// Get all active users for opponent selection (no rating filter)
router.get('/all', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, nickname, elo_rating, level, is_rated, country, avatar, created_at FROM users_extension 
       WHERE is_blocked = 0
       ORDER BY created_at DESC
       LIMIT 500`
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('All users error:', error);
    res.status(500).json({ error: 'Failed to fetch users', details: (error as any).message });
  }
});

// Get monthly statistics for a user
router.get('/:id/stats/month', async (req, res) => {
  try {
    const { id } = req.params;
    const now = new Date();
    const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get ELO change this month
    const eloChangeResult = await query(
      `SELECT 
        COALESCE(SUM(CASE WHEN winner_id = ? THEN elo_change ELSE -elo_change END), 0) as elo_gained
       FROM matches 
       WHERE (winner_id = ? OR loser_id = ?) 
         AND status = 'confirmed'
         AND created_at >= ?`,
      [id, id, id, monthAgo]
    );

    // Get previous month ELO to calculate ranking positions change
    const prevMonthEloResult = await query(
      `SELECT COALESCE(MIN(elo_rating), 0) as min_elo_month
       FROM (
         SELECT CASE 
           WHEN winner_id = ? THEN winner_elo_before
           ELSE loser_elo_before
         END as elo_rating
         FROM matches 
         WHERE (winner_id = ? OR loser_id = ?)
           AND status = 'confirmed'
           AND created_at >= ?
         ORDER BY created_at ASC
         LIMIT 1
       ) as first_month
      `,
      [id, id, id, monthAgo]
    );

    // Get current ELO
    const currentEloResult = await query(
      'SELECT elo_rating FROM users_extension WHERE id = ?',
      [id]
    );

    const eloGained = eloChangeResult.rows[0].elo_gained;
    const currentElo = currentEloResult.rows[0]?.elo_rating || 0;
    const prevMonthElo = prevMonthEloResult.rows[0]?.min_elo_month || currentElo;

    // Get ranking at start of month and current ranking
    const startRankingResult = await query(
      `SELECT COUNT(*) as rank_at_start 
       FROM users_extension u2 
       WHERE u2.is_active = 1
         AND u2.is_blocked = 0
         AND u2.is_rated = 1
         AND u2.elo_rating >= 1400
         AND (
           u2.elo_rating > ?
           OR (u2.elo_rating = ? AND u2.id < ?)
         )`,
      [prevMonthElo, prevMonthElo, id]
    );

    const currentRankingResult = await query(
      `SELECT COUNT(*) as current_rank 
       FROM users_extension u2 
       WHERE u2.is_active = 1
         AND u2.is_blocked = 0
         AND u2.is_rated = 1
         AND u2.elo_rating >= 1400
         AND (
           u2.elo_rating > ?
           OR (u2.elo_rating = ? AND u2.id < ?)
         )`,
      [currentElo, currentElo, id]
    );

    const rankAtStart = parseInt(startRankingResult.rows[0].rank_at_start) + 1;
    const currentRank = parseInt(currentRankingResult.rows[0].current_rank) + 1;
    const positionsGained = rankAtStart - currentRank;

    res.json({
      elo_gained: Math.round(eloGained),
      positions_gained: positionsGained,
      rank_start: rankAtStart,
      current_rank: currentRank
    });
  } catch (error) {
    console.error('Monthly stats error:', error);
    res.status(500).json({ error: 'Failed to fetch monthly stats', details: (error as any).message });
  }
});

// Get available countries with multilingual names
router.get('/data/countries', async (req, res) => {
  try {
    console.log('🔵 GET /data/countries called');
    // Get the preferred language from query params, default to English
    const lang = (req.query.lang as string || 'en').toLowerCase();
    console.log('📍 Language:', lang);
    
    const result = await query(
      `SELECT 
        code, 
        names_json, 
        flag_emoji,
        official_name,
        region
       FROM countries 
       WHERE is_active = 1 
       ORDER BY JSON_EXTRACT(names_json, '$.en') ASC`
    );
    
    console.log('✅ Query result rows:', result.rows.length);
    console.log('📊 First row:', result.rows[0]);

    // Transform the response to include the country name in the requested language
    const countries = result.rows.map(row => {
      let names: Record<string, string> = {};
      
      // Parse names_json if it's a string (JSON stored in DB)
      if (typeof row.names_json === 'string') {
        try {
          names = JSON.parse(row.names_json);
        } catch (e) {
          console.warn('Failed to parse names_json for country', row.code);
          names = {};
        }
      } else if (typeof row.names_json === 'object') {
        names = row.names_json;
      }
      
      const name = names[lang] || names['en'] || 'Unknown';
      
      return {
        code: row.code,
        name,
        flag: row.flag_emoji,
        official_name: row.official_name,
        region: row.region,
        names: names // Include all names for frontend flexibility
      };
    });
    
    console.log('📤 Sending response:', countries.length, 'countries');
    console.log('🏁 First country response:', countries[0]);
    
    res.json(countries);
  } catch (error) {
    console.error('❌ Countries error:', error);
    res.status(500).json({ error: 'Failed to fetch countries', details: (error as any).message });
  }
});

// Get available avatars
router.get('/data/avatars', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, icon_path, description FROM player_avatars WHERE is_active = 1 ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Avatars error:', error);
    res.status(500).json({ error: 'Failed to fetch avatars', details: (error as any).message });
  }
});

// Get avatar manifest (dynamically generated from PNG files)
router.get('/data/avatar-manifest', async (req, res) => {
  try {
    const manifest = await avatarManifestService.generateAvatarManifest();
    res.json(manifest);
  } catch (error) {
    console.error('Avatar manifest error:', error);
    res.status(500).json({ error: 'Failed to fetch avatar manifest', details: (error as any).message });
  }
});

export default router;
