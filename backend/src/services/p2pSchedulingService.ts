import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { roundToNearest30Min, validateSlotDatetimes } from './tournamentSchedulingService.js';

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

export const createP2PProposal = async (
  proposedByUserId: string,
  challengedUserId: string,
  slotDatetimes: string[],
  notes?: string,
  visibility: 'private' | 'public' = 'private'
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

  const proposalId = uuidv4();
  const now = new Date();
  const maxSlotDatetime = new Date(Math.max(...slotDatetimes.map(dt => new Date(dt).getTime())));
  const expiresAt = new Date(maxSlotDatetime.getTime() + 7 * 24 * 60 * 60 * 1000);

  await query(
    `UPDATE match_schedule_proposals
     SET status = 'superseded'
     WHERE challenge_mode = 'p2p'
       AND status IN ('pending', 'confirmed')
       AND proposed_by_user_id = ?
       AND challenged_user_id = ?`,
    [proposedByUserId, challengedUserId]
  );

  await query(
    `INSERT INTO match_schedule_proposals
      (id, tournament_round_match_id, tournament_match_id, proposed_by_user_id, proposed_at, status, expires_at, cancelled_at, user_id, challenge_mode, challenged_user_id, visibility, notes)
     VALUES (?, NULL, NULL, ?, ?, 'pending', ?, NULL, ?, 'p2p', ?, ?, ?)`,
    [proposalId, proposedByUserId, now, expiresAt, challengedUserId, challengedUserId, visibility, notes || null]
  );

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
    slots: slotsResult.rows || [],
    confirmations: confirmationsResult.rows || [],
  };
};

export const listP2PProposalsForUser = async (
  userId: string,
  mode: 'incoming' | 'outgoing' | 'all' = 'all'
) => {
  let whereClause = '(p.proposed_by_user_id = ? OR p.challenged_user_id = ?)';
  const params: any[] = [userId, userId];

  if (mode === 'incoming') {
    whereClause = 'p.challenged_user_id = ?';
    params.splice(0, params.length, userId);
  } else if (mode === 'outgoing') {
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

export const confirmP2PProposalSlots = async (
  proposalId: string,
  userId: string,
  confirmedSlotIds: string[]
) => {
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
  if (proposal.challenged_user_id !== userId) {
    throw new Error('Only challenged user can confirm or reject this proposal');
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

  const allSlotIds = new Set(slotsResult.rows.map((s: any) => s.id));
  for (const slotId of confirmedSlotIds) {
    if (!allSlotIds.has(slotId)) {
      throw new Error(`Slot ${slotId} is not part of this proposal`);
    }
  }

  const confirmedSet = new Set(confirmedSlotIds);
  for (const slot of slotsResult.rows) {
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
  const updatedSlots = updatedSlotsResult.rows || [];

  const confirmedCount = updatedSlots.filter((s: any) => s.status === 'confirmed').length;
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

export const counterProposeP2P = async (
  proposalId: string,
  userId: string,
  slotDatetimes: string[],
  notes?: string,
  visibility: 'private' | 'public' = 'private'
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

  await query(
    `UPDATE match_schedule_proposals
     SET status = 'rejected'
     WHERE id = ?`,
    [proposalId]
  );

  return createP2PProposal(
    userId,
    original.proposed_by_user_id,
    slotDatetimes,
    notes,
    visibility
  );
};

export const updateP2PProposal = async (
  proposalId: string,
  userId: string,
  slotDatetimes: string[],
  notes?: string
) => {
  const validation = validateSlotDatetimes(slotDatetimes);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (notes && notes.length > 500) {
    throw new Error('Notes cannot exceed 500 characters');
  }

  const proposalResult = await query(
    `SELECT id, proposed_by_user_id, status
     FROM match_schedule_proposals
     WHERE id = ? AND challenge_mode = 'p2p'`,
    [proposalId]
  );

  if (!proposalResult.rows || proposalResult.rows.length === 0) {
    throw new Error('Proposal not found');
  }

  const proposal = proposalResult.rows[0];
  if (proposal.proposed_by_user_id !== userId) {
    throw new Error('Only proposer can update proposal');
  }

  if (proposal.status !== 'pending') {
    throw new Error('Can only update pending proposals');
  }

  // Delete old slots
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

  // Update notes if provided
  if (notes !== undefined) {
    await query(
      `UPDATE match_schedule_proposals
       SET notes = ?, proposed_at = NOW()
       WHERE id = ?`,
      [notes || null, proposalId]
    );
  }

  return {
    success: true,
    proposalId,
    slotsCreated: slotIds.length,
  };
};

export const cancelP2PProposal = async (proposalId: string, userId: string) => {
  const proposalResult = await query(
    `SELECT id, proposed_by_user_id
     FROM match_schedule_proposals
     WHERE id = ? AND challenge_mode = 'p2p'`,
    [proposalId]
  );

  if (!proposalResult.rows || proposalResult.rows.length === 0) {
    throw new Error('Proposal not found');
  }

  const proposal = proposalResult.rows[0];
  if (proposal.proposed_by_user_id !== userId) {
    throw new Error('Only proposer can cancel proposal');
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
     WHERE proposal_id = ? AND status = 'pending'`,
    [proposalId]
  );

  return { success: true };
};

export const getP2PParticipantsAvailability = async (proposalId: string, requesterUserId: string) => {
  const proposalResult = await query(
    `SELECT proposed_by_user_id, challenged_user_id
     FROM match_schedule_proposals
     WHERE id = ? AND challenge_mode = 'p2p'`,
    [proposalId]
  );

  if (!proposalResult.rows || proposalResult.rows.length === 0) {
    throw new Error('Proposal not found');
  }

  const proposal = proposalResult.rows[0];
  if (proposal.proposed_by_user_id !== requesterUserId && proposal.challenged_user_id !== requesterUserId) {
    throw new Error('You do not have access to this proposal');
  }

  const usersResult = await query(
    `SELECT id, nickname, timezone, availability_schedule
     FROM users_extension
     WHERE id IN (?, ?)
     ORDER BY nickname ASC`,
    [proposal.proposed_by_user_id, proposal.challenged_user_id]
  );

  return {
    participants: (usersResult.rows || []).map((u: any) => ({
      ...u,
      availability_schedule:
        typeof u.availability_schedule === 'string'
          ? JSON.parse(u.availability_schedule)
          : u.availability_schedule,
    })),
  };
};
