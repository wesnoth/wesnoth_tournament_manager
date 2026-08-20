import { Router } from 'express';
import { query } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { searchLimiter } from '../middleware/rateLimiter.js';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';
import { avatarManifestService } from '../services/avatarManifestService.js';
import { validateTimezone, validateAvailabilitySchedule } from '../utils/timezoneUtils.js';
import { isValidDiscordSnowflake, validateDiscordId } from '../services/discord.js';

const router = Router();

// Get user profile
router.get('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userResult = await query(
      `SELECT 
        u.id, 
        u.nickname, 
        u.language, 
        u.discord_id, 
        u.elo_rating, 
        u.level, 
        u.is_admin, 
        u.is_streamer,
        u.created_at, 
        u.is_rated, 
        COALESCE(pms.total_games, u.matches_played) AS matches_played,
        COALESCE(pms.wins, u.total_wins) AS total_wins,
        COALESCE(pms.losses, u.total_losses) AS total_losses,
        u.trend,
        u.is_active,
        u.country,
        u.avatar,
        u.enable_ranked,
        CASE WHEN u.is_blocked = 0 THEN (
          SELECT COUNT(*) + 1 FROM users_extension ranked_user
          WHERE ranked_user.is_blocked = 0
            AND (ranked_user.elo_rating > u.elo_rating
              OR (ranked_user.elo_rating = u.elo_rating AND ranked_user.id < u.id))
        ) ELSE NULL END AS global_ranking_position,
        u.timezone,
        u.availability_schedule,
        pms.avg_elo_change
      FROM users_extension u
      LEFT JOIN player_match_statistics pms ON u.id = pms.player_id 
        AND pms.opponent_id IS NULL 
        AND pms.map_id IS NULL 
        AND pms.faction_id IS NULL
        AND pms.player_side = 0
      WHERE u.id = ?`,
      [req.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Get last activity from most recent match (any status except cancelled)
    const lastActivityResult = await query(
      `SELECT created_at FROM matches WHERE (winner_id = ? OR loser_id = ?) AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`,
      [req.userId, req.userId]
    );

    // Parse JSON fields
    if (user.availability_schedule && typeof user.availability_schedule === 'string') {
      user.availability_schedule = JSON.parse(user.availability_schedule);
    }

    const result = {
      ...user,
      last_activity: lastActivityResult.rows[0]?.created_at || null
    };

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
      `SELECT COUNT(*) as total FROM matches WHERE (winner_id = ? OR loser_id = ?) AND status != 'cancelled'`,
      [id, id]
    );

    const winsResult = await query("SELECT COUNT(*) as wins FROM matches WHERE winner_id = ? AND status != 'cancelled'", [id]);
    const lossesResult = await query("SELECT COUNT(*) as losses FROM matches WHERE loser_id = ? AND status != 'cancelled'", [id]);

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

    const userResult = await query(
      `SELECT elo_rating FROM users_extension WHERE id = ?`,
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentElo = Number(userResult.rows[0].elo_rating ?? 1400);

    const result = await query(
      `SELECT
        m.id,
        m.winner_id,
        m.loser_id,
        m.created_at,
        m.elo_change,
        m.winner_elo_before,
        m.winner_elo_after,
        m.loser_elo_before,
        m.loser_elo_after,
        w.nickname AS winner_nickname,
        l.nickname AS loser_nickname
      FROM matches m
      JOIN users_extension w ON m.winner_id = w.id
      JOIN users_extension l ON m.loser_id = l.id
      WHERE (m.winner_id = ? OR m.loser_id = ?)
        AND m.status != 'cancelled'
      ORDER BY m.created_at DESC`,
      [id, id]
    );

    let runningElo = currentElo;

    const historyDesc = result.rows.map((match: any) => {
      const isWinner = match.winner_id === id;
      const eloAfterRaw = isWinner ? match.winner_elo_after : match.loser_elo_after;
      const eloBeforeRaw = isWinner ? match.winner_elo_before : match.loser_elo_before;
      const deltaRaw = Number(match.elo_change ?? 0);
      const deltaForPlayer = isWinner ? deltaRaw : -deltaRaw;

      const parsedEloAfter = Number(eloAfterRaw);
      if (Number.isFinite(parsedEloAfter)) {
        runningElo = parsedEloAfter;
      }

      const playerEloAfter = runningElo;

      const parsedEloBefore = Number(eloBeforeRaw);
      if (Number.isFinite(parsedEloBefore)) {
        runningElo = parsedEloBefore;
      } else {
        runningElo = playerEloAfter - deltaForPlayer;
      }

      return {
        ...match,
        player_elo_after: playerEloAfter,
      };
    });

    res.json(historyDesc.reverse());
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
    const includePending = req.query.include_pending === 'true';

    console.log('GET /users/:id/matches filters:', { playerFilter, mapFilter, statusFilter, factionFilter, includePending });

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
      whereConditions.push(`(LOWER(w.nickname) LIKE ? OR LOWER(l.nickname) LIKE ?)`);
      params.push(`%${playerFilter.toLowerCase()}%`);
      params.push(`%${playerFilter.toLowerCase()}%`);
    }

    if (mapFilter) {
      whereConditions.push(`LOWER(m.map) LIKE ?`);
      params.push(`%${mapFilter.toLowerCase()}%`);
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

    // Get total count of filtered matches
    const countQuery = `SELECT COUNT(*) as total FROM matches m 
                        JOIN users_extension w ON m.winner_id = w.id 
                        JOIN users_extension l ON m.loser_id = l.id 
                        WHERE ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get matches for current page with filters
    const matchParams = [...params];
    if (!includePending) {
      matchParams.push(limit);
      matchParams.push(offset);
    }
    const result = await query(
      `SELECT 
        m.*,
        w.nickname as winner_nickname,
        l.nickname as loser_nickname
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE ${whereClause}
       ORDER BY m.created_at DESC, m.id DESC
       ${includePending ? '' : 'LIMIT ? OFFSET ?'}`,
      matchParams
    );

    // Get pending replays for this user with confidence=1
    let formattedReplays: any[] = [];
    if (includePending && userNickname) {
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
             AND NOT EXISTS (SELECT 1 FROM matches linked_match WHERE linked_match.replay_id = r.id)
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

            if (statusFilter && statusFilter !== 'pending_report') {
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
      return bTime - aTime || String(b.id).localeCompare(String(a.id));
    });

    // Pending replays are merged in memory only for the authenticated profile;
    // public profiles use SQL pagination and never scan the replay queue.
    const paginatedResults = includePending
      ? allResults.slice(offset, offset + limit)
      : allResults;
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

// Store the user's canonical Discord snowflake ID.
router.put('/profile/discord', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { discord_id } = req.body;
    if (typeof discord_id !== 'string' || discord_id.trim() === '') {
      return res.status(400).json({ error: 'Discord ID cannot be empty' });
    }

    const trimmedDiscordId = discord_id.trim();

    // Validate Discord Snowflake format and validity
    if (!isValidDiscordSnowflake(trimmedDiscordId)) {
      return res.status(400).json({ 
        error: 'Invalid Discord ID. Must be a valid Discord user ID (17-20 digits).' 
      });
    }

    await query(
      `UPDATE users_extension SET discord_id = ? WHERE id = ?`,
      [trimmedDiscordId, req.userId]
    );

    const result = await query(
      `SELECT id, nickname, language, discord_id, country, avatar, elo_rating, level, created_at FROM users_extension WHERE id = ?`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating Discord ID:', error);
    res.status(500).json({ error: 'Failed to update Discord ID' });
  }
});

// Validate the supplied Discord snowflake against the configured guild.
router.post('/profile/discord/validate', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { discord_id } = req.body;

    if (typeof discord_id !== 'string' || discord_id.trim() === '') {
      return res.status(400).json({ error: 'Discord ID cannot be empty' });
    }

    const validationResult = await validateDiscordId(discord_id);
    if (!validationResult) {
      return res.status(400).json({
        error: 'Invalid Discord ID or user not found in the Discord guild',
      });
    }

    return res.json({
      success: true,
      discord_id: validationResult.discordId,
      nickname: validationResult.nickname,
    });
  } catch (error) {
    console.error('Error validating Discord ID:', error);
    return res.status(500).json({ error: 'Failed to validate Discord ID' });
  }
});

// Update mutable user preferences owned by the authenticated profile.
router.put('/profile/update', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { country, avatar, language, timezone, availability_schedule } = req.body;

    if (!country && !avatar && !language && !timezone && !availability_schedule) {
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

    if (language) {
      // Keep the stored preference aligned with the locales shipped by the frontend.
      const supportedLanguages = new Set(['en', 'es', 'zh', 'de', 'ru']);
      if (!supportedLanguages.has(language)) {
        return res.status(400).json({ error: 'Unsupported language' });
      }
      updateFields.push(`language = ?`);
      params.push(language);
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
    const parsedMinElo = req.query.min_elo ? Number.parseInt(req.query.min_elo as string, 10) : NaN;
    const parsedMaxElo = req.query.max_elo ? Number.parseInt(req.query.max_elo as string, 10) : NaN;
    const minElo = Number.isFinite(parsedMinElo) ? parsedMinElo : null;
    const maxElo = Number.isFinite(parsedMaxElo) ? parsedMaxElo : null;

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
      whereConditions.push(`LOWER(u.nickname) LIKE ?`);
      params.push(`%${nicknameFilter.toLowerCase()}%`);
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
      `SELECT u.id, u.nickname, u.elo_rating, u.level, u.is_rated, u.matches_played, u.total_wins, u.total_losses, u.country, u.avatar, COALESCE(u.trend, '-') as trend,
              CASE WHEN u.is_blocked = 0 THEN (
                SELECT COUNT(*) + 1 FROM users_extension ranked_user
                WHERE ranked_user.is_blocked = 0
                  AND (ranked_user.elo_rating > u.elo_rating
                    OR (ranked_user.elo_rating = u.elo_rating AND ranked_user.id < u.id))
              ) ELSE NULL END AS global_ranking_position
       FROM users_extension u
       WHERE ${whereClause}
       ORDER BY ${sortByExpr} ${sortOrder}, u.id ASC
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
      `SELECT id, nickname, elo_rating, level, is_rated, country, avatar, created_at,
              CASE WHEN is_blocked = 0 THEN (
                SELECT COUNT(*) + 1 FROM users_extension ranked_user
                WHERE ranked_user.is_blocked = 0
                  AND (ranked_user.elo_rating > users_extension.elo_rating
                    OR (ranked_user.elo_rating = users_extension.elo_rating AND ranked_user.id < users_extension.id))
              ) ELSE NULL END AS global_ranking_position
       FROM users_extension
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

// Get the manifest generated during the backend build or startup.
router.get('/data/avatar-manifest', async (req, res) => {
  try {
    const manifest = avatarManifestService.readAvatarManifest();
    res.json(manifest);
  } catch (error) {
    console.error('Avatar manifest error:', error);
    res.status(500).json({ error: 'Failed to fetch avatar manifest', details: (error as any).message });
  }
});

export default router;
