import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import { publicService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import ScheduleProposalModalP2P from './ScheduleProposalModalP2P';

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface ProposalData {
  id: string;
  proposed_by_user_id: string;
  proposed_at: string;
  status: string;
  notes?: string;
  slots: Array<{
    id: string;
    slot_datetime: string;
    status: string;
  }>;
  confirmations: Array<{ user_id: string; confirmed_at: string }>;
}

interface ChallengeActionButtonsProps {
  proposalId: string;
  proposedByUserId: string;
  challengedUserId: string;
  status: string;
  onActionComplete?: () => void;
  layout?: 'inline' | 'stacked';
}

const ChallengeActionButtons: React.FC<ChallengeActionButtonsProps> = ({
  proposalId,
  proposedByUserId,
  challengedUserId,
  status,
  onActionComplete,
  layout = 'inline',
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCounterModal, setShowCounterModal] = useState(false);
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [viewingTimezone, setViewingTimezone] = useState('UTC');
  const [loadingData, setLoadingData] = useState(false);

  // Only show actions if user is the challenged player and proposal is pending
  const isIncoming = userId === challengedUserId;
  const isPending = status === 'pending';
  const showActions = isIncoming && isPending;

  useEffect(() => {
    if ((showConfirmModal || showCounterModal) && !proposal) {
      loadProposalData();
    }
  }, [showConfirmModal, showCounterModal]);

  const loadProposalData = async () => {
    try {
      setLoadingData(true);
      
      const response = await challengeSchedulingService.getProposal(proposalId);
      const proposalData = response.proposal || response;
      setProposal(proposalData);

      // Load both players' data
      const [proposedByUser, challengedUser] = await Promise.all([
        publicService.getPlayerProfile(proposalData.proposed_by_user_id),
        publicService.getPlayerProfile(proposalData.challenged_user_id),
      ]);

      const participants: Participant[] = [
        {
          id: proposedByUser.data.id,
          nickname: proposedByUser.data.nickname,
          timezone: proposedByUser.data.timezone,
          availability_schedule: proposedByUser.data.availability_schedule,
        },
        {
          id: challengedUser.data.id,
          nickname: challengedUser.data.nickname,
          timezone: challengedUser.data.timezone,
          availability_schedule: challengedUser.data.availability_schedule,
        },
      ];

      setParticipants(participants);
      setViewingTimezone(proposedByUser.data.timezone || 'UTC');
    } catch (err: any) {
      console.error('Error loading proposal:', err);
    } finally {
      setLoadingData(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError('');
    try {
      await challengeSchedulingService.cancelProposal(proposalId);
      onActionComplete?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('events_action_error_reject') || 'Failed to reject challenge');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmComplete = () => {
    setShowConfirmModal(false);
    onActionComplete?.();
  };

  const handleCounterComplete = () => {
    setShowCounterModal(false);
    onActionComplete?.();
  };

  if (!showActions) return null;

  const containerClass = layout === 'inline' ? 'flex gap-2' : 'flex flex-col gap-2';
  const buttonClass = 'px-3 py-1 text-sm rounded font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <>
      <div className={containerClass}>
        {error && (
          <div className="text-xs text-red-600 bg-red-50 p-1 rounded w-full">
            {error}
          </div>
        )}
        <button
          onClick={handleReject}
          disabled={loading}
          className={`${buttonClass} bg-red-100 text-red-700 hover:bg-red-200`}
          title="Reject this challenge proposal"
        >
          {loading ? '⏳' : '❌'} {t('events_action_reject') || 'Reject'}
        </button>
        <button
          onClick={() => setShowConfirmModal(true)}
          disabled={loading}
          className={`${buttonClass} bg-green-100 text-green-700 hover:bg-green-200`}
          title="Confirm schedule slots"
        >
          ✅ {t('events_action_confirm') || 'Confirm'}
        </button>
        <button
          onClick={() => setShowCounterModal(true)}
          disabled={loading}
          className={`${buttonClass} bg-blue-100 text-blue-700 hover:bg-blue-200`}
          title="Counter-propose with different slots"
        >
          🔄 {t('events_action_counter_propose') || 'Counter-propose'}
        </button>
      </div>

      {proposal && participants.length > 0 && (
        <>
          <ScheduleProposalModalP2P
            isOpen={showConfirmModal}
            onClose={() => setShowConfirmModal(false)}
            onSuccess={handleConfirmComplete}
            opponentId={proposedByUserId} // The proposer is the opponent
            proposalId={proposalId}
            initialProposal={proposal}
            initialParticipants={participants}
            initialViewingTimezone={viewingTimezone}
            initialDisplayDateStart={
              proposal.slots && proposal.slots.length > 0
                ? new Date(proposal.slots[0].slot_datetime)
                : new Date()
            }
          />
          <ScheduleProposalModalP2P
            isOpen={showCounterModal}
            onClose={() => setShowCounterModal(false)}
            onSuccess={handleCounterComplete}
            opponentId={proposedByUserId} // The proposer is the opponent
            proposalId={proposalId}
            initialProposal={proposal}
            initialParticipants={participants}
            initialViewingTimezone={viewingTimezone}
            initialDisplayDateStart={
              proposal.slots && proposal.slots.length > 0
                ? new Date(proposal.slots[0].slot_datetime)
                : new Date()
            }
          />
        </>
      )}
    </>
  );
};

export default ChallengeActionButtons;
