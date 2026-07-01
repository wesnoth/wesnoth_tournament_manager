import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SchedulingFreeBusyGrid from './SchedulingFreeBusyGrid';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import { publicService } from '../services/api';
import { groupSlotsIntoRanges } from '../utils/slotGrouping';
import { useAuthStore } from '../store/authStore';

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface PlayerChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  opponentId: string;
  opponentNickname: string;
}

const PlayerChallengeModal: React.FC<PlayerChallengeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  opponentId,
  opponentNickname,
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [viewingTimezone, setViewingTimezone] = useState('UTC');
  const [dateStart, setDateStart] = useState<Date>(new Date());
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [userTimezone, setUserTimezone] = useState('UTC');

  useEffect(() => {
    if (!isOpen || !opponentId) return;

    const loadParticipants = async () => {
      try {
        setLoading(true);
        setError('');

        // Load current user and opponent
        const [userResponse, opponentResponse] = await Promise.all([
          publicService.getPlayerProfile(userId!),
          publicService.getPlayerProfile(opponentId),
        ]);

        const user = userResponse.data;
        const opponent = opponentResponse.data;

        if (user?.timezone) {
          setUserTimezone(user.timezone);
          setViewingTimezone(user.timezone);
        }

        setParticipants([
          {
            id: user?.id || userId!,
            nickname: user?.nickname || 'You',
            timezone: user?.timezone || 'UTC',
            availability_schedule: user?.availability_schedule,
          },
          {
            id: opponent?.id || opponentId,
            nickname: opponent?.nickname || opponentNickname,
            timezone: opponent?.timezone || 'UTC',
            availability_schedule: opponent?.availability_schedule,
          },
        ]);
      } catch (err) {
        setError(t('events_modal_error_availability') || 'Failed to load participant data');
      } finally {
        setLoading(false);
      }
    };

    loadParticipants();
  }, [isOpen, opponentId, userId, t, opponentNickname]);

  const handleSlotToggle = (slotDatetime: string, selected: boolean) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (selected) next.add(slotDatetime);
      else next.delete(slotDatetime);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedSlots.size === 0) {
      setError(t('events_modal_error_slots_required') || 'Please select at least one slot');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      await challengeSchedulingService.createProposal({
        challenged_user_id: opponentId,
        slot_datetimes: Array.from(selectedSlots),
        notes: notes || undefined,
        visibility: 'public',
      });
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || t('events_modal_error_submit') || 'Failed to create challenge');
    } finally {
      setSubmitting(false);
    }
  };

  const dateEnd = useMemo(() => {
    const end = new Date(dateStart);
    end.setDate(end.getDate() + 14);
    return end;
  }, [dateStart]);

  const selectedRanges = useMemo(
    () => groupSlotsIntoRanges(Array.from(selectedSlots)),
    [selectedSlots]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">
            {t('events_modal_title') || 'Challenge'} {opponentNickname}
          </h2>
          <button className="text-gray-600 hover:text-gray-900 text-2xl" onClick={onClose}>×</button>
        </div>

        <div className="p-6 space-y-5">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>}

          <div className="bg-blue-50 border-l-4 border-blue-500 p-3 rounded text-sm text-blue-800">
            <span className="font-semibold">{t('events_viewing_as') || 'Viewing as'}:</span> {userTimezone || 'UTC'}{' '}
            <span className="text-xs text-blue-600">
              ({t('events_viewing_note') || 'All times converted to your timezone'})
            </span>
          </div>

          {loading && (
            <div className="text-center text-gray-600 py-4">{t('loading')}</div>
          )}

          {!loading && participants.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    {t('events_modal_timezone_viewing') || 'Viewing timezone'}
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                    value={viewingTimezone}
                    onChange={(e) => setViewingTimezone(e.target.value)}
                  >
                    {participants.map((p) => (
                      <option key={p.id} value={p.timezone}>
                        {p.timezone} ({p.nickname})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    {t('events_modal_date_range') || 'Start date'}
                  </label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                    value={dateStart.toISOString().slice(0, 10)}
                    onChange={(e) => setDateStart(new Date(e.target.value))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    {t('events_modal_notes') || 'Notes'} {t('common.optional') || '(Optional)'}
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                    placeholder={t('events_notes_placeholder') || 'Optional notes...'}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">
                  {t('events_modal_availability_grid') || 'Availability Grid'}
                </label>
                <SchedulingFreeBusyGrid
                  dateStart={dateStart}
                  dateEnd={dateEnd}
                  participants={participants}
                  viewingTimezone={viewingTimezone}
                  selectedSlots={selectedSlots}
                  onSlotToggle={handleSlotToggle}
                />
              </div>

              {selectedRanges.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2">
                    {t('events_modal_selected_slots') || 'Selected slots'} ({selectedRanges.length})
                  </label>
                  <div className="bg-gray-50 p-3 rounded max-h-32 overflow-y-auto">
                    {selectedRanges.map((range, i) => (
                      <div key={i} className="text-sm text-gray-700">
                        {new Date(range.start).toLocaleString()} – {new Date(range.end).toLocaleTimeString()}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || selectedSlots.size === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 font-semibold"
                >
                  {submitting ? (t('common.submitting') || 'Submitting...') : (t('common.submit') || 'Submit')}
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400 font-semibold"
                >
                  {t('common.cancel') || 'Cancel'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerChallengeModal;
