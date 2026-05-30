import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { authMiddleware, AuthRequest, optionalAuthMiddleware } from '../middleware/auth.js';
import { sendDiscordNotification, storeNotificationForUsers } from '../services/discordNotificationService.js';
import { groupSlotsIntoRanges, formatTimeRangesForDiscord, buildNotificationMessage } from '../utils/slotGrouping.js';
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

interface TeamNotificationContext {
  teamName: string;
  memberUserIds: string[];
  memberNames: string[];
  memberDiscordIds: string[];
}

const getTeamNotificationContext = async (tournamentId: string, teamId: string): Promise<TeamNotificationContext> => {
  const teamResult = await query(
    'SELECT name FROM tournament_teams WHERE id = ?',
    [teamId]
  );
  const teamName = teamResult.rows && teamResult.rows.length > 0
    ? teamResult.rows[0].name
    : 'Team';

  const membersResult = await query(
    `SELECT tp.user_id, ue.discord_id, COALESCE(ue.nickname, ue.username, tp.user_id) AS display_name
     FROM tournament_participants tp
     LEFT JOIN users_extension ue ON tp.user_id = ue.id
     WHERE tp.tournament_id = ? AND tp.team_id = ?`,
    [tournamentId, teamId]
  );

  const rows = membersResult.rows || [];
  return {
    teamName,
    memberUserIds: rows.map((row: any) => row.user_id),
    memberNames: rows.map((row: any) => row.display_name),
    memberDiscordIds: rows
      .map((row: any) => row.discord_id)
      .filter((id: string | null) => id !== null && id !== undefined),
  };
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
    let actorUserName = 'Player';
    let opponentEmail = null;
    let opponentSocketRecipients: string[] = [];
    let proposerTeamMembers: string[] = [];
    let opponentTeamMembers: string[] = [];

    const actorResult = await query(
      `SELECT COALESCE(nickname, username, id) AS display_name FROM users_extension WHERE id = ? LIMIT 1`,
      [userId]
    );
    if (actorResult.rows && actorResult.rows.length > 0) {
      actorUserName = actorResult.rows[0].display_name;
    }

    if (match.tournament_mode === 'team') {
      // Team tournament - get all members of opponent team
      const proposerTeamId = isPlayer1 ? match.player1_id : match.player2_id;
      const proposerTeamContext = await getTeamNotificationContext(match.tournament_id, proposerTeamId);
      const opponentTeamContext = await getTeamNotificationContext(match.tournament_id, opponentId);

      proposerName = proposerTeamContext.teamName;
      opponentName = opponentTeamContext.teamName;
      proposerTeamMembers = proposerTeamContext.memberNames;
      opponentTeamMembers = opponentTeamContext.memberNames;
      opponentSocketRecipients = opponentTeamContext.memberUserIds;

      if (opponentTeamContext.memberDiscordIds.length > 0) {
        opponentEmail = opponentTeamContext.memberDiscordIds;
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
        actionByUserName: actorUserName,
        fromTeamName: match.tournament_mode === 'team' ? proposerName : undefined,
        fromTeamMembers: match.tournament_mode === 'team' ? proposerTeamMembers : undefined,
        fromUserName: match.tournament_mode === '1v1' ? proposerName : actorUserName,
        toTeamName: match.tournament_mode === 'team' ? opponentName : undefined,
        toTeamMembers: match.tournament_mode === 'team' ? opponentTeamMembers : undefined,
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
    let proposerTeamMembers: string[] = [];
    let confirmerTeamMembers: string[] = [];
    let proposerTeamName: string | undefined;

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
      const proposerTeamContext = await getTeamNotificationContext(match.tournament_id, proposerTeamId!);
      const confirmerTeamContext = await getTeamNotificationContext(match.tournament_id, confirmerTeamId!);
      proposerTeamName = proposerTeamContext.teamName;
      opponentName = proposerTeamContext.teamName;
      proposerSocketRecipients = proposerTeamContext.memberUserIds;
      confirmerSocketRecipients = confirmerTeamContext.memberUserIds;
      proposerTeamMembers = proposerTeamContext.memberNames;
      confirmerTeamMembers = confirmerTeamContext.memberNames;
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
    let confirmerUserName = 'Player';
    let proposerDiscordIds: string[] = [];
    let confirmerDiscordIds: string[] = [];

    const confirmerUserResult = await query(
      `SELECT COALESCE(nickname, username, id) AS display_name FROM users_extension WHERE id = ? LIMIT 1`,
      [confirmerId]
    );
    if (confirmerUserResult.rows && confirmerUserResult.rows.length > 0) {
      confirmerUserName = confirmerUserResult.rows[0].display_name;
    }
    
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
        actionByUserName: confirmerUserName,
        fromUserName: match.tournament_mode === '1v1' ? confirmerName : confirmerUserName,
        fromTeamName: match.tournament_mode === 'team' ? confirmerName : undefined,
        fromTeamMembers: match.tournament_mode === 'team' ? confirmerTeamMembers : undefined,
        fromDiscordId: proposerDiscordIds.length > 0 ? proposerDiscordIds[0] : undefined,
        toUserName: match.tournament_mode === '1v1' ? opponentName : undefined,
        toTeamName: match.tournament_mode === 'team' ? proposerTeamName : undefined,
        toTeamMembers: match.tournament_mode === 'team' ? proposerTeamMembers : undefined,
        toDiscordIds: proposerDiscordIds.length > 0 ? proposerDiscordIds : undefined,
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

      // Create proposal with slots
      const { proposalId, slotsCreated } = await createRoundMatchProposal(
        roundMatchId,
        userId,
        slot_datetimes,
        notes
      );

      console.log(`✅ [SCHEDULING] Round match proposal created: ${proposalId} with ${slotsCreated} slots`);

      // Get opponent(s) for notification
      let opponentIds: string[] = [];
      let opponentName = 'Opponent';
      let proposerName = 'Player';
      let actorUserName = 'Player';
      let opponentDiscordIds: string[] = [];
      let proposerTeamMembers: string[] = [];
      let opponentTeamMembers: string[] = [];

      const actorResult = await query(
        `SELECT COALESCE(nickname, username, id) AS display_name FROM users_extension WHERE id = ? LIMIT 1`,
        [userId]
      );
      if (actorResult.rows && actorResult.rows.length > 0) {
        actorUserName = actorResult.rows[0].display_name;
      }

      if (match.tournament_mode === 'team') {
        // Team tournament - get all members of opponent team
        const proposerTeamId = userTeamId!;
        const opponentTeamId = proposerTeamId === match.player1_id ? match.player2_id : match.player1_id;
        const proposerTeamContext = await getTeamNotificationContext(tournamentId, proposerTeamId);
        const opponentTeamContext = await getTeamNotificationContext(tournamentId, opponentTeamId);

        proposerName = proposerTeamContext.teamName;
        opponentName = opponentTeamContext.teamName;
        proposerTeamMembers = proposerTeamContext.memberNames;
        opponentTeamMembers = opponentTeamContext.memberNames;
        opponentIds = opponentTeamContext.memberUserIds;
        opponentDiscordIds = opponentTeamContext.memberDiscordIds;
      } else {
        // 1v1 tournament
        const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;
        opponentIds = [opponentId];

        const opponentResult = await query(
          'SELECT username, discord_id FROM users_extension WHERE user_id = ?',
          [opponentId]
        );
        opponentName = opponentResult.rows && opponentResult.rows.length > 0 ? opponentResult.rows[0].username : 'Opponent';
        
        if (opponentResult.rows && opponentResult.rows.length > 0 && opponentResult.rows[0].discord_id) {
          opponentDiscordIds = [opponentResult.rows[0].discord_id];
        }

        const proposerResult = await query(
          'SELECT username FROM users_extension WHERE user_id = ?',
          [userId]
        );
        proposerName = proposerResult.rows && proposerResult.rows.length > 0 ? proposerResult.rows[0].username : 'Player';
      }

      // Get tournament name
      const tournamentResult = await query(
        'SELECT name FROM tournaments WHERE id = ?',
        [tournamentId]
      );
      const tournamentName = tournamentResult.rows && tournamentResult.rows.length > 0 ? tournamentResult.rows[0].name : 'Tournament';

      // Group slots into ranges for display
      const ranges = groupSlotsIntoRanges(slot_datetimes);
      const formattedRanges = formatTimeRangesForDiscord(ranges);
      const notificationMessage = buildNotificationMessage('proposal', proposerName, ranges, notes);

      // Send Discord notification
      await sendDiscordNotification(
        tournamentId,
        'schedule_proposal',
        {
          tournamentName,
          actionByUserName: actorUserName,
          fromTeamName: match.tournament_mode === 'team' ? proposerName : undefined,
          fromTeamMembers: match.tournament_mode === 'team' ? proposerTeamMembers : undefined,
          fromUserName: match.tournament_mode === '1v1' ? proposerName : actorUserName,
          toTeamName: match.tournament_mode === 'team' ? opponentName : undefined,
          toTeamMembers: match.tournament_mode === 'team' ? opponentTeamMembers : undefined,
          toUserName: match.tournament_mode === '1v1' ? opponentName : undefined,
          toDiscordIds: opponentDiscordIds.length > 0 ? opponentDiscordIds : undefined,
          proposedTimeRanges: formattedRanges,
          messageExtra: notes || undefined,
        }
      ).catch(err => console.error('⚠️ Discord notification failed:', err));

      // Store notification in database (fallback for offline users) - same format as Discord
      const notificationTitle = `🗓️ Schedule Proposal - ${tournamentName}`;
      
      await storeNotificationForUsers(
        opponentIds,
        tournamentId,
        roundMatchId,
        'schedule_proposal',
        notificationTitle,
        notificationMessage,
        null
      ).catch(err => console.error('⚠️ Error storing notifications:', err));

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

      // Create proposal
      const { proposalId, slotsCreated } = await createMatchProposal(
        matchId,
        userId,
        slot_datetimes,
        notes
      );

      console.log(`✅ [SCHEDULING] Match proposal created: ${proposalId} with ${slotsCreated} slots`);

      // Get opponent(s) for notification
      let opponentIds: string[] = [];
      let opponentName = 'Opponent';
      let proposerName = 'Player';
      let actorUserName = 'Player';
      let opponentDiscordIds: string[] = [];
      let proposerTeamMembers: string[] = [];
      let opponentTeamMembers: string[] = [];

      const actorResult = await query(
        `SELECT COALESCE(nickname, username, id) AS display_name FROM users_extension WHERE id = ? LIMIT 1`,
        [userId]
      );
      if (actorResult.rows && actorResult.rows.length > 0) {
        actorUserName = actorResult.rows[0].display_name;
      }

      if (match.tournament_mode === 'team') {
        // Team tournament - get all members of opponent team
        const proposerTeamId = userTeamId!;
        const opponentTeamId = proposerTeamId === match.player1_id ? match.player2_id : match.player1_id;
        const proposerTeamContext = await getTeamNotificationContext(tournamentId, proposerTeamId);
        const opponentTeamContext = await getTeamNotificationContext(tournamentId, opponentTeamId);

        proposerName = proposerTeamContext.teamName;
        opponentName = opponentTeamContext.teamName;
        proposerTeamMembers = proposerTeamContext.memberNames;
        opponentTeamMembers = opponentTeamContext.memberNames;
        opponentIds = opponentTeamContext.memberUserIds;
        opponentDiscordIds = opponentTeamContext.memberDiscordIds;
      } else {
        // 1v1 tournament
        const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;
        opponentIds = [opponentId];

        const opponentResult = await query(
          'SELECT username, discord_id FROM users_extension WHERE user_id = ?',
          [opponentId]
        );
        opponentName = opponentResult.rows && opponentResult.rows.length > 0 ? opponentResult.rows[0].username : 'Opponent';
        
        if (opponentResult.rows && opponentResult.rows.length > 0 && opponentResult.rows[0].discord_id) {
          opponentDiscordIds = [opponentResult.rows[0].discord_id];
        }

        const proposerResult = await query(
          'SELECT username FROM users_extension WHERE user_id = ?',
          [userId]
        );
        proposerName = proposerResult.rows && proposerResult.rows.length > 0 ? proposerResult.rows[0].username : 'Player';
      }

      // Get tournament name
      const tournamentResult = await query(
        'SELECT name FROM tournaments WHERE id = ?',
        [tournamentId]
      );
      const tournamentName = tournamentResult.rows && tournamentResult.rows.length > 0 ? tournamentResult.rows[0].name : 'Tournament';

      // Group slots into ranges for display
      const ranges = groupSlotsIntoRanges(slot_datetimes);
      const formattedRanges = formatTimeRangesForDiscord(ranges);
      const notificationMessage = buildNotificationMessage('proposal', proposerName, ranges, notes);

      // Send Discord notification
      await sendDiscordNotification(
        tournamentId,
        'schedule_proposal',
        {
          tournamentName,
          actionByUserName: actorUserName,
          fromTeamName: match.tournament_mode === 'team' ? proposerName : undefined,
          fromTeamMembers: match.tournament_mode === 'team' ? proposerTeamMembers : undefined,
          fromUserName: match.tournament_mode === '1v1' ? proposerName : actorUserName,
          toTeamName: match.tournament_mode === 'team' ? opponentName : undefined,
          toTeamMembers: match.tournament_mode === 'team' ? opponentTeamMembers : undefined,
          toUserName: match.tournament_mode === '1v1' ? opponentName : undefined,
          toDiscordIds: opponentDiscordIds.length > 0 ? opponentDiscordIds : undefined,
          proposedTimeRanges: formattedRanges,
          messageExtra: notes || undefined,
        }
      ).catch(err => console.error('⚠️ Discord notification failed:', err));

      // Store notification in database (fallback for offline users) - same format as Discord
      const notificationTitle = `🗓️ Schedule Proposal - ${tournamentName}`;
      
      await storeNotificationForUsers(
        opponentIds,
        tournamentId,
        matchId,
        'schedule_proposal',
        notificationTitle,
        notificationMessage,
        null
      ).catch(err => console.error('⚠️ Error storing notifications:', err));

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

     // Get all slots for this proposal to get detailed info
     const slotsResult = await query(
       `SELECT id, slot_datetime, status FROM match_schedule_slots 
        WHERE proposal_id = ? ORDER BY slot_datetime ASC`,
       [proposal_id]
     );

     // Get proposer info for notification
     const proposalResult = await query(
       `SELECT proposed_by_user_id, tournament_round_match_id FROM match_schedule_proposals WHERE id = ?`,
       [proposal_id]
     );

     if (proposalResult.rows && proposalResult.rows.length > 0) {
       const proposerId = proposalResult.rows[0].proposed_by_user_id;
       const roundMatchId = proposalResult.rows[0].tournament_round_match_id;

       // Get tournament ID from match
       const matchResult = await query(
         `SELECT trm.tournament_id, t.tournament_mode 
          FROM tournament_round_matches trm
          JOIN tournaments t ON trm.tournament_id = t.id
          WHERE trm.id = ?`,
         [roundMatchId]
       );

       if (matchResult.rows && matchResult.rows.length > 0) {
         const tournamentId = matchResult.rows[0].tournament_id;
         const tournamentMode = matchResult.rows[0].tournament_mode;

         // Get tournament name
         const tournamentResult = await query(
           `SELECT name FROM tournaments WHERE id = ?`,
           [tournamentId]
         );
         const tournamentName = tournamentResult.rows && tournamentResult.rows.length > 0 
           ? tournamentResult.rows[0].name 
           : 'Tournament';

         // Separate confirmed and rejected slots
         const confirmedSlots = slotsResult.rows?.filter((s: any) => s.status === 'confirmed').map((s: any) => s.slot_datetime) || [];
         const rejectedSlots = slotsResult.rows?.filter((s: any) => s.status === 'rejected').map((s: any) => s.slot_datetime) || [];
         const rejectedRanges = groupSlotsIntoRanges(rejectedSlots);
         const formattedRejectedRanges = rejectedRanges.length > 0 ? formatTimeRangesForDiscord(rejectedRanges) : undefined;

         // Get confirmer name
         let confirmerName = 'Player';
         let confirmerUserName = 'Player';
         let confirmerTeamMembers: string[] = [];
         if (tournamentMode === 'team') {
           const userTeamResult = await query(
             `SELECT team_id FROM tournament_participants WHERE tournament_id = ? AND user_id = ? LIMIT 1`,
             [tournamentId, userId]
           );
           if (userTeamResult.rows && userTeamResult.rows.length > 0) {
             const teamId = userTeamResult.rows[0].team_id;
             const teamContext = await getTeamNotificationContext(tournamentId, teamId);
             confirmerName = teamContext.teamName;
             confirmerTeamMembers = teamContext.memberNames;
           }

           const confirmerUserResult = await query(
             `SELECT COALESCE(nickname, username, id) AS display_name FROM users_extension WHERE id = ? LIMIT 1`,
             [userId]
           );
           if (confirmerUserResult.rows && confirmerUserResult.rows.length > 0) {
             confirmerUserName = confirmerUserResult.rows[0].display_name;
           }
         } else {
           const userResult = await query(
             `SELECT username, discord_id FROM users_extension WHERE user_id = ?`,
             [userId]
           );
           confirmerName = userResult.rows && userResult.rows.length > 0 ? userResult.rows[0].username : 'Player';
           confirmerUserName = confirmerName;
         }

         // Get proposer name and Discord IDs
         let proposerName = 'Player';
         let proposerDiscordIds: string[] = [];
         let proposerTeamMembers: string[] = [];
         if (tournamentMode === 'team') {
           const propTeamResult = await query(
             `SELECT team_id FROM tournament_participants WHERE tournament_id = ? AND user_id = ? LIMIT 1`,
             [tournamentId, proposerId]
           );
           if (propTeamResult.rows && propTeamResult.rows.length > 0) {
             const teamId = propTeamResult.rows[0].team_id;
             const teamContext = await getTeamNotificationContext(tournamentId, teamId);
             proposerName = teamContext.teamName;
             proposerTeamMembers = teamContext.memberNames;
             proposerDiscordIds = teamContext.memberDiscordIds;
           }
         } else {
           const userResult = await query(
             `SELECT username, discord_id FROM users_extension WHERE user_id = ?`,
             [proposerId]
           );
           proposerName = userResult.rows && userResult.rows.length > 0 ? userResult.rows[0].username : 'Player';
           if (userResult.rows && userResult.rows.length > 0 && userResult.rows[0].discord_id) {
             proposerDiscordIds = [userResult.rows[0].discord_id];
           }
         }

         // Send notifications based on action
         if (confirmedSlots.length > 0) {
           // Confirmed (fully or partially) - show only confirmed slots
           const ranges = groupSlotsIntoRanges(confirmedSlots);
           const notificationMessage = buildNotificationMessage('confirmed', confirmerName, ranges);
           const formattedRanges = formatTimeRangesForDiscord(ranges);

           await sendDiscordNotification(
             tournamentId,
             'schedule_confirmed',
             {
               tournamentName,
               actionByUserName: confirmerUserName,
               fromUserName: tournamentMode === '1v1' ? confirmerName : confirmerUserName,
               fromTeamName: tournamentMode === 'team' ? confirmerName : undefined,
               fromTeamMembers: tournamentMode === 'team' ? confirmerTeamMembers : undefined,
               toUserName: tournamentMode === '1v1' ? proposerName : undefined,
               toTeamName: tournamentMode === 'team' ? proposerName : undefined,
               toTeamMembers: tournamentMode === 'team' ? proposerTeamMembers : undefined,
               toDiscordIds: proposerDiscordIds.length > 0 ? proposerDiscordIds : undefined,
               proposedTimeRanges: formattedRanges,
             }
           ).catch(err => console.error('⚠️ Discord notification failed:', err));

           // Store both proposer and confirmer notifications
           const allRecipients = [proposerId, userId];
           const notificationTitle = `✅ Schedule Confirmed - ${tournamentName}`;
           await storeNotificationForUsers(
             allRecipients,
             tournamentId,
             roundMatchId,
             'schedule_confirmed',
             notificationTitle,
             notificationMessage,
             null
           ).catch(err => console.error('⚠️ Error storing notifications:', err));
         } else {
           // Full rejection - no confirmed slots
           const notificationMessage = buildNotificationMessage('rejected', confirmerName, []);

           await sendDiscordNotification(
             tournamentId,
             'schedule_rejected',
             {
               tournamentName,
               actionByUserName: confirmerUserName,
               fromUserName: tournamentMode === '1v1' ? confirmerName : confirmerUserName,
               fromTeamName: tournamentMode === 'team' ? confirmerName : undefined,
               fromTeamMembers: tournamentMode === 'team' ? confirmerTeamMembers : undefined,
               toUserName: tournamentMode === '1v1' ? proposerName : undefined,
               toTeamName: tournamentMode === 'team' ? proposerName : undefined,
               toTeamMembers: tournamentMode === 'team' ? proposerTeamMembers : undefined,
               toDiscordIds: proposerDiscordIds.length > 0 ? proposerDiscordIds : undefined,
               proposedTimeRanges: formattedRejectedRanges,
             }
           ).catch(err => console.error('⚠️ Discord notification failed:', err));

           // Store rejection notification
           const notificationTitle = `❌ Schedule Rejected - ${tournamentName}`;
           await storeNotificationForUsers(
             [proposerId],
             tournamentId,
             roundMatchId,
             'schedule_rejected',
             notificationTitle,
             notificationMessage,
             null
           ).catch(err => console.error('⚠️ Error storing notifications:', err));
         }
       }
     }

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

    // Get original proposal info before counter-proposing
    const originalProposalResult = await query(
      `SELECT proposed_by_user_id, tournament_round_match_id, tournament_match_id FROM match_schedule_proposals WHERE id = ?`,
      [proposalId]
    );

    let proposerOfOriginal: string | null = null;
    let roundMatchId: string | null = null;
    let matchId: string | null = null;

    if (originalProposalResult.rows && originalProposalResult.rows.length > 0) {
      proposerOfOriginal = originalProposalResult.rows[0].proposed_by_user_id;
      roundMatchId = originalProposalResult.rows[0].tournament_round_match_id;
      matchId = originalProposalResult.rows[0].tournament_match_id;
    }

    const result = await rejectAndCounterPropose(proposalId, userId, slotDatetimes, notes);

    // Send counter-proposal notifications
    if (proposerOfOriginal && roundMatchId) {
      // Get match info
      const matchResult = await query(
        `SELECT trm.tournament_id, t.tournament_mode 
         FROM tournament_round_matches trm
         JOIN tournaments t ON trm.tournament_id = t.id
         WHERE trm.id = ?`,
        [roundMatchId]
      );

      if (matchResult.rows && matchResult.rows.length > 0) {
        const tournamentId = matchResult.rows[0].tournament_id;
        const tournamentMode = matchResult.rows[0].tournament_mode;

        // Get tournament name
        const tournamentResult = await query(
          `SELECT name FROM tournaments WHERE id = ?`,
          [tournamentId]
        );
        const tournamentName = tournamentResult.rows && tournamentResult.rows.length > 0 
          ? tournamentResult.rows[0].name 
          : 'Tournament';

        // Get counter-proposer name
        let counterProposerName = 'Player';
        let counterProposerUserName = 'Player';
        let counterProposerMembers: string[] = [];
        if (tournamentMode === 'team') {
          const userTeamResult = await query(
            `SELECT team_id FROM tournament_participants WHERE tournament_id = ? AND user_id = ? LIMIT 1`,
            [tournamentId, userId]
          );
          if (userTeamResult.rows && userTeamResult.rows.length > 0) {
            const teamId = userTeamResult.rows[0].team_id;
            const teamContext = await getTeamNotificationContext(tournamentId, teamId);
            counterProposerName = teamContext.teamName;
            counterProposerMembers = teamContext.memberNames;
          }

          const actorResult = await query(
            `SELECT COALESCE(nickname, username, id) AS display_name FROM users_extension WHERE id = ? LIMIT 1`,
            [userId]
          );
          if (actorResult.rows && actorResult.rows.length > 0) {
            counterProposerUserName = actorResult.rows[0].display_name;
          }
        } else {
          const userResult = await query(
            `SELECT username, discord_id FROM users_extension WHERE user_id = ?`,
            [userId]
          );
          counterProposerName = userResult.rows && userResult.rows.length > 0 ? userResult.rows[0].username : 'Player';
          counterProposerUserName = counterProposerName;
        }

        // Get original proposer name
        let originalProposerName = 'Player';
        let originalProposerDiscordIds: string[] = [];
        let originalProposerMembers: string[] = [];
        if (tournamentMode === 'team') {
          const propTeamResult = await query(
            `SELECT team_id FROM tournament_participants WHERE tournament_id = ? AND user_id = ? LIMIT 1`,
            [tournamentId, proposerOfOriginal]
          );
          if (propTeamResult.rows && propTeamResult.rows.length > 0) {
            const teamId = propTeamResult.rows[0].team_id;
            const teamContext = await getTeamNotificationContext(tournamentId, teamId);
            originalProposerName = teamContext.teamName;
            originalProposerMembers = teamContext.memberNames;
            originalProposerDiscordIds = teamContext.memberDiscordIds;
          }
        } else {
          const userResult = await query(
            `SELECT username, discord_id FROM users_extension WHERE user_id = ?`,
            [proposerOfOriginal]
          );
          originalProposerName = userResult.rows && userResult.rows.length > 0 ? userResult.rows[0].username : 'Player';
          if (userResult.rows && userResult.rows.length > 0 && userResult.rows[0].discord_id) {
            originalProposerDiscordIds = [userResult.rows[0].discord_id];
          }
        }

        // Group slots into ranges and create notification message
        const ranges = groupSlotsIntoRanges(slotDatetimes);
        const notificationMessage = buildNotificationMessage('counter', counterProposerName, ranges, notes);
        const formattedRanges = formatTimeRangesForDiscord(ranges);

        // Send Discord notification
        await sendDiscordNotification(
          tournamentId,
          'schedule_proposal',
          {
            tournamentName,
            actionByUserName: counterProposerUserName,
            fromUserName: tournamentMode === '1v1' ? counterProposerName : counterProposerUserName,
            fromTeamName: tournamentMode === 'team' ? counterProposerName : undefined,
            fromTeamMembers: tournamentMode === 'team' ? counterProposerMembers : undefined,
            toUserName: tournamentMode === '1v1' ? originalProposerName : undefined,
            toTeamName: tournamentMode === 'team' ? originalProposerName : undefined,
            toTeamMembers: tournamentMode === 'team' ? originalProposerMembers : undefined,
            toDiscordIds: originalProposerDiscordIds.length > 0 ? originalProposerDiscordIds : undefined,
            proposedTimeRanges: formattedRanges,
            messageExtra: notes || undefined,
          }
        ).catch(err => console.error('⚠️ Discord notification failed:', err));

        // Store notification in database
        const notificationTitle = `🔄 Counter Proposal - ${tournamentName}`;
        await storeNotificationForUsers(
          [proposerOfOriginal],
          tournamentId,
          roundMatchId,
          'schedule_proposal',
          notificationTitle,
          notificationMessage,
          null
        ).catch(err => console.error('⚠️ Error storing notifications:', err));
      }
    }

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

    // Get proposal details for notification
    const proposalResult = await query(
      `SELECT p.tournament_round_match_id, p.tournament_match_id, t.id as tournament_id, t.name as tournament_name, t.tournament_mode
       FROM match_schedule_proposals p
       JOIN tournament_round_matches trm ON p.tournament_round_match_id = trm.id
       JOIN tournaments t ON trm.tournament_id = t.id
       WHERE p.id = ?`,
      [proposalId]
    );

    if (proposalResult.rows && proposalResult.rows.length > 0) {
      const { tournament_id: tournamentId, tournament_name: tournamentName, tournament_mode: tournamentMode, tournament_round_match_id: roundMatchId } = proposalResult.rows[0];

      // Get proposer info
      let proposerName = 'Player';
      let proposerUserName = 'Player';
      let proposerTeamMembers: string[] = [];
      const proposerResult = await query(
        `SELECT COALESCE(nickname, username, id) AS display_name, discord_id FROM users_extension WHERE id = ?`,
        [userId]
      );
      if (proposerResult.rows && proposerResult.rows.length > 0) {
        proposerUserName = proposerResult.rows[0].display_name;
        proposerName = proposerUserName;
      }

      // Get opponent info
      let opponentIds: string[] = [];
      let opponentDiscordIds: string[] = [];
      let opponentName = 'Opponent';
      let opponentTeamMembers: string[] = [];

      const matchResult = await query(
        `SELECT player1_id, player2_id FROM tournament_round_matches WHERE id = ?`,
        [roundMatchId]
      );

      if (matchResult.rows && matchResult.rows.length > 0) {
        const match = matchResult.rows[0];
        const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;

        if (tournamentMode === 'team') {
          const proposerTeamResult = await query(
            `SELECT team_id FROM tournament_participants WHERE tournament_id = ? AND user_id = ? LIMIT 1`,
            [tournamentId, userId]
          );
          const proposerTeamId = proposerTeamResult.rows && proposerTeamResult.rows.length > 0
            ? proposerTeamResult.rows[0].team_id
            : null;
          const opponentTeamId = proposerTeamId === match.player1_id ? match.player2_id : match.player1_id;

          if (proposerTeamId) {
            const proposerTeamContext = await getTeamNotificationContext(tournamentId, proposerTeamId);
            proposerName = proposerTeamContext.teamName;
            proposerTeamMembers = proposerTeamContext.memberNames;
          }

          const opponentTeamContext = await getTeamNotificationContext(tournamentId, opponentTeamId);
          opponentName = opponentTeamContext.teamName;
          opponentTeamMembers = opponentTeamContext.memberNames;
          opponentIds = opponentTeamContext.memberUserIds;
          opponentDiscordIds = opponentTeamContext.memberDiscordIds;
        } else {
          opponentIds = [opponentId];
          const opponentResult = await query(
            'SELECT nickname, discord_id FROM users_extension WHERE id = ?',
            [opponentId]
          );
          opponentName = opponentResult.rows && opponentResult.rows.length > 0 ? opponentResult.rows[0].nickname : 'Opponent';
          if (opponentResult.rows && opponentResult.rows.length > 0 && opponentResult.rows[0].discord_id) {
            opponentDiscordIds = [opponentResult.rows[0].discord_id];
          }
        }
      }

      // Build notification message
      const ranges = groupSlotsIntoRanges(slotDatetimes);
      const notificationMessage = buildNotificationMessage('changed', proposerName, ranges, notes);
      const formattedRanges = formatTimeRangesForDiscord(ranges);

      // Send Discord notification
      await sendDiscordNotification(
        tournamentId,
        'schedule_changed',
        {
          tournamentName,
          actionByUserName: proposerUserName,
          fromUserName: tournamentMode === '1v1' ? proposerName : proposerUserName,
          fromTeamName: tournamentMode === 'team' ? proposerName : undefined,
          fromTeamMembers: tournamentMode === 'team' ? proposerTeamMembers : undefined,
          toUserName: tournamentMode === '1v1' ? opponentName : undefined,
          toTeamName: tournamentMode === 'team' ? opponentName : undefined,
          toTeamMembers: tournamentMode === 'team' ? opponentTeamMembers : undefined,
          toDiscordIds: opponentDiscordIds.length > 0 ? opponentDiscordIds : undefined,
          proposedTimeRanges: formattedRanges,
          messageExtra: notes || undefined,
        }
      ).catch(err => console.error('⚠️ Discord notification failed:', err));

      // Store notification in database
      const notificationTitle = `✏️ Proposal Changed - ${tournamentName}`;
      await storeNotificationForUsers(
        opponentIds,
        tournamentId,
        roundMatchId,
        'schedule_changed',
        notificationTitle,
        notificationMessage,
        null
      ).catch(err => console.error('⚠️ Error storing notifications:', err));
    }

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

    // Get proposal details before canceling (handles both round matches and direct matches)
    const proposalResult = await query(
      `SELECT p.id, p.tournament_round_match_id, p.tournament_match_id, p.proposed_by_user_id
       FROM match_schedule_proposals p
       WHERE p.id = ?`,
      [proposalId]
    );

    if (!proposalResult.rows || proposalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const proposal = proposalResult.rows[0];
    if (proposal.proposed_by_user_id !== userId) {
      return res.status(403).json({ error: 'Only proposer can cancel proposal' });
    }

    // Get current proposal slots before deleting proposal/slots
    const proposalSlotsResult = await query(
      `SELECT slot_datetime
       FROM match_schedule_slots
       WHERE proposal_id = ?
       ORDER BY slot_datetime ASC`,
      [proposal.id]
    );
    const cancelledSlotDatetimes = (proposalSlotsResult.rows || []).map((row: any) => row.slot_datetime);
    const cancelledRanges = groupSlotsIntoRanges(cancelledSlotDatetimes);
    const formattedCancelledRanges = cancelledRanges.length > 0
      ? formatTimeRangesForDiscord(cancelledRanges)
      : undefined;

    // Cancel the proposal
    await cancelProposal(proposalId, userId);

    // Send notifications - get tournament info based on whether it's a round match or direct match
    let tournamentId: string | null = null;
    let tournamentName: string = 'Tournament';
    let tournamentMode: string = '1v1';
    let roundMatchId: string | null = null;
    let matchId: string | null = null;
    let player1Id: string | null = null;
    let player2Id: string | null = null;

    if (proposal.tournament_round_match_id) {
      // Round match proposal
      const roundMatchResult = await query(
        `SELECT trm.id, trm.player1_id, trm.player2_id, t.id as tournament_id, t.name, t.tournament_mode
         FROM tournament_round_matches trm
         JOIN tournaments t ON trm.tournament_id = t.id
         WHERE trm.id = ?`,
        [proposal.tournament_round_match_id]
      );
      
      if (roundMatchResult.rows && roundMatchResult.rows.length > 0) {
        const row = roundMatchResult.rows[0];
        roundMatchId = row.id;
        player1Id = row.player1_id;
        player2Id = row.player2_id;
        tournamentId = row.tournament_id;
        tournamentName = row.name;
        tournamentMode = row.tournament_mode;
      }
    } else if (proposal.tournament_match_id) {
      // Direct match proposal
      const matchResult = await query(
        `SELECT tm.id, tm.player1_id, tm.player2_id, t.id as tournament_id, t.name, t.tournament_mode
         FROM tournament_matches tm
         JOIN tournaments t ON tm.tournament_id = t.id
         WHERE tm.id = ?`,
        [proposal.tournament_match_id]
      );
      
      if (matchResult.rows && matchResult.rows.length > 0) {
        const row = matchResult.rows[0];
        matchId = row.id;
        player1Id = row.player1_id;
        player2Id = row.player2_id;
        tournamentId = row.tournament_id;
        tournamentName = row.name;
        tournamentMode = row.tournament_mode;
      }
    }

    // Send notifications if we have tournament info
    if (tournamentId && (roundMatchId || matchId)) {
      // Get proposer info
      let proposerName = 'Player';
      const proposerResult = await query(
        `SELECT nickname FROM users_extension WHERE id = ?`,
        [userId]
      );
      if (proposerResult.rows && proposerResult.rows.length > 0) {
        proposerName = proposerResult.rows[0].nickname;
      }

      // Get opponent info
      let opponentIds: string[] = [];
      let opponentDiscordIds: string[] = [];
      let opponentName = 'Opponent';
      let cancellingTeamName: string | undefined;
      let cancellingTeamMembers: string[] = [];
      let opponentTeamMembers: string[] = [];

      if (player1Id && player2Id) {
        const opponentId = userId === player1Id ? player2Id : player1Id;

        if (tournamentMode === 'team') {
          const cancellerTeamResult = await query(
            `SELECT team_id
             FROM tournament_participants
             WHERE tournament_id = ? AND user_id = ?
             LIMIT 1`,
            [tournamentId, userId]
          );

          const cancellerTeamId = cancellerTeamResult.rows && cancellerTeamResult.rows.length > 0
            ? cancellerTeamResult.rows[0].team_id
            : null;

          const opponentTeamId = cancellerTeamId === player1Id ? player2Id : player1Id;

          const cancellingTeamResult = await query(
            'SELECT name FROM tournament_teams WHERE id = ?',
            [cancellerTeamId]
          );
          cancellingTeamName = cancellingTeamResult.rows && cancellingTeamResult.rows.length > 0
            ? cancellingTeamResult.rows[0].name
            : 'Cancelling Team';

          const opponentTeamResult = await query(
            'SELECT name FROM tournament_teams WHERE id = ?',
            [opponentTeamId]
          );
          opponentName = opponentTeamResult.rows && opponentTeamResult.rows.length > 0
            ? opponentTeamResult.rows[0].name
            : 'Opponent Team';

          const cancellingTeamMembersResult = await query(
            `SELECT tp.user_id, ue.nickname
             FROM tournament_participants tp
             LEFT JOIN users_extension ue ON tp.user_id = ue.id
             WHERE tp.tournament_id = ? AND tp.team_id = ?`,
            [tournamentId, cancellerTeamId]
          );

          if (cancellingTeamMembersResult.rows) {
            cancellingTeamMembers = cancellingTeamMembersResult.rows.map(
              (row: any) => row.nickname || row.user_id
            );
          }

          const opponentTeamMembersResult = await query(
            `SELECT tp.user_id, ue.nickname, ue.discord_id
             FROM tournament_participants tp
             LEFT JOIN users_extension ue ON tp.user_id = ue.id
             WHERE tp.tournament_id = ? AND tp.team_id = ?`,
            [tournamentId, opponentTeamId]
          );

          if (opponentTeamMembersResult.rows) {
            opponentIds = opponentTeamMembersResult.rows.map((row: any) => row.user_id);
            opponentTeamMembers = opponentTeamMembersResult.rows.map(
              (row: any) => row.nickname || row.user_id
            );
            opponentDiscordIds = opponentTeamMembersResult.rows
              .map((row: any) => row.discord_id)
              .filter((id: string | null) => id !== null && id !== undefined);
          }
        } else {
          opponentIds = [opponentId];
          const opponentResult = await query(
            'SELECT nickname, discord_id FROM users_extension WHERE id = ?',
            [opponentId]
          );
          opponentName = opponentResult.rows && opponentResult.rows.length > 0 ? opponentResult.rows[0].nickname : 'Opponent';
          if (opponentResult.rows && opponentResult.rows.length > 0 && opponentResult.rows[0].discord_id) {
            opponentDiscordIds = [opponentResult.rows[0].discord_id];
          }
        }
      }

      // Build notification message
      const notificationMessage = buildNotificationMessage('cancelled', proposerName, cancelledRanges);

      // Send Discord notification
      await sendDiscordNotification(
        tournamentId,
        'schedule_cancelled',
        {
          tournamentName,
          actionByUserName: proposerName,
          fromUserName: tournamentMode === '1v1' ? proposerName : undefined,
          fromTeamName: tournamentMode === 'team' ? cancellingTeamName : undefined,
          cancelledByUserName: proposerName,
          fromTeamMembers: tournamentMode === 'team' ? cancellingTeamMembers : undefined,
          toUserName: tournamentMode === '1v1' ? opponentName : undefined,
          toTeamName: tournamentMode === 'team' ? opponentName : undefined,
          toTeamMembers: tournamentMode === 'team' ? opponentTeamMembers : undefined,
          toDiscordIds: opponentDiscordIds.length > 0 ? opponentDiscordIds : undefined,
          proposedTimeRanges: formattedCancelledRanges,
        }
      ).catch(err => console.error('⚠️ Discord notification failed:', err));

      // Store notification in database (use roundMatchId if available, otherwise matchId)
      const targetMatchId = roundMatchId || matchId || '';
      const notificationTitle = `🚫 Proposal Cancelled - ${tournamentName}`;
      await storeNotificationForUsers(
        opponentIds,
        tournamentId,
        targetMatchId,
        'schedule_cancelled',
        notificationTitle,
        notificationMessage,
        null
      ).catch(err => console.error('⚠️ Error storing notifications:', err));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error cancelling proposal:', error);
    res.status(400).json({
      error: (error as any).message || 'Failed to cancel proposal'
    });
  }
});

export default router;
