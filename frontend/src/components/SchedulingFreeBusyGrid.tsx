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
  startTime: Date;
  endTime: Date;
  dayOfWeek: string;
  slotIndex: number;
  displayTime: string; // HH:MM in viewing timezone
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
 * Generate 30-minute slots for display grid in viewing timezone
 * Slots are displayed in viewing timezone times, but stored as UTC for API
 */
const generateSlots = (dateStart: Date, dateEnd: Date, viewingTimezone: string): GridSlot[] => {
  const slots: GridSlot[] = [];
  const current = new Date(dateStart);
  current.setUTCHours(0, 0, 0, 0);

  while (current < dateEnd) {
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotStart = new Date(current);
        slotStart.setUTCHours(hour, minute, 0, 0);

        const slotEnd = new Date(slotStart);
        slotEnd.setUTCMinutes(slotEnd.getUTCMinutes() + 30);

        if (slotStart >= dateEnd) break;

        // Format display time in viewing timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: viewingTimezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        
        const parts = formatter.formatToParts(slotStart);
        const displayHour = parts.find(p => p.type === 'hour')?.value || '00';
        const displayMin = parts.find(p => p.type === 'minute')?.value || '00';
        const displayTime = `${displayHour}:${displayMin}`;

        slots.push({
          startTime: slotStart,
          endTime: slotEnd,
          dayOfWeek: DAYS_OF_WEEK[slotStart.getUTCDay()],
          slotIndex: hour * 2 + Math.floor(minute / 30),
          displayTime
        });
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
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
 * Format time as HH:MM (in UTC)
 */
const formatTime = (date: Date): string => {
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

/**
 * Check if participant is available at this slot
 * Availability schedule has already been converted to viewing timezone by backend.
 * Slots are stored as UTC but have displayTime showing viewing timezone.
 * We compare using the day and display time.
 */
const isParticipantAvailable = (
  participant: Participant,
  slot: GridSlot,
  viewingTimezone: string
): boolean => {
  if (!participant.availability_schedule) {
    return true; // Unknown availability = assume available
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

  const slotsWithDates = useMemo(() => {
    return slots.map(slot => ({
      ...slot,
      dateStr: slot.startTime.toLocaleDateString('es-ES', {
        weekday: 'short',
        month: '2-digit',
        day: '2-digit'
      })
    }));
  }, [slots]);

  const slotsByDate = useMemo(() => {
    const grouped: Record<string, GridSlot[]> = {};
    slotsWithDates.forEach(slot => {
      const dateKey = slot.startTime.toISOString().split('T')[0];
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(slot);
    });
    return grouped;
  }, [slotsWithDates]);

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
                const date = new Date(dateKey + 'T00:00:00Z');
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
