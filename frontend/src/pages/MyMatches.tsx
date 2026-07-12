import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { matchService, publicService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import MainLayout from '../components/MainLayout';
import MatchesTable from '../components/MatchesTable';
import MatchConfirmationModal from '../components/MatchConfirmationModal';
import MatchDetailsModal from '../components/MatchDetailsModal';


interface FilterState {
  player: string;
  map: string;
  status: string;
  confirmed: string;
  faction: string;
}

interface MatchDetailsModal {
  isOpen: boolean;
  match: any | null;
}

const MyMatches: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, userId } = useAuthStore();

  const [allMatches, setAllMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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
    confirmed: '',
    faction: '',
  });
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(filters);
  const [availableFactions, setAvailableFactions] = useState<any[]>([]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
  }, [isAuthenticated, navigate]);

  // Fetch available factions on component mount
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
      try {
        console.log('Fetching user matches for page:', currentPage, 'with filters:', filters);
        const res = await matchService.getUserMatches(userId!, currentPage, appliedFilters);
        console.log('Full response:', res);
        console.log('Response data:', res.data);
        
        const matchesData = res.data?.data || [];
        console.log('Matches data:', matchesData);
        
        setAllMatches(matchesData);
        
        if (res.data?.pagination) {
          console.log('Pagination info:', res.data.pagination);
          setTotalPages(res.data.pagination.totalPages);
          setTotal(res.data.pagination.total);
        }
      } catch (err) {
        console.error('Error fetching matches:', err);
      } finally {
        setLoading(false);
      }
    };

    if (isAuthenticated && userId) {
      fetchMatches();
    }
  }, [currentPage, appliedFilters, isAuthenticated, userId, refreshKey]);

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
      setAppliedFilters(prev => ({ ...prev, [name]: value }));
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
      confirmed: '',
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

  const handleDownloadReplay = async (matchId: string | null, replayFilePath: string, tournamentMatchId?: string): Promise<void> => {
    if (!matchId || !replayFilePath) return;
    try {
      console.log('🔽 Starting download for match:', matchId);
      console.log('🔽 Incrementing download count...');
      await matchService.incrementReplayDownloads(matchId);
      
      // Extract filename from path
      const filename = replayFilePath.split('/').pop() || `replay_${matchId}`;
      console.log('🔽 Downloading from:', replayFilePath);
      
      // Create a temporary anchor element to trigger download
      const link = document.createElement('a');
      link.href = replayFilePath;
      link.download = filename;
      link.target = '_blank';
      
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log('✅ Download started:', filename);
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
    // Refetch matches to update the status
    const fetchMatches = async () => {
      try {
        const res = await matchService.getUserMatches(userId!, currentPage, appliedFilters);
        const matchesData = res.data?.data || [];
        setAllMatches(matchesData);
      } catch (err) {
        console.error('Error refetching matches:', err);
      }
    };
    fetchMatches();
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="auth-container"><p>{t('loading') || 'Loading...'}</p></div>
      </MainLayout>
    );
  }

  const winnerEloChange = (match: any) => (match.winner_elo_after || 0) - (match.winner_elo_before || 0);
  const loserEloChange = (match: any) => (match.loser_elo_after || 0) - (match.loser_elo_before || 0);

  const paginatedMatches = allMatches;

  return (
    <MainLayout>
      <div className="w-full py-4 px-4">
        <h1 className="text-4xl font-bold text-gray-800 mb-6">{t('sidebar.my_matches') || 'My Matches'}</h1>

        {/* Pagination Controls - Top */}
        {totalPages > 1 && (
          <div className="flex flex-wrap justify-center items-center gap-3 mb-6">
            <button 
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
            >
              {t('pagination_first')}
            </button>
            <button 
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              {t('pagination_prev')}
            </button>
            
            <div className="px-4 py-2 bg-gray-100 rounded-lg text-gray-800 font-bold">
              Page <span className="font-bold">{currentPage}</span> of <span className="font-bold">{totalPages}</span>
            </div>
            
            <button 
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              {t('pagination_next')}
            </button>
            <button 
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
            >
              {t('pagination_last')}
            </button>
          </div>
        )}

        <div className="bg-gray-50 p-4 rounded-lg mb-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
          <div className="flex flex-col gap-2">
            <label htmlFor="player" className="font-semibold text-gray-700 text-sm">{t('filter_player')}</label>
            <input
              type="text"
              id="player"
              name="player"
              placeholder={t('filter_by_player')}
              value={filters.player}
              onChange={handleFilterChangeWithReset}
              onKeyDown={handleTextFilterKeyDown}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="map" className="font-semibold text-gray-700 text-sm">{t('filter_map')}</label>
            <input
              type="text"
              id="map"
              name="map"
              placeholder={t('filter_by_map')}
              value={filters.map}
              onChange={handleFilterChangeWithReset}
              onKeyDown={handleTextFilterKeyDown}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="status" className="font-semibold text-gray-700 text-sm">{t('filter_match_status')}</label>
            <select
              id="status"
              name="status"
              value={filters.status}
              onChange={handleFilterChangeWithReset}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all"
            >
              <option value="">{t('all')}</option>
              <option value="unconfirmed">{t('match_status_unconfirmed')}</option>
              <option value="confirmed">{t('match_status_confirmed')}</option>
              <option value="disputed">{t('match_status_disputed')}</option>
              <option value="cancelled">{t('match_status_cancelled')}</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="confirmed" className="font-semibold text-gray-700 text-sm">{t('filter_confirmation_status')}</label>
            <select
              id="confirmed"
              name="confirmed"
              value={filters.confirmed}
              onChange={handleFilterChangeWithReset}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all"
            >
              <option value="">{t('all')}</option>
              <option value="confirmed">{t('match_status_confirmed')}</option>
              <option value="unconfirmed">{t('match_status_unconfirmed')}</option>
              <option value="disputed">{t('match_status_disputed')}</option>
              <option value="cancelled">{t('match_status_cancelled')}</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="faction" className="font-semibold text-gray-700 text-sm">{t('filter_faction') || 'Faction'}</label>
            <select
              id="faction"
              name="faction"
              value={filters.faction}
              onChange={handleFilterChangeWithReset}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all"
            >
              <option value="">{t('all')}</option>
              {availableFactions.map((faction: any) => (
                <option key={faction.id} value={faction.name}>
                  {faction.name}
                </option>
              ))}
            </select>
          </div>

          <button className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-semibold" onClick={resetFilters}>{t('reset_filters')}</button>
          <button className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded-lg transition-colors" onClick={handleRefresh} title="Refresh">🔄</button>
        </div>

        <div className="text-gray-700 text-sm mb-4">
          <p>{t('showing_count_matches', { count: paginatedMatches.length, total, page: currentPage, totalPages })}</p>
        </div>

        <div className="rounded-lg shadow-md overflow-hidden">
          <MatchesTable 
            matches={paginatedMatches}
            currentPlayerId={userId || undefined}
            onViewDetails={openMatchDetails}
            onOpenConfirmation={openConfirmation}
            onDownloadReplay={handleDownloadReplay}
          />
        </div>

        {totalPages > 1 && (
          <div className="pagination-controls">
            <button 
              className="page-btn"
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
            >
              {t('pagination_first')}
            </button>
            <button 
              className="page-btn"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              {t('pagination_prev')}
            </button>
            
            <div className="page-info">
              Page <span className="current-page">{currentPage}</span> of <span className="total-pages">{totalPages}</span>
            </div>
            
            <button 
              className="page-btn"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              {t('pagination_next')}
            </button>
            <button 
              className="page-btn"
              onClick={() => handlePageChange(totalPages)}
              disabled={currentPage === totalPages}
            >
              {t('pagination_last')}
            </button>
          </div>
        )}

        {/* Match Details Modal */}
        <MatchDetailsModal 
          match={matchDetailsModal.match}
          isOpen={matchDetailsModal.isOpen}
          onClose={closeMatchDetails}
          onDownloadReplay={handleDownloadReplay}
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
    </MainLayout>
  );
};

export default MyMatches;
