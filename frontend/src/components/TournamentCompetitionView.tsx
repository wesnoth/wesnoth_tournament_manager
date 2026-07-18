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
        const groups = Array.from(new Map(rows.map((row: any) => [row.group_id, {
          id: row.group_id,
          name: row.group_name,
          rows: rows.filter((candidate: any) => candidate.group_id === row.group_id),
        }])).values()) as Array<{ id: string; name: string; rows: any[] }>;
        return <section key={phase.phase_id} className="border rounded-lg p-4 bg-white">
          <div className="flex justify-between items-center mb-3"><h3 className="font-semibold text-lg">{phase.phase_name}</h3>
            {canManage && phase.phase_status === 'ready' && <button data-help-id="action-start-tournament-phase" type="button" onClick={async () => {
              try { await api.post(`/tournaments/${tournamentId}/phases/${phase.phase_id}/start`); setReloadKey(value => value + 1); } catch (startError: any) { setError(startError.response?.data?.error || 'Failed to start phase'); }
            }} className="px-3 py-1 bg-green-600 text-white rounded">Start phase</button>}
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {groups.map(group => <article key={group.id} data-help-id="region-tournament-standings-group" className="overflow-hidden rounded-lg border border-blue-200 bg-blue-50 shadow-sm">
              <h4 className="border-b border-blue-200 bg-blue-100 px-4 py-3 font-semibold text-blue-900">{group.name}</h4>
              <div className="overflow-x-auto"><table className="w-full bg-white text-sm">
                <thead><tr className="bg-gray-100"><th className="p-2 text-left">Pos.</th><th className="p-2 text-left">Entry</th><th className="p-2">Played</th><th className="p-2">W</th><th className="p-2">L</th><th className="p-2">Points</th><th className="p-2">OMP</th><th className="p-2">GWP</th><th className="p-2">OGP</th></tr></thead>
                <tbody>{group.rows.map((row: any) => <tr key={row.entry_id} className="border-t"><td className="p-2">{row.rank_position || '—'}</td><td className="p-2 font-medium">{row.entry_name}</td><td className="p-2 text-center">{row.matches_played}</td><td className="p-2 text-center">{row.wins}</td><td className="p-2 text-center">{row.losses}</td><td className="p-2 text-center font-semibold">{row.points}</td><td className="p-2 text-center">{row.omp}</td><td className="p-2 text-center">{row.gwp}</td><td className="p-2 text-center">{row.ogp}</td></tr>)}</tbody>
              </table></div>
            </article>)}
          </div>
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
    {games.length > 0 && <section data-help-id="region-tournament-phase-games" className="space-y-7 rounded-lg border bg-white p-4">
      {[
        { status: 'pending', title: 'Scheduled Matches' },
        { status: 'completed', title: 'Completed Matches' },
      ].map(section => {
        const sectionGames = games.filter(game => game.status === section.status);
        if (sectionGames.length === 0) return null;
        const completed = section.status === 'completed';
        return <div key={section.status}>
          <h3 className="mb-4 border-b-2 border-blue-500 pb-3 text-2xl font-bold text-gray-800">{section.title}</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-gray-200"><tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Phase / Round</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">{completed ? 'Winner' : 'Player 1'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">{completed ? 'Loser' : 'Player 2'}</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Map / Factions</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Status / Actions</th>
            </tr></thead>
            <tbody>{sectionGames.map(game => {
              const winnerIsEntry1 = game.winner_entry_id === game.entry1_id;
              const winnerName = completed ? (winnerIsEntry1 ? game.entry1_name : game.entry2_name) : game.entry1_name;
              const loserName = completed ? (winnerIsEntry1 ? game.entry2_name : game.entry1_name) : game.entry2_name;
              const winnerSide = Number(game.winner_side);
              const loserSide = winnerSide === 1 ? 2 : winnerSide === 2 ? 1 : null;
              return <tr key={game.game_id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-700">
                  <div className="font-medium">{game.phase_name}</div>
                  <div className="text-xs text-gray-500">{game.group_name} · Round {game.round_number} · Game {game.game_number} · Bo{game.best_of}</div>
                </td>
                <td className={`px-4 py-3 font-semibold ${completed ? 'text-green-700' : 'text-gray-800'}`}>{winnerName}</td>
                <td className={`px-4 py-3 font-semibold ${completed ? 'text-red-700' : 'text-gray-800'}`}>{loserName}</td>
                <td className="px-4 py-3 text-gray-700">
                  <div>{game.map || '—'}</div>
                  {completed && <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700">{game.winner_faction || '—'}</span>
                    {winnerSide > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">S{winnerSide}</span>}
                    <span>vs</span>
                    <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700">{game.loser_faction || '—'}</span>
                    {loserSide && <span className="rounded bg-purple-100 px-1.5 py-0.5 font-semibold text-purple-700">S{loserSide}</span>}
                  </div>}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {completed ? <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-green-500 px-3 py-1 text-xs font-semibold text-white">Completed</span>
                    {game.replay_url
                      ? <a data-help-id="action-download-phase-game-replay" href={game.replay_url} target="_blank" rel="noopener noreferrer" className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700" title={`Downloads: ${game.replay_downloads || 0}`}>Replay ⬇</a>
                      : <span className="text-xs text-gray-500">No replay</span>}
                  </div> : <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-yellow-500 px-3 py-1 text-xs font-semibold text-white">Pending</span>
                    {canManage && [{ id: game.entry1_id, name: game.entry1_name }, { id: game.entry2_id, name: game.entry2_name }].map(entry => <button key={entry.id} data-help-id="action-record-tournament-game-winner" type="button" onClick={async () => {
                      if (!window.confirm(`Record ${entry.name} as the winner of this game?`)) return;
                      try { await api.post(`/tournaments/${tournamentId}/games/${game.game_id}/result`, { winner_entry_id: entry.id }); setReloadKey(value => value + 1); } catch (resultError: any) { setError(resultError.response?.data?.error || 'Failed to record result'); }
                    }} className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white">{entry.name} won</button>)}
                  </div>}
                </td>
              </tr>;
            })}</tbody>
          </table></div>
        </div>;
      })}
    </section>}
  </div>;
};

export default TournamentCompetitionView;
