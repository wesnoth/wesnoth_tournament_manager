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
  const [availableFactions, setAvailableFactions] = useState<any[]>([]);

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
    // Always fetch from server with current page and filters
    const fetchMatches = async () => {
      try {
        console.log('🔍 Fetching matches for page:', currentPage, 'with filters:', filters);
        console.log('🔍 Faction filter value:', filters.faction);
        const res = await publicService.getAllMatches(currentPage, filters);
        console.log('Full response:', res);
        console.log('Response data:', res.data);
        
        // res.data contains {data: [...], pagination: {...}}
        const matchesData = res.data?.data || [];
        console.log('Matches data:', matchesData);
        
        // Check for replays (both active and due)
        const replays = matchesData.filter((m: any) => m.source_type === 'replay_confidence_1' || m.source_type === 'replay_confidence_1_due');
        if (replays.length > 0) {
          console.log(`📋 Found ${replays.length} confidence=1 replays (including due):`, replays);
        } else {
          console.log('📋 No confidence=1 replays found');
        }
        
        setAllMatches(matchesData);
        
        // Set pagination info
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

    fetchMatches();
  }, [currentPage, filters, refreshKey]);

  const handleRefresh = () => setRefreshKey(k => k + 1);

  // Reset to page 1 when filters change
  const handleFilterChangeWithReset = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    console.log(`🔍 Filter changed: ${name} = ${value}`);
    setFilters(prev => ({
      ...prev,
      [name]: value,
    }));
    // Reset to page 1 when filters change
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setFilters({
      player: '',
      map: '',
      status: '',
      faction: '',
    });
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleReplayReported = (replayId: string) => {
    console.log(`✅ Replay ${replayId} reported successfully. Refreshing matches list...`);
    // Add a small delay to ensure server has processed the confirmation
    setTimeout(() => {
      setRefreshKey(k => k + 1); // Trigger refresh
      setCurrentPage(1); // Reset to first page to see the newly created match
    }, 500);
  };

  const handleDownloadReplay = async (matchId: string | null, replayFilePath: string, tournamentMatchId?: string): Promise<void> => {
    if (!matchId || !replayFilePath) return;
    try {
      console.log('🔽 Starting download for match:', matchId);
      // Extract filename from path
      const filename = replayFilePath.split('/').pop() || `replay_${matchId}`;
      
      // Increment download count in the database
      console.log('🔽 Incrementing download count...');
      await matchService.incrementReplayDownloads(matchId);
      
      // Use the replay_file_path HTTPS URL directly
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
    setRefreshKey(k => k + 1); // Refresh matches list
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p>{t('loading') || 'Loading...'}</p></div>;
  }

  const winnerEloChange = (match: any) => (match.winner_elo_after || 0) - (match.winner_elo_before || 0);
  const loserEloChange = (match: any) => (match.loser_elo_after || 0) - (match.loser_elo_before || 0);

  // Server already handles filtering and pagination
  const paginatedMatches = allMatches;

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
            Page <span>{currentPage}</span> of <span>{totalPages}</span>
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
          <button className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold rounded transition-colors flex-shrink-0 h-fit self-end" onClick={handleRefresh} title="Refresh">🔄</button>
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
            Page <span>{currentPage}</span> of <span>{totalPages}</span>
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
