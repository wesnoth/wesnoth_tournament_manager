import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { authMiddleware, moderatorOrAdminMiddleware, streamerMiddleware, AuthRequest } from '../middleware/auth.js';
import { isTournamentOrganizer } from '../services/tournamentAuthorizationService.js';
import { checkUserIsForumModerator } from '../services/phpbbAuth.js';
import {
  enqueueGlobalStatsRecalculation,
  getActiveGlobalStatsRecalculationJobId,
} from '../services/globalStatsRecalculationJobService.js';
import { performQueuedGlobalStatsRecalculation } from '../services/globalRecalculationService.js';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';
import { globalRecalculationMiddleware } from '../services/systemPauseService.js';

const router = Router();

console.log('🔧 Registering match routes');

// Confirm/dispute match - MUST be BEFORE generic /:id routes
router.post('/:id/confirm', authMiddleware, globalRecalculationMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { comments, rating, action } = req.body;
    const matchResult = await query('SELECT * FROM matches WHERE id = ?', [id]);
    if (!matchResult.rows.length) return res.status(404).json({ error: 'Match not found' });
    const match = matchResult.rows[0];
    const loserId = match.loser_id || (match.winner_id === match.player1_id ? match.player2_id : match.player1_id);
    const isWinner = match.winner_id === req.userId;
    const isLoser = loserId === req.userId;
    if (!isWinner && !isLoser) return res.status(403).json({ error: 'Only match participants can confirm this match' });

    if (action === 'confirm') {
      if (rating !== undefined && rating !== null && (rating < 1 || rating > 5)) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }
      const updateColumn = isWinner ? 'winner' : 'loser';
      await query(
        'UPDATE matches SET ' + updateColumn + '_comments = ?, ' + updateColumn + '_rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [comments || null, rating || null, id]
      );
      const updatedMatch = await query('SELECT loser_rating, winner_rating FROM matches WHERE id = ?', [id]);
      if (updatedMatch.rows[0]?.loser_rating && updatedMatch.rows[0]?.winner_rating) {
        // Only an open result becomes confirmed: a participant's comments or
        // rating must not silently close a dispute opened by the other player
        // (or reopen a cancelled match). Disputes are closed only by an admin.
        await query(
          `UPDATE matches SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status IN ('reported', 'unconfirmed')`,
          [id]
        );
      }
      return res.json({ message: 'Match confirmed successfully with your comments and rating' });
    }

    if (action === 'dispute') {
      // Either participant may dispute. The reported winner needs this too: a
      // mistaken surrender makes the system record the real winner as loser,
      // and the honest "winner" must be able to reopen the result. A dispute
      // never changes ELO or statistics by itself; an admin or moderator
      // resolves it (award = invert, validate = annul, reject = keep), and only
      // that resolution may trigger a recalculation.
      //
      // Only open, never-reviewed results can be disputed: cancelled matches
      // and matches an admin already ruled on are final. The conditional UPDATE
      // makes the state check and the write atomic, so two concurrent disputes
      // (or a dispute racing an admin decision) cannot both succeed.
      const commentColumn = isWinner ? 'winner_comments' : 'loser_comments';
      const disputeResult = await query(
        `UPDATE matches
         SET status = 'disputed', ${commentColumn} = ?, disputed_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND status IN ('reported', 'unconfirmed', 'confirmed')
           AND COALESCE(admin_reviewed, 0) = 0`,
        [comments || null, req.userId, id]
      );
      if (!disputeResult.rowCount) {
        return res.status(409).json({ error: 'This match can no longer be disputed' });
      }
      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        user_id: req.userId,
        username: req.username,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: {
          action: 'MATCH_DISPUTED',
          match_id: id,
          disputed_as: isWinner ? 'winner' : 'loser',
          previous_status: match.status,
        },
      });
      return res.json({ message: 'Match disputed. Awaiting admin review.' });
    }

    return res.status(400).json({ error: 'Invalid action. Use "confirm" or "dispute"' });
  } catch (error) {
    console.error('Match confirmation error:', error);
    return res.status(500).json({ error: 'Failed to update match' });
  }
});

const DISPUTES_PAGE_SIZE = 20;

/** Parse and bound the administrative dispute list page number. */
function parseDisputePage(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 1;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100_000 ? page : null;
}

// Get disputed ranked matches (admin view) - MUST be before /:id route.
router.get('/disputed/all', moderatorOrAdminMiddleware, async (req: AuthRequest, res) => {
  try {
    const page = parseDisputePage(req.query.page);
    if (page === null) {
      return res.status(400).json({ error: 'page must be an integer between 1 and 100000' });
    }

    const offset = (page - 1) * DISPUTES_PAGE_SIZE;
    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE m.status = 'disputed'`
    );
    const total = Number(countResult.rows[0]?.total || 0);
    const result = await query(
      `SELECT m.*,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname,
              d.nickname as disputed_by_nickname
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       LEFT JOIN users_extension d ON m.disputed_by = d.id
       WHERE m.status = 'disputed'
       ORDER BY m.updated_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      [DISPUTES_PAGE_SIZE, offset]
    );

    res.json({
      disputes: result.rows,
      pagination: {
        page,
        limit: DISPUTES_PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / DISPUTES_PAGE_SIZE),
        showing: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Failed to fetch disputed matches:', error);
    res.status(500).json({ error: 'Failed to fetch disputed matches' });
  }
});

// Get all pending matches (admin view) - MUST be before /:id route
router.get('/pending/all', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // Verify admin status
    const adminResult = await query('SELECT is_admin FROM users_extension WHERE id = ?', [req.userId]);
    if (adminResult.rows.length === 0 || !adminResult.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await query(
      `SELECT m.*,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE m.status IN ('unconfirmed', 'pending')
       ORDER BY m.created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending matches' });
  }
});

// Get pending matches for current user (as winner or loser) - MUST be before /:id route
router.get('/pending/user', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await query(
      `SELECT m.*,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname,
              CASE 
                WHEN m.winner_id = ? THEN 'winner'
                WHEN m.loser_id = ? THEN 'loser'
              END as user_role,
              CASE 
                WHEN m.winner_id = ? AND m.status = 'confirmed' THEN true
                WHEN m.loser_id = ? AND m.status IN ('unconfirmed', 'pending') THEN true
                ELSE false
              END as is_awaiting_action
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE (m.winner_id = ? OR m.loser_id = ?)
         AND m.status IN ('unconfirmed', 'pending')
       ORDER BY m.created_at DESC`,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending matches' });
  }
});

// Admin action on disputed match - MUST be BEFORE /:matchId routes
router.post('/admin/:id/dispute', moderatorOrAdminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'validate', 'reject', or 'award'

    const matchResult = await query('SELECT * FROM matches WHERE id = ?', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchResult.rows[0];

    if (match.status !== 'disputed') {
      return res.status(400).json({ error: 'Match is not disputed' });
    }

    const activeRecalculationJobId = await getActiveGlobalStatsRecalculationJobId();
    if (activeRecalculationJobId) {
      return res.status(409).json({
        error: 'A global statistics recalculation is in progress. Resolve disputes after it completes.',
        jobId: activeRecalculationJobId,
      });
    }

    if (action === 'award') {
      // Invert the result on the existing match row so replay identity and all
      // foreign-key references remain intact. This swaps winner and loser
      // regardless of who opened the dispute (`disputed_by`): either
      // participant may dispute, so the action means "the reported result was
      // backwards", not "the disputing player wins".
      const previousResult = {
        winner_id: match.winner_id,
        loser_id: match.loser_id,
        winner_faction: match.winner_faction,
        loser_faction: match.loser_faction,
        winner_comments: match.winner_comments,
        loser_comments: match.loser_comments,
        winner_rating: match.winner_rating,
        loser_rating: match.loser_rating,
        winner_side: match.winner_side,
        status: match.status,
        admin_reviewed: match.admin_reviewed,
        admin_reviewed_at: match.admin_reviewed_at,
        admin_reviewed_by: match.admin_reviewed_by,
      };

      const correctedWinnerSide = match.winner_side === 1 ? 2 : match.winner_side === 2 ? 1 : match.winner_side;
      await query(
        `UPDATE matches
         SET winner_id = ?, loser_id = ?,
             winner_faction = ?, loser_faction = ?,
             winner_comments = ?, loser_comments = ?,
             winner_rating = ?, loser_rating = ?,
             winner_side = ?, status = 'confirmed',
             admin_reviewed = true, admin_reviewed_at = CURRENT_TIMESTAMP, admin_reviewed_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'disputed'`,
        [
          previousResult.loser_id,
          previousResult.winner_id,
          previousResult.loser_faction,
          previousResult.winner_faction,
          previousResult.loser_comments,
          previousResult.winner_comments,
          previousResult.loser_rating,
          previousResult.winner_rating,
          correctedWinnerSide,
          req.userId,
          id,
        ]
      );

      let recalcJobId: string;
      try {
        recalcJobId = await enqueueGlobalStatsRecalculation({
          requestedBy: req.userId ?? null,
          reason: 'MATCH_DISPUTE_AWARDED_WIN',
          execute: performQueuedGlobalStatsRecalculation,
        });
      } catch (error: any) {
        // Do not leave a corrected match without a scheduled recalculation.
        await query(
          `UPDATE matches
           SET winner_id = ?, loser_id = ?,
               winner_faction = ?, loser_faction = ?,
               winner_comments = ?, loser_comments = ?,
               winner_rating = ?, loser_rating = ?,
               winner_side = ?, status = ?,
               admin_reviewed = ?, admin_reviewed_at = ?, admin_reviewed_by = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            previousResult.winner_id, previousResult.loser_id,
            previousResult.winner_faction, previousResult.loser_faction,
            previousResult.winner_comments, previousResult.loser_comments,
            previousResult.winner_rating, previousResult.loser_rating,
            previousResult.winner_side, previousResult.status,
            previousResult.admin_reviewed, previousResult.admin_reviewed_at,
            previousResult.admin_reviewed_by, id,
          ]
        );
        // Only the in-progress conflict carries a client-facing message; any
        // other scheduling failure is internal and stays in the server log.
        const inProgress = error.name === 'GlobalStatsRecalculationInProgressError';
        if (!inProgress) console.error('Could not schedule statistics recalculation:', error);
        return res.status(inProgress ? 409 : 500).json({
          error: inProgress ? error.message : 'Could not schedule statistics recalculation',
          jobId: error.jobId,
        });
      }

      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        user_id: req.userId,
        username: req.username,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: {
          action: 'MATCH_DISPUTE_AWARDED_WIN',
          match_id: id,
          previous_winner_id: previousResult.winner_id,
          corrected_winner_id: previousResult.loser_id,
        },
      });

      return res.json({
        message: 'Dispute resolved. The disputed player was awarded the win and global statistics recalculation was queued.',
        recalculationJobId: recalcJobId,
        recalculationStatus: 'queued',
      });
    }

    if (action === 'validate') {
      // The dispute is upheld: the match is invalid and is cancelled (never
      // deleted). Cancelling changes the rating history of both players and,
      // transitively, of everyone who played them afterwards, so the ratings
      // are rebuilt by the global recalculation (full-replay principle)
      // instead of a partial cascade.
      const previousReview = {
        status: match.status,
        admin_reviewed: match.admin_reviewed,
        admin_reviewed_at: match.admin_reviewed_at,
        admin_reviewed_by: match.admin_reviewed_by,
      };
      const cancelled = await query(
        `UPDATE matches
         SET status = 'cancelled', admin_reviewed = true, admin_reviewed_at = CURRENT_TIMESTAMP,
             admin_reviewed_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'disputed'`,
        [req.userId, id]
      );
      if (cancelled.rowCount === 0) {
        return res.status(409).json({ error: 'Match is no longer disputed' });
      }

      let recalcJobId: string;
      try {
        recalcJobId = await enqueueGlobalStatsRecalculation({
          requestedBy: req.userId ?? null,
          reason: 'MATCH_DISPUTE_VALIDATED',
          execute: performQueuedGlobalStatsRecalculation,
        });
      } catch (error: any) {
        // Do not leave a cancelled match without a scheduled recalculation.
        await query(
          `UPDATE matches
           SET status = ?, admin_reviewed = ?, admin_reviewed_at = ?, admin_reviewed_by = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [previousReview.status, previousReview.admin_reviewed, previousReview.admin_reviewed_at,
            previousReview.admin_reviewed_by, id]
        );
        const inProgress = error.name === 'GlobalStatsRecalculationInProgressError';
        if (!inProgress) console.error('Could not schedule statistics recalculation:', error);
        return res.status(inProgress ? 409 : 500).json({
          error: inProgress ? error.message : 'Could not schedule statistics recalculation',
          jobId: error.jobId,
        });
      }

      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        user_id: req.userId,
        username: req.username,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: { action: 'MATCH_DISPUTE_VALIDATED', match_id: id },
      });
      return res.json({
        message: 'Dispute validated. The match was cancelled and global statistics recalculation was queued.',
        recalculationJobId: recalcJobId,
        recalculationStatus: 'queued',
      });
    } else if (action === 'reject') {
      // Reject dispute - the dispute is not valid, match was correct
      // Simply mark as confirmed, NO stat changes, NO ELO recalculation
      await query(
        `UPDATE matches 
         SET status = ?, 
             admin_reviewed = true, 
             admin_reviewed_at = CURRENT_TIMESTAMP, 
             admin_reviewed_by = ? 
         WHERE id = ?`,
        ['confirmed', req.userId, id]
      );

      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        user_id: req.userId,
        username: req.username,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: { action: 'MATCH_DISPUTE_REJECTED', match_id: id },
      });

      console.log(`Match ${id} dispute rejected by admin ${req.userId}: Match remains confirmed`);
      res.json({ message: 'Dispute rejected. Match confirmed.' });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "validate", "reject", or "award"' });
    }
  } catch (error) {
    console.error('Admin dispute resolution error:', error);
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

// Increment replay download count - MUST be BEFORE generic /:matchId routes
router.post('/:matchId/replay/download-count', async (req: AuthRequest, res) => {
  try {
    const { matchId } = req.params;
    console.log('📊 [COUNTER] Incrementing download count for match:', matchId);

    // Increment the download count
    const updateCountResult = await query(
      'UPDATE matches SET replay_downloads = COALESCE(replay_downloads, 0) + 1 WHERE id = ?',
      [matchId]
    );
    const countResult = await query('SELECT replay_downloads FROM matches WHERE id = ?', [matchId]);

    if (updateCountResult.rowCount === 0) {
      console.warn('📊 [COUNTER] Match not found:', matchId);
      return res.status(404).json({ error: 'Match not found' });
    }

    console.log('✅ [COUNTER] Download count updated to:', countResult.rows[0].replay_downloads);
    res.json({ replay_downloads: countResult.rows[0].replay_downloads });
  } catch (error) {
    console.error('❌ [COUNTER] Error incrementing replay downloads:', error);
    res.status(500).json({ error: 'Failed to increment download count' });
  }
});

// Discard a pending confidence-one replay before it is confirmed. Confirmation
// itself goes through POST /replays/:replayId/confirm-winner (the former
// report-confidence-1-replay route was removed: it had no frontend caller and
// bypassed the transactional replay integration).
router.post('/cancel-confidence-1-replay', authMiddleware, globalRecalculationMiddleware, async (req: AuthRequest, res) => {
  try {
    const { replayId } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!replayId) {
      return res.status(400).json({ error: 'Missing replayId in request body' });
    }

    console.log(`🚫 [CANCEL-REPLAY] Processing cancel request for replay ${replayId} by user ${userId}`);

    // Fetch the replay
    const replayResult = await query(
      `SELECT id, parse_summary, integration_confidence, parsed, cancel_requested_by
       FROM replays WHERE id = ? AND integration_confidence = 1 AND parsed = 1 AND parse_status NOT IN ('rejected', 'due')`,
      [replayId]
    );

    if (replayResult.rows.length === 0) {
      // Row not found: already deleted (both players confirmed) or never existed
      return res.status(404).json({ error: 'Replay not found or already cancelled' });
    }

    const replay = replayResult.rows[0];

    // Parse summary to identify the players
    let parseSummary: any;
    try {
      parseSummary = typeof replay.parse_summary === 'string'
        ? JSON.parse(replay.parse_summary)
        : replay.parse_summary;
    } catch {
      return res.status(500).json({ error: 'Invalid parse_summary data in replay' });
    }

    const forumPlayers = parseSummary?.forumPlayers || [];
    if (forumPlayers.length < 2) {
      return res.status(400).json({ error: 'Replay does not have 2 identified players' });
    }

    // Get current user's nickname
    const currentUserResult = await query(
      `SELECT nickname FROM users_extension WHERE id = ?`,
      [userId]
    );
    if (currentUserResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const currentUserNickname = currentUserResult.rows[0].nickname?.toLowerCase() || '';

    // Team replays can contain more than two participants. Any participant
    // may request cancellation; a different participant must confirm it.
    const isParticipant = forumPlayers.some(
      (player: any) => player?.user_name?.toLowerCase() === currentUserNickname
    );
    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this replay' });
    }

    // Case 1: No cancel request yet → record first request
    if (!replay.cancel_requested_by) {
      await query(
        `UPDATE replays SET cancel_requested_by = ? WHERE id = ?`,
        [userId, replayId]
      );
      console.log(`🚫 [CANCEL-REPLAY] Cancel requested by ${userId} for replay ${replayId}. Waiting for other player.`);
      return res.json({
        success: true,
        status: 'waiting_confirmation',
        message: 'Cancel request recorded. Waiting for the other player to confirm.'
      });
    }

    // Case 2: Same player is clicking cancel again → idempotent, already requested
    if (replay.cancel_requested_by === userId) {
      return res.json({
        success: true,
        status: 'waiting_confirmation',
        message: 'You have already requested cancellation. Waiting for the other player to confirm.'
      });
    }

    // Case 3: Different player is now confirming the cancel → delete the replay entirely.
    // Replays exist only to become matches; if both players agree the game was not finished,
    // there is no match to create and the record is no longer needed.
    await query(
      `DELETE FROM replays WHERE id = ?`,
      [replayId]
    );

    console.log(`✅ [CANCEL-REPLAY] Replay ${replayId} deleted. Both players agreed game was not finished.`);
    return res.json({
      success: true,
      status: 'cancelled',
      message: 'Both players confirmed. Replay has been deleted (game not finished).'
    });

  } catch (error) {
    console.error('❌ Error cancelling confidence-1 replay:', error);
    res.status(500).json({ error: 'Failed to cancel replay' });
  }
});


/** Return streams attached to a ranked match or to its tournament game. */
router.get('/:id/streams', async (req, res) => {
  try {
    const result = await query(
      `SELECT streams.id, streams.stream_url, streams.streamer_user_id,
              streamer.nickname AS streamer_nickname, streams.created_at, streams.updated_at
       FROM tournament_game_streams streams
       JOIN users_extension streamer ON streamer.id = streams.streamer_user_id
       LEFT JOIN tournament_games tournament_game ON tournament_game.id = streams.game_id
       WHERE streams.match_id = ? OR tournament_game.match_id = ?
       ORDER BY streams.created_at ASC`,
      [req.params.id, req.params.id]
    );
    return res.json({ streams: result.rows });
  } catch (error) {
    console.error('Get match streams error:', error);
    return res.status(500).json({ error: 'Failed to fetch match streams' });
  }
});

/** Create a stream link for a completed ranked match, including non-tournament matches. */
router.post('/:id/streams', streamerMiddleware, async (req: AuthRequest, res) => {
  try {
    if (typeof req.body?.stream_url !== 'string' || req.body.stream_url.length > 2048) {
      return res.status(400).json({ error: 'stream_url must be a valid HTTP(S) URL' });
    }
    let streamUrl: URL;
    try { streamUrl = new URL(req.body.stream_url); } catch { return res.status(400).json({ error: 'stream_url must be a valid HTTP(S) URL' }); }
    if (!['http:', 'https:'].includes(streamUrl.protocol)) return res.status(400).json({ error: 'stream_url must be a valid HTTP(S) URL' });

    const matchResult = await query(
      `SELECT m.id, tg.id AS tournament_game_id
       FROM matches m
       LEFT JOIN tournament_games tg ON tg.match_id = m.id
       WHERE m.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!matchResult.rows.length) return res.status(404).json({ error: 'Match not found' });
    const id = uuidv4();
    const tournamentGameId = matchResult.rows[0].tournament_game_id || null;
    await query(
      `INSERT INTO tournament_game_streams (id, game_id, match_id, streamer_user_id, stream_url)
       VALUES (?, ?, ?, ?, ?)`,
      [id, tournamentGameId, tournamentGameId ? null : req.params.id, req.userId, req.body.stream_url]
    );
    const result = await query(
      `SELECT streams.id, streams.stream_url, streams.streamer_user_id,
              streamer.nickname AS streamer_nickname, streams.created_at, streams.updated_at
       FROM tournament_game_streams streams
       JOIN users_extension streamer ON streamer.id = streams.streamer_user_id
       WHERE streams.id = ?`, [id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create match stream error:', error);
    return res.status(500).json({ error: 'Failed to create match stream' });
  }
});

router.put('/:id/streams/:streamId', streamerMiddleware, async (req: AuthRequest, res) => {
  try {
    if (typeof req.body?.stream_url !== 'string' || req.body.stream_url.length > 2048) return res.status(400).json({ error: 'stream_url must be a valid HTTP(S) URL' });
    const parsed = new URL(req.body.stream_url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'stream_url must be a valid HTTP(S) URL' });
    const result = await query(
      `UPDATE tournament_game_streams streams
       LEFT JOIN tournament_games tg ON tg.id = streams.game_id
       SET streams.stream_url = ?
       WHERE streams.id = ? AND streams.streamer_user_id = ?
         AND (streams.match_id = ? OR tg.match_id = ?)`,
      [req.body.stream_url, req.params.streamId, req.userId, req.params.id, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Stream link not found' });
    return res.json({ success: true });
  } catch { return res.status(400).json({ error: 'stream_url must be a valid HTTP(S) URL' }); }
});

router.delete('/:id/streams/:streamId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const permission = await query(
      `SELECT streams.stream_url, streams.streamer_user_id, streamer.nickname AS stream_owner_nickname,
              COALESCE(m.tournament_id, tournament_match.tournament_id) AS tournament_id
       FROM tournament_game_streams streams
       JOIN users_extension streamer ON streamer.id = streams.streamer_user_id
       LEFT JOIN matches m ON m.id = streams.match_id
       LEFT JOIN tournament_games tg ON tg.id = streams.game_id
       LEFT JOIN matches tournament_match ON tournament_match.id = tg.match_id
       WHERE streams.id = ? AND (streams.match_id = ? OR tg.match_id = ?) LIMIT 1`,
      [req.params.streamId, req.params.id, req.params.id]
    );
    if (!permission.rows.length) return res.status(404).json({ error: 'Stream link not found' });
    const row = permission.rows[0];
    const tournamentId = row.tournament_id || null;
    const admin = Boolean((await query('SELECT is_admin FROM users_extension WHERE id = ?', [req.userId])).rows[0]?.is_admin);
    const organizer = Boolean(tournamentId && await isTournamentOrganizer(tournamentId, req.userId!));
    const moderator = await checkUserIsForumModerator(req.username!);
    const owner = row.streamer_user_id === req.userId;
    if (!admin && !organizer && !moderator && !owner) return res.status(403).json({ error: 'Stream removal permission denied' });
    await query('DELETE FROM tournament_game_streams WHERE id = ?', [req.params.streamId]);
    await logAuditEvent({
      event_type: 'STREAM_LINK_DELETED', user_id: req.userId, username: req.username,
      ip_address: getUserIP(req), user_agent: getUserAgent(req),
      details: { match_id: req.params.id, stream_id: req.params.streamId, stream_url: row.stream_url,
        stream_owner_user_id: row.streamer_user_id, stream_owner_nickname: row.stream_owner_nickname,
        deleted_by_role: admin ? 'admin' : organizer ? 'organizer' : moderator ? 'moderator' : 'streamer' },
    });
    return res.status(204).send();
  } catch (error) { console.error('Delete match stream error:', error); return res.status(500).json({ error: 'Failed to delete match stream' }); }
});

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // Get page from query params, default to 1
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get filter params from query
    const playerFilter = (req.query.player as string)?.trim() || '';
    const mapFilter = (req.query.map as string)?.trim() || '';
    const statusFilter = (req.query.status as string)?.trim() || '';
    const confirmedFilter = (req.query.confirmed as string)?.trim() || '';
    const factionFilter = (req.query.faction as string)?.trim() || '';

    console.log('🔍 GET /matches - Filters received:', { playerFilter, mapFilter, statusFilter, confirmedFilter, factionFilter });

    // Build WHERE clause dynamically
    // This legacy history endpoint follows the same rule as the combined feed:
    // administrative tournament outcomes remain visible in the tournament,
    // but only played games with a replay URL belong in match histories.
    let whereConditions: string[] = ["TRIM(COALESCE(m.replay_file_path, '')) <> ''"];
    let params: any[] = [];

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

    if (confirmedFilter) {
      whereConditions.push(`m.status = ?`);
      params.push(confirmedFilter);
    }

    if (factionFilter) {
      whereConditions.push(`(m.winner_faction = ? OR m.loser_faction = ?)`);
      params.push(factionFilter);
      params.push(factionFilter);
      console.log('🔍 Faction filter applied:', factionFilter);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count of filtered matches
    const countQuery = `SELECT COUNT(*) as total FROM matches m 
                        JOIN users_extension w ON m.winner_id = w.id 
                        JOIN users_extension l ON m.loser_id = l.id 
                        ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Get matches for current page with filters
    params.push(limit);
    params.push(offset);
    const result = await query(
      `SELECT m.id, m.winner_id, m.loser_id, m.winner_faction, m.loser_faction, m.map, m.status,
              m.winner_elo_before, m.winner_elo_after, m.loser_elo_before, m.loser_elo_after,
              m.winner_rating, m.loser_rating, m.winner_comments, m.loser_comments,
              m.replay_file_path, m.replay_downloads, m.created_at, m.updated_at, m.played_at,
              m.admin_reviewed, m.tournament_id,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname,
              COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id', s.id, 'stream_url', s.stream_url, 'streamer_user_id', s.streamer_user_id, 'streamer_nickname', su.nickname, 'created_at', s.created_at, 'updated_at', s.updated_at)) FROM tournament_game_streams s JOIN users_extension su ON su.id = s.streamer_user_id LEFT JOIN tournament_games sg ON sg.id = s.game_id WHERE s.match_id = m.id OR sg.match_id = m.id), JSON_ARRAY()) AS stream_links,
              'match' as source_type
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    // Get replays with confidence=1 to show as pending reports (ONLY for involved players)
    const replayResult = await query(
      `SELECT 
        r.id, 
        r.replay_filename,
        r.game_name,
        r.parse_summary,
        r.created_at,
        r.wesnoth_version,
        r.cancel_requested_by,
        r.parse_status
       FROM replays r
       WHERE r.integration_confidence = 1
         AND r.parsed = 1
         AND r.parse_status NOT IN ('rejected')
         AND r.match_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM matches linked_match WHERE linked_match.replay_id = r.id)
         AND r.tournament_game_id IS NULL
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    console.log(`📊 [MATCHES] Found ${result.rows.length} matches and ${replayResult.rows?.length || 0} confidence=1 replays`);

    // DEBUG: log raw replay rows before filtering
    if (process.env.BACKEND_DEBUG_LOGS === 'true') {
      const debugReplays = await query(
        `SELECT r.id, r.tournament_game_id, r.integration_confidence, r.parsed, r.match_id, r.parse_status
         FROM replays r
         WHERE r.integration_confidence = 1 AND r.parsed = 1 AND r.parse_status NOT IN ('rejected')
           AND r.match_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM matches linked_match WHERE linked_match.replay_id = r.id)
         ORDER BY r.created_at DESC LIMIT 10`,
        []
      );
      console.log(`🔍 [MATCHES DEBUG] All confidence=1 parsed replays (before tournament filter):`, JSON.stringify(debugReplays.rows));
      console.log(`🔍 [MATCHES DEBUG] Filtered replay rows returned:`, JSON.stringify(replayResult.rows?.map((r: any) => r.id)));
    }

    // Get current user's nickname and admin status once (for security check)
    const currentUserResult = await query(
      `SELECT nickname, is_admin FROM users_extension WHERE id = ?`,
      [req.userId]
    );
    const currentUserNickname = currentUserResult.rows?.[0]?.nickname?.toLowerCase() || '';
    const currentUserIsAdmin = !!(currentUserResult.rows?.[0]?.is_admin);

    console.log(`🔍 [MATCHES DEBUG] userId=${req.userId} nickname=${currentUserNickname} isAdmin=${currentUserIsAdmin} replayRows=${replayResult.rows?.length ?? 'undefined'}`);

    // Format confidence=1 replays as match-like objects - BUT ONLY IF USER IS INVOLVED
    const formattedReplays = [];
    
    for (const r of replayResult.rows) {
      try {
        const parseSummary = typeof r.parse_summary === 'string' 
          ? JSON.parse(r.parse_summary) 
          : r.parse_summary;

        // Extract players from parse_summary
        const players = parseSummary.forumPlayers || [];
        if (players.length < 2) continue;

        const player1Name = players[0]?.user_name?.toLowerCase() || '';
        const player2Name = players[1]?.user_name?.toLowerCase() || '';

        // SECURITY: Only show this replay to involved players OR admins
        const isInvolved = currentUserNickname === player1Name || currentUserNickname === player2Name;
        if (!isInvolved && !currentUserIsAdmin) {
          continue;
        }

        // Get victory condition info
        const victory = parseSummary.replayVictory || {};
        const winnerName = victory.winner_name || players[0]?.user_name || 'Unknown';
        const loserName = victory.loser_name || players[1]?.user_name || 'Unknown';

        const winnerPlayer = players.find((p: any) => p.user_name === winnerName);
        const loserPlayer = players.find((p: any) => p.user_name === loserName);

        const resolvedFactions = parseSummary.resolvedFactions || parseSummary.finalFactions || {};
        const winner_faction = (winnerPlayer ? resolvedFactions[`side${winnerPlayer.side_number}`] : null) || 'Unknown';
        const loser_faction = (loserPlayer ? resolvedFactions[`side${loserPlayer.side_number}`] : null) || 'Unknown';
        const winner_side = winnerPlayer?.side_number || null;
        const loser_side = loserPlayer?.side_number || null;

        formattedReplays.push({
          id: r.id,
          winner_id: null,  // Unknown until reported
          loser_id: null,   // Unknown until reported
          winner_nickname: winnerName,
          loser_nickname: loserName,
          winner_faction: winner_faction,
          loser_faction: loser_faction,
          winner_side: winner_side,
          loser_side: loser_side,
          map: parseSummary.resolvedMap || parseSummary.forumMap || 'Unknown',
          status: 'pending_report',
          winner_elo_before: null,
          winner_elo_after: null,
          loser_elo_before: null,
          loser_elo_after: null,
          winner_rating: null,
          loser_rating: null,
          winner_comments: null,
          loser_comments: null,
          replay_file_path: `https://replays.wesnoth.org/${r.wesnoth_version}/${r.replay_filename}`,
          replay_downloads: 0,
          created_at: r.created_at,
          updated_at: r.created_at,
          played_at: null,
          admin_reviewed: false,
          tournament_id: null,
          parse_status: r.parse_status,
          source_type: r.parse_status === 'due' ? 'replay_confidence_1_due' : 'replay_confidence_1',
          replay_id: r.id,
          confidence_level: 1,
          parse_summary: parseSummary,
          replay_filename: r.replay_filename,
          game_name: r.game_name,
          cancel_requested_by: r.cancel_requested_by || null,
          is_admin_view: currentUserIsAdmin && !isInvolved
        });
      } catch (error) {
        console.error('Error formatting replay:', error);
        continue;
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

    // Apply pagination to combined results
    const paginatedResults = allResults.slice(0, limit);
    const combinedTotal = total + (replayResult.rows?.length || 0);
    const combinedTotalPages = Math.ceil(combinedTotal / limit);

    res.json({
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: combinedTotal,
        totalPages: combinedTotalPages,
        showing: paginatedResults.length
      }
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

/**
 * POST /api/matches/admin-discard-replay
 * Admin-only: immediately discard a confidence=1 replay.
 * Players are NOT asked for confirmation; replay goes straight to parse_status='rejected'.
 * Body: { replayId: string }
 */
router.post('/admin-discard-replay', authMiddleware, globalRecalculationMiddleware, async (req: AuthRequest, res) => {
  try {
    const { replayId } = req.body;
    if (!replayId) {
      return res.status(400).json({ error: 'Missing required field: replayId' });
    }

    // Verify admin
    const adminResult = await query(
      `SELECT is_admin FROM users_extension WHERE id = ?`,
      [req.userId]
    );
    if (!adminResult.rows?.[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Verify replay exists and is awaiting confirmation
    const replayResult = await query(
      `SELECT id, parse_status, integration_confidence, need_integration, replay_filename FROM replays WHERE id = ?`,
      [replayId]
    );
    const replay = replayResult.rows?.[0];
    if (!replay || replay.need_integration !== 1) {
      return res.status(400).json({ error: 'Replay is not awaiting confirmation' });
    }

    await query(
      `UPDATE replays SET parse_status = 'rejected', need_integration = 0, parsed = 1, updated_at = NOW() WHERE id = ?`,
      [replayId]
    );

    // Same event as the Admin Replays force-discard, so every staff discard is
    // found under one type; `source` tells the two entry points apart.
    await logAuditEvent({
      event_type: 'REPLAY_FORCE_DISCARDED',
      user_id: req.userId,
      username: req.username,
      ip_address: getUserIP(req),
      user_agent: getUserAgent(req),
      details: {
        replay_id: replayId,
        filename: replay.replay_filename,
        previous_status: replay.parse_status,
        integration_confidence: replay.integration_confidence,
        source: 'confirmation_queue',
      }
    });

    console.log(`🗑️  [ADMIN DISCARD] Replay ${replayId} discarded by admin ${req.userId}`);
    res.json({ status: 'success', message: 'Replay discarded by admin', replay_id: replayId });
  } catch (error) {
    console.error('Error in admin-discard-replay:', error);
    res.status(500).json({ error: 'Failed to discard replay' });
  }
});

export default router;
