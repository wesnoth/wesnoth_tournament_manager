import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  timezone_offset?: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface GridSlot {
  startTime: Date;      // Stored as UTC for API
  endTime: Date;        // Stored as UTC for API
  dayOfWeek: string;
  slotIndex: number;
  displayTime: string;  // HH:MM in viewing timezone
  localDate: string;    // YYYY-MM-DD in viewing timezone
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
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Generate 30-minute slots for display grid
 * Each day runs from 00:00 to 23:59 in viewing timezone
 * Slots are converted to UTC for storage/API, but displayTime shows viewing timezone time
 */
const generateSlots = (dateStart: Date, dateEnd: Date, viewingTimezone: string): GridSlot[] => {
  const slots: GridSlot[] = [];
  
  // We need to iterate over dates in viewing timezone
  // Start: convert dateStart to viewing timezone date
  // End: convert dateEnd to viewing timezone date
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: viewingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  // Get start date in viewing timezone
  let currentLocalDate = formatter.format(dateStart);
  const endLocalDate = formatter.format(dateEnd);
  
  while (currentLocalDate <= endLocalDate) {
    // Create dates for this day in viewing timezone
    // We create them as if they are UTC, then convert back
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const displayTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        
        // Create a UTC date that represents "currentLocalDate at displayTime in viewingTimezone"
        // We need to find what UTC time corresponds to this
        const localDateObj = new Date(currentLocalDate + 'T' + displayTime + ':00');
        
        // Use Intl to figure out the UTC equivalent
        // We'll try a range of UTC times to find which one gives us the desired local time
        let utcTime = new Date(localDateObj);
        
        // First approximation: assume UTC offset of ±12 hours max
        for (let offsetHours = -12; offsetHours <= 12; offsetHours++) {
          const testUtc = new Date(localDateObj.getTime() - offsetHours * 60 * 60 * 1000);
          const testFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: viewingTimezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
          
          const parts = testFormatter.formatToParts(testUtc);
          const testHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
          const testMin = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
          
          if (testHour === hour && testMin === minute) {
            utcTime = testUtc;
            break;
          }
        }
        
        const slotEnd = new Date(utcTime.getTime() + 30 * 60 * 1000);
        
        // Get day of week in UTC (for display purposes)
        const dayOfWeek = DAYS_OF_WEEK[utcTime.getUTCDay()];
        
        slots.push({
          startTime: utcTime,
          endTime: slotEnd,
          dayOfWeek,
          slotIndex: hour * 2 + Math.floor(minute / 30),
          displayTime,
          localDate: currentLocalDate
        });
      }
    }
    
    // Move to next day in viewing timezone
    const [year, month, day] = currentLocalDate.split('-').map(Number);
    const nextDayLocal = new Date(year, month - 1, day + 1);
    currentLocalDate = formatter.format(nextDayLocal);
  }
  
  return slots;
};

/**
 * Convert UTC date to specified timezone and get day name
 */
const getDayInTimezone = (utcDate: Date, timezone: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long'
    });
    return formatter.format(utcDate).toLowerCase();
  } catch {
    return DAYS_OF_WEEK[utcDate.getUTCDay()].toLowerCase();
  }
};

/**
 * Check if participant is available at this slot
 * Compare using displayTime (viewing timezone) with availability ranges
 */
const isParticipantAvailable = (
  participant: Participant,
  slot: GridSlot,
  viewingTimezone: string
): boolean => {
  if (!participant.availability_schedule) {
    return true;
  }

  try {
    // Get day name in viewing timezone
    const dayKey = getDayInTimezone(slot.startTime, viewingTimezone);
    const dayRanges = participant.availability_schedule[dayKey] || [];

    // Use the display time which is already in viewing timezone
    const slotTimeStr = slot.displayTime;

    return dayRanges.some(
      range => slotTimeStr >= range.start && slotTimeStr < range.end
    );
  } catch (error) {
    console.warn(`Error checking availability for ${participant.nickname}:`, error);
    return true;
  }
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
  viewingTimezone = 'UTC'
}: SchedulingFreeBusyGridProps) {
  const { t } = useTranslation();

  const slots = useMemo(() => generateSlots(dateStart, dateEnd, viewingTimezone), [dateStart, dateEnd, viewingTimezone]);

  const slotsByDate = useMemo(() => {
    const grouped: Record<string, GridSlot[]> = {};
    slots.forEach(slot => {
      const dateKey = slot.localDate;
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(slot);
    });
    return grouped;
  }, [slots]);

  const getSlotKey = (slot: GridSlot): string => slot.startTime.toISOString();

  const handleSlotClick = (slot: GridSlot) => {
    if (readOnly || !onSlotToggle) return;
    const key = getSlotKey(slot);
    onSlotToggle(key, !selectedSlots.has(key));
  };

  const getDayBackgroundColor = (index: number): string => {
    return index % 2 === 0 ? 'bg-blue-50' : 'bg-green-50';
  };

  const dateKeys = Object.keys(slotsByDate).sort();

  return (
    <div className="w-full space-y-4">
      {/* Legend */}
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
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-400 border border-green-600 rounded"></div>
          <span>Confirmed</span>
        </div>
      </div>

      {/* Grid Container */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
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
                    key={getSlotKey(slot)}
                    className={`border border-gray-300 p-1 ${dayColor} text-center h-8`}
                  >
                    <span title={slot.displayTime}>{slot.displayTime}</span>
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
                    const isAvailable = isParticipantAvailable(participant, slot, viewingTimezone);
                    const isProposed = proposedSlots.includes(slotKey);
                    const confirmations = confirmedSlots[slotKey] || [];
                    const isConfirmed = confirmations.length > 0;
                    const isSelected = selectedSlots.has(slotKey);

                    let bgColor = dayColor;
                    let borderColor = 'border-gray-200';

                    if (isConfirmed) {
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
                        key={slotKey}
                        className={`border ${borderColor} p-0.5 h-8 cursor-${readOnly ? 'default' : 'pointer'} ${bgColor} ${
                          !readOnly && !isProposed ? 'hover:opacity-75' : ''
                        }`}
                        onClick={() => handleSlotClick(slot)}
                        title={`${participant.nickname} - ${slot.displayTime}`}
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
