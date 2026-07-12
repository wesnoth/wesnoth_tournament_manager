import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { statisticsService } from '../services/statisticsService';

interface FactionStats {
  faction_id: string;
  faction_name: string;
  total_games: number;
  wins: number;
  losses: number;
  global_winrate: number;
  maps_played: number;
  side1_games: number;
  side1_wins: number;
  side1_winrate: number | null;
  side2_games: number;
  side2_wins: number;
  side2_winrate: number | null;
}

interface ComparisonData {
  map_id?: string;
  map_name?: string;
  faction_id?: string;
  faction_name?: string;
  opponent_faction_id?: string;
  opponent_faction_name?: string;
  winrate: number;
  total_games: number;
  wins: number;
  losses: number;
  side1_games?: number;
  side1_wins?: number;
  side2_games?: number;
  side2_wins?: number;
}

interface FactionBalanceTabProps {
  beforeData?: ComparisonData[] | null;
  afterData?: ComparisonData[] | null;
  beforeLabel?: string;
  afterLabel?: string;
}

const FactionBalanceTab: React.FC<FactionBalanceTabProps> = ({ beforeData = null, afterData = null, beforeLabel, afterLabel }) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<FactionStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [minGamesThreshold, setMinGamesThreshold] = useState(5);
  const [pendingMinGames, setPendingMinGames] = useState(5);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const config = await statisticsService.getConfig();
        if (config.minGamesThreshold) {
          setMinGamesThreshold(config.minGamesThreshold);
          setPendingMinGames(config.minGamesThreshold);
        }
      } catch (err) {
        console.warn('Could not load config, using default threshold');
        // Use default value on error
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await statisticsService.getGlobalFactionStats(minGamesThreshold);
        // Convert string winrates to numbers and calculate wins/losses if not present
        const converted = data.map((item: any) => {
          const winrate = typeof item.global_winrate === 'string' ? parseFloat(item.global_winrate) : item.global_winrate;
          const total = item.total_games || 0;
          const wins = item.wins || Math.round((winrate / 100) * total);
          const losses = item.losses || (total - wins);
          
          return {
            ...item,
            global_winrate: winrate,
            wins,
            losses,
            side1_games: item.side1_games || 0,
            side1_wins: item.side1_wins || 0,
            side1_winrate: item.side1_winrate != null ? (typeof item.side1_winrate === 'string' ? parseFloat(item.side1_winrate) : item.side1_winrate) : null,
            side2_games: item.side2_games || 0,
            side2_wins: item.side2_wins || 0,
            side2_winrate: item.side2_winrate != null ? (typeof item.side2_winrate === 'string' ? parseFloat(item.side2_winrate) : item.side2_winrate) : null,
          };
        });
        setStats(converted);
      } catch (err) {
        console.error('Error fetching faction balance stats:', err);
        setError('Error loading faction statistics');
      } finally {
        setLoading(false);
      }
    };

    // Only fetch global stats if not in comparison mode
    if (!beforeData && !afterData) {
      fetchStats();
    } else {
      setLoading(false);
    }
  }, [beforeData, afterData, minGamesThreshold]);

  const applyMinGames = () => {
    setMinGamesThreshold(Math.max(1, Math.min(1000000, pendingMinGames || 1)));
  };

  const minimumGamesControl = (
    <div className="bg-gray-100 p-4 rounded-lg mb-6 border border-gray-200 flex items-center gap-4">
      <label className="flex items-center gap-2 font-semibold text-gray-800">
        {t('minimum_games') || 'Minimum games'}:
        <input type="number" min="1" max="1000000" value={pendingMinGames}
          onChange={e => setPendingMinGames(Math.max(1, parseInt(e.target.value) || 1))}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 w-24" />
      </label>
      <button type="button" onClick={applyMinGames}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        {t('refresh') || 'Refresh'}
      </button>
    </div>
  );

  const getWinrateColorClass = (winrate: number) => {
    if (winrate > 55) return 'high';
    if (winrate < 45) return 'low';
    return 'balanced';
  };

  const aggregateFactionData = (data: ComparisonData[]) => {
    const factionMap = new Map<string, { 
      faction_id: string;
      faction_name: string;
      total_games: number;
      wins: number;
      losses: number;
      side1_games: number;
      side1_wins: number;
      side2_games: number;
      side2_wins: number;
      maps: Set<string>;
    }>();
    
    data.forEach(item => {
      const key = item.faction_id || '';
      if (!factionMap.has(key)) {
        factionMap.set(key, {
          faction_id: item.faction_id || '',
          faction_name: item.faction_name || '',
          total_games: 0, wins: 0, losses: 0,
          side1_games: 0, side1_wins: 0,
          side2_games: 0, side2_wins: 0,
          maps: new Set<string>(),
        });
      }
      const stats = factionMap.get(key)!;
      stats.total_games += item.total_games;
      stats.wins += item.wins;
      stats.losses += item.losses;
      stats.side1_games += item.side1_games ?? 0;
      stats.side1_wins  += item.side1_wins  ?? 0;
      stats.side2_games += item.side2_games ?? 0;
      stats.side2_wins  += item.side2_wins  ?? 0;
      if (item.map_id) stats.maps.add(item.map_id);
    });

    return Array.from(factionMap.values())
      .filter(stat => stat.total_games >= minGamesThreshold)
      .map(stat => ({
        faction_id: stat.faction_id,
        faction_name: stat.faction_name,
        total_games: stat.total_games,
        wins: stat.wins,
        losses: stat.losses,
        winrate: stat.total_games > 0 ? (stat.wins / stat.total_games) * 100 : 0,
        side1_games: stat.side1_games,
        side1_winrate: stat.side1_games > 0 ? (stat.side1_wins / stat.side1_games) * 100 : null,
        side2_games: stat.side2_games,
        side2_winrate: stat.side2_games > 0 ? (stat.side2_wins / stat.side2_games) * 100 : null,
        maps_played: stat.maps.size,
      })).sort((a, b) => b.winrate - a.winrate);
  };

  if (loading) return <div className="p-8 text-center text-gray-600 bg-gray-50 rounded-lg">{t('loading')}</div>;
  if (error) return <div className="p-8 text-center text-red-600 bg-red-50 rounded-lg border-l-4 border-red-500">{error}</div>;

  // If in comparison mode
  if (beforeData && afterData) {
    const beforeAgg = aggregateFactionData(beforeData);
    const afterAgg = aggregateFactionData(afterData);
    
    // Create a combined view: merge before and after by faction_id
    const allFactionIds = new Set([
      ...beforeAgg.map(f => f.faction_id),
      ...afterAgg.map(f => f.faction_id)
    ]);
    
    const beforeMap = new Map(beforeAgg.map(f => [f.faction_id, f]));
    const afterMap = new Map(afterAgg.map(f => [f.faction_id, f]));
    
    const combined = Array.from(allFactionIds)
      .map(factionId => {
        const before = beforeMap.get(factionId);
        const after = afterMap.get(factionId);
        return {
          faction_id: factionId,
          faction_name: after?.faction_name || before?.faction_name || '',
          before,
          after,
        };
      })
      .filter(item => item.after || item.before) // Keep items with data in either period
      .sort((a, b) => {
        // Match global sort: highest winrate first
        const aWinrate = a.after?.winrate ?? a.before?.winrate ?? 0;
        const bWinrate = b.after?.winrate ?? b.before?.winrate ?? 0;
        return bWinrate - aWinrate;
      });

    return (
      <div className="bg-white rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold text-gray-800 mb-3">{t('faction_balance_comparison') || 'Faction Balance - Before & After'}</h3>
        <p className="text-blue-600 text-sm mb-6 p-3 bg-blue-50 rounded border-l-4 border-blue-500">
          {t('before_event') || 'Before'}: {beforeAgg.reduce((s, f) => s + f.total_games, 0)} faction-games ({Math.round(beforeAgg.reduce((s, f) => s + f.total_games, 0) / 2)} matches){beforeLabel ? ` · ${beforeLabel}` : ''} |{' '}
          {t('after_event') || 'After'}: {afterAgg.reduce((s, f) => s + f.total_games, 0)} faction-games ({Math.round(afterAgg.reduce((s, f) => s + f.total_games, 0) / 2)} matches){afterLabel ? ` · ${afterLabel}` : ''}
        </p>
        {minimumGamesControl}
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full border-collapse bg-white">
            <thead className="bg-gray-100 border-b-2 border-gray-300">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('faction') || 'Faction'}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600" colSpan={4}>{t('before_event') || 'Before'}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-800" colSpan={4}>{t('after_event') || 'After'}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-800">{t('change') || 'Change'}</th>
              </tr>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs text-gray-500"></th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">{t('total_games') || 'G'}</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">{t('winrate') || 'WR%'}</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">{t('side1_winrate') || 'S1'}</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">{t('side2_winrate') || 'S2'}</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">{t('total_games') || 'G'}</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">{t('winrate') || 'WR%'}</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">{t('side1_winrate') || 'S1'}</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">{t('side2_winrate') || 'S2'}</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500">Δ WR%</th>
              </tr>
            </thead>
            <tbody>
              {combined.map((item) => {
                const wrBefore = item.before?.winrate ?? null;
                const wrAfter  = item.after?.winrate  ?? null;
                const wrDelta  = wrBefore != null && wrAfter != null ? wrAfter - wrBefore : null;
                return (
                  <tr key={item.faction_id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-800">{item.faction_name}</td>
                    {/* Before */}
                    <td className="px-3 py-3 text-center text-gray-500 text-sm">{item.before?.total_games ?? '—'}</td>
                    <td className="px-3 py-3 text-center">
                      {wrBefore != null ? (
                        <span className={`px-2 py-0.5 rounded text-sm font-semibold ${
                          wrBefore > 55 ? 'bg-green-100 text-green-700' :
                          wrBefore < 45 ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{wrBefore.toFixed(1)}%</span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {item.before?.side1_winrate != null ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${item.before.side1_winrate > 55 ? 'bg-green-100 text-green-700' : item.before.side1_winrate < 45 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{item.before.side1_winrate.toFixed(1)}%</span>
                          <span className="text-xs text-gray-400">{item.before.side1_games}g</span>
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {item.before?.side2_winrate != null ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${item.before.side2_winrate > 55 ? 'bg-green-100 text-green-700' : item.before.side2_winrate < 45 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{item.before.side2_winrate.toFixed(1)}%</span>
                          <span className="text-xs text-gray-400">{item.before.side2_games}g</span>
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    {/* After */}
                    <td className="px-3 py-3 text-center text-gray-700 text-sm font-semibold">{item.after?.total_games ?? '—'}</td>
                    <td className="px-3 py-3 text-center">
                      {wrAfter != null ? (
                        <span className={`px-2 py-0.5 rounded text-sm font-semibold ${
                          wrAfter > 55 ? 'bg-green-100 text-green-700' :
                          wrAfter < 45 ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{wrAfter.toFixed(1)}%</span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {item.after?.side1_winrate != null ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${item.after.side1_winrate > 55 ? 'bg-green-100 text-green-700' : item.after.side1_winrate < 45 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{item.after.side1_winrate.toFixed(1)}%</span>
                          <span className="text-xs text-gray-400">{item.after.side1_games}g</span>
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {item.after?.side2_winrate != null ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${item.after.side2_winrate > 55 ? 'bg-green-100 text-green-700' : item.after.side2_winrate < 45 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{item.after.side2_winrate.toFixed(1)}%</span>
                          <span className="text-xs text-gray-400">{item.after.side2_games}g</span>
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    {/* Delta */}
                    <td className="px-3 py-3 text-center">
                      {wrDelta != null ? (
                        <span className={`px-2 py-0.5 rounded font-semibold text-sm ${
                          wrDelta > 2 ? 'bg-green-100 text-green-700' :
                          wrDelta < -2 ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {wrDelta > 0 ? '+' : ''}{wrDelta.toFixed(1)}%
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Default global view
  return (
    <div className="bg-white rounded-lg p-6 shadow-md">
      <h3 className="text-xl font-semibold text-gray-800 mb-3">{t('faction_balance_title') || 'Global Faction Balance'}</h3>
      <p className="text-gray-600 text-sm mb-6 pb-3 px-3 bg-blue-50 border-l-4 border-blue-500 rounded">{t('faction_balance_explanation') || 'Detailed analysis of faction balance across all tournaments'}</p>
      {minimumGamesControl}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full border-collapse bg-white">
          <thead className="bg-gray-100 border-b-2 border-gray-300">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('faction') || 'Faction'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('total_games') || 'Games'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('wins') || 'Wins'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('losses') || 'Losses'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('winrate') || 'Win Rate'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('side1_winrate') || 'Side 1 WR'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('side2_winrate') || 'Side 2 WR'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('maps_played') || 'Maps'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('imbalance') || 'Imbalance'}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((stat) => (
              <tr key={stat.faction_id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-4 py-3 font-semibold text-gray-800">{stat.faction_name}</td>
                <td className="px-4 py-3 text-gray-700">{stat.total_games}</td>
                <td className="px-4 py-3 text-green-600 font-semibold">{stat.wins}</td>
                <td className="px-4 py-3 text-red-600 font-semibold">{stat.losses}</td>
                <td className="px-4 py-3">
                  <span className={`px-3 py-1 rounded-lg font-semibold inline-block min-w-fit ${
                    stat.global_winrate > 55 ? 'bg-green-100 text-green-700' : 
                    stat.global_winrate < 45 ? 'bg-red-100 text-red-700' : 
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {stat.global_winrate.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3">
                  {stat.side1_winrate != null ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={`px-2 py-0.5 rounded font-semibold text-sm inline-block min-w-fit ${
                        stat.side1_winrate > 55 ? 'bg-green-100 text-green-700' :
                        stat.side1_winrate < 45 ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {stat.side1_winrate.toFixed(1)}%
                      </span>
                      <span className="text-xs text-gray-400">{stat.side1_games}g</span>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  {stat.side2_winrate != null ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={`px-2 py-0.5 rounded font-semibold text-sm inline-block min-w-fit ${
                        stat.side2_winrate > 55 ? 'bg-green-100 text-green-700' :
                        stat.side2_winrate < 45 ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {stat.side2_winrate.toFixed(1)}%
                      </span>
                      <span className="text-xs text-gray-400">{stat.side2_games}g</span>
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-700">{stat.maps_played}</td>
                <td className="px-4 py-3">
                  {(() => {
                    // Express faction imbalance as the distance from an even
                    // 50% winrate, matching the matchup views.
                    const imbalance = Math.abs(stat.global_winrate - 50) * 2;
                    return <span className={`px-3 py-1 rounded-lg font-semibold inline-block min-w-fit ${
                      imbalance > 20 ? 'bg-red-100 text-red-700' :
                      imbalance > 10 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {imbalance.toFixed(1)}%
                    </span>;
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FactionBalanceTab;
