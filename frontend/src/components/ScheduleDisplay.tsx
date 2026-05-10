import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { TimeRange } from './AvailabilityRangeEditor';

interface ScheduleDisplayProps {
  timezone?: string;
  availabilitySchedule?: Record<string, TimeRange[]> | null;
  compact?: boolean;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Utility to get browser timezone
const getBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

// Convert time from one timezone to another
const convertTimeToTimezone = (
  timeStr: string,
  fromTz: string,
  toTz: string
): string => {
  if (fromTz === toTz) return timeStr;

  try {
    const [hours, minutes] = timeStr.split(':').map(Number);

    // Create a reference date at midnight to calculate offsets
    const refDate = new Date('2024-01-15T00:00:00Z'); // Use a date without DST complications

    // Get offset for source timezone
    const fromFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: fromTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const toFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: toTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const fromParts = fromFormatter.formatToParts(refDate);
    const toParts = toFormatter.formatToParts(refDate);

    const fromOffset = parseInt(fromParts.find(p => p.type === 'hour')?.value || '0') * 60 +
                      parseInt(fromParts.find(p => p.type === 'minute')?.value || '0');
    const toOffset = parseInt(toParts.find(p => p.type === 'hour')?.value || '0') * 60 +
                    parseInt(toParts.find(p => p.type === 'minute')?.value || '0');

    const diffMinutes = toOffset - fromOffset;
    let newHours = hours + Math.floor(diffMinutes / 60);
    let newMinutes = minutes + (diffMinutes % 60);

    if (newMinutes < 0) {
      newHours -= 1;
      newMinutes += 60;
    } else if (newMinutes >= 60) {
      newHours += 1;
      newMinutes -= 60;
    }

    // Handle day wraparound (keep time in 24-hour format for display)
    if (newHours < 0) newHours += 24;
    if (newHours >= 24) newHours -= 24;

    return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
  } catch {
    return timeStr;
  }
};

const ScheduleDisplay: React.FC<ScheduleDisplayProps> = ({ 
  timezone, 
  availabilitySchedule, 
  compact = true 
}) => {
  const { t } = useTranslation();
  const { isAuthenticated, user } = useAuthStore();

  // Get viewer's timezone
  const viewerTimezone = isAuthenticated && user?.timezone 
    ? user.timezone 
    : getBrowserTimezone();

  const getDayLabel = (day: string): string => {
    const label = t(`days.${day}`);
    // Return first 3 letters for compact mode
    return compact ? label?.substring(0, 3) || day.substring(0, 3) : label || day;
  };

  if (!timezone) {
    return null;
  }

  const hasSchedule = availabilitySchedule && Object.values(availabilitySchedule).some(ranges => ranges.length > 0);
  const shouldConvert = timezone !== viewerTimezone;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="space-y-3">
        {/* Timezone Row */}
        {timezone && (
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{t('timezone') || 'Timezone'}:</span>
              <span className="text-sm font-semibold text-gray-800">{timezone}</span>
            </div>
            {shouldConvert && (
              <div className="flex items-center gap-2 text-xs text-gray-600 bg-blue-50 px-2 py-1 rounded">
                <span>{t('availability.viewing_as') || 'Viewing as'}:</span>
                <span className="font-semibold text-blue-700">{viewerTimezone}</span>
              </div>
            )}
          </div>
        )}

        {/* Schedule Grid - 7 columns horizontal */}
        <div>
          {hasSchedule && (
            <div className="text-sm text-gray-600 mb-2">{t('availability.title') || 'Available'}:</div>
          )}
          <div className="grid grid-cols-7 gap-1">
            {DAYS.map((day) => {
              const ranges = availabilitySchedule?.[day] || [];
              const hasRanges = ranges.length > 0;
              
              return (
                <div 
                  key={day}
                  className={`p-2 rounded text-xs border ${
                    hasRanges 
                      ? 'bg-green-50 border-green-200' 
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="font-semibold text-gray-700 mb-1 text-center">
                    {getDayLabel(day)}
                  </div>
                  {hasRanges ? (
                    <div className="space-y-0.5">
                      {ranges.map((range, idx) => {
                        const displayStart = shouldConvert 
                          ? convertTimeToTimezone(range.start, timezone, viewerTimezone)
                          : range.start;
                        const displayEnd = shouldConvert 
                          ? convertTimeToTimezone(range.end, timezone, viewerTimezone)
                          : range.end;
                        
                        return (
                          <div 
                            key={`${day}-${idx}`}
                            className="px-1 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium text-center whitespace-nowrap overflow-hidden text-ellipsis"
                            title={`${displayStart}–${displayEnd}`}
                          >
                            {displayStart}–{displayEnd}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500 text-center block">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleDisplay;
