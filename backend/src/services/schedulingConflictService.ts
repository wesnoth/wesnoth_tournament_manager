import { query } from '../config/database.js';

export interface SchedulingConflict {
  slot_datetime: Date | string;
  source: 'p2p' | 'tournament';
  proposal_id: string;
}

/**
 * Find slots reserved by active P2P or tournament proposals involving any of
 * the supplied players. An optional proposal ID excludes the record currently
 * being edited or answered.
 */
export const getSchedulingConflictsForUsers = async (
  userIds: string[],
  excludedProposalId?: string
): Promise<SchedulingConflict[]> => {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return [];

  const userPlaceholders = uniqueUserIds.map(() => '?').join(', ');
  const excludedClause = excludedProposalId ? 'AND p.id <> ?' : '';
  const params: string[] = [
    ...uniqueUserIds,
    ...uniqueUserIds,
    ...(excludedProposalId ? [excludedProposalId] : []),
  ];

  const result = await query(
    `SELECT DISTINCT s.slot_datetime, p.challenge_mode AS source, p.id AS proposal_id
     FROM match_schedule_proposals p
     JOIN match_schedule_slots s ON s.proposal_id = p.id
     WHERE p.status IN ('pending', 'confirmed', 'active')
       AND s.status IN ('pending', 'confirmed')
       AND (
         p.proposed_by_user_id IN (${userPlaceholders})
         OR p.challenged_user_id IN (${userPlaceholders})
       )
       ${excludedClause}
     ORDER BY s.slot_datetime ASC`,
    params
  );

  return (result.rows || []) as SchedulingConflict[];
};

/**
 * Reject a proposal before persistence when any requested half-hour slot is
 * already reserved by another active proposal for one of the participants.
 */
export const assertSlotsAreAvailable = async (
  userIds: string[],
  slotDatetimes: string[],
  excludedProposalId?: string
): Promise<void> => {
  const conflicts = await getSchedulingConflictsForUsers(userIds, excludedProposalId);
  const occupiedTimes = new Set(
    conflicts.map((conflict) => new Date(conflict.slot_datetime).getTime())
  );

  const conflictingSlots = slotDatetimes.filter(
    (slotDatetime) => occupiedTimes.has(new Date(slotDatetime).getTime())
  );

  if (conflictingSlots.length > 0) {
    throw new Error('One or more selected slots are already reserved by an active proposal');
  }
};
