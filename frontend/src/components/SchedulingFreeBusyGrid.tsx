import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface GridSlot {
  startTime: Date;
  endTime: Date;
  dayOfWeek: string;
  slotIndex: number;
}

interface SchedulingFreeBusyGridProps {
  participants: Participant[];
  dateStart: Date;
  dateEnd: Date;
  selectedSlots?: Set<string>;
  onSlotToggle?: (slotDatetime: string, selected: boolean) => void;
  readOnly?: boolean;
  proposedSlots?: string[];
  confirmedSlots?: Record<string, string[]>; // slot_id -> array of user_ids who confirmed
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Generate 30-minute slots between dateStart and dateEnd
 */
const generateSlots = (dateStart: Date, dateEnd: Date): GridSlot[] => {
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

        slots.push({
          startTime: slotStart,
          endTime: slotEnd,
          dayOfWeek: DAYS_OF_WEEK[slotStart.getUTCDay()],
          slotIndex: hour * 2 + Math.floor(minute / 30)
        });
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return slots;
};

/**
 * Check if participant is available in a specific slot (UTC)
 * Converts slot times from UTC to participant's timezone for comparison
 */
const isParticipantAvailable = (
  participant: Participant,
  slotStartUTC: Date,
  slotEndUTC: Date
): boolean => {
  if (!participant.availability_schedule) {
    return true; // Unknown availability = assume available
  }

  try {
    // Convert UTC time to participant's timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: participant.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(slotStartUTC);
    const dateObj = {
      year: parseInt(parts.find(p => p.type === 'year')?.value || '0'),
      month: parseInt(parts.find(p => p.type === 'month')?.value || '0'),
      day: parseInt(parts.find(p => p.type === 'day')?.value || '0'),
      hour: parseInt(parts.find(p => p.type === 'hour')?.value || '0'),
      minute: parseInt(parts.find(p => p.type === 'minute')?.value || '0')
    };

    // Get day name in participant's timezone
    const tzDate = new Date(slotStartUTC.toLocaleString('en-US', { timeZone: participant.timezone }));
    const dayKey = DAYS_OF_WEEK[tzDate.getUTCDay()].toLowerCase();
    const dayRanges = participant.availability_schedule[dayKey] || [];

    const slotTimeStr = `${String(dateObj.hour).padStart(2, '0')}:${String(dateObj.minute).padStart(2, '0')}`;

    return dayRanges.some(
      range => slotTimeStr >= range.start && slotTimeStr < range.end
    );
  } catch (error) {
    console.warn(`Error checking availability for ${participant.nickname} in timezone ${participant.timezone}:`, error);
    return true; // On error, assume available
  }
};

/**
 * Format time as HH:MM
 */
const formatTime = (date: Date): string => {
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

export default function SchedulingFreeBusyGrid({
  participants,
  dateStart,
  dateEnd,
  selectedSlots = new Set(),
  onSlotToggle,
  readOnly = false,
  proposedSlots = [],
  confirmedSlots = {}
}: SchedulingFreeBusyGridProps) {
  const { t } = useTranslation();

  const slots = useMemo(() => generateSlots(dateStart, dateEnd), [dateStart, dateEnd]);

  // Group slots by day
  const slotsByDay = useMemo(() => {
    const grouped: Record<string, GridSlot[]> = {};
    slots.forEach(slot => {
      if (!grouped[slot.dayOfWeek]) {
        grouped[slot.dayOfWeek] = [];
      }
      grouped[slot.dayOfWeek].push(slot);
    });
    return grouped;
  }, [slots]);

  const getSlotKey = (slot: GridSlot): string => slot.startTime.toISOString();

  const handleSlotClick = (slot: GridSlot) => {
    if (readOnly || !onSlotToggle) return;
    const key = getSlotKey(slot);
    onSlotToggle(key, !selectedSlots.has(key));
  };

  return (
    <div className="w-full overflow-x-auto">
      <div className="space-y-4">
        {/* Legend */}
        <div className="flex items-center gap-6 text-xs">
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

        {/* Grid */}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border border-gray-300 p-2 bg-gray-50 sticky left-0 z-10 text-left">
                Participant
              </th>
              {Object.entries(slotsByDay).map(([day, daySlots]) => (
                <th
                  key={day}
                  colSpan={daySlots.length}
                  className="border border-gray-300 p-2 bg-gray-50 text-center font-semibold"
                >
                  {DAYS_SHORT[DAYS_OF_WEEK.indexOf(day)]}
                </th>
              ))}
            </tr>
            <tr>
              <th className="border border-gray-300 p-1 bg-gray-50 sticky left-0 z-10"></th>
              {slots.map(slot => (
                <th
                  key={getSlotKey(slot)}
                  className="border border-gray-300 p-1 bg-gray-100 text-center text-xs h-6"
                >
                  <span className="inline-block" title={formatTime(slot.startTime)}>
                    {formatTime(slot.startTime)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {participants.map(participant => (
              <tr key={participant.id}>
                <td className="border border-gray-300 p-2 bg-gray-50 sticky left-0 z-10 font-semibold whitespace-nowrap">
                  <div className="text-xs font-semibold">{participant.nickname}</div>
                  <div className="text-xs text-gray-500">{participant.timezone}</div>
                </td>
                {slots.map(slot => {
                  const slotKey = getSlotKey(slot);
                  const isAvailable = isParticipantAvailable(participant, slot.startTime, slot.endTime);
                  const isProposed = proposedSlots.includes(slotKey);
                  const confirmations = confirmedSlots[slotKey] || [];
                  const isConfirmed = confirmations.length > 0;
                  const isSelected = selectedSlots.has(slotKey);

                  let bgColor = 'bg-white';
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
                    bgColor = 'bg-green-50';
                    borderColor = 'border-green-200';
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
                      title={`${participant.nickname} - ${formatTime(slot.startTime)}`}
                    >
                      {isConfirmed && (
                        <div className="w-full h-full flex items-center justify-center text-green-700 font-bold">
                          ✓
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
