import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import TournamentEntryName from './TournamentEntryName';

interface PhaseHistory {
  phase_id: string;
  phase_order: number;
  phase_name: string;
  format: 'swiss' | 'round_robin' | 'single_elimination';
  group_id: string;
  group_name: string;
  group_position: number | null;
  matches_played: number;
  wins: number;
  losses: number;
  points: number;
  omp: number;
  gwp: number;
  ogp: number;
  series_wins: number;
  series_losses: number;
  eliminated_round: number | null;
  elimination_game_wins: number;
  elimination_game_losses: number;
}

interface OverallStanding {
  entry_id: string;
  entity_id: string;
  entry_user_id?: string | null;
  entry_members?: Array<{ user_id: string; nickname: string }> | string | null;
  entry_name: string;
  placement: number;
  status: 'champion' | 'runner_up' | 'third_place' | 'active' | 'eliminated';
  outcome: string;
  history: PhaseHistory[];
}

interface Props { tournamentId: string; refreshKey?: number }

const statusStyle: Record<OverallStanding['status'], string> = {
  champion: 'bg-yellow-100 text-yellow-900 border-yellow-300',
  runner_up: 'bg-slate-200 text-slate-800 border-slate-300',
  third_place: 'bg-amber-100 text-amber-900 border-amber-300',
  active: 'bg-blue-100 text-blue-800 border-blue-300',
  eliminated: 'bg-gray-100 text-gray-700 border-gray-300',
};

/** Summarize every entry's progression across the phase graph. */
const TournamentOverallStandings: React.FC<Props> = ({ tournamentId, refreshKey = 0 }) => {
  const { t } = useTranslation();
  const [standings, setStandings] = useState<OverallStanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get(`/tournaments/${tournamentId}/overall-standings`)
      .then(response => {
        if (active) setStandings(response.data.standings || []);
      })
      .catch(requestError => {
        if (active) setError(requestError.response?.data?.error || t('overall_standings.error_load'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [tournamentId, refreshKey]);

  /**
   * Localized result text. The API also returns an English `outcome`; the
   * same rules are applied here from the status and the furthest phase
   * (the last history item) so the text follows the selected language.
   */
  const describeOutcome = (standing: OverallStanding): string => {
    if (standing.status === 'champion' || standing.status === 'runner_up' || standing.status === 'third_place') {
      return t(`overall_standings.status_${standing.status}`);
    }
    const furthest = standing.history[standing.history.length - 1];
    if (!furthest) return t('overall_standings.outcome_registered');
    const names = { phase: furthest.phase_name, group: furthest.group_name };
    if (furthest.eliminated_round) {
      return t('overall_standings.outcome_eliminated_round', { ...names, round: furthest.eliminated_round });
    }
    if (standing.status === 'eliminated' && furthest.group_position) {
      return t('overall_standings.outcome_eliminated_group', { ...names, position: furthest.group_position });
    }
    return t('overall_standings.outcome_active', names);
  };

  if (loading) return <p className="text-gray-600">{t('overall_standings.loading')}</p>;
  if (error) return <p className="text-red-700">{error}</p>;

  return <section data-help-id="region-tournament-overall-standings" className="rounded-lg bg-white p-6 shadow-lg">
    <div data-help-id="region-tournament-overall-standings-summary" className="mb-5">
      <h2 className="text-2xl font-bold text-gray-800">{t('overall_standings.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('overall_standings.summary')}</p>
    </div>
    {standings.length === 0 ? <p className="text-gray-600">{t('overall_standings.empty')}</p> : <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100"><tr>
          <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('overall_standings.col_place')}</th>
          <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('competition.col_entry')}</th>
          <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('label_status')}</th>
          <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('overall_standings.col_result')}</th>
          <th className="px-4 py-3 text-left font-semibold text-gray-700">{t('overall_standings.col_journey')}</th>
        </tr></thead>
        <tbody>{standings.map(standing => <tr data-help-id="region-tournament-overall-standing" key={standing.entry_id} className={`border-b ${standing.status === 'champion' ? 'bg-yellow-50' : standing.status === 'runner_up' ? 'bg-slate-50' : 'hover:bg-gray-50'}`}>
          <td className="px-4 py-3 text-xl font-bold text-gray-800">{standing.placement}</td>
          <td className="px-4 py-3 font-semibold text-gray-900"><TournamentEntryName name={standing.entry_name} userId={standing.entry_user_id} members={standing.entry_members} /></td>
          <td className="px-4 py-3"><span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${statusStyle[standing.status]}`}>{t(`overall_standings.status_${standing.status}`)}</span></td>
          <td className="px-4 py-3 text-gray-700">{describeOutcome(standing)}</td>
          <td className="px-4 py-3">
            <div className="flex min-w-80 flex-wrap items-center gap-2">
              {standing.history.map((phase, index) => <React.Fragment key={phase.group_id}>
                {index > 0 && <span className="text-gray-400">→</span>}
                <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2">
                  <div className="font-medium text-blue-900">{phase.phase_name} / {phase.group_name}</div>
                  <div className="text-xs text-gray-600">
                    {phase.group_position ? `${t('overall_standings.position', { position: phase.group_position })} · ` : ''}{t('overall_standings.series_record', { wins: phase.series_wins, losses: phase.series_losses, points: phase.points })}
                    {phase.format !== 'single_elimination' ? ` · OMP ${phase.omp.toFixed(2)}% · GWP ${phase.gwp.toFixed(2)}% · OGP ${phase.ogp.toFixed(2)}%` : ''}
                    {phase.eliminated_round ? ` · ${t('overall_standings.eliminated_round', { round: phase.eliminated_round, wins: phase.elimination_game_wins, losses: phase.elimination_game_losses })}` : ''}
                  </div>
                </div>
              </React.Fragment>)}
            </div>
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
};

export default TournamentOverallStandings;
