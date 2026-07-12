import { useCallback, useEffect, useState } from 'react';
import { userService, publicService } from '../services/api';
import { playerStatisticsService } from '../services/playerStatisticsService';

type ProfileMode = 'current-user' | 'public-player';

interface UsePlayerProfileDataOptions {
  playerId?: string;
  mode: ProfileMode;
  activeTab: string;
  opponentSide: number;
  matchPage: number;
  matchFilters: Record<string, string>;
}

interface OpponentStat {
  opponent_id: string;
  opponent_name: string;
  total_matches: number;
  total_games: number;
  wins: number;
  losses: number;
  winrate: number;
  current_elo: number;
  elo_gained: number;
  elo_lost: number;
  last_elo_against_me: number;
  last_match_date: string | null;
}

/**
 * Loads the data shared by the authenticated and public player profiles.
 * The mode only selects the profile endpoint; all statistical data follows the
 * same source and normalization path so the two pages cannot drift apart.
 */
export function usePlayerProfileData({
  playerId,
  mode,
  activeTab,
  opponentSide,
  matchPage,
  matchFilters,
}: UsePlayerProfileDataOptions) {
  const [profile, setProfile] = useState<any>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [eloHistoryMatches, setEloHistoryMatches] = useState<any[]>([]);
  const [availableFactions, setAvailableFactions] = useState<any[]>([]);
  const [opponentStats, setOpponentStats] = useState<OpponentStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opponentStatsLoading, setOpponentStatsLoading] = useState(false);
  const [opponentStatsError, setOpponentStatsError] = useState('');
  const [matchPagination, setMatchPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    showing: 0,
  });

  const loadProfileData = useCallback(async () => {
    if (!playerId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const profileRequest = mode === 'current-user'
        ? userService.getProfile()
        : publicService.getPlayerProfile(playerId);

      const profileRes = await profileRequest;

      setProfile(profileRes.data);
    } catch (err) {
      console.error('Error loading player profile data:', err);
      setError('Error loading profile');
    } finally {
      setLoading(false);
    }
  }, [mode, playerId]);

  const loadTabData = useCallback(async () => {
    if (!playerId) return;

    try {
      if (activeTab === 'overall') {
        const response = await userService.getEloHistory(playerId);
        setEloHistoryMatches(response.data || []);
      } else if (activeTab === 'matches') {
        const response = await publicService.getFactions();
        setAvailableFactions(response.data || []);
      }
    } catch (err) {
      console.error('Error loading profile tab data:', err);
      setError('Error loading profile data');
    }
  }, [activeTab, playerId]);

  const loadMatches = useCallback(async () => {
    if (!playerId || (activeTab !== 'overall' && activeTab !== 'matches')) return;

    try {
      const filters = mode === 'current-user'
        ? { ...matchFilters, include_pending: 'true' }
        : matchFilters;
      const response = await userService.getRecentMatches(playerId, matchPage, filters);
      setMatches(response.data?.data || response.data || []);
      setMatchPagination(response.data?.pagination || {
        page: matchPage,
        limit: 20,
        total: response.data?.length || 0,
        totalPages: 1,
        showing: response.data?.length || 0,
      });
    } catch (err) {
      console.error('Error loading player matches:', err);
      setError('Error loading matches');
    }
  }, [activeTab, matchFilters, matchPage, mode, playerId]);

  const loadOpponentStats = useCallback(async () => {
    if (!playerId) return;

    try {
      setOpponentStatsLoading(true);
      setOpponentStatsError('');
      const response = await playerStatisticsService.getRecentOpponents(playerId, 100, opponentSide);

      const normalized = (response || []).map((opponent: any): OpponentStat => ({
        opponent_id: opponent.opponent_id,
        opponent_name: opponent.opponent_name,
        total_matches: opponent.total_games,
        total_games: opponent.total_games,
        wins: opponent.wins,
        losses: opponent.losses,
        winrate: Number(opponent.winrate),
        current_elo: opponent.current_elo,
        elo_gained: Number(opponent.elo_gained),
        elo_lost: Number(opponent.elo_lost),
        last_elo_against_me: Number(opponent.last_elo_against_me),
        last_match_date: opponent.last_match_date,
      }));

      setOpponentStats(normalized);
    } catch (err) {
      console.error('Error loading opponent statistics:', err);
      setOpponentStatsError('Error loading opponent data');
    } finally {
      setOpponentStatsLoading(false);
    }
  }, [opponentSide, playerId]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  useEffect(() => {
    if (activeTab === 'overall' || activeTab === 'matches') {
      loadMatches();
    }
  }, [activeTab, loadMatches]);

  // Opponent data is loaded only when its tab is opened, while side changes
  // remain immediate as required by the profile statistics UI.
  useEffect(() => {
    if (activeTab === 'opponents') {
      loadOpponentStats();
    }
  }, [activeTab, loadOpponentStats]);

  const refreshData = useCallback(async () => {
    const requests: Promise<unknown>[] = [loadProfileData(), loadTabData()];
    if (activeTab === 'overall' || activeTab === 'matches') requests.push(loadMatches());
    await Promise.all(requests);
    if (activeTab === 'opponents') {
      await loadOpponentStats();
    }
  }, [activeTab, loadMatches, loadOpponentStats, loadProfileData, loadTabData]);

  return {
    profile,
    matches,
    eloHistoryMatches,
    availableFactions,
    opponentStats,
    loading,
    error,
    opponentStatsLoading,
    opponentStatsError,
    matchPagination,
    refreshData,
  };
}
