import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { statisticsService } from '../services/statisticsService';

interface MapBalanceStats {
  map_id: string;
  map_name: string;
  total_games: number;
  factions_used: number;
  avg_imbalance: number;
  lowest_winrate: number;
  highest_winrate: number;
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
}

const MapBalanceTab: React.FC<{ beforeData?: any; afterData?: any }> = ({ beforeData = null, afterData = null }) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<MapBalanceStats[]>([]);
  const [beforeStats, setBeforeStats] = useState<MapBalanceStats[]>([]);
  const [afterStats, setAfterStats] = useState<MapBalanceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [minGamesThreshold, setMinGamesThreshold] = useState(5);
  const [pendingMinGames, setPendingMinGames] = useState('5');

  const aggregateMapData = (data: ComparisonData[]): MapBalanceStats[] => {
    // Group by map and aggregate faction stats
    const mapMap = new Map<string, {
      map_id: string;
      map_name: string;
      processedMatches: Set<string>; // Track matches to avoid double-counting
      factionStats: Map<string, { wins: number; losses: number; total: number }>;
    }>();
    
    data.forEach(item => {
      const mapId = item.map_id || '';
      const mapName = item.map_name || '';
      const factionId = item.faction_id || '';
      const opponentId = item.opponent_faction_id || '';
      
      if (!mapMap.has(mapId)) {
        mapMap.set(mapId, {
          map_id: mapId,
          map_name: mapName,
          processedMatches: new Set(),
          factionStats: new Map(),
        });
      }
      
      const mapData = mapMap.get(mapId)!;
      
      // Create a normalized match key to avoid processing the same match twice
      const matchKey = [factionId, opponentId].sort().join('|');
      
      // Skip if we've already processed this match (in either direction)
      if (mapData.processedMatches.has(matchKey)) {
        return;
      }
      mapData.processedMatches.add(matchKey);
      
      // Record stats for this faction
      if (!mapData.factionStats.has(factionId)) {
        mapData.factionStats.set(factionId, { wins: 0, losses: 0, total: 0 });
      }
      
      const fStats = mapData.factionStats.get(factionId)!;
      fStats.wins += item.wins;
      fStats.losses += item.losses;
      fStats.total += item.total_games;
      
      // Also record stats for opponent (inverted)
      if (!mapData.factionStats.has(opponentId)) {
        mapData.factionStats.set(opponentId, { wins: 0, losses: 0, total: 0 });
      }
      
      const oppStats = mapData.factionStats.get(opponentId)!;
      oppStats.wins += item.losses; // opponent's wins = this faction's losses
      oppStats.losses += item.wins; // opponent's losses = this faction's wins
      oppStats.total += item.total_games;
    });
    
    const result = Array.from(mapMap.values()).map(mapData => {
      const factionStats = mapData.factionStats;
      const totalGames = Array.from(factionStats.values()).reduce((sum, f) => sum + f.total, 0) / 2; // Divide by 2 because each game counted twice
      // For winrate calculation, use the actual wins/total from each faction (don't divide by 2)
      // because each faction's perspective counts the games they played correctly
      const winrates = Array.from(factionStats.values())
        .filter(f => f.total > 0)
        .map(f => (f.wins / f.total) * 100);
      
      // Calculate SAMPLE standard deviation (like PostgreSQL STDDEV uses n-1)
      const avgWinrate = winrates.length > 0 ? winrates.reduce((sum, wr) => sum + wr, 0) / winrates.length : 50;
      const variance = winrates.length > 1 
        ? winrates.reduce((sum, wr) => sum + Math.pow(wr - avgWinrate, 2), 0) / (winrates.length - 1) 
        : 0;
      const avgImbalance = Math.sqrt(variance);
      
      
      return {
        map_id: mapData.map_id,
        map_name: mapData.map_name,
        total_games: Math.round(totalGames),
        factions_used: factionStats.size,
        avg_imbalance: avgImbalance,
        lowest_winrate: winrates.length > 0 ? Math.min(...winrates) : 50,
        highest_winrate: winrates.length > 0 ? Math.max(...winrates) : 50,
      };
    })
    .filter(map => map.total_games >= minGamesThreshold) // Apply minimum games filter
    .sort((a, b) => b.total_games - a.total_games);
    
    return result;
  };

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const config = await statisticsService.getConfig();
        if (config.minGamesThreshold) {
          setMinGamesThreshold(config.minGamesThreshold);
          setPendingMinGames(String(config.minGamesThreshold));
        }
      } catch (err) {
        console.warn('Could not load config, using default threshold');
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await statisticsService.getMapBalanceStats(minGamesThreshold);
        // Convert string numbers to actual numbers
        const converted = data.map((item: any) => ({
          ...item,
          avg_imbalance: typeof item.avg_imbalance === 'string' ? parseFloat(item.avg_imbalance) : item.avg_imbalance,
          lowest_winrate: typeof item.lowest_winrate === 'string' ? parseFloat(item.lowest_winrate) : item.lowest_winrate,
          highest_winrate: typeof item.highest_winrate === 'string' ? parseFloat(item.highest_winrate) : item.highest_winrate,
        }));
        setStats(converted);
      } catch (err) {
        console.error('Error fetching map balance stats:', err);
        setError('Error loading map statistics');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [minGamesThreshold]);

  useEffect(() => {
    if (beforeData && beforeData.length > 0) {
      const aggregated = aggregateMapData(beforeData);
      setBeforeStats(aggregated);
    } else {
      setBeforeStats([]);
    }
  }, [beforeData, minGamesThreshold]);

  useEffect(() => {
    if (afterData && afterData.length > 0) {
      const aggregated = aggregateMapData(afterData);
      setAfterStats(aggregated);
    } else {
      setAfterStats([]);
    }
  }, [afterData, minGamesThreshold]);

  const applyMinGames = () => {
    const parsed = Number.parseInt(pendingMinGames, 10);
    setMinGamesThreshold(Number.isFinite(parsed) ? Math.max(1, Math.min(1000000, parsed)) : 1);
  };

  const handleMinGamesKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyMinGames();
    }
  };

  const minimumGamesControl = (
    <div className="bg-gray-100 p-4 rounded-lg mb-6 border border-gray-200 flex items-center gap-4">
      <label className="flex items-center gap-2 font-semibold text-gray-800">
        {t('minimum_games') || 'Minimum games'}:
        <input type="number" min="1" max="1000000" value={pendingMinGames}
          onChange={e => setPendingMinGames(e.target.value)}
          onKeyDown={handleMinGamesKeyDown}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 w-24" />
      </label>
      <button type="button" onClick={applyMinGames}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        {t('refresh') || 'Refresh'}
      </button>
    </div>
  );

  if (loading) return <div className="p-8 text-center text-gray-600 bg-gray-50 rounded-lg">{t('loading')}</div>;
  if (error) return <div className="p-8 text-center text-red-600 bg-red-50 rounded-lg border-l-4 border-red-500">{error}</div>;

  const showComparison = beforeStats.length > 0 || afterStats.length > 0;

  if (showComparison) {
    // Create combined view
    const allMapIds = new Set([
      ...beforeStats.map(m => m.map_id),
      ...afterStats.map(m => m.map_id)
    ]);
    
    const beforeMap = new Map(beforeStats.map(m => [m.map_id, m]));
    const afterMap = new Map(afterStats.map(m => [m.map_id, m]));
    
    const combined = Array.from(allMapIds)
      .map(mapId => {
        const before = beforeMap.get(mapId);
        const after = afterMap.get(mapId);
        return {
          map_id: mapId,
          map_name: after?.map_name || before?.map_name || '',
          before,
          after,
        };
      })
      .filter(item => item.after || item.before)
      .sort((a, b) => {
        // Match global sort: lowest imbalance first (best balanced maps first)
        const aImbalance = a.after?.avg_imbalance ?? a.before?.avg_imbalance ?? 999;
        const bImbalance = b.after?.avg_imbalance ?? b.before?.avg_imbalance ?? 999;
        return aImbalance - bImbalance;
      });

    return (
      <div className="bg-white rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold text-gray-800 mb-3">{t('map_balance_comparison') || 'Map Balance - Before & After'}</h3>
        <p className="text-blue-600 text-sm mb-3 p-3 bg-blue-50 rounded border-l-4 border-blue-500">
          {t('before_event') || 'Before'}: {beforeStats.reduce((sum, map) => sum + map.total_games, 0)} {t('matches_evaluated') || 'matches'} |
          {t('after_event') || 'After'}: {afterStats.reduce((sum, map) => sum + map.total_games, 0)} {t('matches_evaluated') || 'matches'}
        </p>
        {minimumGamesControl}
        <p className="text-gray-500 text-xs mb-6 italic">{t('balance_lower_better') || '(Lower imbalance = better balance)'}</p>
        
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full border-collapse bg-white">
            <thead className="bg-gray-100 border-b-2 border-gray-300">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('map') || 'Map'}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('total_games') || 'Games'}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('factions_used') || 'Factions'}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('winrate_range') || 'WR Range'}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('change') || 'Change'}</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('imbalance') || 'Imbalance'}</th>
              </tr>
            </thead>
            <tbody>
              {combined.map((item) => (
                <tr key={item.map_id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800">
                    <div className="flex flex-col gap-1">
                      <span>{item.map_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      {/* After is shown first; the smaller line underneath is Before. */}
                      <span className="font-semibold text-gray-800">{item.after?.total_games ?? '—'}</span>
                      <span className="text-xs text-gray-600">{item.before?.total_games ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <span className="font-semibold text-gray-800">{item.after?.factions_used ?? '—'}</span>
                      <span className="text-xs text-gray-600">{item.before?.factions_used ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2 text-sm">
                      <span className="font-semibold text-gray-800">
                        {item.after ? `${item.after.lowest_winrate.toFixed(1)}% - ${item.after.highest_winrate.toFixed(1)}%` : '—'}
                      </span>
                      <span className="text-xs text-gray-600">
                        {item.before ? `${item.before.lowest_winrate.toFixed(1)}% - ${item.before.highest_winrate.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {/* Map Change is the delta of the map imbalance metric, not a single faction WR. */}
                    {item.before && item.after ? (() => {
                      const change = item.after.avg_imbalance - item.before.avg_imbalance;
                      return (
                        <span className={`px-2 py-0.5 rounded font-semibold text-sm ${
                          change < -2 ? 'bg-green-100 text-green-700' :
                          change > 2 ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {change > 0 ? '+' : ''}{change.toFixed(1)}%
                        </span>
                      );
                    })() : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <span className={`px-3 py-1 rounded-lg font-semibold inline-block w-fit text-sm ${
                        (item.after?.avg_imbalance || 0) < 5 ? 'bg-green-100 text-green-700' :
                        (item.after?.avg_imbalance || 0) < 10 ? 'bg-blue-100 text-blue-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {item.after ? `${item.after.avg_imbalance.toFixed(1)}%` : '—'}
                      </span>
                      <span className={`px-3 py-1 rounded-lg font-semibold inline-block w-fit text-xs ${
                        item.before ? ((item.before.avg_imbalance || 0) < 5 ? 'bg-green-100 text-green-700' :
                        (item.before.avg_imbalance || 0) < 10 ? 'bg-blue-100 text-blue-700' :
                        'bg-yellow-100 text-yellow-700') : 'text-gray-400'
                      }`}>
                        {item.before ? `${item.before.avg_imbalance.toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Default global view
  return (
    <div className="bg-white rounded-lg p-6 shadow-md">
      <h3 className="text-xl font-semibold text-gray-800 mb-3">{t('map_balance_title') || 'Map Balance Analysis'}</h3>
      <p className="text-gray-600 text-sm mb-6 pb-3 px-3 bg-blue-50 border-l-4 border-blue-500 rounded">{t('map_balance_explanation') || 'Analysis of map balance across all factions'}</p>
      {minimumGamesControl}
      <p className="text-gray-500 text-xs mb-6 italic">{t('balance_lower_better') || '(Lower imbalance = better balance)'}</p>
      
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full border-collapse bg-white">
          <thead className="bg-gray-100 border-b-2 border-gray-300">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('map') || 'Map'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('total_games') || 'Games'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('factions_used') || 'Factions'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('winrate_range') || 'WR Range'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('imbalance') || 'Imbalance'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('change') || 'Change'}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((stat) => (
              <tr key={stat.map_id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-4 py-3 font-semibold text-gray-800">{stat.map_name}</td>
                <td className="px-4 py-3 text-gray-700">{stat.total_games}</td>
                <td className="px-4 py-3 text-gray-700">{stat.factions_used}</td>
                <td className="px-4 py-3 text-gray-700">{stat.lowest_winrate.toFixed(1)}% - {stat.highest_winrate.toFixed(1)}%</td>
                <td className="px-4 py-3">
                  <span className={`px-3 py-1 rounded-lg font-semibold inline-block ${
                    stat.avg_imbalance < 5 ? 'bg-green-100 text-green-700' :
                    stat.avg_imbalance < 10 ? 'bg-blue-100 text-blue-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {stat.avg_imbalance.toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MapBalanceTab;
