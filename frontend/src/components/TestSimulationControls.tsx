import React, { useEffect, useState } from 'react';
import { testToolsService } from '../services/api';

interface UserOption { id: string; nickname: string; elo_rating?: number; enable_ranked?: boolean; }

const isTestBuild = import.meta.env.MODE === 'test';

function UserSearch({
  label,
  rankedOnly,
  value,
  onChange,
}: {
  label: string;
  rankedOnly?: boolean;
  value: UserOption | null;
  onChange: (user: UserOption | null) => void;
}) {
  const [input, setInput] = useState(value?.nickname || '');
  const [options, setOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const search = input.trim();
    if (value?.nickname === input || search.length < 2) {
      setOptions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await testToolsService.searchUsers(search, rankedOnly);
        setOptions(response.data || []);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [input, rankedOnly, value?.nickname]);

  if (!isTestBuild) return null;
  return (
    <div className="relative flex flex-col gap-1">
      <label className="text-sm font-semibold text-gray-700">{label}</label>
      <input
        data-help-id="field-test-user-search"
        value={input}
        onChange={(event) => { setInput(event.target.value); onChange(null); }}
        placeholder="Search by nickname"
        className="px-3 py-2 border border-gray-300 rounded-lg"
      />
      {loading && <span className="text-xs text-gray-500">Searching...</span>}
      {options.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 bg-white border border-gray-300 rounded shadow-lg mt-1">
          {options.map((option) => (
            <button
              type="button"
              key={option.id}
              data-help-id="action-test-select-user"
              onClick={() => { setInput(option.nickname); setOptions([]); onChange(option); }}
              className="block w-full text-left px-3 py-2 hover:bg-blue-50"
            >
              {option.nickname} <span className="text-xs text-gray-500">({option.elo_rating ?? '—'})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SimulateMatchPanel({ onCompleted }: { onCompleted?: () => void }) {
  const [mode, setMode] = useState('ranked');
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [tournamentId, setTournamentId] = useState('');
  const [openMatches, setOpenMatches] = useState<any[]>([]);
  const [roundMatchId, setRoundMatchId] = useState('');
  const [winner, setWinner] = useState<UserOption | null>(null);
  const [loser, setLoser] = useState<UserOption | null>(null);
  const [winnerId, setWinnerId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const tournamentMode = mode !== 'ranked';
  useEffect(() => {
    if (!isTestBuild || !tournamentMode) return;
    setTournamentId('');
    setOpenMatches([]);
    testToolsService.getTournaments(mode).then((response) => setTournaments(response.data || [])).catch(() => setError('Failed to load active tournaments'));
  }, [mode, tournamentMode]);

  useEffect(() => {
    if (!tournamentId) { setOpenMatches([]); return; }
    testToolsService.getOpenMatches(tournamentId).then((response) => setOpenMatches(response.data || [])).catch(() => setError('Failed to load open matches'));
  }, [tournamentId]);

  if (!isTestBuild) return null;
  const selectedMatch = openMatches.find((match) => match.id === roundMatchId);
  const canSubmit = mode === 'ranked' ? Boolean(winner?.id && loser?.id && winner.id !== loser.id) : Boolean(selectedMatch && winnerId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true); setError(''); setMessage('');
    try {
      await testToolsService.simulateMatch({
        mode,
        tournament_id: tournamentId || undefined,
        round_match_id: roundMatchId || undefined,
        winner_id: mode === 'ranked' ? winner!.id : winnerId,
        loser_id: mode === 'ranked' ? loser!.id : undefined,
      });
      setMessage('Simulated match reported successfully');
      setWinner(null); setLoser(null); setWinnerId(''); setRoundMatchId('');
      if (tournamentId) {
        const response = await testToolsService.getOpenMatches(tournamentId);
        setOpenMatches(response.data || []);
      }
      onCompleted?.();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to simulate match');
    } finally { setSaving(false); }
  };

  return (
    <section className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-8">
      <h2 className="text-xl font-bold text-gray-800 mb-2">Simulate Match</h2>
      <p className="text-sm text-gray-600 mb-4">Test-only tool. Factions and map are selected randomly by the server.</p>
      {message && <p className="text-green-700 mb-3">{message}</p>}
      {error && <p className="text-red-700 mb-3">{error}</p>}
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-gray-700">Match mode</span>
          <select data-help-id="option-test-match-mode" value={mode} onChange={(event) => { setMode(event.target.value); setError(''); }} className="px-3 py-2 border border-gray-300 rounded-lg">
            <option value="ranked">Ranked</option>
            <option value="tournament_ranked">Tournament Ranked</option>
            <option value="tournament_unranked">Tournament Unranked</option>
            <option value="tournament_team">Tournament Teams</option>
          </select>
        </label>
        {mode === 'ranked' ? (
          <>
            <UserSearch label="Winner" rankedOnly value={winner} onChange={setWinner} />
            <UserSearch label="Loser" rankedOnly value={loser} onChange={setLoser} />
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-gray-700">Active tournament</span>
              <select data-help-id="field-test-tournament" value={tournamentId} onChange={(event) => { setTournamentId(event.target.value); setRoundMatchId(''); setWinnerId(''); }} className="px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Select tournament</option>
                {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-sm font-semibold text-gray-700">Open match</span>
              <select data-help-id="field-test-open-match" value={roundMatchId} onChange={(event) => { setRoundMatchId(event.target.value); setWinnerId(''); }} disabled={!tournamentId} className="px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Select match</option>
                {openMatches.map((match) => <option key={match.id} value={match.id}>Round {match.round_number}: {match.player1_name} vs {match.player2_name} ({match.player1_wins}-{match.player2_wins})</option>)}
              </select>
            </label>
            {selectedMatch && (
              <fieldset className="md:col-span-2 flex gap-6">
                <legend className="text-sm font-semibold text-gray-700 mb-1">Winner</legend>
                {[['player1_id', 'player1_name'], ['player2_id', 'player2_name']].map(([idKey, nameKey]) => (
                  <label key={idKey} className="flex items-center gap-2">
                    <input data-help-id="option-test-match-winner" type="radio" name="simulated-winner" value={selectedMatch[idKey]} checked={winnerId === selectedMatch[idKey]} onChange={() => setWinnerId(selectedMatch[idKey])} />
                    {selectedMatch[nameKey]}
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        <button data-help-id="action-test-simulate-match" type="submit" disabled={!canSubmit || saving} className="md:col-span-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
          {saving ? 'Reporting...' : 'Simulate Match'}
        </button>
      </form>
    </section>
  );
}

export function SimulateJoinPanel({ tournament, onCompleted }: { tournament: any; onCompleted?: () => void }) {
  const [first, setFirst] = useState<UserOption | null>(null);
  const [second, setSecond] = useState<UserOption | null>(null);
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  if (!isTestBuild || !tournament || tournament.status !== 'registration_open') return null;
  const isTeam = tournament.tournament_mode === 'team';
  const canSubmit = Boolean(first?.id && (!isTeam || (second?.id && teamName.trim().length >= 2)));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!canSubmit) return;
    setSaving(true); setError(''); setMessage('');
    try {
      await testToolsService.simulateJoin(tournament.id, { user_ids: isTeam ? [first!.id, second!.id] : [first!.id], team_name: isTeam ? teamName : undefined });
      setMessage('Simulated join completed without notifications or confirmation');
      setFirst(null); setSecond(null); setTeamName(''); onCompleted?.();
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to simulate join'); }
    finally { setSaving(false); }
  };
  return (
    <section className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-800 mb-2">Simulate Join</h2>
      <p className="text-sm text-gray-600 mb-4">Test-only organizer tool. No Discord notification or participant confirmation is generated.</p>
      {message && <p className="text-green-700 mb-3">{message}</p>}
      {error && <p className="text-red-700 mb-3">{error}</p>}
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isTeam && <label className="flex flex-col gap-1"><span className="text-sm font-semibold text-gray-700">Team name</span><input data-help-id="field-test-team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg" /></label>}
        <UserSearch label={isTeam ? 'Team member 1' : 'Participant'} value={first} onChange={setFirst} />
        {isTeam && <UserSearch label="Team member 2" value={second} onChange={setSecond} />}
        <button data-help-id="action-test-simulate-join" type="submit" disabled={!canSubmit || saving} className="md:col-span-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">{saving ? 'Adding...' : 'Simulate Join'}</button>
      </form>
    </section>
  );
}
