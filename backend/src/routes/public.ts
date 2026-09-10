import { Router } from 'express';
import { query } from '../config/database.js';
import { getTournamentPlacements } from '../services/tournamentResultService.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { getCombinedMatchFeed } from '../services/combinedMatchFeedService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

// Serve wiki images with proper content-type as a fallback for reverse proxies.
router.get('/wiki/images/:filename', (req, res) => {
  try {
    const filename = req.params.filename;

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = path.join(__dirname, '..', '..', 'uploads', 'wiki', filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      return res.status(400).json({ error: 'Unsupported image format' });
    }

    let contentType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      console.error(`Wiki image stream error for ${filename}:`, err);
      res.status(500).json({ error: 'Error reading file' });
    });
    
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error serving wiki image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// Get all tournaments (public endpoint)
router.get('/tournaments', optionalAuthMiddleware, async (req, res) => {
  try {
    // Get page from query params, default to 1
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get filter params from query
    const nameFilter = (req.query.name as string)?.trim() || '';
    const statusFilter = (req.query.status as string)?.trim() || '';
    const typeFilter = (req.query.type as string)?.trim() || '';
    const myTournamentsFilter = (req.query.my_tournaments as string)?.trim() === 'true';
    
    // Get current user ID from token if available (using userId from middleware)
    const currentUserId = (req as any).userId;

    // Build WHERE clause dynamically
    let whereConditions: string[] = [];
    let params: any[] = [];

    if (nameFilter) {
      whereConditions.push(`t.name LIKE ?`);
      params.push(`%${nameFilter}%`);
    }

    if (statusFilter) {
      whereConditions.push(`t.status = ?`);
      params.push(statusFilter);
    }

    if (typeFilter) {
      whereConditions.push(`t.tournament_type = ?`);
      params.push(typeFilter);
    }

    // Add my_tournaments filter if requested and user is authenticated
    if (myTournamentsFilter && currentUserId) {
      whereConditions.push(`(t.creator_id = ? OR t.id IN (SELECT tournament_id FROM tournament_participants WHERE user_id = ?))`);
      params.push(currentUserId);
      params.push(currentUserId);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count of filtered tournaments
    const countQuery = `SELECT COUNT(*) as total FROM tournaments t ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    // Get tournaments for current page with filters
    params.push(limit);
    params.push(offset);
    const tournamentsResult = await query(`
      SELECT 
        t.id, 
        t.name, 
        t.description, 
        t.rules_template_id,
        t.rules_content,
        t.creator_id,
        u.nickname as creator_nickname,
        t.status, 
        t.tournament_type,
        t.tournament_mode,
        t.competition_model_version,
        t.forum_topic_id,
        t.max_participants,
        t.general_rounds,
        t.final_rounds,
        t.general_rounds_format,
        t.final_rounds_format,
        t.round_duration_days,
        t.auto_advance_round,
        t.created_at, 
        t.updated_at,
        t.scheduled_start_at,
        t.started_at,
        t.finished_at,
        t.approved_at
      FROM tournaments t
      LEFT JOIN users_extension u ON t.creator_id = u.id
      ${whereClause}
      ORDER BY t.updated_at DESC
      LIMIT ? OFFSET ?
    `, params);

    // For each tournament, if status = 'finished', fetch winner and runner-up from participants or teams
    const tournaments = await Promise.all(tournamentsResult.rows.map(async (t: any) => {
      let winner_id = null, winner_nickname = null, runner_up_id = null, runner_up_nickname = null;
      
      if (t.status === 'finished') {
        const { winner, runnerUp } = await getTournamentPlacements(t.id);
        
        if (winner) {
          winner_id = winner.id;
          winner_nickname = winner.nickname;
        }
        if (runnerUp) {
          runner_up_id = runnerUp.id;
          runner_up_nickname = runnerUp.nickname;
        }
      }

      return {
        ...t,
        winner_id,
        winner_nickname,
        runner_up_id,
        runner_up_nickname
      };
    }));

    res.json({
      data: tournaments,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        showing: tournaments.length
      }
    });
  } catch (error) {
    console.error('Error fetching tournaments:', error);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
});

// Get tournament by ID (public endpoint)
router.get('/tournaments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // The public detail contract includes the engine version so the frontend
    // can choose the phase competition view without inferring it from legacy
    // tournament_type fields. Forum identity is likewise part of the public
    // tournament identity displayed to players.
    const result = await query(`
      SELECT 
        t.id, 
        t.name, 
        t.description, 
        t.rules_template_id,
        t.rules_content,
        t.creator_id,
        u.nickname as creator_nickname,
        t.status, 
        t.tournament_type,
        t.tournament_mode,
        t.competition_model_version,
        t.forum_topic_id,
        t.max_participants,
        t.general_rounds,
        t.final_rounds,
        t.general_rounds_format,
        t.final_rounds_format,
        t.round_duration_days,
        t.auto_advance_round,
        t.created_at, 
        t.updated_at,
        t.scheduled_start_at,
        t.started_at,
        t.finished_at,
        t.approved_at
      FROM tournaments t
      LEFT JOIN users_extension u ON t.creator_id = u.id
      WHERE t.id = ?
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching tournament:', error);
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
});

// Return the immutable rules snapshots for public tournament history viewing.
router.get('/tournaments/:id/rules-history', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT versions.version_number,
              versions.rules_content,
              versions.changed_at,
              versions.changed_by AS changed_by_id,
              users.nickname AS changed_by_nickname
       FROM tournament_rule_versions versions
       LEFT JOIN users_extension users ON users.id = versions.changed_by
       WHERE versions.tournament_id = ?
       ORDER BY versions.version_number DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tournament rules history:', error);
    res.status(500).json({ error: 'Failed to fetch tournament rules history' });
  }
});

// Get tournament participants (public endpoint)
router.get('/tournaments/:id/participants', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT 
        tp.id,
        tp.user_id,
        tp.team_id,
        u.nickname,
        u.elo_rating,
        tp.participation_status,
        tp.status,
        tp.tournament_ranking,
        tp.tournament_wins,
        tp.tournament_losses,
        tp.tournament_points
      FROM tournament_participants tp
      LEFT JOIN users_extension u ON tp.user_id = u.id
      WHERE tp.tournament_id = ?
      ORDER BY tp.tournament_ranking IS NULL, tp.tournament_ranking ASC, u.elo_rating DESC
    `, [id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tournament participants:', error);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
});

// Get tournament matches (public endpoint)
router.get('/news', async (req, res) => {
  try {
    const result = await query(
      `SELECT n.id, n.title, n.content, n.translations, n.published_at, n.created_at, u.nickname as author 
       FROM news n
       LEFT JOIN users_extension u ON n.author_id = u.id
       WHERE n.published_at IS NOT NULL
       ORDER BY n.published_at DESC, n.id ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news', details: (error as any).message });
  }
});

// Get recent matches (public endpoint)
router.get('/matches/recent', async (req, res) => {
  try {
    const feed = await getCombinedMatchFeed({ page: 1, limit: 20, includePending: true });
    res.json(feed.data);
  } catch (error) {
    console.error('Error fetching recent matches:', error);
    res.status(500).json({ error: 'Failed to fetch recent matches', details: (error as any).message });
  }
});

// Get all players directory (public endpoint)
router.get('/players', async (req, res) => {
  try {
    // Get page from query params, default to 1
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // Sort params — whitelist to prevent SQL injection
    const ALLOWED_SORT_COLUMNS: Record<string, string> = {
      nickname:       'nickname',
      elo_rating:     'elo_rating',
      matches_played: 'matches_played',
      total_wins:     'total_wins',
      total_losses:   'total_losses',
      win_percentage: '(total_wins * 1.0 / NULLIF(matches_played, 0))',
      is_rated:       'is_rated',
    };
    const sortByRaw = (req.query.sortBy as string) || 'nickname';
    const sortByExpr = ALLOWED_SORT_COLUMNS[sortByRaw] ?? 'nickname';
    const sortOrder = (req.query.sortOrder as string)?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    // Get filter params from query
    const nicknameFilter = (req.query.nickname as string)?.trim() || '';
    const ratedOnly = req.query.rated_only === 'true';
    const rankedOnly = req.query.ranked_only === 'true';
    const minElo = req.query.min_elo ? parseInt(req.query.min_elo as string) : null;
    const maxElo = req.query.max_elo ? parseInt(req.query.max_elo as string) : null;
    const minMatches = req.query.min_matches ? parseInt(req.query.min_matches as string) : null;

    // Build WHERE clause dynamically
    let whereConditions: string[] = ['is_blocked = 0'];
    let params: any[] = [];

    if (nicknameFilter) {
      whereConditions.push(`nickname LIKE ?`);
      params.push(`%${nicknameFilter}%`);
    }

    if (ratedOnly) {
      whereConditions.push(`is_rated = 1`);
    }

    if (rankedOnly) {
      whereConditions.push(`enable_ranked = 1`);
    }

    if (minElo !== null) {
      whereConditions.push(`elo_rating >= ?`);
      params.push(minElo);
    }

    if (maxElo !== null) {
      whereConditions.push(`elo_rating <= ?`);
      params.push(maxElo);
    }

    if (minMatches !== null) {
      whereConditions.push(`matches_played >= ?`);
      params.push(minMatches);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count of filtered players
    const countQuery = `SELECT COUNT(*) as total FROM users_extension WHERE ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    // Get players for current page with filters
    params.push(limit);
    params.push(offset);
    const result = await query(
      `SELECT u.id, u.nickname, u.elo_rating, u.is_rated, u.is_streamer, u.enable_ranked, u.matches_played, u.total_wins, u.total_losses, u.country, u.avatar,
              CASE WHEN u.is_blocked = 0 THEN (
                SELECT COUNT(*) + 1 FROM users_extension ranked_user
                WHERE ranked_user.is_blocked = 0
                  AND (ranked_user.elo_rating > u.elo_rating
                    OR (ranked_user.elo_rating = u.elo_rating AND ranked_user.id < u.id))
              ) ELSE NULL END AS global_ranking_position
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
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

// Get the combined ranked and tournament match history (public endpoint).
router.get('/matches', optionalAuthMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const feed = await getCombinedMatchFeed({
      page,
      limit: 20,
      includePending: true,
      viewerUserId: (req as any).userId,
      filters: {
        player: req.query.player as string,
        map: req.query.map as string,
        status: req.query.status as string,
        confirmed: req.query.confirmed as string,
        faction: req.query.faction as string,
        matchType: req.query.match_type as string,
      },
    });
    res.json(feed);
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches', details: (error as any).message });
  }
});
// Get specific player profile (public endpoint)
router.get('/players/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const playerResult = await query(
      `SELECT 
        u.id, 
        u.nickname, 
        u.elo_rating, 
        u.is_rated, 
        COALESCE(pms.total_games, u.matches_played) AS matches_played,
        COALESCE(pms.wins, u.total_wins) AS total_wins,
        COALESCE(pms.losses, u.total_losses) AS total_losses,
        u.level, 
        u.country,
        u.avatar,
        u.created_at,
        u.trend,
        u.is_active,
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
      WHERE u.id = ? AND u.is_blocked = 0`,
      [id]
    );

    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // Parse availability_schedule if it's a JSON string
    if (player.availability_schedule && typeof player.availability_schedule === 'string') {
      try {
        player.availability_schedule = JSON.parse(player.availability_schedule);
      } catch (e) {
        console.warn(`[Player ${id}] Failed to parse availability_schedule:`, e);
        player.availability_schedule = null;
      }
    }

    // Get last activity from most recent match (any status except cancelled)
    const lastActivityResult = await query(
      `SELECT created_at FROM matches WHERE (winner_id = ? OR loser_id = ?) AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`,
      [id, id]
    );

    const result = {
      ...player,
      last_activity: lastActivityResult.rows[0]?.created_at || null
    };

    res.json(result);
  } catch (error) {
    console.error('❌ [PLAYERS] Error fetching player:', error);
    res.status(500).json({ error: 'Failed to fetch player', details: (error as any).message });
  }
});

// Get all maps (public endpoint - only active)
router.get('/maps', async (req, res) => {
  try {
    const isRanked = req.query.is_ranked === 'true';
    let query_str = `SELECT id, name, created_at, usage_count FROM game_maps WHERE is_active = 1`;
    
    if (isRanked) {
      query_str += ` AND is_ranked = 1`;
      console.log('🔍 GET /public/maps?is_ranked=true - Filtering to ranked only');
    } else {
      console.log('🔍 GET /public/maps - No ranking filter');
    }
    
    query_str += ` ORDER BY name ASC`;
    console.log('🔍 Maps query:', query_str);
    
    const result = await query(query_str);
    console.log('🔍 Maps count returned:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching maps:', error);
    res.status(500).json({ error: 'Failed to fetch maps' });
  }
});

// Get all factions (public endpoint - only active)
router.get('/factions', async (req, res) => {
  try {
    const isRanked = req.query.is_ranked === 'true';
    let query_str = `SELECT id, name, description, icon_path, created_at FROM factions WHERE is_active = 1`;
    
    if (isRanked) {
      query_str += ` AND is_ranked = 1`;
      console.log('🔍 GET /public/factions?is_ranked=true - Filtering to ranked only');
    } else {
      console.log('🔍 GET /public/factions - No ranking filter');
    }
    
    query_str += ` ORDER BY name ASC`;
    console.log('🔍 Factions query:', query_str);
    
    const result = await query(query_str);
    console.log('🔍 Factions count returned:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching factions:', error);
    res.status(500).json({ error: 'Failed to fetch factions' });
  }
});
// Debug endpoint to verify public routes are working
router.get('/debug', (req, res) => {
  res.json({ message: 'Public routes working', timestamp: new Date().toISOString() });
});

// Get player of the month
router.get('/player-of-month', async (req, res) => {
  try {
    console.log('🔍🔍🔍 GET /public/player-of-month called START');
    
    const now = new Date();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthYearStr = prevMonthStart.toISOString().split('T')[0];
    
    console.log(`📊 Looking for month_year: ${monthYearStr}`);

    const result = await query(
      `SELECT player_id, nickname, elo_rating, ranking_position, elo_gained, positions_gained, month_year, calculated_at
       FROM player_of_month
       WHERE month_year = ?`,
      [monthYearStr]
    );

    console.log(`📊 Query returned ${result.rows.length} rows`);
    
    if (result.rows.length === 0) {
      console.log('⚠️ No player found, returning 404');
      return res.status(404).json({ error: 'No player of month data available' });
    }

    const playerData = result.rows[0];
    console.log(`✅ Returning player: ${playerData.nickname}`, playerData);
    res.json(playerData);
  } catch (error: any) {
    console.error('❌ Error in /player-of-month:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to fetch player of month',
      details: error.message
    });
  }
});

// Get tournament unranked assets (public endpoint)
router.get('/tournaments/:id/unranked-assets', async (req, res) => {
  try {
    const { id } = req.params;

    // Get tournament
    const tournamentResult = await query(
      'SELECT id, tournament_mode FROM tournaments WHERE id = ?',
      [id]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tournament not found' });
    }

    const tournament = tournamentResult.rows[0];

    // Get factions for this tournament
    const factions = await query(
      `SELECT f.id, f.name
       FROM factions f
       JOIN tournament_unranked_factions tuf ON f.id = tuf.faction_id
       WHERE tuf.tournament_id = ?
       ORDER BY f.name ASC`,
      [id]
    );

    // Get maps for this tournament
    const maps = await query(
      `SELECT m.id, m.name
       FROM game_maps m
       JOIN tournament_unranked_maps tum ON m.id = tum.map_id
       WHERE tum.tournament_id = ?
       ORDER BY m.name ASC`,
      [id]
    );

    res.json({
      success: true,
      tournament_mode: tournament.tournament_mode,
      data: {
        factions: factions.rows,
        maps: maps.rows
      }
    });
  } catch (error) {
    console.error('Error fetching tournament unranked assets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tournament unranked assets' });
  }
});

// Get tournament teams (public endpoint - for team tournaments)
router.get('/tournaments/:id/teams', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify tournament exists and is team tournament
    const tournResult = await query(
      'SELECT id, tournament_mode FROM tournaments WHERE id = ?',
      [id]
    );

    if (tournResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tournament not found' });
    }

    const tournament = tournResult.rows[0];

    if (tournament.tournament_mode !== 'team') {
      return res.status(400).json({ success: false, error: 'This endpoint is for team tournaments only' });
    }

    // Get teams with stats from tournament_teams
    const teamsResult = await query(
      `SELECT 
        tt.id, 
        tt.name,
        tt.tournament_wins,
        tt.tournament_losses,
        tt.tournament_points,
        tt.status,
        COUNT(tp.id) as member_count
      FROM tournament_teams tt
      LEFT JOIN tournament_participants tp ON tt.id = tp.team_id AND tp.participation_status IN ('pending', 'unconfirmed', 'accepted', 'pending_replacement')
      WHERE tt.tournament_id = ?
      GROUP BY tt.id, tt.name, tt.tournament_wins, tt.tournament_losses, tt.tournament_points, tt.status
      ORDER BY tt.name`,
      [id]
    );

    // Get members for each team
    const teams = await Promise.all(teamsResult.rows.map(async (team) => {
      const membersResult = await query(
        `SELECT tp.id as participant_id, u.id as user_id, u.nickname, u.elo_rating,
                tp.team_position, tp.participation_status
         FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.team_id = ? AND tp.participation_status IN ('pending', 'unconfirmed', 'accepted', 'pending_replacement')
         ORDER BY tp.team_position`,
        [team.id]
      );

      const members = membersResult.rows;

      return {
        ...team,
        // Keep the existing fields used by the join modal while also exposing
        // the aggregate shape consumed by Tournament Detail. Both views must
        // derive membership from the same authoritative participant rows.
        nickname: team.name,
        team_size: Number(team.member_count || 0),
        team_total_elo: members.reduce((total: number, member: any) => total + Number(member.elo_rating || 0), 0),
        member_user_ids: members.map((member: any) => member.user_id),
        members,
        members_with_elo: members,
      };
    }));

    res.json({
      success: true,
      tournament_mode: 'team',
      data: teams
    });
  } catch (error) {
    console.error('Error fetching tournament teams:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tournament teams' });
  }
});

// Increment replay download count for tournament matches
// PUBLIC endpoint that increments the counter for unranked/team tournament replays
export default router;
