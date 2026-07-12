import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const UserProfileNav: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAdmin, isTournamentModerator } = useAuthStore();
  const isModerator = isTournamentModerator && !isAdmin;

  const handleNavigate = (path: string) => {
    navigate(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <nav className="w-full bg-gradient-dark-blue border-b-2 border-blue-900 py-3 px-4 sticky top-0 z-100 shadow-md max-md:overflow-x-auto max-md:-webkit-overflow-scrolling-touch">
      <div className="max-w-7xl mx-auto w-full">
        <div className="flex flex-wrap max-md:flex-nowrap items-center gap-2 justify-start w-full max-md:overflow-x-auto max-md:-webkit-overflow-scrolling-touch">
          {/* My Profile */}
          <button 
            className="flex items-center gap-2 px-3 py-2 bg-white/10 border border-white/20 text-white text-sm font-medium rounded hover:bg-white/20 hover:border-white/40 active:bg-white/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
            onClick={() => handleNavigate('/profile')}
            title={t('sidebar.my_profile')}
          >
            <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">👤</span>
            <span className="hidden md:inline">{t('sidebar.my_profile')}</span>
          </button>

          {/* My Tournaments */}
          <button 
            className="flex items-center gap-2 px-3 py-2 bg-white/10 border border-white/20 text-white text-sm font-medium rounded hover:bg-white/20 hover:border-white/40 active:bg-white/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
            onClick={() => handleNavigate('/my-tournaments')}
            title={t('sidebar.my_tournaments')}
          >
            <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">🏆</span>
            <span className="hidden md:inline">{t('sidebar.my_tournaments')}</span>
          </button>

          {/* My Notifications */}
          <button 
            className="flex items-center gap-2 px-3 py-2 bg-white/10 border border-white/20 text-white text-sm font-medium rounded hover:bg-white/20 hover:border-white/40 active:bg-white/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
            onClick={() => handleNavigate('/notifications')}
            title={t('sidebar.my_notifications')}
          >
            <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">🔔</span>
            <span className="hidden md:inline">{t('sidebar.my_notifications')}</span>
          </button>

          {/* Help */}
          <button 
            className="flex items-center gap-2 px-3 py-2 bg-white/10 border border-white/20 text-white text-sm font-medium rounded hover:bg-white/20 hover:border-white/40 active:bg-white/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
            onClick={() => handleNavigate('/help')}
            title={t('help')}
          >
            <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">❓</span>
            <span className="hidden md:inline">{t('help')}</span>
          </button>

          {/* Admin/Moderator Separator */}
          {(isAdmin || isTournamentModerator) && (
            <div className="w-px h-6 bg-white/30 mx-2 max-sm:hidden"></div>
          )}

          {/* Moderator-only links (subset) */}
          {isModerator && (
            <>
              {/* Manage Users */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin')}
                title={t('sidebar.manage_users')}
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">👥</span>
                <span className="hidden md:inline">{t('sidebar.manage_users')}</span>
              </button>

              {/* Disputes */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/disputes')}
                title={t('sidebar.match_disputes')}
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">⚖️</span>
                <span className="hidden md:inline">{t('sidebar.match_disputes')}</span>
              </button>

              {/* Audit Logs */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/audit')}
                title="Audit Logs"
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">🔒</span>
                <span className="hidden md:inline">Audit Logs</span>
              </button>

              {/* Replays */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/replays')}
                title="Manage Replays"
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">🎮</span>
                <span className="hidden md:inline">Replays</span>
              </button>

            </>
          )}

          {/* Admin Links (full set) */}
          {isAdmin && (
            <>
              {/* Manage Users */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin')}
                title={t('sidebar.manage_users')}
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">👥</span>
                <span className="hidden md:inline">{t('sidebar.manage_users')}</span>
              </button>

              {/* Manage Tournaments */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/tournaments')}
                title={t('sidebar.manage_tournaments')}
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">⚙️</span>
                <span className="hidden md:inline">{t('sidebar.manage_tournaments')}</span>
              </button>

              {/* Announcements */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/announcements')}
                title={t('admin_announcements')}
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">📢</span>
                <span className="hidden md:inline">{t('admin_announcements') || 'News'}</span>
              </button>

              {/* Wiki */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/wiki')}
                title="Manage Wiki Articles"
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">📖</span>
                <span className="hidden md:inline">Wiki</span>
              </button>

              {/* Maps & Factions */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/maps-and-factions')}
                title="Manage Maps & Factions"
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">🗺️</span>
                <span className="hidden md:inline">Maps & Factions</span>
              </button>

              {/* Disputes */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/disputes')}
                title={t('sidebar.match_disputes')}
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">⚖️</span>
                <span className="hidden md:inline">{t('sidebar.match_disputes')}</span>
              </button>

              {/* Audit Logs */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/audit')}
                title="Audit Logs"
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">🔒</span>
                <span className="hidden md:inline">Audit Logs</span>
              </button>

              {/* Replays */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/replays')}
                title="Manage Replays"
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">🎮</span>
                <span className="hidden md:inline">Replays</span>
              </button>

              {/* Balance Events */}
              <button 
                className="flex items-center gap-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 text-white text-sm font-medium rounded hover:bg-orange-500/20 hover:border-orange-500/50 active:bg-orange-500/25 transition-all transform hover:-translate-y-0.5 whitespace-nowrap flex-shrink-0 max-sm:px-2 max-sm:py-1.5 max-sm:text-xs max-md:px-2.5"
                onClick={() => handleNavigate('/admin/balance-events')}
                title={t('admin_balance_events') || 'Balance Events'}
              >
                <span className="text-lg flex items-center justify-center min-w-5 max-sm:text-base">⚖️</span>
                <span className="hidden md:inline">{t('admin_balance_events') || 'Balance Events'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default UserProfileNav;
