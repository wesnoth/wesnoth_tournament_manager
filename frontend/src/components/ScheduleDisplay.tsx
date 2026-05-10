import React from 'react';
import { useTranslation } from 'react-i18next';
import { TimeRange } from './AvailabilityRangeEditor';

interface ScheduleDisplayProps {
  timezone?: string;
  availabilitySchedule?: Record<string, TimeRange[]> | null;
  compact?: boolean;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const ScheduleDisplay: React.FC<ScheduleDisplayProps> = ({ 
  timezone, 
  availabilitySchedule, 
  compact = true 
}) => {
  const { t } = useTranslation();

  const getDayLabel = (day: string): string => {
    const label = t(`days.${day}`);
    // Return first 3 letters for compact mode
    return compact ? label?.substring(0, 3) || day.substring(0, 3) : label || day;
  };

  if (!timezone) {
    return null;
  }

  const hasSchedule = availabilitySchedule && Object.values(availabilitySchedule).some(ranges => ranges.length > 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="space-y-3">
        {/* Timezone Row */}
        {timezone && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">{t('timezone') || 'Timezone'}:</span>
            <span className="text-sm font-semibold text-gray-800">{timezone}</span>
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
                      {ranges.map((range, idx) => (
                        <div 
                          key={`${day}-${idx}`}
                          className="px-1 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium text-center whitespace-nowrap overflow-hidden text-ellipsis"
                          title={`${range.start}–${range.end}`}
                        >
                          {range.start}–{range.end}
                        </div>
                      ))}
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
