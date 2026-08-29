import React, { useState, Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { matchService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { usePlayerProfileData } from '../hooks/usePlayerProfileData';
import MainLayout from '../components/MainLayout';
import ProfileStats from '../components/ProfileStats';
import MatchesTable from '../components/MatchesTable';
import MatchDetailsModal from '../components/MatchDetailsModal';
import MatchConfirmationModal from '../components/MatchConfirmationModal';
import PlayerLink from '../components/PlayerLink';
import RouteLoader from '../components/RouteLoader';
import ScheduleDisplay from '../components/ScheduleDisplay';
import ProfileMatchesPagination from '../components/ProfileMatchesPagination';
import WaitingLobby from '../components/WaitingLobby';

// Lazy-load heavy chart and statistics components
const EloChart = lazy(() => import('../components/EloChart'));
const PlayerStatsByMap = lazy(() => import('../components/PlayerStatsByMap'));
const PlayerStatsByFaction = lazy(() => import('../components/PlayerStatsByFaction'));
const PlayerStatsByMatchup = lazy(() => import('../components/PlayerStatsByMatchup'));

type ProfileTab = 'overall' | 'matches' | 'opponents' | 'by-map' | 'by-faction' | 'by-matchup';

interface FilterState {
  player: string;
  map: string;
  status: string;
  faction: string;
}

const User: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, userId } = useAuthStore();
  
  const [opponentSide, setOpponentSide] = useState(0);
  const [matchDetailsModal, setMatchDetailsModal] = useState<any>(null);
  const [confirmationModal, setConfirmationModal] = useState<any>({
    isOpen: false,
    match: null,
  });
  const [activeTab, setActiveTab] = useState<ProfileTab>((searchParams.get('tab') as ProfileTab) || 'overall');
  const [sortColumn, setSortColumn] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterOpponent, setFilterOpponent] = useState<string>('');
  const [filters, setFilters] = useState<FilterState>({
    player: '',
    map: '',
    status: '',
    faction: '',
  });
  const [appliedMatchFilters, setAppliedMatchFilters] = useState<FilterState>({
    player: '', map: '', status: '', faction: '',
  });
  const [matchPage, setMatchPage] = useState(1);

  const {
    profile, matches, eloHistoryMatches, availableFactions, opponentStats,
    loading, error, opponentStatsLoading, opponentStatsError, matchPagination, refreshData,
  } = usePlayerProfileData({
    // Do not start public data requests while the authentication guard is redirecting.
    playerId: isAuthenticated && userId ? userId : undefined,
    mode: 'current-user',
    activeTab,
    opponentSide,
    matchPage,
    matchFilters: appliedMatchFilters,
  });

  if (!isAuthenticated) {
    navigate('/login');
    return null;
  }

  const openMatchDetails = (match: any) => {
    setMatchDetailsModal(match);
  };

  const closeMatchDetails = () => {
    setMatchDetailsModal(null);
  };

  const openConfirmation = (match: any) => {
    setConfirmationModal({
      isOpen: true,
      match: match,
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
    refreshData();
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetFilters = () => {
    const emptyFilters = {
      player: '',
      map: '',
      status: '',
      faction: '',
    };
    setFilters(emptyFilters);
    setAppliedMatchFilters(emptyFilters);
    setMatchPage(1);
  };

  const applyMatchFilters = () => {
    setAppliedMatchFilters(filters);
    setMatchPage(1);
  };

  const handleTextFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyMatchFilters();
    }
  };

  // Filter and sort opponent stats
  const filteredOpponentStats = opponentStats
    .filter(stat => !filterOpponent || stat.opponent_name.toLowerCase().includes(filterOpponent.toLowerCase()))
    .sort((a, b) => {
      if (!sortColumn) return b.total_matches - a.total_matches;
      
      let aVal: any = a[sortColumn as keyof typeof a];
      let bVal: any = b[sortColumn as keyof typeof b];
      
      // Special handling for win_percentage (calculated field)
      if (sortColumn === 'win_percentage') {
        const aWinPct = a.total_games > 0 ? (a.wins / a.total_games) * 100 : 0;
        const bWinPct = b.total_games > 0 ? (b.wins / b.total_games) * 100 : 0;
        return sortDirection === 'asc' ? aWinPct - bWinPct : bWinPct - aWinPct;
      }
      
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  if (loading) {
    return <MainLayout><div className="max-w-6xl mx-auto px-4 py-8"><p>{t('loading')}</p></div></MainLayout>;
  }

  if (error) {
    return (
      <MainLayout>
        <div className="max-w-6xl mx-auto px-4 py-8">
          <p className="text-red-600 font-semibold">{error}</p>
        </div>
      </MainLayout>
    );
  }

  if (!profile) {
    return (
      <MainLayout>
        <div className="max-w-6xl mx-auto px-4 py-8">
          <p>Profile not found</p>
        </div>
      </MainLayout>
    );
  }

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'overall', label: t('overall_statistics') || 'Overall' },
    { id: 'matches', label: t('matches_label') || 'Matches' },
    { id: 'opponents', label: t('my_opponents') || 'Opponents' },
    { id: 'by-map', label: t('performance_by_map') || 'By Map' },
    { id: 'by-faction', label: t('performance_by_faction') || 'By Faction' },
    { id: 'by-matchup', label: t('matchup_analysis') || 'Matchup Analysis' },
  ];

  return (
    <MainLayout>
      <div data-help-id="region-user-profile" className="bg-gradient-to-br from-gray-100 to-gray-300 min-h-screen py-8 px-4">
        <h1 className="text-4xl font-bold text-gray-800 mb-8 text-center">{profile?.nickname}'s Profile</h1>
        
        {profile && (
          <>
            <div data-help-id="region-user-profile-statistics"><ProfileStats player={profile} /></div>
            {/* Challenge availability is an operational action, so keep it on /user with other player actions. */}
            <div className="mb-8"><WaitingLobby manage timezone={profile?.timezone || 'UTC'} /></div>
            
            <div className="mb-8">
              <ScheduleDisplay 
                timezone={profile.timezone}
                availabilitySchedule={profile.availability_schedule}
                compact={true}
              />
            </div>

            {/* Tab Navigation */}
            <div data-help-id="region-user-statistics-navigation" className="flex flex-wrap gap-2 mb-6 border-b border-gray-300 justify-between items-center">
              <div className="flex flex-wrap gap-2">
                {tabs.map((tab) => (
                  <button data-help-id={`action-user-tab-${tab.id}`}
                    key={tab.id}
                    className={`px-4 py-2 font-semibold rounded-t-lg transition-all ${
                      activeTab === tab.id
                        ? 'bg-blue-500 text-white border-b-4 border-blue-600'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setSearchParams({ tab: tab.id });
                      setSortColumn('');
                      setFilterOpponent('');
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button data-help-id="action-refresh-user-profile"
                onClick={() => {
                  refreshData();
                }}
                className="px-3 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 font-semibold rounded transition-colors flex items-center gap-2"
                title="Refresh all data"
              >
                🔄 {t('refresh') || 'Refresh'}
              </button>
            </div>

            {/* Tab Content */}
            <div className="space-y-6">
              {/* Overall Tab */}
              {activeTab === 'overall' && (
                <div data-help-id="region-user-tab-overall" className="bg-white rounded-lg shadow-md p-8">
                  <div data-help-id="region-user-elo-chart">
                    <Suspense fallback={<RouteLoader />}>
                      <EloChart
                        matches={eloHistoryMatches}
                        currentPlayerId={userId || ''}
                      />
                    </Suspense>
                  </div>

                  <div className="recent-games-container">
                    <h2>{t('recent_games')}</h2>
                    <MatchesTable 
                      matches={matches.slice(0, 10)}
                      currentPlayerId={userId || ''}
                      onViewDetails={openMatchDetails}
                      onOpenConfirmation={openConfirmation}
                      onDownloadReplay={async (matchId, replayFilePath) => {
                        try {
                          if (!replayFilePath) return;
                          
                          // Extract filename from path
                          const filename = replayFilePath.split('/').pop() || `replay_${matchId}`;
                          
                          // Increment download count
                          await matchService.incrementReplayDownloads(matchId);
                          
                          // Use the replay_file_path HTTPS URL directly
                          const link = document.createElement('a');
                          link.href = replayFilePath;
                          link.download = filename;
                          link.target = '_blank';
                          
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        } catch (err) {
                          console.error('Error downloading replay:', err);
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Matches Tab */}
              {activeTab === 'matches' && (
                <div data-help-id="region-user-tab-matches" className="bg-white rounded-lg shadow-md p-8">
                  <div>
                    <h2 className="text-2xl font-bold mb-6 text-gray-800">{t('all_matches')}</h2>
                    
                    {/* Filters */}
                    <div className="bg-gray-50 p-4 rounded-lg mb-6 overflow-x-auto -webkit-overflow-scrolling-touch">
                      <div className="flex gap-3 min-w-min">
                        <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
                          <label htmlFor="player" className="text-sm font-semibold text-gray-700">{t('filter_player')}</label>
                          <input
                            type="text"
                            id="player"
                            name="player"
                            placeholder={t('filter_by_player')}
                            value={filters.player}
                            onChange={handleFilterChange}
                            onKeyDown={handleTextFilterKeyDown}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
                          <label htmlFor="map" className="text-sm font-semibold text-gray-700">{t('filter_map')}</label>
                          <input
                            type="text"
                            id="map"
                            name="map"
                            placeholder={t('filter_by_map')}
                            value={filters.map}
                            onChange={handleFilterChange}
                            onKeyDown={handleTextFilterKeyDown}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
                          <label htmlFor="status" className="text-sm font-semibold text-gray-700">{t('filter_match_status')}</label>
                          <select
                            id="status"
                            name="status"
                            value={filters.status}
                            onChange={handleFilterChange}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">{t('all')}</option>
                            <option value="unconfirmed">{t('match_status_unconfirmed')}</option>
                            <option value="confirmed">{t('match_status_confirmed')}</option>
                            <option value="disputed">{t('match_status_disputed')}</option>
                            <option value="cancelled">{t('match_status_cancelled')}</option>
                            <option value="reported">{t('match_status_reported') || 'Reported'}</option>
                            <option value="pending_report">{t('match_status_pending_report') || 'Pending report'}</option>
                          </select>
                        </div>

                        <div className="flex flex-col gap-2 flex-shrink-0 min-w-[200px]">
                          <label htmlFor="faction" className="text-sm font-semibold text-gray-700">{t('filter_faction')}</label>
                          <select
                            id="faction"
                            name="faction"
                            value={filters.faction}
                            onChange={handleFilterChange}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">{t('all')}</option>
                            {availableFactions.map((faction: any) => (
                              <option key={faction.id || faction.name} value={faction.name}>
                                {faction.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <button type="button" className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold flex-shrink-0 h-fit self-end" onClick={applyMatchFilters}>{t('refresh') || 'Refresh'}</button>
                        <button type="button" className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-semibold flex-shrink-0 h-fit self-end" onClick={resetFilters}>{t('reset_filters')}</button>
                      </div>
                    </div>

                    <MatchesTable 
                      matches={matches}
                      currentPlayerId={userId || ''}
                      onViewDetails={openMatchDetails}
                      onOpenConfirmation={openConfirmation}
                      onDownloadReplay={async (matchId, replayFilePath) => {
                        try {
                          if (!replayFilePath) return;
                          
                          // Extract filename from path
                          const filename = replayFilePath.split('/').pop() || `replay_${matchId}`;
                          
                          // Increment download count
                          await matchService.incrementReplayDownloads(matchId);
                          
                          // Use the replay_file_path HTTPS URL directly
                          const link = document.createElement('a');
                          link.href = replayFilePath;
                          link.download = filename;
                          link.target = '_blank';
                          
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        } catch (err) {
                          console.error('Error downloading replay:', err);
                        }
                      }}
                    />
                    <ProfileMatchesPagination {...matchPagination} onPageChange={setMatchPage} />
                  </div>
                </div>
              )}

              {/* Opponents Tab */}
              {activeTab === 'opponents' && (
                <div data-help-id="region-user-tab-opponents" className="bg-white rounded-lg shadow-md p-8">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                      <h2 className="text-2xl font-bold text-gray-800">{t('my_opponents') || 'Opponents'}</h2>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-600">{t('side') || 'Side'}:</span>
                        {([0, 1, 2] as const).map((val) => (
                          <button key={val} onClick={() => setOpponentSide(val)}
                            className={`px-3 py-1 text-sm font-semibold rounded transition-colors ${
                              opponentSide === val
                                ? val === 0 ? 'bg-gray-700 text-white' : val === 1 ? 'bg-amber-500 text-white' : 'bg-purple-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}>
                            {val === 0 ? (t('all') || 'All') : `Side ${val}`}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    {opponentStatsLoading && (
                      <div className="text-center py-8 text-gray-600 text-lg">{t('loading')}</div>
                    )}

                    {opponentStatsError && (
                      <div className="text-red-600 font-semibold p-4 bg-red-50 rounded-lg">{opponentStatsError}</div>
                    )}

                    {!opponentStatsLoading && !opponentStatsError && opponentStats.length === 0 && (
                      <div className="text-center py-8 text-gray-500">{t('no_opponent_data') || 'No opponent data available'}</div>
                    )}

                    {!opponentStatsLoading && !opponentStatsError && opponentStats.length > 0 && (
                      <>
                        <div className="mb-6">
                          <input
                            type="text"
                            placeholder={t('filter_by_opponent') || 'Filter by opponent...'}
                            value={filterOpponent}
                            onChange={(e) => setFilterOpponent(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="bg-gray-100 border-b border-gray-300">
                                <th 
                                  className="px-4 py-2 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200"
                                  onClick={() => handleSort('opponent_name')}
                                >
                                  {t('opponent_name') || 'Opponent'}
                                  {sortColumn === 'opponent_name' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('current_elo')}>
                                  {t('current_elo') || 'Current ELO'}
                                  {sortColumn === 'current_elo' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('total_matches')}>
                                  {t('total_matches_label') || 'Total'}
                                  {sortColumn === 'total_matches' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('wins')}>
                                  {t('wins') || 'Wins'}
                                  {sortColumn === 'wins' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('losses')}>
                                  {t('losses') || 'Losses'}
                                  {sortColumn === 'losses' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('win_percentage')}>
                                  {t('win_percentage') || 'Win %'}
                                  {sortColumn === 'win_percentage' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('elo_gained')}>
                                  {t('elo_gained') || 'ELO Gained'}
                                  {sortColumn === 'elo_gained' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                                <th className="px-4 py-2 text-right font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('elo_lost')}>
                                  {t('elo_lost') || 'ELO Lost'}
                                  {sortColumn === 'elo_lost' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                                <th className="px-4 py-2 text-left font-semibold text-gray-700 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('last_match_date')}>
                                  {t('last_match') || 'Last Match'}
                                  {sortColumn === 'last_match_date' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredOpponentStats.map((stat) => {
                                const winPercentage = stat.total_games > 0 
                                  ? (stat.wins / stat.total_games) * 100 
                                  : 0;
                                
                                return (
                                  <tr key={stat.opponent_id} className="border-b border-gray-200 hover:bg-gray-50">
                                    <td className="px-4 py-2 text-left">
                                      <PlayerLink nickname={stat.opponent_name} userId={stat.opponent_id} />
                                    </td>
                                    <td className="px-4 py-2 text-right font-semibold text-gray-700">{stat.current_elo}</td>
                                    <td className="px-4 py-2 text-right font-bold text-gray-900">{stat.total_matches}</td>
                                    <td className="px-4 py-2 text-right font-semibold text-green-600">{stat.wins}</td>
                                    <td className="px-4 py-2 text-right font-semibold text-red-600">{stat.losses}</td>
                                    <td className={`px-4 py-2 text-right font-semibold ${
                                      winPercentage > 55 ? 'text-green-600' : winPercentage < 45 ? 'text-red-600' : 'text-gray-600'
                                    }`}>
                                      {winPercentage.toFixed(1)}%
                                    </td>
                                    <td className="px-4 py-2 text-right font-semibold text-green-600">+{Number(stat.elo_gained).toFixed(2)}</td>
                                    <td className="px-4 py-2 text-right font-semibold text-red-600">-{Number(stat.elo_lost).toFixed(2)}</td>
                                    <td className="px-4 py-2 text-left text-gray-600">{stat.last_match_date ? new Date(stat.last_match_date).toLocaleDateString() : 'N/A'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Performance by Map Tab */}
              {activeTab === 'by-map' && (
                <div data-help-id="region-user-tab-by-map" className="bg-white rounded-lg shadow-md p-8">
                  <Suspense fallback={<RouteLoader />}>
                    <PlayerStatsByMap playerId={userId || ''} />
                  </Suspense>
                </div>
              )}

              {/* Performance by Faction Tab */}
              {activeTab === 'by-faction' && (
                <div data-help-id="region-user-tab-by-faction" className="bg-white rounded-lg shadow-md p-8">
                  <Suspense fallback={<RouteLoader />}>
                    <PlayerStatsByFaction playerId={userId || ''} />
                  </Suspense>
                </div>
              )}

              {/* Matchup Analysis Tab */}
              {activeTab === 'by-matchup' && (
                <div data-help-id="region-user-tab-by-matchup" className="bg-white rounded-lg shadow-md p-8">
                  <Suspense fallback={<RouteLoader />}>
                    <PlayerStatsByMatchup playerId={userId || ''} />
                  </Suspense>
                </div>
              )}
            </div>
          </>
        )}

        {/* Match Details Modal */}
        <MatchDetailsModal 
          match={matchDetailsModal}
          isOpen={!!matchDetailsModal}
          onClose={closeMatchDetails}
        />

        {/* Match Confirmation Modal */}
        {confirmationModal.isOpen && confirmationModal.match && (
          <MatchConfirmationModal
            match={confirmationModal.match}
            currentPlayerId={userId || ''}
            onClose={closeConfirmation}
            onSubmit={handleConfirmationSuccess}
          />
        )}
      </div>
    </MainLayout>
  );
};

export default User;
