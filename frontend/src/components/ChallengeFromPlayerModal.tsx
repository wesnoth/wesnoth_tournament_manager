import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ScheduleProposalModalP2P from './ScheduleProposalModalP2P';
import { publicService, userService } from '../services/api';
import { useAuthStore } from '../store/authStore';

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface ChallengeFromPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  opponentId: string;
  opponentNickname: string;
}

const ChallengeFromPlayerModal: React.FC<ChallengeFromPlayerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  opponentId,
  opponentNickname,
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [viewingTimezone, setViewingTimezone] = useState('UTC');
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Load participant data
  useEffect(() => {
    if (!isOpen || !opponentId) return;

    const loadParticipants = async () => {
      try {
        setLoading(true);
        setError('');
        const [myProfile, opponentProfile] = await Promise.all([
          userService.getProfile(),
          publicService.getPlayerProfile(opponentId),
        ]);

        const me = myProfile.data;
        const opponent = opponentProfile.data;

        setViewingTimezone(me?.timezone || 'UTC');
        setParticipants([
          {
            id: me.id,
            nickname: me.nickname,
            timezone: me.timezone || 'UTC',
            availability_schedule: me.availability_schedule || null,
          },
          {
            id: opponent.id,
            nickname: opponent.nickname,
            timezone: opponent.timezone || 'UTC',
            availability_schedule: opponent.availability_schedule || null,
          },
        ]);

        // Auto-open schedule modal when data loaded
        setShowScheduleModal(true);
      } catch (err) {
        setError(t('events_modal_error_availability') || 'Failed to load players availability');
      } finally {
        setLoading(false);
      }
    };

    loadParticipants();
  }, [isOpen, opponentId, t]);

  const handleScheduleClose = () => {
    setShowScheduleModal(false);
    onClose();
  };

  const handleScheduleSuccess = () => {
    setShowScheduleModal(false);
    onClose();
    onSuccess?.();
  };

  if (!isOpen) return null;

  // Show loading/confirmation screen while data loads
  if (!showScheduleModal) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
          <div className="border-b border-gray-200 p-4 flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-800">
              {t('events_modal_challenge_title') || 'Challenge Player'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
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

            {!error && (
              <>
                <p className="text-gray-700">
                  {t('events_modal_challenge_description') || 'You are about to challenge'}
                </p>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="font-semibold text-gray-800">{opponentNickname}</p>
                </div>
                <p className="text-sm text-gray-600">
                  {loading
                    ? t('loading') + '...'
                    : t('events_modal_loading_availability') || 'Loading player availability...'}
                </p>
              </>
            )}
          </div>

          {error && (
            <div className="border-t border-gray-200 p-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-semibold"
              >
                {t('cancel')}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Schedule modal will render separately
  return (
    <ScheduleProposalModalP2P
      isOpen={showScheduleModal}
      onClose={handleScheduleClose}
      onSuccess={handleScheduleSuccess}
      opponentId={opponentId}
      initialParticipants={participants}
      initialViewingTimezone={viewingTimezone}
      initialDisplayDateStart={new Date()}
    />
  );
};

export default ChallengeFromPlayerModal;
