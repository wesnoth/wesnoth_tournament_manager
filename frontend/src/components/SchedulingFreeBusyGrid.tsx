import React, { useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  timezone_offset?: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface GridSlot {
  dateStr: string;      // YYYY-MM-DD
  timeStr: string;      // HH:MM
  dayOfWeek: string;
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
  confirmMode?: boolean; // True when confirming proposal (only select proposed slots)
  hasStartedConfirmationSelection?: boolean; // Track if first click has happened
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Generate 30-minute slots for display grid in viewing timezone
 * Slots represent times in viewing timezone only
 */
const generateSlots = (dateStart: Date, dateEnd: Date, viewingTimezone: string = 'UTC'): GridSlot[] => {
  const slots: GridSlot[] = [];
  
  // Helper to get date/time in a specific timezone
  const getLocalDateTime = (utcDate: Date, tz: string) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour12: false
    });
    
    const parts = formatter.formatToParts(utcDate);
    const year = parts.find(p => p.type === 'year')?.value || '2025';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const weekday = parts.find(p => p.type === 'weekday')?.value || 'Monday';
    
    return {
      dateStr: `${year}-${month}-${day}`,
      weekday,
      parts
    };
  };
  
  // Start from dateStart (already in correct local representation)
  const current = new Date(dateStart);
  current.setUTCHours(0, 0, 0, 0);
  
  let prevDateStr = '';
  
  while (current < dateEnd) {
    const { dateStr, weekday: dayOfWeek } = getLocalDateTime(current, viewingTimezone);
    
    // Only generate slots once per day (check if date changed)
    if (dateStr !== prevDateStr) {
      prevDateStr = dateStr;
      
      for (let hour = 0; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
          const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          slots.push({
            dateStr,
            timeStr,
            dayOfWeek
          });
        }
      }
    }
    
    // Increment by 1 UTC day (will map to different viewing dates due to timezone)
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  return slots;
};

/**
 * Check if participant is available at this slot time
 * Both slot and availability are in viewing timezone
 */
const isParticipantAvailable = (
  participant: Participant,
  slot: GridSlot
): boolean => {
  if (!participant.availability_schedule) {
    return true;
  }

  try {
    const dayKey = slot.dayOfWeek.toLowerCase();
    const dayRanges = participant.availability_schedule[dayKey] || [];
    const slotTime = slot.timeStr;

    return dayRanges.some(
      range => slotTime >= range.start && slotTime < range.end
    );
  } catch (error) {
    console.warn(`Error checking availability for ${participant.nickname}:`, error);
    return true;
  }
};

/**
 * Convert slot to UTC datetime for API submission
 */
const slotToUTCDatetime = (slot: GridSlot, viewingTimezone: string): string => {
  // Create a date string for this date/time in viewing timezone
  const localDateTimeStr = `${slot.dateStr}T${slot.timeStr}:00`;
  const localDate = new Date(localDateTimeStr);

  // Find what UTC time corresponds to this local time
  // Try different UTC offsets to find the match
  for (let offsetHours = -12; offsetHours <= 14; offsetHours++) {
    const testUtc = new Date(localDate.getTime() - offsetHours * 60 * 60 * 1000);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: viewingTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(testUtc);
    const testYear = parseInt(parts.find(p => p.type === 'year')?.value || '0');
    const testMonth = parseInt(parts.find(p => p.type === 'month')?.value || '0');
    const testDay = parseInt(parts.find(p => p.type === 'day')?.value || '0');
    const testHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const testMin = parseInt(parts.find(p => p.type === 'minute')?.value || '0');

    const [year, month, day] = slot.dateStr.split('-').map(Number);
    const [hour, min] = slot.timeStr.split(':').map(Number);

    if (testYear === year && testMonth === month && testDay === day && testHour === hour && testMin === min) {
      return testUtc.toISOString();
    }
  }

  // Fallback
  console.warn('Could not convert slot to UTC:', slot);
  return new Date(localDateTimeStr).toISOString();
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
  confirmMode = false,
  hasStartedConfirmationSelection = false
}: SchedulingFreeBusyGridProps) {
  const { t } = useTranslation();
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const slots = useMemo(() => generateSlots(dateStart, dateEnd, viewingTimezone), [dateStart, dateEnd, viewingTimezone]);

  const slotsByDate = useMemo(() => {
    const grouped: Record<string, GridSlot[]> = {};
    slots.forEach(slot => {
      if (!grouped[slot.dateStr]) {
        grouped[slot.dateStr] = [];
      }
      grouped[slot.dateStr].push(slot);
    });
    return grouped;
  }, [slots]);

  // Scroll to earliest hour if specified
  useEffect(() => {
    if (scrollToHour !== null && scrollToHour !== undefined && gridContainerRef.current) {
      // Calculate the position of the hour in the grid and scroll to it
      const rowHeight = 30; // Each 30-min slot row height in pixels
      const hoursToScroll = scrollToHour * 2; // Each hour has 2 slots (30 min each)
      const scrollPosition = hoursToScroll * rowHeight;
      
      // Small delay to ensure DOM is fully rendered
      setTimeout(() => {
        if (gridContainerRef.current) {
          gridContainerRef.current.scrollTop = Math.max(0, scrollPosition - 100);
        }
      }, 100);
    }
  }, [scrollToHour]);

  const getSlotKey = (slot: GridSlot): string => {
    return slotToUTCDatetime(slot, viewingTimezone);
  };

  const handleSlotClick = (slot: GridSlot) => {
    if (readOnly || !onSlotToggle) return;
     
    const key = getSlotKey(slot);
     
    // In confirm mode, only allow clicking proposed slots
    if (confirmMode && proposedSlots.length > 0 && !proposedSlots.includes(key)) {
      return;
    }
     
    // Toggle this slot
    // In confirm mode, the handler manages first-click-clear-all logic
    onSlotToggle(key, !selectedSlots.has(key));
  };

  const getDayBackgroundColor = (index: number): string => {
    return index % 2 === 0 ? 'bg-blue-50' : 'bg-green-50';
  };

  const dateKeys = Object.keys(slotsByDate).sort();

  return (
    <div className="w-full space-y-4">
      {/* Legend */}
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

      {/* Grid Container */}
      <div ref={gridContainerRef} className="overflow-auto border border-gray-200 rounded-lg" style={{ maxHeight: '600px' }}>
        <table className="border-collapse text-xs whitespace-nowrap">
          <thead>
            {/* Day header */}
            <tr>
              <th className="border border-gray-300 p-2 bg-gray-50 sticky left-0 z-10 text-left min-w-[180px]">
                Participant
              </th>
              {dateKeys.map((dateKey, dateIdx) => {
                const daySlots = slotsByDate[dateKey];
                const dayColor = getDayBackgroundColor(dateIdx);
                const [year, month, day] = dateKey.split('-').map(Number);
                const date = new Date(year, month - 1, day);
                const dateLabel = date.toLocaleDateString('es-ES', {
                  weekday: 'short',
                  month: '2-digit',
                  day: '2-digit'
                });

                return (
                  <th
                    key={`date-${dateKey}`}
                    colSpan={daySlots.length}
                    className={`border border-gray-300 p-2 ${dayColor} font-semibold text-center text-xs`}
                  >
                    {dateLabel}
                  </th>
                );
              })}
            </tr>

            {/* Time header */}
            <tr>
              <th className="border border-gray-300 p-1 bg-gray-100 sticky left-0 z-10 min-w-[180px]"></th>
              {dateKeys.map(dateKey => {
                const daySlots = slotsByDate[dateKey];
                const dateIdx = dateKeys.indexOf(dateKey);
                const dayColor = getDayBackgroundColor(dateIdx);

                return daySlots.map(slot => (
                  <th
                    key={`${dateKey}-${slot.timeStr}`}
                    className={`border border-gray-300 p-1 ${dayColor} text-center h-8`}
                  >
                    <span>{slot.timeStr}</span>
                  </th>
                ));
              })}
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
                {dateKeys.map(dateKey => {
                  const daySlots = slotsByDate[dateKey];
                  const dateIdx = dateKeys.indexOf(dateKey);
                  const dayColor = getDayBackgroundColor(dateIdx);

                  return daySlots.map(slot => {
                    const slotKey = getSlotKey(slot);
                    const isAvailable = isParticipantAvailable(participant, slot);
                    const isProposed = proposedSlots.includes(slotKey);
                    const confirmations = confirmedSlots[slotKey] || [];
                    const isConfirmed = confirmations.length > 0;
                    const isSelected = selectedSlots.has(slotKey);

                    let bgColor = dayColor;
                    let borderColor = 'border-gray-200';

                    if (confirmMode && isProposed) {
                      // In confirm mode: distinguish confirmed vs rejected proposed slots
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
                        key={`${dateKey}-${slot.timeStr}`}
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
                  });
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
