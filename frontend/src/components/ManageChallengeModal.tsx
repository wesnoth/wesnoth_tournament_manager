import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { p2pChallengesService } from '../services/p2pChallengesService';
import ScheduleProposalModalP2P from './ScheduleProposalModalP2P';

interface ManageChallengeModalProps {
  isOpen: boolean;
  proposalId: string;
  proposedByUserId: string;
  onClose: () => void;
  onActionComplete?: () => void;
  initialProposal?: any;
  initialParticipants?: any[];
  initialViewingTimezone?: string;
}

const ManageChallengeModal: React.FC<ManageChallengeModalProps> = ({
  isOpen,
  proposalId,
  proposedByUserId,
  onClose,
  onActionComplete,
  initialProposal,
  initialParticipants,
  initialViewingTimezone,
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<'confirm' | 'counter' | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  const handleReject = async () => {
    setLoading(true);
    setError('');
    try {
      await p2pChallengesService.cancelProposal(proposalId);
      onClose();
      onActionComplete?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('events_action_error_reject') || 'Failed to reject challenge');
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    setAction('confirm');
    setShowScheduleModal(true);
  };

  const handleCounterPropose = () => {
    setAction('counter');
    setShowScheduleModal(true);
  };

  const handleScheduleClose = () => {
    setShowScheduleModal(false);
    setAction(null);
  };

  const handleScheduleSuccess = () => {
    setShowScheduleModal(false);
    setAction(null);
    onClose();
    onActionComplete?.();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Main manage challenge modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white rounded-lg shadow-lg max-w-sm w-full mx-4">
          <div className="border-b border-gray-200 p-4 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800">
              {t('events_manage_challenge') || 'Manage Challenge'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              disabled={loading}
            >
              ×
            </button>
          </div>

          <div className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            <p className="text-gray-700 text-sm">
              {t('events_manage_challenge_description') || 'What would you like to do with this challenge?'}
            </p>

            <div className="space-y-2">
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-semibold transition-colors disabled:opacity-50"
              >
                ✅ {t('events_action_confirm') || 'Confirm Slots'}
              </button>

              <button
                onClick={handleCounterPropose}
                disabled={loading}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold transition-colors disabled:opacity-50"
              >
                🔄 {t('events_action_counter_propose') || 'Counter-propose'}
              </button>

              <button
                onClick={handleReject}
                disabled={loading}
                className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-semibold transition-colors disabled:opacity-50"
              >
                {loading ? '⏳' : '❌'} {t('events_action_reject') || 'Reject'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Schedule proposal modal */}
      {initialProposal && initialParticipants && initialParticipants.length > 0 && (
        <ScheduleProposalModalP2P
          isOpen={showScheduleModal}
          onClose={handleScheduleClose}
          onSuccess={handleScheduleSuccess}
          opponentId={proposedByUserId}
          proposalId={proposalId}
          initialProposal={initialProposal}
          initialParticipants={initialParticipants}
          initialViewingTimezone={initialViewingTimezone}
          initialDisplayDateStart={
            initialProposal.slots && initialProposal.slots.length > 0
              ? new Date(initialProposal.slots[0].slot_datetime)
              : new Date()
          }
        />
      )}
    </>
  );
};

export default ManageChallengeModal;
