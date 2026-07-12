import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { publicService, matchService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import MatchesTable from '../components/MatchesTable';
import MatchConfirmationModal from '../components/MatchConfirmationModal';
import MatchDetailsModal from '../components/MatchDetailsModal';


interface FilterState {
  player: string;
  map: string;
  status: string;
  faction: string;
}

interface MatchDetailsModal {
  isOpen: boolean;
  match: any | null;
}

const Matches: React.FC = () => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();
  
  const [allMatches, setAllMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [matchDetailsModal, setMatchDetailsModal] = useState<MatchDetailsModal>({
    isOpen: false,
    match: null,
  });
  const [confirmationModal, setConfirmationModal] = useState<MatchDetailsModal>({
    isOpen: false,
    match: null,
  });
  const [filters, setFilters] = useState<FilterState>({
    player: '',
    map: '',
    status: '',
    faction: '',
  });
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(filters);
  const [availableFactions, setAvailableFactions] = useState<any[]>([]);

  useEffect(() => {
    const fetchFactions = async () => {
      try {
        const res = await publicService.getFactions();
        setAvailableFactions(res.data || []);
      } catch (err) {
        console.error('Error fetching factions:', err);
      }
    };
    fetchFactions();
  }, []);

  useEffect(() => {
    const fetchMatches = async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await publicService.getAllMatches(currentPage, appliedFilters);
        const matchesData = res.data?.data || [];
        setAllMatches(matchesData);
        if (res.data?.pagination) {
          setTotalPages(res.data.pagination.totalPages);
          setTotal(res.data.pagination.total);
        }
      } catch (err) {
        console.error('Error fetching matches:', err);
        setAllMatches([]);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchMatches();
  }, [currentPage, appliedFilters, refreshKey]);

  const applyFilters = () => {
    setAppliedFilters(filters);
    setCurrentPage(1);
  };

  const handleRefresh = () => {
    applyFilters();
    setRefreshKey(k => k + 1);
  };

  const handleFilterChangeWithReset = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value,
    }));

    if (name !== 'player' && name !== 'map') {
      setAppliedFilters(prev => ({
        ...prev,
        [name]: value,
      }));
      setCurrentPage(1);
    }
  };

  const handleTextFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyFilters();
    }
  };

  const resetFilters = () => {
    const emptyFilters = {
      player: '',
      map: '',
      status: '',
      faction: '',
    };
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleReplayReported = (replayId: string) => {
    setTimeout(() => {
      setRefreshKey(k => k + 1);
      setCurrentPage(1);
    }, 500);
  };

  const handleDownloadReplay = async (matchId: string | null, replayFilePath: string, tournamentMatchId?: string): Promise<void> => {
    if (!matchId || !replayFilePath) return;
    try {
      const filename = replayFilePath.split('/').pop() || `replay_${matchId}`;
      await matchService.incrementReplayDownloads(matchId);
      const link = document.createElement('a');
      link.href = replayFilePath;
      link.download = filename;
      link.target = '_blank';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('❌ Error downloading replay:', err);
      alert('Failed to download replay. Check console for details.');
    }
  };

  const openMatchDetails = (match: any) => {
    setMatchDetailsModal({
      isOpen: true,
      match,
    });
  };

  const closeMatchDetails = () => {
    setMatchDetailsModal({
      isOpen: false,
      match: null,
    });
  };

  const openConfirmation = (match: any) => {
    setConfirmationModal({
      isOpen: true,
      match,
    });
  };

  const closeConfirmation = () => {
    setConfirmationModal({
      isOpen: false,
      match: null,
    });
  };

  const handleConfirmationSuccess = () => {
    closeConfirmation();
    setRefreshKey(k => k + 1);
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p>{t('loading') || 'Loading...'}</p></div>;
  }

  const paginatedMatches = allMatches;

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-gray-700">{t('matches_load_error') || 'Unable to load matches.'}</p>
        <button className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600" onClick={handleRefresh}>
          {t('retry') || 'Retry'}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-8">
      <h1 className="text-4xl font-bold text-gray-800 mb-6">{t('matches_all_matches')}</h1>

      {/* Pagination Controls - Top */}
      {totalPages > 1 && (
        <div className="flex gap-4 items-center justify-center mb-6 flex-wrap">
          <button 
            className={`px-4 py-2 rounded transition-colors ${
              currentPage === 1
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
          >
            {t('pagination_first')}
          </button>
            <button 
            className={`px-4 py-2 rounded transition-colors ${
              currentPage === 1
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            {t('pagination_prev')}
          </button>
          
          <div className="text-gray-700 font-semibold">
            {t('pagination_page_info', { page: currentPage, totalPages })}
          </div>
          
          <button 
            className={`px-4 py-2 rounded transition-colors ${
              currentPage === totalPages
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_next')}
          </button>
          <button 
            className={`px-4 py-2 rounded transition-colors ${
              currentPage === totalPages
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_last')}
          </button>
        </div>
      )}

      <div className="bg-gray-100 p-4 rounded-lg mb-6 overflow-x-auto -webkit-overflow-scrolling-touch">
        <div className="flex gap-4 min-w-min">
          <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
            <label htmlFor="player" className="font-semibold text-gray-700 text-sm">{t('filter_player')}</label>
            <input
              type="text"
              id="player"
              name="player"
              placeholder={t('filter_by_player')}
              value={filters.player}
              onChange={handleFilterChangeWithReset}
              onKeyDown={handleTextFilterKeyDown}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
            />
          </div>

          <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
            <label htmlFor="map" className="font-semibold text-gray-700 text-sm">{t('filter_map')}</label>
            <input
              type="text"
              id="map"
              name="map"
              placeholder={t('filter_by_map')}
              value={filters.map}
              onChange={handleFilterChangeWithReset}
              onKeyDown={handleTextFilterKeyDown}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
            />
          </div>

          <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
            <label htmlFor="status" className="font-semibold text-gray-700 text-sm">{t('filter_match_status')}</label>
            <select
              id="status"
              name="status"
              value={filters.status}
              onChange={handleFilterChangeWithReset}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
            >
              <option value="">{t('all')}</option>
              <option value="unconfirmed">{t('match_status_unconfirmed')}</option>
              <option value="confirmed">{t('match_status_confirmed')}</option>
              <option value="disputed">{t('match_status_disputed')}</option>
              <option value="cancelled">{t('match_status_cancelled')}</option>
            </select>
          </div>

          <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
            <label htmlFor="faction" className="font-semibold text-gray-700 text-sm">{t('filter_faction') || 'Faction'}</label>
            <select
              id="faction"
              name="faction"
              value={filters.faction}
              onChange={handleFilterChangeWithReset}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
            >
              <option value="">{t('all')}</option>
              {availableFactions.map((faction: any) => (
                <option key={faction.id} value={faction.name}>
                  {faction.name}
                </option>
              ))}
            </select>
          </div>

          <button className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex-shrink-0 h-fit self-end" onClick={resetFilters}>{t('reset_filters')}</button>
          <button className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded transition-colors flex-shrink-0 h-fit self-end" onClick={handleRefresh} title={t('refresh') || 'Refresh'} aria-label={t('refresh') || 'Refresh'}>↻</button>
        </div>
      </div>

      <div className="text-gray-600 text-sm mb-4">
        <p>{t('showing_count_matches', { count: paginatedMatches.length, total, page: currentPage, totalPages })}</p>
      </div>

      <div className="rounded-lg shadow-md overflow-x-auto">
        <MatchesTable 
          matches={paginatedMatches}
          currentPlayerId={userId || undefined}
          onViewDetails={openMatchDetails}
          onOpenConfirmation={openConfirmation}
          onDownloadReplay={handleDownloadReplay}
          onReplayReported={handleReplayReported}
        />
      </div>

      {totalPages > 1 && (
        <div className="flex gap-4 items-center justify-center mb-6 flex-wrap mt-6">
          <button 
            className={`px-4 py-2 rounded transition-colors ${
              currentPage === 1
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
            onClick={() => handlePageChange(1)}
            disabled={currentPage === 1}
          >
            {t('pagination_first')}
          </button>
          <button 
            className={`px-4 py-2 rounded transition-colors ${
              currentPage === 1
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            {t('pagination_prev')}
          </button>
          
          <div className="text-gray-700 font-semibold">
            {t('pagination_page_info', { page: currentPage, totalPages })}
          </div>
          
          <button 
            className={`px-4 py-2 rounded transition-colors ${
              currentPage === totalPages
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_next')}
          </button>
          <button 
            className={`px-4 py-2 rounded transition-colors ${
              currentPage === totalPages
                ? 'bg-gray-400 text-white cursor-not-allowed'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
            onClick={() => handlePageChange(totalPages)}
            disabled={currentPage === totalPages}
          >
            {t('pagination_last')}
          </button>
        </div>
      )}

      <MatchDetailsModal 
        match={matchDetailsModal.match} 
        isOpen={matchDetailsModal.isOpen} 
        onClose={closeMatchDetails}
        onDownloadReplay={handleDownloadReplay}
        onCancelSuccess={() => {
          // Refresh matches by resetting to page 1
          setCurrentPage(1);
          closeMatchDetails();
        }}
      />

      {/* Match Confirmation Modal */}
      {confirmationModal.isOpen && confirmationModal.match && (
        <MatchConfirmationModal
          match={confirmationModal.match}
          currentPlayerId={userId!}
          onClose={closeConfirmation}
          onSubmit={handleConfirmationSuccess}
        />
      )}
    </div>
  );
};

export default Matches;
