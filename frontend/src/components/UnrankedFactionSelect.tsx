import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface UnrankedFactionSelectProps {
  selectedFactionIds: string[];
  onChange: (factionIds: string[]) => void;
  disabled?: boolean;
  tournamentId?: string;
  isRankedOnly?: boolean;
}

interface Faction {
  id: string;
  name: string;
  is_ranked: boolean;
  created_at: string;
  used_in_tournaments: string | number;
}

interface ApiResponse {
  success: boolean;
  data?: Faction[];
  error?: string;
}

export const UnrankedFactionSelect: React.FC<UnrankedFactionSelectProps> = ({
  selectedFactionIds,
  onChange,
  disabled = false,
  tournamentId,
  isRankedOnly = false
}) => {
  const [factions, setFactions] = useState<Faction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newFactionName, setNewFactionName] = useState('');
  const [creatingFaction, setCreatingFaction] = useState(false);
  const [selectAll, setSelectAll] = useState(false);

  // Fetch unranked factions
  useEffect(() => {
    const fetchFactions = async () => {
      try {
        setLoading(true);
        const response = await api.get('/admin/unranked-factions');
        const data: ApiResponse = response.data;
        if (data.success && data.data) {
          // Filter by ranked status if isRankedOnly is true
          const filtered = isRankedOnly ? data.data.filter(f => f.is_ranked) : data.data;
          setFactions(filtered);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch factions');
      } finally {
        setLoading(false);
      }
    };

    fetchFactions();
  }, [isRankedOnly]);

  // Track select all state
  useEffect(() => {
    if (factions.length > 0) {
      setSelectAll(selectedFactionIds.length === factions.length);
    }
  }, [selectedFactionIds, factions.length]);

  const handleFactionSelect = (factionId: string) => {
    if (selectedFactionIds.includes(factionId)) {
      onChange(selectedFactionIds.filter(id => id !== factionId));
    } else {
      onChange([...selectedFactionIds, factionId]);
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      onChange([]);
    } else {
      onChange(factions.map(f => f.id));
    }
  };

  const handleCreateFaction = async () => {
    if (!newFactionName.trim()) {
      alert('Please enter a faction name');
      return;
    }

    try {
      setCreatingFaction(true);
      const response = await api.post('/admin/unranked-factions', { 
        name: newFactionName.trim() 
      });

      const data = response.data;

      // Add new faction to list
      setFactions([...factions, data.data]);

      // Auto-select the new faction
      onChange([...selectedFactionIds, data.data.id]);

      // Reset form
      setNewFactionName('');
      setShowModal(false);
    } catch (err: any) {
      alert(err.response?.data?.error || (err instanceof Error ? err.message : 'Error creating faction'));
    } finally {
      setCreatingFaction(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[200px] text-gray-600 text-sm">Loading factions...</div>;
  }

  return (
    <div className="flex flex-col h-full min-h-[26rem] max-h-[66vh] bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
      <div className="flex flex-col h-full gap-0">
        <div className="flex justify-between items-center px-4 py-3 bg-gradient-to-r from-purple-700 to-indigo-500 border-b border-gray-200 text-white font-semibold flex-shrink-0">
          <h4 className="text-sm font-semibold">Factions</h4>
          <span className="text-xs">{selectedFactionIds.length} / {factions.length}</span>
        </div>

        {error && <div className="text-red-600 px-4 py-2 bg-red-50">{error}</div>}

        {factions.length === 0 ? (
          <div className="text-gray-500 px-4 py-3">No factions available</div>
        ) : (
          <>
            <div className="px-4 py-2">
              <label className="flex items-center gap-2 py-2 border-b border-gray-200 font-semibold">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={handleSelectAll}
                  disabled={disabled}
                  className="w-4 h-4 cursor-pointer"
                />
                <span className="text-sm">Select All</span>
              </label>
            </div>

            <div className="overflow-y-auto flex-1">
              {factions.map((faction) => (
                <label key={faction.id} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
                  <input
                    type="checkbox"
                    checked={selectedFactionIds.includes(faction.id)}
                    onChange={() => handleFactionSelect(faction.id)}
                    disabled={disabled}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm">{faction.name}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {!isRankedOnly && (
          <button
            className="m-3 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold text-sm disabled:opacity-50"
            onClick={() => setShowModal(true)}
            disabled={disabled}
            type="button"
          >
            + New Faction
          </button>
        )}
      </div>

      {!isRankedOnly && showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-lg shadow-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-4">Create New Faction</h3>

            <input
              type="text"
              placeholder="Faction Name"
              value={newFactionName}
              onChange={(e) => setNewFactionName(e.target.value)}
              disabled={creatingFaction}
              maxLength={100}
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowModal(false)}
                disabled={creatingFaction}
                type="button"
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFaction}
                disabled={creatingFaction || !newFactionName.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                type="button"
              >
                {creatingFaction ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnrankedFactionSelect;
