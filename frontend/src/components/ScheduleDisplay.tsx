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
    return label || day;
  };

  const hasSchedule = availabilitySchedule && Object.values(availabilitySchedule).some(ranges => ranges.length > 0);

  if (!timezone && !hasSchedule) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="space-y-3">
        {/* Timezone Row */}
        {timezone && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{t('timezone') || 'Timezone'}:</span>
            <span className="text-sm font-semibold text-gray-800">{timezone}</span>
          </div>
        )}

        {/* Schedule Grid with Time Ranges */}
        {hasSchedule && (
          <div>
            <div className="text-sm text-gray-600 mb-3">{t('availability.title') || 'Available'}:</div>
            <div className="space-y-2">
              {DAYS.map((day) => {
                const ranges = availabilitySchedule?.[day] || [];
                const hasRanges = ranges.length > 0;
                
                return (
                  <div key={day} className="flex gap-2 items-start">
                    <div className="w-20 text-sm font-semibold text-gray-700 pt-1">
                      {getDayLabel(day)}
                    </div>
                    <div className={`flex-1 flex flex-wrap gap-1 ${hasRanges ? '' : 'pt-1'}`}>
                      {hasRanges ? (
                        ranges.map((range, idx) => (
                          <div 
                            key={`${day}-${idx}`}
                            className="px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded text-xs font-medium"
                          >
                            {range.start}–{range.end}
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-gray-500 italic pt-0.5">
                          {t('availability.not_available') || 'Not available'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduleDisplay;
