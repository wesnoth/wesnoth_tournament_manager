import React from 'react';
import { useTranslation } from 'react-i18next';
import { getLevelTranslationKey } from '../utils/levelTranslation';
import UserBadge from './UserBadge';

interface ProfileStatsProps {
  player: {
    nickname: string;
    elo_rating: number;
    is_rated: boolean;
    level?: string;
    matches_played: number;
    total_wins: number;
    total_losses: number;
    trend?: string;
    avg_elo_change?: number;
    is_active?: boolean;
    last_activity?: string;
    country?: string;
    avatar?: string;
    enable_ranked?: boolean;
  };
}

const ProfileStats: React.FC<ProfileStatsProps> = ({ player }) => {
  const { t, i18n } = useTranslation();
  const totalMatches = player.matches_played || 0;
  const decidedMatches = (player.total_wins || 0) + (player.total_losses || 0);
  const winPercentage = decidedMatches > 0 ? Math.round(((player.total_wins || 0) / decidedMatches) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto p-8 max-md:p-4">
      <div className="flex justify-between items-start gap-8 max-md:gap-4 max-md:flex-col mb-8">
        <div className="flex-1">
          <h1 className="text-3xl max-md:text-2xl font-bold text-gray-800 mb-4">{player.nickname}</h1>
          <div className="flex gap-4 max-md:gap-2 flex-wrap">
            <span className={`inline-block px-3 py-1 rounded text-sm max-md:text-xs font-semibold ${player.is_rated ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
              {player.is_rated ? `★ ${t('rated')}` : `☆ ${t('unrated')}`}
            </span>
            {player.is_active !== undefined && (
              <span className={`inline-block px-3 py-1 rounded text-sm max-md:text-xs font-semibold ${player.is_active ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>
                {player.is_active ? t('status_active') : t('status_inactive')}
              </span>
            )}
            {player.enable_ranked !== undefined && (
              <span className={`inline-block px-3 py-1 rounded text-sm max-md:text-xs font-semibold ${player.enable_ranked ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {player.enable_ranked ? `✓ ${t('label_ranked_matches', 'Ranked Matches')}` : `✗ ${t('label_ranked_matches', 'Ranked Matches')}`}
              </span>
            )}
            {player.last_activity && (
              <span className="text-sm max-md:text-xs text-gray-600">
                {t('last_activity')}: {new Date(player.last_activity).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>
        {(player.country || player.avatar) && (
          <div className="flex-shrink-0">
            <UserBadge
              country={player.country}
              avatar={player.avatar}
              username={player.nickname}
              size="large"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 max-md:overflow-x-auto max-md:-webkit-overflow-scrolling-touch max-md:flex max-md:gap-2">
        <div className="bg-white rounded-lg shadow-md p-6 max-md:p-3 max-md:flex-shrink-0 max-md:min-w-[110px]">
          <div className="text-sm max-md:text-xs font-semibold text-gray-600 mb-2">{t('label_elo')}</div>
          <div className="text-3xl max-md:text-xl font-bold text-blue-600">
            {player.elo_rating}
          </div>
          {player.level && <div className="text-xs max-md:text-[10px] text-gray-500 mt-2">{t(getLevelTranslationKey(player.level))}</div>}
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 max-md:p-3 max-md:flex-shrink-0 max-md:min-w-[110px]">
          <div className="text-sm max-md:text-xs font-semibold text-gray-600 mb-2">{t('label_trend')}</div>
          <div className={`text-3xl max-md:text-xl font-bold ${player.trend?.startsWith('+') ? 'text-green-600' : player.trend?.startsWith('-') && player.trend !== '-' ? 'text-red-600' : 'text-gray-600'}`}>
            {player.trend || '-'}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 max-md:p-3 max-md:flex-shrink-0 max-md:min-w-[110px]">
          <div className="text-sm max-md:text-xs font-semibold text-gray-600 mb-2">{t('label_total_matches')}</div>
          <div className="text-3xl max-md:text-xl font-bold text-gray-800">{totalMatches}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 max-md:p-3 max-md:flex-shrink-0 max-md:min-w-[110px]">
          <div className="text-sm max-md:text-xs font-semibold text-gray-600 mb-2">{t('label_wins')}</div>
          <div className="text-3xl max-md:text-xl font-bold text-green-600">{player.total_wins || 0}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 max-md:p-3 max-md:flex-shrink-0 max-md:min-w-[110px]">
          <div className="text-sm max-md:text-xs font-semibold text-gray-600 mb-2">{t('label_losses')}</div>
          <div className="text-3xl max-md:text-xl font-bold text-red-600">{player.total_losses || 0}</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 max-md:p-3 max-md:flex-shrink-0 max-md:min-w-[110px]">
          <div className="text-sm max-md:text-xs font-semibold text-gray-600 mb-2">{t('label_win_pct')}</div>
          <div className="text-3xl max-md:text-xl font-bold text-gray-800">{winPercentage}%</div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 max-md:p-3 max-md:flex-shrink-0 max-md:min-w-[110px]">
          <div className="text-sm max-md:text-xs font-semibold text-gray-600 mb-2">{t('label_record')}</div>
          <div className="text-3xl max-md:text-xl font-bold text-gray-800">
            {player.total_wins || 0}-{player.total_losses || 0}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 max-md:p-3 max-md:flex-shrink-0 max-md:min-w-[110px]">
          <div className="text-sm max-md:text-xs font-semibold text-gray-600 mb-2">{t('label_avg_elo_change') || 'Avg ELO Change'}</div>
          <div className={`text-3xl max-md:text-xl font-bold ${(player.avg_elo_change || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {(player.avg_elo_change || 0) >= 0 ? '+' : ''}{Number(player.avg_elo_change || 0).toFixed(1)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileStats;
