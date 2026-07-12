import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { playerStatisticsService } from '../services/playerStatisticsService';

interface MapStats {
  map_id: string;
  map_name: string;
  player_side: number;
  total_games: number;
  wins: number;
  losses: number;
  winrate: number;
  avg_elo_change: number;
}

interface Props {
  playerId: string;
}

const SideToggle: React.FC<{ side: number; onChange: (s: number) => void }> = ({ side, onChange }) => {
  const { t } = useTranslation();
  const btn = (val: number, label: string) => (
    <button
      onClick={() => onChange(val)}
      className={`px-3 py-1 text-sm font-semibold rounded transition-colors ${
        side === val
          ? val === 0 ? 'bg-gray-700 text-white' : val === 1 ? 'bg-amber-500 text-white' : 'bg-purple-600 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-gray-600">{t('side') || 'Side'}:</span>
      {btn(0, t('all') || 'All')}
      {btn(1, 'Side 1')}
      {btn(2, 'Side 2')}
    </div>
  );
};

const PlayerStatsByMap: React.FC<Props> = ({ playerId }) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<MapStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [minGames, setMinGames] = useState(2);
  const [appliedMinGames, setAppliedMinGames] = useState(2);
  const [side, setSide] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await playerStatisticsService.getStatsByMap(playerId, appliedMinGames, side);
        const converted = data.map((item: any) => ({
          ...item,
          winrate: typeof item.winrate === 'string' ? parseFloat(item.winrate) : item.winrate,
          avg_elo_change: typeof item.avg_elo_change === 'string' ? parseFloat(item.avg_elo_change) : item.avg_elo_change,
        }));
        setStats(converted);
      } catch (err) {
        console.error('Error fetching map stats:', err);
        setError('Error loading map statistics');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [playerId, appliedMinGames, side]);

  // Keep the typed threshold separate so changing it does not trigger a request
  // for every keystroke. The refresh button applies the new threshold explicitly.
  const applyFilters = () => {
    setAppliedMinGames(minGames);
  };

  if (loading) return <div className="max-w-4xl mx-auto p-8 bg-white rounded-lg shadow-md"><p className="text-gray-600">{t('loading')}</p></div>;
  if (error) return <div className="max-w-4xl mx-auto p-8 bg-white rounded-lg shadow-md border border-red-200"><p className="text-red-600">{error}</p></div>;

  return (
    <div className="max-w-4xl mx-auto">
      <h3 className="text-2xl font-semibold text-gray-800 mb-4">{t('performance_by_map') || 'Performance by Map'}</h3>
      <p className="text-gray-600 text-sm mb-6">{t('performance_by_map_explanation') || 'Your win rate and ELO change on each map'}</p>

      <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2">
          {t('minimum_games') || 'Minimum Games'}:
          <input
            type="number" min="1" max="100" value={minGames}
            onChange={(e) => setMinGames(Math.max(1, parseInt(e.target.value) || 1))}
            className="px-2 py-1 border border-gray-300 rounded w-20"
          />
        </label>
        <button
          type="button"
          onClick={applyFilters}
          className="px-3 py-1 bg-gray-200 text-gray-700 font-semibold rounded hover:bg-gray-300 transition-colors"
        >
          {t('refresh') || 'Refresh'}
        </button>
        <SideToggle side={side} onChange={setSide} />
      </div>

      {stats.length === 0 ? (
        <p className="text-center text-gray-500 italic py-8">{t('no_data')}</p>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-x-auto">
          <table className="w-full border-collapse bg-white">
            <thead className="bg-gray-100 border-b-2 border-gray-300">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('map') || 'Map'}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">{t('total_games') || 'Games'}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">{t('record') || 'Record'}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">{t('winrate') || 'Win Rate'}</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">{t('avg_elo_change') || 'Avg ELO'}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => (
                <tr key={stat.map_id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-700">{stat.map_name}</td>
                  <td className="px-4 py-3 text-center">{stat.total_games}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="flex gap-3 justify-center">
                      <span className="text-green-600 font-semibold">{stat.wins}W</span>
                      <span className="text-red-600 font-semibold">{stat.losses}L</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${
                      stat.winrate > 55 ? 'text-green-600' :
                      stat.winrate < 45 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {stat.winrate.toFixed(1)}%
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-center font-semibold ${stat.avg_elo_change > 0 ? 'text-green-600' : stat.avg_elo_change < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {stat.avg_elo_change > 0 ? '+' : ''}{stat.avg_elo_change.toFixed(1)}
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

export default PlayerStatsByMap;
