import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ScheduleProposalModal from './ScheduleProposalModal';
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

interface ChallengeFromEventsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const ChallengeFromEventsModal: React.FC<ChallengeFromEventsModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const { userId } = useAuthStore();

  const [loading, setLoading] = useState(false);
  const [loadingOpponent, setLoadingOpponent] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [viewingTimezone, setViewingTimezone] = useState('UTC');
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Load all users for autocomplete
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
  }, [isOpen, userId, t]);

  // Load participant data when opponent selected
  useEffect(() => {
    if (!selectedOpponentId) return;

    const loadParticipants = async () => {
      try {
        setLoadingOpponent(true);
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

        // Auto-open schedule modal when opponent selected and data loaded
        setShowScheduleModal(true);
      } catch (err) {
        setError(t('events_modal_error_availability') || 'Failed to load players availability');
      } finally {
        setLoadingOpponent(false);
      }
    };

    loadParticipants();
  }, [selectedOpponentId, t]);

  // Filter users based on search
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return users.filter((u) => u.nickname.toLowerCase().includes(q)).slice(0, 10);
  }, [users, search]);

  const handleSelectOpponent = (opponentId: string) => {
    setSelectedOpponentId(opponentId);
    setSearch('');
  };

  const handleScheduleClose = () => {
    setShowScheduleModal(false);
    setSelectedOpponentId(null);
    setSearch('');
  };

  const handleScheduleSuccess = () => {
    setShowScheduleModal(false);
    setSelectedOpponentId(null);
    setSearch('');
    onClose();
    onSuccess?.();
  };

  if (!isOpen) return null;

  // Show autocomplete selection screen
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

          <div className="p-4 space-y-4">
            {/* Search Input */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                {t('events_modal_select_opponent') || 'Select Opponent'}
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder={t('events_modal_search_player') || 'Search player...'}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />

                {/* Autocomplete Dropdown */}
                {search.trim() && filteredUsers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                    {filteredUsers.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => handleSelectOpponent(user.id)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-semibold text-gray-800">{user.nickname}</div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No Results */}
                {search.trim() && filteredUsers.length === 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 p-3 text-center text-gray-500 text-sm">
                    {t('events_modal_no_players') || 'No players found'}
                  </div>
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Loading state */}
            {loadingOpponent && (
              <div className="p-3 text-center text-gray-600 text-sm">
                {t('loading')}...
              </div>
            )}
          </div>

          {/* Close Button */}
          <div className="border-t border-gray-200 p-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-semibold"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Schedule modal will render separately
  return (
    <ScheduleProposalModal
      isOpen={showScheduleModal}
      onClose={handleScheduleClose}
      onSuccess={handleScheduleSuccess}
      tournamentId=""
      roundMatchId=""
      initialParticipants={participants}
      initialViewingTimezone={viewingTimezone}
      initialDisplayDateStart={new Date()}
    />
  );
};

export default ChallengeFromEventsModal;
