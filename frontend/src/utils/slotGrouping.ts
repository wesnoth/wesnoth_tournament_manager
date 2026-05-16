export interface GroupedTimeRange {
  start: Date;
  end: Date;
  hours: string;
}

export const groupSlotsIntoRanges = (slotDatetimes: string[]): GroupedTimeRange[] => {
  if (slotDatetimes.length === 0) return [];

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
      const hours = `${String(currentStart.getHours()).padStart(2, '0')}:${String(currentStart.getMinutes()).padStart(2, '0')}-${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`;
      ranges.push({ start: currentStart, end: endTime, hours });
      currentStart = current;
      currentEnd = current;
    }
  }

  const endTime = new Date(currentEnd);
  endTime.setMinutes(endTime.getMinutes() + 30);
  const hours = `${String(currentStart.getHours()).padStart(2, '0')}:${String(currentStart.getMinutes()).padStart(2, '0')}-${String(endTime.getHours()).padStart(2, '0')}:${String(endTime.getMinutes()).padStart(2, '0')}`;
  ranges.push({ start: currentStart, end: endTime, hours });

  return ranges;
};
