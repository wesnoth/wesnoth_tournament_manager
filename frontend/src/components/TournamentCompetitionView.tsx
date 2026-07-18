import React, { useEffect, useState } from 'react';
import { api } from '../services/api';

interface Props { tournamentId: string; canManage?: boolean }

const TournamentCompetitionView: React.FC<Props> = ({ tournamentId, canManage = false }) => {
  const [phases, setPhases] = useState<any[]>([]);
  const [details, setDetails] = useState<Record<string, any[]>>({});
  const [games, setGames] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const competition = await api.get(`/tournaments/${tournamentId}/competition`);
        const uniquePhases = Array.from(new Map((competition.data.phases || []).map((row: any) => [row.phase_id, row])).values()) as any[];
        setPhases(uniquePhases);
        const loaded = await Promise.all(uniquePhases.map(async phase => {
          const endpoint = phase.format === 'single_elimination' ? 'bracket' : 'standings';
          const response = await api.get(`/tournaments/${tournamentId}/phases/${phase.phase_id}/${endpoint}`);
          return [phase.phase_id, response.data.slots || response.data.standings || []] as const;
        }));
        setDetails(Object.fromEntries(loaded));
        const gameResponses = await Promise.all(uniquePhases.map(phase => api.get(`/tournaments/${tournamentId}/phases/${phase.phase_id}/games`)));
        setGames(gameResponses.flatMap(response => response.data.games || []));
      } catch (loadError: any) {
        setError(loadError.response?.data?.error || 'Failed to load the competition structure');
      }
    };
    load();
  }, [tournamentId, reloadKey]);

  if (error) return <p className="text-red-600">{error}</p>;
  return <div data-help-id="region-tournament-competition" className="space-y-6">
    {phases.map(phase => {
      const rows = details[phase.phase_id] || [];
      if (phase.format !== 'single_elimination') {
        return <section key={phase.phase_id} className="border rounded-lg p-4 bg-white">
          <div className="flex justify-between items-center mb-3"><h3 className="font-semibold text-lg">{phase.phase_name}</h3>
            {canManage && phase.phase_status === 'ready' && <button data-help-id="action-start-tournament-phase" type="button" onClick={async () => {
              try { await api.post(`/tournaments/${tournamentId}/phases/${phase.phase_id}/start`); setReloadKey(value => value + 1); } catch (startError: any) { setError(startError.response?.data?.error || 'Failed to start phase'); }
            }} className="px-3 py-1 bg-green-600 text-white rounded">Start phase</button>}
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="bg-gray-100"><th className="p-2 text-left">Group</th><th className="p-2 text-left">Position</th><th className="p-2 text-left">Entry</th><th className="p-2">Played</th><th className="p-2">Wins</th><th className="p-2">Points</th><th className="p-2">OMP</th></tr></thead>
            <tbody>{rows.map((row: any) => <tr key={`${row.group_id}-${row.entry_id}`} className="border-t"><td className="p-2">{row.group_name}</td><td className="p-2">{row.rank_position || '—'}</td><td className="p-2 font-medium">{row.entry_name}</td><td className="p-2 text-center">{row.matches_played}</td><td className="p-2 text-center">{row.wins}</td><td className="p-2 text-center">{row.points}</td><td className="p-2 text-center">{row.omp}</td></tr>)}</tbody>
          </table></div>
        </section>;
      }
      const series = Array.from(new Map(rows.map((row: any) => [row.series_id, { ...row, slots: [] as any[] }])).values()) as any[];
      for (const row of rows) series.find(item => item.series_id === row.series_id)?.slots.push(row);
      const bracketGroups = Array.from(new Set(series.map(item => item.group_name))) as string[];
      return <section key={phase.phase_id} className="border rounded-lg p-4 bg-white">
        <div className="flex justify-between items-center mb-3"><h3 className="font-semibold text-lg">{phase.phase_name}</h3>
          {canManage && phase.phase_status === 'ready' && <button data-help-id="action-start-tournament-phase" type="button" onClick={async () => {
            try { await api.post(`/tournaments/${tournamentId}/phases/${phase.phase_id}/start`); setReloadKey(value => value + 1); } catch (startError: any) { setError(startError.response?.data?.error || 'Failed to start phase'); }
          }} className="px-3 py-1 bg-green-600 text-white rounded">Start phase</button>}
        </div>
        <div className="space-y-5">
          {bracketGroups.map(groupName => {
            const groupSeries = series.filter(item => item.group_name === groupName);
            const rounds = Array.from(new Set(groupSeries.map(item => item.round_number))).sort((a: any, b: any) => a - b);
            return <div key={groupName} data-help-id="region-tournament-bracket" className="rounded-lg border bg-gray-50 p-3">
              <h4 className="mb-3 font-semibold text-gray-800">{groupName}</h4>
              <div className="flex gap-5 overflow-x-auto pb-3">
                {rounds.map((round: any) => <div key={round} className="min-w-60 space-y-4"><h5 className="font-medium text-center">Round {round}</h5>
                  {groupSeries.filter(item => item.round_number === round).map(item => <div key={item.series_id} className="border rounded shadow-sm bg-white">
                    <div className="border-b bg-gray-100 px-3 py-1 text-xs text-gray-600">Bo{item.best_of}</div>
                    {item.slots.sort((a: any, b: any) => a.slot_number - b.slot_number).map((slot: any) => <div key={slot.slot_number} className={`px-3 py-2 border-b last:border-b-0 ${item.winner_entry_id === slot.resolved_entry_id ? 'font-bold bg-green-50' : ''}`}>{slot.resolved_entry_name || `Seed ${slot.source_group_seed || '?'}`}</div>)}
                  </div>)}
                </div>)}
              </div>
            </div>;
          })}
        </div>
      </section>;
    })}
    {games.length > 0 && <section data-help-id="region-tournament-phase-games" className="border rounded-lg p-4 bg-white">
      <h3 className="font-semibold text-lg mb-3">Matches</h3>
      <div className="space-y-2">{games.map(game => <div key={game.game_id} className="flex flex-wrap items-center justify-between gap-3 border rounded p-3">
        <div>
          <span>{game.group_name}, round {game.round_number}, game {game.game_number} (Bo{game.best_of}): <strong>{game.entry1_name}</strong> vs <strong>{game.entry2_name}</strong></span>
          {game.status === 'completed' && <p className="mt-1 text-sm font-medium text-green-700">Winner: {game.winner_entry_id === game.entry1_id ? game.entry1_name : game.entry2_name}</p>}
        </div>
        {game.status === 'pending' && canManage && <div className="flex gap-2">
          {[{ id: game.entry1_id, name: game.entry1_name }, { id: game.entry2_id, name: game.entry2_name }].map(entry => <button key={entry.id} data-help-id="action-record-tournament-game-winner" type="button" onClick={async () => {
            if (!window.confirm(`Record ${entry.name} as the winner of this game?`)) return;
            try { await api.post(`/tournaments/${tournamentId}/games/${game.game_id}/result`, { winner_entry_id: entry.id }); setReloadKey(value => value + 1); } catch (resultError: any) { setError(resultError.response?.data?.error || 'Failed to record result'); }
          }} className="px-2 py-1 bg-blue-600 text-white rounded text-sm">{entry.name} won</button>)}
        </div>}
      </div>)}</div>
    </section>}
  </div>;
};

export default TournamentCompetitionView;
