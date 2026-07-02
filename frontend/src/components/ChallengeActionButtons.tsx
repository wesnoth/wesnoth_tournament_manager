import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import { publicService } from '../services/api';
import { useAuthStore } from '../store/authStore';
import ManageChallengeModal from './ManageChallengeModal';

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

  // Only show actions if user is the challenged player and proposal is pending
  const isIncoming = userId === challengedUserId;
  const isPending = status === 'pending';
  const showActions = isIncoming && isPending;

  useEffect(() => {
    if (showManageModal && !proposal) {
      loadProposalData();
    }
  }, [showManageModal]);

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

  if (!showActions) return null;

  return (
    <>
      <button
        onClick={() => setShowManageModal(true)}
        className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-700 text-white rounded font-semibold transition-colors"
        title="Manage this challenge"
      >
        ⚙️ {t('events_manage_challenge') || 'Manage Challenge'}
      </button>

      {proposal && participants.length > 0 && (
        <ManageChallengeModal
          isOpen={showManageModal}
          onClose={() => setShowManageModal(false)}
          onActionComplete={() => {
            setShowManageModal(false);
            onActionComplete?.();
          }}
          proposalId={proposalId}
          proposedByUserId={proposedByUserId}
          initialProposal={proposal}
          initialParticipants={participants}
          initialViewingTimezone={viewingTimezone}
        />
      )}
    </>
  );
};

export default ChallengeActionButtons;
