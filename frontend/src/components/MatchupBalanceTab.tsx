import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { statisticsService } from '../services/statisticsService';

/** One row = one faction as Side 1 vs another as Side 2, on a specific map */
interface SideMatchupRow {
  map_id: string;
  map_name: string;
  side1_faction_id: string;
  side1_faction_name: string;
  side2_faction_id: string;
  side2_faction_name: string;
  games: number;
  side1_wins: number;
  side1_winrate: number;
  // Difference between Side 1 and Side 2 winrates, expressed in percentage
  // points. A perfectly even matchup has an imbalance of 0.
  imbalance: number; // |s1_winrate - 50| * 2
}

/** Convert /matchups endpoint rows (faction_id < opponent_id) into per-side rows */
function globalToSideRows(data: any[], minGames: number): SideMatchupRow[] {
  const rows: SideMatchupRow[] = [];
  data.forEach((item: any) => {
    const s1g  = parseInt(String(item.side1_games), 10) || 0;
    const s2g  = parseInt(String(item.side2_games), 10) || 0;
    const s1w  = parseInt(String(item.side1_wins), 10) || 0;
    const s2w  = parseInt(String(item.side2_wins), 10) || 0;

    if (s1g >= minGames) {
      const s1wr = (s1w / s1g) * 100;
      rows.push({
        map_id: item.map_id, map_name: item.map_name,
        side1_faction_id:   item.faction_1_id,
        side1_faction_name: item.faction_1_name,
        side2_faction_id:   item.faction_2_id,
        side2_faction_name: item.faction_2_name,
        games: s1g,
        side1_wins: s1w,
        side1_winrate: s1wr,
        imbalance: Math.abs(s1wr - 50) * 2,
      });
    }
    if (s2g >= minGames) {
      // faction_2 plays as side 1, so its wins are faction_1's losses.
      const f2s1w = s2g - s2w;
      const f2s1wr = (f2s1w / s2g) * 100;
      rows.push({
        map_id: item.map_id, map_name: item.map_name,
        side1_faction_id:   item.faction_2_id,
        side1_faction_name: item.faction_2_name,
        side2_faction_id:   item.faction_1_id,
        side2_faction_name: item.faction_1_name,
        games: s2g,
        side1_wins: f2s1w,
        side1_winrate: f2s1wr,
        imbalance: Math.abs(f2s1wr - 50) * 2,
      });
    }
  });
  return rows.sort((a, b) => b.imbalance - a.imbalance);
}

/**
 * Convert balance event comparison data (per-faction perspective, each match appears twice)
 * into SideMatchupRows. Deduplicate with a Map keyed by (map, side1_id, side2_id).
 */
function comparisonToSideRows(data: any[]): SideMatchupRow[] {
  const rowMap = new Map<string, SideMatchupRow>();

  data.forEach((item: any) => {
    // Each match is represented by both faction perspectives. Use one
    // canonical direction per map/pair, then derive both side assignments.
    // This prevents the same games from being counted once for each faction.
    const factionId = item.faction_id || '';
    const opponentId = item.opponent_faction_id || '';
    if (factionId > opponentId) return;

    const s1g = parseInt(String(item.side1_games), 10) || 0;
    const s1w = parseInt(String(item.side1_wins),  10) || 0;
    const s2g = parseInt(String(item.side2_games), 10) || 0;
    const s2w = parseInt(String(item.side2_wins),  10) || 0;

    const addRow = (key: string, row: SideMatchupRow) => {
      const existing = rowMap.get(key);
      if (!existing) {
        rowMap.set(key, row);
        return;
      }
      existing.games += row.games;
      existing.side1_wins += row.side1_wins;
      existing.side1_winrate = (existing.side1_wins / existing.games) * 100;
      existing.imbalance = Math.abs(existing.side1_winrate - 50) * 2;
    };

    // faction played as side 1
    if (s1g > 0) {
      const key = `${item.map_id}|${factionId}|${opponentId}`;
      const wr = (s1w / s1g) * 100;
      addRow(key, {
          map_id: item.map_id || '', map_name: item.map_name || '',
          side1_faction_id:   factionId,
          side1_faction_name: item.faction_name || '',
          side2_faction_id:   opponentId,
          side2_faction_name: item.opponent_faction_name || '',
          games: s1g, side1_wins: s1w,
          side1_winrate: wr, imbalance: Math.abs(wr - 50) * 2,
      });
    }

    // opponent played as side 1 (faction was side 2)
    if (s2g > 0) {
      const key = `${item.map_id}|${opponentId}|${factionId}`;
        const oppWins = s2g - s2w;
        const wr = (oppWins / s2g) * 100;
        addRow(key, {
          map_id: item.map_id || '', map_name: item.map_name || '',
          side1_faction_id:   opponentId,
          side1_faction_name: item.opponent_faction_name || '',
          side2_faction_id:   factionId,
          side2_faction_name: item.faction_name || '',
          games: s2g, side1_wins: oppWins,
          side1_winrate: wr, imbalance: Math.abs(wr - 50) * 2,
        });
    }
  });

  return Array.from(rowMap.values()).sort((a, b) => b.imbalance - a.imbalance);
}

const MatchupBalanceTab: React.FC<{ beforeData?: any; afterData?: any }> = ({ beforeData = null, afterData = null }) => {
  const { t } = useTranslation();
  const [stats, setStats]             = useState<SideMatchupRow[]>([]);
  const [beforeStats, setBeforeStats] = useState<SideMatchupRow[]>([]);
  const [afterStats, setAfterStats]   = useState<SideMatchupRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [minGames, setMinGames]       = useState(5);
  const [pendingMinGames, setPendingMinGames] = useState(5);

  useEffect(() => {
    statisticsService.getConfig().then(cfg => {
      if (cfg.minGamesThreshold) {
        setMinGames(cfg.minGamesThreshold);
        setPendingMinGames(cfg.minGamesThreshold);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    statisticsService.getMatchupStats(minGames)
      .then(data => setStats(globalToSideRows(data, minGames)))
      .catch(() => setError('Error loading matchup statistics'))
      .finally(() => setLoading(false));
  }, [minGames]);

  const applyMinGames = () => {
    setMinGames(Math.max(1, Math.min(1000000, pendingMinGames || 1)));
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

  useEffect(() => {
    setBeforeStats(beforeData?.length > 0 ? comparisonToSideRows(beforeData) : []);
  }, [beforeData]);

  useEffect(() => {
    setAfterStats(afterData?.length > 0 ? comparisonToSideRows(afterData) : []);
  }, [afterData]);

  const getImbalanceColor = (imb: number) =>
    imb > 20 ? 'bg-red-100 text-red-700' : imb > 10 ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700';

  const wrColor = (wr: number) =>
    wr > 55 ? 'text-green-700' : wr < 45 ? 'text-red-700' : 'text-gray-700';

  if (loading) return <div className="p-8 text-center text-gray-600 bg-gray-50 rounded-lg">{t('loading')}</div>;
  if (error)   return <div className="p-8 text-center text-red-600 bg-red-50 rounded-lg border-l-4 border-red-500">{error}</div>;

  const showComparison = beforeStats.length > 0 || afterStats.length > 0;

  const TableHead = () => (
    <thead className="bg-gray-100 border-b-2 border-gray-300">
      <tr>
        <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('map') || 'Map'}</th>
        <th className="px-4 py-3 text-left font-semibold text-amber-700 bg-amber-50">Side 1</th>
        <th className="px-2 py-3 text-center font-semibold text-gray-800">{t('vs')}</th>
        <th className="px-4 py-3 text-left font-semibold text-purple-700 bg-purple-50">Side 2</th>
        <th className="px-4 py-3 text-center font-semibold text-gray-800">{t('total_games') || 'G'}</th>
        <th className="px-4 py-3 text-center font-semibold text-amber-700 bg-amber-50">{t('side_1_wr') || 'S1 WR'}</th>
        <th className="px-4 py-3 text-center font-semibold text-purple-700 bg-purple-50">{t('side_2_wr') || 'S2 WR'}</th>
        <th className="px-4 py-3 text-center font-semibold text-gray-800">{t('imbalance') || 'Imbalance'}</th>
        <th className="px-4 py-3 text-center font-semibold text-gray-800">{t('change') || 'Change'}</th>
      </tr>
    </thead>
  );

  /* ─── Comparison view ─── */
  if (showComparison) {
    const allKeys = new Set([
      ...beforeStats.map(r => `${r.map_id}|${r.side1_faction_id}|${r.side2_faction_id}`),
      ...afterStats.map(r  => `${r.map_id}|${r.side1_faction_id}|${r.side2_faction_id}`),
    ]);
    const beforeMap = new Map(beforeStats.map(r => [`${r.map_id}|${r.side1_faction_id}|${r.side2_faction_id}`, r]));
    const afterMap  = new Map(afterStats.map(r  => [`${r.map_id}|${r.side1_faction_id}|${r.side2_faction_id}`, r]));

    const combined = Array.from(allKeys)
      .map(key => ({ before: beforeMap.get(key), after: afterMap.get(key) }))
      .filter(item => ((item.after?.games || 0) + (item.before?.games || 0)) >= minGames)
      .sort((a, b) => {
        const aI = Math.max(a.after?.imbalance || 0, a.before?.imbalance || 0);
        const bI = Math.max(b.after?.imbalance || 0, b.before?.imbalance || 0);
        return bI - aI;
      });

    return (
      <div className="bg-white rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold text-gray-800 mb-3">{t('unbalanced_matchups_comparison') || 'Matchup Analysis — Before & After'}</h3>
        <p className="text-blue-600 text-sm mb-3 p-3 bg-blue-50 rounded border-l-4 border-blue-500">
          {t('before_event') || 'Before'}: {beforeStats.reduce((s, r) => s + r.games, 0)}g |{' '}
          {t('after_event')  || 'After'}:  {afterStats.reduce((s, r)  => s + r.games, 0)}g
        </p>
        {minimumGamesControl}
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full border-collapse bg-white text-sm">
            <TableHead />
            <tbody>
              {combined.map((item, idx) => {
                const ref = item.after || item.before!;
                return (
                  <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-800">{ref.map_name}</td>
                    <td className="px-4 py-3 font-semibold text-amber-700 bg-amber-50">{ref.side1_faction_name}</td>
                    <td className="px-2 py-3 text-center text-gray-500">vs</td>
                    <td className="px-4 py-3 font-semibold text-purple-700 bg-purple-50">{ref.side2_faction_name}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-gray-800">{item.after?.games ?? '—'}</span>
                        <span className="text-xs text-gray-400">{item.before?.games ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center bg-amber-50">
                      <div className="flex flex-col gap-0.5">
                        <span className={`font-semibold text-sm ${item.after ? wrColor(item.after.side1_winrate) : 'text-gray-400'}`}>
                          {item.after ? `${item.after.side1_winrate.toFixed(1)}%` : '—'}
                        </span>
                        <span className={`text-xs ${item.before ? wrColor(item.before.side1_winrate) : 'text-gray-400'}`}>
                          {item.before ? `${item.before.side1_winrate.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center bg-purple-50">
                      <div className="flex flex-col gap-0.5">
                        <span className={`font-semibold text-sm ${item.after ? wrColor(100 - item.after.side1_winrate) : 'text-gray-400'}`}>
                          {item.after ? `${(100 - item.after.side1_winrate).toFixed(1)}%` : '—'}
                        </span>
                        <span className={`text-xs ${item.before ? wrColor(100 - item.before.side1_winrate) : 'text-gray-400'}`}>
                          {item.before ? `${(100 - item.before.side1_winrate).toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col gap-0.5">
                        <span className={`px-2 py-0.5 rounded text-sm font-semibold ${item.after ? getImbalanceColor(item.after.imbalance) : 'text-gray-400'}`}>
                          {item.after ? `${item.after.imbalance.toFixed(1)}%` : '—'}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${item.before ? getImbalanceColor(item.before.imbalance) : 'text-gray-400'}`}>
                          {item.before ? `${item.before.imbalance.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.before && item.after ? (() => {
                        const change = item.after.side1_winrate - item.before.side1_winrate;
                        return (
                          <span className={`px-2 py-0.5 rounded font-semibold text-sm ${
                            change > 2 ? 'bg-green-100 text-green-700' :
                            change < -2 ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {change > 0 ? '+' : ''}{change.toFixed(1)}%
                          </span>
                        );
                      })() : <span className="text-gray-400">—</span>}
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

  /* ─── Global view ─── */
  const filtered = stats.filter(r => r.games >= minGames);

  return (
    <div className="bg-white rounded-lg p-6 shadow-md">
      <h3 className="text-xl font-semibold text-gray-800 mb-3">{t('unbalanced_matchups') || 'Matchup Analysis'}</h3>
      <p className="text-gray-600 text-sm mb-6 pb-3 px-3 bg-blue-50 border-l-4 border-blue-500 rounded">
        {t('matchup_balance_explanation') || 'Shows all faction matchups that meet the minimum number of games, ordered by imbalance. Higher imbalance indicates a larger difference between Side 1 and Side 2 win rates.'}
      </p>
      <div>
        {minimumGamesControl}
        <span className="text-sm text-gray-500">{filtered.length} {t('matchups') || 'matchups'}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-gray-500 italic py-8 bg-gray-50 rounded-lg">{t('no_data_available') || 'No data available'}</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full border-collapse bg-white">
            <TableHead />
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800">{row.map_name}</td>
                  <td className="px-4 py-3 font-semibold text-amber-700 bg-amber-50">{row.side1_faction_name}</td>
                  <td className="px-2 py-3 text-center text-gray-500 font-semibold">vs</td>
                  <td className="px-4 py-3 font-semibold text-purple-700 bg-purple-50">{row.side2_faction_name}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{row.games}</td>
                  <td className="px-4 py-3 text-center bg-amber-50">
                    <div className="flex flex-col items-center">
                      <span className={`font-semibold text-sm ${wrColor(row.side1_winrate)}`}>{row.side1_winrate.toFixed(1)}%</span>
                      <span className="text-xs text-gray-400">{row.side1_wins}W</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center bg-purple-50">
                    <div className="flex flex-col items-center">
                      <span className={`font-semibold text-sm ${wrColor(100 - row.side1_winrate)}`}>{(100 - row.side1_winrate).toFixed(1)}%</span>
                      <span className="text-xs text-gray-400">{row.games - row.side1_wins}W</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-3 py-1 rounded-lg font-semibold inline-block text-sm ${getImbalanceColor(row.imbalance)}`}>
                      {row.imbalance.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MatchupBalanceTab;
