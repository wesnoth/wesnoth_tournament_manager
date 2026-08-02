import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import ReplayConfirmationModal from './ReplayConfirmationModal';

interface Props { tournamentId: string; canManage?: boolean }

// Bracket spacing assumes equal-height match cards. Each later round doubles
// the vertical interval between card centers, so a match remains centered
// between the two matches that feed it.
const BRACKET_CARD_HEIGHT = 112;
const BRACKET_CARD_GAP = 16;

function getBracketRoundSpacing(roundIndex: number): React.CSSProperties {
  if (roundIndex === 0) return { gap: `${BRACKET_CARD_GAP}px` };
  const centerInterval = (BRACKET_CARD_HEIGHT + BRACKET_CARD_GAP) * (2 ** roundIndex);
  const cardGap = centerInterval - BRACKET_CARD_HEIGHT;
  const verticalInset = ((2 ** roundIndex) - 1) * (BRACKET_CARD_HEIGHT + BRACKET_CARD_GAP) / 2;
  return {
    gap: `${cardGap}px`,
    paddingTop: `${verticalInset}px`,
    paddingBottom: `${verticalInset}px`,
  };
}

const TournamentCompetitionView: React.FC<Props> = ({ tournamentId, canManage = false }) => {
  const [phases, setPhases] = useState<any[]>([]);
  const [details, setDetails] = useState<Record<string, any[]>>({});
  const [games, setGames] = useState<any[]>([]);
  const [administrativeDecisions, setAdministrativeDecisions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedReplay, setSelectedReplay] = useState<any | null>(null);
  const [replayChoice, setReplayChoice] = useState<'I won' | 'I lost' | 'cancel'>('I won');
  const { user } = useAuthStore();

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
        setAdministrativeDecisions(gameResponses.flatMap(response => response.data.administrative_decisions || []));
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
              <div className="flex items-stretch gap-3 overflow-x-auto pb-3">
                {rounds.map((round: any, roundIndex: number) => {
                  const nextRoundSeries = groupSeries.filter(item => item.round_number === rounds[roundIndex + 1]);
                  return <React.Fragment key={round}>
                  <div className="flex min-w-64 flex-col">
                    <h5 className="text-center font-medium">Round {round}</h5>
                    <div className="flex flex-1 flex-col" style={getBracketRoundSpacing(roundIndex)}>
                      {groupSeries.filter(item => item.round_number === round).map(item => {
                        const slots = [...item.slots].sort((a: any, b: any) => a.slot_number - b.slot_number);
                        const status = item.status === 'completed'
                          ? 'completed'
                          : item.status === 'in_progress'
                            ? 'in_progress'
                            : item.status === 'ready'
                              ? 'ready'
                              : 'waiting';
                        const statusStyles = {
                          completed: 'border-green-300 bg-white',
                          ready: 'border-green-300 bg-green-50',
                          in_progress: 'border-yellow-300 bg-yellow-50',
                          waiting: 'border-gray-300 bg-gray-100',
                        }[status];
                        const statusLabel = {
                          completed: 'Completed',
                          ready: 'Open',
                          in_progress: 'In progress',
                          waiting: 'Waiting',
                        }[status];
                        return <div key={item.series_id} className={`relative h-28 overflow-hidden rounded border shadow-sm ${statusStyles}`}>
                          <div className="flex items-center justify-between border-b border-inherit px-3 py-1 text-xs text-gray-600">
                            <span>Bo{item.best_of}</span>
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${status === 'ready' ? 'bg-green-200 text-green-900' : status === 'in_progress' ? 'bg-yellow-200 text-yellow-900' : status === 'completed' ? 'bg-gray-200 text-gray-700' : 'bg-gray-200 text-gray-600'}`}>{statusLabel}</span>
                          </div>
                          {slots.map((slot: any) => {
                            const isWinner = item.winner_entry_id === slot.resolved_entry_id;
                            const score = slot.slot_number === 1 ? item.entry1_wins : item.entry2_wins;
                            return <div key={slot.slot_number} className={`flex items-center justify-between gap-3 border-b border-inherit px-3 py-2 last:border-b-0 ${isWinner ? 'font-bold text-green-800' : 'text-gray-800'}`}>
                              <span className="min-w-0 truncate">{slot.resolved_entry_name || `Seed ${slot.source_group_seed || '?'}`}</span>
                              <span className={`min-w-6 text-right font-mono text-sm ${isWinner ? 'text-green-800' : 'text-gray-600'}`}>{Number(score || 0)}</span>
                            </div>;
                          })}
                        </div>;
                      })}
                    </div>
                  </div>
                  {roundIndex < rounds.length - 1 && <div aria-hidden="true" className="flex min-w-8 flex-col">
                    <div className="h-6 shrink-0" />
                    <div className="flex flex-1 flex-col" style={getBracketRoundSpacing(roundIndex + 1)}>
                      {nextRoundSeries.map(item => <div key={item.series_id} className="flex h-28 items-center justify-center text-2xl font-bold text-blue-400">→</div>)}
                    </div>
                  </div>}
                </React.Fragment>;
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
                <span className="rounded bg-green-100 px-2 py-1 text-green-900">Green: open</span>
                <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-900">Yellow: in progress</span>
                <span className="rounded bg-gray-200 px-2 py-1 text-gray-700">Gray: waiting for previous round</span>
              </div>
            </div>;
          })}
        </div>
      </section>;
    })}
    {administrativeDecisions.length > 0 && <section data-help-id="region-tournament-administrative-decisions" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h3 className="mb-4 border-b-2 border-amber-500 pb-3 text-2xl font-bold text-amber-950">Administrative Decisions</h3>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {administrativeDecisions.map(decision => {
          const winnerIsEntry1 = decision.winner_entry_id === decision.entry1_id;
          const winnerName = winnerIsEntry1 ? decision.entry1_name : decision.entry2_name;
          const loserName = winnerIsEntry1 ? decision.entry2_name : decision.entry1_name;
          const winnerScore = winnerIsEntry1 ? decision.entry1_wins : decision.entry2_wins;
          const loserScore = winnerIsEntry1 ? decision.entry2_wins : decision.entry1_wins;
          const actionLabel = decision.organizer_action === 'forfeit'
            ? 'Forfeit'
            : decision.organizer_action === 'legacy_admin_decision'
              ? 'Migrated administrative decision'
              : 'Result awarded by organizer';
          return <article key={decision.decision_id} className="rounded-lg border-l-4 border-amber-600 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-gray-900">{decision.phase_name} · {decision.group_name}</div>
                <div className="text-xs text-gray-500">Round {decision.round_number} · Bo{decision.best_of}</div>
              </div>
              <span className="rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white">Admin decision</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div><div className="text-xs uppercase text-gray-500">Winner</div><div className="font-semibold text-green-700">{winnerName}</div></div>
              <div className="rounded bg-gray-100 px-3 py-1 font-mono font-bold text-gray-800">{winnerScore}–{loserScore}</div>
              <div className="text-right"><div className="text-xs uppercase text-gray-500">Loser</div><div className="font-semibold text-red-700">{loserName}</div></div>
            </div>
            <div className="mt-3 text-sm font-medium text-amber-800">{actionLabel}</div>
          </article>;
        })}
      </div>
    </section>}
    {games.length > 0 && <section data-help-id="region-tournament-phase-games" className="space-y-7 rounded-lg border bg-white p-4">
      {[
        { status: 'pending', title: 'Scheduled Matches' },
        { status: 'completed', title: 'Completed Matches' },
      ].map(section => {
        const sectionGames = games.filter(game => {
          const hasPendingReplay = Boolean(game.pending_replay_id);
          return !game.organizer_action && (section.status === 'completed'
            ? game.status === 'completed' || hasPendingReplay
            : game.status === section.status && !hasPendingReplay);
        });
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
              const pendingReplay = Boolean(game.pending_replay_id);
              let pendingSummary: any = null;
              try {
                pendingSummary = typeof game.pending_replay_summary === 'string'
                  ? JSON.parse(game.pending_replay_summary)
                  : game.pending_replay_summary;
              } catch { pendingSummary = null; }
              const winnerIsEntry1 = game.winner_entry_id === game.entry1_id;
              const winnerName = !completed || pendingReplay
                ? game.entry1_name
                : (winnerIsEntry1 ? game.entry1_name : game.entry2_name);
              const loserName = !completed || pendingReplay
                ? game.entry2_name
                : (winnerIsEntry1 ? game.entry2_name : game.entry1_name);
              const winnerSide = Number(game.winner_side);
              const loserSide = winnerSide === 1 ? 2 : winnerSide === 2 ? 1 : null;
              const detectedTeams = pendingSummary?.detectedTeams || {};
              // tournament_entries.id identifies the bracket entry; detectedTeams
              // is indexed by the entry's team_id.
              const entry1Team = detectedTeams[game.entry1_team_id || game.entry1_id];
              const entry2Team = detectedTeams[game.entry2_team_id || game.entry2_id];
              const pendingFactionLabels = [entry1Team, entry2Team]
                .filter(Boolean)
                .map((team: any) => `${team.team_name}: ${(team.factions || []).join(', ')}`);
              const currentUserNickname = user?.nickname?.toLowerCase() || '';
              const currentUserTeam = Object.values(detectedTeams).find((team: any) =>
                (team.members || []).some((member: string) => member.toLowerCase() === currentUserNickname)
              ) as any;
              const canConfirmReplay = pendingReplay && game.pending_replay_parse_status !== 'due' && Boolean(currentUserTeam);
              const openReplayAction = (choice: 'I won' | 'I lost' | 'cancel') => {
                setSelectedReplay({
                  ...game,
                  pending_replay_summary: pendingSummary,
                  player1_nickname: game.entry1_name,
                  player2_nickname: game.entry2_name,
                  current_user_team_name: currentUserTeam?.team_id === game.entry1_team_id ? game.entry1_name : game.entry2_name,
                  player1_faction: entry1Team?.factions?.join(', ') || '—',
                  player2_faction: entry2Team?.factions?.join(', ') || '—',
                });
                setReplayChoice(choice);
              };
              return <tr key={game.game_id} className={`border-b border-gray-200 ${pendingReplay ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50'}`}>
                <td className="px-4 py-3 text-gray-700">
                  <div className="font-medium">{game.phase_name}</div>
                  <div className="text-xs text-gray-500">{game.group_name} · Round {game.round_number} · Game {game.game_number} · Bo{game.best_of}</div>
                </td>
                <td className={`px-4 py-3 font-semibold ${completed ? 'text-green-700' : 'text-gray-800'}`}>{winnerName}</td>
                <td className={`px-4 py-3 font-semibold ${completed ? 'text-red-700' : 'text-gray-800'}`}>{loserName}</td>
                <td className="px-4 py-3 text-gray-700">
                  <div>{pendingSummary?.finalMap || pendingSummary?.forumMap || game.map || '—'}</div>
                  {(completed || pendingReplay) && <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    {pendingReplay && pendingFactionLabels.length > 0
                      ? pendingFactionLabels.map((label: string, index: number) => <span key={index} className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700">{label}</span>)
                      : <>
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700">{game.winner_faction || '—'}</span>
                        {winnerSide > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">S{winnerSide}</span>}
                        <span>vs</span>
                        <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700">{game.loser_faction || '—'}</span>
                        {loserSide && <span className="rounded bg-purple-100 px-1.5 py-0.5 font-semibold text-purple-700">S{loserSide}</span>}
                      </>}
                  </div>}
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {completed ? <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${pendingReplay ? 'bg-yellow-500' : 'bg-green-500'}`}>{pendingReplay ? 'Pending confirmation' : 'Completed'}</span>
                    {canConfirmReplay && <>
                      <button type="button" onClick={() => openReplayAction('I won')} className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700">I won</button>
                      <button type="button" onClick={() => openReplayAction('I lost')} className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700">I lost</button>
                      <button type="button" onClick={() => openReplayAction('cancel')} className="rounded bg-gray-600 px-2 py-1 text-xs font-semibold text-white hover:bg-gray-700">Discard</button>
                    </>}
                    {pendingReplay && game.pending_replay_url && <a href={game.pending_replay_url} target="_blank" rel="noopener noreferrer" className="rounded bg-yellow-600 px-2 py-1 text-xs font-semibold text-white hover:bg-yellow-700">Replay ⬇</a>}
                    {!pendingReplay && game.replay_url
                      ? <a data-help-id="action-download-phase-game-replay" href={game.replay_url} target="_blank" rel="noopener noreferrer" className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700" title={`Downloads: ${game.replay_downloads || 0}`}>Replay ⬇</a>
                      : !pendingReplay && <span className="text-xs text-gray-500">No replay</span>}
                  </div> : <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-yellow-500 px-3 py-1 text-xs font-semibold text-white">Pending</span>
                    {canManage && [{ id: game.entry1_id, name: game.entry1_name }, { id: game.entry2_id, name: game.entry2_name }].map(entry => <button key={entry.id} data-help-id="action-record-tournament-game-winner" type="button" onClick={async () => {
                      if (!window.confirm(`Record ${entry.name} as the winner of this game?`)) return;
                      try { await api.post(`/tournaments/${tournamentId}/games/${game.game_id}/result`, { winner_entry_id: entry.id }); setReloadKey(value => value + 1); } catch (resultError: any) { setError(resultError.response?.data?.error || 'Failed to record result'); }
                    }} className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white">{entry.name} won</button>)}
                    {canManage && <div className="mt-2 flex w-full flex-wrap items-center gap-2 border-t border-amber-200 pt-2">
                      <span className="text-xs font-semibold text-amber-800">Administrative:</span>
                      {[{ id: game.entry1_id, name: game.entry1_name }, { id: game.entry2_id, name: game.entry2_name }].map(entry => <button key={entry.id} data-help-id="action-record-tournament-administrative-decision" type="button" onClick={async () => {
                        if (!window.confirm(`Award this series to ${entry.name} by administrative decision? Unplayed games will not count towards game-percentage tiebreakers.`)) return;
                        try {
                          await api.post(`/tournaments/${tournamentId}/series/${game.series_id}/admin-decision`, {
                            winner_entry_id: entry.id,
                            action: 'forfeit',
                          });
                          setReloadKey(value => value + 1);
                        } catch (resultError: any) {
                          setError(resultError.response?.data?.error || 'Failed to record administrative decision');
                        }
                      }} className="rounded border border-amber-600 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100">Award to {entry.name}</button>)}
                    </div>}
                  </div>}
                </td>
              </tr>;
            })}</tbody>
          </table></div>
        </div>;
      })}
    </section>}
    {selectedReplay && <ReplayConfirmationModal
      isOpen={Boolean(selectedReplay)}
      replayId={selectedReplay.pending_replay_id}
      player1_nickname={selectedReplay.player1_nickname}
      player2_nickname={selectedReplay.player2_nickname}
      currentUserNickname={selectedReplay.current_user_team_name.toLowerCase()}
      your_choice={replayChoice}
      map={selectedReplay.pending_replay_summary?.finalMap || selectedReplay.pending_replay_summary?.forumMap || '—'}
      player1_faction={selectedReplay.player1_faction}
      player2_faction={selectedReplay.player2_faction}
      onClose={() => setSelectedReplay(null)}
      onSuccess={() => { setSelectedReplay(null); setReloadKey(value => value + 1); }}
    />}
  </div>;
};

export default TournamentCompetitionView;
