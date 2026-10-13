import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import isoCountries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import esLocale from 'i18n-iso-countries/langs/es.json';

// Register language locales
isoCountries.registerLocale(enLocale);
isoCountries.registerLocale(esLocale);

interface CountrySelectorProps {
  value?: string;
  onChange: (countryCode: string) => void;
  disabled?: boolean;
  showFlag?: boolean;
}

/**
 * Get flag image URL from flagcdn.com
 * Maps country codes to correct flag codes
 */
function getCountryFlagUrl(countryCode: string): string {
  const codeMap: Record<string, string> = {
    'US': 'us', 'GB': 'gb', 'DE': 'de', 'FR': 'fr', 'ES': 'es',
    'IT': 'it', 'JP': 'jp', 'CN': 'cn', 'IN': 'in', 'BR': 'br',
    'CA': 'ca', 'AU': 'au', 'MX': 'mx', 'RU': 'ru', 'KR': 'kr',
    'AR': 'ar', 'CL': 'cl', 'CO': 'co', 'PE': 'pe', 'VE': 've',
    'ZA': 'za', 'NG': 'ng', 'EG': 'eg', 'KE': 'ke', 'ET': 'et',
    'NZ': 'nz', 'SG': 'sg', 'TH': 'th', 'MY': 'my', 'ID': 'id',
    'PH': 'ph', 'VN': 'vn', 'TR': 'tr', 'SA': 'sa', 'AE': 'ae',
    'IL': 'il', 'PK': 'pk', 'BD': 'bd', 'IR': 'ir', 'IQ': 'iq',
    'SE': 'se', 'NO': 'no', 'DK': 'dk', 'FI': 'fi', 'PL': 'pl',
    'CZ': 'cz', 'HU': 'hu', 'RO': 'ro', 'GR': 'gr', 'PT': 'pt',
    'BE': 'be', 'NL': 'nl', 'AT': 'at', 'CH': 'ch', 'IE': 'ie',
    'UA': 'ua', 'BY': 'by', 'MD': 'md', 'HR': 'hr', 'RS': 'rs',
    'BG': 'bg', 'SK': 'sk', 'SI': 'si', 'LT': 'lt', 'LV': 'lv',
    'EE': 'ee', 'IS': 'is', 'LU': 'lu', 'MT': 'mt', 'CY': 'cy',
  };
  const flagCode = codeMap[countryCode.toUpperCase()] || countryCode.toLowerCase();
  return `https://flagcdn.com/w40/${flagCode}.png`;
}

export const CountrySelector: React.FC<CountrySelectorProps> = ({
  value,
  onChange,
  disabled = false,
  showFlag = true
}) => {
  const { i18n, t } = useTranslation();
  const [countries, setCountries] = useState<Array<{ code: string; name: string }>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    setIsLoading(true);
    
    // Get all countries in selected language
    const languageCode = i18n.language.split('-')[0];
    const supported = isoCountries.getNames(languageCode);
    
    if (!supported) {
      // Fallback to English if language not supported
      const allCountries = isoCountries.getNames('en');
      setCountries(
        Object.entries(allCountries).map(([code, name]) => ({ code, name }))
      );
    } else {
      setCountries(
        Object.entries(supported).map(([code, name]) => ({ code, name }))
      );
    }
    
    setIsLoading(false);
  }, [i18n.language]);

  // Filter countries based on search term - memoized
  const filteredCountries = useMemo(() =>
    countries.filter(country =>
      country.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      country.code.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [countries, searchTerm]
  );

  const selectedCountry = useMemo(() => 
    countries.find(c => c.code === value),
    [countries, value]
  );
  
  // Get display name even if countries are still loading
  const getSelectedCountryName = useCallback((): string => {
    if (selectedCountry) {
      return selectedCountry.name;
    }
    return t('common.select');
  }, [selectedCountry, t]);

  const handleSelect = useCallback((code: string) => {
    onChange(code);
    setIsOpen(false);
    setSearchTerm('');
  }, [onChange]);

  return (
    <div className="w-full">
      <label htmlFor="country-select" className="block text-sm font-medium text-gray-700 mb-2">
        {t('profile.country')}
      </label>

      <div className="relative">
        <button
          id="country-select"
          type="button"
          className={`w-full px-4 py-3 text-left bg-white border-2 border-gray-300 rounded-lg transition-colors ${
            isOpen ? 'border-blue-500 ring-2 ring-blue-100' : 'hover:border-gray-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} flex items-center justify-between`}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span className="flex items-center gap-3">
            {value && (
              <img 
                src={getCountryFlagUrl(value)}
                alt={value}
                className="w-8 h-6 rounded border border-gray-300 object-cover"
                title={value}
              />
            )}
            {!value && (
              <div className="w-8 h-6 rounded border border-gray-300 bg-gray-100 flex items-center justify-center text-gray-400">
                —
              </div>
            )}
            <span className="text-gray-700">
              {getSelectedCountryName()}
            </span>
          </span>
          <span className={`text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-gray-300 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
            {/* Search input */}
            <div className="p-3 border-b border-gray-200">
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('common.search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />
            </div>

            {/* Countries list */}
            <div className="overflow-y-auto flex-1">
              {isLoading ? (
                <div className="p-4 text-center text-gray-500">
                  {t('common.loading')}
                </div>
              ) : filteredCountries.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  {t('common.noResults')}
                </div>
              ) : (
                <ul className="divide-y divide-gray-100" role="listbox">
                  {filteredCountries.map((country) => (
                    <li
                      key={country.code}
                      role="option"
                      className={`px-4 py-3 cursor-pointer transition-colors flex items-center gap-3 ${
                        value === country.code
                          ? 'bg-blue-50 border-l-4 border-blue-500'
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={() => handleSelect(country.code)}
                    >
                      <img 
                        src={getCountryFlagUrl(country.code)}
                        alt={country.code}
                        className="w-8 h-6 rounded border border-gray-300 object-cover flex-shrink-0"
                        title={country.code}
                      />
                      <span className="text-gray-800 flex-1 min-w-0">
                        {country.name}
                      </span>
                      <span className="text-sm font-mono text-gray-500 flex-shrink-0 ml-auto">
                        {country.code}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Close dropdown when clicking outside */}
        {isOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
        )}
      </div>
    </div>
  );
};

export default CountrySelector;
