import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { getWinnerAndRunnerUp } from '../utils/tournament.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

// Serve wiki images with proper content-type
// This is a fallback in case /uploads/wiki is not served correctly by the reverse proxy
router.get('/wiki/images/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const filePath = path.join(__dirname, '..', '..', 'uploads', 'wiki', filename);
    console.log(`[WIKI-IMAGE] Request: ${filename}, Full path: ${filePath}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`[WIKI-IMAGE] File not found: ${filePath}`);
      return res.status(404).json({ error: 'Image not found' });
    }
    
    // Determine content type based on extension
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';
    
    console.log(`[WIKI-IMAGE] Serving ${filename} with Content-Type: ${contentType}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      console.error(`[WIKI-IMAGE] Stream error for ${filename}:`, err);
      res.status(500).json({ error: 'Error reading file' });
    });
    
    fileStream.pipe(res);
  } catch (error) {
    console.error('[WIKI-IMAGE] Error:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// Get FAQ (public endpoint) - returns all language versions
// Frontend will handle language selection with fallback to English
router.get('/faq', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, question, answer, language_code, created_at, \`order\`
       FROM faq
       ORDER BY \`order\` ASC, created_at DESC, language_code ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching FAQ:', error);
    res.status(500).json({ error: 'Failed to fetch FAQ' });
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
        t.max_participants,
        t.general_rounds,
        t.final_rounds,
        t.general_rounds_format,
        t.final_rounds_format,
        t.round_duration_days,
        t.auto_advance_round,
        t.created_at, 
        t.updated_at,
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
        // Use tournament-type-aware function to get winner and runner-up
        const { winner, runnerUp } = await getWinnerAndRunnerUp(t.id);
        
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
        t.max_participants,
        t.general_rounds,
        t.final_rounds,
        t.general_rounds_format,
        t.final_rounds_format,
        t.round_duration_days,
        t.auto_advance_round,
        t.created_at, 
        t.updated_at,
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
router.get('/tournaments/:id/matches', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🔍 [MATCHES-START] Fetching matches for tournament:', id);
    
    // Check if replay_downloads column exists
    const columnCheckResult = await query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='tournament_matches' AND column_name='replay_downloads'
    `);
    console.log('🔍 [MATCHES] replay_downloads column exists:', columnCheckResult.rows.length > 0);
    
    // Get tournament mode
    const tournamentModeResult = await query(
      `SELECT tournament_mode FROM tournaments WHERE id = ?`,
      [id]
    );

    if (tournamentModeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentMode = tournamentModeResult.rows[0].tournament_mode || 'ranked';
    console.log('🔍 [MATCHES] Detected tournament_mode:', tournamentMode);

    let selectClause, joinClause;

    if (tournamentMode === 'team') {
      // Team mode: get team names from tournament_teams
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.loser_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        tm.created_at,
        tr.round_number,
        tr.round_type,
        tr.round_status,
        tt1.name as player1_nickname,
        tt2.name as player2_nickname,
        tt_winner.name as winner_nickname,
        tt_loser.name as loser_nickname,
        tm.map,
        NULL as winner_faction,
        NULL as loser_faction,
        tm.winner_comments,
        tm.loser_comments,
        tm.winner_rating,
        tm.loser_rating,
        tm.replay_file_path,
        tm.replay_downloads as replay_downloads,
        tm.organizer_action,
        tm.match_status as match_status_from_matches
      `;
      joinClause = `
        FROM tournament_matches tm
        JOIN tournament_rounds tr ON tm.round_id = tr.id
        LEFT JOIN tournament_teams tt1 ON tm.player1_id = tt1.id
        LEFT JOIN tournament_teams tt2 ON tm.player2_id = tt2.id
        LEFT JOIN tournament_teams tt_winner ON tm.winner_id = tt_winner.id
        LEFT JOIN tournament_teams tt_loser ON tm.loser_id = tt_loser.id
      `;
    } else if (tournamentMode === 'unranked') {
      // Unranked 1v1: get player names from users, match details from tournament_matches
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.loser_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        tm.created_at,
        tr.round_number,
        tr.round_type,
        tr.round_status,
        u1.nickname as player1_nickname,
        u2.nickname as player2_nickname,
        uw.nickname as winner_nickname,
        ul.nickname as loser_nickname,
        tm.map,
        tm.winner_faction,
        tm.loser_faction,
        tm.winner_comments,
        tm.loser_comments,
        tm.winner_rating,
        tm.loser_rating,
        tm.replay_file_path,
        tm.replay_downloads as replay_downloads,
        tm.organizer_action,
        tm.match_status as match_status_from_matches
      `;
      joinClause = `
        FROM tournament_matches tm
        JOIN tournament_rounds tr ON tm.round_id = tr.id
        LEFT JOIN users_extension u1 ON tm.player1_id = u1.id
        LEFT JOIN users_extension u2 ON tm.player2_id = u2.id
        LEFT JOIN users_extension uw ON tm.winner_id = uw.id
        LEFT JOIN users_extension ul ON tm.loser_id = ul.id
      `;
    } else {
      // Ranked 1v1: get player names from users, match details from both tables
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.loser_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        tm.created_at,
        tr.round_number,
        tr.round_type,
        tr.round_status,
        u1.nickname as player1_nickname,
        u2.nickname as player2_nickname,
        uw.nickname as winner_nickname,
        ul.nickname as loser_nickname,
        m.map,
        m.winner_faction,
        m.loser_faction,
        m.winner_comments,
        m.loser_comments,
        m.winner_rating,
        m.loser_rating,
        m.replay_file_path,
        m.replay_downloads as replay_downloads,
        tm.organizer_action,
        tm.match_status as match_status_from_matches
      `;
      joinClause = `
        FROM tournament_matches tm
        JOIN tournament_rounds tr ON tm.round_id = tr.id
        LEFT JOIN users_extension u1 ON tm.player1_id = u1.id
        LEFT JOIN users_extension u2 ON tm.player2_id = u2.id
        LEFT JOIN users_extension uw ON tm.winner_id = uw.id
        LEFT JOIN users_extension ul ON tm.loser_id = ul.id
        LEFT JOIN matches m ON tm.match_id = m.id
      `;
    }

    const result = await query(`
      SELECT ${selectClause}
      ${joinClause}
      WHERE tm.tournament_id = ?
      ORDER BY tr.round_number ASC, tm.created_at ASC
    `, [id]);

    console.log('� [MATCHES] Query returned', result.rows.length, 'rows');
    if (result.rows.length > 0) {
      console.log('🔍 [MATCHES] First row:', JSON.stringify(result.rows[0], null, 2));
    }

    console.log('�📊 [MATCHES] Tournament mode:', tournamentMode);
    console.log('📊 [MATCHES] SQL Query:', `SELECT ${selectClause} ${joinClause} WHERE tm.tournament_id = $1`);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// Get announcements/news (public endpoint)
router.get('/news', async (req, res) => {
  try {
    const result = await query(
      `SELECT n.id, n.title, n.content, n.translations, n.published_at, n.created_at, u.nickname as author 
       FROM news n
       LEFT JOIN users_extension u ON n.author_id = u.id
       ORDER BY COALESCE(n.published_at, n.created_at) DESC`
    );
    console.log('News query result:', result.rows.length, 'rows found');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news', details: (error as any).message });
  }
});

// Get recent matches (public endpoint)
router.get('/matches/recent', async (req, res) => {
  try {
    const [matchResult, replayResult] = await Promise.all([
      query(
        `SELECT m.*, 
                w.nickname as winner_nickname,
                l.nickname as loser_nickname
         FROM matches m
         JOIN users_extension w ON m.winner_id = w.id
         JOIN users_extension l ON m.loser_id = l.id
         ORDER BY m.created_at DESC
         LIMIT 20`
      ),
      query(
        `SELECT r.id, r.replay_filename, r.game_name, r.replay_url, r.parse_summary, r.created_at, r.parse_status
         FROM replays r
         WHERE r.integration_confidence = 1
           AND r.parsed = 1
           AND r.parse_status NOT IN ('rejected', 'error')
           AND r.match_id IS NULL
           AND r.tournament_id IS NULL
         ORDER BY r.created_at DESC
         LIMIT 20`
      )
    ]);

    const formattedReplays: any[] = [];
    for (const r of replayResult.rows) {
      try {
        const parseSummary = typeof r.parse_summary === 'string'
          ? JSON.parse(r.parse_summary)
          : r.parse_summary;
        const players = parseSummary.forumPlayers || [];
        if (players.length < 2) continue;
        const resolvedFactions = parseSummary.resolvedFactions || {};

        const winnerName2 = parseSummary.replayVictory?.winner_name || players[0]?.user_name || 'Unknown';
        const loserName2  = parseSummary.replayVictory?.loser_name  || players[1]?.user_name || 'Unknown';
        const winnerPlayer2 = players.find((p: any) => p.user_name === winnerName2);
        const loserPlayer2  = players.find((p: any) => p.user_name === loserName2);
        const wFaction2 = (winnerPlayer2 ? resolvedFactions[`side${winnerPlayer2.side_number}`] : null) || 'Unknown';
        const lFaction2 = (loserPlayer2  ? resolvedFactions[`side${loserPlayer2.side_number}`]  : null) || 'Unknown';

        formattedReplays.push({
          id: r.id,
          winner_id: null,
          loser_id: null,
          winner_nickname: winnerName2,
          loser_nickname: loserName2,
          winner_faction: wFaction2,
          loser_faction: lFaction2,
          winner_side: parseSummary.replayVictory?.winner_side || null,
          map: parseSummary.resolvedMap || parseSummary.parsedMap || parseSummary.scenario || 'Unknown Map',
          status: 'pending_report',
          winner_elo_before: null,
          winner_elo_after: null,
          loser_elo_before: null,
          loser_elo_after: null,
          replay_url: r.replay_url,
          replay_file_path: r.replay_url,
          replay_downloads: 0,
          created_at: r.created_at,
          source_type: r.parse_status === 'due' ? 'replay_confidence_1_due' : 'replay_confidence_1',
          confidence_level: 1,
          game_name: r.game_name,
          replay_filename: r.replay_filename
        });
      } catch {
        // skip malformed replay
      }
    }

    const allResults = [...matchResult.rows, ...formattedReplays];
    allResults.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    console.log('Recent matches query result:', allResults.length, 'rows found');
    res.json(allResults.slice(0, 20));
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
      `SELECT id, nickname, elo_rating, is_rated, enable_ranked, matches_played, total_wins, total_losses, country, avatar
       FROM users_extension
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

// Get all confirmed matches (public endpoint)
router.get('/matches', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = 20;
    const offset = (page - 1) * pageSize;

    // Parse filters
    const player = req.query.player ? (req.query.player as string).trim() : null;
    const map = req.query.map ? (req.query.map as string).trim() : null;
    const status = req.query.status ? (req.query.status as string).trim() : null;
    const confirmed = req.query.confirmed ? (req.query.confirmed as string).trim() : null;
    const faction = req.query.faction ? (req.query.faction as string).trim() : null;

    console.log('🔍 GET /api/public/matches - Filters received:', { player, map, status, confirmed, faction });

    // Build WHERE conditions
    const whereConditions: string[] = [];
    const params: any[] = [];

    if (player) {
      whereConditions.push(`(w.nickname LIKE ? OR l.nickname LIKE ?)`);
      params.push(`%${player}%`);
      params.push(`%${player}%`);
    }

    if (map) {
      whereConditions.push(`m.map LIKE ?`);
      params.push(`%${map}%`);
    }

    if (status) {
      whereConditions.push(`m.status = ?`);
      params.push(status);
    }

    if (confirmed) {
      const isConfirmed = confirmed.toLowerCase() === 'true' || confirmed === '1';
      whereConditions.push(`m.loser_confirmed = ?`);
      params.push(isConfirmed ? 1 : 0);
    }

    if (faction) {
      console.log('🔍 Faction filter applied:', faction);
      whereConditions.push(`(m.winner_faction = ? OR m.loser_faction = ?)`);
      params.push(faction);
      params.push(faction);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM matches m
      JOIN users_extension w ON m.winner_id = w.id
      JOIN users_extension l ON m.loser_id = l.id
      ${whereClause}
    `;

    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / pageSize);

    // Get ALL data for combining and paginating together
    const dataQuery = `
      SELECT m.*, 
              w.nickname as winner_nickname,
              l.nickname as loser_nickname
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       ${whereClause}
       ORDER BY m.created_at DESC
    `;

    const result = await query(dataQuery, params);

    console.log('All matches query result:', result.rows.length, 'rows found');

    // Get current user info from token if authenticated
    let currentUserNickname = '';
    let currentUserIsAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        if (decoded.userId) {
          // Get user's nickname and admin status
          const userResult = await query(
            `SELECT nickname, is_admin FROM users_extension WHERE id = ?`,
            [decoded.userId]
          );
          if (userResult.rows.length > 0) {
            currentUserNickname = userResult.rows[0].nickname?.toLowerCase() || '';
            currentUserIsAdmin = !!(userResult.rows[0].is_admin);
            console.log(`✅ [PUBLIC/MATCHES] Authenticated user: ${userResult.rows[0].nickname} isAdmin=${currentUserIsAdmin}`);
          }
        }
      } catch (tokenError) {
        console.log(`⚠️ [PUBLIC/MATCHES] Token parsing failed (non-authenticated request)`);
      }
    }

    // Get ALL replays with confidence=1 (visible to everyone, action buttons controlled in frontend)
    let formattedReplays = [];
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
         r.cancel_requested_by,
         r.parse_status
        FROM replays r
        WHERE r.integration_confidence = 1 
          AND r.parsed = 1
          AND r.parse_status NOT IN ('rejected', 'error')
          AND r.match_id IS NULL
          AND r.tournament_id IS NULL
        ORDER BY r.created_at DESC`
      );

      console.log(`📋 [PUBLIC/MATCHES] Found ${replayResult.rows?.length || 0} confidence=1 replays`);

      for (const r of replayResult.rows) {
        try {
          const parseSummary = typeof r.parse_summary === 'string' 
            ? JSON.parse(r.parse_summary) 
            : r.parse_summary;

          const players = parseSummary.forumPlayers || [];
          if (players.length < 2) continue;

          const player1Name = players[0]?.user_name?.toLowerCase() || '';
          const player2Name = players[1]?.user_name?.toLowerCase() || '';

          const isInvolved = currentUserNickname 
            ? currentUserNickname === player1Name || currentUserNickname === player2Name
            : false;

          // Extract map - USE resolvedMap from parse_summary
          const map = parseSummary.resolvedMap 
            || parseSummary.parsedMap 
            || parseSummary.map 
            || parseSummary.forumMap 
            || parseSummary.scenario
            || 'Unknown Map';

          // Extract factions - look up by player name → side_number → resolvedFactions
          // This ensures correct faction assignment regardless of who won/lost
          const resolvedFactions = parseSummary.resolvedFactions || {};

          const winnerName = parseSummary.replayVictory?.winner_name || players[0]?.user_name || 'Unknown';
          const loserName  = parseSummary.replayVictory?.loser_name  || players[1]?.user_name || 'Unknown';

          const winnerPlayer = players.find((p: any) => p.user_name === winnerName);
          const loserPlayer  = players.find((p: any) => p.user_name === loserName);

          const winner_faction = (winnerPlayer ? resolvedFactions[`side${winnerPlayer.side_number}`] : null) || 'Unknown';
          const loser_faction  = (loserPlayer  ? resolvedFactions[`side${loserPlayer.side_number}`]  : null) || 'Unknown';
          const winner_side = winnerPlayer?.side_number || null;
          const loser_side = loserPlayer?.side_number || null;

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
            source_type: r.parse_status === 'due' ? 'replay_confidence_1_due' : 'replay_confidence_1',
            replay_id: r.id,
            confidence_level: 1,
            parse_summary: parseSummary,
            replay_filename: r.replay_filename,
            game_name: r.game_name,
            cancel_requested_by: r.cancel_requested_by || null,
            is_admin_view: currentUserIsAdmin && !isInvolved,
            is_participant: isInvolved
          };

          console.log(`📋 [REPLAY] ${replayData.winner_nickname} (${winner_faction}) vs ${replayData.loser_nickname} (${loser_faction}) on ${map}`);
          formattedReplays.push(replayData);
        } catch (formatError) {
          console.error('Error formatting replay:', formatError);
        }
      }
    } catch (replayQueryError) {
      console.error('❌ [PUBLIC/MATCHES] Error fetching replays:', replayQueryError);
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
    const paginatedResults = allResults.slice(offset, offset + pageSize);
    const combinedTotal = total + (formattedReplays.length > 0 ? formattedReplays.length : 0);
    const combinedTotalPages = Math.ceil(combinedTotal / pageSize);

    res.json({
      data: paginatedResults,
      pagination: {
        page,
        pageSize,
        total: combinedTotal,
        totalPages: combinedTotalPages,
      },
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches', details: (error as any).message });
  }
});

// Get specific player profile (public endpoint)
router.get('/players/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 [PLAYERS] Fetching player: ${id}`);

    const playerResult = await query(
      `SELECT 
        u.id, 
        u.nickname, 
        u.elo_rating, 
        u.is_rated, 
        u.matches_played, 
        u.total_wins, 
        u.total_losses, 
        u.level, 
        u.country,
        u.avatar,
        u.created_at,
        u.trend,
        u.is_active,
        u.enable_ranked,
        u.timezone,
        u.availability_schedule,
        pms.avg_elo_change
      FROM users_extension u
      LEFT JOIN player_match_statistics pms ON u.id = pms.player_id 
        AND pms.opponent_id IS NULL 
        AND pms.map_id IS NULL 
        AND pms.faction_id IS NULL
      WHERE u.id = ? AND u.is_blocked = 0`,
      [id]
    );

    console.log(`🔍 [PLAYERS] Query returned: ${playerResult?.rows?.length || 0} rows`);

    if (playerResult.rows.length === 0) {
      console.log(`⚠️  [PLAYERS] Player not found with ID: ${id}`);
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

    console.log(`[Player ${id}] Last activity query result:`, lastActivityResult.rows);

    const result = {
      ...player,
      last_activity: lastActivityResult.rows[0]?.created_at || null
    };

    console.log(`[Player ${id}] Final result:`, result);

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
      LEFT JOIN tournament_participants tp ON tt.id = tp.team_id AND tp.participation_status IN ('pending', 'unconfirmed', 'accepted')
      WHERE tt.tournament_id = ?
      GROUP BY tt.id, tt.name, tt.tournament_wins, tt.tournament_losses, tt.tournament_points, tt.status
      ORDER BY tt.name`,
      [id]
    );

    // Get members for each team
    const teams = await Promise.all(teamsResult.rows.map(async (team) => {
      const membersResult = await query(
        `SELECT tp.id as participant_id, u.id, u.nickname, tp.team_position, tp.participation_status
         FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.team_id = ? AND tp.participation_status IN ('pending', 'unconfirmed', 'accepted')
         ORDER BY tp.team_position`,
        [team.id]
      );

      return {
        ...team,
        members: membersResult.rows
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

// Get signed download URL for replay files (for unranked/team tournaments without match_id)
// PUBLIC endpoint that generates a temporary signed URL for any replay path
router.get('/replay/download-url', async (req, res) => {
  try {
    const { path: replayFilePath } = req.query;
    
    console.log('📥 [REPLAY-DL] Request received with path:', replayFilePath);
    
    if (!replayFilePath || typeof replayFilePath !== 'string') {
      console.warn('⚠️ [REPLAY-DL] Invalid or missing replay path');
      return res.status(400).json({ error: 'Missing replay path' });
    }

    console.log('📥 [REPLAY-DL] Generating signed URL for path:', replayFilePath);

    // NOTE: Supabase replay download temporarily disabled - using /uploads/replays instead
    /*
    const filename = replayFilePath.split('/').pop() || 'replay.zip';
    const { data: signedData, error: signedError } = await supabase.storage
      .from('replays')
      .createSignedUrl(replayFilePath, 300); // 5 minutes expiration

    if (signedError || !signedData?.signedUrl) {
      console.error('❌ [REPLAY-DL] Failed to generate signed URL:', signedError?.message || 'No signed URL');
      return res.status(500).json({ error: 'Failed to generate download link', details: signedError?.message });
    }

    console.log('✅ [REPLAY-DL] Signed URL generated (5-min expiry)');

    return res.json({
      signedUrl: signedData.signedUrl,
      filename: filename,
      expiresIn: 300
    });
    */
    
    // TODO: Implement local file download from /uploads/replays
    return res.status(501).json({ error: 'Replay download feature will be implemented' });
  } catch (error) {
    console.error('❌ [REPLAY-DL] Unexpected error:', error);
    return res.status(500).json({ error: 'Failed to download replay', details: (error as any)?.message });
  }
});

// Increment replay download count for tournament matches
// PUBLIC endpoint that increments the counter for unranked/team tournament replays
router.post('/tournament-matches/:matchId/replay/download-count', async (req, res) => {
  try {
    const { matchId } = req.params;
    console.log('📊 [TOURNAMENT-COUNTER] Incrementing download count for tournament match:', matchId);

    // Increment the download count in tournament_matches
    await query(
      'UPDATE tournament_matches SET replay_downloads = COALESCE(replay_downloads, 0) + 1 WHERE id = ?',
      [matchId]
    );

    const result = await query(
      'SELECT COALESCE(replay_downloads, 0) as replay_downloads FROM tournament_matches WHERE id = ?',
      [matchId]
    );

    if (result.rows.length === 0) {
      console.warn('📊 [TOURNAMENT-COUNTER] Tournament match not found:', matchId);
      return res.status(404).json({ error: 'Tournament match not found' });
    }

    console.log('✅ [TOURNAMENT-COUNTER] Download count updated to:', result.rows[0].replay_downloads);
    res.json({ replay_downloads: result.rows[0].replay_downloads });
  } catch (error) {
    console.error('❌ [TOURNAMENT-COUNTER] Error incrementing replay downloads:', error);
    res.status(500).json({ error: 'Failed to increment download count' });
  }
});

// ============================================================================
// GET /public/tournaments/:tournamentId/pending-replays
// Returns confidence=1 replays linked to this tournament's round matches
// that still need player confirmation (match_id IS NULL, need_integration=1)
// ============================================================================
router.get('/tournaments/:tournamentId/pending-replays', async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // Query replays directly via tournament_round_match_id relationship
    const replayResult = await query(
      `SELECT r.id, r.replay_url, r.replay_filename, r.game_name, r.parse_summary,
              r.cancel_requested_by, r.created_at,
              trm.player1_id, trm.player2_id,
              u1.nickname AS player1_nickname, u2.nickname AS player2_nickname
       FROM replays r
       JOIN tournament_round_matches trm ON r.tournament_round_match_id = trm.id
       JOIN tournament_rounds tr ON trm.round_id = tr.id
       JOIN users_extension u1 ON trm.player1_id = u1.id
       JOIN users_extension u2 ON trm.player2_id = u2.id
       WHERE tr.tournament_id = ?
         AND r.need_integration = 1
         AND r.match_id IS NULL
         AND r.deleted_at IS NULL
       ORDER BY r.created_at DESC`,
      [tournamentId]
    );

    const pendingReplays = (replayResult.rows as any[]).map((r: any) => {
      const parseSummary = typeof r.parse_summary === 'string'
        ? JSON.parse(r.parse_summary)
        : (r.parse_summary || {});

      const map = parseSummary.finalMap || parseSummary.resolvedMap || parseSummary.forumMap || 'Unknown Map';
      const resolvedFactions = parseSummary.resolvedFactions || {};

      return {
        id: r.id,
        tournament_match_id: null, // tournament replays use tournament_round_match_id on the replay
        player1_nickname: r.player1_nickname,
        player2_nickname: r.player2_nickname,
        winner_nickname: parseSummary.replayVictory?.winner_name || r.player1_nickname,
        loser_nickname: parseSummary.replayVictory?.loser_name || r.player2_nickname,
        winner_faction: resolvedFactions.side1 || 'Unknown',
        loser_faction: resolvedFactions.side2 || 'Unknown',
        map,
        replay_url: r.replay_url,
        replay_filename: r.replay_filename,
        game_name: r.game_name,
        cancel_requested_by: r.cancel_requested_by || null,
        created_at: r.created_at,
        source_type: 'replay_confidence_1',
        confidence_level: 1,
      };
    });

    res.json({ success: true, replays: pendingReplays });
  } catch (error) {
    console.error('❌ [TOURNAMENT-REPLAYS] Error:', error);
    res.status(500).json({ error: 'Failed to fetch pending replays' });
  }
});

export default router;
