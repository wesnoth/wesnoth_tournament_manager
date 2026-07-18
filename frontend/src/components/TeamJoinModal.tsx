import React, { useState, useEffect } from 'react';
import { api, userService } from '../services/api';
import OpponentSelector from './OpponentSelector';

interface User {
  id: string;
  nickname: string;
  elo_rating?: number;
}

interface TeamJoinModalProps {
  tournamentId: string;
  onSubmit: (teamName: string, teammateName: string) => void;
  onClose: () => void;
  isLoading?: boolean;
  currentUserId?: string;
  currentUserNickname?: string;
  externalError?: string | null;
}

export const TeamJoinModal: React.FC<TeamJoinModalProps> = ({
  tournamentId,
  onSubmit,
  onClose,
  isLoading = false,
  currentUserId,
  currentUserNickname,
  externalError
}) => {
  const [teamName, setTeamName] = useState('');
  const [teammateId, setTeammateId] = useState('');
  const [teammateName, setTeammateName] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [existingTeams, setExistingTeams] = useState<Array<{id: string; name: string; member_count: number}>>([]);
  const [showTeamSuggestions, setShowTeamSuggestions] = useState(false);
  const [joinMode, setJoinMode] = useState<'create' | 'join'>('create');

  // Fetch existing teams with available slots
  useEffect(() => {
    const fetchExistingTeams = async () => {
      try {
        const response = await api.get(`/public/tournaments/${tournamentId}/teams`);
        const teams = response.data?.data || [];
        // Filter teams that have only 1 member (have an available slot)
        // Note: API returns member_count in snake_case
        const availableTeams = teams.filter((team: any) => team.member_count === 1);
        setExistingTeams(availableTeams);
      } catch {
        // If fetch fails, just show create-only mode
        setExistingTeams([]);
      }
    };
    if (tournamentId) {
      fetchExistingTeams();
    }
  }, [tournamentId]);

  // Update error when external error changes
  useEffect(() => {
    setError(externalError || null);
  }, [externalError]);

  // Search for teammate when typing
  const handleTeammateChange = (userId: string, user: User | null) => {
    setTeammateId(userId);
    setTeammateName(user?.nickname || '');
  };

  const handleSelectTeam = (team: any) => {
    setTeamName(team.name);
    setShowTeamSuggestions(false);
  };

  const handleTeamNameSearch = (value: string) => {
    setTeamName(value);
    
    if (value.length === 0) {
      setShowTeamSuggestions(false);
      return;
    }

    // Show teams that match the search
    const filtered = existingTeams.filter(t => 
      t.name.toLowerCase().includes(value.toLowerCase())
    );
    
    if (filtered.length > 0) {
      setShowTeamSuggestions(true);
    }
  };

  const handleSubmit = async () => {
    setError(null);

    // Validate team name
    if (!teamName.trim()) {
      setError('Please enter a team name');
      return;
    }
    if (teamName.length < 2) {
      setError('Team name must be at least 2 characters');
      return;
    }
    if (teamName.length > 50) {
      setError('Team name must be at most 50 characters');
      return;
    }

    // Teammate is optional now
    if (teammateName.trim()) {
      // Check not selecting self
      if (teammateName.toLowerCase() === currentUserNickname?.toLowerCase()) {
        setError('You cannot select yourself as teammate');
        return;
      }
      
      // Note: Don't validate if user exists here - let backend handle it
      // This allows writing the full nickname without selecting from list
    }

    try {
      // Pass empty string if no teammate selected
      onSubmit(teamName, joinMode === 'create' ? teammateName || '' : '');
    } catch (err: any) {
      setError(err.message || 'Failed to create team');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div data-help-id="region-team-tournament-join" className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Join Team Tournament</h2>
          <button data-help-id="action-close-team-tournament-join" className="text-gray-500 hover:text-gray-700 text-2xl leading-none" onClick={onClose}>&times;</button>
        </div>

        <div>
          {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}

          {/* Mode Tabs */}
          <div className="flex gap-2 mb-6 border-b border-gray-200">
            <button
              data-help-id="action-create-tournament-team"
              className={`px-4 py-2 font-medium transition-colors ${joinMode === 'create' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                onClick={() => { setJoinMode('create'); setError(null); setTeamName(''); setTeammateId(''); setTeammateName(''); }}
            >
              Create New Team
            </button>
            {existingTeams.length > 0 && (
              <button
                data-help-id="action-join-existing-tournament-team"
                className={`px-4 py-2 font-medium transition-colors ${joinMode === 'join' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                onClick={() => { setJoinMode('join'); setError(null); setTeamName(''); setTeammateId(''); setTeammateName(''); }}
              >
                Join Existing Team ({existingTeams.length})
              </button>
            )}
          </div>

          <div className="space-y-4">
            {joinMode === 'create' ? (
              <>
                {/* Create New Team Mode */}
                <div>
                  <label htmlFor="team-name" className="block text-sm font-medium text-gray-700 mb-2">Team Name *</label>
                  <input
                    data-help-id="field-tournament-team-name"
                    id="team-name"
                    type="text"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="Enter team name (e.g., Dragon Slayers)"
                    disabled={isLoading}
                    maxLength={50}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <small className="text-gray-600">You will be assigned Position 1</small>
                </div>

                {/* Teammate Selection - Optional */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Teammate <span className="text-gray-500 font-normal">(optional)</span></label>
                  <OpponentSelector
                    value={teammateId}
                    onChange={handleTeammateChange}
                    type="teammate"
                  />
                  <small className="text-gray-600">
                    {teammateName.trim() 
                      ? 'They will be added as Position 2 (pending confirmation)'
                      : 'Leave empty to register alone. Another player can join later.'
                    }
                  </small>
                </div>
              </>
            ) : (
              <>
                {/* Join Existing Team Mode */}
                <div>
                  <label htmlFor="existing-team-search" className="block text-sm font-medium text-gray-700 mb-2">Select Team to Join *</label>
                  <div className="relative">
                    <input
                      data-help-id="field-existing-tournament-team"
                      id="existing-team-search"
                      type="text"
                      value={teamName}
                      onChange={(e) => handleTeamNameSearch(e.target.value)}
                      onFocus={() => setShowTeamSuggestions(true)}
                      placeholder="Search for a team with an available slot..."
                      disabled={isLoading}
                      autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Team Suggestions */}
                  {showTeamSuggestions && existingTeams.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10">
                      {existingTeams
                        .filter(t => t.name.toLowerCase().includes(teamName.toLowerCase()))
                        .slice(0, 10)
                        .map((team) => (
                          <div
                            key={team.id}
                            className="px-3 py-2 hover:bg-gray-100 cursor-pointer flex justify-between items-center"
                            onClick={() => handleSelectTeam(team)}
                          >
                            <span className="font-medium">{team.name}</span>
                            <span className="text-sm text-gray-600">1/2 members</span>
                          </div>
                        ))}
                    </div>
                  )}

                  {showTeamSuggestions && teamName.trim() && 
                    existingTeams.filter(t => t.name.toLowerCase().includes(teamName.toLowerCase())).length === 0 && (
                    <div className="mt-2 p-2 bg-gray-100 text-gray-600 rounded text-sm">
                      No teams found with that name.
                    </div>
                  )}

                  <small className="text-gray-600">You will be added as Position 2</small>
                </div>

              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-6">
            <button
              data-help-id="action-cancel-team-tournament-join"
              className="flex-1 px-4 py-2 bg-gray-300 text-gray-900 rounded-lg font-medium hover:bg-gray-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              data-help-id="action-confirm-team-tournament-join"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSubmit}
              disabled={isLoading || !teamName.trim() || (joinMode === 'join' && !teamName.trim())}
            >
              {isLoading ? 'Joining...' : (joinMode === 'create' ? 'Create Team' : 'Join Team')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
