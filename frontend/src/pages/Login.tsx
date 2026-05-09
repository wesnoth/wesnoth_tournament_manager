import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authService, userService } from '../services/api';
import { useAuthStore } from '../store/authStore';

const Login: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { setToken, setUserId, setIsAdmin, setIsTournamentModerator, setEnableRanked } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [banInfo, setBanInfo] = useState<{ reason?: string; until?: string | null } | null>(null);
  const [lockoutInfo, setLockoutInfo] = useState<{ remainingSeconds?: number } | null>(null);
  const [blockedInfo, setBlockedInfo] = useState<{ message?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setBanInfo(null);
    setLockoutInfo(null);
    setBlockedInfo(null);
    
    try {
      const response = await authService.login(username, password);
      
      if (!response.data.token || !response.data.userId) {
        throw new Error('Invalid response: missing token or userId');
      }
      
      setToken(response.data.token);
      setUserId(response.data.userId);
      localStorage.setItem('username', response.data.username);
      setIsTournamentModerator(response.data.isTournamentModerator || false);
      
      // Get user profile to check if admin and set language
      try {
        const profileRes = await userService.getProfile();
        setIsAdmin(profileRes.data.is_admin || false);
        setEnableRanked(!!profileRes.data.enable_ranked);
        
        const userLanguage = profileRes.data.language || 'en';
        if (userLanguage !== i18n.language) {
          i18n.changeLanguage(userLanguage);
        }
      } catch (err) {
        console.error('Error getting profile:', err);
        setIsAdmin(false);
      }
      
      navigate('/');
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.error === 'forum_banned') {
        setBanInfo({ reason: data.banReason, until: data.banUntil });
      } else if (data?.error === 'account_blocked') {
        setBlockedInfo({ message: data.message });
      } else if (data?.error === 'account_locked') {
        setLockoutInfo({ remainingSeconds: data.remainingSeconds });
      } else {
        setError(data?.error || 'Login failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatBanUntil = (until?: string | null): string => {
    if (!until) return t('login_ban_permanent', 'permanently');
    return t('login_ban_until', { date: new Date(until).toLocaleDateString() });
  };

  return (
    <div className="w-full max-w-4xl mx-auto my-12 px-4 bg-white rounded-lg shadow-sm py-8">
      <h1 className="text-center mb-2 text-2xl font-bold text-gray-800">{t('login_title')}</h1>
      <p className="text-center mb-6 text-gray-600">{t('login_wesnoth_account', 'Log in with your Wesnoth forum account')}</p>
      
      {error && (
        <p className="bg-red-100 text-red-800 px-4 py-3 rounded-md mb-4 border-l-4 border-red-600">
          {error}
        </p>
      )}

      {banInfo && (
        <div className="bg-red-50 text-red-900 px-4 py-3 rounded-md mb-4 border-l-4 border-red-700">
          <p className="font-semibold">{t('login_ban_title', 'Your account is banned from the Wesnoth forum')}</p>
          {banInfo.reason && <p className="text-sm mt-1">{t('login_ban_reason', 'Reason')}: {banInfo.reason}</p>}
          <p className="text-sm mt-1">{t('login_ban_duration', 'Duration')}: {formatBanUntil(banInfo.until)}</p>
        </div>
      )}

      {lockoutInfo && (
        <div className="bg-yellow-50 text-yellow-900 px-4 py-3 rounded-md mb-4 border-l-4 border-yellow-700">
          <p className="font-semibold">{t('login_account_locked', 'Account temporarily locked')}</p>
          <p className="text-sm mt-1">
            {t('login_account_locked_reason', 'Too many failed login attempts. Please try again in {{minutes}} minute(s)', {
              minutes: Math.ceil((lockoutInfo.remainingSeconds || 0) / 60)
            })}
          </p>
        </div>
      )}

      {blockedInfo && (
        <div className="bg-red-50 text-red-900 px-4 py-3 rounded-md mb-4 border-l-4 border-red-700">
          <p className="font-semibold">{t('login_account_blocked', 'Account blocked')}</p>
          <p className="text-sm mt-1">{blockedInfo.message || t('login_account_blocked_reason', 'Your account has been blocked by an administrator')}</p>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          placeholder={t('login_username', 'Wesnoth Forum Username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
          required
          disabled={loading}
          autoFocus
        />
        
        <input
          type="password"
          placeholder={t('login_password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
          required
          disabled={loading}
        />
        
        <button 
          type="submit" 
          disabled={loading} 
          className="w-full px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? t('login_loading', 'Logging in...') : t('login_button')}
        </button>
      </form>
      
      <div className="mt-6 space-y-4 text-sm text-gray-600">
        <p className="text-center">
          {t('login_need_account', "Don't have a Wesnoth account?")}{' '}
          <a 
            href="https://forum.wesnoth.org/ucp.php?mode=register" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            {t('login_create_wesnoth', 'Register on Wesnoth Forum')}
          </a>
        </p>
        
        <p className="text-center">
          {t('login_forgot_password', 'Forgot your password?')}{' '}
          <a 
            href="https://forum.wesnoth.org/ucp.php?mode=sendpassword" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            {t('login_reset_password', 'Reset it on Wesnoth Forum')}
          </a>
        </p>
      </div>
    </div>
  );
};

export default Login;
