import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { userService } from '../services/api';
import { getHelpSlugFromPath } from '../utils/helpNavigation';

/** Minimal notification shape required by the navbar dropdown. */
interface NavbarNotification {
  id: string;
  type: string;
  tournament_id?: string | null;
  match_id?: string | null;
  title: string;
  message: string;
  message_extra?: string | null;
  created_at: string;
  is_read: boolean;
}

const Navbar: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isAdmin, logout } = useAuthStore();
  const [userNickname, setUserNickname] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [notificationsDropdownOpen, setNotificationsDropdownOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState<NavbarNotification[]>([]);
  const userBtnRef = useRef<HTMLButtonElement>(null);
  const languageBtnRef = useRef<HTMLButtonElement>(null);
  const languageBtnMobileRef = useRef<HTMLButtonElement>(null);
  const notificationsBtnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; right: number } | null>(null);
  const [languageDropdownPosition, setLanguageDropdownPosition] = useState<{ top: number; right: number } | null>(null);
  const [notificationsDropdownPosition, setNotificationsDropdownPosition] = useState<{ top: number; right: number } | null>(null);

  // Helper function to get translation safely
  const getTranslation = (key: string, fallback: string): string => {
    const result = t(key);
    if (result === key) {
      return fallback;
    }
    return result || fallback;
  };

  const languages = [
    { code: 'en', name: 'English', countryCode: 'gb' },
    { code: 'es', name: 'Español', countryCode: 'es' },
    { code: 'zh', name: '中文', countryCode: 'cn' },
    { code: 'de', name: 'Deutsch', countryCode: 'de' },
    { code: 'ru', name: 'Русский', countryCode: 'ru' },
  ];

  const currentLanguage = languages.find(l => l.code === i18n.language) || languages[0];

  useEffect(() => {
    if (isAuthenticated) {
      const fetchUserProfile = async () => {
        try {
          const res = await userService.getProfile();
          setUserNickname(res.data.nickname);
        } catch (err) {
          console.error('Error fetching profile:', err);
        }
      };
      fetchUserProfile();

      // Load the persisted unread count for the navbar badge.
      const loadUnreadCount = async () => {
        try {
          const token = localStorage.getItem('token');
          const response = await fetch('/api/notifications/unread-count', {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          if (response.ok) {
            const data = await response.json();
            setUnreadCount(data.unreadCount || 0);
          }
        } catch (err) {
          console.error('Error loading unread count:', err);
        }
      };

      // Load recent persisted notifications for the dropdown.
      const loadRecentNotifications = async () => {
        try {
          const token = localStorage.getItem('token');
          const response = await fetch('/api/notifications/pending?limit=5', {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          if (response.ok) {
            const data = await response.json();
            setRecentNotifications(data.notifications || []);
          }
        } catch (err) {
          console.error('Error loading recent notifications:', err);
        }
      };

      loadUnreadCount();
      loadRecentNotifications();

      // Poll the HTTP count because the application has no push notification channel.
      const interval = setInterval(loadUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  // Calculate dropdown position when it opens
  useEffect(() => {
    if (dropdownOpen && userBtnRef.current) {
      const rect = userBtnRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY,
        right: window.innerWidth - rect.right,
      });
    }
  }, [dropdownOpen]);

  // Calculate language dropdown position when it opens
  useEffect(() => {
    if (languageDropdownOpen) {
      // Use whichever button is actually visible (offsetParent is null for hidden elements)
      const ref = (languageBtnRef.current && languageBtnRef.current.offsetParent)
        ? languageBtnRef.current
        : (languageBtnMobileRef.current && languageBtnMobileRef.current.offsetParent)
          ? languageBtnMobileRef.current
          : null;
      if (ref) {
        const rect = ref.getBoundingClientRect();
        setLanguageDropdownPosition({
          top: rect.bottom + window.scrollY,
          right: window.innerWidth - rect.right,
        });
      }
    }
  }, [languageDropdownOpen]);

  // Calculate notifications dropdown position when it opens
  useEffect(() => {
    if (notificationsDropdownOpen && notificationsBtnRef.current) {
      const rect = notificationsBtnRef.current.getBoundingClientRect();
      setNotificationsDropdownPosition({
        top: rect.bottom + window.scrollY,
        right: window.innerWidth - rect.right,
      });
    }
  }, [notificationsDropdownOpen]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.user-menu') && !target.closest('.language-dropdown') && !target.closest('.notifications-menu')) {
        setDropdownOpen(false);
        setLanguageDropdownOpen(false);
        setNotificationsDropdownOpen(false);
      }
    };

    if (dropdownOpen || languageDropdownOpen || notificationsDropdownOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [dropdownOpen, languageDropdownOpen, notificationsDropdownOpen]);

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
    setLanguageDropdownOpen(false);
  };

  const handleLogout = () => {
    logout();
    setDropdownOpen(false);
    navigate('/');
  };

  const handleNavigateAndClose = (path: string) => {
    setDropdownOpen(false);
    navigate(path);
  };

  return (
    <nav className="w-full bg-primary text-white shadow-sm p-3 min-h-[60px] flex items-center relative z-[999] overflow-hidden max-nav:flex-col max-nav:min-h-auto max-nav:gap-2">
      <div className="w-full max-w-full mx-auto px-2 flex justify-between items-center gap-2 relative z-[999] max-nav:w-full max-nav:flex-col max-nav:gap-2 overflow-x-auto -webkit-overflow-scrolling-touch">
        
        {/* Brand + Language Selector Row */}
        <div className="flex justify-between items-center gap-4 max-nav:w-full max-nav:gap-2">
          {/* Brand */}
          <div className="flex-shrink-0 min-w-fit">
            <Link to="/" className="text-2xl font-bold text-white hover:opacity-90 transition-opacity max-sm:text-xl">
              {t('app_name')}
            </Link>
          </div>

          {/* Language Selector for Mobile */}
          <div className="hidden max-nav:flex gap-1 flex-shrink-0">
            <div className="language-dropdown relative z-[2000]">
              <button 
                ref={languageBtnMobileRef}
                className="px-2 py-2 bg-white/10 text-white border border-white/30 rounded hover:bg-white/20 transition-all flex items-center gap-1 font-semibold max-sm:px-1 max-sm:text-xs"
                onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                title="Change language"
              >
                <img 
                  src={`https://flagcdn.com/w20/${currentLanguage.countryCode}.png`}
                  alt={currentLanguage.code}
                  className="w-5 h-3 rounded flex-shrink-0"
                />
              </button>
            </div>
          </div>
        </div>

        {/* Links and Controls Container */}
        <div className="flex flex-1 justify-between items-center gap-2 max-nav:w-full max-nav:flex-col-reverse">
          {/* Links */}
          <div className="flex flex-1 justify-center items-center gap-2 max-nav:overflow-x-auto max-nav:-webkit-overflow-scrolling-touch max-nav:scrollbar-none max-nav:w-full max-nav:flex-nowrap min-w-0">
          <Link to="/" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('navbar_home')}
          </Link>
          <Link to="/players" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('navbar_players')}
          </Link>
          <Link to="/rankings" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('navbar_ranking')}
          </Link>
          <Link to="/statistics" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('statistics') || 'Statistics'}
          </Link>
          <Link to="/tournaments" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('navbar_tournaments')}
          </Link>
          <Link to="/events" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('navbar_events')}
          </Link>
          <Link to="/matches" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('navbar_matches')}
          </Link>
          <Link to="/faq" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('navbar_faq')}
          </Link>
          <Link to="/news" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
            {t('navbar_news')}
          </Link>
          <button 
            onClick={() => {
              const helpSlug = getHelpSlugFromPath(location.pathname);
              navigate(`/help/${helpSlug}`);
            }}
            className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm"
            title={`Help for ${getHelpSlugFromPath(location.pathname)}`}
          >
            {t('help')}
          </button>

          {/* Notifications Bell - Only for Authenticated Users */}
          {isAuthenticated && (
            <div className="notifications-menu relative self-center z-[2000] flex-shrink-0">
              <button
                ref={notificationsBtnRef}
                className="relative px-3 py-2 bg-white/10 text-white hover:bg-white/20 rounded transition-all flex items-center gap-2 max-sm:px-2 max-sm:py-1.5 max-nav:px-2.5 max-nav:py-1.5"
                onClick={() => setNotificationsDropdownOpen(!notificationsDropdownOpen)}
                title="Notifications"
              >
                <span className="text-lg">🔔</span>
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Notifications Dropdown */}
              {notificationsDropdownOpen && notificationsDropdownPosition && createPortal(
                <div
                  className="bg-white text-gray-800 w-80 rounded shadow-lg z-[9999] overflow-hidden flex flex-col max-h-96"
                  style={{
                    position: 'fixed',
                    top: `${notificationsDropdownPosition.top}px`,
                    right: `${notificationsDropdownPosition.right}px`,
                    left: 'auto',
                  }}
                >
                  <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 font-semibold text-gray-800">
                    {getTranslation('notifications_title', 'Notifications')}
                  </div>

                  {/* Recent Notifications List */}
                  <div className="flex-1 overflow-y-auto">
                    {recentNotifications.length > 0 ? (
                      recentNotifications.map((notif) => (
                        <div
                          key={notif.id}
                          onClick={() => {
                            if (typeof notif.type === 'string' && notif.type.startsWith('challenge_')) {
                              navigate('/events');
                            } else if (notif.tournament_id && notif.match_id) {
                              navigate(`/tournament/${notif.tournament_id}?tab=roundMatches&matchId=${notif.match_id}`);
                            }
                            setNotificationsDropdownOpen(false);
                          }}
                          className={`px-4 py-3 border-b border-gray-100 transition-colors cursor-pointer ${
                            notif.tournament_id && notif.match_id
                              ? 'hover:bg-green-50 hover:border-green-200'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm text-gray-800 truncate">
                                {notif.title}
                              </p>
                              <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                {notif.message}
                              </p>
                              {notif.message_extra && (
                                <p className="text-xs text-gray-500 mt-1 italic">
                                  💬 {notif.message_extra.substring(0, 60)}...
                                </p>
                              )}
                              <p className="text-xs text-gray-400 mt-1">
                                {new Date(notif.created_at).toLocaleDateString()}
                              </p>
                              {notif.type?.startsWith?.('challenge_') ? (
                                <p className="text-xs text-blue-600 font-semibold mt-1">
                                  → {t('navbar_events') || 'Events'}
                                </p>
                              ) : notif.tournament_id && notif.match_id ? (
                                <p className="text-xs text-green-600 font-semibold mt-1">
                                  → {t('label_go_tournament') || 'Go to Tournament'}
                                </p>
                              ) : null}
                            </div>
                            {!notif.is_read && (
                              <span className="bg-blue-500 rounded-full w-2 h-2 flex-shrink-0 mt-1"></span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-6 text-center text-gray-500 text-sm">
                        {getTranslation('notifications_empty', 'No notifications')}
                      </div>
                    )}
                  </div>

                  {/* Always provide a route to the full notification history. */}
                  <button
                    onClick={() => {
                      navigate('/notifications');
                      setNotificationsDropdownOpen(false);
                    }}
                    className="w-full px-4 py-2 text-center text-blue-600 hover:bg-blue-50 border-t border-gray-200 text-sm font-semibold transition-colors"
                  >
                    {getTranslation('notifications_view_all', 'View All')}
                  </button>
                </div>,
                document.body
              )}
            </div>
          )}

          {/* User Menu */}
          {isAuthenticated && (
            <div className="user-menu relative self-center z-[2000] flex-shrink-0">
              <button 
                ref={userBtnRef}
                className="bg-secondary text-white px-3 py-2 rounded font-semibold hover:bg-blue-700 transition-colors max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm flex-shrink-0 whitespace-nowrap"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                {userNickname} ▼
              </button>
              {dropdownOpen && dropdownPosition && createPortal(
                <div 
                  className="bg-white text-gray-800 w-48 rounded shadow-md z-[9999] overflow-hidden flex flex-col min-w-[180px]"
                  style={{
                    position: 'fixed',
                    top: `${dropdownPosition.top}px`,
                    right: `${dropdownPosition.right}px`,
                    left: 'auto',
                  }}
                >
                  <button 
                    className="block w-full text-left px-4 py-3 hover:bg-gray-100 transition-colors text-sm"
                    onClick={() => handleNavigateAndClose('/user')}
                  >
                    {t('navbar_profile') || 'Profile'}
                  </button>
                  <button 
                    className="block w-full text-left px-4 py-3 hover:bg-red-50 transition-colors text-sm border-t border-gray-200 text-danger font-semibold"
                    onClick={handleLogout}
                  >
                    {t('navbar_logout') || 'Logout'}
                  </button>
                </div>,
                document.body
              )}
            </div>
          )}

          {/* Auth Links */}
          {!isAuthenticated && (
            <>
              <Link to="/login" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
                {t('navbar_login')}
              </Link>
              <Link to="/register" className="text-white hover:bg-white/10 px-3 py-2 rounded transition-colors min-h-[40px] flex items-center flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-nav:px-2.5 max-nav:py-1.5 max-nav:text-sm">
                {t('navbar_register')}
              </Link>
            </>
          )}
          </div>

          {/* Language Selector - Desktop Only */}
          <div className="hidden nav:flex gap-1 flex-shrink-0 min-w-fit">
            <div className="language-dropdown relative z-[2000]">
              <button 
                ref={languageBtnRef}
                className="px-2 py-2 bg-white/10 text-white border border-white/30 rounded hover:bg-white/20 transition-all flex items-center gap-1 font-semibold"
                onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                title="Change language"
              >
                <img 
                  src={`https://flagcdn.com/w20/${currentLanguage.countryCode}.png`}
                alt={currentLanguage.code}
                className="w-5 h-3 rounded flex-shrink-0 max-sm:w-4 max-sm:h-2.5"
              />
              <span className="text-sm max-sm:hidden max-nav:text-xs">{currentLanguage.code.toUpperCase()}</span>
            </button>
            {languageDropdownOpen && languageDropdownPosition && createPortal(
              <div 
                className="bg-white text-gray-800 min-w-[150px] rounded shadow-md z-[9999] overflow-hidden flex flex-col"
                style={{
                  position: 'fixed',
                  top: `${languageDropdownPosition.top}px`,
                  right: `${languageDropdownPosition.right}px`,
                  left: 'auto',
                }}
              >
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    className={`flex items-center gap-2 w-full text-left px-3 py-2 transition-colors text-xs md:text-sm ${
                      lang.code === i18n.language 
                        ? 'bg-blue-100 font-semibold text-secondary' 
                        : 'hover:bg-gray-100'
                    }`}
                    onClick={() => changeLanguage(lang.code)}
                  >
                    <img 
                      src={`https://flagcdn.com/w20/${lang.countryCode}.png`}
                      alt={lang.code}
                      className="w-5 h-3 rounded flex-shrink-0"
                    />
                    <span className="text-xs md:text-sm">{lang.code.toUpperCase()}</span>
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>
        </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
