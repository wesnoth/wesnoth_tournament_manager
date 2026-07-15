import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

interface UnrankedMapSelectProps {
  selectedMapIds: string[];
  onChange: (mapIds: string[]) => void;
  disabled?: boolean;
  isRankedOnly?: boolean;
}

interface Map {
  id: string;
  name: string;
  is_ranked: boolean;
  width?: number;
  height?: number;
  created_at: string;
  used_in_tournaments: string | number;
}

interface ApiResponse {
  success: boolean;
  data?: Map[];
  error?: string;
}

export const UnrankedMapSelect: React.FC<UnrankedMapSelectProps> = ({
  selectedMapIds,
  onChange,
  disabled = false,
  isRankedOnly = false
}) => {
  const [maps, setMaps] = useState<Map[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newMapData, setNewMapData] = useState({
    name: ''
  });
  const [creatingMap, setCreatingMap] = useState(false);
  const [selectAll, setSelectAll] = useState(false);

  // Fetch unranked maps
  useEffect(() => {
    const fetchMaps = async () => {
      try {
        setLoading(true);
        const response = await api.get('/admin/unranked-maps');
        const data: ApiResponse = response.data;
        if (data.success && data.data) {
          // Filter by ranked status if isRankedOnly is true
          const filtered = isRankedOnly ? data.data.filter(m => m.is_ranked) : data.data;
          setMaps(filtered);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch maps');
      } finally {
        setLoading(false);
      }
    };

    fetchMaps();
  }, [isRankedOnly]);

  // Track select all state
  useEffect(() => {
    if (maps.length > 0) {
      setSelectAll(selectedMapIds.length === maps.length);
    }
  }, [selectedMapIds, maps.length]);

  const handleMapSelect = (mapId: string) => {
    if (selectedMapIds.includes(mapId)) {
      onChange(selectedMapIds.filter(id => id !== mapId));
    } else {
      onChange([...selectedMapIds, mapId]);
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      onChange([]);
    } else {
      onChange(maps.map(m => m.id));
    }
  };

  const handleCreateMap = async () => {
    if (!newMapData.name.trim()) {
      alert('Please enter a map name');
      return;
    }

    try {
      setCreatingMap(true);
      const response = await api.post('/admin/unranked-maps', {
        name: newMapData.name.trim()
      });

      const data = response.data;

      // Add new map to list
      setMaps([...maps, data.data]);

      // Auto-select the new map
      onChange([...selectedMapIds, data.data.id]);

      // Reset form
      setNewMapData({ name: '' });
      setShowModal(false);
    } catch (err: any) {
      alert(err.response?.data?.error || (err instanceof Error ? err.message : 'Error creating map'));
    } finally {
      setCreatingMap(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[200px] text-gray-600 text-sm">Loading maps...</div>;
  }

  return (
    <div data-help-id="region-tournament-maps" className="flex flex-col h-full min-h-[26rem] max-h-[66vh] bg-white border border-gray-300 rounded-lg overflow-hidden shadow-sm">
      <div className="flex flex-col h-full gap-0">
        <div className="flex justify-between items-center px-4 py-3 bg-gradient-to-r from-purple-700 to-indigo-500 border-b border-gray-200 text-white font-semibold flex-shrink-0">
          <h4 className="text-sm font-semibold">Maps</h4>
          <span className="text-xs">{selectedMapIds.length} / {maps.length}</span>
        </div>

        {error && <div className="text-red-600 px-4 py-2 bg-red-50">{error}</div>}

        {maps.length === 0 ? (
          <div className="text-gray-500 px-4 py-3">No maps available</div>
        ) : (
          <>
            <div className="px-4 py-2">
              <label className="flex items-center gap-2 py-2 border-b border-gray-200 font-semibold">
                <input
                  data-help-id="option-tournament-maps-all"
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
              {maps.map((map) => (
                <label key={map.id} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
                  <input
                    data-help-id="option-tournament-map"
                    type="checkbox"
                    checked={selectedMapIds.includes(map.id)}
                    onChange={() => handleMapSelect(map.id)}
                    disabled={disabled}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm flex-grow">{map.name}</span>
                  {map.width && map.height && (
                    <span className="text-xs text-gray-500 ml-auto">{map.width}×{map.height}</span>
                  )}
                </label>
              ))}
            </div>
          </>
        )}

        {!isRankedOnly && (
          <button
            data-help-id="action-create-tournament-map"
            className="m-3 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold text-sm disabled:opacity-50"
            onClick={() => setShowModal(true)}
            disabled={disabled}
            type="button"
          >
            + New Map
          </button>
        )}
      </div>

      {!isRankedOnly && showModal && (
        <div data-help-id="region-create-tournament-map" className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-lg shadow-lg p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold mb-4">Create New Map</h3>

            <input
              data-help-id="field-new-tournament-map-name"
              type="text"
              placeholder="Map Name"
              value={newMapData.name}
              onChange={(e) => setNewMapData({ ...newMapData, name: e.target.value })}
              disabled={creatingMap}
              maxLength={100}
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="flex gap-2 justify-end">
              <button
                data-help-id="action-cancel-create-tournament-map"
                onClick={() => setShowModal(false)}
                disabled={creatingMap}
                type="button"
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                data-help-id="action-confirm-create-tournament-map"
                onClick={handleCreateMap}
                disabled={creatingMap || !newMapData.name.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                type="button"
              >
                {creatingMap ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnrankedMapSelect;
