/**
 * Timezone and availability utilities for scheduling system
 */

import { IANA_TIMEZONES } from '../constants/timezones.js';

/**
 * List of valid IANA timezones
 * Combines Node.js Intl API supported timezones with complete IANA list for broader compatibility
 */
const VALID_TIMEZONES: string[] = (() => {
  const timezones = new Set<string>(IANA_TIMEZONES);
  
  try {
    // Add timezones from Node.js Intl API
    const intlTimezones = (Intl as any).supportedValuesOf('timeZone') || [];
    intlTimezones.forEach((tz: string) => timezones.add(tz));
  } catch {
    // If Intl API fails, we still have the complete IANA list
  }
  
  return Array.from(timezones);
})();

/**
 * Validate IANA timezone string
 */
export function validateTimezone(tz: string): boolean {
  return VALID_TIMEZONES.includes(tz);
}

/**
 * Availability range: { start: "HH:00" or "HH:30", end: "HH:00" or "HH:30" }
 */
export interface TimeRange {
  start: string;
  end: string;
}

/**
 * Availability schedule: object with day keys mapping to array of time ranges
 */
export interface AvailabilitySchedule {
  monday?: TimeRange[];
  tuesday?: TimeRange[];
  wednesday?: TimeRange[];
  thursday?: TimeRange[];
  friday?: TimeRange[];
  saturday?: TimeRange[];
  sunday?: TimeRange[];
}

/**
 * Validate time string format (HH:00 or HH:30)
 */
function isValidTimeFormat(time: string): boolean {
  const regex = /^([0-1][0-9]|2[0-3]):(00|30)$/;
  return regex.test(time);
}

/**
 * Validate availability schedule object
 */
export function validateAvailabilitySchedule(schedule: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!schedule || typeof schedule !== 'object') {
    errors.push('Availability schedule must be an object');
    return { valid: false, errors };
  }

  const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const usedDays = Object.keys(schedule);

  for (const day of usedDays) {
    if (!validDays.includes(day)) {
      errors.push(`Invalid day key: ${day}`);
      continue;
    }

    const ranges = schedule[day];
    if (!Array.isArray(ranges)) {
      errors.push(`${day} must be an array of time ranges`);
      continue;
    }

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];

      if (!range.start || !range.end) {
        errors.push(`${day}[${i}]: start and end times are required`);
        continue;
      }

      if (!isValidTimeFormat(range.start)) {
        errors.push(`${day}[${i}]: start time must be HH:00 or HH:30`);
      }

      if (!isValidTimeFormat(range.end)) {
        errors.push(`${day}[${i}]: end time must be HH:00 or HH:30`);
      }

      const [startHour, startMin] = range.start.split(':').map(Number);
      const [endHour, endMin] = range.end.split(':').map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      if (startMinutes >= endMinutes) {
        errors.push(`${day}[${i}]: start time must be before end time`);
      }
    }

    // Check for overlapping ranges
    const ranges_sorted = ranges
      .map((r: TimeRange) => ({
        start: parseInt(r.start.replace(':', ''), 10),
        end: parseInt(r.end.replace(':', ''), 10),
      }))
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < ranges_sorted.length - 1; i++) {
      if (ranges_sorted[i].end > ranges_sorted[i + 1].start) {
        errors.push(`${day}: overlapping time ranges detected`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Round datetime to nearest 30-minute mark
 * @param dt Date to round
 * @returns Date rounded to HH:00 or HH:30
 */
export function roundToNearest30Min(dt: Date): Date {
  const minutes = dt.getMinutes();
  const rounded = new Date(dt);

  if (minutes < 15) {
    rounded.setMinutes(0);
  } else if (minutes < 45) {
    rounded.setMinutes(30);
  } else {
    rounded.setHours(rounded.getHours() + 1);
    rounded.setMinutes(0);
  }

  rounded.setSeconds(0);
  rounded.setMilliseconds(0);
  return rounded;
}

/**
 * Get default timezone from system or fallback to UTC
 */
export function getDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
