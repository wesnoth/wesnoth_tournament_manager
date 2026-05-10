import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SchedulingFreeBusyGrid from './SchedulingFreeBusyGrid';
import { tournamentSchedulingService } from '../services/tournamentSchedulingService';

interface ScheduleProposalModalProps {
  isOpen: boolean;
  tournamentId: string;
  roundMatchId?: string;
  matchId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

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
  confirmations: Record<string, Array<{ user_id: string; team_id?: string; confirmed_at: string }>>;
}

export default function ScheduleProposalModal({
  isOpen,
  tournamentId,
  roundMatchId,
  matchId,
  onClose,
  onSuccess
}: ScheduleProposalModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'propose' | 'confirm' | 'counter'>('propose');

  const targetId = roundMatchId || matchId;
  const isRoundMatch = !!roundMatchId;

  // Load data when modal opens
  useEffect(() => {
    if (!isOpen || !targetId) return;

    const loadData = async () => {
      try {
        setLoading(true);
        setError('');

        // Load participants availability
        const availRes = isRoundMatch
          ? await tournamentSchedulingService.getRoundMatchParticipantsAvailability(tournamentId, targetId)
          : await tournamentSchedulingService.getMatchParticipantsAvailability(tournamentId, targetId);

        setParticipants(availRes.participants || []);

        // Load active proposal if exists
        const proposalRes = isRoundMatch
          ? await tournamentSchedulingService.getRoundMatchProposal(tournamentId, targetId)
          : await tournamentSchedulingService.getMatchProposal(tournamentId, targetId);

        if (proposalRes.proposal) {
          setProposal(proposalRes.proposal);
          setMode('confirm');
        } else {
          setMode('propose');
        }
      } catch (err) {
        console.error('Error loading scheduling data:', err);
        setError('Failed to load scheduling data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, targetId, tournamentId, isRoundMatch]);

  const handleSlotToggle = (slotDatetime: string, selected: boolean) => {
    const newSelected = new Set(selectedSlots);
    if (selected) {
      newSelected.add(slotDatetime);
    } else {
      newSelected.delete(slotDatetime);
    }
    setSelectedSlots(newSelected);
  };

  const handleProposeSlots = async () => {
    if (selectedSlots.size === 0) {
      setError('Please select at least one slot');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const slotArray = Array.from(selectedSlots);
      const response = isRoundMatch
        ? await tournamentSchedulingService.proposeRoundMatchSlots(
            tournamentId,
            targetId!,
            slotArray,
            notes || undefined
          )
        : await tournamentSchedulingService.proposeMatchSlots(
            tournamentId,
            targetId!,
            slotArray,
            notes || undefined
          );

      if (response.success) {
        onSuccess?.();
        onClose();
      }
    } catch (err) {
      console.error('Error proposing slots:', err);
      setError('Failed to propose slots');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSlots = async () => {
    if (selectedSlots.size === 0) {
      setError('Please select at least one slot');
      return;
    }

    if (!proposal) {
      setError('No proposal to confirm');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const slotArray = Array.from(selectedSlots);
      const response = isRoundMatch
        ? await tournamentSchedulingService.confirmRoundMatchSlots(tournamentId, targetId!, slotArray)
        : await tournamentSchedulingService.confirmMatchSlots(tournamentId, targetId!, slotArray);

      if (response.success) {
        onSuccess?.();
        onClose();
      }
    } catch (err) {
      console.error('Error confirming slots:', err);
      setError('Failed to confirm slots');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const dateStart = new Date();
  const dateEnd = new Date(dateStart);
  dateEnd.setDate(dateEnd.getDate() + 14); // 14-day window

  const proposedSlotDatetimes = proposal?.slots.map(s => s.slot_datetime) || [];
  const confirmedSlotsMap: Record<string, string[]> = {};

  if (proposal?.confirmations) {
    Object.entries(proposal.confirmations).forEach(([slotId, confirmations]) => {
      confirmedSlotsMap[slotId] = confirmations.map((c: any) => c.user_id);
    });
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6">
          <div className="flex justify-between items-start">
            <h2 className="text-2xl font-bold text-gray-800">
              {mode === 'propose' ? 'Propose Match Schedule' : 'Confirm Schedule'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            >
              ✕
            </button>
          </div>
          {error && (
            <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {loading && participants.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Loading scheduling data...</p>
            </div>
          ) : (
            <>
              {/* Grid */}
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-800">Availability Grid</h3>
                <SchedulingFreeBusyGrid
                  participants={participants}
                  dateStart={dateStart}
                  dateEnd={dateEnd}
                  selectedSlots={selectedSlots}
                  onSlotToggle={handleSlotToggle}
                  readOnly={mode === 'confirm' && !proposal}
                  proposedSlots={proposedSlotDatetimes}
                  confirmedSlots={confirmedSlotsMap}
                />
              </div>

              {/* Selected slots summary */}
              {selectedSlots.size > 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-sm font-semibold text-blue-900">
                    {selectedSlots.size} slot{selectedSlots.size !== 1 ? 's' : ''} selected
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {Array.from(selectedSlots).map(slot => (
                      <div key={slot} className="text-xs text-blue-800">
                        {new Date(slot).toLocaleString()}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Proposal info (if responding) */}
              {proposal && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
                  <p className="text-sm font-semibold text-yellow-900">Active Proposal</p>
                  <p className="text-xs text-yellow-800 mt-1">
                    Proposed {new Date(proposal.proposed_at).toLocaleString()}
                  </p>
                  {proposal.notes && (
                    <p className="text-xs text-yellow-800 mt-2 italic">
                      Notes: {proposal.notes}
                    </p>
                  )}
                </div>
              )}

              {/* Notes textarea */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-800">
                  Notes (optional, max 500 characters)
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value.slice(0, 500))}
                  placeholder="Add any notes about your availability or preferences..."
                  className="w-full p-3 border border-gray-300 rounded text-sm font-mono"
                  rows={3}
                  disabled={loading}
                />
                <p className="text-xs text-gray-500">{notes.length}/500</p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 space-y-3">
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
              disabled={loading}
            >
              Cancel
            </button>

            {mode === 'propose' ? (
              <button
                onClick={handleProposeSlots}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50"
                disabled={loading || selectedSlots.size === 0}
              >
                {loading ? 'Proposing...' : 'Propose Selected Slots'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => {
                    setMode('counter');
                    setSelectedSlots(new Set());
                  }}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
                  disabled={loading}
                >
                  Counter-propose
                </button>
                <button
                  onClick={handleConfirmSlots}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium disabled:opacity-50"
                  disabled={loading || selectedSlots.size === 0}
                >
                  {loading ? 'Confirming...' : 'Confirm Selected Slots'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
