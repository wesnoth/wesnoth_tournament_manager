import React from 'react';
import { useTranslation } from 'react-i18next';
import PlayerLink from './PlayerLink';
import { TournamentDirectPassControl, describeDirectPass } from './TournamentDirectPassControl';
import type { DirectPassContext, ParticipantRowActions } from './TournamentParticipantsTable';
import type { TournamentDetails, TournamentTeam, TournamentTeamMember } from '../types/tournament';
import { getParticipationStatusColor } from '../utils/tournamentStatus';

interface TournamentTeamsListProps {
  tournament: Pick<TournamentDetails, 'id' | 'status'>;
  teams: TournamentTeam[];
  currentUserId: string | null;
  /** Team of the current user, who may rename it while registration is open. */
  userTeamId: string | null;
  isOrganizer: boolean;
  /** Organizers, administrators, and tournament moderators. */
  canManageParticipants: boolean;
  directPass: DirectPassContext;
  actions: ParticipantRowActions;
  onRename: (team: TournamentTeam) => void;
  onSubstitute: (team: TournamentTeam, member: TournamentTeamMember) => void;
}

/**
 * Team cards of a 2v2 tournament with their member rows. The pseudo-team
 * "Rejected players" collects rejected registrations: it is shown last and
 * only while registration is open, and it cannot be renamed.
 */
const TournamentTeamsList: React.FC<TournamentTeamsListProps> = ({
  tournament,
  teams,
  currentUserId,
  userTeamId,
  isOrganizer,
  canManageParticipants,
  directPass,
  actions,
  onRename,
  onSubstitute,
}) => {
  const { t } = useTranslation();
  const canRenameTeam = (team: TournamentTeam) => canManageParticipants || (userTeamId !== null && team.id === userTeamId);
  return (
    teams.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {teams
          .filter((team) => {
            // Show "Rejected players" team only if registration is open
            const isRejectedTeam = team.nickname === 'Rejected players';
            if (isRejectedTeam && tournament.status !== 'registration_open') {
              return false;
            }
            return true;
          })
          .sort((a, b) => {
            // Always show "Rejected players" team last if it exists
            const aIsRejected = a.nickname === 'Rejected players';
            const bIsRejected = b.nickname === 'Rejected players';
            if (aIsRejected && !bIsRejected) return 1;
            if (!aIsRejected && bIsRejected) return -1;
            return 0;
          })
          .map((team) => (
          <div key={team.id} className="border-2 border-blue-400 rounded-lg p-6 bg-gray-50 shadow hover:shadow-lg transition-all hover:-translate-y-1">
            <div className="flex justify-between items-start gap-6 mb-4 pb-3 border-b-2 border-blue-400 flex-wrap">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-800">
                    {team.nickname}
                  </h3>
                  {canRenameTeam(team) && tournament.status === 'registration_open' && team.nickname !== 'Rejected players' && (
                    <button
                      data-help-id="action-rename-team"
                      className="text-gray-400 hover:text-blue-600 transition-colors p-1"
                      title="Rename team"
                      onClick={() => onRename(team)}
                    >
                      ✏️
                    </button>
                  )}
                </div>
                <span className="text-sm text-gray-600">({team.team_size}/2 members)</span>
                {team.team_total_elo && (
                  <div className="text-sm text-gray-700 mt-2">
                    <strong>Total ELO:</strong> {team.team_total_elo}
                  </div>
                )}
              </div>
            </div>
            {directPass.editable && <div className="mb-3">
              <TournamentDirectPassControl tournamentId={tournament.id} entityType="team" entityId={team.id} groups={directPass.groups} current={team}
                disabled={!['active'].includes(team.status)} onSaved={directPass.onSaved} />
            </div>}
            {describeDirectPass(team, directPass.groups) && <p className="mb-3 text-sm font-medium text-indigo-800">Direct pass: {describeDirectPass(team, directPass.groups)}</p>}
            {team.members_with_elo && team.members_with_elo.length > 0 ? (
              <div className="mt-4 max-md:overflow-x-auto max-md:-webkit-overflow-scrolling-touch">
                <table className="w-full text-sm max-md:min-w-[600px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">{t('label_nickname')}</th>
                      <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">{t('label_elo')}</th>
                      <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">Position</th>
                      <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">{t('label_status')}</th>
                      <th className="px-4 py-3 max-md:px-2 max-md:py-2 text-left font-semibold text-gray-700 border-b-2 border-gray-300 max-md:text-xs">{t('label_actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.members_with_elo.map((member) => (
                      <tr key={member.user_id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 max-md:px-2 max-md:py-2 text-gray-700 max-md:text-xs"><PlayerLink nickname={member.nickname} userId={member.user_id} /></td>
                        <td className="px-4 py-3 max-md:px-2 max-md:py-2 text-gray-700 max-md:text-xs">{member.elo_rating || '-'}</td>
                        <td className="px-4 py-3 max-md:px-2 max-md:py-2 text-gray-700 max-md:text-xs">{member.team_position || '-'}</td>
                        <td className="px-4 py-3 max-md:px-2 max-md:py-2 text-gray-700 max-md:text-xs">
                          <span
                            className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold"
                            style={{ backgroundColor: getParticipationStatusColor(member.participation_status || 'pending') }}
                          >
                            {member.participation_status === 'unconfirmed' ? 'Unconfirmed' :
                           member.participation_status === 'pending' ? 'Pending' :
                           member.participation_status === 'accepted' ? 'Accepted' : 'Pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <div className="flex gap-2 flex-wrap">
                          {member.participation_status === 'unconfirmed' && member.user_id === currentUserId && (
                            <button
                              data-help-id="action-confirm-participation"
                              className="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 transition-colors"
                              onClick={() => actions.onConfirm(member.participant_id)}
                              title="Confirm your participation"
                            >
                              {t('btn_confirm') || 'Confirm'}
                            </button>
                          )}
                          {isOrganizer && member.participation_status === 'pending' && (
                            <>
                              <button
                                data-help-id="action-accept-participant"
                                className="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 transition-colors"
                                onClick={() => actions.onAccept(member.participant_id)}
                                title={t('btn_accept')}
                              >
                                {t('btn_accept')}
                              </button>
                              <button
                                data-help-id="action-reject-participant"
                                className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition-colors"
                                onClick={() => actions.onReject(member.participant_id)}
                                title={t('btn_reject')}
                              >
                                {t('btn_reject')}
                              </button>
                            </>
                          )}
                          {isOrganizer && member.participation_status === 'unconfirmed' && (
                            <span title="Awaiting player confirmation" className="text-sm text-gray-600">
                              Awaiting confirmation
                            </span>
                          )}
                          {/* Substitute Player — organizer only, after tournament starts, team active, for accepted members */}
                          {isOrganizer && ['registration_closed', 'prepared', 'in_progress'].includes(tournament.status || '') && team.status === 'active' && member.participation_status === 'accepted' && (
                            <button
                              data-help-id="action-replace-team-member"
                              className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors"
                              title="Replace this player with a substitute"
                              onClick={() => onSubstitute(team, member)}
                            >
                              Substitute
                            </button>
                          )}
                          {/* Remove participant — self, organizer, admin, moderator; only before tournament starts */}
                          {(member.user_id === currentUserId || canManageParticipants) &&
                           tournament.status === 'registration_open' && (
                            <button
                              data-help-id="action-remove-participant"
                              className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 transition-colors"
                              title="Remove from tournament"
                              onClick={() => actions.onRemove(member.participant_id, member.nickname)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="text-gray-600 text-center py-4">No members</p>
            )}
          </div>
        ))}
      </div>
    ) : (
      <p className="text-gray-600">{t('no_participants_yet')}</p>
    )
  );
};

export default TournamentTeamsList;
