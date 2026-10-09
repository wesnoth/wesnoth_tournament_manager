import React from 'react';
import { useTranslation } from 'react-i18next';
import PlayerLink from './PlayerLink';
import { TournamentDirectPassControl, describeDirectPass, type DirectPassGroupOption } from './TournamentDirectPassControl';
import type { TournamentDetails, TournamentParticipant } from '../types/tournament';
import { getParticipationStatusColor, statusLabel } from '../utils/tournamentStatus';

/** Registration actions offered on participant rows; each takes the participant row id. */
export interface ParticipantRowActions {
  onAccept: (participantId: string) => void;
  onReject: (participantId: string) => void;
  onConfirm: (participantId: string) => void;
  onRemove: (participantId: string, nickname: string) => void;
}

/** Direct-pass groups of the tournament and whether the viewer may assign passes now. */
export interface DirectPassContext {
  groups: DirectPassGroupOption[];
  editable: boolean;
  /** Reload the entries and the format after a pass is saved. */
  onSaved: () => void;
}

interface TournamentParticipantsTableProps {
  tournament: Pick<TournamentDetails, 'id' | 'status'>;
  participants: TournamentParticipant[];
  currentUserId: string | null;
  isOrganizer: boolean;
  /** Organizers, administrators, and tournament moderators. */
  canManageParticipants: boolean;
  directPass: DirectPassContext;
  actions: ParticipantRowActions;
}

/**
 * Registered players of a 1v1 tournament. Registration actions are shown only
 * while registration is open; the actions column is omitted otherwise so the
 * header and rows keep the same column count for every visitor.
 */
const TournamentParticipantsTable: React.FC<TournamentParticipantsTableProps> = ({
  tournament,
  participants,
  currentUserId,
  isOrganizer,
  canManageParticipants,
  directPass,
  actions,
}) => {
  const { t } = useTranslation();
  const showParticipantActions = Boolean((canManageParticipants || currentUserId) && tournament.status === 'registration_open');
  return (
    participants.length > 0 ? (
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_nickname')}</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_status')}</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_elo')}</th>
            {showParticipantActions && <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">{t('label_actions')}</th>}
            {directPass.groups.length > 0 && <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-gray-300">Direct pass</th>}
          </tr>
        </thead>
        <tbody>
          {participants.map((p) => (
            <tr key={p.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-gray-700"><PlayerLink nickname={p.nickname} userId={p.user_id} /></td>
              <td className="px-4 py-3 text-gray-700">
                <span 
                  className="inline-block px-3 py-1 text-white rounded-full text-xs font-semibold"
                  style={{ backgroundColor: getParticipationStatusColor(p.participation_status) }}
                >
                  {statusLabel(t, p.participation_status)}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-700">{p.elo_rating || '-'}</td>
              {showParticipantActions && (
              <td className="px-4 py-3 text-gray-700">
                <div className="flex gap-1 flex-wrap">
                {isOrganizer && p.participation_status === 'pending' && (
                  <>
                  <button 
                    data-help-id="action-accept-participant"
                    className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 transition-colors"
                    onClick={() => actions.onAccept(p.id)}
                  >
                    {t('btn_accept')}
                  </button>
                  <button 
                    data-help-id="action-reject-participant"
                    className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600 transition-colors"
                    onClick={() => actions.onReject(p.id)}
                  >
                    {t('btn_reject')}
                  </button>
                  </>
                )}
                {(p.user_id === currentUserId || canManageParticipants) && (
                  <button
                    data-help-id="action-remove-participant"
                    className="px-2 py-1 bg-red-700 text-white rounded text-xs hover:bg-red-800 transition-colors"
                    title="Remove from tournament"
                    onClick={() => actions.onRemove(p.id, p.nickname)}
                  >
                    ✕
                  </button>
                )}
                </div>
              </td>
              )}
              {directPass.groups.length > 0 && <td className="px-4 py-3 text-gray-700">
                {directPass.editable
                  ? <TournamentDirectPassControl tournamentId={tournament.id} entityType="participant" entityId={p.id}
                      groups={directPass.groups} current={p} disabled={p.participation_status !== 'accepted' || Boolean(p.team_id)}
                      onSaved={directPass.onSaved} />
                  : describeDirectPass(p, directPass.groups)
                    ? <span className="font-medium text-indigo-800">{describeDirectPass(p, directPass.groups)}</span>
                    : <span className="text-gray-400">—</span>}
              </td>}
          </tr>
        ))}
      </tbody>
      </table>
      </div>
    ) : (
      <p className="text-gray-600">{t('no_participants_yet')}</p>
    )
  );
};

export default TournamentParticipantsTable;
