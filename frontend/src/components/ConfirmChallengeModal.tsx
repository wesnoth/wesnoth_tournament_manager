import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import { publicService } from '../services/api';
import SchedulingFreeBusyGrid from './SchedulingFreeBusyGrid';
import { groupSlotsIntoRanges } from '../utils/slotGrouping';
import { useAuthStore } from '../store/authStore';

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface ConfirmChallengeModalProps {
  proposalId: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const ConfirmChallengeModal: React.FC<ConfirmChallengeModalProps> = ({
  proposalId,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();
  const [proposal, setProposal] = useState<any>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && proposalId) {
      loadProposalData();
    }
  }, [isOpen, proposalId]);

  const loadProposalData = async () => {
    try {
      setLoadingData(true);
      setError('');
      
      const response = await challengeSchedulingService.getProposal(proposalId);
      const proposalData = response.proposal || response;
      setProposal(proposalData);

      // Pre-select all proposed slots
      if (proposalData.slots && proposalData.slots.length > 0) {
        setSelectedSlots(new Set(proposalData.slots.map(s => s.slot_datetime)));
      }

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
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load proposal data');
    } finally {
      setLoadingData(false);
    }
  };

  const handleSlotToggle = (slotDatetime: string, selected: boolean) => {
    const newSelected = new Set(selectedSlots);
    if (selected) {
      newSelected.add(slotDatetime);
    } else {
      newSelected.delete(slotDatetime);
    }
    setSelectedSlots(newSelected);
  };

  const handleConfirm = async () => {
    if (selectedSlots.size === 0) {
      setError(t('events_action_error_select_slots') || 'Please select at least one slot');
      return;
    }

    try {
      setLoading(true);
      const confirmedSlotIds = Array.from(selectedSlots);
      await challengeSchedulingService.confirmSlots(proposalId, confirmedSlotIds);
      onConfirm();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('events_action_error_confirm') || 'Failed to confirm slots');
    } finally {
      setLoading(false);
    }
  };

  // Get the user's timezone for viewing
  const userParticipant = participants.find(p => p.id === userId);
  const viewingTimezone = userParticipant?.timezone || 'UTC';

  // Position grid at first proposed slot
  let dateStart = new Date();
  let dateEnd = new Date();
  dateEnd.setDate(dateEnd.getDate() + 14);

  if (proposal?.slots && proposal.slots.length > 0) {
    const firstSlotDate = new Date(proposal.slots[0].slot_datetime);
    dateStart = new Date(firstSlotDate);
    dateStart.setHours(0, 0, 0, 0);
    
    const lastSlotDate = new Date(proposal.slots[proposal.slots.length - 1].slot_datetime);
    dateEnd = new Date(lastSlotDate);
    dateEnd.setDate(dateEnd.getDate() + 7);
  }

  const proposalRanges = useMemo(
    () => (proposal?.slots?.length ? groupSlotsIntoRanges(proposal.slots.map(s => s.slot_datetime)) : []),
    [proposal]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-4xl w-full max-h-[85vh] overflow-auto">
        <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
          <h2 className="text-lg font-bold">{t('events_action_confirm') || 'Confirm Challenge Slots'}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-100 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          {loadingData ? (
            <div className="text-center py-8 text-gray-600">
              {t('common.loading') || 'Loading...'}
            </div>
          ) : participants.length > 0 && proposal?.slots?.length > 0 ? (
            <>
              <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded text-sm text-blue-800">
                <span className="font-semibold">{t('events_viewing_as') || 'Viewing as'}:</span> {viewingTimezone}{' '}
                <span className="text-xs text-blue-600">
                  ({t('events_viewing_note') || 'All times converted to your timezone'})
                </span>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">
                  {t('events_action_select_slots') || 'Select the slots you want to confirm:'}
                </label>
                {proposalRanges.length > 0 && (
                  <div className="mb-3 p-2 bg-gray-50 rounded border border-gray-200">
                    {proposalRanges.map((range, i) => (
                      <div key={i} className="text-sm text-gray-700">
                        {new Date(range.start).toLocaleString()} – {new Date(range.end).toLocaleTimeString()}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">
                  {t('events_modal_availability_grid') || 'Availability Grid'}
                </label>
                <SchedulingFreeBusyGrid
                  dateStart={dateStart}
                  dateEnd={dateEnd}
                  participants={participants}
                  viewingTimezone={viewingTimezone}
                  selectedSlots={selectedSlots}
                  onSlotToggle={handleSlotToggle}
                  proposedSlots={proposal.slots.map((s: any) => s.slot_datetime)}
                  confirmMode={true}
                />
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-600">
              {t('events_no_slots') || 'No slots available'}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t p-4 flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={loading || loadingData}
            className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || loadingData || selectedSlots.size === 0}
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {loading ? '⏳' : '✅'} {t('events_action_confirm') || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmChallengeModal;
