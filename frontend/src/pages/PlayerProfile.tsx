import React, { useState, Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { matchService } from '../services/api';
import { usePlayerProfileData } from '../hooks/usePlayerProfileData';
import ProfileStats from '../components/ProfileStats';
import MatchesTable from '../components/MatchesTable';
import MatchDetailsModal from '../components/MatchDetailsModal';
import PlayerLink from '../components/PlayerLink';
import RouteLoader from '../components/RouteLoader';
import ScheduleDisplay from '../components/ScheduleDisplay';
import ChallengeFromPlayerModal from '../components/ChallengeFromPlayerModal';
import { useAuthStore } from '../store/authStore';
import ProfileMatchesPagination from '../components/ProfileMatchesPagination';

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

const PlayerProfile: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, user: currentUser } = useAuthStore();
  
  const [opponentSide, setOpponentSide] = useState(0);
  const [matchDetailsModal, setMatchDetailsModal] = useState<any>(null);
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
  const [showChallengeModal, setShowChallengeModal] = useState(false);

  const {
    profile, matches, eloHistoryMatches, availableFactions, opponentStats,
    loading, error, opponentStatsLoading, opponentStatsError, matchPagination,
  } = usePlayerProfileData({
    playerId: id,
    mode: 'public-player',
    activeTab,
    opponentSide,
    matchPage,
    matchFilters: appliedMatchFilters,
  });

  const openMatchDetails = (match: any) => {
    setMatchDetailsModal(match);
  };

  const closeMatchDetails = () => {
    setMatchDetailsModal(null);
  };

  const handleDownloadReplay = async (matchId: string, replayFilePath: string) => {
    try {
      if (!matchId || !replayFilePath) return;
      
      // Increment download count in the database
      await matchService.incrementReplayDownloads(matchId);
      
      // Extract filename from path
      const filename = replayFilePath.split('/').pop() || `replay_${matchId}`;
      
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
    return <div className="w-full max-w-6xl mx-auto px-4 py-8"><p>{t('loading')}</p></div>;
  }

  if (error) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 py-8">
        <p className="text-red-600">{error}</p>
        <button onClick={() => navigate('/players')}>{t('back_to_players')}</button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 py-8">
        <p>Profile not found</p>
        <button onClick={() => navigate('/players')}>{t('back_to_players')}</button>
      </div>
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
    <div className="bg-gradient-to-br from-gray-100 to-gray-300 min-h-screen py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-800 mb-8 text-center">{profile?.nickname}'s Profile</h1>
        
        {profile && (
          <>
            <ProfileStats player={profile} />
            
            <div className="mb-8">
              <div className="mb-3 flex justify-end">
                {isAuthenticated && currentUser?.id !== id && (
                  <button
                    onClick={() => setShowChallengeModal(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-semibold"
                  >
                    {t('events_button_challenge') || 'Challenge'}
                  </button>
                )}
              </div>
              <ScheduleDisplay 
                timezone={profile.timezone}
                availabilitySchedule={profile.availability_schedule}
                compact={true}
              />
            </div>

            {/* Tab Navigation */}
            <div className="flex flex-wrap gap-2 mb-8 border-b border-gray-300">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`px-4 py-3 font-semibold transition-all cursor-pointer ${
                    activeTab === tab.id
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-white rounded-t-lg'
                      : 'text-gray-600 hover:text-gray-800'
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

          {/* Tab Content */}
          <div className="space-y-6">
            {/* Overall Tab */}
            {activeTab === 'overall' && (
              <div className="bg-white rounded-lg shadow-md p-8">
                <Suspense fallback={<RouteLoader />}>
                  <EloChart 
                    matches={eloHistoryMatches}
                    currentPlayerId={id || ''}
                  />
                </Suspense>

                <div className="mt-8">
                  <h2 className="text-2xl font-semibold text-gray-800 mb-6">{t('recent_games')}</h2>
                  <MatchesTable 
                    matches={matches.slice(0, 10)}
                    currentPlayerId={id || ''}
                    onViewDetails={openMatchDetails}
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
              <div className="bg-white rounded-lg shadow-md p-8">
                <h2 className="text-2xl font-semibold text-gray-800 mb-6">{t('all_matches')}</h2>
                
                {/* Filters */}
                <div className="bg-gray-50 p-4 rounded-lg mb-6 overflow-x-auto -webkit-overflow-scrolling-touch">
                  <div className="flex gap-3 min-w-min items-end">
                    <div className="flex flex-col gap-2 flex-shrink-0 min-w-[180px]">
                      <label htmlFor="player" className="font-semibold text-gray-700">{t('filter_player')}</label>
                      <input
                        type="text"
                        id="player"
                        name="player"
                        placeholder={t('filter_by_player')}
                        value={filters.player}
                        onChange={handleFilterChange}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
                      />
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0 min-w-[180px]">
                      <label htmlFor="map" className="font-semibold text-gray-700">{t('filter_map')}</label>
                      <input
                        type="text"
                        id="map"
                        name="map"
                        placeholder={t('filter_by_map')}
                        value={filters.map}
                        onChange={handleFilterChange}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
                      />
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0 min-w-[180px]">
                      <label htmlFor="status" className="font-semibold text-gray-700">{t('filter_match_status')}</label>
                      <select
                        id="status"
                        name="status"
                        value={filters.status}
                        onChange={handleFilterChange}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
                      >
                        <option value="">{t('all')}</option>
                        <option value="unconfirmed">{t('match_status_unconfirmed')}</option>
                        <option value="confirmed">{t('match_status_confirmed')}</option>
                        <option value="disputed">{t('match_status_disputed')}</option>
                        <option value="cancelled">{t('match_status_cancelled')}</option>
                        <option value="reported">{t('match_status_reported') || 'Reported'}</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0 min-w-[180px]">
                      <label htmlFor="faction" className="font-semibold text-gray-700">{t('filter_faction')}</label>
                      <select
                        id="faction"
                        name="faction"
                        value={filters.faction}
                        onChange={handleFilterChange}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
                      >
                        <option value="">{t('all')}</option>
                        {availableFactions.map((faction: any) => (
                          <option key={faction.id || faction.name} value={faction.name}>
                            {faction.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button type="button"
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-semibold flex-shrink-0 h-fit"
                      onClick={applyMatchFilters}
                    >
                      {t('refresh') || 'Refresh'}
                    </button>
                    <button type="button"
                      className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-semibold flex-shrink-0 h-fit"
                      onClick={resetFilters}
                    >
                      {t('reset_filters')}
                    </button>
                  </div>
                </div>

                <MatchesTable 
                  matches={matches}
                  currentPlayerId={id || ''}
                  onViewDetails={openMatchDetails}
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
            )}

            {/* Opponents Tab */}
            {activeTab === 'opponents' && (
              <div className="bg-white rounded-lg shadow-md p-8">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b-2 border-gray-200">
                  <h2 className="text-2xl font-semibold text-gray-800">{t('my_opponents') || 'Opponents'}</h2>
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
                  <div className="text-center text-gray-600 py-8">{t('loading')}</div>
                )}

                {opponentStatsError && (
                  <div className="text-center text-red-600 py-8">{opponentStatsError}</div>
                )}

                {!opponentStatsLoading && !opponentStatsError && opponentStats.length === 0 && (
                  <div className="text-center text-gray-500 italic py-8">{t('no_opponent_data') || 'No opponent data available'}</div>
                )}

                {!opponentStatsLoading && !opponentStatsError && opponentStats.length > 0 && (
                  <>
                    <div className="mb-6">
                      <input
                        type="text"
                        placeholder={t('filter_by_opponent') || 'Filter by opponent...'}
                        value={filterOpponent}
                        onChange={(e) => setFilterOpponent(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
                      />
                    </div>

                    <div className="overflow-x-auto rounded-lg shadow-md">
                      <table className="w-full border-collapse bg-white text-sm">
                        <thead>
                          <tr className="bg-gradient-to-r from-gray-700 to-gray-800 text-white">
                            <th 
                              className="px-4 py-3 text-left font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('opponent_name')}
                            >
                              {t('opponent_name') || 'Opponent'}
                              {sortColumn === 'opponent_name' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('current_elo')}
                            >
                              {t('current_elo') || 'Current ELO'}
                              {sortColumn === 'current_elo' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('total_matches')}
                            >
                              {t('total_matches_label') || 'Total'}
                              {sortColumn === 'total_matches' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('wins')}
                            >
                              {t('wins') || 'Wins'}
                              {sortColumn === 'wins' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('losses')}
                            >
                              {t('losses') || 'Losses'}
                              {sortColumn === 'losses' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('win_percentage')}
                            >
                              {t('win_percentage') || 'Win %'}
                              {sortColumn === 'win_percentage' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('elo_gained')}
                            >
                              {t('elo_gained') || 'ELO Gained'}
                              {sortColumn === 'elo_gained' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('elo_lost')}
                            >
                              {t('elo_lost') || 'ELO Lost'}
                              {sortColumn === 'elo_lost' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                            <th 
                              className="px-4 py-3 text-center font-semibold cursor-pointer hover:bg-gray-600 transition-colors"
                              onClick={() => handleSort('last_match_date')}
                            >
                              {t('last_match') || 'Last Match'}
                              {sortColumn === 'last_match_date' && (sortDirection === 'desc' ? ' ▼' : ' ▲')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOpponentStats.map((stat, idx) => {
                            const winPercentage = stat.total_games > 0 
                              ? (stat.wins / stat.total_games) * 100 
                              : 0;
                            
                            return (
                              <tr 
                                key={stat.opponent_id} 
                                className={`border-b border-gray-200 transition-colors ${
                                  idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                                } hover:bg-blue-50`}
                              >
                                <td className="px-4 py-3 font-semibold text-gray-800">
                                  <PlayerLink nickname={stat.opponent_name} userId={stat.opponent_id} />
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-block px-3 py-1 bg-gradient-to-r from-blue-100 to-blue-200 text-blue-900 rounded font-semibold text-sm shadow-sm">
                                    {stat.current_elo}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center font-semibold text-gray-800">
                                  {stat.total_matches}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-block px-3 py-1 bg-gradient-to-r from-green-100 to-green-200 text-green-900 rounded font-semibold text-sm shadow-sm">
                                    {stat.wins}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-block px-3 py-1 bg-gradient-to-r from-red-100 to-red-200 text-red-900 rounded font-semibold text-sm shadow-sm">
                                    {stat.losses}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`inline-block px-3 py-1 rounded font-semibold text-sm shadow-sm ${
                                    winPercentage > 55 
                                      ? 'bg-gradient-to-r from-green-100 to-green-200 text-green-900'
                                      : winPercentage < 45 
                                      ? 'bg-gradient-to-r from-red-100 to-red-200 text-red-900'
                                      : 'bg-gradient-to-r from-gray-100 to-gray-200 text-gray-800'
                                  }`}>
                                    {winPercentage.toFixed(1)}%
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center font-bold text-green-600">
                                  +{Number(stat.elo_gained).toFixed(2)}
                                </td>
                                <td className="px-4 py-3 text-center font-bold text-red-600">
                                  -{Number(stat.elo_lost).toFixed(2)}
                                </td>
                                <td className="px-4 py-3 text-center text-gray-700 text-sm">
                                  {stat.last_match_date ? new Date(stat.last_match_date).toLocaleDateString() : 'N/A'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Performance by Map Tab */}
            {activeTab === 'by-map' && (
              <div className="bg-white rounded-lg shadow-md p-8">
                <Suspense fallback={<RouteLoader />}>
                  <PlayerStatsByMap playerId={id || ''} />
                </Suspense>
              </div>
            )}

            {/* Performance by Faction Tab */}
            {activeTab === 'by-faction' && (
              <div className="bg-white rounded-lg shadow-md p-8">
                <Suspense fallback={<RouteLoader />}>
                  <PlayerStatsByFaction playerId={id || ''} />
                </Suspense>
              </div>
            )}

            {/* Matchup Analysis Tab */}
            {activeTab === 'by-matchup' && (
              <div className="bg-white rounded-lg shadow-md p-8">
                <Suspense fallback={<RouteLoader />}>
                  <PlayerStatsByMatchup playerId={id || ''} />
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
        onDownloadReplay={handleDownloadReplay}
      />
      <ChallengeFromPlayerModal
        isOpen={showChallengeModal}
        onClose={() => setShowChallengeModal(false)}
        onSuccess={() => setShowChallengeModal(false)}
        opponentId={id || ''}
        opponentNickname={profile?.nickname || 'Player'}
      />
      </div>
    </div>
  );
};

export default PlayerProfile;
