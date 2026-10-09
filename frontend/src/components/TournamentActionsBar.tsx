import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TournamentDetails } from '../types/tournament';

interface TournamentActionsBarProps {
  tournament: Pick<TournamentDetails, 'status'>;
  /** The visitor is logged in, not yet registered, and registration is open. */
  canRequestJoin: boolean;
  /** Ranked tournaments need ranked play enabled in the player's profile. */
  joinBlockedByRankedSetting: boolean;
  joinLoading: boolean;
  /** Show the organizer controls (hidden while the edit form is open). */
  isOrganizer: boolean;
  /** Editing waits for the tournament assets, which the form needs. */
  editReady: boolean;
  onJoin: () => void;
  onEdit: () => void;
  onCloseRegistration: () => void;
  onPrepare: () => void;
  onStart: () => void;
  onCancel: () => void;
}

/**
 * Join request on the left and the organizer's lifecycle controls on the
 * right. Each lifecycle button is shown only in the status where the backend
 * accepts it: close registration, prepare, start, and cancel before the
 * tournament starts.
 */
const TournamentActionsBar: React.FC<TournamentActionsBarProps> = ({
  tournament,
  canRequestJoin,
  joinBlockedByRankedSetting,
  joinLoading,
  isOrganizer,
  editReady,
  onJoin,
  onEdit,
  onCloseRegistration,
  onPrepare,
  onStart,
  onCancel,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-row flex-wrap gap-3 items-center justify-between mb-6">
      {/* Join button (only if logged in and NOT in edit mode) - Left side */}
      {canRequestJoin && (
        joinBlockedByRankedSetting ? (
          <div className="flex flex-col gap-1">
            <button data-help-id="action-join-tournament-disabled" className="px-6 py-2 bg-gray-300 text-gray-500 rounded cursor-not-allowed" disabled>
              {t('tournaments.request_join')}
            </button>
            <p className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
              {t('tournaments.join_ranked_disabled', 'Enable ranked matches in your profile to join this tournament')}
            </p>
          </div>
        ) : (
          <button data-help-id="action-join-tournament" className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" onClick={onJoin} disabled={joinLoading}>
            {t('tournaments.request_join')}
          </button>
        )
      )}
      {!canRequestJoin && !isOrganizer && (
        <div></div>
      )}

      {/* Organizer Controls - Right side */}
      {isOrganizer && (
        <div className="flex flex-wrap gap-3">
          {!['prepared', 'in_progress', 'finished', 'completed', 'complete'].includes(tournament.status) && (
            <button 
              data-help-id="action-edit-tournament"
              onClick={onEdit}
              disabled={!editReady}
              className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {t('btn_edit', 'Edit')}
            </button>
          )}

          {tournament.status === 'registration_open' && (
            <button data-help-id="action-close-registration" onClick={onCloseRegistration} className="px-6 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors">{t('tournaments.btn_close_registration')}</button>
          )}

          {tournament.status === 'registration_closed' && (
            <button data-help-id="action-prepare-tournament" onClick={onPrepare} className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">{t('tournaments.btn_prepare')}</button>
          )}

          {tournament.status === 'prepared' && (
            <button data-help-id="action-start-tournament" onClick={onStart} className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors">{t('tournaments.btn_start')}</button>
          )}

          {tournament.status === 'in_progress' && (
            <p className="self-center text-green-600">✓ {t('tournaments.started_locked')}</p>
          )}

          {(tournament.status !== 'in_progress' && tournament.status !== 'finished') && (
            <button 
              data-help-id="action-cancel-tournament"
              onClick={() => {
                if (confirm(t('confirm_cancel_tournament', 'Are you sure you want to cancel this tournament? All data will be deleted.'))) {
                  onCancel();
                }
              }} 
              className="px-6 py-2 bg-red-700 text-white rounded hover:bg-red-800 transition-colors"
            >
              {t('cancel_tournament', 'Cancel Tournament')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default TournamentActionsBar;
