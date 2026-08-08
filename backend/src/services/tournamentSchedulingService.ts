import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { assertSlotsAreAvailable } from './schedulingConflictService.js';
import { validateTimezone, validateAvailabilitySchedule } from '../utils/timezoneUtils.js';
import {
  consumeUserActionRateLimit,
  releaseUserActionRateLimit,
} from './userActionRateLimitService.js';

export interface TimeRange {
  start: string;
  end: string;
}

export interface AvailabilitySchedule {
  [day: string]: TimeRange[];
}

interface ConversionResult {
  day: string;
  ranges: TimeRange[];
  nextDay?: string;
}

/**
 * Calculate timezone offset in hours between two timezones
 * Uses the provided referenceDate to account for DST transitions
 * Returns positive if toTz is ahead of fromTz, negative if behind
 */
const getTimezoneOffset = (fromTz: string, toTz: string, referenceDate: Date = new Date()): number => {
  try {
    // Use the full DateTimeFormat with date info to detect day boundaries
    const formatterWithDate = (tz: string) => new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const utcDateStr = referenceDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const utcHour = referenceDate.getUTCHours();
    
    // Get toTz local time with date
    const toTzFormatter = formatterWithDate(toTz);
    const toParts = toTzFormatter.formatToParts(referenceDate);
    const toDay = parseInt(toParts.find(p => p.type === 'day')?.value || '1');
    const toHour = parseInt(toParts.find(p => p.type === 'hour')?.value || '0');
    
    // Get fromTz local time with date
    const fromTzFormatter = formatterWithDate(fromTz);
    const fromParts = fromTzFormatter.formatToParts(referenceDate);
    const fromDay = parseInt(fromParts.find(p => p.type === 'day')?.value || '1');
    const fromHour = parseInt(fromParts.find(p => p.type === 'hour')?.value || '0');
    
    // Calculate day offsets from UTC day
    const utcDay = referenceDate.getUTCDate();
    const toTzDayOffset = toDay - utcDay;
    const fromTzDayOffset = fromDay - utcDay;
    
    // Calculate offsets accounting for day boundaries
    const toOffset = toTzDayOffset * 24 + (toHour - utcHour);
    const fromOffset = fromTzDayOffset * 24 + (fromHour - utcHour);
    
    // Difference
    return toOffset - fromOffset;
  } catch (error) {
    console.warn(`Error calculating timezone offset between ${fromTz} and ${toTz}:`, error);
    return 0;
  }
};

/**
 * Convert time range from one timezone to another
 * Input: time range in "fromTz", output: time range in "toTz"
 */
const convertTimeRangeToTimezone = (
  dayOfWeek: string,
  timeRange: TimeRange,
  fromTz: string,
  toTz: string,
  referenceDate: Date = new Date()
): ConversionResult => {
  try {
    // Parse start and end times
    const [startHour, startMin] = timeRange.start.split(':').map(Number);
    const [endHour, endMin] = timeRange.end.split(':').map(Number);
    
    if (fromTz === toTz) {
      // No conversion needed
      return { day: dayOfWeek, ranges: [timeRange] };
    }

    // Get timezone offsets
    const fromTzOffsetHours = getTimezoneOffset('UTC', fromTz, referenceDate);
    const toTzOffsetHours = getTimezoneOffset('UTC', toTz, referenceDate);
    
    // Convert: if we have HH:MM in fromTz, what time is it in toTz?
    // The shift is: toTzOffset - fromTzOffset
    const shiftHours = toTzOffsetHours - fromTzOffsetHours;
    
    // Apply the shift to start and end times
    let resultStartHour = startHour + shiftHours;
    let resultStartMin = startMin;
    let resultStartDayShift = 0;
    
    // Handle hour wraparound
    if (resultStartHour < 0) {
      resultStartDayShift = Math.floor(resultStartHour / 24) - 1;
      resultStartHour = ((resultStartHour % 24) + 24) % 24;
    } else if (resultStartHour >= 24) {
      resultStartDayShift = Math.floor(resultStartHour / 24);
      resultStartHour = resultStartHour % 24;
    }
    
    let resultEndHour = endHour + shiftHours;
    let resultEndMin = endMin;
    let resultEndDayShift = 0;
    
    // Handle hour wraparound
    if (resultEndHour < 0) {
      resultEndDayShift = Math.floor(resultEndHour / 24) - 1;
      resultEndHour = ((resultEndHour % 24) + 24) % 24;
    } else if (resultEndHour >= 24) {
      resultEndDayShift = Math.floor(resultEndHour / 24);
      resultEndHour = resultEndHour % 24;
    }
    
    const daysMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6
    };
    const daysReverseMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    const startDayNum = daysMap[dayOfWeek.toLowerCase()];
    const startResultDayNum = (startDayNum + resultStartDayShift + 7) % 7;
    const startResultDayName = daysReverseMap[startResultDayNum];
    
    const endDayNum = daysMap[dayOfWeek.toLowerCase()];
    const endResultDayNum = (endDayNum + resultEndDayShift + 7) % 7;
    const endResultDayName = daysReverseMap[endResultDayNum];
    
    const startTimeStr = `${String(resultStartHour).padStart(2, '0')}:${String(resultStartMin).padStart(2, '0')}`;
    const endTimeStr = `${String(resultEndHour).padStart(2, '0')}:${String(resultEndMin).padStart(2, '0')}`;
    
    if (startResultDayName === endResultDayName) {
      // Same day
      return { day: startResultDayName, ranges: [{ start: startTimeStr, end: endTimeStr }] };
    } else {
      // Spans two days
      return {
        day: startResultDayName,
        ranges: [
          { start: startTimeStr, end: '23:59' },
          { start: '00:00', end: endTimeStr }
        ],
        nextDay: endResultDayName
      };
    }
  } catch (error) {
    console.warn(`Error converting time range for ${dayOfWeek} ${timeRange.start}-${timeRange.end}:`, error);
    return { day: dayOfWeek, ranges: [timeRange] };
  }
};

/**
 * Convert entire availability schedule from one timezone to another
 */
const convertAvailabilitySchedule = (
  schedule: AvailabilitySchedule,
  fromTz: string,
  toTz: string,
  referenceDate: Date = new Date()
): AvailabilitySchedule => {
  if (fromTz === toTz) {
    return schedule;
  }
  
  const result: AvailabilitySchedule = {
    monday: [], tuesday: [], wednesday: [], thursday: [],
    friday: [], saturday: [], sunday: []
  };
  
  for (const [day, ranges] of Object.entries(schedule)) {
    for (const range of ranges) {
      const { day: resultDay, ranges: resultRanges, nextDay } = convertTimeRangeToTimezone(
        day,
        range,
        fromTz,
        toTz,
        referenceDate
      ) as any;
      
      // Add ranges for first day
      for (const resultRange of resultRanges.slice(0, 1)) {
        const exists = result[resultDay].some(
          r => r.start === resultRange.start && r.end === resultRange.end
        );
        if (!exists) {
          result[resultDay].push(resultRange);
        }
      }
      
      // If spans two days, add the second day's range
      if (nextDay && resultRanges.length > 1) {
        const secondRange = resultRanges[1];
        const exists = result[nextDay].some(
          r => r.start === secondRange.start && r.end === secondRange.end
        );
        if (!exists) {
          result[nextDay].push(secondRange);
        }
      }
    }
  }
  
  // Sort each day's ranges
  for (const day of Object.keys(result)) {
    result[day].sort((a, b) => a.start.localeCompare(b.start));
  }
  
  return result;
};

/**
 * Round datetime to nearest 30-minute mark
 */
export const roundToNearest30Min = (dt: Date): Date => {
  const copy = new Date(dt);
  const minutes = copy.getUTCMinutes();
  
  if (minutes < 15) {
    copy.setUTCMinutes(0);
  } else if (minutes < 45) {
    copy.setUTCMinutes(30);
  } else {
    copy.setUTCHours(copy.getUTCHours() + 1);
    copy.setUTCMinutes(0);
  }
  copy.setUTCSeconds(0);
  copy.setUTCMilliseconds(0);
  
  return copy;
};

/**
 * Validate slot datetimes
 * - All must be future
 * - All must be rounded to 30-min
 * - Max 10 slots
 */
export const validateSlotDatetimes = (
  datetimes: string[],
  now: Date = new Date()
): { valid: boolean; error?: string } => {
  if (!Array.isArray(datetimes) || datetimes.length === 0) {
    return { valid: false, error: 'At least one slot datetime required' };
  }

  for (const dt of datetimes) {
    const dateObj = new Date(dt);
    if (isNaN(dateObj.getTime())) {
      return { valid: false, error: `Invalid datetime format: ${dt}` };
    }

    if (dateObj <= now) {
      return { valid: false, error: `Slot must be in the future: ${dt}` };
    }

    const rounded = roundToNearest30Min(dateObj);
    const diff = Math.abs(dateObj.getTime() - rounded.getTime());
    if (diff > 60000) { // More than 1 minute difference = not rounded to 30min
      return { valid: false, error: `Slot not rounded to 30-min: ${dt}` };
    }
  }

  return { valid: true };
};

/**
 * Create a schedule proposal for a phase-engine series.
 *
 * Authorization, slot validation, and cross-proposal conflict detection happen
 * before quota is reserved. Once the proposal row exists, the schedule action
 * remains counted even if a later slot or confirmation insert fails because the
 * externally visible scheduling mutation has already persisted.
 */
export const createSeriesProposal = async (
  seriesId: string,
  proposedByUserId: string,
  slotDatetimes: string[],
  notes?: string
): Promise<{ proposalId: string; slotsCreated: number }> => {
  const validation = validateSlotDatetimes(slotDatetimes);
  if (!validation.valid) throw new Error(validation.error);
  if (notes && notes.length > 500) throw new Error('Notes cannot exceed 500 characters');

  const context = await query(
    `SELECT series.id, phases.tournament_id, tournaments.tournament_mode
     FROM tournament_series series
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     JOIN tournaments ON tournaments.id = phases.tournament_id
     WHERE series.id = ?`,
    [seriesId]
  );
  if (!context.rows?.length) throw new Error('Tournament series not found');

  const { tournament_id: tournamentId } = context.rows[0];
  const participantUsers = await query(
    `SELECT DISTINCT tp.user_id
     FROM tournament_series_slots slots
     JOIN tournament_entries entries ON entries.id = slots.resolved_entry_id
     JOIN tournament_participants tp
       ON tp.id = entries.participant_id OR tp.team_id = entries.team_id
     WHERE slots.series_id = ? AND slots.resolved_entry_id IS NOT NULL
       AND tp.tournament_id = ? AND tp.participation_status = 'accepted'`,
    [seriesId, tournamentId]
  );
  const participantUserIds = (participantUsers.rows || []).map((row: any) => row.user_id);
  if (!participantUserIds.includes(proposedByUserId)) {
    throw new Error('You are not a participant in this series');
  }
  await assertSlotsAreAvailable(participantUserIds, slotDatetimes);

  const maxSlotDatetime = new Date(Math.max(...slotDatetimes.map(dt => new Date(dt).getTime())));
  const proposalId = uuidv4();
  const rateLimitEventId = await consumeUserActionRateLimit(proposedByUserId, 'tournament_schedule');
  let result;
  try {
    result = await query(
      `INSERT INTO match_schedule_proposals
         (id, tournament_series_id, proposed_by_user_id, proposed_at, status,
          notes, expires_at, challenge_mode, challenged_user_id)
       VALUES (?, ?, ?, NOW(), 'pending', ?, ?, 'tournament', NULL)`,
      [proposalId, seriesId, proposedByUserId, notes || null,
        new Date(maxSlotDatetime.getTime() + 7 * 24 * 60 * 60 * 1000)]
    );
  } catch (error) {
    await releaseUserActionRateLimit(rateLimitEventId, proposedByUserId, 'tournament_schedule');
    throw error;
  }
  if (!result.rowCount) throw new Error('Failed to create proposal');

  for (const slotDatetime of slotDatetimes) {
    await query(
      `INSERT INTO match_schedule_slots
         (id, proposal_id, slot_datetime, slot_duration_minutes, status)
       VALUES (?, ?, ?, 30, 'pending')`,
      [uuidv4(), proposalId, roundToNearest30Min(new Date(slotDatetime))]
    );
  }
  await query(
    `INSERT INTO match_schedule_confirmations (id, proposal_id, user_id, confirmed_at)
     VALUES (?, ?, ?, NOW())`,
    [uuidv4(), proposalId, proposedByUserId]
  );
  return { proposalId, slotsCreated: slotDatetimes.length };
};

export const getSeriesProposal = async (seriesId: string) => {
  const proposalResult = await query(
    `SELECT id, proposed_by_user_id, proposed_at, status, notes
     FROM match_schedule_proposals
     WHERE tournament_series_id = ?
       AND status IN ('pending', 'confirmed')
       AND challenge_mode = 'tournament'
     LIMIT 1`,
    [seriesId]
  );
  if (!proposalResult.rows?.length) return null;
  const proposal = proposalResult.rows[0];
  const slotsResult = await query(
    `SELECT id, slot_datetime, status
     FROM match_schedule_slots WHERE proposal_id = ? ORDER BY slot_datetime ASC`,
    [proposal.id]
  );
  const confirmationsResult = await query(
    `SELECT user_id, confirmed_at
     FROM match_schedule_confirmations WHERE proposal_id = ? ORDER BY confirmed_at ASC`,
    [proposal.id]
  );
  return {
    ...proposal,
    slots: slotsResult.rows || [],
    confirmations: confirmationsResult.rows || [],
  };
};

/**
/** Get participant availability for a phase-engine series. */
export const getParticipantsAvailability = async (
  _roundMatchId?: string,
  _matchId?: string,
  loggedInUserId?: string,
  seriesId?: string
): Promise<any> => {
  if (!seriesId) throw new Error('A tournament series is required');
  const participantsResult = await query(
    `SELECT DISTINCT u.id, u.nickname, u.timezone, u.availability_schedule
     FROM tournament_series_slots slots
     JOIN tournament_entries entries ON entries.id = slots.resolved_entry_id
     JOIN tournament_participants tp
       ON tp.id = entries.participant_id OR tp.team_id = entries.team_id
     JOIN users_extension u ON u.id = tp.user_id
     WHERE slots.series_id = ? AND slots.resolved_entry_id IS NOT NULL
       AND tp.participation_status = 'accepted'
     ORDER BY u.nickname`,
    [seriesId]
  );

  let viewingTimezone = 'UTC';
  if (loggedInUserId) {
    const userResult = await query('SELECT timezone FROM users_extension WHERE id = ?', [loggedInUserId]);
    viewingTimezone = userResult.rows?.[0]?.timezone || 'UTC';
  }
  const participants = (participantsResult.rows || []).map((participant: any) => {
    let availabilitySchedule = participant.availability_schedule
      ? (typeof participant.availability_schedule === 'string'
        ? JSON.parse(participant.availability_schedule)
        : participant.availability_schedule)
      : null;
    if (availabilitySchedule && participant.timezone !== viewingTimezone) {
      availabilitySchedule = convertAvailabilitySchedule(
        availabilitySchedule,
        participant.timezone,
        viewingTimezone,
        new Date()
      );
    }
    const offset = getTimezoneOffset(participant.timezone, viewingTimezone, new Date());
    return {
      ...participant,
      availability_schedule: availabilitySchedule,
      timezone_offset: offset >= 0 ? '+' + offset + 'h' : offset + 'h',
    };
  });
  return { participants, viewing_timezone: viewingTimezone };
};

// ============================================================================
// Proposal confirmation and mutation functions for phase-engine tournament series.

const getTournamentSeriesProposal = async (proposalId: string) => {
  const result = await query(
    `SELECT id, tournament_series_id, proposed_by_user_id, status, challenge_mode
     FROM match_schedule_proposals WHERE id = ?`,
    [proposalId]
  );
  const proposal = result.rows?.[0];
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.challenge_mode !== 'tournament' || !proposal.tournament_series_id) {
    throw new Error('This endpoint only supports tournament series proposals');
  }
  return proposal;
};

export const checkProposalFullyConfirmed = async (proposalId: string, seriesId: string): Promise<boolean> => {
  const proposal = await query(
    `SELECT proposed_by_user_id FROM match_schedule_proposals
     WHERE id = ? AND tournament_series_id = ? AND challenge_mode = 'tournament'`,
    [proposalId, seriesId]
  );
  if (!proposal.rows?.length) return false;
  const confirmations = await query(
    `SELECT COUNT(DISTINCT confirmations.user_id) AS count
     FROM match_schedule_confirmations confirmations
     JOIN tournament_series_slots slots ON slots.series_id = ?
     JOIN tournament_entries entries ON entries.id = slots.resolved_entry_id
     JOIN tournament_participants participants
       ON participants.id = entries.participant_id OR participants.team_id = entries.team_id
     WHERE confirmations.proposal_id = ?
       AND confirmations.user_id = participants.user_id
       AND confirmations.user_id <> ?`,
    [seriesId, proposalId, proposal.rows[0].proposed_by_user_id]
  );
  return Number(confirmations.rows?.[0]?.count || 0) > 0;
};

export const confirmProposal = async (proposalId: string, userId: string) => {
  const proposal = await getTournamentSeriesProposal(proposalId);
  const existing = await query(
    'SELECT id FROM match_schedule_confirmations WHERE proposal_id = ? AND user_id = ?',
    [proposalId, userId]
  );
  if (existing.rows?.length) throw new Error('User has already confirmed this proposal');
  await query(
    `INSERT INTO match_schedule_confirmations (id, proposal_id, user_id, confirmed_at)
     VALUES (?, ?, ?, NOW())`,
    [uuidv4(), proposalId, userId]
  );
  const fullyConfirmed = await checkProposalFullyConfirmed(proposalId, proposal.tournament_series_id);
  if (fullyConfirmed && proposal.status !== 'confirmed') {
    await query("UPDATE match_schedule_proposals SET status = 'confirmed' WHERE id = ?", [proposalId]);
    await query("UPDATE match_schedule_slots SET status = 'confirmed' WHERE proposal_id = ? AND status = 'pending'", [proposalId]);
  }
  return { success: true, fullyConfirmed };
};

export const confirmPartialSlots = async (
  proposalId: string,
  userId: string,
  confirmedSlotIds: string[]
): Promise<{ success: boolean; fullyConfirmed: boolean; confirmedSlots: any[] }> => {
  const proposal = await getTournamentSeriesProposal(proposalId);
  const existing = await query(
    'SELECT id FROM match_schedule_confirmations WHERE proposal_id = ? AND user_id = ?',
    [proposalId, userId]
  );
  if (existing.rows?.length) throw new Error('User has already confirmed this proposal');
  const slotsResult = await query(
    'SELECT id, status FROM match_schedule_slots WHERE proposal_id = ? ORDER BY slot_datetime ASC',
    [proposalId]
  );
  const slots = slotsResult.rows || [];
  if (!slots.length) throw new Error('No slots found for this proposal');
  const slotIds = new Set(confirmedSlotIds);
  for (const slotId of confirmedSlotIds) {
    if (!slots.some((slot: any) => slot.id === slotId)) throw new Error('Slot is not part of this proposal');
  }
  for (const slot of slots) {
    if (slot.status === 'pending') {
      await query('UPDATE match_schedule_slots SET status = ? WHERE id = ?', [slotIds.has(slot.id) ? 'confirmed' : 'rejected', slot.id]);
    }
  }
  await query(
    `INSERT INTO match_schedule_confirmations (id, proposal_id, user_id, confirmed_at)
     VALUES (?, ?, ?, NOW())`,
    [uuidv4(), proposalId, userId]
  );
  const updated = await query('SELECT id, status FROM match_schedule_slots WHERE proposal_id = ? ORDER BY slot_datetime ASC', [proposalId]);
  const confirmedCount = (updated.rows || []).filter((slot: any) => slot.status === 'confirmed').length;
  const rejectedCount = (updated.rows || []).filter((slot: any) => slot.status === 'rejected').length;
  const newStatus = rejectedCount === updated.rows.length ? 'rejected' : confirmedCount > 0 ? 'confirmed' : 'pending';
  await query('UPDATE match_schedule_proposals SET status = ? WHERE id = ?', [newStatus, proposalId]);
  const fullyConfirmed = newStatus === 'confirmed'
    ? await checkProposalFullyConfirmed(proposalId, proposal.tournament_series_id)
    : false;
  return { success: true, fullyConfirmed, confirmedSlots: updated.rows || [] };
};

export const cancelConfirmation = async (proposalId: string, userId: string) => {
  const proposal = await getTournamentSeriesProposal(proposalId);
  const result = await query(
    'DELETE FROM match_schedule_confirmations WHERE proposal_id = ? AND user_id = ?',
    [proposalId, userId]
  );
  if (!result.rowCount) throw new Error('User has not confirmed this proposal');
  if (proposal.status === 'confirmed') {
    await query("UPDATE match_schedule_proposals SET status = 'pending' WHERE id = ?", [proposalId]);
    await query("UPDATE match_schedule_slots SET status = 'pending' WHERE proposal_id = ? AND status = 'confirmed'", [proposalId]);
  }
  return { success: true };
};

/**
 * Reject an active tournament schedule and create its replacement in the
 * opposite direction. The actor must not be the current proposer. The complete
 * operation consumes one tournament-schedule action before the first write so
 * concurrent counter-proposals cannot exceed the rolling user budget.
 */
export const rejectAndCounterPropose = async (
  proposalId: string,
  userId: string,
  newSlotDatetimes: string[],
  notes?: string
) => {
  const validation = validateSlotDatetimes(newSlotDatetimes);
  if (!validation.valid) throw new Error(validation.error);
  if (notes && notes.length > 500) throw new Error('Notes cannot exceed 500 characters');
  const original = await getTournamentSeriesProposal(proposalId);
  if (original.proposed_by_user_id === userId) throw new Error('Proposer cannot reject their own proposal');
  // Counter-proposals share the schedule action budget with initial proposals
  // and edits because all three can generate a new Discord notification.
  const rateLimitEventId = await consumeUserActionRateLimit(userId, 'tournament_schedule');
  try {
    await query("UPDATE match_schedule_proposals SET status = 'rejected' WHERE id = ?", [proposalId]);
  } catch (error) {
    await releaseUserActionRateLimit(rateLimitEventId, userId, 'tournament_schedule');
    throw error;
  }
  const counterProposalId = uuidv4();
  const maxSlotDatetime = new Date(Math.max(...newSlotDatetimes.map(dt => new Date(dt).getTime())));
  await query(
    `INSERT INTO match_schedule_proposals
       (id, tournament_series_id, proposed_by_user_id, proposed_at, status, notes, expires_at, challenge_mode, challenged_user_id)
     VALUES (?, ?, ?, NOW(), 'pending', ?, ?, 'tournament', NULL)`,
    [counterProposalId, original.tournament_series_id, userId, notes || null,
      new Date(maxSlotDatetime.getTime() + 7 * 24 * 60 * 60 * 1000)]
  );
  let slotsCreated = 0;
  for (const slotDatetime of newSlotDatetimes) {
    const result = await query(
      `INSERT INTO match_schedule_slots (id, proposal_id, slot_datetime, slot_duration_minutes, status)
       VALUES (?, ?, ?, 30, 'pending')`,
      [uuidv4(), counterProposalId, roundToNearest30Min(new Date(slotDatetime))]
    );
    slotsCreated += result.rowCount || 0;
  }
  await query(
    `INSERT INTO match_schedule_confirmations (id, proposal_id, user_id, confirmed_at)
     VALUES (?, ?, ?, NOW())`,
    [uuidv4(), counterProposalId, userId]
  );
  return { success: true, counterProposalId, slotsCreated };
};

export const rejectProposal = async (proposalId: string, userId: string, notes?: string): Promise<{ success: true }> => {
  if (notes && notes.length > 500) throw new Error('Notes cannot exceed 500 characters');
  const proposal = await getTournamentSeriesProposal(proposalId);
  if (proposal.proposed_by_user_id === userId) throw new Error('Proposer cannot reject their own proposal');
  if (!['pending', 'active'].includes(proposal.status)) throw new Error('Proposal is no longer active');
  await query(
    `UPDATE match_schedule_proposals SET status = 'rejected', notes = COALESCE(?, notes), updated_at = NOW()
     WHERE id = ?`,
    [notes || null, proposalId]
  );
  await query("UPDATE match_schedule_slots SET status = 'rejected' WHERE proposal_id = ? AND status = 'pending'", [proposalId]);
  return { success: true };
};

/**
 * Replace the slots of a tournament schedule owned by its proposer.
 *
 * An edit resets confirmations and consumes one tournament-schedule action.
 * Treating edits like creations closes the otherwise unlimited Discord-message
 * path where one proposal could be rewritten repeatedly without creating rows.
 */
export const modifyProposal = async (
  proposalId: string,
  userId: string,
  newSlotDatetimes: string[],
  notes?: string
) => {
  const validation = validateSlotDatetimes(newSlotDatetimes);
  if (!validation.valid) throw new Error(validation.error);
  if (notes && notes.length > 500) throw new Error('Notes cannot exceed 500 characters');
  const proposal = await getTournamentSeriesProposal(proposalId);
  if (proposal.proposed_by_user_id !== userId) throw new Error('Only proposer can modify proposal');
  // Editing is deliberately limited: without this reservation one persisted
  // proposal could be modified repeatedly to bypass creation-only throttling.
  const rateLimitEventId = await consumeUserActionRateLimit(userId, 'tournament_schedule');
  try {
    await query('DELETE FROM match_schedule_confirmations WHERE proposal_id = ?', [proposalId]);
  } catch (error) {
    await releaseUserActionRateLimit(rateLimitEventId, userId, 'tournament_schedule');
    throw error;
  }
  await query('DELETE FROM match_schedule_slots WHERE proposal_id = ?', [proposalId]);
  const maxSlotDatetime = new Date(Math.max(...newSlotDatetimes.map(dt => new Date(dt).getTime())));
  await query(
    `UPDATE match_schedule_proposals SET status = 'pending', notes = ?, expires_at = ? WHERE id = ?`,
    [notes || null, new Date(maxSlotDatetime.getTime() + 7 * 24 * 60 * 60 * 1000), proposalId]
  );
  let slotsCreated = 0;
  for (const slotDatetime of newSlotDatetimes) {
    const result = await query(
      `INSERT INTO match_schedule_slots (id, proposal_id, slot_datetime, slot_duration_minutes, status)
       VALUES (?, ?, ?, 30, 'pending')`,
      [uuidv4(), proposalId, roundToNearest30Min(new Date(slotDatetime))]
    );
    slotsCreated += result.rowCount || 0;
  }
  await query(
    `INSERT INTO match_schedule_confirmations (id, proposal_id, user_id, confirmed_at)
     VALUES (?, ?, ?, NOW())`,
    [uuidv4(), proposalId, userId]
  );
  return { success: true, slotsCreated };
};

export const cancelProposal = async (proposalId: string, userId: string) => {
  const proposal = await getTournamentSeriesProposal(proposalId);
  if (proposal.proposed_by_user_id !== userId) throw new Error('Only proposer can cancel proposal');
  await query('DELETE FROM match_schedule_confirmations WHERE proposal_id = ?', [proposalId]);
  await query('DELETE FROM match_schedule_slots WHERE proposal_id = ?', [proposalId]);
  await query('DELETE FROM match_schedule_proposals WHERE id = ?', [proposalId]);
  return { success: true };
};
