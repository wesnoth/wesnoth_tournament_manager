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

/**
 * Calculate timezone offset in hours between two timezones
 * Returns positive if toTz is ahead of fromTz, negative if behind
 */
const getTimezoneOffset = (fromTz: string, toTz: string): number => {
  try {
    // Create a test date (using a fixed date to avoid DST issues)
    const testDate = new Date('2025-01-15T12:00:00Z');
    
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: toTz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(testDate);
    const toHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    
    // UTC time is 12:00, so toTz hour tells us the offset
    // If toHour is 13, then toTz is UTC+1
    // If toHour is 11, then toTz is UTC-1
    const toOffset = toHour - 12;
    
    // Now get fromTz offset
    const formatter2 = new Intl.DateTimeFormat('en-US', {
      timeZone: fromTz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts2 = formatter2.formatToParts(testDate);
    const fromHour = parseInt(parts2.find(p => p.type === 'hour')?.value || '0');
    const fromOffset = fromHour - 12;
    
    // Difference: toOffset - fromOffset
    // Example: São Paulo (-3) vs Madrid (+1) = 1 - (-3) = +4 hours (Madrid is 4 hours ahead)
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
  toTz: string
): { day: string; ranges: TimeRange[] } => {
  try {
    const ranges: TimeRange[] = [];
    
    // Parse start and end times
    const [startHour, startMin] = timeRange.start.split(':').map(Number);
    const [endHour, endMin] = timeRange.end.split(':').map(Number);
    
    // Create a reference date in the participant's timezone
    // Use a date that won't hit DST transitions
    const referenceDate = new Date('2025-01-15T00:00:00Z');
    
    // We need to find what UTC time corresponds to "dayOfWeek HH:MM in fromTz"
    // Then convert that UTC time to toTz
    const daysMap: Record<string, number> = {
      monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
      friday: 4, saturday: 5, sunday: 6
    };
    
    const targetDayOfWeek = daysMap[dayOfWeek.toLowerCase()];
    const utcDayOfWeek = referenceDate.getUTCDay();
    const dayDiff = (targetDayOfWeek - utcDayOfWeek + 7) % 7;
    
    // Create start date in fromTz
    const startDateStr = new Date(referenceDate.getTime() + dayDiff * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    
    const startUTCStr = `${startDateStr}T${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}:00Z`;
    let startUTC = new Date(startUTCStr);
    
    const endUTCStr = `${startDateStr}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00Z`;
    let endUTC = new Date(endUTCStr);
    
    // Adjust for timezone differences
    // If we want "19:00 in São Paulo", we need to subtract São Paulo's UTC offset
    const offset = getTimezoneOffset('UTC', fromTz);
    startUTC = new Date(startUTC.getTime() - offset * 60 * 60 * 1000);
    endUTC = new Date(endUTC.getTime() - offset * 60 * 60 * 1000);
    
    // Now convert these UTC times to toTz
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: toTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const startParts = formatter.formatToParts(startUTC);
    const startToTzHour = parseInt(startParts.find(p => p.type === 'hour')?.value || '0');
    const startToTzMin = parseInt(startParts.find(p => p.type === 'minute')?.value || '0');
    const startToTzDay = startParts.find(p => p.type === 'day')?.value || '15';
    
    const endParts = formatter.formatToParts(endUTC);
    const endToTzHour = parseInt(endParts.find(p => p.type === 'hour')?.value || '0');
    const endToTzMin = parseInt(endParts.find(p => p.type === 'minute')?.value || '0');
    const endToTzDay = endParts.find(p => p.type === 'day')?.value || '15';
    
    const startDayOffset = parseInt(startToTzDay) - parseInt(startDateStr.split('-')[2]);
    const endDayOffset = parseInt(endToTzDay) - parseInt(startDateStr.split('-')[2]);
    
    // Handle day wraparound
    const startDay = (targetDayOfWeek + startDayOffset + 7) % 7;
    const endDay = (targetDayOfWeek + endDayOffset + 7) % 7;
    
    const daysReverseMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    const startDayName = daysReverseMap[startDay];
    const endDayName = daysReverseMap[endDay];
    
    const startTimeStr = `${String(startToTzHour).padStart(2, '0')}:${String(startToTzMin).padStart(2, '0')}`;
    const endTimeStr = `${String(endToTzHour).padStart(2, '0')}:${String(endToTzMin).padStart(2, '0')}`;
    
    if (startDayName === endDayName) {
      // Same day
      ranges.push({ start: startTimeStr, end: endTimeStr });
      return { day: startDayName, ranges };
    } else {
      // Spans two days
      ranges.push({ start: startTimeStr, end: '23:59' });
      ranges.push({ start: '00:00', end: endTimeStr });
      return { day: startDayName, ranges };
    }
  } catch (error) {
    console.warn(`Error converting time range:`, error);
    return { day: dayOfWeek, ranges: [timeRange] };
  }
};

/**
 * Convert entire availability schedule from one timezone to another
 */
const convertAvailabilitySchedule = (
  schedule: AvailabilitySchedule,
  fromTz: string,
  toTz: string
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
      const { day: resultDay, ranges: resultRanges } = convertTimeRangeToTimezone(
        day,
        range,
        fromTz,
        toTz
      );
      
      for (const resultRange of resultRanges) {
        // Avoid duplicates
        const exists = result[resultDay].some(
          r => r.start === resultRange.start && r.end === resultRange.end
        );
        if (!exists) {
          result[resultDay].push(resultRange);
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

  // 1. Mark any previous active proposals as superseded
  await query(
    `UPDATE match_schedule_proposals 
     SET status = 'superseded' 
     WHERE tournament_round_match_id = ? AND status = 'active' AND proposed_by_user_id = ?`,
    [tournamentRoundMatchId, proposedByUserId]
  );

  // 2. Create new proposal
  const result = await query(
    `INSERT INTO match_schedule_proposals 
      (id, tournament_round_match_id, proposed_by_user_id, proposed_at, status, notes)
     VALUES (?, ?, ?, ?, 'active', ?)`,
    [proposalId, tournamentRoundMatchId, proposedByUserId, now, notes || null]
  );

  if (!result.rowCount) {
    throw new Error('Failed to create proposal');
  }

  // 3. Create slots
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

  // 1. Mark previous active proposals as superseded
  await query(
    `UPDATE match_schedule_proposals 
     SET status = 'superseded' 
     WHERE tournament_match_id = ? AND status = 'active' AND proposed_by_user_id = ?`,
    [tournamentMatchId, proposedByUserId]
  );

  // 2. Create proposal
  const result = await query(
    `INSERT INTO match_schedule_proposals 
      (id, tournament_match_id, proposed_by_user_id, proposed_at, status, notes)
     VALUES (?, ?, ?, ?, 'active', ?)`,
    [proposalId, tournamentMatchId, proposedByUserId, now, notes || null]
  );

  if (!result.rowCount) {
    throw new Error('Failed to create proposal');
  }

  // 3. Create slots
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

  return { proposalId, slotsCreated };
};

/**
 * Confirm slots for a proposal
 * For 1v1: Both players must confirm = slot confirmed
 * For 2v2: ≥1 player per team must confirm = slot confirmed
 */
export const confirmSlots = async (
  slotIds: string[],
  userId: string,
  teamId?: string
): Promise<{ slotsConfirmed: number; fullyConfirmedSlots: string[] }> => {
  if (!Array.isArray(slotIds) || slotIds.length === 0) {
    throw new Error('At least one slot ID required');
  }

  const fullyConfirmedSlots: string[] = [];

  // 1. Insert confirmations for each slot
  for (const slotId of slotIds) {
    const confirmationId = uuidv4();
    
    // Check if slot exists and get proposal info
    const slotResult = await query(
      `SELECT mss.id, mss.proposal_id, mss.status, msp.tournament_round_match_id, msp.tournament_match_id
       FROM match_schedule_slots mss
       JOIN match_schedule_proposals msp ON mss.proposal_id = msp.id
       WHERE mss.id = ?`,
      [slotId]
    );

    if (!slotResult.rows || slotResult.rows.length === 0) {
      console.warn(`[confirmSlots] Slot not found: ${slotId}`);
      continue;
    }

    const slot = slotResult.rows[0];

    // Insert confirmation
    try {
      await query(
        `INSERT INTO match_schedule_confirmations 
          (id, slot_id, user_id, team_id, confirmed_at)
         VALUES (?, ?, ?, ?, ?)`,
        [confirmationId, slotId, userId, teamId || null, new Date()]
      );

      // Check if slot is fully confirmed
      const isFullyConfirmed = await checkSlotFullyConfirmed(
        slotId,
        slot.tournament_round_match_id,
        slot.tournament_match_id
      );

      if (isFullyConfirmed) {
        // Update slot status to confirmed
        await query(
          `UPDATE match_schedule_slots SET status = 'confirmed' WHERE id = ?`,
          [slotId]
        );
        
        fullyConfirmedSlots.push(slotId);
        
        // Mark proposal as resolved if all slots are confirmed
        const proposal = await query(
          `SELECT id FROM match_schedule_proposals WHERE id = 
            (SELECT proposal_id FROM match_schedule_slots WHERE id = ?)`,
          [slotId]
        );
        
        if (proposal.rows && proposal.rows.length > 0) {
          const proposalId = proposal.rows[0].id;
          const allSlotsConfirmed = await checkAllSlotsInProposalConfirmed(proposalId);
          
          if (allSlotsConfirmed) {
            await query(
              `UPDATE match_schedule_proposals SET status = 'resolved' WHERE id = ?`,
              [proposalId]
            );
          }
        }
      }
    } catch (error) {
      console.error(`[confirmSlots] Error confirming slot ${slotId}:`, error);
    }
  }

  return {
    slotsConfirmed: slotIds.length,
    fullyConfirmedSlots
  };
};

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
    // Get active proposal
    const proposalResult = await query(
      `SELECT id, proposed_by_user_id, proposed_at, status, notes
       FROM match_schedule_proposals
       WHERE tournament_round_match_id = ? AND status = 'active'
       LIMIT 1`,
      [roundMatchId]
    );

    if (!proposalResult.rows || proposalResult.rows.length === 0) {
      return null;
    }

    const proposal = proposalResult.rows[0];

    // Get slots
    const slotsResult = await query(
      `SELECT id, slot_datetime, status
       FROM match_schedule_slots
       WHERE proposal_id = ?
       ORDER BY slot_datetime ASC`,
      [proposal.id]
    );

    const slots = slotsResult.rows || [];

    // Get confirmations for each slot
    const confirmations: any = {};
    for (const slot of slots) {
      const confirmResult = await query(
        `SELECT user_id, team_id, confirmed_at
         FROM match_schedule_confirmations
         WHERE slot_id = ?`,
        [slot.id]
      );
      confirmations[slot.id] = confirmResult.rows || [];
    }

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
    const proposalResult = await query(
      `SELECT id, proposed_by_user_id, proposed_at, status, notes
       FROM match_schedule_proposals
       WHERE tournament_match_id = ? AND status = 'active'
       LIMIT 1`,
      [matchId]
    );

    if (!proposalResult.rows || proposalResult.rows.length === 0) {
      return null;
    }

    const proposal = proposalResult.rows[0];

    const slotsResult = await query(
      `SELECT id, slot_datetime, status
       FROM match_schedule_slots
       WHERE proposal_id = ?
       ORDER BY slot_datetime ASC`,
      [proposal.id]
    );

    const slots = slotsResult.rows || [];

    const confirmations: any = {};
    for (const slot of slots) {
      const confirmResult = await query(
        `SELECT user_id, team_id, confirmed_at
         FROM match_schedule_confirmations
         WHERE slot_id = ?`,
        [slot.id]
      );
      confirmations[slot.id] = confirmResult.rows || [];
    }

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
          viewingTimezone
        );
      }
      
      // Calculate offset in hours
      const offset = getTimezoneOffset(p.timezone, viewingTimezone);
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
