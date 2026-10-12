import i18n from 'i18next';
import type { TFunction } from 'i18next';

/** Badge colors for tournament and team statuses; unknown values fall back to grey. */
const tournamentStatusColors: Record<string, string> = {
  pending: '#FF9800',
  active: '#4CAF50',
  completed: '#2196F3',
  cancelled: '#f44336',
};

/** Badge colors for a participant's registration state. */
const participationStatusColors: Record<string, string> = {
  pending: '#FFC107',
  unconfirmed: '#2196F3',
  accepted: '#4CAF50',
  denied: '#f44336',
  cancelled: '#999',
};

export const getTournamentStatusColor = (status?: string | null) => tournamentStatusColors[status || ''] || '#999';

export const getParticipationStatusColor = (status?: string | null) => participationStatusColors[status || ''] || '#999';

/** Normalize a stored status to the suffix of its `option_*` locale key (`In Progress` → `in_progress`). */
export const normalizeStatusKey = (status?: string | null) => {
  if (!status) return 'pending';
  return status.toString().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
};

/**
 * Translated label of a stored status. Statuses without an `option_*` key are
 * shown as stored, so a new backend status is still readable before it is
 * translated; an empty status reads as pending.
 */
export const statusLabel = (t: TFunction, status?: string | null) => {
  const key = `option_${normalizeStatusKey(status)}`;
  const translated = t(key);
  return translated !== key ? translated : (status || t('option_pending'));
};

/** Translated label of a tournament mode; an unknown stored mode is shown as stored. */
export const tournamentModeLabel = (t: TFunction, mode?: string) => {
  switch (mode) {
    case 'ranked':
    case 'unranked':
    case 'team':
      return t(`tournament.mode_${mode}`);
    default:
      return mode || t('not_available');
  }
};

/**
 * Date of an ISO timestamp in the selected interface language, or the "not
 * available" text when it is missing. The language comes from the shared
 * i18next instance so dates match the rest of the translated page instead of
 * the browser locale.
 */
export const formatTournamentDate = (t: TFunction, date?: string | null) =>
  date ? new Date(date).toLocaleDateString(i18n.language) : t('not_available');
