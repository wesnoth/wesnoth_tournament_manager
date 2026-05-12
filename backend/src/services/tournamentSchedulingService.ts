import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { validateTimezone, validateAvailabilitySchedule } from '../utils/timezoneUtils.js';

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

  if (datetimes.length > 10) {
    return { valid: false, error: 'Maximum 10 slots per proposal' };
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
 * Create a schedule proposal at round_match level
 */
export const createRoundMatchProposal = async (
  tournamentRoundMatchId: string,
  proposedByUserId: string,
  slotDatetimes: string[],
  notes?: string
): Promise<{ proposalId: string; slotsCreated: number }> => {
  // Validate inputs
  const validation = validateSlotDatetimes(slotDatetimes);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (notes && notes.length > 500) {
    throw new Error('Notes cannot exceed 500 characters');
  }

  const proposalId = uuidv4();
  const now = new Date();

  // Get tournament info and proposer's team (if team tournament)
  const matchResult = await query(
    `SELECT trm.tournament_id, t.tournament_mode 
     FROM tournament_round_matches trm
     JOIN tournaments t ON t.id = trm.tournament_id
     WHERE trm.id = ?`,
    [tournamentRoundMatchId]
  );

  if (!matchResult.rows || matchResult.rows.length === 0) {
    throw new Error('Tournament round match not found');
  }

  const { tournament_id, tournament_mode } = matchResult.rows[0];

  let proposerTeamId: string | null = null;
  if (tournament_mode === 'team') {
    // Get proposer's team
    const teamResult = await query(
      `SELECT team_id FROM tournament_participants 
       WHERE tournament_id = ? AND user_id = ? LIMIT 1`,
      [tournament_id, proposedByUserId]
    );

    if (teamResult.rows && teamResult.rows.length > 0) {
      proposerTeamId = teamResult.rows[0].team_id;
    }
  }

  // 1. Mark any previous active proposals as superseded
  await query(
    `UPDATE match_schedule_proposals 
     SET status = 'superseded' 
     WHERE tournament_round_match_id = ? AND status = 'active' AND proposed_by_user_id = ?`,
    [tournamentRoundMatchId, proposedByUserId]
  );

  // 2. Calculate expires_at: MAX(slot_datetime) + 7 days
  const maxSlotDatetime = new Date(Math.max(...slotDatetimes.map(dt => new Date(dt).getTime())));
  const expiresAt = new Date(maxSlotDatetime.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 3. Create new proposal
  const result = await query(
    `INSERT INTO match_schedule_proposals 
      (id, tournament_round_match_id, proposed_by_user_id, proposed_at, status, notes, expires_at, user_id)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [proposalId, tournamentRoundMatchId, proposedByUserId, now, notes || null, expiresAt, proposedByUserId]
  );

  if (!result.rowCount) {
    throw new Error('Failed to create proposal');
  }

  // 4. Create slots
  let slotsCreated = 0;
  const slotIds: string[] = [];
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
      slotIds.push(slotId);
    }
  }

  // 5. Insert one confirmation at proposal level (proposer auto-confirms their own proposal)
  if (slotsCreated > 0) {
    const confirmationId = uuidv4();
    try {
      await query(
        `INSERT INTO match_schedule_confirmations 
          (id, proposal_id, user_id, confirmed_at)
         VALUES (?, ?, ?, NOW())`,
        [confirmationId, proposalId, proposedByUserId]
      );
    } catch (error) {
      console.warn(`[createRoundMatchProposal] Failed to insert proposer confirmation:`, error);
    }
  }

  // 5. Update tournament_round_matches to reflect pending scheduling
  if (slotsCreated > 0) {
    const firstSlot = new Date(slotDatetimes[0]);
    const roundedFirstSlot = roundToNearest30Min(firstSlot);
    
    await query(
      `UPDATE tournament_round_matches 
       SET scheduled_status = 'pending_confirmation', 
           scheduled_datetime = ?,
           scheduled_by_player_id = ?
       WHERE id = ?`,
      [roundedFirstSlot, proposedByUserId, tournamentRoundMatchId]
    );
  }

  return { proposalId, slotsCreated };
};

/**
 * Create a schedule proposal at match level (single game)
 */
export const createMatchProposal = async (
  tournamentMatchId: string,
  proposedByUserId: string,
  slotDatetimes: string[],
  notes?: string
): Promise<{ proposalId: string; slotsCreated: number }> => {
  const validation = validateSlotDatetimes(slotDatetimes);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  if (notes && notes.length > 500) {
    throw new Error('Notes cannot exceed 500 characters');
  }

  const proposalId = uuidv4();
  const now = new Date();

  // Get tournament info and proposer's team (if team tournament)
  const matchInfo = await query(
    `SELECT tm.tournament_id, t.tournament_mode 
     FROM tournament_matches tm
     JOIN tournaments t ON t.id = tm.tournament_id
     WHERE tm.id = ?`,
    [tournamentMatchId]
  );

  if (!matchInfo.rows || matchInfo.rows.length === 0) {
    throw new Error('Tournament match not found');
  }

  const { tournament_id, tournament_mode } = matchInfo.rows[0];

  let proposerTeamId: string | null = null;
  if (tournament_mode === 'team') {
    // Get proposer's team
    const teamResult = await query(
      `SELECT team_id FROM tournament_participants 
       WHERE tournament_id = ? AND user_id = ? LIMIT 1`,
      [tournament_id, proposedByUserId]
    );

    if (teamResult.rows && teamResult.rows.length > 0) {
      proposerTeamId = teamResult.rows[0].team_id;
    }
  }

  // 1. Mark previous active proposals as superseded
  await query(
    `UPDATE match_schedule_proposals 
     SET status = 'superseded' 
     WHERE tournament_match_id = ? AND status = 'active' AND proposed_by_user_id = ?`,
    [tournamentMatchId, proposedByUserId]
  );

  // 2. Calculate expires_at: MAX(slot_datetime) + 7 days
  const maxSlotDatetime = new Date(Math.max(...slotDatetimes.map(dt => new Date(dt).getTime())));
  const expiresAt = new Date(maxSlotDatetime.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 3. Create proposal (proponent doesn't auto-confirm, just creates it)
  const result = await query(
    `INSERT INTO match_schedule_proposals 
      (id, tournament_match_id, proposed_by_user_id, proposed_at, status, notes, expires_at, user_id)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [proposalId, tournamentMatchId, proposedByUserId, now, notes || null, expiresAt, proposedByUserId]
  );

  if (!result.rowCount) {
    throw new Error('Failed to create proposal');
  }

  // 4. Create slots
  let slotsCreated = 0;
  const slotIds: string[] = [];
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
      slotIds.push(slotId);
    }
  }

  // 5. Get the tournament_round_match_id and update tournament_round_matches
  const matchResult = await query(
    `SELECT tournament_round_match_id FROM tournament_matches WHERE id = ?`,
    [tournamentMatchId]
  );

  if (matchResult.rows && matchResult.rows.length > 0 && matchResult.rows[0].tournament_round_match_id && slotsCreated > 0) {
    const roundMatchId = matchResult.rows[0].tournament_round_match_id;
    const firstSlot = new Date(slotDatetimes[0]);
    const roundedFirstSlot = roundToNearest30Min(firstSlot);
    
    await query(
      `UPDATE tournament_round_matches 
       SET scheduled_status = 'pending_confirmation', 
           scheduled_datetime = ?,
           scheduled_by_player_id = ?
       WHERE id = ?`,
      [roundedFirstSlot, proposedByUserId, roundMatchId]
    );
  }

  return { proposalId, slotsCreated };
};

/**
 * Confirm slots for a proposal
 * For 1v1: Both players must confirm = slot confirmed
 * For 2v2: ≥1 player per team must confirm = slot confirmed
 */
/**
 * Check if a slot has enough confirmations to be considered "fully confirmed"
 * For 1v1: Both players must have confirmed
 * For 2v2: ≥1 player per team must have confirmed
 */
const checkSlotFullyConfirmed = async (
  slotId: string,
  roundMatchId?: string,
  matchId?: string
): Promise<boolean> => {
  try {
    // Get match info to determine if 1v1 or 2v2
    let matchResult;
    
    if (roundMatchId) {
      matchResult = await query(
        `SELECT player1_id, player2_id FROM tournament_round_matches WHERE id = ?`,
        [roundMatchId]
      );
    } else if (matchId) {
      matchResult = await query(
        `SELECT player1_id, player2_id FROM tournament_matches WHERE id = ?`,
        [matchId]
      );
    }

    if (!matchResult?.rows || matchResult.rows.length === 0) {
      return false;
    }

    const match = matchResult.rows[0];
    
    // Get distinct teams that have confirmed
    const confirmResult = await query(
      `SELECT COUNT(DISTINCT COALESCE(team_id, user_id)) as unique_confirmers,
              COUNT(DISTINCT team_id) as teams_confirmed
       FROM match_schedule_confirmations 
       WHERE slot_id = ?`,
      [slotId]
    );

    if (!confirmResult.rows || confirmResult.rows.length === 0) {
      return false;
    }

    const { teams_confirmed, unique_confirmers } = confirmResult.rows[0];

    // For 2v2: need confirmations from 2 different teams
    if (teams_confirmed >= 2) {
      return true;
    }

    // For 1v1: need both players
    if (unique_confirmers >= 2) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('[checkSlotFullyConfirmed] Error:', error);
    return false;
  }
};

/**
 * Check if all slots in a proposal are confirmed
 */
const checkAllSlotsInProposalConfirmed = async (proposalId: string): Promise<boolean> => {
  try {
    const result = await query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
       FROM match_schedule_slots 
       WHERE proposal_id = ?`,
      [proposalId]
    );

    if (!result.rows || result.rows.length === 0) {
      return false;
    }

    const { total, confirmed } = result.rows[0];
    return total > 0 && total === confirmed;
  } catch (error) {
    console.error('[checkAllSlotsInProposalConfirmed] Error:', error);
    return false;
  }
};

/**
 * Get active proposal with slots and confirmations for a round match
 */
export const getRoundMatchProposal = async (roundMatchId: string) => {
  try {
    console.log('[getRoundMatchProposal] Fetching proposal for roundMatchId:', roundMatchId);
    
    // Get active proposal (status can be pending or confirmed)
    const proposalResult = await query(
      `SELECT id, proposed_by_user_id, proposed_at, status, notes
       FROM match_schedule_proposals
       WHERE tournament_round_match_id = ? AND status IN ('pending', 'confirmed')
       LIMIT 1`,
      [roundMatchId]
    );

    console.log('[getRoundMatchProposal] Query result rows:', proposalResult.rows?.length || 0);

    if (!proposalResult.rows || proposalResult.rows.length === 0) {
      console.log('[getRoundMatchProposal] No proposal found for roundMatchId:', roundMatchId);
      return null;
    }

    const proposal = proposalResult.rows[0];
    console.log('[getRoundMatchProposal] Found proposal:', proposal.id, 'Status:', proposal.status);

    // Get slots
    const slotsResult = await query(
      `SELECT id, slot_datetime, status
       FROM match_schedule_slots
       WHERE proposal_id = ?
       ORDER BY slot_datetime ASC`,
      [proposal.id]
    );

    const slots = slotsResult.rows || [];
    console.log('[getRoundMatchProposal] Found', slots.length, 'slots');

    // Get confirmations for the proposal
    const confirmResult = await query(
      `SELECT user_id, confirmed_at
       FROM match_schedule_confirmations
       WHERE proposal_id = ?
       ORDER BY confirmed_at ASC`,
      [proposal.id]
    );
    const confirmations = confirmResult.rows || [];
    console.log('[getRoundMatchProposal] Found', confirmations.length, 'confirmations');

    return {
      ...proposal,
      slots,
      confirmations
    };
  } catch (error) {
    console.error('[getRoundMatchProposal] Error:', error);
    throw error;
  }
};

/**
 * Get active proposal with slots and confirmations for a match
 */
export const getMatchProposal = async (matchId: string) => {
  try {
    console.log('[getMatchProposal] Fetching proposal for matchId:', matchId);
    
    const proposalResult = await query(
      `SELECT id, proposed_by_user_id, proposed_at, status, notes
       FROM match_schedule_proposals
       WHERE tournament_match_id = ? AND status IN ('pending', 'confirmed')
       LIMIT 1`,
      [matchId]
    );

    console.log('[getMatchProposal] Query result rows:', proposalResult.rows?.length || 0);

    if (!proposalResult.rows || proposalResult.rows.length === 0) {
      console.log('[getMatchProposal] No proposal found for matchId:', matchId);
      return null;
    }

    const proposal = proposalResult.rows[0];
    console.log('[getMatchProposal] Found proposal:', proposal.id, 'Status:', proposal.status);

    const slotsResult = await query(
      `SELECT id, slot_datetime, status
       FROM match_schedule_slots
       WHERE proposal_id = ?
       ORDER BY slot_datetime ASC`,
      [proposal.id]
    );

    const slots = slotsResult.rows || [];
    console.log('[getMatchProposal] Found', slots.length, 'slots');

    // Get confirmations for the proposal
    const confirmResult = await query(
      `SELECT user_id, confirmed_at
       FROM match_schedule_confirmations
       WHERE proposal_id = ?
       ORDER BY confirmed_at ASC`,
      [proposal.id]
    );
    const confirmations = confirmResult.rows || [];
    console.log('[getMatchProposal] Found', confirmations.length, 'confirmations');

    return {
      ...proposal,
      slots,
      confirmations
    };
  } catch (error) {
    console.error('[getMatchProposal] Error:', error);
    throw error;
  }
};

/**
 * Get all participants' availability for a round match or match
 */
export const getParticipantsAvailability = async (
  roundMatchId?: string,
  matchId?: string,
  loggedInUserId?: string
): Promise<any> => {
  try {
    let participantsResult;
    
    if (roundMatchId) {
      // First, check if this is a team tournament
      const matchTypeResult = await query(
        `SELECT trm.player1_id, trm.player2_id, t.tournament_mode
         FROM tournament_round_matches trm
         JOIN tournaments t ON trm.tournament_id = t.id
         WHERE trm.id = ?`,
        [roundMatchId]
      );

      if (!matchTypeResult.rows || matchTypeResult.rows.length === 0) {
        throw new Error(`tournament_round_match ${roundMatchId} not found`);
      }

      const matchData = matchTypeResult.rows[0];
      const isTeamTournament = matchData.tournament_mode === 'team';

      if (isTeamTournament) {
        // Team tournament: get all players from both teams
        participantsResult = await query(
          `SELECT DISTINCT u.id, u.nickname, u.timezone, u.availability_schedule
           FROM users_extension u
           JOIN tournament_participants tp ON u.id = tp.user_id
           WHERE tp.team_id IN (
             SELECT player1_id FROM tournament_round_matches WHERE id = ?
             UNION
             SELECT player2_id FROM tournament_round_matches WHERE id = ?
           )
           ORDER BY u.nickname`,
          [roundMatchId, roundMatchId]
        );
      } else {
        // 1v1 tournament: get both players
        participantsResult = await query(
          `SELECT DISTINCT u.id, u.nickname, u.timezone, u.availability_schedule
           FROM users_extension u
           JOIN tournament_round_matches trm ON (u.id = trm.player1_id OR u.id = trm.player2_id)
           WHERE trm.id = ?`,
          [roundMatchId]
        );
      }
    } else if (matchId) {
      // For tournament_matches (individual games)
      const matchTypeResult = await query(
        `SELECT tm.player1_id, tm.player2_id, t.tournament_mode
         FROM tournament_matches tm
         JOIN tournaments t ON tm.tournament_id = t.id
         WHERE tm.id = ?`,
        [matchId]
      );

      if (!matchTypeResult.rows || matchTypeResult.rows.length === 0) {
        throw new Error(`tournament_match ${matchId} not found`);
      }

      const matchData = matchTypeResult.rows[0];
      const isTeamTournament = matchData.tournament_mode === 'team';

      if (isTeamTournament) {
        // Team tournament: get all players from both teams
        participantsResult = await query(
          `SELECT DISTINCT u.id, u.nickname, u.timezone, u.availability_schedule
           FROM users_extension u
           JOIN tournament_participants tp ON u.id = tp.user_id
           WHERE tp.team_id IN (
             SELECT player1_id FROM tournament_matches WHERE id = ?
             UNION
             SELECT player2_id FROM tournament_matches WHERE id = ?
           )
           ORDER BY u.nickname`,
          [matchId, matchId]
        );
      } else {
        // 1v1 tournament: get both players
        participantsResult = await query(
          `SELECT DISTINCT u.id, u.nickname, u.timezone, u.availability_schedule
           FROM users_extension u
           JOIN tournament_matches tm ON (u.id = tm.player1_id OR u.id = tm.player2_id)
           WHERE tm.id = ?`,
          [matchId]
        );
      }
    } else {
      throw new Error('Either roundMatchId or matchId must be provided');
    }

    // Get viewing timezone from logged-in user if available
    let viewingTimezone = 'UTC';
    if (loggedInUserId) {
      const userResult = await query(
        `SELECT timezone FROM users_extension WHERE id = ?`,
        [loggedInUserId]
      );
      if (userResult.rows && userResult.rows.length > 0) {
        viewingTimezone = userResult.rows[0].timezone || 'UTC';
      }
    }

    console.log(`[getParticipantsAvailability] LoggedInUserId: ${loggedInUserId}, ViewingTimezone: ${viewingTimezone}`);

    const participants = participantsResult.rows || [];
    
    // Parse JSON availability_schedule and convert to viewing timezone
    const formattedParticipants = participants.map(p => {
      let availabilitySchedule = p.availability_schedule 
        ? (typeof p.availability_schedule === 'string' 
          ? JSON.parse(p.availability_schedule) 
          : p.availability_schedule)
        : null;
      
      // Convert availability to viewing timezone
      if (availabilitySchedule && p.timezone !== viewingTimezone) {
        availabilitySchedule = convertAvailabilitySchedule(
          availabilitySchedule,
          p.timezone,
          viewingTimezone,
          new Date()  // Use current date for DST awareness
        );
      }
      
      // Calculate offset in hours using current date for DST awareness
      const offset = getTimezoneOffset(p.timezone, viewingTimezone, new Date());
      const offsetStr = offset >= 0 ? `+${offset}h` : `${offset}h`;
      
      return {
        ...p,
        availability_schedule: availabilitySchedule,
        timezone_offset: offsetStr
      };
    });

    return {
      participants: formattedParticipants,
      viewing_timezone: viewingTimezone
    };
  } catch (error) {
    console.error('[getParticipantsAvailability] Error:', error);
    throw error;
  }
};

// ============================================================================
// NEW PROPOSAL CONFIRMATION FUNCTIONS (Phase 2)
// ============================================================================

/**
 * Confirm a proposal (set proposal_id confirmation, no slot-level)
 * Only one confirmation per (proposal_id, user_id) allowed
 */
export const confirmProposal = async (proposalId: string, userId: string) => {
  try {
    // 1. Check if user already confirmed
    const existing = await query(
      `SELECT id FROM match_schedule_confirmations 
       WHERE proposal_id = ? AND user_id = ?`,
      [proposalId, userId]
    );
    
    if (existing.rows && existing.rows.length > 0) {
      throw new Error('User has already confirmed this proposal');
    }
    
    // 2. Insert confirmation
    const confirmationId = uuidv4();
    await query(
      `INSERT INTO match_schedule_confirmations 
       (id, proposal_id, user_id, confirmed_at)
       VALUES (?, ?, ?, NOW())`,
      [confirmationId, proposalId, userId]
    );
    
    // 3. Get proposal details
    const proposal = await query(
      `SELECT tournament_round_match_id, proposed_by_user_id, status 
       FROM match_schedule_proposals WHERE id = ?`,
      [proposalId]
    );
    
    if (!proposal.rows || !proposal.rows.length) {
      throw new Error('Proposal not found');
    }
    
    // 4. Check if proposal is now fully confirmed
    const isFullyConfirmed = await checkProposalFullyConfirmed(
      proposalId,
      proposal.rows[0].tournament_round_match_id
    );
    
    if (isFullyConfirmed && proposal.rows[0].status !== 'confirmed') {
      // 5. Mark proposal and slots as confirmed
      await query(
        `UPDATE match_schedule_proposals SET status = 'confirmed' WHERE id = ?`,
        [proposalId]
      );
      
      await query(
        `UPDATE match_schedule_slots SET status = 'confirmed' WHERE proposal_id = ?`,
        [proposalId]
      );
      
      // 6. Update tournament_round_matches with first slot datetime
      const slots = await query(
        `SELECT slot_datetime FROM match_schedule_slots 
         WHERE proposal_id = ? ORDER BY slot_datetime ASC LIMIT 1`,
        [proposalId]
      );
      
      if (slots.rows && slots.rows.length > 0) {
        await query(
          `UPDATE tournament_round_matches 
           SET scheduled_datetime = ?, scheduled_status = 'confirmed', scheduled_confirmed_at = NOW()
           WHERE id = ?`,
          [slots.rows[0].slot_datetime, proposal.rows[0].tournament_round_match_id]
        );
      }
    }
    
    return { success: true, fullyConfirmed: isFullyConfirmed };
  } catch (error) {
    console.error('[confirmProposal] Error:', error);
    throw error;
  }
};

/**
 * Cancel your own confirmation on a proposal
 * Only allowed if you're the one who confirmed
 */
export const cancelConfirmation = async (proposalId: string, userId: string) => {
  try {
    // 1. Check that user has confirmed this proposal
    const confirmation = await query(
      `SELECT id FROM match_schedule_confirmations 
       WHERE proposal_id = ? AND user_id = ?`,
      [proposalId, userId]
    );
    
    if (!confirmation.rows || !confirmation.rows.length) {
      throw new Error('User has not confirmed this proposal');
    }
    
    // 2. Delete confirmation
    await query(
      `DELETE FROM match_schedule_confirmations 
       WHERE proposal_id = ? AND user_id = ?`,
      [proposalId, userId]
    );
    
    // 3. Get proposal status
    const proposal = await query(
      `SELECT status, tournament_round_match_id FROM match_schedule_proposals WHERE id = ?`,
      [proposalId]
    );
    
    if (proposal.rows && proposal.rows.length > 0 && proposal.rows[0].status === 'confirmed') {
      // 4. Reset to pending if was confirmed
      await query(
        `UPDATE match_schedule_proposals SET status = 'pending' WHERE id = ?`,
        [proposalId]
      );
      
      await query(
        `UPDATE match_schedule_slots SET status = 'pending' WHERE proposal_id = ?`,
        [proposalId]
      );
      
      // 5. Clear tournament_round_matches scheduling
      await query(
        `UPDATE tournament_round_matches 
         SET scheduled_datetime = NULL, scheduled_status = 'pending', scheduled_confirmed_at = NULL
         WHERE id = ?`,
        [proposal.rows[0].tournament_round_match_id]
      );
    }
    
    return { success: true };
  } catch (error) {
    console.error('[cancelConfirmation] Error:', error);
    throw error;
  }
};

/**
 * Reject proposal and counter-propose with new slots
 * Only the receiver (not proposer) can do this
 */
export const rejectAndCounterPropose = async (
  proposalId: string,
  userId: string,
  newSlotDatetimes: string[],
  notes?: string
) => {
  try {
    // 1. Validate inputs
    const validation = validateSlotDatetimes(newSlotDatetimes);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    if (notes && notes.length > 500) {
      throw new Error('Notes cannot exceed 500 characters');
    }
    
    // 2. Get original proposal
    const original = await query(
      `SELECT tournament_round_match_id, proposed_by_user_id, tournament_id 
       FROM match_schedule_proposals WHERE id = ?`,
      [proposalId]
    );
    
    if (!original.rows || !original.rows.length) {
      throw new Error('Proposal not found');
    }
    
    if (original.rows[0].proposed_by_user_id === userId) {
      throw new Error('Proposer cannot reject their own proposal');
    }
    
    // 3. Mark original as rejected
    await query(
      `UPDATE match_schedule_proposals SET status = 'rejected' WHERE id = ?`,
      [proposalId]
    );
    
    // 4. Create counter-proposal
    const counterProposalId = uuidv4();
    const maxSlotDatetime = new Date(Math.max(...newSlotDatetimes.map(dt => new Date(dt).getTime())));
    const expiresAt = new Date(maxSlotDatetime.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    await query(
      `INSERT INTO match_schedule_proposals 
       (id, tournament_round_match_id, proposed_by_user_id, proposed_at, status, notes, expires_at, user_id)
       VALUES (?, ?, ?, NOW(), 'pending', ?, ?, ?)`,
      [
        counterProposalId,
        original.rows[0].tournament_round_match_id,
        userId,
        notes || null,
        expiresAt,
        userId
      ]
    );
    
    // 5. Create new slots
    let slotsCreated = 0;
    for (const dtString of newSlotDatetimes) {
      const slotId = uuidv4();
      const roundedDt = roundToNearest30Min(new Date(dtString));
      
      const slotResult = await query(
        `INSERT INTO match_schedule_slots 
         (id, proposal_id, slot_datetime, slot_duration_minutes, status)
         VALUES (?, ?, ?, 30, 'pending')`,
        [slotId, counterProposalId, roundedDt]
      );
      
      if (slotResult.rowCount) {
        slotsCreated++;
      }
    }
    
    return { success: true, counterProposalId, slotsCreated };
  } catch (error) {
    console.error('[rejectAndCounterPropose] Error:', error);
    throw error;
  }
};

/**
 * Modify proposal (only proposer can do this)
 * Deletes old slots and creates new ones, resets confirmations
 */
export const modifyProposal = async (
  proposalId: string,
  userId: string,
  newSlotDatetimes: string[],
  notes?: string
) => {
  try {
    // 1. Validate inputs
    const validation = validateSlotDatetimes(newSlotDatetimes);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    if (notes && notes.length > 500) {
      throw new Error('Notes cannot exceed 500 characters');
    }
    
    // 2. Get proposal
    const proposal = await query(
      `SELECT proposed_by_user_id, tournament_round_match_id, status 
       FROM match_schedule_proposals WHERE id = ?`,
      [proposalId]
    );
    
    if (!proposal.rows || !proposal.rows.length) {
      throw new Error('Proposal not found');
    }
    
    if (proposal.rows[0].proposed_by_user_id !== userId) {
      throw new Error('Only proposer can modify proposal');
    }
    
    // 3. Delete old slots (CASCADE deletes confirmations)
    await query(
      `DELETE FROM match_schedule_slots WHERE proposal_id = ?`,
      [proposalId]
    );
    
    // 4. Reset proposal status to pending
    const maxSlotDatetime = new Date(Math.max(...newSlotDatetimes.map(dt => new Date(dt).getTime())));
    const expiresAt = new Date(maxSlotDatetime.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    await query(
      `UPDATE match_schedule_proposals 
       SET status = 'pending', notes = ?, expires_at = ?
       WHERE id = ?`,
      [notes || null, expiresAt, proposalId]
    );
    
    // 5. Create new slots
    let slotsCreated = 0;
    for (const dtString of newSlotDatetimes) {
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
    
    // 6. Reset tournament_round_matches
    await query(
      `UPDATE tournament_round_matches 
       SET scheduled_datetime = NULL, scheduled_status = 'pending', scheduled_confirmed_at = NULL
       WHERE id = ?`,
      [proposal.rows[0].tournament_round_match_id]
    );
    
    return { success: true, slotsCreated };
  } catch (error) {
    console.error('[modifyProposal] Error:', error);
    throw error;
  }
};

/**
 * Cancel a proposal (only proposer can do this)
 */
export const cancelProposal = async (proposalId: string, userId: string) => {
  try {
    // 1. Get proposal
    const proposal = await query(
      `SELECT proposed_by_user_id, tournament_round_match_id 
       FROM match_schedule_proposals WHERE id = ?`,
      [proposalId]
    );
    
    if (!proposal.rows || !proposal.rows.length) {
      throw new Error('Proposal not found');
    }
    
    if (proposal.rows[0].proposed_by_user_id !== userId) {
      throw new Error('Only proposer can cancel proposal');
    }
    
    // 2. Mark as cancelled
    await query(
      `UPDATE match_schedule_proposals 
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = ?`,
      [proposalId]
    );
    
    // 3. Mark slots as cancelled (soft cancel)
    await query(
      `UPDATE match_schedule_slots SET status = 'cancelled' WHERE proposal_id = ?`,
      [proposalId]
    );
    
    // 4. Reset tournament_round_matches
    await query(
      `UPDATE tournament_round_matches 
       SET scheduled_datetime = NULL, scheduled_status = 'pending', scheduled_confirmed_at = NULL
       WHERE id = ?`,
      [proposal.rows[0].tournament_round_match_id]
    );
    
    return { success: true };
  } catch (error) {
    console.error('[cancelProposal] Error:', error);
    throw error;
  }
};

/**
 * Check if proposal is fully confirmed
 * 1v1: needs confirmation from the OTHER player
 * Teams (2v2): needs at least 1 confirmation from the OTHER team
 */
export const checkProposalFullyConfirmed = async (
  proposalId: string,
  roundMatchId: string
): Promise<boolean> => {
  try {
    // 1. Get match details (player1_id and player2_id can be user UUIDs or team UUIDs)
    const match = await query(
      `SELECT trm.player1_id, trm.player2_id, t.tournament_mode
       FROM tournament_round_matches trm
       LEFT JOIN tournaments t ON trm.tournament_id = t.id
       WHERE trm.id = ?`,
      [roundMatchId]
    );
    
    if (!match.rows || !match.rows.length) {
      return false;
    }
    
    const m = match.rows[0];
    const is2v2 = m.tournament_mode === 'team';
    
    // 2. Get proposal proposer
    const proposal = await query(
      `SELECT proposed_by_user_id FROM match_schedule_proposals WHERE id = ?`,
      [proposalId]
    );
    
    if (!proposal.rows || !proposal.rows.length) {
      return false;
    }
    
    const proposedByUser = proposal.rows[0].proposed_by_user_id;
    
    if (!is2v2) {
      // 1v1: proposedByUser is player1 or player2, need OTHER player to confirm
      const otherPlayer = proposedByUser === m.player1_id ? m.player2_id : m.player1_id;
      
      const confirmations = await query(
        `SELECT COUNT(*) as count FROM match_schedule_confirmations
         WHERE proposal_id = ? AND user_id = ?`,
        [proposalId, otherPlayer]
      );
      
      return confirmations.rows && confirmations.rows[0].count > 0;
    } else {
      // 2v2: player1_id and player2_id are team UUIDs
      // Need at least 1 confirmation from the OTHER team
      const proposerTeam = proposedByUser === m.player1_id ? m.player1_id : m.player2_id;
      const otherTeam = proposerTeam === m.player1_id ? m.player2_id : m.player1_id;
      
      // Count confirmations from users in the other team
      const confirmations = await query(
        `SELECT COUNT(DISTINCT msc.user_id) as count
         FROM match_schedule_confirmations msc
         JOIN tournament_participants tp ON msc.user_id = tp.user_id
         WHERE msc.proposal_id = ? AND tp.team_id = ?`,
        [proposalId, otherTeam]
      );
      
      return confirmations.rows && confirmations.rows[0].count > 0;
    }
  } catch (error) {
    console.error('[checkProposalFullyConfirmed] Error:', error);
    return false;
  }
};
