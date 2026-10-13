/**
 * Utility functions for grouping schedule slots into contiguous time ranges
 * Mirrors the frontend logic from ScheduleProposalModal
 */

export interface TimeRange {
  start: Date;
  end: Date;
  hours: string; // Formatted as "HH:MM-HH:MM"
}

export interface DiscordTimezoneEntry {
  label: string;
  timezone: string;
}

/**
 * Group contiguous 30-minute slots into time ranges
 * Handles slot datetimes and merges adjacent slots into continuous ranges
 * 
 * @param slotDatetimes Array of ISO datetime strings (30-min slots)
 * @returns Array of time ranges with start, end, and formatted hours string
 */
export function groupSlotsIntoRanges(slotDatetimes: string[]): TimeRange[] {
  if (slotDatetimes.length === 0) return [];

  const sorted = slotDatetimes
    .map(dt => new Date(dt))
    .sort((a, b) => a.getTime() - b.getTime());

  const ranges: TimeRange[] = [];
  let currentStart = sorted[0];
  let currentEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const prevEnd = new Date(currentEnd);
    prevEnd.setMinutes(prevEnd.getMinutes() + 30); // Add 30 min to get end time

    if (current.getTime() === prevEnd.getTime()) {
      // Contiguous, extend range
      currentEnd = current;
    } else {
      // Gap found, save range and start new one
      const endTime = new Date(currentEnd);
      endTime.setMinutes(endTime.getMinutes() + 30);
      const hours = `${String(currentStart.getHours()).padStart(2, '0')}:${String(currentStart.getMinutes()).padStart(2, '0')}-${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`;
      ranges.push({ start: currentStart, end: endTime, hours });
      currentStart = current;
      currentEnd = current;
    }
  }

  // Add final range
  const endTime = new Date(currentEnd);
  endTime.setMinutes(endTime.getMinutes() + 30);
  const hours = `${String(currentStart.getHours()).padStart(2, '0')}:${String(currentStart.getMinutes()).padStart(2, '0')}-${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`;
  ranges.push({ start: currentStart, end: endTime, hours });

  return ranges;
}

/**
 * Format schedule ranges in one user's timezone.
 * The stored slots are instants in UTC; formatting them from Date values keeps
 * both the calendar day and the clock time correct when a timezone crosses
 * midnight or daylight-saving boundaries.
 */
export function formatTimeRangesForDiscordInTimezone(ranges: TimeRange[], timezone: string): string {
  if (ranges.length === 0) return 'No time slots';

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const formatParts = (date: Date): Record<string, string> => Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return ranges.map((range) => {
    const start = formatParts(range.start);
    const end = formatParts(range.end);
    const date = `${start.year}-${start.month}-${start.day}`;
    const hours = `${start.hour}:${start.minute}-${end.hour}:${end.minute}`;
    return `• ${date} ${hours} ${timezone}`;
  }).join('\n');
}

/** Render one copy of the schedule for every participant's configured timezone. */
export function formatTimeRangesForDiscordByTimezone(
  ranges: TimeRange[],
  entries: DiscordTimezoneEntry[]
): string {
  const timezoneEntries = entries.length > 0 ? entries : [{ label: 'UTC', timezone: 'UTC' }];
  return timezoneEntries
    .map(({ label, timezone }) => `**${label} (${timezone})**\n${formatTimeRangesForDiscordInTimezone(ranges, timezone || 'UTC')}`)
    .join('\n\n');
}
