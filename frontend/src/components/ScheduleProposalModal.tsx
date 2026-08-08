import React, { useEffect, useState, useMemo, useDeferredValue, useRef, useCallback } from 'react';
import SchedulingFreeBusyGrid from './SchedulingFreeBusyGrid';
import { useAuthStore } from '../store/authStore';
import { tournamentSchedulingService } from '../services/tournamentSchedulingService';
import { p2pChallengesService } from '../services/p2pChallengesService';
import { groupSlotsIntoRanges, type GroupedTimeRange } from '../utils/slotGrouping';

interface ScheduleProposalModalProps {
  isOpen: boolean;
  tournamentId: string;
  seriesId?: string;
  roundMatchId?: string;
  matchId?: string;
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

export default function ScheduleProposalModal({
  isOpen,
  tournamentId,
  seriesId,
  roundMatchId,
  matchId,
  initialParticipants,
  initialProposal,
  initialViewingTimezone,
  initialDisplayDateStart,
  initialScrollToHour,
  onClose,
  onSuccess
}: ScheduleProposalModalProps) {
  const { userId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants || []);
  const [reservedSlots, setReservedSlots] = useState<Record<string, 'p2p' | 'tournament'>>({});
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

  const targetId = seriesId || roundMatchId || matchId;
  const isSeries = Boolean(seriesId);
  const isRoundMatch = !!roundMatchId;
  const hasConfirmedCurrentUser = Boolean(
    userId && proposal?.confirmations?.some((confirmation) => confirmation.user_id === userId)
  );

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

  // Block slots already used by any active P2P or tournament proposal involving
  // these participants, excluding the proposal currently being edited/responded to.
  useEffect(() => {
    if (!isOpen || participants.length === 0) return;
    let cancelled = false;

    p2pChallengesService
      .getOccupiedSlots(participants.map((participant) => participant.id), proposal?.id)
      .then((response) => {
        if (cancelled) return;
        const next: Record<string, 'p2p' | 'tournament'> = {};
        for (const conflict of response.conflicts || []) {
          next[new Date(conflict.slot_datetime).toISOString()] = conflict.source;
        }
        setReservedSlots(next);
      })
      .catch((error) => {
        console.error('Error loading occupied scheduling slots:', error);
        if (!cancelled) setReservedSlots({});
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, participants, proposal?.id]);

  // Initialize mode based on preloaded proposal data
  useEffect(() => {
    if (!isOpen) return;

    if (proposal) {
      // Check if current user is the proposer
      if (userId && proposal.proposed_by_user_id === userId) {
        setMode('edit_proposal');
        setSelectedSlots(new Set());
      } else {
        setMode('confirm');
        // Pre-select proposed slots for opponent to confirm or modify
        if (proposal.slots && !hasConfirmedCurrentUser) {
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
  }, [isOpen, proposal, userId, hasConfirmedCurrentUser]);

  const handleSlotToggle = useCallback((slotDatetime: string, selected: boolean) => {
    setSelectedSlots((prevSelected) => {
      const nextSelected = new Set(prevSelected);
      if (selected) {
        nextSelected.add(slotDatetime);
      } else {
        nextSelected.delete(slotDatetime);
      }
      return nextSelected;
    });
  }, []);

  /**
   * In confirm mode: first click deselects all others and keeps only this one
   * Subsequent clicks: normal toggle
   */
  const handleConfirmSlotToggle = useCallback((slotDatetime: string, selected: boolean) => {
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
  }, []);

  const handleProposeSlots = async () => {
    if (selectedSlots.size === 0) {
      setError('Please select at least one slot');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const slotArray = Array.from(selectedSlots);
      const response = mode === 'edit_proposal'
        ? await tournamentSchedulingService.modifyProposal(proposal!.id, slotArray, notes || undefined)
        : mode === 'counter'
        ? await tournamentSchedulingService.counterPropose(proposal!.id, slotArray, notes || undefined)
        : isSeries
        ? await tournamentSchedulingService.proposeSeriesSlots(
            tournamentId,
            targetId!,
            slotArray,
            notes || undefined
          )
        : isRoundMatch
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
    } catch (err: any) {
      console.error('Error proposing slots:', err);
      // Preserve localized 429 details, including the profile-timezone retry time.
      setError(err.response?.data?.error || 'Failed to propose slots');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSlots = async () => {
    if (!proposal) {
      setError('No proposal to confirm');
      return;
    }
    if (hasConfirmedCurrentUser) {
      setError('You have already confirmed this proposal');
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

      const response = isSeries
        ? await tournamentSchedulingService.confirmSeriesSlots(tournamentId, targetId!, proposal.id, slotIdsToSend)
        : isRoundMatch
        ? await tournamentSchedulingService.confirmRoundMatchSlots(tournamentId, targetId!, proposal.id, slotIdsToSend)
        : await tournamentSchedulingService.confirmMatchSlots(tournamentId, targetId!, proposal.id, slotIdsToSend);

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

  const handleCancelConfirmation = async () => {
    if (!proposal) return;
    try {
      setLoading(true);
      setError('');
      await tournamentSchedulingService.cancelConfirmation(proposal.id);
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error cancelling confirmation:', err);
      setError('Failed to cancel confirmation');
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

      await tournamentSchedulingService.cancelProposal(proposal.id);
      
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error canceling proposal:', err);
      setError('Failed to cancel proposal');
    } finally {
      setLoading(false);
    }
  };

  const handleRejectProposal = async () => {
    if (!proposal) {
      setError('No proposal to reject');
      return;
    }

    if (!confirm('Are you sure you want to reject this proposal?')) return;

    try {
      setLoading(true);
      setError('');
      await tournamentSchedulingService.rejectProposal(proposal.id, notes || undefined);
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error rejecting proposal:', err);
      setError('Failed to reject proposal');
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

  // Keep these hooks before the closed-state return so the hook order remains
  // identical when the modal opens and closes.
  const dateEnd = useMemo(() => {
    const end = new Date(displayDateStart);
    end.setDate(end.getDate() + 14);
    return end;
  }, [displayDateStart]);

  const proposedSlotDatetimes = useMemo(
    () => proposal?.slots?.map((slot) => slot.slot_datetime) || [],
    [proposal]
  );
  const confirmedSlotsMap = useMemo<Record<string, string[]>>(() => ({}), []);
  const minimumDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: viewingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div data-help-id="region-tournament-schedule-modal" className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6">
          <div className="flex justify-between items-start">
            <h2 className="text-2xl font-bold text-gray-800">
              {mode === 'propose' ? 'Propose Match Schedule' : mode === 'edit_proposal' ? 'Edit Schedule Proposal' : 'Confirm Schedule'}
            </h2>
            <button
              data-help-id="action-close-schedule-modal"
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
                    data-help-id="field-schedule-start-date"
                    type="date"
                    min={minimumDate}
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
                  proposedSlots={proposedSlotDatetimes}
                  confirmedSlots={confirmedSlotsMap}
                  reservedSlots={reservedSlots}
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
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-800">
                  Notes (optional, max 500 characters)
                </label>
                <textarea
                  data-help-id="field-schedule-notes"
                  value={notes}
                  onChange={handleNotesChange}
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
              data-help-id="action-cancel-schedule"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
              disabled={loading}
            >
              Cancel
            </button>

            {mode === 'propose' ? (
              <button
                data-help-id="action-propose-schedule"
                onClick={handleProposeSlots}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50"
                disabled={loading || selectedSlots.size === 0}
              >
                {loading ? 'Proposing...' : 'Propose Selected Slots'}
              </button>
            ) : mode === 'edit_proposal' ? (
              <>
                {hasConfirmedCurrentUser && (
                  <button
                    data-help-id="action-cancel-schedule-confirmation"
                    onClick={handleCancelConfirmation}
                    className="px-4 py-2 border border-orange-300 rounded hover:bg-orange-50 text-orange-700 font-medium"
                    disabled={loading}
                  >
                    Cancel Confirmation
                  </button>
                )}
                <button
                  data-help-id="action-cancel-schedule-proposal"
                  onClick={handleCancelProposal}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium"
                  disabled={loading}
                >
                  Cancel Proposal
                </button>
                <button
                  data-help-id="action-change-schedule-proposal"
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
                  data-help-id="action-reject-schedule-proposal"
                  onClick={handleRejectProposal}
                  className="px-4 py-2 border border-red-300 rounded hover:bg-red-50 text-red-700 font-medium"
                  disabled={loading}
                >
                  Reject Proposal
                </button>
                <button
                  data-help-id="action-counter-propose-schedule"
                  onClick={() => {
                    setMode('counter');
                    setSelectedSlots(new Set());
                  }}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
                  disabled={loading}
                >
                  Counter-propose
                </button>
                {!hasConfirmedCurrentUser && (
                  <button
                    data-help-id="action-confirm-schedule"
                    onClick={handleConfirmSlots}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium disabled:opacity-50"
                    disabled={loading || confirmedSlotIds.size === 0}
                  >
                    {loading ? 'Confirming...' : `Confirm ${confirmedSlotIds.size} Slot${confirmedSlotIds.size !== 1 ? 's' : ''}`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
