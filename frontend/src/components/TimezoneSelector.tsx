import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IANA_TIMEZONES } from '../constants/timezones';

interface TimezoneSelecterProps {
  value: string;
  onChange: (timezone: string) => void;
}

const TimezoneSelector: React.FC<TimezoneSelecterProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const filteredTimezones = useMemo(() => {
    const search = searchInput.toLowerCase();
    return IANA_TIMEZONES.filter(tz => tz.toLowerCase().includes(search))
      .sort((a, b) => a.localeCompare(b));
  }, [searchInput]);

  const selectedLabel = value || 'UTC';

  return (
    <div className="relative">
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        {t('timezone') || 'Timezone'}
      </label>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-left flex justify-between items-center hover:border-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
      >
        <span>{selectedLabel}</span>
        <span className="text-gray-500">▼</span>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
          <input
            type="text"
            placeholder={t('search_timezone') || 'Search...'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full px-4 py-2 border-b border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />

          <div className="max-h-60 overflow-y-auto">
            {filteredTimezones.length > 0 ? (
              filteredTimezones.map((tz) => (
                <button
                  key={tz}
                  onClick={() => {
                    onChange(tz);
                    setIsOpen(false);
                    setSearchInput('');
                  }}
                  className={`w-full px-4 py-2 text-left hover:bg-blue-50 ${
                    tz === value ? 'bg-blue-100 font-semibold' : ''
                  }`}
                >
                  {tz}
                </button>
              ))
            ) : (
              <div className="px-4 py-2 text-gray-500 text-sm">
                {t('no_results') || 'No results'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TimezoneSelector;
