import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export interface Tournament {
  id: string;
  name: string;
  description: string;
  creator_id: string;
  creator_nickname: string;
  status: string;
  tournament_type: string;
  tournament_mode?: 'ranked' | 'unranked' | 'team';
  general_rounds: number;
  final_rounds: number;
  general_rounds_format: 'bo1' | 'bo3' | 'bo5';
  final_rounds_format: 'bo1' | 'bo3' | 'bo5';
  created_at: string;
  updated_at: string;
  started_at: string;
  finished_at: string;
  approved_at: string;
  winner_id?: string;
  winner_nickname?: string;
  runner_up_id?: string;
  runner_up_nickname?: string;
}

export interface FilterState {
  name: string;
  status: string;
  type: string;
  my_tournaments?: boolean;
}

interface TournamentListProps {
  title: string;
  tournaments: Tournament[];
  loading: boolean;
  error: string;
  currentPage: number;
  totalPages: number;
  total: number;
  showFilters?: boolean;
  showCreateButton?: boolean;
  onFilterChange?: (filters: FilterState) => void;
  onPageChange?: (page: number) => void;
  onCreateClick?: () => void;
  onViewDetails?: (tournamentId: string) => void;
  onEdit?: (tournamentId: string) => void;
  onDelete?: (tournamentId: string) => void;
}

const TournamentList: React.FC<TournamentListProps> = ({
  title,
  tournaments,
  loading,
  error,
  currentPage,
  totalPages,
  total,
  showFilters = true,
  showCreateButton = false,
  onFilterChange,
  onPageChange,
  onCreateClick,
  onViewDetails,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();

  const [inputFilters, setInputFilters] = useState<FilterState>({
    name: '',
    status: '',
    type: '',
    my_tournaments: false,
  });

  const handleFilterInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, type, value, checked } = e.target as HTMLInputElement;
    const newValue = type === 'checkbox' ? checked : value;

    setInputFilters(prev => ({
      ...prev,
      [name]: newValue,
    }));

    const nextFilters = { ...inputFilters, [name]: newValue };
    if (type !== 'text') {
      onFilterChange?.(nextFilters);
    }
  };

  const applyFilters = () => {
    onFilterChange?.(inputFilters);
  };

  const handleFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyFilters();
    }
  };

  const handleResetFilters = () => {
    setInputFilters({
      name: '',
      status: '',
      type: '',
      my_tournaments: false,
    });
    onFilterChange?.({
      name: '',
      status: '',
      type: '',
      my_tournaments: false,
    });
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      onPageChange?.(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleViewDetails = (tournamentId: string) => {
    if (onViewDetails) {
      onViewDetails(tournamentId);
    } else {
      navigate(`/tournament/${tournamentId}`, { state: { from: 'tournaments' } });
    }
  };

  const getStatusLabel = (status: string) => {
    const normalizeStatus = (s: string) => {
      if (!s) return 'pending';
      return s.toString().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
    };

    const key = `option_${normalizeStatus(status)}`;
    const translated = t(key);
    if (translated && translated !== key) return translated;
    const human = (status || '').toString().replace(/_/g, ' ').replace(/-/g, ' ');
    return human.charAt(0).toUpperCase() + human.slice(1);
  };

  const getTournamentModeLabel = (mode?: string) => {
    if (!mode) return '-';
    const modeMap: Record<string, string> = {
      ranked: t('tournament.ranked', 'Ranked (1v1)'),
      unranked: t('tournament.unranked', 'Unranked (1v1)'),
      team: t('tournament.team', 'Team (2v2)'),
    };
    return modeMap[mode] || mode;
  };

  const getTournamentModeColor = (mode?: string) => {
    const colorMap: { [key: string]: string } = {
      'ranked': '#1976d2',
      'unranked': '#ff9800',
      'team': '#9c27b0'
    };
    return colorMap[mode || ''] || '#999';
  };

  const getStatusColor = (status: string) => {
    const colorMap: { [key: string]: string } = {
      'pending': '#FF9800',
      'active': '#4CAF50',
      'completed': '#2196F3',
      'cancelled': '#f44336',
      'registration_open': '#FF9800',
      'registration_closed': '#9C27B0',
      'prepared': '#2196F3',
      'approved': '#4CAF50',
      'in_progress': '#4CAF50',
      'finished': '#607D8B',
    };
    return colorMap[status] || '#999';
  };

  const formatDate = (date: string) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString();
  };

  if (loading) {
    return <div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200"><p>{t('loading')}</p></div>;
  }

  return (
    <div data-help-id="region-tournament-list" className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
      {title && (
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800">{title}</h1>
          {showCreateButton && (
            <button data-help-id="action-create-tournament" className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors" onClick={onCreateClick}>
              {t('create_tournament')}
            </button>
          )}
        </div>
      )}

      {error && <p className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded mb-6">{error}</p>}

      {/* Pagination Controls - Top */}
      {totalPages > 1 && (
        <div className="flex gap-4 items-center justify-center mb-6 flex-wrap">
          <button
            data-help-id="action-tournament-pagination-first"
            className={`px-4 py-2 rounded transition-colors ${currentPage === 1 ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
          >
            {t('pagination_first')}
          </button>
          <button
            data-help-id="action-tournament-pagination-previous"
            className={`px-4 py-2 rounded transition-colors ${currentPage === 1 ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            {t('pagination_prev')}
          </button>

          <div className="text-gray-700 font-semibold">
            {t('pagination_page_info', { page: currentPage, totalPages })}
          </div>

          <button
            data-help-id="action-tournament-pagination-next"
            className={`px-4 py-2 rounded transition-colors ${currentPage === totalPages ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_next')}
          </button>
          <button
            data-help-id="action-tournament-pagination-last"
            className={`px-4 py-2 rounded transition-colors ${currentPage === totalPages ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_last')}
          </button>
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div data-help-id="region-tournament-list-filters" className="bg-gray-100 p-4 rounded-lg mb-6 overflow-x-auto -webkit-overflow-scrolling-touch">
          <div className="flex gap-4 min-w-min items-end">
            <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
              <label htmlFor="name" className="font-semibold text-gray-700 text-sm">{t('tournament_name')}</label>
              <input
                data-help-id="field-tournament-list-name"
                type="text"
                id="name"
                name="name"
                placeholder={t('filter_by_tournament_name')}
                value={inputFilters.name}
                onChange={handleFilterInputChange}
                onKeyDown={handleFilterKeyDown}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
              />
            </div>

            <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
              <label htmlFor="status" className="font-semibold text-gray-700 text-sm">{t('filter_status')}</label>
              <select
                data-help-id="field-tournament-list-status"
                id="status"
                name="status"
                value={inputFilters.status}
                onChange={handleFilterInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
              >
                <option value="">{t('option_all_statuses')}</option>
                <option value="registration_open">{t('option_registration_open')}</option>
                <option value="registration_closed">{t('option_registration_closed')}</option>
                <option value="prepared">{t('option_prepared')}</option>
                <option value="approved">{t('option_approved')}</option>
                <option value="in_progress">{t('option_in_progress')}</option>
                <option value="finished">{t('option_finished')}</option>
                <option value="cancelled">{t('option_cancelled')}</option>
              </select>
            </div>

            <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
              <label htmlFor="type" className="font-semibold text-gray-700 text-sm">{t('filter_type')}</label>
              <select
                data-help-id="field-tournament-list-type"
                id="type"
                name="type"
                value={inputFilters.type}
                onChange={handleFilterInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
              >
                <option value="">{t('option_all_types')}</option>
                <option value="elimination">{t('option_type_elimination')}</option>
                <option value="league">{t('option_type_league')}</option>
                <option value="swiss">{t('option_type_swiss')}</option>
              </select>
            </div>

            <div className="flex flex-col gap-2 flex-shrink-0 min-w-[180px]">
              <label className="font-semibold text-gray-700 text-sm">&nbsp;</label>
              <div className="flex items-center gap-2 pt-1">
                <input
                  data-help-id="option-tournament-list-my-tournaments"
                  type="checkbox"
                  id="my_tournaments"
                  name="my_tournaments"
                  checked={inputFilters.my_tournaments || false}
                  onChange={handleFilterInputChange}
                  disabled={!isAuthenticated}
                  title={!isAuthenticated ? t('must_login_to_filter') : ''}
                  className="w-4 h-4 cursor-pointer"
                />
                <label 
                  htmlFor="my_tournaments"
                  className={`font-semibold text-gray-700 text-sm ${!isAuthenticated ? 'text-gray-500 cursor-not-allowed' : ''}`}
                >
                  {t('filter_my_tournaments')}
                </label>
              </div>
            </div>

            <button data-help-id="action-reset-tournament-filters" className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex-shrink-0 h-fit self-end" onClick={handleResetFilters}>
              {t('reset_filters')}
            </button>
            <button data-help-id="action-refresh-tournament-list" className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex-shrink-0 h-fit self-end" onClick={applyFilters}>
              {t('common.refresh')}
            </button>
          </div>
        </div>
      )}

      <div className="text-gray-600 text-sm mb-4">
        <p>{t('showing_count', { count: tournaments.length, total, page: currentPage, totalPages })}</p>
      </div>

      <section data-help-id="region-tournament-list-results" className="bg-white rounded-lg shadow-lg p-8 overflow-x-auto">
        {tournaments.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_name')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_organizer')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_status')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_type')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_mode')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_winner')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_runner_up')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_last_updated')}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('tournament.col_action')}</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((tournament) => (
                <tr key={tournament.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleViewDetails(tournament.id)}
                      className="text-left text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                      data-help-id="action-open-tournament-from-name"
                    >
                      {tournament.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{tournament.creator_nickname}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <span
                      className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold"
                      style={{ backgroundColor: getStatusColor(tournament.status) }}
                    >
                      {getStatusLabel(tournament.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{tournament.tournament_type}</td>
                  <td className="px-4 py-3 text-gray-700">
                    <span
                      className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold"
                      style={{ backgroundColor: getTournamentModeColor(tournament.tournament_mode) }}
                    >
                      {getTournamentModeLabel(tournament.tournament_mode)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{tournament.winner_nickname || '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{tournament.runner_up_nickname || '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(tournament.updated_at)}</td>
                  <td className="px-4 py-3 text-gray-700 flex gap-2">
                    <button
                      data-help-id="action-view-tournament-details"
                      onClick={() => handleViewDetails(tournament.id)}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 transition-colors"
                    >
                      {t('tournaments.view_details')}
                    </button>
                    {onEdit && (
                      <button
                        data-help-id="action-edit-tournament-list-item"
                        onClick={() => onEdit(tournament.id)}
                        className="px-3 py-1 bg-yellow-500 text-white rounded text-xs hover:bg-yellow-600 transition-colors"
                      >
                        {t('edit')}
                      </button>
                    )}
                    {onDelete && (
                      <button
                        data-help-id="action-delete-tournament-list-item"
                        onClick={() => onDelete(tournament.id)}
                        className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition-colors"
                      >
                        {t('delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-600 text-center py-8">{t('no_data')}</p>
        )}
      </section>

      {/* Pagination Controls - Bottom */}
      {totalPages > 1 && (
        <div className="flex gap-4 items-center justify-center mb-6 flex-wrap">
          <button
            data-help-id="action-tournament-pagination-first"
            className={`px-4 py-2 rounded transition-colors ${currentPage === 1 ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
          >
            {t('pagination_first')}
          </button>
          <button
            data-help-id="action-tournament-pagination-previous"
            className={`px-4 py-2 rounded transition-colors ${currentPage === 1 ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            {t('pagination_prev')}
          </button>

          <div className="text-gray-700 font-semibold">
            {t('pagination_page_info', { page: currentPage, totalPages })}
          </div>

          <button
            data-help-id="action-tournament-pagination-next"
            className={`px-4 py-2 rounded transition-colors ${currentPage === totalPages ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_next')}
          </button>
          <button
            data-help-id="action-tournament-pagination-last"
            className={`px-4 py-2 rounded transition-colors ${currentPage === totalPages ? 'bg-gray-400 text-white cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
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

export default TournamentList;
