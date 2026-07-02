import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import SchedulingFreeBusyGrid from './SchedulingFreeBusyGrid';

interface CounterProposeModalProps {
  proposalId: string;
  isOpen: boolean;
  onClose: () => void;
  onCounterPropose: () => void;
  otherPlayerTimezone?: string;
}

const CounterProposeModal: React.FC<CounterProposeModalProps> = ({
  proposalId,
  isOpen,
  onClose,
  onCounterPropose,
  otherPlayerTimezone,
}) => {
  const { t } = useTranslation();
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (selectedSlots.length === 0) {
      setError(t('events_action_error_select_slots') || 'Please select at least one slot');
      return;
    }

    try {
      setLoading(true);
      await challengeSchedulingService.counterPropose(proposalId, {
        slot_datetimes: selectedSlots,
        notes,
      });
      onCounterPropose();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('events_action_error_counter') || 'Failed to counter-propose');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-96 overflow-auto">
        <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
          <h2 className="text-lg font-bold">{t('events_action_counter_propose') || 'Counter-propose Slots'}</h2>
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

          <div>
            <label className="block text-sm font-semibold mb-2">
              {t('events_modal_date_range') || 'Proposed Slots'}
            </label>
            <SchedulingFreeBusyGrid
              onSlotsChange={setSelectedSlots}
              otherPlayerTimezone={otherPlayerTimezone}
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              {t('events_modal_notes') || 'Notes'}
              <span className="text-gray-600 font-normal ml-1">
                ({t('common.optional') || 'optional'})
              </span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('events_modal_notes_placeholder') || 'Add any notes or preferences...'}
              disabled={loading}
              className="w-full p-2 border rounded text-sm h-20 resize-none disabled:bg-gray-100"
            />
          </div>
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
            onClick={handleSubmit}
            disabled={loading || selectedSlots.length === 0}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {loading ? '⏳' : '🔄'} {t('events_action_counter_propose') || 'Counter-propose'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CounterProposeModal;
