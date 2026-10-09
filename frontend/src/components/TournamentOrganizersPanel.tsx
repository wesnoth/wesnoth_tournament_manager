import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tournamentService, userService } from '../services/api';
import PlayerLink from './PlayerLink';
import type { TournamentDetails, TournamentOrganizer } from '../types/tournament';

interface OrganizerUserOption {
  id: string;
  nickname: string;
}

interface TournamentOrganizersPanelProps {
  tournament: Pick<TournamentDetails, 'id' | 'creator_id' | 'creator_nickname' | 'status'>;
  organizers: TournamentOrganizer[];
  currentUserId: string | null;
  onOrganizersChange: (organizers: TournamentOrganizer[]) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * Organizer list of a tournament and, for its creator, the co-organizer
 * management box. Only the creator may change the list, and only until the
 * tournament is finished; co-organizers see the list without the controls.
 */
const TournamentOrganizersPanel: React.FC<TournamentOrganizersPanelProps> = ({
  tournament,
  organizers,
  currentUserId,
  onOrganizersChange,
  onSuccess,
  onError,
}) => {
  const { t } = useTranslation();
  const [organizerUsers, setOrganizerUsers] = useState<OrganizerUserOption[]>([]);
  const [organizerCandidateId, setOrganizerCandidateId] = useState('');
  const [organizerMutationLoading, setOrganizerMutationLoading] = useState(false);
  const isPrimaryOrganizer = Boolean(currentUserId && tournament.creator_id === currentUserId);

  useEffect(() => {
    let cancelled = false;

    // The user directory is only needed by the creator while membership is editable.
    // Avoid exposing an inoperative selector or doing extra work for co-organizers.
    if (!isPrimaryOrganizer || tournament.status === 'finished') {
      setOrganizerUsers([]);
      setOrganizerCandidateId('');
      return () => { cancelled = true; };
    }

    userService.getAllUsers()
      .then((response) => {
        if (cancelled) return;
        const users = response.data?.data || response.data || [];
        setOrganizerUsers(Array.isArray(users) ? users : []);
      })
      .catch((loadError) => {
        console.error('Failed to load co-organizer candidates:', loadError);
      });

    return () => { cancelled = true; };
  }, [tournament.id, isPrimaryOrganizer, tournament.status]);

  const refreshOrganizers = async () => {
    const response = await tournamentService.getTournamentOrganizers(tournament.id);
    onOrganizersChange(response.data || []);
  };

  const handleAddOrganizer = async () => {
    if (!organizerCandidateId) return;
    try {
      setOrganizerMutationLoading(true);
      onError('');
      await tournamentService.addTournamentOrganizer(tournament.id, organizerCandidateId);
      await refreshOrganizers();
      setOrganizerCandidateId('');
      onSuccess(t('tournament.organizer_added', 'Co-organizer added successfully.'));
    } catch (mutationError: any) {
      onError(mutationError.response?.data?.error || t('tournament.organizer_add_failed', 'Failed to add co-organizer.'));
    } finally {
      setOrganizerMutationLoading(false);
    }
  };

  const handleRemoveOrganizer = async (organizer: TournamentOrganizer) => {
    try {
      setOrganizerMutationLoading(true);
      onError('');
      await tournamentService.removeTournamentOrganizer(tournament.id, organizer.user_id);
      await refreshOrganizers();
      onSuccess(t('tournament.organizer_removed', 'Co-organizer removed successfully.'));
    } catch (mutationError: any) {
      onError(mutationError.response?.data?.error || t('tournament.organizer_remove_failed', 'Failed to remove co-organizer.'));
    } finally {
      setOrganizerMutationLoading(false);
    }
  };

  return (
    <>
      <p>
        <strong>{t('tournament.col_organizer')}:</strong>{' '}
        {(organizers.length > 0 ? organizers : [{ user_id: tournament.creator_id, nickname: tournament.creator_nickname }]).map((organizer, index, arr) => (
          <React.Fragment key={organizer.user_id}>
            {organizer.user_id === tournament.creator_id ? (
              <strong>
                <PlayerLink nickname={organizer.nickname} userId={organizer.user_id} />
              </strong>
            ) : (
              <PlayerLink nickname={organizer.nickname} userId={organizer.user_id} />
            )}
            {index < arr.length - 1 && ', '}
          </React.Fragment>
        ))}
      </p>
      {isPrimaryOrganizer && tournament.status !== 'finished' && (
        <div data-help-id="region-tournament-organizer-management" className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
          <h2 className="font-semibold text-gray-800">
            {t('tournament.manage_organizers', 'Manage co-organizers')}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {t('tournament.manage_organizers_help', 'Co-organizers can manage this tournament. Only you, as its creator, can change this list.')}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select
              data-help-id="field-tournament-co-organizer"
              value={organizerCandidateId}
              onChange={(event) => setOrganizerCandidateId(event.target.value)}
              disabled={organizerMutationLoading}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">{t('tournament.select_co_organizer', 'Select co-organizer')}</option>
              {organizerUsers
                .filter((candidate) => candidate.id !== tournament.creator_id && !organizers.some((organizer) => organizer.user_id === candidate.id))
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.nickname}</option>
                ))}
            </select>
            <button
              data-help-id="action-add-tournament-organizer"
              type="button"
              onClick={handleAddOrganizer}
              disabled={organizerMutationLoading || !organizerCandidateId}
              className="rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {t('tournament.add_organizer', 'Add co-organizer')}
            </button>
          </div>
          {organizers.some((organizer) => organizer.user_id !== tournament.creator_id) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {organizers
                .filter((organizer) => organizer.user_id !== tournament.creator_id)
                .map((organizer) => (
                  <span key={organizer.user_id} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-gray-300">
                    {organizer.nickname}
                    <button
                      data-help-id="action-remove-tournament-organizer"
                      type="button"
                      onClick={() => handleRemoveOrganizer(organizer)}
                      disabled={organizerMutationLoading}
                      className="font-semibold text-red-600 hover:text-red-800 disabled:opacity-50"
                      aria-label={t('tournament.remove_organizer_aria', 'Remove {{nickname}} as co-organizer', { nickname: organizer.nickname })}
                    >
                      ×
                    </button>
                  </span>
                ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default TournamentOrganizersPanel;
