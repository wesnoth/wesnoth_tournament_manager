import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { challengeSchedulingService } from '../services/challengeSchedulingService';

interface ConfirmChallengeModalProps {
  proposalId: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

interface Slot {
  id: string;
  slot_datetime: string;
  duration: number;
  created_at: string;
}

const ConfirmChallengeModal: React.FC<ConfirmChallengeModalProps> = ({
  proposalId,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && proposalId) {
      loadSlots();
    }
  }, [isOpen, proposalId]);

  const loadSlots = async () => {
    try {
      setLoading(true);
      const response = await challengeSchedulingService.getProposal(proposalId);
      const proposal = response.proposal || response;
      
      if (proposal.slots && proposal.slots.length > 0) {
        setSlots(proposal.slots);
        // Pre-select all available slots
        setSelectedSlotIds(new Set(proposal.slots.map(s => s.id)));
      } else {
        setError(t('events_no_slots') || 'No slots available');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load slots');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSlot = (slotId: string) => {
    const newSelected = new Set(selectedSlotIds);
    if (newSelected.has(slotId)) {
      newSelected.delete(slotId);
    } else {
      newSelected.add(slotId);
    }
    setSelectedSlotIds(newSelected);
  };

  const handleConfirm = async () => {
    if (selectedSlotIds.size === 0) {
      setError(t('events_action_error_select_slots') || 'Please select at least one slot');
      return;
    }

    try {
      setLoading(true);
      const confirmedSlotIds = Array.from(selectedSlotIds);
      await challengeSchedulingService.confirmSlots(proposalId, confirmedSlotIds);
      onConfirm();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('events_action_error_confirm') || 'Failed to confirm slots');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-96 overflow-auto">
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

        <div className="p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          {slots.length === 0 ? (
            <p className="text-gray-600 text-center py-8">
              {loading ? (t('common.loading') || 'Loading...') : (t('events_no_slots') || 'No slots available')}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-600 mb-3">
                {t('events_action_select_slots') || 'Select the slots you want to confirm:'}
              </p>
              {slots.map((slot) => (
                <label key={slot.id} className="flex items-center p-2 border rounded hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSlotIds.has(slot.id)}
                    onChange={() => handleToggleSlot(slot.id)}
                    disabled={loading}
                    className="mr-3"
                  />
                  <span className="flex-1">
                    <span className="font-semibold">
                      {new Date(slot.slot_datetime).toLocaleString()}
                    </span>
                    <span className="text-gray-600 ml-2">
                      ({slot.duration} {t('common.hours') || 'hours'})
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t p-4 flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || selectedSlotIds.size === 0}
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
