import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TournamentDetails, TournamentFormatDefinition } from '../types/tournament';

interface TournamentAsset {
  id: string;
  name: string;
}

interface TournamentFormatSummaryProps {
  tournament: Pick<TournamentDetails, 'round_duration_days' | 'auto_advance_round'>;
  /** Allowed factions and maps; an empty list hides that part of the assets box. */
  factions: TournamentAsset[];
  maps: TournamentAsset[];
  format: TournamentFormatDefinition | null | undefined;
}

/** Read-only allowed assets and phase format of a tournament. */
const TournamentFormatSummary: React.FC<TournamentFormatSummaryProps> = ({ tournament, factions, maps, format }) => {
  const { t } = useTranslation();
  return (
    <>
      {/* Tournament Assets Section */}
      {(factions.length > 0 || maps.length > 0) && (
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h3>{t('tournament.unranked_assets', 'Tournament Assets')}</h3>
          
          <div className="flex flex-col gap-6">
            {factions.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-lg font-semibold text-gray-800">{t('tournament.allowed_factions', 'Allowed Factions')}</h4>
                <div className="flex flex-wrap gap-2">
                  {factions.map((faction) => (
                    <span key={faction.id} className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">{faction.name}</span>
                  ))}
                </div>
              </div>
            )}

            {maps.length > 0 && (
              <div className="flex flex-col gap-3">
                <h4 className="text-lg font-semibold text-gray-800">{t('tournament.allowed_maps', 'Allowed Maps')}</h4>
                <div className="flex flex-wrap gap-2">
                  {maps.map((map) => (
                    <span key={map.id} className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-semibold">{map.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tournament Configuration Section */}
      <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
        <h3>{t('tournament_title')} {t('tournament.basic_info') ? '- ' + t('tournament.basic_info') : ''}</h3>
        <div data-help-id="region-tournament-phase-format-summary" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <strong className="font-semibold text-gray-700">{t('label_round_duration')}:</strong>
              <span className="text-gray-600">{tournament.round_duration_days} {t('label_days')}</span>
            </div>
            <div className="flex flex-col gap-2">
              <strong className="font-semibold text-gray-700">{t('label_auto_advance_rounds')}:</strong>
              <span className="text-gray-600">{tournament.auto_advance_round ? t('yes') : t('no')}</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {(format?.phases || []).map((phase) => (
              <article key={phase.id} className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <h4 className="font-semibold text-gray-800">{phase.order}. {phase.name}</h4>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-gray-600">System</dt>
                  <dd className="font-medium text-gray-800">{phase.format === 'single_elimination' ? 'Single elimination' : phase.format === 'round_robin' ? 'Round robin' : 'Swiss'}</dd>
                  <dt className="text-gray-600">Groups / brackets</dt>
                  <dd className="font-medium text-gray-800">{phase.groups.length}</dd>
                  <dt className="text-gray-600">Match format</dt>
                  <dd className="font-medium text-gray-800">Bo{phase.default_best_of}</dd>
                  {phase.swiss && <><dt className="text-gray-600">Rounds</dt><dd className="font-medium text-gray-800">{phase.swiss.round_count}</dd></>}
                  {phase.round_robin && <><dt className="text-gray-600">Cycles</dt><dd className="font-medium text-gray-800">{phase.round_robin.cycle_count}</dd></>}
                </dl>
              </article>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default TournamentFormatSummary;
