import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { roundToNearest30Min, validateSlotDatetimes } from './tournamentSchedulingService.js';
import { assertSlotsAreAvailable } from './schedulingConflictService.js';
import {
  consumeUserActionRateLimit,
  releaseUserActionRateLimit,
} from './userActionRateLimitService.js';

const P2P_PROPOSAL_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface P2PProposalRow {
  id: string;
  proposed_by_user_id: string;
  challenged_user_id: string;
  proposed_at: Date;
  status: string;
  notes: string | null;
  visibility: string;
  expires_at: Date | null;
}

interface P2PSlotRow {
  id: string;
  slot_datetime: Date | string;
  status: string;
}

interface P2PConfirmationRow {
  user_id: string;
  confirmed_at: Date | string;
}


/**
 * Create a new pending challenge, replacing older active challenges between
 * the same two players and recording the proposer's confirmation.
 *
 * The initial proposal and every counter-proposal share the proposer's P2P
 * action budget because both produce equivalent database and Discord effects.
 * `rateLimitAlreadyConsumed` is an internal invariant used only by the counter
 * path, which reserves quota before rejecting the previous proposal. External
 * callers must leave it false so direct creations cannot bypass protection.
 *
 * The reservation is made only after user, slot, conflict, and notes validation.
 * It is released if the proposal row itself cannot be inserted. Once that row
 * exists the action remains counted even if a later slot, confirmation, or
 * notification side effect fails.
 */
export const createP2PProposal = async (
  proposedByUserId: string,
  challengedUserId: string,
  slotDatetimes: string[],
  notes?: string,
  visibility: 'private' | 'public' = 'public',
  rateLimitAlreadyConsumed = false
): Promise<{ proposalId: string; slotsCreated: number }> => {
  if (proposedByUserId === challengedUserId) {
    throw new Error('You cannot challenge yourself');
  }

  const validation = validateSlotDatetimes(slotDatetimes);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (notes && notes.length > 500) {
    throw new Error('Notes cannot exceed 500 characters');
  }

  const usersResult = await query(
    `SELECT id FROM users_extension WHERE id IN (?, ?)`,
    [proposedByUserId, challengedUserId]
  );

  if (!usersResult.rows || usersResult.rows.length !== 2) {
    throw new Error('Invalid proposer or challenged user');
  }

  await assertSlotsAreAvailable(
    [proposedByUserId, challengedUserId],
    slotDatetimes
  );

  const proposalId = uuidv4();
  const now = new Date();
  const maxSlotDatetime = new Date(Math.max(...slotDatetimes.map(dt => new Date(dt).getTime())));
  // Keep proposals actionable for one day after the latest offered slot. This
  // bounds stale pending challenges without tying their lifetime to the
  // recipient's short-lived waiting-lobby announcement.
  const expiresAt = new Date(maxSlotDatetime.getTime() + P2P_PROPOSAL_RESPONSE_WINDOW_MS);

  const rateLimitEventId = rateLimitAlreadyConsumed
    ? null
    : await consumeUserActionRateLimit(proposedByUserId, 'p2p_challenge');
  try {
    await query(
      `INSERT INTO match_schedule_proposals
        (id, proposed_by_user_id, proposed_at, status, expires_at, cancelled_at, challenge_mode, challenged_user_id, visibility, notes)
       VALUES (?, ?, ?, 'pending', ?, NULL, 'p2p', ?, ?, ?)`,
      [proposalId, proposedByUserId, now, expiresAt, challengedUserId, visibility, notes || null]
    );
  } catch (error) {
    if (rateLimitEventId) {
      await releaseUserActionRateLimit(rateLimitEventId, proposedByUserId, 'p2p_challenge');
    }
    throw error;
  }

  let slotsCreated = 0;
  for (const dtString of slotDatetimes) {
    const slotId = uuidv4();
    const roundedDt = roundToNearest30Min(new Date(dtString));
    const slotResult = await query(
      `INSERT INTO match_schedule_slots
        (id, proposal_id, slot_datetime, slot_duration_minutes, status)
       VALUES (?, ?, ?, 30, 'pending')`,
      [slotId, proposalId, roundedDt]
    );
    if (slotResult.rowCount) {
      slotsCreated++;
    }
  }

  const confirmationId = uuidv4();
  await query(
    `INSERT INTO match_schedule_confirmations
      (id, proposal_id, user_id, confirmed_at)
     VALUES (?, ?, ?, NOW())`,
    [confirmationId, proposalId, proposedByUserId]
  );

  return { proposalId, slotsCreated };
};

/**
 * Return a proposal and its slots only when the requester is one of its players.
 * This is the authorization boundary used by the proposal detail route.
 */
export const getP2PProposalForUser = async (proposalId: string, userId: string) => {
  const proposalResult = await query(
    `SELECT id, proposed_by_user_id, challenged_user_id, proposed_at, status, notes, visibility, expires_at
     FROM match_schedule_proposals
     WHERE id = ?
       AND challenge_mode = 'p2p'
       AND (proposed_by_user_id = ? OR challenged_user_id = ?)`,
    [proposalId, userId, userId]
  );

  if (!proposalResult.rows || proposalResult.rows.length === 0) {
    return null;
  }

  const proposal = proposalResult.rows[0] as P2PProposalRow;

  const slotsResult = await query(
    `SELECT id, slot_datetime, status
     FROM match_schedule_slots
     WHERE proposal_id = ?
     ORDER BY slot_datetime ASC`,
    [proposal.id]
  );

  const confirmationsResult = await query(
    `SELECT user_id, confirmed_at
     FROM match_schedule_confirmations
     WHERE proposal_id = ?
     ORDER BY confirmed_at ASC`,
    [proposal.id]
  );

  return {
    ...proposal,
    slots: (slotsResult.rows || []) as P2PSlotRow[],
    confirmations: (confirmationsResult.rows || []) as P2PConfirmationRow[],
  };
};

/**
 * List challenges visible to a player, optionally restricted to incoming or
 * outgoing proposals. Public proposals are included in the general feed, but
 * proposal details remain restricted to the two participants.
 */
export const listP2PProposalsForUser = async (
  userId: string | undefined,
  mode: 'incoming' | 'outgoing' | 'all' = 'all'
) => {
  let whereClause = 'p.visibility = \'public\'';
  const params: string[] = [];

  if (userId) {
    whereClause = '(p.proposed_by_user_id = ? OR p.challenged_user_id = ? OR p.visibility = \'public\')';
    params.push(userId, userId);
  }

  if (userId && mode === 'incoming') {
    whereClause = 'p.challenged_user_id = ?';
    params.splice(0, params.length, userId);
  } else if (userId && mode === 'outgoing') {
    whereClause = 'p.proposed_by_user_id = ?';
    params.splice(0, params.length, userId);
  }

  const result = await query(
    `SELECT p.id, p.proposed_by_user_id, p.challenged_user_id, p.proposed_at, p.status, p.notes, p.visibility,
            proposer.nickname AS proposed_by_nickname,
            challenged.nickname AS challenged_nickname,
            MIN(s.slot_datetime) AS first_slot_datetime,
            MAX(s.slot_datetime) AS last_slot_datetime
     FROM match_schedule_proposals p
     LEFT JOIN users_extension proposer ON proposer.id = p.proposed_by_user_id COLLATE utf8mb4_general_ci
     LEFT JOIN users_extension challenged ON challenged.id = p.challenged_user_id COLLATE utf8mb4_general_ci
     LEFT JOIN match_schedule_slots s ON s.proposal_id = p.id
     WHERE p.challenge_mode = 'p2p'
       AND ${whereClause}
     GROUP BY p.id, p.proposed_by_user_id, p.challenged_user_id, p.proposed_at, p.status, p.notes, p.visibility,
              proposer.nickname, challenged.nickname
     ORDER BY p.created_at DESC`,
    params
  );

  return result.rows || [];
};

/**
 * Apply the challenged player's slot selection and transition the proposal to
 * confirmed when at least one slot remains, or rejected when none remain.
 */
export const confirmP2PProposalSlots = async (
  proposalId: string,
  userId: string,
  confirmedSlotIds: string[]
) => {
  const proposalResult = await query(
    `SELECT id, proposed_by_user_id, challenged_user_id, status, expires_at
     FROM match_schedule_proposals
     WHERE id = ? AND challenge_mode = 'p2p'`,
    [proposalId]
  );

  if (!proposalResult.rows || proposalResult.rows.length === 0) {
    throw new Error('Proposal not found');
  }

  const proposal = proposalResult.rows[0];
  if (proposal.challenged_user_id !== userId) {
    throw new Error('Only challenged user can confirm or reject this proposal');
  }

  if (proposal.status !== 'pending' ||
      (proposal.expires_at && new Date(proposal.expires_at).getTime() <= Date.now())) {
    throw new Error('This challenge proposal is no longer active');
  }

  if (!Array.isArray(confirmedSlotIds)) {
    throw new Error('confirmed_slot_ids must be an array');
  }

  const existingConfirmation = await query(
    `SELECT id FROM match_schedule_confirmations WHERE proposal_id = ? AND user_id = ?`,
    [proposalId, userId]
  );

  if (existingConfirmation.rows && existingConfirmation.rows.length > 0) {
    throw new Error('User has already confirmed this proposal');
  }

  const slotsResult = await query(
    `SELECT id, status FROM match_schedule_slots WHERE proposal_id = ? ORDER BY slot_datetime ASC`,
    [proposalId]
  );

  if (!slotsResult.rows || slotsResult.rows.length === 0) {
    throw new Error('No slots found for this proposal');
  }

  const slots = (slotsResult.rows || []) as P2PSlotRow[];
  const allSlotIds = new Set(slots.map((slot) => slot.id));
  for (const slotId of confirmedSlotIds) {
    if (!allSlotIds.has(slotId)) {
      throw new Error(`Slot ${slotId} is not part of this proposal`);
    }
  }

  const confirmedSet = new Set(confirmedSlotIds);
  for (const slot of slots) {
    if (slot.status === 'pending') {
      const nextStatus = confirmedSet.has(slot.id) ? 'confirmed' : 'rejected';
      await query(`UPDATE match_schedule_slots SET status = ? WHERE id = ?`, [nextStatus, slot.id]);
    }
  }

  const confirmationId = uuidv4();
  await query(
    `INSERT INTO match_schedule_confirmations (id, proposal_id, user_id, confirmed_at)
     VALUES (?, ?, ?, NOW())`,
    [confirmationId, proposalId, userId]
  );

  const updatedSlotsResult = await query(
    `SELECT id, slot_datetime, status FROM match_schedule_slots WHERE proposal_id = ? ORDER BY slot_datetime ASC`,
    [proposalId]
  );
  const updatedSlots = (updatedSlotsResult.rows || []) as P2PSlotRow[];

  const confirmedCount = updatedSlots.filter((slot) => slot.status === 'confirmed').length;
  const totalSlots = updatedSlots.length;
  const nextProposalStatus = confirmedCount > 0 ? 'confirmed' : (totalSlots > 0 ? 'rejected' : 'pending');

  await query(
    `UPDATE match_schedule_proposals SET status = ? WHERE id = ?`,
    [nextProposalStatus, proposalId]
  );

  return {
    success: true,
    status: nextProposalStatus,
    slots: updatedSlots,
  };
};

/**
 * Reject the current proposal and create a new proposal in the opposite
 * direction, preserving the challenge negotiation as a sequence of records.
 * Quota is reserved before changing the original proposal so concurrent
 * counters from the same user cannot exceed the shared P2P action budget.
 */
export const counterProposeP2P = async (
  proposalId: string,
  userId: string,
  slotDatetimes: string[],
  notes?: string,
  visibility: 'private' | 'public' = 'public'
) => {
  const validation = validateSlotDatetimes(slotDatetimes);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (notes && notes.length > 500) {
    throw new Error('Notes cannot exceed 500 characters');
  }

  const originalResult = await query(
    `SELECT id, proposed_by_user_id, challenged_user_id
     FROM match_schedule_proposals
     WHERE id = ? AND challenge_mode = 'p2p'`,
    [proposalId]
  );

  if (!originalResult.rows || originalResult.rows.length === 0) {
    throw new Error('Proposal not found');
  }

  const original = originalResult.rows[0];
  if (original.challenged_user_id !== userId) {
    throw new Error('Only challenged user can counter-propose');
  }

  const rateLimitEventId = await consumeUserActionRateLimit(userId, 'p2p_challenge');
  try {
    await query(
      `UPDATE match_schedule_proposals
       SET status = 'rejected'
       WHERE id = ?`,
      [proposalId]
    );
  } catch (error) {
    await releaseUserActionRateLimit(rateLimitEventId, userId, 'p2p_challenge');
    throw error;
  }

  return createP2PProposal(
    userId,
    original.proposed_by_user_id,
    slotDatetimes,
    notes,
    visibility,
    true
  );
};

/**
 * Replace the slots and notes of a pending or confirmed proposal by either participant.
 * Passing `null` for notes explicitly clears previously stored notes.
 * Updates consume the same P2P budget as new and counter proposals because an
 * otherwise reusable proposal could be edited indefinitely to spam Discord.
 */
export const updateP2PProposal = async (
  proposalId: string,
  userId: string,
  slotDatetimes: string[],
  notes?: string | null
) => {
  const validation = validateSlotDatetimes(slotDatetimes);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (notes && notes.length > 500) {
    throw new Error('Notes cannot exceed 500 characters');
  }

  const proposalResult = await query(
    `SELECT id, proposed_by_user_id, challenged_user_id, status
     FROM match_schedule_proposals
     WHERE id = ? AND challenge_mode = 'p2p'`,
    [proposalId]
  );

  if (!proposalResult.rows || proposalResult.rows.length === 0) {
    throw new Error('Proposal not found');
  }

  const proposal = proposalResult.rows[0];
  if (proposal.proposed_by_user_id !== userId && proposal.challenged_user_id !== userId) {
    throw new Error('Only challenge participants can update proposal');
  }

  if (!['pending', 'confirmed'].includes(proposal.status)) {
    throw new Error('Can only update pending or confirmed proposals');
  }

  // Moving a confirmed challenge starts a fresh confirmation cycle. Reserve
  // quota immediately before the first write, after all validation and access checks.
  const rateLimitEventId = await consumeUserActionRateLimit(userId, 'p2p_challenge');
  try {
    await query(`DELETE FROM match_schedule_confirmations WHERE proposal_id = ?`, [proposalId]);
  } catch (error) {
    await releaseUserActionRateLimit(rateLimitEventId, userId, 'p2p_challenge');
    throw error;
  }
  await query(
    `DELETE FROM match_schedule_slots
     WHERE proposal_id = ?`,
    [proposalId]
  );

  // Create new slots
  const slotIds: string[] = [];
  for (const slotDatetime of slotDatetimes) {
    const slotId = uuidv4();
    const roundedDt = roundToNearest30Min(new Date(slotDatetime));
    await query(
      `INSERT INTO match_schedule_slots
       (id, proposal_id, slot_datetime, slot_duration_minutes, status)
       VALUES (?, ?, ?, 30, 'pending')`,
      [slotId, proposalId, roundedDt]
    );
    slotIds.push(slotId);
  }

  await query(
    `INSERT INTO match_schedule_confirmations (id, proposal_id, user_id, confirmed_at)
     VALUES (?, ?, ?, NOW())`,
    [uuidv4(), proposalId, userId]
  );

  const maxSlotDatetime = new Date(Math.max(...slotDatetimes.map(dt => new Date(dt).getTime())));
  const expiresAt = new Date(maxSlotDatetime.getTime() + P2P_PROPOSAL_RESPONSE_WINDOW_MS);
  await query(
    `UPDATE match_schedule_proposals
     SET notes = CASE WHEN ? IS NULL THEN notes ELSE ? END,
         status = 'pending', proposed_at = NOW(), expires_at = ?, cancelled_at = NULL
     WHERE id = ?`,
    [notes === undefined ? null : notes, notes === undefined ? null : notes, expiresAt, proposalId]
  );

  return {
    success: true,
    proposalId,
    slotsCreated: slotIds.length,
  };
};

/**
 * Cancel a proposal and mark all of its active slots as cancelled.
 * Either participant may perform this operation.
 */
export const cancelP2PProposal = async (proposalId: string, userId: string) => {
  const proposalResult = await query(
    `SELECT id, proposed_by_user_id, challenged_user_id
     FROM match_schedule_proposals
     WHERE id = ? AND challenge_mode = 'p2p'`,
    [proposalId]
  );

  if (!proposalResult.rows || proposalResult.rows.length === 0) {
    throw new Error('Proposal not found');
  }

  const proposal = proposalResult.rows[0];
  if (proposal.proposed_by_user_id !== userId && proposal.challenged_user_id !== userId) {
    throw new Error('Only challenge participants can cancel proposal');
  }

  await query(
    `UPDATE match_schedule_proposals
     SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = ?`,
    [proposalId]
  );

  await query(
    `UPDATE match_schedule_slots
     SET status = 'cancelled'
     WHERE proposal_id = ? AND status <> 'cancelled'`,
    [proposalId]
  );

  return { success: true };
};
