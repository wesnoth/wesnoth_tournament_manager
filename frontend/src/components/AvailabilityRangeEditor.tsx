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
const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <label className="block text-sm font-semibold text-gray-700">
          {t('availability_schedule') || 'Availability Schedule'}
        </label>
        <button
          onClick={clearAllSchedule}
          className="px-3 py-1 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
        >
          {t('clear_all') || 'Clear All'}
        </button>
      </div>

      <p className="text-sm text-gray-600 mb-6">
        {t('availability_schedule_help') || 'Define your available time slots for matches (in your local timezone)'}
      </p>

      <div className="space-y-4">
        {DAYS.map((day) => (
          <div key={day} className="bg-white rounded-lg border border-gray-200 p-4">
            <h4 className="font-semibold text-gray-800 mb-3">
              {t(day as any) || DAY_LABELS[day as keyof typeof DAY_LABELS]}
            </h4>

            <div className="space-y-2">
              {(schedule[day] || []).map((range, index) => (
                <div key={`${day}-${index}`} className="flex gap-2 items-center">
                  <input
                    type="time"
                    value={range.start}
                    onChange={(e) => updateRange(day, index, 'start', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <span className="text-gray-600">–</span>
                  <input
                    type="time"
                    value={range.end}
                    onChange={(e) => updateRange(day, index, 'end', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <button
                    onClick={() => removeRange(day, index)}
                    className="px-2 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                  >
                    {t('remove') || 'Remove'}
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => addRange(day)}
              className="mt-3 px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              + {t('add_time_range') || 'Add Time Range'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AvailabilityRangeEditor;
