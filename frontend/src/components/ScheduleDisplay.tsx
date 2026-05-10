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

        {/* Schedule Grid - Compact */}
        {hasSchedule && (
          <div>
            <div className="text-sm text-gray-600 mb-2">{t('availability.title') || 'Available'}:</div>
            <div className="grid grid-cols-7 gap-1">
              {DAYS.map((day) => {
                const ranges = availabilitySchedule?.[day] || [];
                const hasRanges = ranges.length > 0;
                
                return (
                  <div 
                    key={day}
                    className={`p-1.5 rounded text-xs text-center ${
                      hasRanges 
                        ? 'bg-green-50 text-green-700 border border-green-200' 
                        : 'bg-gray-50 text-gray-500 border border-gray-200'
                    }`}
                    title={hasRanges ? ranges.map(r => `${r.start}-${r.end}`).join(', ') : ''}
                  >
                    <div className="font-semibold">{getDayLabel(day)}</div>
                    {hasRanges && (
                      <div className="text-xs text-green-600">
                        {ranges.length} {ranges.length === 1 ? t('availability.slot') || 'slot' : 'slots'}
                      </div>
                    )}
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
