export interface GroupedTimeRange {
  start: Date;
  end: Date;
  hours: string;
}

/** Group adjacent 30-minute UTC slots into ranges for the scheduling grid. */
export const groupSlotsIntoRanges = (slotDatetimes: string[], timezone?: string): GroupedTimeRange[] => {
  if (slotDatetimes.length === 0) return [];

  const formatHours = (start: Date, end: Date): string => {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      ...(timezone ? { timeZone: timezone } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    return `${formatter.format(start)}-${formatter.format(end)}`;
  };

  const sorted = slotDatetimes
    .map(dt => new Date(dt))
    .sort((a, b) => a.getTime() - b.getTime());

  const ranges: GroupedTimeRange[] = [];
  let currentStart = sorted[0];
  let currentEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const prevEnd = new Date(currentEnd);
    prevEnd.setMinutes(prevEnd.getMinutes() + 30);

    if (current.getTime() === prevEnd.getTime()) {
      currentEnd = current;
    } else {
      const endTime = new Date(currentEnd);
      endTime.setMinutes(endTime.getMinutes() + 30);
      const hours = formatHours(currentStart, endTime);
      ranges.push({ start: currentStart, end: endTime, hours });
      currentStart = current;
      currentEnd = current;
    }
  }

  const endTime = new Date(currentEnd);
  endTime.setMinutes(endTime.getMinutes() + 30);
  const hours = formatHours(currentStart, endTime);
  ranges.push({ start: currentStart, end: endTime, hours });

  return ranges;
};
