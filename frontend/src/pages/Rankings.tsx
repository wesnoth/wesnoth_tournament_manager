import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { userService } from '../services/api';
import UserBadge from '../components/UserBadge';
import PlayerLink from '../components/PlayerLink';

interface PlayerStats {
  id: string;
  nickname: string;
  elo_rating: number;
  global_ranking_position?: number | null;
  is_rated: boolean;
  matches_played: number;
  total_wins: number;
  total_losses: number;
  winPercentage: number;
  trend: string;
  country?: string;
  avatar?: string;
}

interface FilterState {
  nickname: string;
  min_elo: string;
  max_elo: string;
}

type SortColumn = 'nickname' | 'elo_rating' | 'matches_played' | 'total_wins' | 'total_losses' | 'win_percentage' | 'trend' | '';
type SortDirection = 'asc' | 'desc';

const Rankings: React.FC = () => {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [sortColumn, setSortColumn] = useState<SortColumn>('elo_rating');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  const handleRefresh = () => {
    setAppliedFilters(inputFilters);
    setCurrentPage(1);
    setRefreshKey(k => k + 1);
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  
  // Input state (updates immediately as user types)
  const [inputFilters, setInputFilters] = useState<FilterState>({
    nickname: '',
    min_elo: '',
    max_elo: '',
  });
  
  // Applied filters state changes only when a filter is submitted or refreshed.
  const [appliedFilters, setAppliedFilters] = useState<FilterState>({
    nickname: '',
    min_elo: '',
    max_elo: '',
  });
  
  const handleFilterInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    setInputFilters(prev => ({
      ...prev,
      [name]: value,
    }));
    
  };

  const applyFilters = () => {
    setAppliedFilters(inputFilters);
    setCurrentPage(1);
  };

  const handleFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyFilters();
    }
  };

  useEffect(() => {
    const fetchRankings = async () => {
      try {
        setLoading(true);
        setError('');

        // Fetch global ranking with pagination and filters
        const rankingRes = await userService.getGlobalRanking(
          currentPage,
          appliedFilters,
          sortColumn || undefined,
          sortColumn ? sortDirection : undefined
        );
        const ratedPlayers = rankingRes.data?.data || [];

        // Calculate stats for each player
        const playersWithStats: PlayerStats[] = ratedPlayers.map((player: any) => {
          const totalMatches = player.matches_played || 0;
          const wins = player.total_wins || 0;
          const losses = player.total_losses || 0;

          // Calculate win percentage
          const decidedMatches = wins + losses;
          const winPercentage = decidedMatches > 0 ? Math.round((wins / decidedMatches) * 100) : 0;

          // Trend is stored in the database
          const trend = player.trend || '-';

          return {
            id: player.id,
            nickname: player.nickname,
            elo_rating: player.elo_rating,
            global_ranking_position: player.global_ranking_position,
            is_rated: player.is_rated,
            matches_played: totalMatches,
            total_wins: wins,
            total_losses: losses,
            winPercentage,
            trend,
            country: player.country,
            avatar: player.avatar,
          };
        });

        setPlayers(playersWithStats);

        // Set pagination info
        if (rankingRes.data?.pagination) {
          setTotalPages(rankingRes.data.pagination.totalPages);
          setTotal(rankingRes.data.pagination.total);
        }
      } catch (err) {
        console.error('Error fetching rankings:', err);
        setError(t('error_loading_rankings', 'Error loading rankings'));
      } finally {
        setLoading(false);
      }
    };

    fetchRankings();
  }, [currentPage, appliedFilters, sortColumn, sortDirection, refreshKey]);

  const handleResetFilters = () => {
    const emptyFilters = {
      nickname: '',
      min_elo: '',
      max_elo: '',
    };
    setInputFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleRetry = () => setRefreshKey(key => key + 1);

  if (loading) {
    return <div className="w-full max-w-6xl mx-auto px-4 py-8"><p>{t('loading')}</p></div>;
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">{t('navbar_rankings') || 'Rankings'}</h1>

      {/* Ranking Criteria Info */}
      <div className="mb-8">
        <h3 className="text-xl font-semibold text-gray-700 mb-2">{t('ranking_criteria_title') || 'Ranking Criteria'}</h3>
        <p className="text-gray-600">{t('ranking_criteria_description') || 'Players must have a minimum ELO of 1400, have played a minimum of 10 games and have activity in the last 30 days.'}</p>
      </div>

      {/* Rankings Content */}
      <div className="w-full">
          {error && (
            <div className="bg-red-100 border border-red-300 text-red-700 p-4 rounded-lg mb-6">
              <p>{error}</p>
              <button className="mt-3 font-semibold underline" onClick={handleRetry}>
                {t('retry', 'Retry')}
              </button>
            </div>
          )}

          {/* Pagination Controls - Top */}
          {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mb-6 flex-wrap">
          <button 
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
          >
            {t('pagination_first')}
          </button>
          <button 
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            {t('pagination_prev')}
          </button>
          
          <div className="text-sm text-gray-600">
            {t('pagination_page_info', { page: currentPage, totalPages })}
          </div>
          
          <button 
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_next')}
          </button>
          <button 
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_last')}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="overflow-x-auto -webkit-overflow-scrolling-touch mb-6">
        <div className="flex gap-4 min-w-min">
          <div className="flex flex-col flex-shrink-0 min-w-[200px]">
            <label htmlFor="nickname" className="text-sm font-semibold text-gray-700 mb-1">{t('filter_nickname')}</label>
            <input
              type="text"
              id="nickname"
              name="nickname"
              placeholder={t('filter_by_nickname')}
              value={inputFilters.nickname}
              onChange={handleFilterInputChange}
              onKeyDown={handleFilterKeyDown}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col flex-shrink-0 min-w-[180px]">
            <label htmlFor="min_elo" className="text-sm font-semibold text-gray-700 mb-1">{t('filter_min_elo')}</label>
            <input
              type="number"
              id="min_elo"
              name="min_elo"
              placeholder={t('filter_min_elo_placeholder')}
              value={inputFilters.min_elo}
              onChange={handleFilterInputChange}
              onKeyDown={handleFilterKeyDown}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col flex-shrink-0 min-w-[180px]">
            <label htmlFor="max_elo" className="text-sm font-semibold text-gray-700 mb-1">{t('filter_max_elo')}</label>
            <input
              type="number"
              id="max_elo"
              name="max_elo"
              placeholder={t('filter_max_elo_placeholder')}
              value={inputFilters.max_elo}
              onChange={handleFilterInputChange}
              onKeyDown={handleFilterKeyDown}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col justify-end flex-shrink-0">
            <div className="flex gap-2 self-end">
              <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-semibold" onClick={handleResetFilters}>
                {t('reset_filters')}
              </button>
              <button className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded transition-colors" onClick={handleRefresh} title={t('refresh')} aria-label={t('refresh')}>
                {t('refresh')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="text-sm text-gray-600 mb-4">
        <p>{t('showing_count', { count: players.length, total, page: currentPage, totalPages })}</p>
      </div>

      {players.length > 0 ? (
        <div className="w-full overflow-x-auto mb-8">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-200">
                <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors">#</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('label_global_ranking_position', 'Global rank')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => handleSort('nickname')}>
                  {t('label_nickname')}
                  {sortColumn === 'nickname' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => handleSort('elo_rating')}>
                  {t('label_elo')}
                  {sortColumn === 'elo_rating' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => handleSort('matches_played')}>
                  {t('label_total')}
                  {sortColumn === 'matches_played' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => handleSort('total_wins')}>
                  {t('label_wins')}
                  {sortColumn === 'total_wins' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => handleSort('total_losses')}>
                  {t('label_losses')}
                  {sortColumn === 'total_losses' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => handleSort('win_percentage')}>
                  {t('label_win_pct')}
                  {sortColumn === 'win_percentage' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-300 transition-colors" onClick={() => handleSort('trend')}>
                  {t('label_trend')}
                  {sortColumn === 'trend' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
              </tr>
            </thead>
            <tbody>
              {players.map((player, index) => (
                <tr key={player.id} className={`border-b border-gray-200 hover:bg-gray-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="font-bold text-lg text-center">#{(currentPage - 1) * 20 + index + 1}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {player.global_ranking_position ? `#${player.global_ranking_position}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <div className="flex items-center gap-2">
                      <UserBadge
                        country={player.country}
                        avatar={player.avatar}
                        username={player.nickname}
                        size="medium-small"
                      />
                      <PlayerLink
                        nickname={player.nickname}
                        userId={player.id}
                        className="font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="font-bold">{player.elo_rating}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{player.matches_played}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="text-green-600 font-semibold">{player.total_wins}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="text-red-600 font-semibold">{player.total_losses}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className="font-bold bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm">{player.winPercentage}%</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <span className={`font-semibold px-2 py-1 rounded-full text-sm ${
                      player.trend === '↑' ? 'bg-green-100 text-green-800' :
                      player.trend === '↓' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {player.trend}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-center text-gray-500 py-8">{t('no_data') || 'No ranking data available'}</p>
      )}

      {/* Pagination Controls - Bottom */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-8 flex-wrap">
          <button 
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
          >
            {t('pagination_first')}
          </button>
          <button 
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            {t('pagination_prev')}
          </button>
          <div className="text-sm text-gray-600">
            {t('pagination_page_info', { page: currentPage, totalPages })}
          </div>
          <button 
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_next')}
          </button>
          <button 
            className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_last')}
          </button>
        </div>
      )}
        </div>
    </div>
  );
};

export default Rankings;
