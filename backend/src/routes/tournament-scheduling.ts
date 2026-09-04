import { Router, Response } from 'express';
import { query } from '../config/database.js';
import { authMiddleware, AuthRequest, optionalAuthMiddleware } from '../middleware/auth.js';
import { sendDiscordNotification, storeNotificationForUsers } from '../services/discordNotificationService.js';
import { groupSlotsIntoRanges, formatTimeRangesForDiscord, formatTimeRangesForDiscordByTimezone, buildNotificationMessage } from '../utils/slotGrouping.js';
import {
  createSeriesProposal,
  getSeriesProposal,
  getParticipantsAvailability,
  confirmProposal,
  confirmPartialSlots,
  cancelConfirmation,
  rejectAndCounterPropose,
  modifyProposal,
  cancelProposal,
  rejectProposal
} from '../services/tournamentSchedulingService.js';
import { sendUserActionRateLimitError } from '../utils/userActionRateLimitResponse.js';

const router = Router();

console.log('🔧 Registering tournament scheduling routes');

interface TeamNotificationContext {
  teamName: string;
  memberUserIds: string[];
  memberNames: string[];
  memberDiscordIds: string[];
}

/**
 * Load the display names, application IDs, and Discord IDs for a tournament team.
 * @param tournamentId Tournament containing the team.
 * @param teamId Team whose members are being notified.
 * @returns Team display data used by in-app notifications and Discord embeds.
 */
const getTeamNotificationContext = async (tournamentId: string, teamId: string): Promise<TeamNotificationContext> => {
  const teamResult = await query(
    'SELECT name FROM tournament_teams WHERE id = ?',
    [teamId]
  );
  const teamName = teamResult.rows && teamResult.rows.length > 0
    ? teamResult.rows[0].name
    : 'Team';

  const membersResult = await query(
    `SELECT tp.user_id, ue.discord_id, COALESCE(ue.nickname, tp.user_id) AS display_name
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
 * Notify the other participants when a phase-engine series receives a proposal.
 * Series schedules intentionally have no legacy match id, so the in-app record
 * is linked to the tournament and remains visible in the notification centre.
 */
const notifySeriesProposal = async (
  tournamentId: string,
  seriesId: string,
  proposerUserId: string,
  slotDatetimes: string[],
  notes?: string
): Promise<void> => {
  const contextResult = await query(
    `SELECT tournaments.tournament_mode, tournaments.name AS tournament_name,
            entries.entry_type, entries.participant_id, entries.team_id,
            tp.user_id, tp.team_id AS participant_team_id,
            COALESCE(ue.nickname, ue.id) AS display_name, ue.discord_id, ue.timezone
     FROM tournament_series_slots slots
     JOIN tournament_entries entries ON entries.id = slots.resolved_entry_id
     JOIN tournament_phase_rounds rounds ON rounds.id = (SELECT round_id FROM tournament_series WHERE id = ?)
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     JOIN tournaments ON tournaments.id = phases.tournament_id
     JOIN tournament_participants tp
       ON tp.id = entries.participant_id OR tp.team_id = entries.team_id
     LEFT JOIN users_extension ue ON ue.id = tp.user_id
     WHERE slots.series_id = ? AND slots.resolved_entry_id IS NOT NULL
       AND phases.tournament_id = ? AND tp.participation_status = 'accepted'`,
    [seriesId, seriesId, tournamentId]
  );
  const rows = contextResult.rows || [];
  const recipientRows = rows.filter((row: any) => row.user_id !== proposerUserId);
  const recipientIds = [...new Set(recipientRows.map((row: any) => row.user_id))];
  if (recipientIds.length === 0) return;

  const proposerRow = rows.find((row: any) => row.user_id === proposerUserId);
  const tournamentMode = proposerRow?.tournament_mode || '1v1';
  let proposerName = proposerRow?.display_name || 'Player';
  let opponentName = recipientRows[0]?.display_name || 'Opponent';
  let proposerTeamName: string | undefined;
  let opponentTeamName: string | undefined;
  let proposerTeamMembers: string[] | undefined;
  let opponentTeamMembers: string[] | undefined;
  let discordIds = recipientRows
    .map((row: any) => row.discord_id)
    .filter((id: string | null) => Boolean(id));

  if (tournamentMode === 'team') {
    const proposerTeamId = proposerRow?.participant_team_id || proposerRow?.team_id;
    const opponentTeamRow = recipientRows.find(
      (row: any) => (row.participant_team_id || row.team_id) !== proposerTeamId
    );
    const opponentTeamId = opponentTeamRow?.participant_team_id || opponentTeamRow?.team_id;
    if (proposerTeamId && opponentTeamId) {
      const proposerTeam = await getTeamNotificationContext(tournamentId, proposerTeamId);
      const opponentTeam = await getTeamNotificationContext(tournamentId, opponentTeamId);
      proposerName = proposerTeam.teamName;
      opponentName = opponentTeam.teamName;
      proposerTeamName = proposerTeam.teamName;
      opponentTeamName = opponentTeam.teamName;
      proposerTeamMembers = proposerTeam.memberNames;
      opponentTeamMembers = opponentTeam.memberNames;
      discordIds = opponentTeam.memberDiscordIds;
      recipientIds.splice(0, recipientIds.length, ...opponentTeam.memberUserIds);
    }
  }

  const ranges = groupSlotsIntoRanges(slotDatetimes);
  const formattedRanges = formatTimeRangesForDiscordByTimezone(ranges, [
    ...new Map(
      rows.map((row: any) => [row.user_id, {
        label: row.display_name || 'Player',
        timezone: row.timezone || 'UTC',
      }])
    ).values(),
  ]);
  const notificationMessage = buildNotificationMessage('proposal', proposerName, ranges, notes);
  const actorUserName = proposerRow?.display_name || proposerName;

  await sendDiscordNotification(tournamentId, 'schedule_proposal', {
    actionByUserName: actorUserName,
    fromTeamName: proposerTeamName,
    fromTeamMembers: proposerTeamMembers,
    fromUserName: tournamentMode === '1v1' ? proposerName : actorUserName,
    toTeamName: opponentTeamName,
    toTeamMembers: opponentTeamMembers,
    toUserName: tournamentMode === '1v1' ? opponentName : undefined,
    discordIds,
    proposedTimeRanges: formattedRanges,
    messageExtra: notes || undefined,
    seriesId,
  }).catch(error => console.error('⚠️ Discord series notification failed:', error));

  await storeNotificationForUsers(
    recipientIds,
    tournamentId,
    'schedule_proposal',
    `🗓️ Schedule Proposal - ${proposerRow?.tournament_name || 'Tournament'}`,
    notificationMessage,
    notes || null,
    seriesId
  ).catch(error => console.error(`⚠️ [SCHEDULING][NOTIFICATIONS] Failed action=schedule_proposal tournamentId=${tournamentId} seriesId=${seriesId}:`, error));
};

type SeriesNotificationAction = 'schedule_proposal' | 'schedule_confirmed' | 'schedule_rejected' | 'schedule_changed' | 'schedule_cancelled';

/** Notify every other participant when a phase-engine series changes state. */
const notifySeriesParticipants = async (
  seriesId: string,
  proposalId: string,
  actorUserId: string,
  action: SeriesNotificationAction,
  notes?: string
): Promise<void> => {
  const context = await query(
    `SELECT phases.tournament_id, tournaments.name AS tournament_name,
            tp.user_id, COALESCE(ue.nickname, ue.id) AS display_name, ue.discord_id, ue.timezone
     FROM tournament_series_slots slots
     JOIN tournament_series series ON series.id = slots.series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     JOIN tournaments ON tournaments.id = phases.tournament_id
     JOIN tournament_entries entries ON entries.id = slots.resolved_entry_id
     JOIN tournament_participants tp
       ON tp.id = entries.participant_id OR tp.team_id = entries.team_id
     LEFT JOIN users_extension ue ON ue.id = tp.user_id
     WHERE slots.series_id = ? AND tp.participation_status = 'accepted'`,
    [seriesId]
  );
  const rows = context.rows || [];
  const recipients = rows.filter((row: any) => row.user_id !== actorUserId);
  const recipientIds = [...new Set(recipients.map((row: any) => row.user_id))];
  if (!recipientIds.length) return;

  const actor = rows.find((row: any) => row.user_id === actorUserId);
  const tournamentId = actor?.tournament_id || rows[0]?.tournament_id;
  if (!tournamentId) return;
  const slots = await query(
    `SELECT slot_datetime FROM match_schedule_slots
     WHERE proposal_id = ? ORDER BY slot_datetime`,
    [proposalId]
  );
  const ranges = groupSlotsIntoRanges((slots.rows || []).map((slot: any) => slot.slot_datetime));
  const formattedRanges = formatTimeRangesForDiscordByTimezone(ranges, [
    ...new Map(
      rows.map((row: any) => [row.user_id, {
        label: row.display_name || 'Player',
        timezone: row.timezone || 'UTC',
      }])
    ).values(),
  ]);
  const actorName = actor?.display_name || 'Player';
  const recipientName = recipients[0]?.display_name || 'Opponent';
  const discordIds = recipients.map((row: any) => row.discord_id).filter(Boolean);
  const messageByAction: Record<SeriesNotificationAction, string> = {
    schedule_proposal: `${actorName} proposed a schedule for your tournament series.`,
    schedule_confirmed: `${actorName} confirmed the schedule for your tournament series.`,
    schedule_rejected: `${actorName} rejected the schedule for your tournament series.`,
    schedule_changed: `${actorName} changed the schedule for your tournament series.`,
    schedule_cancelled: `${actorName} cancelled the schedule proposal for your tournament series.`,
  };
  const titleByAction: Record<SeriesNotificationAction, string> = {
    schedule_proposal: '🗓️ Schedule Proposal',
    schedule_confirmed: '✅ Schedule Confirmed',
    schedule_rejected: '❌ Schedule Rejected',
    schedule_changed: '🔄 Schedule Changed',
    schedule_cancelled: '🚫 Schedule Cancelled',
  };

  await sendDiscordNotification(tournamentId, action, {
    actionByUserName: actorName,
    fromUserName: actorName,
    toUserName: recipientName,
    discordIds,
    proposedTimeRanges: formattedRanges,
    messageExtra: notes || undefined,
    proposalId,
    seriesId,
  }).catch(error => console.error(`⚠️ [SCHEDULING][DISCORD] Failed action=${action} tournamentId=${tournamentId} seriesId=${seriesId} proposalId=${proposalId}:`, error));

  await storeNotificationForUsers(
    recipientIds,
    tournamentId,
    action,
    `${titleByAction[action]} - ${actor?.tournament_name || 'Tournament'}`,
    `${messageByAction[action]}${notes ? ` ${notes}` : ''}`,
    notes || null,
    seriesId
  ).catch(error => console.error(`⚠️ [SCHEDULING][NOTIFICATIONS] Failed action=${action} tournamentId=${tournamentId} seriesId=${seriesId} proposalId=${proposalId}:`, error));
};

/** Notify the original proposer when the other participant rejects a series proposal. */
const notifySeriesRejection = async (
  proposalId: string,
  rejectingUserId: string,
  notes?: string
): Promise<void> => {
  const result = await query(
    `SELECT proposals.proposed_by_user_id, series.id AS series_id,
            phases.tournament_id, tournaments.name AS tournament_name,
            tournaments.tournament_mode
     FROM match_schedule_proposals proposals
     JOIN tournament_series series ON series.id = proposals.tournament_series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     JOIN tournaments ON tournaments.id = phases.tournament_id
     WHERE proposals.id = ?`,
    [proposalId]
  );
  if (!result.rows?.length) return;

  const proposal = result.rows[0];
  const usersResult = await query(
    `SELECT tp.user_id, tp.team_id,
            COALESCE(ue.nickname, ue.id) AS display_name, ue.discord_id, ue.timezone
     FROM tournament_series_slots slots
     JOIN tournament_entries entries ON entries.id = slots.resolved_entry_id
     JOIN tournament_participants tp
       ON tp.id = entries.participant_id OR tp.team_id = entries.team_id
     LEFT JOIN users_extension ue ON ue.id = tp.user_id
     WHERE slots.series_id = ? AND tp.participation_status = 'accepted'`,
    [proposal.series_id]
  );
  const users = usersResult.rows || [];
  const rejectingUser = users.find((user: any) => user.user_id === rejectingUserId);
  const proposerUsers = users.filter((user: any) => user.user_id === proposal.proposed_by_user_id);
  if (!proposerUsers.length) return;

  const slotsResult = await query(
    `SELECT slot_datetime FROM match_schedule_slots WHERE proposal_id = ? ORDER BY slot_datetime`,
    [proposalId]
  );
  const ranges = groupSlotsIntoRanges((slotsResult.rows || []).map((slot: any) => slot.slot_datetime));
  const formattedRanges = formatTimeRangesForDiscordByTimezone(ranges, [
    ...new Map(
      users.map((user: any) => [user.user_id, {
        label: user.display_name || 'Player',
        timezone: user.timezone || 'UTC',
      }])
    ).values(),
  ]);
  const rejectingName = rejectingUser?.display_name || 'Player';
  const proposerName = proposerUsers[0].display_name || 'Player';
  const proposerDiscordIds = proposerUsers
    .map((user: any) => user.discord_id)
    .filter((id: string | null) => Boolean(id));

  await sendDiscordNotification(proposal.tournament_id, 'schedule_rejected', {
    actionByUserName: rejectingName,
    fromUserName: rejectingName,
    toUserName: proposerName,
    discordIds: proposerDiscordIds,
    proposedTimeRanges: formattedRanges,
    messageExtra: notes || undefined,
    proposalId,
    seriesId: proposal.series_id,
  }).catch(error => console.error(`⚠️ [SCHEDULING][DISCORD] Failed action=schedule_rejected tournamentId=${proposal.tournament_id} seriesId=${proposal.series_id} proposalId=${proposalId}:`, error));

  await storeNotificationForUsers(
    [proposal.proposed_by_user_id],
    proposal.tournament_id,
    'schedule_rejected',
    `🗓️ Schedule Rejected - ${proposal.tournament_name}`,
    `${rejectingName} rejected your schedule proposal.${notes ? ` ${notes}` : ''}`,
    notes || null,
    proposal.series_id
  ).catch(error => console.error(`⚠️ [SCHEDULING][NOTIFICATIONS] Failed action=schedule_rejected tournamentId=${proposal.tournament_id} seriesId=${proposal.series_id} proposalId=${proposalId}:`, error));
};

/**
 * GET /pending-confirmations
 * Get all schedules pending confirmation for the current user
 * Returns matches where a schedule was proposed and is waiting for user's confirmation
 * MUST be before /:tournamentRoundMatchId routes to avoid route param collision
 */
// ============================================================
// NEW PHASE 3 ENDPOINTS - Multi-slot scheduling with confirmations
// ============================================================

/** Create a schedule proposal for a phase-engine series. */
router.post('/tournament/:tournamentId/series/:seriesId/propose-slots', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentId, seriesId } = req.params;
    const { slot_datetimes, notes } = req.body;
    if (!req.userId || !Array.isArray(slot_datetimes) || !seriesId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const ownership = await query(
      `SELECT series.id
       FROM tournament_series series
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       WHERE series.id = ? AND phases.tournament_id = ?`,
      [seriesId, tournamentId]
    );
    if (!ownership.rows?.length) return res.status(404).json({ error: 'Series not found' });
    const result = await createSeriesProposal(seriesId, req.userId, slot_datetimes, notes);
    try {
      await notifySeriesParticipants(seriesId, result.proposalId, req.userId, 'schedule_proposal', notes);
    } catch (notificationError) {
      // A notification outage must not make a successfully persisted proposal look failed.
      console.error('⚠️ Series proposal created, but notifications could not be prepared:', notificationError);
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    const message = (error as Error).message || 'Failed to propose schedule';
    if (sendUserActionRateLimitError(req, res, error)) return;
    return res.status(message.includes('already reserved') ? 409 : 400).json({ error: message });
  }
});

/** Get the public proposal for a phase-engine series. */
router.get('/tournament/:tournamentId/series/:seriesId/proposal', async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentId, seriesId } = req.params;
    const ownership = await query(
      `SELECT series.id
       FROM tournament_series series
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       WHERE series.id = ? AND phases.tournament_id = ?`,
      [seriesId, tournamentId]
    );
    if (!ownership.rows?.length) return res.status(404).json({ error: 'Series not found' });
    return res.json({ proposal: await getSeriesProposal(seriesId) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch series proposal' });
  }
});

/** Get participant availability for a phase-engine series. */
router.get('/tournament/:tournamentId/series/:seriesId/participants-availability', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentId, seriesId } = req.params;
    const ownership = await query(
      `SELECT series.id
       FROM tournament_series series
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       WHERE series.id = ? AND phases.tournament_id = ?`,
      [seriesId, tournamentId]
    );
    if (!ownership.rows?.length) return res.status(404).json({ error: 'Series not found' });
    return res.json(await getParticipantsAvailability(undefined, undefined, req.userId, seriesId));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch series availability' });
  }
});

/** Confirm selected slots for a phase-engine series proposal. */
router.post('/tournament/:tournamentId/series/:seriesId/confirm-slots', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { tournamentId, seriesId } = req.params;
    const { proposal_id, confirmed_slot_ids = [] } = req.body;
    if (!req.userId || !proposal_id || !Array.isArray(confirmed_slot_ids)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const participant = await query(
      `SELECT 1
       FROM tournament_series_slots slots
       JOIN tournament_entries entries ON entries.id = slots.resolved_entry_id
       JOIN tournament_participants tp
         ON tp.id = entries.participant_id OR tp.team_id = entries.team_id
       JOIN tournament_phase_rounds rounds ON rounds.id = (SELECT round_id FROM tournament_series WHERE id = ?)
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       WHERE slots.series_id = ? AND phases.tournament_id = ?
         AND tp.user_id = ? AND tp.participation_status = 'accepted'
       LIMIT 1`,
      [seriesId, seriesId, tournamentId, req.userId]
    );
    if (!participant.rows?.length) return res.status(403).json({ error: 'You are not a participant in this series' });
    const proposal = await query(
      `SELECT id FROM match_schedule_proposals
       WHERE id = ? AND tournament_series_id = ? AND challenge_mode = 'tournament'`,
      [proposal_id, seriesId]
    );
    if (!proposal.rows?.length) return res.status(404).json({ error: 'Proposal not found' });
    const result = await confirmPartialSlots(proposal_id, req.userId, confirmed_slot_ids);
    await notifySeriesParticipants(seriesId, proposal_id, req.userId, 'schedule_confirmed');
    return res.json({ success: true, fullyConfirmed: result.fullyConfirmed, confirmedSlots: result.confirmedSlots });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message || 'Failed to confirm slots' });
  }
});

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
 * POST /proposals/:proposalId/reject
 * Reject an active proposal without creating a counter-proposal.
 */
router.post('/proposals/:proposalId/reject', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { proposalId } = req.params;
    const { notes } = req.body;
    const userId = req.userId!;
    if (!proposalId) return res.status(400).json({ error: 'Missing proposalId' });

    const result = await rejectProposal(proposalId, userId, notes);
    const seriesInfo = await query(
      `SELECT tournament_series_id FROM match_schedule_proposals WHERE id = ?`,
      [proposalId]
    );
    if (seriesInfo.rows?.[0]?.tournament_series_id) {
      await notifySeriesParticipants(
        seriesInfo.rows[0].tournament_series_id,
        proposalId,
        userId,
        'schedule_rejected',
        notes
      );
    } else {
      await notifySeriesRejection(proposalId, userId, notes);
    }
    return res.json(result);
  } catch (error) {
    console.error('❌ [SCHEDULING] Error rejecting proposal:', error);
    return res.status(400).json({
      error: (error as any).message || 'Failed to reject proposal'
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
    if (!proposalId) return res.status(400).json({ error: 'Missing proposalId' });
    if (!Array.isArray(slotDatetimes) || slotDatetimes.length === 0) {
      return res.status(400).json({ error: 'slotDatetimes must be a non-empty array' });
    }

    const proposalInfo = await query(
      'SELECT tournament_series_id FROM match_schedule_proposals WHERE id = ?',
      [proposalId]
    );
    const seriesId = proposalInfo.rows?.[0]?.tournament_series_id;
    const result = await rejectAndCounterPropose(proposalId, userId, slotDatetimes, notes);
    if (seriesId) {
      await notifySeriesParticipants(seriesId, result.counterProposalId, userId, 'schedule_proposal', notes);
    }
    return res.json({ success: true, counterProposalId: result.counterProposalId, slotsCreated: result.slotsCreated });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error creating counter-proposal:', error);
    if (sendUserActionRateLimitError(req, res, error)) return;
    return res.status(400).json({ error: (error as any).message || 'Failed to create counter-proposal' });
  }
});
router.put('/proposals/:proposalId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { proposalId } = req.params;
    const { slotDatetimes, notes } = req.body;
    const userId = req.userId!;
    if (!proposalId) return res.status(400).json({ error: 'Missing proposalId' });
    if (!Array.isArray(slotDatetimes) || slotDatetimes.length === 0) {
      return res.status(400).json({ error: 'slotDatetimes must be a non-empty array' });
    }

    const result = await modifyProposal(proposalId, userId, slotDatetimes, notes);
    const seriesInfo = await query(
      'SELECT tournament_series_id FROM match_schedule_proposals WHERE id = ?',
      [proposalId]
    );
    if (seriesInfo.rows?.[0]?.tournament_series_id) {
      await notifySeriesParticipants(
        seriesInfo.rows[0].tournament_series_id,
        proposalId,
        userId,
        'schedule_changed',
        notes
      );
    }
    return res.json({ success: true, slotsCreated: result.slotsCreated });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error modifying proposal:', error);
    if (sendUserActionRateLimitError(req, res, error)) return;
    return res.status(400).json({ error: (error as any).message || 'Failed to modify proposal' });
  }
});
router.delete('/proposals/:proposalId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { proposalId } = req.params;
    const userId = req.userId!;
    if (!proposalId) return res.status(400).json({ error: 'Missing proposalId' });

    const proposalResult = await query(
      'SELECT id, tournament_series_id, proposed_by_user_id FROM match_schedule_proposals WHERE id = ?',
      [proposalId]
    );
    if (!proposalResult.rows?.length) return res.status(404).json({ error: 'Proposal not found' });
    const proposal = proposalResult.rows[0];
    if (proposal.proposed_by_user_id !== userId) {
      return res.status(403).json({ error: 'Only proposer can cancel proposal' });
    }

    await cancelProposal(proposalId, userId);
    if (proposal.tournament_series_id) {
      await notifySeriesParticipants(proposal.tournament_series_id, proposalId, userId, 'schedule_cancelled');
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('❌ [SCHEDULING] Error cancelling proposal:', error);
    return res.status(400).json({ error: (error as any).message || 'Failed to cancel proposal' });
  }
});

export default router;
