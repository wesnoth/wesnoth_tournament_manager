import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { authMiddleware, AuthRequest, optionalAuthMiddleware } from '../middleware/auth.js';
import { sendDiscordNotification, storeNotificationForUsers } from '../services/discordNotificationService.js';
import {
  createRoundMatchProposal,
  createMatchProposal,
  getRoundMatchProposal,
  getMatchProposal,
  getParticipantsAvailability,
  confirmProposal,
  confirmPartialSlots,
  cancelConfirmation,
  rejectAndCounterPropose,
  modifyProposal,
  cancelProposal,
  checkProposalFullyConfirmed
} from '../services/tournamentSchedulingService.js';

const router = Router();

console.log('🔧 Registering tournament scheduling routes');

// Convert ISO string to MySQL datetime format (YYYY-MM-DD HH:MM:SS)
const isoToMySQLDatetime = (isoString: string): string => {
  const date = new Date(isoString);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * GET /pending-confirmations
 * Get all schedules pending confirmation for the current user
 * Returns matches where a schedule was proposed and is waiting for user's confirmation
 * MUST be before /:tournamentRoundMatchId routes to avoid route param collision
 */
router.get('/pending-confirmations', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    // Get all schedules where a schedule was proposed and this user is the OTHER participant
    // This means: scheduled_status is not 'pending' and not 'confirmed', and user is NOT the one who proposed
    const result = await query(
      `SELECT 
        trm.id,
        trm.scheduled_datetime,
        trm.scheduled_status,
        trm.scheduled_by_player_id,
        trm.tournament_id,
        t.name as tournament_name,
        t.tournament_mode,
        trm.player1_id,
        trm.player2_id
      FROM tournament_round_matches trm
      JOIN tournaments t ON trm.tournament_id = t.id
      WHERE trm.scheduled_status NOT IN ('pending', 'confirmed')
      AND trm.scheduled_datetime IS NOT NULL`,
      []
    );

    if (!result.rows) {
      return res.json({ schedules: [] });
    }

    const schedules = [];
    for (const match of result.rows) {
      let isParticipant = false;
      let isProposer = false;

      if (match.tournament_mode === 'team') {
        // Check if user is on one of the teams
        const userTeamResult = await query(
          `SELECT team_id FROM tournament_participants 
          WHERE tournament_id = ? AND user_id = ? 
          LIMIT 1`,
          [match.tournament_id, userId]
        );

        if (userTeamResult.rows && userTeamResult.rows.length > 0) {
          const userTeamId = userTeamResult.rows[0].team_id;
          isParticipant = userTeamId === match.player1_id || userTeamId === match.player2_id;
          isProposer = userTeamId === match.scheduled_by_player_id;
        }
      } else {
        // 1v1 tournament
        isParticipant = userId === match.player1_id || userId === match.player2_id;
        isProposer = userId === match.scheduled_by_player_id;
      }

      // Only include if user is a participant but NOT the one who proposed
      if (isParticipant && !isProposer) {
        schedules.push({
          matchId: match.id,
          tournamentName: match.tournament_name,
          scheduledDatetime: match.scheduled_datetime,
          status: match.scheduled_status,
        });
      }
    }

    res.json({ schedules });
  } catch (error) {
    console.error('❌ [TOURNAMENT_SCHEDULING] Error fetching pending confirmations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:tournamentRoundMatchId/schedule
 * Get current schedule status for a match (PUBLIC ENDPOINT)
 * Unauthenticated users: see only confirmed schedules
 * Authenticated participants: see proposals and confirmed schedules
 * MUST be BEFORE /:tournamentId/matches-pending-schedule to avoid route collision
 */
router.get('/:tournamentRoundMatchId/schedule', async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentRoundMatchId } = req.params;
    
    // Try to extract userId from token, but don't fail if missing (public endpoint)
    let userId: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = await new Promise<any>((resolve, reject) => {
          require('jsonwebtoken').verify(token, process.env.JWT_SECRET || 'your-secret-key', (err: any, decoded: any) => {
            if (err) reject(err);
            else resolve(decoded);
          });
        });
        userId = decoded.userId;
      } catch {
        // Token invalid or missing - that's ok for this public endpoint
        userId = undefined;
      }
    }

    const scheduleResult = await query(
      `SELECT 
        trm.id,
        trm.scheduled_datetime,
        trm.scheduled_status,
        trm.scheduled_by_player_id,
        trm.scheduled_confirmed_at,
        trm.player1_id,
        trm.player2_id,
        trm.tournament_id,
        t.tournament_mode
      FROM tournament_round_matches trm
      JOIN tournaments t ON trm.tournament_id = t.id
      WHERE trm.id = ?`,
      [tournamentRoundMatchId]
    );

    if (!scheduleResult.rows || scheduleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = scheduleResult.rows[0];

    // Only show confirmed schedules publicly
    if (match.scheduled_status === 'confirmed') {
      res.json({ schedule: match });
      return;
    }

    if (!userId) {
      // Not authenticated - only show confirmed
      res.json({ schedule: { scheduled_status: 'no_schedule' } });
      return;
    }

    // Check if user is participant
    let isParticipant = false;

    if (match.tournament_mode === 'team') {
      // Team tournament - check if user is on one of the teams
      const userTeamResult = await query(
        `SELECT team_id FROM tournament_participants 
        WHERE tournament_id = ? AND user_id = ? 
        LIMIT 1`,
        [match.tournament_id, userId]
      );

      if (userTeamResult.rows && userTeamResult.rows.length > 0) {
        const userTeamId = userTeamResult.rows[0].team_id;
        isParticipant = userTeamId === match.player1_id || userTeamId === match.player2_id;
      }
    } else {
      // 1v1 tournament
      isParticipant = userId === match.player1_id || userId === match.player2_id;
    }

    if (isParticipant) {
      // Participant - show proposals
      res.json({ schedule: match });
    } else {
      // Not participant - only show confirmed
      res.json({ schedule: { scheduled_status: 'no_schedule' } });
    }
  } catch (error) {
    console.error('❌ [TOURNAMENT_SCHEDULING] Error fetching schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:tournamentId/matches-pending-schedule
 * Get all pending/in_progress matches that can be scheduled for a tournament
 * Participant sees only their matches; organizers see all
 */
router.get('/:tournamentId/matches-pending-schedule', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentId } = req.params;
    const userId = req.userId;

    if (!userId || !tournamentId) {
      return res.status(400).json({ error: 'Missing userId or tournamentId' });
    }

    // Get tournament info
    const tournamentResult = await query(
      'SELECT id, name, tournament_mode FROM tournaments WHERE id = ?',
      [tournamentId]
    );

    if (!tournamentResult.rows || tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentResult.rows[0];

    // For team tournaments, need to check team membership
    let userTeams: any[] = [];
    if (tournament.tournament_mode === 'team') {
      const teamResult = await query(
        `SELECT t.id FROM tournament_teams t
         WHERE t.tournament_id = ? AND t.id IN (
           SELECT DISTINCT team_id FROM tournament_participants WHERE user_id = ?
         )`,
        [tournamentId, userId]
      );
      userTeams = teamResult.rows || [];
    }

    // Get all pending/in_progress matches for this tournament
    let matches;
    if (tournament.tournament_mode === 'team') {
      const teamIds = userTeams.map((t: any) => t.id);
      if (teamIds.length === 0) {
        return res.json({ matches: [] }); // User has no teams in this tournament
      }

      const matchResult = await query(
        `SELECT 
          trm.id, 
          trm.tournament_id,
          trm.round_id,
          trm.player1_id,
          trm.player2_id,
          trm.best_of,
          trm.series_status,
          trm.scheduled_datetime,
          trm.scheduled_status,
          trm.scheduled_by_player_id,
          trm.scheduled_confirmed_at,
          tr.round_number,
          t1.name as team1_name,
          t2.name as team2_name
        FROM tournament_round_matches trm
        JOIN tournament_rounds tr ON trm.round_id = tr.id
        JOIN tournament_teams t1 ON trm.player1_id = t1.id
        JOIN tournament_teams t2 ON trm.player2_id = t2.id
        WHERE trm.tournament_id = ?
          AND trm.series_status IN ('pending', 'in_progress')
          AND (trm.player1_id IN (${teamIds.map(() => '?').join(',')}) OR trm.player2_id IN (${teamIds.map(() => '?').join(',')}))
        ORDER BY tr.round_number ASC, trm.created_at ASC`,
        [tournamentId, ...teamIds, ...teamIds]
      );
      matches = matchResult.rows || [];
    } else {
      const matchResult = await query(
        `SELECT 
          trm.id, 
          trm.tournament_id,
          trm.round_id,
          trm.player1_id,
          trm.player2_id,
          trm.best_of,
          trm.series_status,
          trm.scheduled_datetime,
          trm.scheduled_status,
          trm.scheduled_by_player_id,
          trm.scheduled_confirmed_at,
          tr.round_number,
          u1.username as player1_name,
          u2.username as player2_name
        FROM tournament_round_matches trm
        JOIN tournament_rounds tr ON trm.round_id = tr.id
        JOIN users_extension u1 ON trm.player1_id = u1.user_id
        JOIN users_extension u2 ON trm.player2_id = u2.user_id
        WHERE trm.tournament_id = ?
          AND trm.series_status IN ('pending', 'in_progress')
          AND (trm.player1_id = ? OR trm.player2_id = ?)
        ORDER BY tr.round_number ASC, trm.created_at ASC`,
        [tournamentId, userId, userId]
      );
      matches = matchResult.rows || [];
    }

    res.json({ matches });
  } catch (error) {
    console.error('❌ [TOURNAMENT_SCHEDULING] Error fetching pending matches:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


/**
 * POST /:tournamentRoundMatchId/propose-schedule
 * Propose a match schedule (can be counter-proposed by opponent)
 * Body: { scheduled_datetime: ISO string (UTC), scheduleMessage?: string (max 500 chars) }
 */
router.post('/:tournamentRoundMatchId/propose-schedule', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentRoundMatchId } = req.params;
    const { scheduled_datetime, scheduleMessage } = req.body;
    const userId = req.userId;

    if (!userId || !tournamentRoundMatchId || !scheduled_datetime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate datetime is a valid ISO string
    const dateObj = new Date(scheduled_datetime);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: 'Invalid datetime format' });
    }

    // Validate and sanitize scheduleMessage if provided
    let sanitizedMessage: string | null = null;
    if (scheduleMessage) {
      if (typeof scheduleMessage !== 'string') {
        return res.status(400).json({ error: 'Schedule message must be a string' });
      }
      if (scheduleMessage.length > 500) {
        return res.status(400).json({ error: 'Schedule message cannot exceed 500 characters' });
      }
      sanitizedMessage = scheduleMessage.trim();
    }

    // Get match details
    const matchResult = await query(
      `SELECT 
        trm.id,
        trm.tournament_id,
        trm.player1_id,
        trm.player2_id,
        trm.series_status,
        trm.scheduled_datetime,
        trm.scheduled_status,
        t.tournament_mode
      FROM tournament_round_matches trm
      JOIN tournaments t ON trm.tournament_id = t.id
      WHERE trm.id = ?`,
      [tournamentRoundMatchId]
    );

    if (!matchResult.rows || matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchResult.rows[0];

    // Check if series is already completed
    if (match.series_status === 'completed') {
      return res.status(400).json({ error: 'Series is already completed' });
    }

    // Check if user is a participant
    let isParticipant = false;
    let isPlayer1 = false;
    let opponentId = null;

    if (match.tournament_mode === 'team') {
      // Team tournament - check if user is on one of the teams
      const userTeamResult = await query(
        `SELECT team_id FROM tournament_participants 
        WHERE tournament_id = ? AND user_id = ? 
        LIMIT 1`,
        [match.tournament_id, userId]
      );

      if (!userTeamResult.rows || userTeamResult.rows.length === 0) {
        return res.status(403).json({ error: 'You are not a participant in this match' });
      }

      const userTeamId = userTeamResult.rows[0].team_id;
      if (userTeamId === match.player1_id) {
        isPlayer1 = true;
        isParticipant = true;
        opponentId = match.player2_id;
      } else if (userTeamId === match.player2_id) {
        isPlayer1 = false;
        isParticipant = true;
        opponentId = match.player1_id;
      }
    } else {
      // 1v1 tournament
      if (userId === match.player1_id) {
        isPlayer1 = true;
        isParticipant = true;
        opponentId = match.player2_id;
      } else if (userId === match.player2_id) {
        isPlayer1 = false;
        isParticipant = true;
        opponentId = match.player1_id;
      }
    }

    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this match' });
    }

    // Update schedule
    const newStatus = isPlayer1 ? 'player1_proposed' : 'player2_proposed';
    const now = new Date();
    const mysqlDateTime = isoToMySQLDatetime(scheduled_datetime);

    await query(
      `UPDATE tournament_round_matches 
      SET 
        scheduled_datetime = ?,
        scheduled_status = ?,
        scheduled_by_player_id = ?,
        updated_at = ?
      WHERE id = ?`,
      [mysqlDateTime, newStatus, userId, now, tournamentRoundMatchId]
    );

    // If this is a reschedule (previous status was anything but pending), mark old notifications as read
    if (match.scheduled_status && match.scheduled_status !== 'pending') {
      await query(
        `UPDATE user_notifications 
        SET is_read = true 
        WHERE match_id = ? AND (type = 'schedule_confirmed' OR type = 'schedule_proposal') AND is_read = false`,
        [tournamentRoundMatchId]
      ).catch(err => console.error('⚠️ Error marking old notifications as read:', err));
    }

    // Get opponent name/email for Discord notification
    // For team tournaments, get team members; for 1v1, get opponent user
    let opponentName = 'Opponent';
    let proposerName = 'Player';
    let opponentEmail = null;
    let opponentSocketRecipients: string[] = [];

    if (match.tournament_mode === 'team') {
      // Team tournament - get all members of opponent team
      const teamResult = await query(
        'SELECT name FROM tournament_teams WHERE id = ?',
        [opponentId]
      );
      opponentName = teamResult.rows && teamResult.rows.length > 0 ? teamResult.rows[0].name : 'Opponent Team';

      // Get proposer team name
      const proposerTeamResult = await query(
        'SELECT name FROM tournament_teams WHERE id = ?',
        [isPlayer1 ? match.player1_id : match.player2_id]
      );
      proposerName = proposerTeamResult.rows && proposerTeamResult.rows.length > 0 ? proposerTeamResult.rows[0].name : 'Team';

      // Get all users in the opponent team with their Discord IDs
      const teamMembersResult = await query(
        `SELECT tp.user_id, ue.discord_id FROM tournament_participants tp
         LEFT JOIN users_extension ue ON tp.user_id = ue.id
         WHERE tp.tournament_id = ? AND tp.team_id = ?`,
        [match.tournament_id, opponentId]
      );

      if (teamMembersResult.rows) {
        opponentSocketRecipients = teamMembersResult.rows.map((row: any) => row.user_id);
        // Collect Discord IDs for mentions (filter out null values)
        const opponentDiscordIds = teamMembersResult.rows
          .map((row: any) => row.discord_id)
          .filter((id: string | null) => id !== null && id !== undefined);
        
        if (opponentDiscordIds.length > 0) {
          opponentEmail = opponentDiscordIds; // Store Discord IDs for later use
        }
      }
    } else {
      // 1v1 tournament
      const opponentResult = await query(
        'SELECT username, discord_id FROM users_extension WHERE user_id = ?',
        [opponentId]
      );
      opponentName = opponentResult.rows && opponentResult.rows.length > 0 ? opponentResult.rows[0].username : 'Opponent';
      
      const proposerResult = await query(
        'SELECT username FROM users_extension WHERE user_id = ?',
        [userId]
      );
      proposerName = proposerResult.rows && proposerResult.rows.length > 0 ? proposerResult.rows[0].username : 'Player';
      
      // Get Discord ID for mention
      if (opponentResult.rows && opponentResult.rows.length > 0 && opponentResult.rows[0].discord_id) {
        opponentEmail = [opponentResult.rows[0].discord_id]; // Store as array for consistency
      }
      
      // For 1v1, send notification to the opponent user only
      opponentSocketRecipients = [opponentId];
    }

    // Get tournament details for Discord
    const tournamentResult = await query(
      'SELECT name FROM tournaments WHERE id = ?',
      [match.tournament_id]
    );
    const tournamentName = tournamentResult.rows && tournamentResult.rows.length > 0 ? tournamentResult.rows[0].name : 'Tournament';

    // Send Discord notification to tournament channel with enhanced format
    const scheduleTimeUTC = new Date(scheduled_datetime).toLocaleString('es-ES', { timeZone: 'UTC' });
    
    console.log(`📋 [SCHEDULE_PROPOSAL] About to send Discord notification with:`, {
      opponentEmail,
      toDiscordIds: Array.isArray(opponentEmail) ? opponentEmail : 'NOT ARRAY'
    });
    
    await sendDiscordNotification(
      match.tournament_id,
      'schedule_proposal',
      {
        tournamentName,
        fromTeamName: match.tournament_mode === 'team' ? proposerName : undefined,
        fromUserName: match.tournament_mode === '1v1' ? proposerName : undefined,
        toTeamName: match.tournament_mode === 'team' ? opponentName : undefined,
        toUserName: match.tournament_mode === '1v1' ? opponentName : undefined,
        toDiscordIds: Array.isArray(opponentEmail) ? opponentEmail : undefined,
        proposedDateTime: scheduleTimeUTC,
        messageExtra: sanitizedMessage || undefined,
      }
    ).catch(err => console.error('⚠️ Discord notification failed:', err));

    // Store notification in database (fallback for offline users)
    const notificationTitle = `🗓️ Schedule Proposal - ${tournamentName}`;
    const notificationMessage = `${proposerName} proposed schedule: ${scheduleTimeUTC} UTC`;
    
    await storeNotificationForUsers(
      opponentSocketRecipients,
      match.tournament_id,
      tournamentRoundMatchId,
      'schedule_proposal',
      notificationTitle,
      notificationMessage,
      sanitizedMessage
    ).catch(err => console.error('⚠️ Error storing notifications:', err));

    res.json({
      success: true,
      message: 'Schedule proposal sent',
      schedule: {
        scheduled_datetime,
        scheduled_status: newStatus,
        scheduled_by_player_id: userId
      }
    });
  } catch (error) {
    console.error('❌ [TOURNAMENT_SCHEDULING] Error proposing schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:tournamentRoundMatchId/confirm-schedule
 * Confirm a proposed match schedule
 */
router.post('/:tournamentRoundMatchId/confirm-schedule', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentRoundMatchId } = req.params;
    const userId = req.userId;

    if (!userId || !tournamentRoundMatchId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get match details
    const matchResult = await query(
      `SELECT 
        trm.id,
        trm.tournament_id,
        trm.player1_id,
        trm.player2_id,
        trm.series_status,
        trm.scheduled_datetime,
        trm.scheduled_status,
        trm.scheduled_by_player_id,
        t.tournament_mode
      FROM tournament_round_matches trm
      JOIN tournaments t ON trm.tournament_id = t.id
      WHERE trm.id = ?`,
      [tournamentRoundMatchId]
    );

    if (!matchResult.rows || matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchResult.rows[0];

    // Check if user is a participant
    let isParticipant = false;
    let opponentId = null;

    if (match.tournament_mode === 'team') {
      const userTeamResult = await query(
        `SELECT team_id FROM tournament_participants 
        WHERE tournament_id = ? AND user_id = ? 
        LIMIT 1`,
        [match.tournament_id, userId]
      );

      if (!userTeamResult.rows || userTeamResult.rows.length === 0) {
        return res.status(403).json({ error: 'You are not a participant in this match' });
      }

      const userTeamId = userTeamResult.rows[0].team_id;
      if (userTeamId === match.player1_id) {
        isParticipant = true;
        opponentId = match.player2_id;
      } else if (userTeamId === match.player2_id) {
        isParticipant = true;
        opponentId = match.player1_id;
      }
    } else {
      if (userId === match.player1_id) {
        isParticipant = true;
        opponentId = match.player2_id;
      } else if (userId === match.player2_id) {
        isParticipant = true;
        opponentId = match.player1_id;
      }
    }

    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this match' });
    }

    // Check if there's a pending proposal
    if (!match.scheduled_datetime || match.scheduled_status === 'pending') {
      return res.status(400).json({ error: 'No schedule proposal to confirm' });
    }

    // Check if user was the one who proposed (can't confirm own proposal)
    if (match.scheduled_by_player_id === userId) {
      return res.status(400).json({ error: 'You cannot confirm your own proposal' });
    }

    // Update to confirmed
    const now = new Date();
    await query(
      `UPDATE tournament_round_matches 
      SET 
        scheduled_status = 'confirmed',
        scheduled_confirmed_at = ?,
        updated_at = ?
      WHERE id = ?`,
      [now, now, tournamentRoundMatchId]
    );

    // Mark old schedule_proposal notifications as read for this match
    await query(
      `UPDATE user_notifications 
      SET is_read = true 
      WHERE match_id = ? AND type = 'schedule_proposal' AND is_read = false`,
      [tournamentRoundMatchId]
    ).catch(err => console.error('⚠️ Error marking old notifications as read:', err));

    // Get opponent name for Discord notification and team members for Socket.IO
    let opponentName = 'Opponent';
    let proposerSocketRecipients: string[] = [];
    let confirmerSocketRecipients: string[] = [];

    const proposerId = match.scheduled_by_player_id;
    const confirmerId = userId;
    
    // Determine which team each user belongs to
    let proposerTeamId: string | null = null;
    let confirmerTeamId: string | null = null;
    
    if (match.tournament_mode === 'team') {
      // Find proposer's team
      const proposerTeamResult = await query(
        `SELECT team_id FROM tournament_participants 
        WHERE tournament_id = ? AND user_id = ? 
        LIMIT 1`,
        [match.tournament_id, proposerId]
      );
      proposerTeamId = proposerTeamResult.rows && proposerTeamResult.rows.length > 0 
        ? proposerTeamResult.rows[0].team_id 
        : null;
      
      // Find confirmer's team
      const confirmerTeamResult = await query(
        `SELECT team_id FROM tournament_participants 
        WHERE tournament_id = ? AND user_id = ? 
        LIMIT 1`,
        [match.tournament_id, confirmerId]
      );
      confirmerTeamId = confirmerTeamResult.rows && confirmerTeamResult.rows.length > 0 
        ? confirmerTeamResult.rows[0].team_id 
        : null;
    } else {
      // 1v1 tournaments: user ID = team ID
      proposerTeamId = proposerId;
      confirmerTeamId = confirmerId;
    }

    if (match.tournament_mode === 'team') {
      // Get proposer team name and members with Discord IDs
      const proposerTeamResult = await query(
        'SELECT name FROM tournament_teams WHERE id = ?',
        [proposerTeamId]
      );
      opponentName = proposerTeamResult.rows && proposerTeamResult.rows.length > 0 ? proposerTeamResult.rows[0].name : 'Opponent Team';

      // Get proposer team members with Discord IDs
      const proposerMembersResult = await query(
        `SELECT tp.user_id, ue.discord_id FROM tournament_participants tp
         LEFT JOIN users_extension ue ON tp.user_id = ue.id
         WHERE tp.tournament_id = ? AND tp.team_id = ?`,
        [match.tournament_id, proposerTeamId]
      );
      if (proposerMembersResult.rows) {
        proposerSocketRecipients = proposerMembersResult.rows.map((row: any) => row.user_id);
      }

      // Get confirmer team members with Discord IDs
      const confirmerMembersResult = await query(
        `SELECT tp.user_id, ue.discord_id FROM tournament_participants tp
         LEFT JOIN users_extension ue ON tp.user_id = ue.id
         WHERE tp.tournament_id = ? AND tp.team_id = ?`,
        [match.tournament_id, confirmerTeamId]
      );
      if (confirmerMembersResult.rows) {
        confirmerSocketRecipients = confirmerMembersResult.rows.map((row: any) => row.user_id);
      }
    } else {
      // 1v1 tournament
      const proposerResult = await query(
        'SELECT username, discord_id FROM users_extension WHERE user_id = ?',
        [proposerId]
      );
      opponentName = proposerResult.rows && proposerResult.rows.length > 0 ? proposerResult.rows[0].username : 'Opponent';

      proposerSocketRecipients = [proposerId];
      confirmerSocketRecipients = [confirmerId];
    }

    // Get tournament details for Discord
    const tournamentResult = await query(
      'SELECT name FROM tournaments WHERE id = ?',
      [match.tournament_id]
    );
    const tournamentName = tournamentResult.rows && tournamentResult.rows.length > 0 ? tournamentResult.rows[0].name : 'Tournament';

    // Get confirmer name (the one who just confirmed)
    let confirmerName = 'Team';
    let proposerDiscordIds: string[] = [];
    let confirmerDiscordIds: string[] = [];
    
    if (match.tournament_mode === 'team') {
      const confirmerTeamResult = await query(
        'SELECT name FROM tournament_teams WHERE id = ?',
        [confirmerTeamId]
      );
      confirmerName = confirmerTeamResult.rows && confirmerTeamResult.rows.length > 0 ? confirmerTeamResult.rows[0].name : 'Team';
      
      // Get proposer team Discord IDs
      const proposerDiscordResult = await query(
        `SELECT ue.discord_id FROM tournament_participants tp
         LEFT JOIN users_extension ue ON tp.user_id = ue.id
         WHERE tp.tournament_id = ? AND tp.team_id = ?
         AND ue.discord_id IS NOT NULL`,
        [match.tournament_id, proposerTeamId]
      );
      if (proposerDiscordResult.rows) {
        proposerDiscordIds = proposerDiscordResult.rows.map((row: any) => row.discord_id);
      }
      
      // Get confirmer team Discord IDs
      const confirmerDiscordResult = await query(
        `SELECT ue.discord_id FROM tournament_participants tp
         LEFT JOIN users_extension ue ON tp.user_id = ue.id
         WHERE tp.tournament_id = ? AND tp.team_id = ?
         AND ue.discord_id IS NOT NULL`,
        [match.tournament_id, confirmerTeamId]
      );
      if (confirmerDiscordResult.rows) {
        confirmerDiscordIds = confirmerDiscordResult.rows.map((row: any) => row.discord_id);
      }
    } else {
      const confirmerResult = await query(
        'SELECT username, discord_id FROM users_extension WHERE user_id = ?',
        [confirmerId]
      );
      confirmerName = confirmerResult.rows && confirmerResult.rows.length > 0 ? confirmerResult.rows[0].username : 'Player';
      
      if (confirmerResult.rows && confirmerResult.rows.length > 0 && confirmerResult.rows[0].discord_id) {
        confirmerDiscordIds = [confirmerResult.rows[0].discord_id];
      }
      
      // Get proposer Discord ID from earlier query
      const proposerResult = await query(
        'SELECT discord_id FROM users_extension WHERE user_id = ?',
        [proposerId]
      );
      if (proposerResult.rows && proposerResult.rows.length > 0 && proposerResult.rows[0].discord_id) {
        proposerDiscordIds = [proposerResult.rows[0].discord_id];
      }
    }

    const scheduleTimeUTC = new Date(match.scheduled_datetime).toLocaleString('es-ES', { timeZone: 'UTC' });

    // Send Discord notification to tournament channel with enhanced format
    await sendDiscordNotification(
      match.tournament_id,
      'schedule_confirmed',
      {
        tournamentName,
        fromUserName: match.tournament_mode === '1v1' ? opponentName : undefined,
        fromTeamName: match.tournament_mode === 'team' ? opponentName : undefined,
        fromDiscordId: proposerDiscordIds.length > 0 ? proposerDiscordIds[0] : undefined,
        toUserName: match.tournament_mode === '1v1' ? confirmerName : undefined,
        toTeamName: match.tournament_mode === 'team' ? confirmerName : undefined,
        toDiscordIds: confirmerDiscordIds.length > 0 ? confirmerDiscordIds : undefined,
        proposedDateTime: scheduleTimeUTC,
      }
    ).catch(err => console.error('⚠️ Discord notification failed:', err));

    // Store notification in database (fallback for offline users)
    const notificationTitle = `✅ Schedule Confirmed - ${tournamentName}`;
    const notificationMessage = `Match scheduled for: ${scheduleTimeUTC} UTC`;
    
    // Combine all recipients (both proposer and confirmer teams)
    const allRecipients = [...new Set([...proposerSocketRecipients, ...confirmerSocketRecipients])];
    
    await storeNotificationForUsers(
      allRecipients,
      match.tournament_id,
      tournamentRoundMatchId,
      'schedule_confirmed',
      notificationTitle,
      notificationMessage,
      undefined
    ).catch(err => console.error('⚠️ Error storing notifications:', err));

    res.json({
      success: true,
      message: 'Schedule confirmed',
      schedule: {
        scheduled_datetime: match.scheduled_datetime,
        scheduled_status: 'confirmed',
        scheduled_confirmed_at: now
      }
    });
  } catch (error) {
    console.error('❌ [TOURNAMENT_SCHEDULING] Error confirming schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:tournamentRoundMatchId/cancel-schedule
 * Cancel/withdraw a proposed or confirmed schedule
 */
router.post('/:tournamentRoundMatchId/cancel-schedule', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentRoundMatchId } = req.params;
    const userId = req.userId;

    if (!userId || !tournamentRoundMatchId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get match details
    const matchResult = await query(
      `SELECT 
        trm.id,
        trm.tournament_id,
        trm.player1_id,
        trm.player2_id,
        trm.scheduled_status,
        trm.scheduled_by_player_id,
        t.tournament_mode
      FROM tournament_round_matches trm
      JOIN tournaments t ON trm.tournament_id = t.id
      WHERE trm.id = ?`,
      [tournamentRoundMatchId]
    );

    if (!matchResult.rows || matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchResult.rows[0];

    // Check if user is a participant
    let isParticipant = false;

    if (match.tournament_mode === 'team') {
      const userTeamResult = await query(
        `SELECT team_id FROM tournament_participants 
        WHERE tournament_id = ? AND user_id = ? 
        LIMIT 1`,
        [match.tournament_id, userId]
      );

      isParticipant = userTeamResult.rows && userTeamResult.rows.length > 0 && 
        (userTeamResult.rows[0].team_id === match.player1_id || userTeamResult.rows[0].team_id === match.player2_id);
    } else {
      isParticipant = userId === match.player1_id || userId === match.player2_id;
    }

    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this match' });
    }

    // Only the person who proposed can cancel
    if (match.scheduled_by_player_id !== userId) {
      return res.status(403).json({ error: 'Only the person who proposed the schedule can cancel it' });
    }

    // Cancel the schedule
    const now = new Date();
    await query(
      `UPDATE tournament_round_matches 
      SET 
        scheduled_datetime = NULL,
        scheduled_status = 'pending',
        scheduled_by_player_id = NULL,
        scheduled_confirmed_at = NULL,
        updated_at = ?
      WHERE id = ?`,
      [now, tournamentRoundMatchId]
    );

    res.json({
      success: true,
      message: 'Schedule cancelled'
    });
  } catch (error) {
    console.error('❌ [TOURNAMENT_SCHEDULING] Error cancelling schedule:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// NEW PHASE 3 ENDPOINTS - Multi-slot scheduling with confirmations
// ============================================================

/**
 * POST /api/tournament/:tournamentId/round-match/:roundMatchId/propose-slots
 * Propose multiple 30-minute slots for a tournament_round_match (entire series)
 */
router.post(
  '/tournament/:tournamentId/round-match/:roundMatchId/propose-slots',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { roundMatchId, tournamentId } = req.params;
      const { slot_datetimes, notes } = req.body;
      const userId = req.userId;

      if (!userId || !roundMatchId || !Array.isArray(slot_datetimes)) {
        return res.status(400).json({
          error: 'Missing required fields: userId, roundMatchId, slot_datetimes (array)'
        });
      }

      // Verify user is a participant in this match
      const matchResult = await query(
        `SELECT trm.player1_id, trm.player2_id, t.tournament_mode 
         FROM tournament_round_matches trm
         JOIN tournaments t ON t.id = trm.tournament_id
         WHERE trm.id = ? AND trm.tournament_id = ?`,
        [roundMatchId, tournamentId]
      );

      if (!matchResult.rows || matchResult.rows.length === 0) {
        return res.status(404).json({ error: 'Match not found' });
      }

      const match = matchResult.rows[0];
      let isParticipant = false;

      if (match.tournament_mode === 'team') {
        // Team tournament - check if user is on one of the teams
        const userTeamResult = await query(
          `SELECT team_id FROM tournament_participants 
           WHERE tournament_id = ? AND user_id = ? 
           LIMIT 1`,
          [tournamentId, userId]
        );

        if (userTeamResult.rows && userTeamResult.rows.length > 0) {
          const userTeamId = userTeamResult.rows[0].team_id;
          isParticipant = userTeamId === match.player1_id || userTeamId === match.player2_id;
        }
      } else {
        // 1v1 tournament - check if user is one of the players
        isParticipant = userId === match.player1_id || userId === match.player2_id;
      }

      if (!isParticipant) {
        return res.status(403).json({ error: 'You are not a participant in this match' });
      }

      // Create proposal with slots
      const { proposalId, slotsCreated } = await createRoundMatchProposal(
        roundMatchId,
        userId,
        slot_datetimes,
        notes
      );

      console.log(`✅ [SCHEDULING] Round match proposal created: ${proposalId} with ${slotsCreated} slots`);

      // TODO: Send notification to opponent
      const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;
      // await storeNotificationForUsers([opponentId], {...});

      res.json({
        success: true,
        proposalId,
        slotsCreated
      });
    } catch (error) {
      console.error('❌ [SCHEDULING] Error proposing round match slots:', error);
      res.status(500).json({
        error: 'Failed to propose schedule',
        details: (error as any).message
      });
    }
  }
);

/**
 * POST /api/tournament/:tournamentId/match/:matchId/propose-slots
 * Propose multiple 30-minute slots for a tournament_match (single game)
 */
router.post(
  '/tournament/:tournamentId/match/:matchId/propose-slots',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { matchId, tournamentId } = req.params;
      const { slot_datetimes, notes } = req.body;
      const userId = req.userId;

      if (!userId || !matchId || !Array.isArray(slot_datetimes)) {
        return res.status(400).json({
          error: 'Missing required fields: userId, matchId, slot_datetimes (array)'
        });
      }

      // Verify user is a participant
      const matchResult = await query(
        `SELECT tm.player1_id, tm.player2_id, t.tournament_mode 
         FROM tournament_matches tm
         JOIN tournaments t ON t.id = tm.tournament_id
         WHERE tm.id = ? AND tm.tournament_id = ?`,
        [matchId, tournamentId]
      );

      if (!matchResult.rows || matchResult.rows.length === 0) {
        return res.status(404).json({ error: 'Match not found' });
      }

      const match = matchResult.rows[0];
      let isParticipant = false;

      if (match.tournament_mode === 'team') {
        // Team tournament - check if user is on one of the teams
        const userTeamResult = await query(
          `SELECT team_id FROM tournament_participants 
           WHERE tournament_id = ? AND user_id = ? 
           LIMIT 1`,
          [tournamentId, userId]
        );

        if (userTeamResult.rows && userTeamResult.rows.length > 0) {
          const userTeamId = userTeamResult.rows[0].team_id;
          isParticipant = userTeamId === match.player1_id || userTeamId === match.player2_id;
        }
      } else {
        // 1v1 tournament - check if user is one of the players
        isParticipant = userId === match.player1_id || userId === match.player2_id;
      }

      if (!isParticipant) {
        return res.status(403).json({ error: 'You are not a participant in this match' });
      }

      // Create proposal
      const { proposalId, slotsCreated } = await createMatchProposal(
        matchId,
        userId,
        slot_datetimes,
        notes
      );

      console.log(`✅ [SCHEDULING] Match proposal created: ${proposalId} with ${slotsCreated} slots`);

      const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;
      // TODO: Send notification

      res.json({
        success: true,
        proposalId,
        slotsCreated
      });
    } catch (error) {
      console.error('❌ [SCHEDULING] Error proposing match slots:', error);
      res.status(500).json({
        error: 'Failed to propose schedule',
        details: (error as any).message
      });
    }
  }
);

/**
 * POST /api/tournament/:tournamentId/round-match/:roundMatchId/confirm-slots
 * Confirm (accept) an existing proposal for a round match with partial slot selection
 * Can select which slots to confirm from the proposed set
 */
router.post(
  '/tournament/:tournamentId/round-match/:roundMatchId/confirm-slots',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { roundMatchId, tournamentId } = req.params;
     const { proposal_id, confirmed_slot_ids } = req.body;
      const userId = req.userId;

      if (!userId || !roundMatchId || !proposal_id) {
        return res.status(400).json({
          error: 'Missing required fields: userId, roundMatchId, proposal_id'
        });
      }

     // Validate confirmed_slot_ids is an array (can be empty to reject all)
     if (!Array.isArray(confirmed_slot_ids)) {
       return res.status(400).json({
         error: 'confirmed_slot_ids must be an array of slot IDs'
       });
     }

     // Verify user is a participant in this match
     const matchResult = await query(
       `SELECT trm.player1_id, trm.player2_id, t.tournament_mode 
        FROM tournament_round_matches trm
        JOIN tournaments t ON t.id = trm.tournament_id
        WHERE trm.id = ? AND trm.tournament_id = ?`,
       [roundMatchId, tournamentId]
     );

     if (!matchResult.rows || matchResult.rows.length === 0) {
       return res.status(404).json({ error: 'Match not found' });
     }

     const match = matchResult.rows[0];
     let isParticipant = false;
     let userTeamId: string | null = null;

     if (match.tournament_mode === 'team') {
       // Team tournament - check if user is on one of the teams
       const userTeamResult = await query(
         `SELECT team_id FROM tournament_participants 
          WHERE tournament_id = ? AND user_id = ? 
          LIMIT 1`,
         [tournamentId, userId]
       );

       if (userTeamResult.rows && userTeamResult.rows.length > 0) {
         userTeamId = userTeamResult.rows[0].team_id;
         isParticipant = userTeamId === match.player1_id || userTeamId === match.player2_id;
       }
     } else {
       // 1v1 tournament - check if user is one of the players
       isParticipant = userId === match.player1_id || userId === match.player2_id;
     }

     if (!isParticipant) {
       return res.status(403).json({ error: 'You are not a participant in this match' });
     }

     // Confirm the proposal with partial slot selection
     const result = await confirmPartialSlots(proposal_id, userId, confirmed_slot_ids);

     console.log(`✅ [SCHEDULING] User ${userId} confirmed proposal ${proposal_id} with ${confirmed_slot_ids.length} slots, fully confirmed: ${result.fullyConfirmed}`);

     res.json({
       success: true,
       fullyConfirmed: result.fullyConfirmed,
       confirmedSlots: result.confirmedSlots
     });
   } catch (error) {
     console.error('❌ [SCHEDULING] Error confirming slots:', error);
     res.status(500).json({
       error: 'Failed to confirm slots',
       details: (error as any).message
     });
   }
 }
);

/**
 * POST /api/tournament/:tournamentId/match/:matchId/confirm-slots
 * Confirm (accept) an existing proposal for a match with partial slot selection
 * Can select which slots to confirm from the proposed set
 */
router.post(
  '/tournament/:tournamentId/match/:matchId/confirm-slots',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { matchId, tournamentId } = req.params;
     const { proposal_id, confirmed_slot_ids } = req.body;
      const userId = req.userId;

      if (!userId || !matchId || !proposal_id) {
        return res.status(400).json({
          error: 'Missing required fields: userId, matchId, proposal_id'
        });
      }

     // Validate confirmed_slot_ids is an array (can be empty to reject all)
     if (!Array.isArray(confirmed_slot_ids)) {
       return res.status(400).json({
         error: 'confirmed_slot_ids must be an array of slot IDs'
       });
     }

     // Verify user is a participant in this match
     const matchResult = await query(
       `SELECT tm.player1_id, tm.player2_id, t.tournament_mode 
        FROM tournament_matches tm
        JOIN tournaments t ON t.id = tm.tournament_id
        WHERE tm.id = ? AND tm.tournament_id = ?`,
       [matchId, tournamentId]
     );

     if (!matchResult.rows || matchResult.rows.length === 0) {
       return res.status(404).json({ error: 'Match not found' });
     }

     const match = matchResult.rows[0];
     let isParticipant = false;
     let userTeamId: string | null = null;

     if (match.tournament_mode === 'team') {
       // Team tournament - check if user is on one of the teams
       const userTeamResult = await query(
         `SELECT team_id FROM tournament_participants 
          WHERE tournament_id = ? AND user_id = ? 
          LIMIT 1`,
         [tournamentId, userId]
       );

       if (userTeamResult.rows && userTeamResult.rows.length > 0) {
         userTeamId = userTeamResult.rows[0].team_id;
         isParticipant = userTeamId === match.player1_id || userTeamId === match.player2_id;
       }
     } else {
       // 1v1 tournament - check if user is one of the players
       isParticipant = userId === match.player1_id || userId === match.player2_id;
     }

     if (!isParticipant) {
       return res.status(403).json({ error: 'You are not a participant in this match' });
     }

     // Confirm the proposal with partial slot selection
     const result = await confirmPartialSlots(proposal_id, userId, confirmed_slot_ids);

     console.log(`✅ [SCHEDULING] User ${userId} confirmed proposal ${proposal_id} with ${confirmed_slot_ids.length} slots, fully confirmed: ${result.fullyConfirmed}`);

     res.json({
       success: true,
       fullyConfirmed: result.fullyConfirmed,
       confirmedSlots: result.confirmedSlots
     });
   } catch (error) {
     console.error('❌ [SCHEDULING] Error confirming slots:', error);
     res.status(500).json({
       error: 'Failed to confirm slots',
       details: (error as any).message
     });
   }
 }
);

/**
 * GET /api/tournament/:tournamentId/round-match/:roundMatchId/proposal
 * Get active proposal with slots and confirmations
 */
router.get(
  '/tournament/:tournamentId/round-match/:roundMatchId/proposal',
  async (req: AuthRequest, res: Response) => {
    try {
      const { roundMatchId, tournamentId } = req.params;

      // Verify match exists
      const matchResult = await query(
        `SELECT id FROM tournament_round_matches WHERE id = ? AND tournament_id = ?`,
        [roundMatchId, tournamentId]
      );

      if (!matchResult.rows || matchResult.rows.length === 0) {
        return res.status(404).json({ error: 'Match not found' });
      }

      const proposal = await getRoundMatchProposal(roundMatchId);

      if (!proposal) {
        return res.json({ proposal: null });
      }

      res.json({ proposal });
    } catch (error) {
      console.error('❌ [SCHEDULING] Error getting proposal:', error);
      res.status(500).json({
        error: 'Failed to fetch proposal',
        details: (error as any).message
      });
    }
  }
);

/**
 * GET /api/tournament/:tournamentId/match/:matchId/proposal
 * Get active proposal for a match
 * Handles both tournament_matches.id and tournament_round_match_id
 */
router.get(
  '/tournament/:tournamentId/match/:matchId/proposal',
  async (req: AuthRequest, res: Response) => {
    try {
      const { matchId, tournamentId } = req.params;

      // Verify match exists (try tournament_matches first)
      let matchResult = await query(
        `SELECT id FROM tournament_matches WHERE id = ? AND tournament_id = ?`,
        [matchId, tournamentId]
      );

      if (matchResult.rows && matchResult.rows.length > 0) {
        // Found as tournament_matches
        const proposal = await getMatchProposal(matchId);
        if (!proposal) {
          return res.json({ proposal: null });
        }
        return res.json({ proposal });
      }

      // If not found, try tournament_round_match_id
      const roundMatchResult = await query(
        `SELECT id FROM tournament_round_matches WHERE id = ? AND tournament_id = ?`,
        [matchId, tournamentId]
      );

      if (!roundMatchResult.rows || roundMatchResult.rows.length === 0) {
        return res.status(404).json({ error: 'Match not found' });
      }

      // This is a round match, use round match logic
      const proposal = await getRoundMatchProposal(matchId);
      if (!proposal) {
        return res.json({ proposal: null });
      }
      res.json({ proposal });
    } catch (error) {
      console.error('❌ [SCHEDULING] Error getting proposal:', error);
      res.status(500).json({
        error: 'Failed to fetch proposal',
        details: (error as any).message
      });
    }
  }
);

/**
 * GET /api/tournament/:tournamentId/round-match/:roundMatchId/participants-availability
 * Get all participants' timezone and availability schedule
 */
router.get(
  '/tournament/:tournamentId/round-match/:roundMatchId/participants-availability',
  optionalAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { roundMatchId, tournamentId } = req.params;

      // Verify match exists
      const matchResult = await query(
        `SELECT id FROM tournament_round_matches WHERE id = ? AND tournament_id = ?`,
        [roundMatchId, tournamentId]
      );

      if (!matchResult.rows || matchResult.rows.length === 0) {
        return res.status(404).json({ error: 'Match not found' });
      }

      const result = await getParticipantsAvailability(roundMatchId, undefined, req.userId);

      res.json(result);
    } catch (error) {
      console.error('❌ [SCHEDULING] Error getting participants availability:', error);
      res.status(500).json({
        error: 'Failed to fetch participants availability',
        details: (error as any).message
      });
    }
  }
);

/**
 * GET /api/tournament/:tournamentId/match/:matchId/participants-availability
 * Get participants for a match
 * Handles both tournament_matches.id and tournament_round_match_id
 * (Since frontend may send either ID type via this endpoint)
 */
router.get(
  '/tournament/:tournamentId/match/:matchId/participants-availability',
  optionalAuthMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { matchId, tournamentId } = req.params;

      // First try to find by tournament_matches.id
      let matchResult = await query(
        `SELECT id FROM tournament_matches WHERE id = ? AND tournament_id = ?`,
        [matchId, tournamentId]
      );

      if (matchResult.rows && matchResult.rows.length > 0) {
        // Found as tournament_matches
        const result = await getParticipantsAvailability(undefined, matchId, req.userId);
        return res.json(result);
      }

      // If not found, try to find by tournament_round_match_id (in case ID was passed incorrectly)
      const roundMatchResult = await query(
        `SELECT id FROM tournament_round_matches WHERE id = ? AND tournament_id = ?`,
        [matchId, tournamentId]
      );

      if (!roundMatchResult.rows || roundMatchResult.rows.length === 0) {
        return res.status(404).json({ error: 'Match not found' });
      }

      // This is actually a round match, not a tournament match - use round match logic
      const result = await getParticipantsAvailability(matchId, undefined, req.userId);
      res.json(result);
    } catch (error) {
      console.error('❌ [SCHEDULING] Error getting participants availability:', error);
      res.status(500).json({
        error: 'Failed to fetch participants availability',
        details: (error as any).message
      });
    }
  }
);

// ============================================================================
// NEW PHASE 2 ENDPOINTS: Proposal confirmation, counter-proposal, etc.
// ============================================================================

/**
 * POST /proposals/:proposalId/confirm
 * Confirm a proposal (proposal-level confirmation)
 */
router.post('/proposals/:proposalId/confirm', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { proposalId } = req.params;
    const userId = req.userId!;

    if (!proposalId) {
      return res.status(400).json({ error: 'Missing proposalId' });
    }

    const result = await confirmProposal(proposalId, userId);
    res.json({ success: true, fullyConfirmed: result.fullyConfirmed });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error confirming proposal:', error);
    res.status(400).json({
      error: (error as any).message || 'Failed to confirm proposal'
    });
  }
});

/**
 * POST /proposals/:proposalId/cancel-confirmation
 * Cancel your own confirmation on a proposal
 */
router.post('/proposals/:proposalId/cancel-confirmation', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { proposalId } = req.params;
    const userId = req.userId!;

    if (!proposalId) {
      return res.status(400).json({ error: 'Missing proposalId' });
    }

    await cancelConfirmation(proposalId, userId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error cancelling confirmation:', error);
    res.status(400).json({
      error: (error as any).message || 'Failed to cancel confirmation'
    });
  }
});

/**
 * POST /proposals/:proposalId/counter-propose
 * Reject proposal and make a counter-proposal with new slots
 */
router.post('/proposals/:proposalId/counter-propose', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { proposalId } = req.params;
    const { slotDatetimes, notes } = req.body;
    const userId = req.userId!;

    if (!proposalId) {
      return res.status(400).json({ error: 'Missing proposalId' });
    }

    if (!Array.isArray(slotDatetimes) || slotDatetimes.length === 0) {
      return res.status(400).json({ error: 'slotDatetimes must be a non-empty array' });
    }

    const result = await rejectAndCounterPropose(proposalId, userId, slotDatetimes, notes);
    res.json({
      success: true,
      counterProposalId: result.counterProposalId,
      slotsCreated: result.slotsCreated
    });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error creating counter-proposal:', error);
    res.status(400).json({
      error: (error as any).message || 'Failed to create counter-proposal'
    });
  }
});

/**
 * PUT /proposals/:proposalId
 * Modify proposal (only proposer can do this)
 */
router.put('/proposals/:proposalId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { proposalId } = req.params;
    const { slotDatetimes, notes } = req.body;
    const userId = req.userId!;

    if (!proposalId) {
      return res.status(400).json({ error: 'Missing proposalId' });
    }

    if (!Array.isArray(slotDatetimes) || slotDatetimes.length === 0) {
      return res.status(400).json({ error: 'slotDatetimes must be a non-empty array' });
    }

    const result = await modifyProposal(proposalId, userId, slotDatetimes, notes);
    res.json({
      success: true,
      slotsCreated: result.slotsCreated
    });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error modifying proposal:', error);
    res.status(400).json({
      error: (error as any).message || 'Failed to modify proposal'
    });
  }
});

/**
 * DELETE /proposals/:proposalId
 * Cancel a proposal (only proposer can do this)
 */
router.delete('/proposals/:proposalId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { proposalId } = req.params;
    const userId = req.userId!;

    if (!proposalId) {
      return res.status(400).json({ error: 'Missing proposalId' });
    }

    await cancelProposal(proposalId, userId);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error cancelling proposal:', error);
    res.status(400).json({
      error: (error as any).message || 'Failed to cancel proposal'
    });
  }
});

export default router;
