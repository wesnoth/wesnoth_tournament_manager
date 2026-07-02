import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ScheduleProposalModal from './ScheduleProposalModal';
import { challengeSchedulingService } from '../services/challengeSchedulingService';
import { publicService, userService } from '../services/api';
import { useAuthStore } from '../store/authStore';

interface UserOption {
  id: string;
  nickname: string;
}

interface Participant {
  id: string;
  nickname: string;
  timezone: string;
  availability_schedule?: Record<string, Array<{ start: string; end: string }>>;
}

interface P2PChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  preselectedOpponentId?: string;
}

const P2PChallengeModal: React.FC<P2PChallengeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  preselectedOpponentId,
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(preselectedOpponentId || null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [viewingTimezone, setViewingTimezone] = useState('UTC');
  const [dateStart, setDateStart] = useState<Date>(new Date());
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const loadUsers = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await userService.getAllUsers();
        const rows = response.data?.data || [];
        setUsers(
          rows
            .filter((u: any) => u.id && u.id !== userId)
            .map((u: any) => ({ id: u.id, nickname: u.nickname || u.id }))
        );
      } catch (err) {
        setError(t('events_modal_error_users') || 'Failed to load users');
      } finally {
        setLoading(false);
      }
    };

    loadUsers();
  }, [isOpen, t, userId]);

  useEffect(() => {
    if (!isOpen || !selectedOpponentId) return;

    const loadParticipants = async () => {
      try {
        setLoading(true);
        setError('');
        const [myProfile, opponentProfile] = await Promise.all([
          userService.getProfile(),
          publicService.getPlayerProfile(selectedOpponentId),
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
      } catch (err) {
        setError(t('events_modal_error_availability') || 'Failed to load players availability');
      } finally {
        setLoading(false);
      }
    };

    loadParticipants();
  }, [isOpen, selectedOpponentId, t]);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSelectedSlots(new Set());
    setNotes('');
    if (preselectedOpponentId) {
      setSelectedOpponentId(preselectedOpponentId);
    }
  }, [isOpen, preselectedOpponentId]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users.slice(0, 50);
    return users.filter((u) => u.nickname.toLowerCase().includes(q)).slice(0, 50);
  }, [users, search]);

  const selectedRanges = useMemo(
    () => groupSlotsIntoRanges(Array.from(selectedSlots)),
    [selectedSlots]
  );

  const dateEnd = useMemo(() => {
    const end = new Date(dateStart);
    end.setDate(end.getDate() + 14);
    return end;
  }, [dateStart]);

  const handleSlotToggle = (slotDatetime: string, selected: boolean) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (selected) next.add(slotDatetime);
      else next.delete(slotDatetime);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!selectedOpponentId) {
      setError(t('events_modal_error_opponent_required') || 'Please select an opponent');
      return;
    }
    if (selectedSlots.size === 0) {
      setError(t('events_modal_error_slots_required') || 'Please select at least one slot');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      await challengeSchedulingService.createProposal({
        challenged_user_id: selectedOpponentId,
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">{t('events_modal_title') || 'Challenge Player'}</h2>
          <button className="text-gray-600 hover:text-gray-900 text-2xl" onClick={onClose}>×</button>
        </div>

        <div className="p-6 space-y-5">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                {t('events_filter_players') || 'Players'}
              </label>
              <input
                className={`w-full px-3 py-2 border border-gray-300 rounded ${
                  preselectedOpponentId ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
                placeholder={t('events_modal_search_opponent') || 'Search opponent...'}
                value={search}
                onChange={(e) => !preselectedOpponentId && setSearch(e.target.value)}
                disabled={!!preselectedOpponentId}
              />
              <div className="mt-2 border rounded max-h-40 overflow-y-auto">
                {filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                      selectedOpponentId === u.id ? 'bg-blue-50 text-blue-700 font-semibold' : ''
                    } ${preselectedOpponentId ? 'cursor-not-allowed' : ''}`}
                    onClick={() => !preselectedOpponentId && setSelectedOpponentId(u.id)}
                    disabled={!!preselectedOpponentId}
                  >
                    {u.nickname}
                  </button>
                ))}
                {filteredUsers.length === 0 && (
                  <div className="px-3 py-2 text-sm text-gray-500">{t('common.noResults') || 'No results found'}</div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                {t('events_filter_start_date') || 'From date'}
              </label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-gray-300 rounded"
                value={dateStart.toISOString().split('T')[0]}
                onChange={(e) => setDateStart(new Date(e.target.value))}
              />
              <p className="text-xs text-gray-500 mt-2">
                {t('events_modal_timezone_viewing') || 'Viewing timezone'}: {viewingTimezone}
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1">
                {t('events_notes') || 'Notes'}
              </label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded"
                rows={3}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('events_notes_placeholder') || 'Optional notes...'}
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              {t('events_modal_availability_grid') || 'Availability Grid'}
            </h3>
            {loading ? (
              <div className="p-4 bg-gray-50 rounded text-gray-600">{t('loading')}</div>
            ) : (
              <SchedulingFreeBusyGrid
                participants={participants}
                dateStart={dateStart}
                dateEnd={dateEnd}
                selectedSlots={selectedSlots}
                onSlotToggle={handleSlotToggle}
                viewingTimezone={viewingTimezone}
              />
            )}
          </div>

          {selectedRanges.length > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded">
              <p className="font-semibold text-blue-900 text-sm mb-1">
                {t('events_modal_selected_slots') || 'Selected slots'}
              </p>
              <ul className="text-sm text-blue-800 list-disc list-inside">
                {selectedRanges.map((range, idx) => (
                  <li key={idx}>
                    {range.start.toLocaleString()} - {range.end.toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {t('button_cancel') || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || loading}
            className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? (t('creating') || 'Creating...') : (t('events_button_challenge') || 'Challenge')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default P2PChallengeModal;

