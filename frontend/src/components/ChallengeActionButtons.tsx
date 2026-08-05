import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { p2pChallengesService } from '../services/p2pChallengesService';
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
  const [showManageModal, setShowManageModal] = useState(false);
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [viewingTimezone, setViewingTimezone] = useState('UTC');
  const [loadingData, setLoadingData] = useState(false);

  // Both participants may manage a pending or confirmed proposal; the backend
  // still enforces the participant boundary for every operation.
  const isIncoming = userId === challengedUserId;
  const isProposer = userId === proposedByUserId;
  const isManageable = status === 'pending' || status === 'confirmed';
  const showActions = isManageable && (isProposer || isIncoming);

  useEffect(() => {
    if (showManageModal && !proposal) {
      loadProposalData();
    }
  }, [showManageModal]);

  const loadProposalData = async () => {
    try {
      setLoadingData(true);
      
      const response = await p2pChallengesService.getProposal(proposalId);
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
      const viewerProfile = participants.find((participant) => participant.id === userId);
      setViewingTimezone(viewerProfile?.timezone || 'UTC');
    } catch (err) {
      console.error('Error loading proposal:', err);
    } finally {
      setLoadingData(false);
    }
  };

  const handleScheduleSuccess = () => {
    setShowManageModal(false);
    setProposal(null);
    setParticipants([]);
    onActionComplete?.();
  };

  if (!showActions) return null;

  const firstSlotDatetime = proposal?.slots?.[0]?.slot_datetime;
  const initialSlotHour = firstSlotDatetime
    ? Number(new Intl.DateTimeFormat('en-US', {
        timeZone: viewingTimezone,
        hour: '2-digit',
        hour12: false,
      }).format(new Date(firstSlotDatetime))) % 24
    : null;

  return (
    <>
      <button
        onClick={() => setShowManageModal(true)}
        data-help-id="action-manage-challenge"
        className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded font-semibold transition-colors"
        title="Manage this challenge"
      >
        ⚙️ {t('events_manage_challenge') || 'Manage Challenge'}
      </button>

      {proposal && participants.length > 0 && (
        <ScheduleProposalModalP2P
          isOpen={showManageModal}
          onClose={() => {
            setShowManageModal(false);
            setProposal(null);
            setParticipants([]);
          }}
          onSuccess={handleScheduleSuccess}
          opponentId={isProposer ? challengedUserId : proposedByUserId}
          proposalId={proposalId}
          initialProposal={proposal}
          initialParticipants={participants}
          initialViewingTimezone={viewingTimezone}
          initialDisplayDateStart={
            proposal.slots && proposal.slots.length > 0
              ? new Date(proposal.slots[0].slot_datetime)
              : new Date()
          }
          initialScrollToHour={initialSlotHour}
        />
      )}
    </>
  );
};

export default ChallengeActionButtons;
