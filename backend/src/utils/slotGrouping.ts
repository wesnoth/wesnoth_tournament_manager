/**
 * Utility functions for grouping schedule slots into contiguous time ranges
 * Mirrors the frontend logic from ScheduleProposalModal
 */

export interface TimeRange {
  start: Date;
  end: Date;
  hours: string; // Formatted as "HH:MM-HH:MM"
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
 * Format time ranges with line breaks (for Discord embeds and database messages)
 * @param ranges Array of time ranges
 * @returns String with newline-separated ranges
 */
export function formatTimeRangesForDiscord(ranges: TimeRange[]): string {
  if (ranges.length === 0) return 'No time slots';

  const dateGrouped = new Map<string, TimeRange[]>();
  
  // Group by date (YYYY-MM-DD)
  for (const range of ranges) {
    const dateKey = range.start.toISOString().split('T')[0];
    if (!dateGrouped.has(dateKey)) {
      dateGrouped.set(dateKey, []);
    }
    dateGrouped.get(dateKey)!.push(range);
  }

  // Format each date group with bullets
  const formatted: string[] = [];
  for (const [dateStr, dateRanges] of dateGrouped.entries()) {
    for (const range of dateRanges) {
      formatted.push(`• ${dateStr} ${range.hours} UTC`);
    }
  }

  return formatted.join('\n');
}

/**
 * Build a formatted notification message with title and time ranges
 * Used for both Discord and database messages
 * @param notificationType Type of notification (proposal, confirmed, rejected, counter)
 * @param actorName Name of the actor (team or player)
 * @param ranges Array of time ranges
 * @param notes Optional notes from proposer
 * @returns Formatted message string
 */
export function buildNotificationMessage(
  notificationType: 'proposal' | 'confirmed' | 'rejected' | 'counter' | 'changed' | 'cancelled',
  actorName: string,
  ranges: TimeRange[],
  notes?: string | null
): string {
  let message = '';
  
  switch (notificationType) {
    case 'proposal':
      message = `📋 **Schedule Proposal** - ${actorName} proposes:\n${formatTimeRangesForDiscord(ranges)}`;
      break;
    case 'confirmed':
      message = `✅ **Schedule Confirmed** - ${actorName} confirms:\n${formatTimeRangesForDiscord(ranges)}`;
      break;
    case 'rejected':
      message = `❌ **Schedule Rejected** - ${actorName} rejects the proposal`;
      break;
    case 'counter':
      message = `🔄 **Counter Proposal** - ${actorName} rejects the proposal and proposes:\n${formatTimeRangesForDiscord(ranges)}`;
      break;
    case 'changed':
      message = `✏️ **Proposal Changed** - ${actorName} has updated the proposed slots:\n${formatTimeRangesForDiscord(ranges)}`;
      break;
    case 'cancelled':
      message = `🚫 **Proposal Cancelled** - ${actorName} has withdrawn the proposal`;
      if (ranges.length > 0) {
        message += `:\n${formatTimeRangesForDiscord(ranges)}`;
      }
      break;
  }

  if (notes) {
    message += `\n\n💬 **Notes**: ${notes}`;
  }

  return message;
}
