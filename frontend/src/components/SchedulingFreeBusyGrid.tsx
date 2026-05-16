import React, { useMemo, useEffect, useRef, useState } from 'react';

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  timezone_offset?: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface GridSlot {
  dateStr: string;
  timeStr: string;
  dayOfWeek: string;
  dayKey: string;
  timeMinutes: number;
  slotKey: string;
}

interface DateSection {
  dateKey: string;
  daySlots: GridSlot[];
  dayColor: string;
  dateLabel: string;
}

interface FlatSlot {
  slot: GridSlot;
  dateKey: string;
  dayColor: string;
}

interface SchedulingFreeBusyGridProps {
  participants: Participant[];
  dateStart: Date;
  dateEnd: Date;
  selectedSlots?: Set<string>;
  onSlotToggle?: (slotDatetime: string, selected: boolean) => void;
  readOnly?: boolean;
  proposedSlots?: string[];
  confirmedSlots?: Record<string, string[]>;
  viewingTimezone?: string;
  scrollToHour?: number | null;
  confirmMode?: boolean;
  hasStartedConfirmationSelection?: boolean;
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PARTICIPANT_COLUMN_WIDTH = 180;
const SLOT_COLUMN_WIDTH = 56;
const OVERSCAN_COLUMNS = 10;

const slotToUTCDatetime = (slot: Pick<GridSlot, 'dateStr' | 'timeStr'>, viewingTimezone: string): string => {
  const localDateTimeStr = `${slot.dateStr}T${slot.timeStr}:00`;
  const localDate = new Date(localDateTimeStr);
  const [targetYear, targetMonth, targetDay] = slot.dateStr.split('-').map(Number);
  const [targetHour, targetMinute] = slot.timeStr.split(':').map(Number);

  for (let offsetHours = -12; offsetHours <= 14; offsetHours++) {
    const testUtc = new Date(localDate.getTime() - offsetHours * 60 * 60 * 1000);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: viewingTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(testUtc);
    const testYear = parseInt(parts.find(p => p.type === 'year')?.value || '0');
    const testMonth = parseInt(parts.find(p => p.type === 'month')?.value || '0');
    const testDay = parseInt(parts.find(p => p.type === 'day')?.value || '0');
    const testHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const testMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');

    if (
      testYear === targetYear &&
      testMonth === targetMonth &&
      testDay === targetDay &&
      testHour === targetHour &&
      testMinute === targetMinute
    ) {
      return testUtc.toISOString();
    }
  }

  return new Date(localDateTimeStr).toISOString();
};

const generateSlots = (dateStart: Date, dateEnd: Date, viewingTimezone: string = 'UTC'): GridSlot[] => {
  const slots: GridSlot[] = [];
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: viewingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour12: false
  });

  const current = new Date(dateStart);
  current.setUTCHours(0, 0, 0, 0);

  let previousDateStr = '';
  while (current < dateEnd) {
    const parts = dateFormatter.formatToParts(current);
    const year = parts.find(p => p.type === 'year')?.value || '2025';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const dayOfWeek = parts.find(p => p.type === 'weekday')?.value || 'Monday';
    const dateStr = `${year}-${month}-${day}`;

    if (dateStr !== previousDateStr) {
      previousDateStr = dateStr;
      const dayKey = dayOfWeek.toLowerCase();

      for (let hour = 0; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          const slotBase = { dateStr, timeStr };
          slots.push({
            dateStr,
            timeStr,
            dayOfWeek,
            dayKey,
            timeMinutes: hour * 60 + minute,
            slotKey: slotToUTCDatetime(slotBase, viewingTimezone)
          });
        }
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return slots;
};

const parseTimeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const normalizeAvailabilitySchedule = (
  schedule?: Record<string, Array<{ start: string; end: string }>>
): Record<string, Array<{ start: number; end: number }>> | null => {
  if (!schedule) return null;

  const normalized: Record<string, Array<{ start: number; end: number }>> = {};
  for (const day of DAYS_OF_WEEK) {
    const dayKey = day.toLowerCase();
    const ranges = schedule[dayKey] || [];
    normalized[dayKey] = ranges.map(range => ({
      start: parseTimeToMinutes(range.start),
      end: parseTimeToMinutes(range.end)
    }));
  }

  return normalized;
};

export default function SchedulingFreeBusyGrid({
  participants,
  dateStart,
  dateEnd,
  selectedSlots = new Set(),
  onSlotToggle,
  readOnly = false,
  proposedSlots = [],
  confirmedSlots = {},
  viewingTimezone = 'UTC',
  scrollToHour = null,
  confirmMode = false
}: SchedulingFreeBusyGridProps) {
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  const slots = useMemo(
    () => generateSlots(dateStart, dateEnd, viewingTimezone),
    [dateStart, dateEnd, viewingTimezone]
  );

  const proposedSlotsSet = useMemo(() => new Set(proposedSlots), [proposedSlots]);
  const confirmedSlotsSet = useMemo(() => {
    const set = new Set<string>();
    for (const [slotKey, confirmations] of Object.entries(confirmedSlots)) {
      if (confirmations.length > 0) {
        set.add(slotKey);
      }
    }
    return set;
  }, [confirmedSlots]);

  const slotsByDate = useMemo(() => {
    const grouped: Record<string, GridSlot[]> = {};
    for (const slot of slots) {
      if (!grouped[slot.dateStr]) {
        grouped[slot.dateStr] = [];
      }
      grouped[slot.dateStr].push(slot);
    }
    return grouped;
  }, [slots]);

  const dateSections = useMemo<DateSection[]>(() => {
    const dateKeys = Object.keys(slotsByDate).sort();
    return dateKeys.map((dateKey, index) => {
      const daySlots = slotsByDate[dateKey];
      const [year, month, day] = dateKey.split('-').map(Number);
      const date = new Date(year, month - 1, day);

      return {
        dateKey,
        daySlots,
        dayColor: index % 2 === 0 ? 'bg-blue-50' : 'bg-green-50',
        dateLabel: date.toLocaleDateString('es-ES', {
          weekday: 'short',
          month: '2-digit',
          day: '2-digit'
        })
      };
    });
  }, [slotsByDate]);

  const dateSectionMeta = useMemo(() => {
    const map = new Map<string, { dayColor: string; dateLabel: string }>();
    for (const section of dateSections) {
      map.set(section.dateKey, {
        dayColor: section.dayColor,
        dateLabel: section.dateLabel
      });
    }
    return map;
  }, [dateSections]);

  const flatSlots = useMemo<FlatSlot[]>(() => {
    const result: FlatSlot[] = [];
    for (const section of dateSections) {
      for (const slot of section.daySlots) {
        result.push({
          slot,
          dateKey: section.dateKey,
          dayColor: section.dayColor
        });
      }
    }
    return result;
  }, [dateSections]);

  const participantAvailabilityBySlot = useMemo(() => {
    const lookup = new Map<string, Map<string, boolean>>();

    for (const participant of participants) {
      if (!participant.availability_schedule) {
        continue;
      }

      const normalizedSchedule = normalizeAvailabilitySchedule(participant.availability_schedule);
      if (!normalizedSchedule) {
        continue;
      }

      const availabilityBySlot = new Map<string, boolean>();
      for (const flatSlot of flatSlots) {
        const dayRanges = normalizedSchedule[flatSlot.slot.dayKey] || [];
        const isAvailable = dayRanges.some(
          range => flatSlot.slot.timeMinutes >= range.start && flatSlot.slot.timeMinutes < range.end
        );
        availabilityBySlot.set(flatSlot.slot.slotKey, isAvailable);
      }

      lookup.set(participant.id, availabilityBySlot);
    }

    return lookup;
  }, [participants, flatSlots]);

  useEffect(() => {
    const container = gridContainerRef.current;
    if (!container) return undefined;

    setViewportWidth(container.clientWidth);

    const onScroll = () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      const nextScrollLeft = container.scrollLeft;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        setScrollLeft(nextScrollLeft);
      });
    };

    container.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      setViewportWidth(container.clientWidth);
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (scrollToHour !== null && scrollToHour !== undefined && gridContainerRef.current) {
      const rowHeight = 30;
      const hoursToScroll = scrollToHour * 2;
      const scrollPosition = hoursToScroll * rowHeight;
      const timer = window.setTimeout(() => {
        if (gridContainerRef.current) {
          gridContainerRef.current.scrollTop = Math.max(0, scrollPosition - 100);
        }
      }, 100);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [scrollToHour]);

  const virtualWindow = useMemo(() => {
    const totalColumns = flatSlots.length;
    const availableWidth = Math.max(0, viewportWidth - PARTICIPANT_COLUMN_WIDTH);
    const visibleColumns = Math.max(1, Math.ceil(availableWidth / SLOT_COLUMN_WIDTH));
    // scrollLeft includes the hidden/non-virtualized participant column width
    const effectiveSlotsScrollLeft = Math.max(0, scrollLeft - PARTICIPANT_COLUMN_WIDTH);
    const startIndex = Math.max(0, Math.floor(effectiveSlotsScrollLeft / SLOT_COLUMN_WIDTH) - OVERSCAN_COLUMNS);
    const endIndex = Math.min(totalColumns, startIndex + visibleColumns + OVERSCAN_COLUMNS * 2);
    const leftSpacerWidth = startIndex * SLOT_COLUMN_WIDTH;
    const rightSpacerWidth = Math.max(0, (totalColumns - endIndex) * SLOT_COLUMN_WIDTH);

    return {
      startIndex,
      endIndex,
      leftSpacerWidth,
      rightSpacerWidth,
      totalColumns
    };
  }, [flatSlots.length, viewportWidth, scrollLeft]);

  const visibleFlatSlots = useMemo(
    () => flatSlots.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [flatSlots, virtualWindow.startIndex, virtualWindow.endIndex]
  );

  const visibleDaySegments = useMemo(() => {
    if (visibleFlatSlots.length === 0) return [];

    const segments: Array<{ dateKey: string; count: number; dayColor: string; dateLabel: string }> = [];
    let currentDateKey = visibleFlatSlots[0].dateKey;
    let currentCount = 0;

    for (const item of visibleFlatSlots) {
      if (item.dateKey === currentDateKey) {
        currentCount++;
      } else {
        const previousMeta = dateSectionMeta.get(currentDateKey);
        segments.push({
          dateKey: currentDateKey,
          count: currentCount,
          dayColor: previousMeta?.dayColor || 'bg-blue-50',
          dateLabel: previousMeta?.dateLabel || currentDateKey
        });
        currentDateKey = item.dateKey;
        currentCount = 1;
      }
    }

    const lastMeta = dateSectionMeta.get(currentDateKey);
    segments.push({
      dateKey: currentDateKey,
      count: currentCount,
      dayColor: lastMeta?.dayColor || 'bg-blue-50',
      dateLabel: lastMeta?.dateLabel || currentDateKey
    });

    return segments;
  }, [visibleFlatSlots, dateSectionMeta]);

  const handleSlotClick = (slot: GridSlot) => {
    if (readOnly || !onSlotToggle) return;

    const key = slot.slotKey;
    if (confirmMode && proposedSlotsSet.size > 0 && !proposedSlotsSet.has(key)) {
      return;
    }

    onSlotToggle(key, !selectedSlots.has(key));
  };

  return (
    <div className="w-full space-y-4">
      {confirmMode ? (
        <div className="sticky top-0 z-20 bg-white flex items-center gap-6 text-xs p-4 border border-gray-200 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-200 border border-blue-400 rounded"></div>
            <span>Proposed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 border border-green-700 rounded"></div>
            <span>Confirmed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-300 border border-red-500 rounded"></div>
            <span>Rejected</span>
          </div>
        </div>
      ) : (
        <div className="sticky top-0 z-20 bg-white flex items-center gap-6 text-xs p-4 border border-gray-200 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-100 border border-green-300 rounded"></div>
            <span>Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-100 border border-gray-300 rounded"></div>
            <span>Busy</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-200 border border-blue-400 rounded"></div>
            <span>Proposed</span>
          </div>
        </div>
      )}

      <div
        ref={gridContainerRef}
        className="overflow-auto border border-gray-200 rounded-lg"
        style={{ maxHeight: '600px' }}
      >
        <table
          className="border-collapse text-xs whitespace-nowrap"
          style={{
            tableLayout: 'fixed',
            minWidth: `${PARTICIPANT_COLUMN_WIDTH + virtualWindow.totalColumns * SLOT_COLUMN_WIDTH}px`,
            width: `${PARTICIPANT_COLUMN_WIDTH + virtualWindow.totalColumns * SLOT_COLUMN_WIDTH}px`
          }}
        >
          <thead>
            <tr>
              <th
                className="border border-gray-300 p-2 bg-gray-50 sticky left-0 z-10 text-left min-w-[180px]"
                style={{ width: `${PARTICIPANT_COLUMN_WIDTH}px` }}
              >
                Participant
              </th>
              {virtualWindow.leftSpacerWidth > 0 && (
                <th
                  className="border border-gray-300 p-0 bg-gray-50"
                  style={{
                    minWidth: `${virtualWindow.leftSpacerWidth}px`,
                    width: `${virtualWindow.leftSpacerWidth}px`,
                    maxWidth: `${virtualWindow.leftSpacerWidth}px`
                  }}
                />
              )}
              {visibleDaySegments.map(({ dateKey, count, dayColor, dateLabel }) => (
                <th
                  key={`date-${dateKey}`}
                  colSpan={count}
                  className={`border border-gray-300 p-2 ${dayColor} font-semibold text-center text-xs`}
                >
                  {dateLabel}
                </th>
              ))}
              {virtualWindow.rightSpacerWidth > 0 && (
                <th
                  className="border border-gray-300 p-0 bg-gray-50"
                  style={{
                    minWidth: `${virtualWindow.rightSpacerWidth}px`,
                    width: `${virtualWindow.rightSpacerWidth}px`,
                    maxWidth: `${virtualWindow.rightSpacerWidth}px`
                  }}
                />
              )}
            </tr>
            <tr>
              <th className="border border-gray-300 p-1 bg-gray-100 sticky left-0 z-10 min-w-[180px]"></th>
              {virtualWindow.leftSpacerWidth > 0 && (
                <th
                  className="border border-gray-300 p-0 bg-gray-100"
                  style={{
                    minWidth: `${virtualWindow.leftSpacerWidth}px`,
                    width: `${virtualWindow.leftSpacerWidth}px`,
                    maxWidth: `${virtualWindow.leftSpacerWidth}px`
                  }}
                />
              )}
              {visibleFlatSlots.map(({ slot, dateKey, dayColor }) => (
                <th
                  key={`${dateKey}-${slot.slotKey}`}
                  className={`border border-gray-300 p-1 ${dayColor} text-center h-8`}
                  style={{ minWidth: `${SLOT_COLUMN_WIDTH}px`, width: `${SLOT_COLUMN_WIDTH}px` }}
                >
                  <span>{slot.timeStr}</span>
                </th>
              ))}
              {virtualWindow.rightSpacerWidth > 0 && (
                <th
                  className="border border-gray-300 p-0 bg-gray-100"
                  style={{
                    minWidth: `${virtualWindow.rightSpacerWidth}px`,
                    width: `${virtualWindow.rightSpacerWidth}px`,
                    maxWidth: `${virtualWindow.rightSpacerWidth}px`
                  }}
                />
              )}
            </tr>
          </thead>
          <tbody>
            {participants.map(participant => (
              <tr key={participant.id}>
                <td
                  className="border border-gray-300 p-2 bg-gray-50 sticky left-0 z-10 font-semibold whitespace-nowrap min-w-[180px]"
                  style={{ width: `${PARTICIPANT_COLUMN_WIDTH}px` }}
                >
                  <div className="text-xs font-semibold">{participant.nickname}</div>
                  <div className="text-xs text-gray-500">
                    {participant.timezone} {participant.timezone_offset && `(${participant.timezone_offset})`}
                  </div>
                </td>
                {virtualWindow.leftSpacerWidth > 0 && (
                  <td
                    className="border border-gray-200 p-0 bg-white"
                    style={{
                      minWidth: `${virtualWindow.leftSpacerWidth}px`,
                      width: `${virtualWindow.leftSpacerWidth}px`,
                      maxWidth: `${virtualWindow.leftSpacerWidth}px`
                    }}
                  />
                )}
                {visibleFlatSlots.map(({ slot, dateKey, dayColor }) => {
                  const slotKey = slot.slotKey;
                  const participantSlotAvailability = participantAvailabilityBySlot.get(participant.id);
                  const isAvailable = participantSlotAvailability
                    ? participantSlotAvailability.get(slotKey) ?? false
                    : true;
                  const isProposed = proposedSlotsSet.has(slotKey);
                  const isConfirmed = confirmedSlotsSet.has(slotKey);
                  const isSelected = selectedSlots.has(slotKey);

                  let bgColor = dayColor;
                  let borderColor = 'border-gray-200';

                  if (confirmMode && isProposed) {
                    if (isSelected) {
                      bgColor = 'bg-green-500';
                      borderColor = 'border-green-700';
                    } else {
                      bgColor = 'bg-red-300';
                      borderColor = 'border-red-500';
                    }
                  } else if (isConfirmed) {
                    bgColor = 'bg-green-400';
                    borderColor = 'border-green-600';
                  } else if (isProposed) {
                    bgColor = 'bg-blue-200';
                    borderColor = 'border-blue-400';
                  } else if (isSelected) {
                    bgColor = 'bg-yellow-100';
                    borderColor = 'border-yellow-400';
                  } else if (isAvailable) {
                    bgColor = 'bg-green-100';
                    borderColor = 'border-green-300';
                  } else {
                    bgColor = 'bg-gray-100';
                    borderColor = 'border-gray-300';
                  }

                  return (
                    <td
                      key={`${participant.id}-${dateKey}-${slotKey}`}
                      className={`border ${borderColor} p-0.5 h-8 cursor-${readOnly ? 'default' : 'pointer'} ${bgColor} ${
                        !readOnly && !isProposed ? 'hover:opacity-75' : ''
                      }`}
                      style={{ minWidth: `${SLOT_COLUMN_WIDTH}px`, width: `${SLOT_COLUMN_WIDTH}px` }}
                      onClick={() => handleSlotClick(slot)}
                      title={`${participant.nickname} - ${slot.dateStr} ${slot.timeStr}`}
                    >
                      {isConfirmed && (
                        <div className="w-full h-full flex items-center justify-center text-green-700 font-bold">
                          ✓
                        </div>
                      )}
                    </td>
                  );
                })}
                {virtualWindow.rightSpacerWidth > 0 && (
                  <td
                    className="border border-gray-200 p-0 bg-white"
                    style={{
                      minWidth: `${virtualWindow.rightSpacerWidth}px`,
                      width: `${virtualWindow.rightSpacerWidth}px`,
                      maxWidth: `${virtualWindow.rightSpacerWidth}px`
                    }}
                  />
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
