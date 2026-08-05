import { Router, Response } from 'express';
import { authMiddleware, AuthRequest, optionalAuthMiddleware } from '../middleware/auth.js';
import { query } from '../config/database.js';
import discordService from '../services/discordService.js';
import { storeNotificationForUsers } from '../services/discordNotificationService.js';
import {
  cancelP2PProposal,
  confirmP2PProposalSlots,
  counterProposeP2P,
  createP2PProposal,
  getP2PProposalForUser,
  listP2PProposalsForUser,
  updateP2PProposal,
} from '../services/p2pSchedulingService.js';
import { getSchedulingConflictsForUsers } from '../services/schedulingConflictService.js';
import { buildNotificationMessage, formatTimeRangesForDiscord, groupSlotsIntoRanges } from '../utils/slotGrouping.js';

const router = Router();
const DISCORD_P2P_CHALLENGE_CHANNEL_ID = process.env.DISCORD_P2P_CHALLENGE_CHANNEL_ID || '';

interface ChallengeSlotRow {
  slot_datetime: Date | string;
  status: string;
}

/**
 * Publish a challenge event to the configured public P2P Discord channel.
 * Discord is an optional side effect, so a delivery failure is logged and
 * never changes the outcome of the challenge operation that already succeeded.
 * @param title Embed title describing the challenge event.
 * @param color Discord embed color.
 * @param fields Event details shown in the embed.
 * @returns A promise that resolves after publishing is attempted; skipped when no channel is configured.
 */
const sendChallengeDiscord = async (
  title: string,
  color: number,
  fields: Array<{ name: string; value: string; inline?: boolean }>
) => {
  if (!DISCORD_P2P_CHALLENGE_CHANNEL_ID) return;

  try {
    await discordService.publishChannelMessage(DISCORD_P2P_CHALLENGE_CHANNEL_ID, {
      embeds: [{ title, color, fields, timestamp: new Date().toISOString() }],
    });
  } catch (error) {
    console.error('[CHALLENGES] Failed to publish optional Discord event:', error);
  }
};

/**
 * Load the display name used in challenge notifications.
 * @param userId Application user ID.
 * @returns The user's nickname, or `Player` when the user cannot be found.
 */
const getUserSummary = async (userId: string): Promise<{ nickname: string }> => {
  const result = await query(
    `SELECT COALESCE(nickname, id) AS nickname
     FROM users_extension
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  if (!result.rows || result.rows.length === 0) {
    return { nickname: 'Player' };
  }

  return {
    nickname: result.rows[0].nickname,
  };
};

/** List public P2P proposals, plus the authenticated player's own proposals when available. */
router.get('/proposals', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const mode = (req.query.mode as 'incoming' | 'outgoing' | 'all' | undefined) || 'all';
    if (!['incoming', 'outgoing', 'all'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Allowed: incoming, outgoing, all' });
    }

    const proposals = await listP2PProposalsForUser(userId, mode);
    return res.json({ proposals });
  } catch (error) {
    console.error('❌ [CHALLENGES] Error listing proposals:', error);
    return res.status(500).json({ error: 'Failed to list challenge proposals' });
  }
});

/** Return proposal details after enforcing that the requester is a participant. */
router.get('/proposals/:proposalId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { proposalId } = req.params;

    const proposal = await getP2PProposalForUser(proposalId, userId);
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    return res.json({ proposal });
  } catch (error) {
    console.error('❌ [CHALLENGES] Error getting proposal:', error);
    return res.status(500).json({ error: 'Failed to fetch challenge proposal' });
  }
});

/**
 * Return slots already reserved by active P2P or tournament proposals for the
 * authenticated player and the requested opponent/participants.
 */
router.get('/occupied-slots', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const requestedIds = typeof req.query.user_ids === 'string'
      ? req.query.user_ids.split(',').map((id) => id.trim())
      : [];
    const userIds = [...new Set([req.userId!, ...requestedIds].filter(Boolean))];
    const excludedProposalId = typeof req.query.exclude_proposal_id === 'string'
      ? req.query.exclude_proposal_id
      : undefined;

    const conflicts = await getSchedulingConflictsForUsers(userIds, excludedProposalId);
    return res.json({ conflicts });
  } catch (error) {
    console.error('[CHALLENGES] Error getting occupied scheduling slots:', error);
    return res.status(500).json({ error: 'Failed to fetch occupied scheduling slots' });
  }
});

/** Create a proposal, then notify the challenged player and the public Discord channel. */
router.post('/proposals', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const proposedByUserId = req.userId!;
    const { challenged_user_id, slot_datetimes, notes } = req.body;

    if (!challenged_user_id || !Array.isArray(slot_datetimes)) {
      return res.status(400).json({ error: 'Missing required fields: challenged_user_id, slot_datetimes[]' });
    }

    const { proposalId, slotsCreated } = await createP2PProposal(
      proposedByUserId,
      challenged_user_id,
      slot_datetimes,
      notes,
      'public'
    );

    const proposer = await getUserSummary(proposedByUserId);
    const challenged = await getUserSummary(challenged_user_id);
    const ranges = groupSlotsIntoRanges(slot_datetimes);
    const formattedRanges = formatTimeRangesForDiscord(ranges);
    const message = buildNotificationMessage('proposal', proposer.nickname, ranges, notes);

    await storeNotificationForUsers(
      [challenged_user_id],
      proposalId,
      proposalId,
      'challenge_proposal',
      '🗓️ New Challenge Proposal',
      message,
      notes || null
    );

    await sendChallengeDiscord('⚔️ New P2P Challenge Proposal', 0xffa500, [
      { name: 'From', value: proposer.nickname, inline: true },
      { name: 'To', value: challenged.nickname, inline: true },
      { name: 'Slots (UTC)', value: formattedRanges || 'No slots', inline: false },
      ...(notes ? [{ name: 'Notes', value: notes, inline: false }] : []),
    ]);

    return res.json({ success: true, proposalId, slotsCreated });
  } catch (error) {
    console.error('❌ [CHALLENGES] Error creating proposal:', error);
    return res.status(400).json({ error: (error as Error).message || 'Failed to create challenge proposal' });
  }
});

/** Apply the challenged player's slot selection and notify the original proposer. */
router.post('/proposals/:proposalId/confirm-slots', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { proposalId } = req.params;
    const { confirmed_slot_ids } = req.body;

    if (!Array.isArray(confirmed_slot_ids)) {
      return res.status(400).json({ error: 'confirmed_slot_ids must be an array' });
    }

    const result = await confirmP2PProposalSlots(proposalId, userId, confirmed_slot_ids);
    const proposal = await getP2PProposalForUser(proposalId, userId);
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found after confirmation' });
    }

    const proposerId = proposal.proposed_by_user_id;
    const confirmer = await getUserSummary(userId);
    const proposer = await getUserSummary(proposerId);

    const confirmedSlots = ((result.slots || []) as ChallengeSlotRow[])
      .filter((slot) => slot.status === 'confirmed')
      .map((slot) => new Date(slot.slot_datetime).toISOString());
    const ranges = groupSlotsIntoRanges(confirmedSlots);
    const message = buildNotificationMessage(
      result.status === 'confirmed' ? 'confirmed' : 'rejected',
      confirmer.nickname,
      ranges
    );

    const title = result.status === 'confirmed'
      ? '✅ Challenge Schedule Confirmed'
      : '❌ Challenge Schedule Rejected';
    const type = result.status === 'confirmed'
      ? 'challenge_confirmed'
      : 'challenge_rejected';

    await storeNotificationForUsers([proposerId], proposalId, proposalId, type, title, message, null);

    const discordTitle = result.status === 'confirmed'
      ? `⚔️ ${confirmer.nickname} has accepted ${proposer.nickname}'s challenge`
      : `❌ ${confirmer.nickname} has rejected ${proposer.nickname}'s challenge`;

    await sendChallengeDiscord(
      discordTitle,
      result.status === 'confirmed' ? 0x2ecc71 : 0xff0000,
      [
        ...(ranges.length > 0
          ? [{ name: 'Confirmed Slots (UTC)', value: formatTimeRangesForDiscord(ranges), inline: false }]
          : []),
      ]
    );

    return res.json(result);
  } catch (error) {
    console.error('❌ [CHALLENGES] Error confirming proposal:', error);
    return res.status(400).json({ error: (error as Error).message || 'Failed to confirm challenge proposal' });
  }
});

/** Reject the current proposal and create a replacement in the opposite direction. */
router.post('/proposals/:proposalId/counter-propose', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { proposalId } = req.params;
    const { slot_datetimes, notes } = req.body;

    if (!Array.isArray(slot_datetimes) || slot_datetimes.length === 0) {
      return res.status(400).json({ error: 'slot_datetimes must be a non-empty array' });
    }

    const result = await counterProposeP2P(
      proposalId,
      userId,
      slot_datetimes,
      notes,
      'public'
    );

    const newProposal = await getP2PProposalForUser(result.proposalId, userId);
    if (!newProposal) {
      return res.status(404).json({ error: 'Counter proposal not found' });
    }

    const recipientId = newProposal.challenged_user_id;
    const actor = await getUserSummary(userId);
    const ranges = groupSlotsIntoRanges(slot_datetimes);
    const message = buildNotificationMessage('counter', actor.nickname, ranges, notes);

    await storeNotificationForUsers(
      [recipientId],
      result.proposalId,
      result.proposalId,
      'challenge_counter_proposal',
      '🔄 Challenge Counter Proposal',
      message,
      notes || null
    );

    await sendChallengeDiscord('🔄 P2P Challenge Counter Proposal', 0x3498db, [
      { name: 'Action by', value: actor.nickname, inline: false },
      { name: 'Slots (UTC)', value: formatTimeRangesForDiscord(ranges), inline: false },
      ...(notes ? [{ name: 'Notes', value: notes, inline: false }] : []),
    ]);

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ [CHALLENGES] Error creating counter-proposal:', error);
    return res.status(400).json({ error: (error as Error).message || 'Failed to create counter-proposal' });
  }
});

/** Cancel a proposal owned by the authenticated proposer and notify its target. */
router.post('/proposals/:proposalId/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { proposalId } = req.params;

    const proposal = await getP2PProposalForUser(proposalId, userId);
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    // Get cancelled slots before cancelling
    const slotsResult = await query(
      `SELECT slot_datetime FROM match_schedule_slots
       WHERE proposal_id = ? AND status <> 'cancelled'
       ORDER BY slot_datetime ASC`,
      [proposalId]
    );
    
    const cancelledSlots = ((slotsResult.rows || []) as ChallengeSlotRow[])
      .map((slot) => new Date(slot.slot_datetime).toISOString());
    const ranges = groupSlotsIntoRanges(cancelledSlots);

    await cancelP2PProposal(proposalId, userId);

    const targetUserId = proposal.proposed_by_user_id === userId
      ? proposal.challenged_user_id
      : proposal.proposed_by_user_id;
    const actor = await getUserSummary(userId);
    const target = await getUserSummary(targetUserId);

    await storeNotificationForUsers(
      [targetUserId],
      proposalId,
      proposalId,
      'challenge_cancelled',
      '🚫 Challenge Proposal Cancelled',
      `${actor.nickname} cancelled a challenge proposal`,
      null
    );

    const discordTitle = `🚫 ${actor.nickname} has cancelled the challenge to ${target.nickname}`;

    await sendChallengeDiscord(discordTitle, 0xff0000, [
      ...(ranges.length > 0
        ? [{ name: 'Cancelled Slots (UTC)', value: formatTimeRangesForDiscord(ranges), inline: false }]
        : []),
    ]);

    return res.json({ success: true });
  } catch (error) {
    console.error('❌ [CHALLENGES] Error cancelling proposal:', error);
    return res.status(400).json({ error: (error as Error).message || 'Failed to cancel proposal' });
  }
});

/** Replace the slots and notes of a pending proposal owned by its proposer. */
router.put('/proposals/:proposalId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { proposalId } = req.params;
    const { slot_datetimes, notes } = req.body;

    if (!Array.isArray(slot_datetimes) || slot_datetimes.length === 0) {
      return res.status(400).json({ error: 'slot_datetimes must be a non-empty array' });
    }

    // Get old slots before updating
    const oldSlotsResult = await query(
      `SELECT slot_datetime FROM match_schedule_slots
       WHERE proposal_id = ? AND status <> 'cancelled'
       ORDER BY slot_datetime ASC`,
      [proposalId]
    );
    
    const oldSlots = ((oldSlotsResult.rows || []) as ChallengeSlotRow[])
      .map((slot) => new Date(slot.slot_datetime).toISOString());
    const oldRanges = groupSlotsIntoRanges(oldSlots);

    await updateP2PProposal(proposalId, userId, slot_datetimes, notes);
    const proposal = await getP2PProposalForUser(proposalId, userId);
    
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found after update' });
    }

    const challengedUserId = proposal.proposed_by_user_id === userId
      ? proposal.challenged_user_id
      : proposal.proposed_by_user_id;
    const updater = await getUserSummary(userId);
    const challenged = await getUserSummary(challengedUserId);

    const newRanges = groupSlotsIntoRanges(slot_datetimes);
    const message = buildNotificationMessage('changed', updater.nickname, newRanges, notes);

    const title = '🔄 Challenge Schedule Updated';
    const type = 'challenge_updated';

    await storeNotificationForUsers([challengedUserId], proposalId, proposalId, type, title, message, null);

    const discordTitle = `🔄 ${updater.nickname} has updated the challenge to ${challenged.nickname}`;

    await sendChallengeDiscord(
      discordTitle,
      0xffc107,
      [
        { name: 'Previous Slots (UTC)', value: formatTimeRangesForDiscord(oldRanges), inline: false },
        { name: 'New Slots (UTC)', value: formatTimeRangesForDiscord(newRanges), inline: false },
        ...(notes ? [{ name: 'Notes', value: notes, inline: false }] : []),
      ]
    );

    return res.json({ success: true, proposalId });
  } catch (error) {
    console.error('❌ [CHALLENGES] Error updating proposal:', error);
    return res.status(400).json({ error: (error as Error).message || 'Failed to update proposal' });
  }
});

export default router;
