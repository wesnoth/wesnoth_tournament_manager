import React, { useMemo, useEffect, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';

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
  reservedSlots?: Record<string, 'p2p' | 'tournament'>;
  viewingTimezone?: string;
  scrollToHour?: number | null;
  confirmMode?: boolean;
  hasStartedConfirmationSelection?: boolean;
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PARTICIPANT_COLUMN_WIDTH = 180;
const SLOT_COLUMN_WIDTH = 56;
const OVERSCAN_COLUMNS = 10;

/** Return a YYYY-MM-DD calendar key for a timestamp in an IANA timezone. */
const getDateKeyInTimezone = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

/** Return the current hour in an IANA timezone for initial grid scrolling. */
const getCurrentHourInTimezone = (timezone: string): number => {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(new Date()));
  return hour === 24 ? 0 : hour;
};

/** Convert a displayed local grid slot into its canonical UTC ISO key. */
const slotToUTCDatetime = (
  slot: Pick<GridSlot, 'dateStr' | 'timeStr'>,
  viewingTimezone: string,
  formatter: Intl.DateTimeFormat
): string => {
  const localDateTimeStr = `${slot.dateStr}T${slot.timeStr}:00`;
  const localDate = new Date(localDateTimeStr);
  const [targetYear, targetMonth, targetDay] = slot.dateStr.split('-').map(Number);
  const [targetHour, targetMinute] = slot.timeStr.split(':').map(Number);

  for (let offsetHours = -12; offsetHours <= 14; offsetHours++) {
    const testUtc = new Date(localDate.getTime() - offsetHours * 60 * 60 * 1000);
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

/** Generate the visible half-hour columns for the selected date window. */
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
  const utcSlotFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: viewingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
            slotKey: slotToUTCDatetime(slotBase, viewingTimezone, utcSlotFormatter)
          });
        }
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return slots;
};

/** Convert an availability schedule time such as 09:30 to minutes since midnight. */
const parseTimeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/** Normalize profile availability into numeric ranges for fast slot lookup. */
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

/**
 * Render the virtualized availability matrix used by both tournament and P2P
 * scheduling. Reserved slots are intentionally represented separately from
 * availability so they can be displayed and blocked without changing profiles.
 */
function SchedulingFreeBusyGrid({
  participants,
  dateStart,
  dateEnd,
  selectedSlots = new Set(),
  onSlotToggle,
  readOnly = false,
  proposedSlots = [],
  confirmedSlots = {},
  reservedSlots = {},
  viewingTimezone = 'UTC',
  scrollToHour = null,
  confirmMode = false
}: SchedulingFreeBusyGridProps) {
  const { i18n } = useTranslation();
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const lastTouchActivationRef = useRef(0);
  const touchGestureRef = useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    slotKey: string;
  } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);

  const slots = useMemo(
    () => generateSlots(dateStart, dateEnd, viewingTimezone),
    [dateStart, dateEnd, viewingTimezone]
  );
  const currentDateKey = useMemo(() => getDateKeyInTimezone(new Date(), viewingTimezone), [viewingTimezone]);
  const effectiveScrollToHour = useMemo(() => {
    if (scrollToHour !== null && scrollToHour !== undefined) return scrollToHour;
    return slots[0]?.dateStr === currentDateKey
      ? getCurrentHourInTimezone(viewingTimezone)
      : null;
  }, [scrollToHour, slots, currentDateKey, viewingTimezone]);

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
  const reservedSlotsMap = useMemo(() => new Map(Object.entries(reservedSlots)), [reservedSlots]);

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
        dateLabel: date.toLocaleDateString(i18n.language || 'en-US', {
          weekday: 'short',
          month: '2-digit',
          day: '2-digit'
        })
      };
    });
  }, [slotsByDate, i18n.language]);

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
    if (effectiveScrollToHour !== null && effectiveScrollToHour !== undefined && gridContainerRef.current && flatSlots.length > 0) {
      // Time is laid out horizontally: locate the first slot at or after the
      // requested hour on the first visible day, then scroll that column into
      // view beside the fixed participant column.
      const firstSlotIndex = flatSlots.findIndex(
        ({ slot }) => slot.timeMinutes >= effectiveScrollToHour * 60
      );
      const targetIndex = firstSlotIndex >= 0 ? firstSlotIndex : 0;
      const scrollPosition = targetIndex * SLOT_COLUMN_WIDTH - PARTICIPANT_COLUMN_WIDTH;
      const timer = window.setTimeout(() => {
        if (gridContainerRef.current) {
          gridContainerRef.current.scrollLeft = Math.max(0, scrollPosition);
        }
      }, 100);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [effectiveScrollToHour, flatSlots]);

  const virtualWindow = useMemo(() => {
    const totalColumns = flatSlots.length;
    const availableWidth = Math.max(0, viewportWidth - PARTICIPANT_COLUMN_WIDTH);
    const visibleColumns = Math.max(1, Math.ceil(availableWidth / SLOT_COLUMN_WIDTH));
    const startIndex = Math.max(0, Math.floor(scrollLeft / SLOT_COLUMN_WIDTH) - OVERSCAN_COLUMNS);
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

  const handleSlotToggleAction = (slot: GridSlot, source: 'click' | 'touch') => {
    if (readOnly || !onSlotToggle) return;

    const key = slot.slotKey;
    if (new Date(key).getTime() <= Date.now()) return;
    const now = Date.now();

    // Ignore synthetic click that follows touchend on mobile Safari.
    if (source === 'click' && now - lastTouchActivationRef.current < 550) {
      return;
    }

    if (source === 'touch') {
      lastTouchActivationRef.current = now;
    }

    if (confirmMode && proposedSlotsSet.size > 0 && !proposedSlotsSet.has(key)) {
      return;
    }

    // Reserved slots remain visible but cannot be selected. The current
    // proposal is represented by proposedSlots and remains selectable.
    // A preselected slot can become reserved while conflicts load. It must
    // remain clickable for deselection, even though a new reserved slot cannot
    // be selected.
    if (reservedSlotsMap.has(key) && !proposedSlotsSet.has(key) && !selectedSlots.has(key)) {
      return;
    }

    onSlotToggle(key, !selectedSlots.has(key));
  };

  const handleSlotTouchStart = (event: React.TouchEvent<HTMLTableCellElement>, slot: GridSlot) => {
    if (event.touches.length !== 1) {
      touchGestureRef.current = null;
      return;
    }
    const touch = event.touches[0];
    touchGestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      moved: false,
      slotKey: slot.slotKey
    };
  };

  const handleSlotTouchMove = (event: React.TouchEvent<HTMLTableCellElement>) => {
    if (!touchGestureRef.current || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchGestureRef.current.startX);
    const deltaY = Math.abs(touch.clientY - touchGestureRef.current.startY);
    if (deltaX > 8 || deltaY > 8) {
      touchGestureRef.current.moved = true;
    }
  };

  const handleSlotTouchEnd = (
    event: React.TouchEvent<HTMLTableCellElement>,
    slot: GridSlot
  ) => {
    const gesture = touchGestureRef.current;
    touchGestureRef.current = null;
    if (!gesture) return;
    if (gesture.moved) return;
    if (gesture.slotKey !== slot.slotKey) return;
    handleSlotToggleAction(slot, 'touch');
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
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-200 border border-orange-400 rounded"></div>
            <span>Reserved P2P</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-purple-200 border border-purple-400 rounded"></div>
            <span>Reserved tournament</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-200 border border-gray-400 rounded"></div>
            <span>Past</span>
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
        data-help-id="region-p2p-grid-scroll"
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
                  const reservationSource = reservedSlotsMap.get(slotKey);
                  const isReserved = Boolean(reservationSource) && !isProposed;
                  const isPast = new Date(slotKey).getTime() <= Date.now();

                  let bgColor = dayColor;
                  let borderColor = 'border-gray-200';

                  if (isPast) {
                    bgColor = 'bg-gray-200';
                    borderColor = 'border-gray-400';
                  } else if (confirmMode && isProposed) {
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
                  } else if (isReserved) {
                    bgColor = reservationSource === 'tournament' ? 'bg-purple-200' : 'bg-orange-200';
                    borderColor = reservationSource === 'tournament' ? 'border-purple-400' : 'border-orange-400';
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
                      data-help-id="option-schedule-slot"
                      key={`${participant.id}-${dateKey}-${slotKey}`}
                      className={`border ${borderColor} p-0.5 h-8 cursor-${readOnly || isReserved || isPast ? 'default' : 'pointer'} ${bgColor} ${
                        !readOnly && !isProposed && !isReserved && !isPast ? 'hover:opacity-75 touch-manipulation' : ''
                      }`}
                      style={{ minWidth: `${SLOT_COLUMN_WIDTH}px`, width: `${SLOT_COLUMN_WIDTH}px` }}
                      onTouchStart={(event) => handleSlotTouchStart(event, slot)}
                      onTouchMove={handleSlotTouchMove}
                      onTouchEnd={(event) => handleSlotTouchEnd(event, slot)}
                      onTouchCancel={() => {
                        touchGestureRef.current = null;
                      }}
                      onClick={() => handleSlotToggleAction(slot, 'click')}
                      title={`${participant.nickname} - ${slot.dateStr} ${slot.timeStr}${isPast ? ' (past slot)' : ''}${isReserved ? ` (${reservationSource} slot already reserved)` : ''}`}
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

export default memo(SchedulingFreeBusyGrid);
