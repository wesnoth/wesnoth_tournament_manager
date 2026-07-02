import React, { useEffect, useState, useMemo, useDeferredValue, useRef, useCallback } from 'react';
import SchedulingFreeBusyGrid from './SchedulingFreeBusyGrid';
import { useAuthStore } from '../store/authStore';
import { p2pChallengesService } from '../services/p2pChallengesService';
import { groupSlotsIntoRanges, type GroupedTimeRange } from '../utils/slotGrouping';

interface ScheduleProposalModalP2PProps {
  isOpen: boolean;
  opponentId: string;
  proposalId?: string; // For counter-propose/confirm flows
  // Preloaded data from parent
  initialParticipants?: Participant[];
  initialProposal?: ProposalData | null;
  initialViewingTimezone?: string;
  initialDisplayDateStart?: Date;
  initialScrollToHour?: number | null;
  onClose: () => void;
  onSuccess?: () => void;
}

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  timezone_offset?: string;
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

const useAsyncGroupedRanges = (slotDatetimes: string[]): GroupedTimeRange[] => {
  const deferredSlotDatetimes = useDeferredValue(slotDatetimes);
  const [ranges, setRanges] = useState<GroupedTimeRange[]>([]);

  useEffect(() => {
    let cancelled = false;

    const compute = () => {
      if (cancelled) return;
      setRanges(groupSlotsIntoRanges(deferredSlotDatetimes));
    };

    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof win.requestIdleCallback === 'function') {
      const handle = win.requestIdleCallback(compute, { timeout: 120 });
      return () => {
        cancelled = true;
        if (typeof win.cancelIdleCallback === 'function') {
          win.cancelIdleCallback(handle);
        }
      };
    }

    const timer = window.setTimeout(compute, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deferredSlotDatetimes]);

  return ranges;
};

export default function ScheduleProposalModalP2P({
  isOpen,
  opponentId,
  proposalId,
  initialParticipants,
  initialProposal,
  initialViewingTimezone,
  initialDisplayDateStart,
  initialScrollToHour,
  onClose,
  onSuccess
}: ScheduleProposalModalP2PProps) {
  const { userId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants || []);
  const [viewingTimezone, setViewingTimezone] = useState(initialViewingTimezone || 'UTC');
  const [proposal, setProposal] = useState<ProposalData | null>(initialProposal || null);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'propose' | 'confirm' | 'counter' | 'edit_proposal'>('propose');
  const [displayDateStart, setDisplayDateStart] = useState<Date>(initialDisplayDateStart || new Date());
  const [scrollToHour, setScrollToHour] = useState<number | null>(initialScrollToHour || null);
  // For slot-level confirmation: track which slots user has explicitly selected
  const [confirmedSlotIds, setConfirmedSlotIds] = useState<Set<string>>(new Set());
  const [hasStartedConfirmationSelection, setHasStartedConfirmationSelection] = useState(false);
  const hasStartedConfirmationSelectionRef = useRef(false);
  // For edit_proposal mode: track if user has clicked any slot yet
  const [hasStartedEditSelection, setHasStartedEditSelection] = useState(false);
  const hasStartedEditSelectionRef = useRef(false);

  // Update state when preloaded data props change
  useEffect(() => {
    if (!isOpen) return;
    
    if (initialParticipants) {
      setParticipants(initialParticipants);
    }
    
    if (initialViewingTimezone) {
      setViewingTimezone(initialViewingTimezone);
    }
    
    if (initialDisplayDateStart) {
      setDisplayDateStart(initialDisplayDateStart);
    }
    
    if (initialScrollToHour !== null && initialScrollToHour !== undefined) {
      setScrollToHour(initialScrollToHour);
    }
    
    if (initialProposal) {
      setProposal(initialProposal);
    } else {
      // Clear proposal data when opening modal for new schedule (no existing proposal)
      setProposal(null);
      setSelectedSlots(new Set());
    }
  }, [isOpen, initialParticipants, initialProposal, initialViewingTimezone, initialDisplayDateStart, initialScrollToHour]);

  // Initialize mode based on preloaded proposal data
  useEffect(() => {
    if (!isOpen) return;

    if (proposal) {
      // Check if current user is the proposer
      if (userId && proposal.proposed_by_user_id === userId) {
        setMode('edit_proposal');
        // Pre-fill with current slots so proposer can modify them
        if (proposal.slots) {
          const proposedSlotDatetimes = proposal.slots.map(s => s.slot_datetime);
          setSelectedSlots(new Set(proposedSlotDatetimes));
        } else {
          setSelectedSlots(new Set());
        }
        // Load existing notes for editing
        if (proposal.notes) {
          setNotes(proposal.notes);
        }
        // Reset edit selection flag - show original slots in blue
        hasStartedEditSelectionRef.current = false;
        setHasStartedEditSelection(false);
      } else {
        setMode('confirm');
        // Pre-select proposed slots for opponent to confirm or modify
        if (proposal.slots) {
          const proposedSlotDatetimes = proposal.slots.map(s => s.slot_datetime);
          // Initialize confirmedSlotIds with all proposed slots (all checked by default)
          setConfirmedSlotIds(new Set(proposedSlotDatetimes));
          setHasStartedConfirmationSelection(false);
          hasStartedConfirmationSelectionRef.current = false;
        }
      }
    } else {
      setMode('propose');
      setSelectedSlots(new Set());
      setHasStartedConfirmationSelection(false);
      hasStartedConfirmationSelectionRef.current = false;
    }
  }, [isOpen, proposal, userId]);

  const handleSlotToggle = (slotDatetime: string, selected: boolean) => {
    // In edit_proposal mode, first click triggers showing only selected slots
    if (mode === 'edit_proposal' && !hasStartedEditSelectionRef.current) {
      hasStartedEditSelectionRef.current = true;
      setHasStartedEditSelection(true);
    }
    
    setSelectedSlots((prevSelected) => {
      const nextSelected = new Set(prevSelected);
      if (selected) {
        nextSelected.add(slotDatetime);
      } else {
        nextSelected.delete(slotDatetime);
      }
      return nextSelected;
    });
  };

  /**
   * In confirm mode: first click deselects all others and keeps only this one
   * Subsequent clicks: normal toggle
   */
  const handleConfirmSlotToggle = (slotDatetime: string, selected: boolean) => {
    if (!hasStartedConfirmationSelectionRef.current) {
      // First click: clear all and select only this one
      hasStartedConfirmationSelectionRef.current = true;
      setHasStartedConfirmationSelection(true);
      setConfirmedSlotIds(new Set([slotDatetime]));
    } else {
      // Subsequent clicks: normal toggle
      setConfirmedSlotIds((prevConfirmed) => {
        const nextConfirmed = new Set(prevConfirmed);
        if (selected) {
          nextConfirmed.add(slotDatetime);
        } else {
          nextConfirmed.delete(slotDatetime);
        }
        return nextConfirmed;
      });
    }
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

      if (mode === 'counter') {
        // Counter-propose on existing proposal
        if (!proposal) {
          setError('No proposal to counter-propose');
          return;
        }
        const response = await p2pChallengesService.counterPropose(
          proposal.id,
          slotArray,
          notes || undefined,
          'private'
        );
        if (response.success || response.proposalId) {
          onSuccess?.();
          onClose();
        }
      } else if (mode === 'edit_proposal') {
        // Update existing proposal (proposer editing their own proposal)
        if (!proposal) {
          setError('No proposal to update');
          return;
        }
        const response = await p2pChallengesService.updateProposal(
          proposal.id,
          slotArray,
          notes || undefined
        );
        if (response.success) {
          onSuccess?.();
          onClose();
        }
      } else {
        // Initial challenge proposal
        const response = await p2pChallengesService.proposeChallenge(
          opponentId,
          slotArray,
          notes || undefined,
          'private'
        );

        if (response.success || response.proposalId) {
          onSuccess?.();
          onClose();
        }
      }
    } catch (err) {
      console.error('Error proposing challenge:', err);
      setError('Failed to propose challenge');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSlots = async () => {
    if (!proposal) {
      setError('No proposal to confirm');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Convert confirmed slot datetimes back to their slot IDs for backend
      let slotIdsToSend: string[] = [];
      if (mode === 'confirm') {
        // Map datetimes back to slot IDs from proposal
        slotIdsToSend = proposal.slots
          .filter(s => confirmedSlotIds.has(s.slot_datetime))
          .map(s => s.id);
      } else {
        // In propose mode, selectedSlots are datetimes, but we need to convert
        // This shouldn't happen for confirm, but handle it for consistency
        slotIdsToSend = proposal.slots
          .filter(s => selectedSlots.has(s.slot_datetime))
          .map(s => s.id);
      }

      const response = await p2pChallengesService.confirmSlots(proposal.id, slotIdsToSend);

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

  const handleCancelProposal = async () => {
    if (!proposal) {
      setError('No proposal to cancel');
      return;
    }

    if (!confirm('Are you sure you want to cancel this proposal?')) {
      return;
    }

    try {
      setLoading(true);
      setError('');

      await p2pChallengesService.cancelProposal(proposal.id);
      
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error canceling proposal:', err);
      setError('Failed to cancel proposal');
    } finally {
      setLoading(false);
    }
  };

  const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value.slice(0, 500));
  }, []);

  const selectedRangeDatetimes = useMemo(
    () => (mode === 'confirm' ? Array.from(confirmedSlotIds) : Array.from(selectedSlots)),
    [mode, confirmedSlotIds, selectedSlots]
  );
  const selectedRanges = useAsyncGroupedRanges(selectedRangeDatetimes);
  const proposalRanges = useMemo(
    () => (proposal?.slots?.length ? groupSlotsIntoRanges(proposal.slots.map(s => s.slot_datetime)) : []),
    [proposal]
  );
  const proposalStatusesByRange = useMemo(
    () =>
      proposalRanges.map((range) =>
        (proposal?.slots || [])
          .filter(s => {
            const slotDate = new Date(s.slot_datetime);
            return slotDate >= range.start && slotDate < range.end;
          })
          .map(s => s.status)
          .join(', ')
      ),
    [proposal, proposalRanges]
  );

  // Memoize formatted slot data to avoid expensive date calculations on every render
  if (!isOpen) return null;

  const dateEnd = new Date(displayDateStart);
  dateEnd.setDate(dateEnd.getDate() + 14); // 14-day window

  const proposedSlotDatetimes = proposal?.slots?.map(s => s.slot_datetime) || [];
  const confirmedSlotsMap: Record<string, string[]> = {};

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6">
          <div className="flex justify-between items-start">
            <h2 className="text-2xl font-bold text-gray-800">
              {mode === 'propose' ? 'Propose Match Schedule' : mode === 'edit_proposal' ? 'Edit Schedule Proposal' : 'Confirm Schedule'}
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
              {/* Date picker */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-800">Select Date Range Start</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={displayDateStart.toISOString().split('T')[0]}
                    onChange={(e) => setDisplayDateStart(new Date(e.target.value))}
                    className="px-3 py-2 border border-gray-300 rounded text-sm"
                  />
                  <span className="text-sm text-gray-500 self-center">
                    Next 14 days ({dateEnd.toLocaleDateString()})
                  </span>
                  <span className="text-sm text-gray-600 self-center font-semibold">
                    | Viewing: {viewingTimezone}
                  </span>
                </div>
              </div>

              {/* Grid */}
              <div className="space-y-2">
                <h3 className="font-semibold text-gray-800">Availability Grid</h3>
                <SchedulingFreeBusyGrid
                  participants={participants}
                  dateStart={displayDateStart}
                  dateEnd={dateEnd}
                  selectedSlots={mode === 'confirm' ? confirmedSlotIds : selectedSlots}
                  onSlotToggle={mode === 'confirm' ? handleConfirmSlotToggle : handleSlotToggle}
                  readOnly={false}
                  proposedSlots={mode === 'edit_proposal' && !hasStartedEditSelection ? proposedSlotDatetimes : []}
                  confirmedSlots={confirmedSlotsMap}
                  viewingTimezone={viewingTimezone}
                  scrollToHour={scrollToHour}
                  confirmMode={mode === 'confirm'}
                  hasStartedConfirmationSelection={hasStartedConfirmationSelection}
                />
              </div>

              {/* Selected slots summary */}
              {((mode === 'confirm' && confirmedSlotIds.size > 0) || (mode !== 'confirm' && selectedSlots.size > 0)) && (
                <div className={`p-3 rounded ${mode === 'confirm' ? 'bg-green-50 border border-green-200' : 'bg-blue-50 border border-blue-200'}`}>
                  <p className={`text-sm font-semibold ${mode === 'confirm' ? 'text-green-900' : 'text-blue-900'}`}>
                    {mode === 'confirm' 
                      ? `${confirmedSlotIds.size} slot${confirmedSlotIds.size !== 1 ? 's' : ''} to confirm` 
                      : `${selectedSlots.size} slot${selectedSlots.size !== 1 ? 's' : ''} selected`
                    }
                  </p>
                  <div className="mt-3 space-y-2">
                    {selectedRanges.map((range, idx) => (
                      <div key={idx} className={`text-sm p-2 bg-white rounded border ${mode === 'confirm' ? 'text-green-800 border-green-100' : 'text-blue-800 border-blue-100'}`}>
                        <div className="font-semibold">
                          {range.start.toLocaleDateString()} - {range.hours}
                        </div>
                        <div className="text-xs text-gray-600">
                          UTC: {range.start.toISOString()} to {range.end.toISOString()}
                        </div>
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
                  {proposal.slots && proposal.slots.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-yellow-900 mb-2">Proposed Slots:</p>
                      <div className="space-y-1">
                        {proposalRanges.map((range, idx) => (
                          <div key={idx} className="text-xs text-yellow-800 bg-white rounded px-2 py-1 border border-yellow-100">
                            <div className="font-semibold">
                              {range.start.toLocaleDateString()} - {range.hours}
                            </div>
                            <div className="text-xs text-gray-600">
                              ({proposalStatusesByRange[idx]})
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes textarea */}
              {mode === 'confirm' ? (
                // In confirm mode, show the proposer's notes as read-only
                proposal?.notes && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                    <p className="text-sm font-semibold text-blue-900">Proposer's Notes</p>
                    <p className="text-sm text-blue-800 mt-2 whitespace-pre-wrap">{proposal.notes}</p>
                  </div>
                )
              ) : (
                // In propose/edit mode, show textarea for editing notes
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-800">
                    Notes (optional, max 500 characters)
                  </label>
                  <textarea
                    value={notes}
                    onChange={handleNotesChange}
                    placeholder="Add any notes about your availability or preferences..."
                    className="w-full p-3 border border-gray-300 rounded text-sm font-mono"
                    rows={3}
                    disabled={loading}
                  />
                  <p className="text-xs text-gray-500">{notes.length}/500</p>
                </div>
              )}
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
            ) : mode === 'edit_proposal' ? (
              <>
                <button
                  onClick={handleCancelProposal}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium"
                  disabled={loading}
                >
                  Cancel Proposal
                </button>
                <button
                  onClick={handleProposeSlots}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50"
                  disabled={loading || selectedSlots.size === 0}
                >
                  {loading ? 'Updating...' : 'Change Proposal'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleCancelProposal}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium"
                  disabled={loading}
                >
                  {loading ? 'Rejecting...' : '❌ Reject'}
                </button>
                <button
                  onClick={() => {
                    setMode('counter');
                    setSelectedSlots(new Set());
                  }}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
                  disabled={loading}
                >
                  🔄 Counter-propose
                </button>
                <button
                  onClick={handleConfirmSlots}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium disabled:opacity-50"
                  disabled={loading || confirmedSlotIds.size === 0}
                >
                  {loading ? 'Confirming...' : `✅ Confirm ${confirmedSlotIds.size} Slot${confirmedSlotIds.size !== 1 ? 's' : ''}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
