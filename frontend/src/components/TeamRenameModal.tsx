import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tournamentService } from '../services/api';

interface TeamRenameModalProps {
  tournamentId: string;
  team: { id: string; name: string };
  onClose: () => void;
  /** Called after the backend accepted the new name; the modal does not close itself. */
  onRenamed: () => void;
  onError: (message: string) => void;
}

/** Rename a tournament team; the backend enforces who may rename and when. */
const TeamRenameModal: React.FC<TeamRenameModalProps> = ({ tournamentId, team, onClose, onRenamed, onError }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(team.name);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await tournamentService.renameTeam(tournamentId, team.id, name.trim());
      onRenamed();
    } catch (err: any) {
      onError(err.response?.data?.error || 'Failed to rename team');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Rename Team</h2>
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">New team name</label>
          <input
            data-help-id="field-team-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Enter team name"
            maxLength={64}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-3">
          <button
            data-help-id="action-cancel-rename-team"
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
            onClick={onClose}
          >
            {t('cancel_btn') || 'Cancel'}
          </button>
          <button
            data-help-id="action-save-team-name"
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            disabled={saving || !name.trim()}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TeamRenameModal;
