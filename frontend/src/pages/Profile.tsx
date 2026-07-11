import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { userService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import MainLayout from '../components/MainLayout';
import ProfileStats from '../components/ProfileStats';
import { CountrySelector } from '../components/CountrySelector';
import { AvatarSelector } from '../components/AvatarSelector';
import TimezoneSelector from '../components/TimezoneSelector';
import AvailabilityRangeEditor, { AvailabilitySchedule } from '../components/AvailabilityRangeEditor';

const Profile: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, user, setEnableRanked: setStoreEnableRanked } = useAuthStore();
  
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('');
  const [discordId, setDiscordId] = useState('');
  const [discordMessage, setDiscordMessage] = useState('');
  const [discordError, setDiscordError] = useState('');
  const [updatingDiscord, setUpdatingDiscord] = useState(false);
  const [validatingDiscord, setValidatingDiscord] = useState(false);
  const [discordValidationMessage, setDiscordValidationMessage] = useState('');
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [preferencesCollapsed, setPreferencesCollapsed] = useState(false);
  const [avatarSectionCollapsed, setAvatarSectionCollapsed] = useState(true);
  const [enableRanked, setEnableRanked] = useState(false);
  const [rankedMessage, setRankedMessage] = useState('');
  const [updatingRanked, setUpdatingRanked] = useState(false);
  const [timezone, setTimezone] = useState('UTC');
  const [availabilitySchedule, setAvailabilitySchedule] = useState<AvailabilitySchedule | null>(null);
  const [schedulingCollapsed, setSchedulingCollapsed] = useState(true);
  const [savingScheduling, setSavingScheduling] = useState(false);
  const [schedulingMessage, setSchedulingMessage] = useState('');

  const languages = useMemo(() => [
    { code: 'en', name: 'English', countryCode: 'gb' },
    { code: 'es', name: 'Español', countryCode: 'es' },
    { code: 'zh', name: '中文', countryCode: 'cn' },
    { code: 'de', name: 'Deutsch', countryCode: 'de' },
    { code: 'ru', name: 'Русский', countryCode: 'ru' },
  ], []);

  const currentLanguage = useMemo(() => 
    languages.find(l => l.code === selectedLanguage) || languages[0],
    [selectedLanguage, languages]
  );

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    const fetchData = async () => {
      try {
        // Fetch profile data
        const profileRes = await userService.getProfile();
        console.log('Profile data:', profileRes.data);
        console.log('Country from API:', profileRes.data.country);
        console.log('Avatar from API:', profileRes.data.avatar);
        console.log('Language from API:', profileRes.data.language);
        
        setProfile(profileRes.data);
        
        // Initialize selectors with values from profile
        if (profileRes.data.country) {
          setSelectedCountry(profileRes.data.country);
        }
        if (profileRes.data.avatar) {
          setSelectedAvatar(profileRes.data.avatar);
        }
        
        // Set language from profile
        const langFromDB = profileRes.data.language || 'en';
        console.log('Setting selectedLanguage to:', langFromDB);
        setSelectedLanguage(langFromDB);
        setDiscordId(profileRes.data.discord_id || '');
        setEnableRanked(!!profileRes.data.enable_ranked);
        
        // Set timezone and availability from profile
        setTimezone(profileRes.data.timezone || 'UTC');
        setAvailabilitySchedule(profileRes.data.availability_schedule || null);
        
        console.log('Discord ID from API:', profileRes.data.discord_id);
        
        // Change i18n if different
        if (langFromDB !== i18n.language) {
          i18n.changeLanguage(langFromDB);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated, navigate, i18n]);

  const handleLanguageChange = useCallback(async (lang: string) => {
    setSelectedLanguage(lang);
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
    setLanguageDropdownOpen(false);
    setDiscordMessage(t('profile_language_updated') || 'Language updated');
    setTimeout(() => setDiscordMessage(''), 3000);
  }, [t, i18n]);

  const handleCountryChange = useCallback(async (countryCode: string) => {
    setSelectedCountry(countryCode);
    try {
      const res = await userService.updateProfile({ country: countryCode });
      setProfile(res.data);
      setDiscordMessage(t('profile.country_updated') || 'Country updated');
      setTimeout(() => setDiscordMessage(''), 3000);
    } catch (err: any) {
      console.error('Error updating country:', err);
      setDiscordError(err.response?.data?.error || t('profile.error_update_country_failed'));
    }
  }, [t]);

  const handleAvatarChange = useCallback(async (avatarId: string) => {
    setSelectedAvatar(avatarId);
    try {
      const res = await userService.updateProfile({ avatar: avatarId });
      setProfile(res.data);
      setDiscordMessage(t('profile.avatar_updated') || 'Avatar updated');
      setTimeout(() => setDiscordMessage(''), 3000);
    } catch (err: any) {
      console.error('Error updating avatar:', err);
      setDiscordError(err.response?.data?.error || t('profile.error_update_avatar_failed'));
    }
  }, [t]);

  const handleDiscordUpdate = useCallback(async () => {
    if (!discordId.trim()) {
      setDiscordError(t('profile.error_discord_empty'));
      return;
    }

    setUpdatingDiscord(true);
    setDiscordError('');
    setDiscordMessage('');

    try {
      // Debug: show payload and token presence
      console.log('Attempting Discord ID update, payload:', { discordId });
      const token = localStorage.getItem('token');
      console.log('Auth token present:', !!token);

      const res = await userService.updateDiscordId(discordId);
      console.log('Discord update response:', res);
      setProfile(res.data);
      setDiscordMessage(t('discord_id_updated'));
      setTimeout(() => setDiscordMessage(''), 3000);
    } catch (err: any) {
      console.error('Error updating Discord ID:', err);
      // Prefer server message, then axios message, then generic
      const serverMsg = err?.response?.data?.error;
      const axiosMsg = err?.message;
      setDiscordError(serverMsg || axiosMsg || t('profile.error_update_discord_failed'));
    } finally {
      setUpdatingDiscord(false);
    }
  }, [discordId, t]);

  const isValidDiscordIdFormat = useCallback((id: string): boolean => {
    return /^\d{17,20}$/.test(id.trim());
  }, []);

  const handleValidateDiscordId = useCallback(async () => {
    if (!discordId.trim()) {
      setDiscordError(t('profile.error_discord_empty'));
      return;
    }

    if (!isValidDiscordIdFormat(discordId)) {
      setDiscordError(t('profile.error_discord_invalid'));
      return;
    }

    setValidatingDiscord(true);
    setDiscordError('');
    setDiscordValidationMessage('');

    try {
      const response = await userService.validateDiscordId(discordId);
      const nickname = response.data?.nickname || response.data?.discord_id || discordId.trim();
      setDiscordValidationMessage(t('profile.discord_validation_sent', { nickname }));
      setTimeout(() => setDiscordValidationMessage(''), 5000);
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error;
      setDiscordError(serverMsg || t('profile.discord_validation_failed'));
    } finally {
      setValidatingDiscord(false);
    }
  }, [discordId, isValidDiscordIdFormat, t]);

   const handleRankedToggle = useCallback(async (newValue: boolean) => {
    // Prevent disabling if already enabled
    if (!newValue && enableRanked) {
      setRankedMessage(t('profile.ranked_cannot_disable', 'Ranked matches cannot be disabled once enabled'));
      setTimeout(() => setRankedMessage(''), 3000);
      return;
    }

    setUpdatingRanked(true);
    setRankedMessage('');
    try {
      await userService.updateRankedStatus(newValue);
      setEnableRanked(newValue);
      setStoreEnableRanked(newValue);
      setRankedMessage(t('profile.ranked_updated', 'Ranked preference updated'));
      setTimeout(() => setRankedMessage(''), 3000);
    } catch (err: any) {
      setRankedMessage(err?.response?.data?.error || t('profile.error_ranked_update', 'Error updating ranked preference'));
    } finally {
      setUpdatingRanked(false);
    }
  }, [enableRanked, t]);

  const handleSaveScheduling = useCallback(async () => {
    setSavingScheduling(true);
    setSchedulingMessage('');
    try {
      await userService.updateProfile({
        timezone,
        availability_schedule: availabilitySchedule
      });
      setSchedulingMessage(t('profile.scheduling_saved', 'Scheduling preferences saved successfully'));
      setTimeout(() => setSchedulingMessage(''), 3000);
    } catch (err: any) {
      setSchedulingMessage(err?.response?.data?.error || err?.response?.data?.details?.[0] || t('profile.error_scheduling_update', 'Error updating scheduling preferences'));
    } finally {
      setSavingScheduling(false);
    }
  }, [timezone, availabilitySchedule, t]);

  if (loading) {
    return <div className="auth-container"><p>{t('loading')}</p></div>;
  }

  if (!profile) {
    return <div className="auth-container"><p>{t('profile.not_found')}</p></div>;
  }

  return (
    <MainLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-300 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-gray-800 mb-8 text-center">{t('profile.title')}</h1>

          {profile && (
            <>
              <ProfileStats player={profile} />

              <section className="bg-white rounded-lg shadow-md p-8 mb-8">
                <h2 className="text-2xl font-semibold text-gray-800 mb-6 pb-4 border-b-2 border-gray-200">{t('profile.discord_title')}</h2>
                {discordMessage && <p className="bg-green-100 text-green-800 px-4 py-3 rounded-lg mb-4 border-l-4 border-green-600">{discordMessage}</p>}
                {discordValidationMessage && <p className="bg-blue-100 text-blue-800 px-4 py-3 rounded-lg mb-4 border-l-4 border-blue-600">{discordValidationMessage}</p>}
                {discordError && <p className="bg-red-100 text-red-800 px-4 py-3 rounded-lg mb-4 border-l-4 border-red-600">{discordError}</p>}
                <div className="flex gap-3 max-md:flex-col">
                  <input
                    type="text"
                    placeholder={t('profile.discord_placeholder')}
                    value={discordId}
                    onChange={(e) => setDiscordId(e.target.value)}
                    className="flex-1 px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
                  />
                  <button 
                    onClick={handleDiscordUpdate} 
                    disabled={updatingDiscord || validatingDiscord}
                    className="px-6 py-3 max-md:w-full bg-gradient-to-r from-purple-500 to-purple-700 text-white rounded-lg font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {updatingDiscord ? t('profile.updating') : t('profile.update_discord_button')}
                  </button>
                  <button
                    onClick={handleValidateDiscordId}
                    disabled={updatingDiscord || validatingDiscord || !isValidDiscordIdFormat(discordId)}
                    className="px-6 py-3 max-md:w-full bg-gradient-to-r from-blue-500 to-blue-700 text-white rounded-lg font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {validatingDiscord ? t('profile.updating_discord_validation') : t('profile.validate_discord_button')}
                  </button>
                </div>
              </section>

              <section className="bg-white rounded-lg shadow-md p-8 mb-8">
                <h2 className="text-2xl font-semibold text-gray-800 mb-6 pb-4 border-b-2 border-gray-200">{t('profile_language_settings')}</h2>
                <div className="relative inline-block">
                  <button 
                    className="px-4 py-2 border border-gray-200 rounded-lg bg-white text-gray-800 font-semibold hover:border-blue-500 hover:bg-gray-50 transition-all flex items-center gap-2"
                    onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                  >
                    <img 
                      src={`https://flagcdn.com/w20/${currentLanguage.countryCode}.png`}
                      alt={currentLanguage.code}
                      className="w-6 h-4 rounded"
                    />
                    <span>{currentLanguage.code.toUpperCase()}</span>
                  </button>
                  {languageDropdownOpen && (
                    <div className="absolute top-full left-0 mt-2 bg-white text-gray-800 min-w-max rounded-lg shadow-lg z-50 border border-gray-200 overflow-hidden">
                      {languages.map((lang) => (
                        <button
                          key={lang.code}
                          className={`flex items-center gap-3 w-full px-4 py-3 text-left transition-colors ${
                            lang.code === selectedLanguage 
                              ? 'bg-gradient-to-r from-gray-100 to-blue-100 text-blue-600 font-semibold border-l-4 border-blue-500 pl-3' 
                              : 'hover:bg-gray-50'
                          }`}
                          onClick={() => handleLanguageChange(lang.code)}
                        >
                          <img 
                            src={`https://flagcdn.com/w20/${lang.countryCode}.png`}
                            alt={lang.code}
                            className="w-6 h-4 rounded"
                          />
                          <span>{lang.code.toUpperCase()} - {lang.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="bg-white rounded-lg shadow-md mb-8">
                <div 
                  className="p-8 cursor-pointer flex justify-between items-center hover:bg-gray-50 transition-colors"
                  onClick={() => setPreferencesCollapsed(!preferencesCollapsed)}
                >
                  <h2 className="text-2xl font-semibold text-gray-800 pb-0">{t('profile.preferences_title') || 'Preferences'}</h2>
                  <svg 
                    className={`w-6 h-6 text-gray-600 transition-transform ${preferencesCollapsed ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
                {!preferencesCollapsed && (
                  <div className="p-8 pt-0 border-t border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <CountrySelector
                        value={selectedCountry}
                        onChange={handleCountryChange}
                        showFlag={true}
                      />
                    </div>
                  </div>
                )}
              </section>

              <section className="bg-white rounded-lg shadow-md mb-8">
                <div className="p-8 cursor-pointer hover:bg-gray-50 transition-colors flex items-center justify-between" onClick={() => setAvatarSectionCollapsed(!avatarSectionCollapsed)}>
                  <h2 className="text-2xl font-semibold text-gray-800 pb-0">{t('profile.avatar') || 'Avatar'}</h2>
                  <svg 
                    className={`w-6 h-6 text-gray-600 transition-transform ${avatarSectionCollapsed ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
                {!avatarSectionCollapsed && (
                  <div className="p-8 pt-0 border-t border-gray-200">
                    <AvatarSelector
                      value={selectedAvatar}
                      onChange={handleAvatarChange}
                    />
                  </div>
                )}
              </section>

              <section className="bg-white rounded-lg shadow-md p-8 mb-8">
                <h2 className="text-2xl font-semibold text-gray-800 mb-6 pb-4 border-b-2 border-gray-200">{t('profile.ranked_title', 'Ranked Matches')}</h2>
                <p className="text-gray-600 mb-4">
                  {enableRanked 
                    ? t('profile.ranked_description_enabled', 'Once activated, ranked matches cannot be disabled. Your results will continue to affect your ELO rating.')
                    : t('profile.ranked_description', 'Enable this option to participate in ranked matches. Once activated, this option cannot be disabled. Your results will affect your ELO rating.')}
                </p>
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={enableRanked}
                      disabled={updatingRanked || enableRanked}
                      onChange={(e) => handleRankedToggle(e.target.checked)}
                    />
                    <div className={`w-12 h-6 rounded-full transition-colors ${enableRanked ? 'bg-blue-500' : 'bg-gray-300'} ${updatingRanked || enableRanked ? 'opacity-50 cursor-not-allowed' : ''}`} />
                    <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${enableRanked ? 'translate-x-6' : 'translate-x-0'}`} />
                  </div>
                  <span className="text-gray-700 font-medium">
                    {enableRanked ? t('profile.ranked_enabled', 'Ranked matches enabled') : t('profile.ranked_disabled', 'Ranked matches disabled')}
                  </span>
                  {enableRanked && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">{t('profile.ranked_permanent', 'Permanent')}</span>}
                </label>
                {rankedMessage && (
                  <p className={`mt-3 text-sm ${rankedMessage.includes('cannot') ? 'text-yellow-700 bg-yellow-50' : 'text-green-700 bg-green-50'} px-3 py-2 rounded`}>{rankedMessage}</p>
                )}
              </section>

              <section className="bg-white rounded-lg shadow-md mb-8">
                <div 
                  className="p-8 cursor-pointer flex justify-between items-center hover:bg-gray-50 transition-colors"
                  onClick={() => setSchedulingCollapsed(!schedulingCollapsed)}
                >
                  <h2 className="text-2xl font-semibold text-gray-800 pb-0">{t('availability.title') || 'Scheduling Preferences'}</h2>
                  <svg 
                    className={`w-6 h-6 text-gray-600 transition-transform ${schedulingCollapsed ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
                {!schedulingCollapsed && (
                  <div className="p-8 pt-0 border-t border-gray-200">
                    {schedulingMessage && (
                      <p className={`mb-4 px-4 py-3 rounded-lg border-l-4 ${
                        schedulingMessage.includes('Error') || schedulingMessage.includes('error')
                          ? 'bg-red-100 text-red-800 border-red-600'
                          : 'bg-green-100 text-green-800 border-green-600'
                      }`}>
                        {schedulingMessage}
                      </p>
                    )}
                    <div className="space-y-6">
                      <TimezoneSelector 
                        value={timezone} 
                        onChange={setTimezone}
                      />
                      
                      <AvailabilityRangeEditor 
                        value={availabilitySchedule} 
                        onChange={setAvailabilitySchedule}
                      />

                      <button
                        onClick={handleSaveScheduling}
                        disabled={savingScheduling}
                        className="w-full px-6 py-3 bg-gradient-to-r from-green-500 to-green-700 text-white rounded-lg font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {savingScheduling ? t('profile.saving') : t('common.save') || 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className="bg-white rounded-lg shadow-md p-8 mb-8">
                <h2 className="text-2xl font-semibold text-gray-800 mb-6 pb-4 border-b-2 border-gray-200">{t('password_change_title')}</h2>
                <p className="text-gray-600 mb-4">{t('profile.password_managed_by_forum', 'Your password is managed by the official Wesnoth website.')}</p>
                <a
                  href="https://forums.wesnoth.org/ucp.php?mode=sendpassword"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-6 py-3 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors"
                >
                  {t('profile.change_password_on_forum', 'Change Password on Wesnoth Forum')}
                </a>
              </section>
            </>
          )}
        </div>
      </div>
    </MainLayout>
  );
};

export default Profile;
