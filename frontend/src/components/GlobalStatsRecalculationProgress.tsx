import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  RecalculationProgress,
  RecalculationStatus,
} from '../hooks/useGlobalStatsRecalculation';

const phases: Record<string, { index: number; key: string }> = {
  starting: { index: 1, key: 'admin.recalculation_phase_starting' },
  replaying_matches: { index: 1, key: 'admin.recalculation_phase_matches' },
  updating_users: { index: 2, key: 'admin.recalculation_phase_users' },
  recalculating_player_statistics: { index: 3, key: 'admin.recalculation_phase_player_stats' },
  recalculating_faction_statistics: { index: 4, key: 'admin.recalculation_phase_faction_stats' },
  calculating_player_of_month: { index: 5, key: 'admin.recalculation_phase_player_of_month' },
};

const phaseCount = 5;

interface Props {
  status: RecalculationStatus;
  progress: RecalculationProgress;
}

/** Render the single shared status panel for a global statistics recalculation. */
const GlobalStatsRecalculationProgress: React.FC<Props> = ({ status, progress }) => {
  const { t } = useTranslation();
  if (status === 'idle') return null;

  const isRunning = status === 'running';
  const phase = phases[progress.phase] || phases.starting;
  const percentage = progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 ${
      isRunning
        ? 'border-purple-200 bg-purple-50 text-purple-900'
        : status === 'completed'
          ? 'border-green-400 bg-green-100 text-green-700'
          : 'border-red-400 bg-red-100 text-red-700'
    }`}>
      {isRunning ? (
        <>
          <div className="flex justify-between gap-4 text-sm font-semibold">
            <span>{t('admin.recalculation_phase_label', 'Phase')} {phase.index}/{phaseCount} — {t(phase.key)}</span>
            <span>{progress.current}/{progress.total || '—'}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-purple-200">
            <div className="h-full bg-purple-600 transition-all" style={{ width: `${percentage}%` }} />
          </div>
        </>
      ) : (
        <span className="font-semibold">
          {status === 'completed'
            ? t('admin.recalculation_completed', 'Global statistics recalculation completed')
            : t('admin.recalculation_failed', 'Global statistics recalculation failed')}
        </span>
      )}
    </div>
  );
};

export default GlobalStatsRecalculationProgress;
