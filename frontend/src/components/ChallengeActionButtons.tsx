import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import { useAuthStore } from '../store/authStore';
import ConfirmChallengeModal from './ConfirmChallengeModal';
import CounterProposeModal from './CounterProposeModal';

interface ChallengeActionButtonsProps {
  proposalId: string;
  proposedByUserId: string;
  challengedUserId: string;
  status: string;
  onActionComplete?: () => void;
  layout?: 'inline' | 'stacked';
  otherPlayerTimezone?: string;
}

const ChallengeActionButtons: React.FC<ChallengeActionButtonsProps> = ({
  proposalId,
  proposedByUserId,
  challengedUserId,
  status,
  onActionComplete,
  layout = 'inline',
  otherPlayerTimezone,
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCounterModal, setShowCounterModal] = useState(false);

  // Only show actions if user is the challenged player and proposal is pending
  const isIncoming = userId === challengedUserId;
  const isPending = status === 'pending';
  const showActions = isIncoming && isPending;

  if (!showActions) return null;

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

      <ConfirmChallengeModal
        proposalId={proposalId}
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={handleConfirmComplete}
      />

      <CounterProposeModal
        proposalId={proposalId}
        isOpen={showCounterModal}
        onClose={() => setShowCounterModal(false)}
        onCounterPropose={handleCounterComplete}
        otherPlayerTimezone={otherPlayerTimezone}
      />
    </>
  );
};

export default ChallengeActionButtons;
