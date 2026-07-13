import React, { useState } from 'react';
import { api } from '../services/api';
import { useTranslation } from 'react-i18next';

interface TeamMember {
  participant_id: string;
  user_id: string;
  nickname: string;
  team_position?: number;
  participation_status?: string;
}

interface TeamReplacementModalProps {
  tournamentId: string;
  teamId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  teamMembers?: TeamMember[];
}

export const TeamReplacementModal: React.FC<TeamReplacementModalProps> = ({
  tournamentId,
  teamId,
  isOpen,
  onClose,
  onSuccess,
  teamMembers = []
}) => {
  const { t } = useTranslation();
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [newPlayerNickname, setNewPlayerNickname] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleConfirm = async () => {
    // Reset errors
    setError(null);
    setValidationError(null);

    // Validation
    if (!selectedMemberId) {
      setValidationError(t('Please select a team member to replace'));
      return;
    }

    if (!newPlayerNickname.trim()) {
      setValidationError(t('Please enter substitute player nickname'));
      return;
    }

    try {
      setLoading(true);
      const url = `/admin/tournaments/${tournamentId}/teams/${teamId}/replace-member`;
      const payload = {
        player_to_replace_id: selectedMemberId, // This is participant_id
        new_player_nickname: newPlayerNickname.trim()
      };
      
      const response = await api.post(url, payload);

      if (response.data.success) {
        // Reset form
        setSelectedMemberId('');
        setNewPlayerNickname('');
        
        // Call success callback
        onSuccess();
        onClose();
      } else {
        setError(response.data.error || t('Failed to initiate replacement'));
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || 
                           err.response?.data?.message || 
                           (err instanceof Error ? err.message : t('Failed to initiate replacement'));
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const selectedMember = teamMembers.find(m => m.participant_id === selectedMemberId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4 text-gray-800">
          {t('Replace Team Member')}
        </h2>

        {error && (
          <div className="bg-red-100 text-red-800 px-3 py-2 rounded text-sm mb-4">
            {error}
          </div>
        )}

        {validationError && (
          <div className="bg-yellow-100 text-yellow-800 px-3 py-2 rounded text-sm mb-4">
            {validationError}
          </div>
        )}

        <div className="space-y-4">
          {/* Select member to replace */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('Member to replace')} *
            </label>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-600"
            >
              <option value="">-- {t('Select team member')} --</option>
              {teamMembers
                .filter(m => m.participation_status === 'accepted')
                .map((member) => (
                  <option key={member.participant_id} value={member.participant_id}>
                    {member.nickname} (Pos: {member.team_position})
                  </option>
                ))}
            </select>
          </div>

          {/* Enter substitute nickname */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('Substitute player nickname')} *
            </label>
            <input
              type="text"
              value={newPlayerNickname}
              onChange={(e) => setNewPlayerNickname(e.target.value)}
              disabled={loading}
              placeholder={t('Enter player nickname')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100 disabled:text-gray-600"
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('The player will receive a notification and must confirm the replacement')}
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-600 font-medium transition-colors"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !selectedMemberId || !newPlayerNickname.trim()}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
          >
            {loading ? t('Processing...') : t('Confirm Replacement')}
          </button>
        </div>
      </div>
    </div>
  );
};
