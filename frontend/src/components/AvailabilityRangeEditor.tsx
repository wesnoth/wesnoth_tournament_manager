import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface TimeRange {
  start: string;
  end: string;
}

export interface AvailabilitySchedule {
  [key: string]: TimeRange[];
}

interface AvailabilityRangeEditorProps {
  value: AvailabilitySchedule | null;
  onChange: (schedule: AvailabilitySchedule | null) => void;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const AvailabilityRangeEditor: React.FC<AvailabilityRangeEditorProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [schedule, setSchedule] = useState<AvailabilitySchedule>(
    value || DAYS.reduce((acc, day) => ({ ...acc, [day]: [] }), {})
  );

  const updateSchedule = (newSchedule: AvailabilitySchedule) => {
    setSchedule(newSchedule);
    onChange(newSchedule);
  };

  const addRange = (day: string) => {
    const newRange: TimeRange = { start: '09:00', end: '10:00' };
    updateSchedule({
      ...schedule,
      [day]: [...(schedule[day] || []), newRange],
    });
  };

  const removeRange = (day: string, index: number) => {
    const ranges = (schedule[day] || []).filter((_, i) => i !== index);
    updateSchedule({
      ...schedule,
      [day]: ranges,
    });
  };

  const updateRange = (day: string, index: number, field: 'start' | 'end', value: string) => {
    const ranges = [...(schedule[day] || [])];
    ranges[index] = { ...ranges[index], [field]: value };
    updateSchedule({
      ...schedule,
      [day]: ranges,
    });
  };

  const clearAllSchedule = () => {
    const emptySchedule = DAYS.reduce((acc, day) => ({ ...acc, [day]: [] }), {});
    updateSchedule(emptySchedule);
  };

  const getDayLabel = (day: string) => {
    return t(`days.${day}`) || t(day as any) || day.charAt(0).toUpperCase() + day.slice(1);
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center mb-2">
        <label className="block text-sm font-semibold text-gray-700">
          {t('availability.title') || 'Availability Schedule'}
        </label>
        <button
          onClick={clearAllSchedule}
          className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
          title={t('availability.clear_all_help') || 'Clear all time ranges'}
        >
          {t('common.clear_all') || 'Clear All'}
        </button>
      </div>

      <p className="text-xs text-gray-600 mb-3">
        {t('availability.help_text') || 'Define your available time slots for matches (in your local timezone). 30-minute granularity.'}
      </p>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <tbody>
            {DAYS.map((day, dayIndex) => (
              <tr key={day} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 w-20">
                  {getDayLabel(day)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {(schedule[day] || []).length === 0 ? (
                      <span className="text-xs text-gray-500 italic">{t('availability.not_available') || 'Not available'}</span>
                    ) : (
                      (schedule[day] || []).map((range, index) => (
                        <div key={`${day}-${index}`} className="flex items-center gap-1 bg-blue-50 px-2 py-1 rounded text-sm">
                          <input
                            type="time"
                            value={range.start}
                            onChange={(e) => updateRange(day, index, 'start', e.target.value)}
                            className="px-1 py-0 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-200 w-16"
                          />
                          <span className="text-gray-400 text-xs">–</span>
                          <input
                            type="time"
                            value={range.end}
                            onChange={(e) => updateRange(day, index, 'end', e.target.value)}
                            className="px-1 py-0 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-200 w-16"
                          />
                          <button
                            onClick={() => removeRange(day, index)}
                            className="px-1 py-0 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition flex-shrink-0"
                            title={t('common.remove') || 'Remove'}
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )}
                    <button
                      onClick={() => addRange(day)}
                      className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition flex-shrink-0"
                      title={t('availability.add_time_range_help') || 'Add another time range'}
                    >
                      + {t('availability.add_range') || 'Add'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AvailabilityRangeEditor;
