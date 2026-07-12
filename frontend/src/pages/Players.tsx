import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { publicService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import UserBadge from '../components/UserBadge';

interface PlayerStats {
  id: string;
  nickname: string;
  elo_rating: number;
  is_rated: boolean;
  enable_ranked: boolean;
  matches_played: number;
  total_wins: number;
  total_losses: number;
  winPercentage: number;
  country?: string;
  avatar?: string;
}

interface FilterState {
  nickname: string;
  min_elo: string;
  max_elo: string;
  min_matches: string;
  rated_only: boolean;
  ranked_only: boolean;
}

type SortColumn = 'nickname' | 'elo_rating' | 'is_rated' | 'matches_played' | 'total_wins' | 'total_losses' | 'winPercentage' | '';
type SortDirection = 'asc' | 'desc';

const Players: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { userId } = useAuthStore();
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [sortColumn, setSortColumn] = useState<SortColumn>('nickname');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
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
    min_matches: '',
    rated_only: false,
    ranked_only: false,
  });
  
  // Applied filters state changes only when a filter is submitted or refreshed.
  const [appliedFilters, setAppliedFilters] = useState<FilterState>({
    nickname: '',
    min_elo: '',
    max_elo: '',
    min_matches: '',
    rated_only: false,
    ranked_only: false,
  });
  
  const handleFilterInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    
    setInputFilters(prev => ({
      ...prev,
      [name]: newValue,
    }));
    
    if (type === 'checkbox') {
      setAppliedFilters(prev => ({ ...prev, [name]: newValue }));
      setCurrentPage(1);
    }
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
    const fetchPlayers = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await publicService.getAllPlayers(
          currentPage,
          appliedFilters,
          sortColumn || undefined,
          sortColumn ? sortDirection : undefined
        );
        
        // Calculate stats for each player
        const allUsers = res.data?.data || [];
        const playersWithStats: PlayerStats[] = allUsers.map((user: any) => {
          const totalMatches = user.matches_played || 0;
          const wins = user.total_wins || 0;
          const losses = user.total_losses || 0;

          const decidedMatches = wins + losses;
          const winPercentage = decidedMatches > 0 ? Math.round((wins / decidedMatches) * 100) : 0;

          return {
            id: user.id,
            nickname: user.nickname,
            elo_rating: user.elo_rating || 1200,
            is_rated: user.is_rated || false,
            enable_ranked: user.enable_ranked || false,
            matches_played: totalMatches,
            total_wins: wins,
            total_losses: losses,
            winPercentage,
            country: user.country,
            avatar: user.avatar,
          };
        });

        setPlayers(playersWithStats);
        
        // Set pagination info
        if (res.data?.pagination) {
          setTotalPages(res.data.pagination.totalPages);
          setTotal(res.data.pagination.total);
        }
      } catch (err) {
        console.error('Error fetching players:', err);
        setError('Error loading players');
      } finally {
        setLoading(false);
      }
    };

    fetchPlayers();
  }, [currentPage, appliedFilters, sortColumn, sortDirection, refreshKey]);
  const handleResetFilters = () => {
    const emptyFilters = {
      nickname: '',
      min_elo: '',
      max_elo: '',
      min_matches: '',
      rated_only: false,
      ranked_only: false,
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

  if (loading) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 py-8 bg-white/50 backdrop-blur-sm rounded-lg">
        <h1>{t('players_title')}</h1>
        <div className="animate-pulse">
          <div className="h-12 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 bg-white/50 backdrop-blur-sm rounded-lg">
      <h1>{t('players_title')}</h1>

      {error && <p className="bg-red-100 border border-red-300 text-red-700 p-4 rounded-lg mb-6">{error}</p>}

      {/* Pagination Controls - Top */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mb-8">
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
          
          <div className="text-gray-600 px-4">
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
      <div className="bg-gray-100 p-4 rounded-lg mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 min-w-[150px] flex-1">
            <label htmlFor="nickname" className="font-semibold text-gray-700 text-sm">{t('filter_nickname')}</label>
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

          <div className="flex flex-col gap-1 min-w-[120px] flex-1">
            <label htmlFor="min_elo" className="font-semibold text-gray-700 text-sm">{t('filter_min_elo')}</label>
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

          <div className="flex flex-col gap-1 min-w-[120px] flex-1">
            <label htmlFor="max_elo" className="font-semibold text-gray-700 text-sm">{t('filter_max_elo')}</label>
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

          <div className="flex flex-col gap-1 min-w-[120px] flex-1">
            <label htmlFor="min_matches" className="font-semibold text-gray-700 text-sm">{t('filter_min_matches')}</label>
            <input
              type="number"
              id="min_matches"
              name="min_matches"
              placeholder={t('filter_min_matches_placeholder')}
              value={inputFilters.min_matches}
              onChange={handleFilterInputChange}
              onKeyDown={handleFilterKeyDown}
              className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <label htmlFor="rated_only" className="flex items-center gap-2 cursor-pointer font-semibold text-gray-700 text-sm pb-2 whitespace-nowrap">
            <input
              type="checkbox"
              id="rated_only"
              name="rated_only"
              checked={inputFilters.rated_only}
              onChange={handleFilterInputChange}
              className="w-4 h-4 text-blue-500 rounded cursor-pointer"
            />
            {t('filter_rated_only')}
          </label>

          <label htmlFor="ranked_only" className="flex items-center gap-2 cursor-pointer font-semibold text-gray-700 text-sm pb-2 whitespace-nowrap">
            <input
              type="checkbox"
              id="ranked_only"
              name="ranked_only"
              checked={inputFilters.ranked_only}
              onChange={handleFilterInputChange}
              className="w-4 h-4 text-green-500 rounded cursor-pointer"
            />
            {t('filter_ranked_only', 'Ranked enabled')}
          </label>

          <button className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded transition-colors whitespace-nowrap" onClick={handleResetFilters}>
            {t('reset_filters')}
          </button>
          <button className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded transition-colors" onClick={handleRefresh} title="Refresh">
            🔄
          </button>
        </div>
      </div>

      <div className="mb-6">
        <p className="text-gray-600">{t('showing_count', { count: players.length, total, page: currentPage, totalPages })}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
              <tr className="bg-gray-200">
                <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-300 transition-colors font-semibold text-gray-700">#</th>
                <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-300 transition-colors font-semibold text-gray-700" onClick={() => handleSort('nickname')} style={{cursor:'pointer'}}>
                  {t('label_nickname')}
                  {sortColumn === 'nickname' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-300 transition-colors font-semibold text-gray-700" onClick={() => handleSort('elo_rating')} style={{cursor:'pointer'}}>
                  {t('label_elo')}
                  {sortColumn === 'elo_rating' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-300 transition-colors font-semibold text-gray-700" onClick={() => handleSort('is_rated')} style={{cursor:'pointer'}}>
                  {t('label_status')}
                  {sortColumn === 'is_rated' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">
                  {t('label_ranked', 'Ranked')}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-300 transition-colors font-semibold text-gray-700" onClick={() => handleSort('matches_played')} style={{cursor:'pointer'}}>
                  {t('label_total')}
                  {sortColumn === 'matches_played' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-300 transition-colors font-semibold text-gray-700" onClick={() => handleSort('total_wins')} style={{cursor:'pointer'}}>
                  {t('label_wins')}
                  {sortColumn === 'total_wins' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-300 transition-colors font-semibold text-gray-700" onClick={() => handleSort('total_losses')} style={{cursor:'pointer'}}>
                  {t('label_losses')}
                  {sortColumn === 'total_losses' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
                <th className="px-4 py-3 text-left cursor-pointer hover:bg-gray-300 transition-colors font-semibold text-gray-700" onClick={() => handleSort('winPercentage')} style={{cursor:'pointer'}}>
                  {t('label_win_pct')}
                  {sortColumn === 'winPercentage' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                </th>
              </tr>
          </thead>
          <tbody>
            {players.map((player, index) => (
              <tr key={player.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-gray-700">
                  <span className="font-semibold">#{(currentPage - 1) * 20 + index + 1}</span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <div className="flex items-center gap-2">
                    <UserBadge
                      country={player.country}
                      avatar={player.avatar}
                      username={player.nickname}
                      size="medium-small"
                    />
                    <a 
                      href="#" 
                      onClick={(e) => {
                        e.preventDefault();
                        if (userId === player.id) {
                          navigate('/user');
                        } else {
                          navigate(`/player/${player.id}`);
                        }
                      }}
                      className="font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                    >
                      {player.nickname}
                    </a>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded">{player.elo_rating}</span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <span className={`text-xs rounded-full px-2 py-1 ${player.is_rated ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {player.is_rated ? t('players_status_rated') : t('players_status_unrated')}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <span className={`text-xs rounded-full px-2 py-1 ${player.enable_ranked ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'}`}>
                    {player.enable_ranked ? t('label_ranked_enabled', 'Enabled') : t('label_ranked_disabled', 'Disabled')}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700">{player.matches_played}</td>
                <td className="px-4 py-3 text-gray-700">
                  <span className="text-green-600 font-semibold">{player.total_wins}</span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <span className="text-red-600 font-semibold">{player.total_losses}</span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded font-semibold">{player.winPercentage}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls - Bottom */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-8">
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
          
          <div className="text-gray-600 px-4">
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
  );
};

export default Players;
