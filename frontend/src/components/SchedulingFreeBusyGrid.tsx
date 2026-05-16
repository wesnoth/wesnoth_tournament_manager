import React, { useMemo, useEffect, useRef } from 'react';

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

  const dateSections = useMemo(() => {
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
      for (const slot of slots) {
        const dayRanges = normalizedSchedule[slot.dayKey] || [];
        const isAvailable = dayRanges.some(
          range => slot.timeMinutes >= range.start && slot.timeMinutes < range.end
        );
        availabilityBySlot.set(slot.slotKey, isAvailable);
      }

      lookup.set(participant.id, availabilityBySlot);
    }

    return lookup;
  }, [participants, slots]);

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
        <table className="border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr>
              <th className="border border-gray-300 p-2 bg-gray-50 sticky left-0 z-10 text-left min-w-[180px]">
                Participant
              </th>
              {dateSections.map(({ dateKey, daySlots, dayColor, dateLabel }) => (
                <th
                  key={`date-${dateKey}`}
                  colSpan={daySlots.length}
                  className={`border border-gray-300 p-2 ${dayColor} font-semibold text-center text-xs`}
                >
                  {dateLabel}
                </th>
              ))}
            </tr>
            <tr>
              <th className="border border-gray-300 p-1 bg-gray-100 sticky left-0 z-10 min-w-[180px]"></th>
              {dateSections.map(({ dateKey, daySlots, dayColor }) =>
                daySlots.map(slot => (
                  <th
                    key={`${dateKey}-${slot.slotKey}`}
                    className={`border border-gray-300 p-1 ${dayColor} text-center h-8`}
                  >
                    <span>{slot.timeStr}</span>
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {participants.map(participant => (
              <tr key={participant.id}>
                <td className="border border-gray-300 p-2 bg-gray-50 sticky left-0 z-10 font-semibold whitespace-nowrap min-w-[180px]">
                  <div className="text-xs font-semibold">{participant.nickname}</div>
                  <div className="text-xs text-gray-500">
                    {participant.timezone} {participant.timezone_offset && `(${participant.timezone_offset})`}
                  </div>
                </td>
                {dateSections.map(({ dateKey, daySlots, dayColor }) =>
                  daySlots.map(slot => {
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
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
