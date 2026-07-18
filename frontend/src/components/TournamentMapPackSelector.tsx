import React, { useEffect, useState } from 'react';
import { api } from '../services/api';

interface MapPack {
  id: string;
  name: string;
  description?: string | null;
  maps: Array<{ id: string; name: string }>;
}

interface Props {
  selectedMapIds: string[];
  onChange: (mapIds: string[]) => void;
  rankedOnly?: boolean;
  disabled?: boolean;
}

/**
 * Apply a reusable map collection to the ordinary tournament map selection.
 * The selected pack ID is intentionally component-local: applying a pack
 * copies only its currently eligible map IDs and no pack identity is submitted
 * or persisted with the tournament.
 */
const TournamentMapPackSelector: React.FC<Props> = ({ selectedMapIds, onChange, rankedOnly = false, disabled = false }) => {
  const [packs, setPacks] = useState<MapPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get('/admin/map-packs/available', { params: { ranked_only: rankedOnly } })
      .then(response => {
        if (active) setPacks(response.data || []);
      })
      .catch((requestError: any) => {
        if (active) setError(requestError.response?.data?.error || 'Failed to load map packs');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [rankedOnly]);

  const selectedPack = packs.find(pack => pack.id === selectedPackId);
  const applyPack = () => {
    if (!selectedPack) return;
    // Replace rather than merge so the pack produces a predictable starting
    // selection. Individual checkboxes remain authoritative immediately after.
    onChange(selectedPack.maps.map(map => map.id));
    setSelectedPackId('');
  };

  return (
    <div data-help-id="region-tournament-map-pack-selector" className="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex-1 text-sm font-medium text-gray-700">
          Map Pack
          <select
            data-help-id="option-tournament-map-pack"
            value={selectedPackId}
            onChange={event => setSelectedPackId(event.target.value)}
            disabled={disabled || loading || packs.length === 0}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 disabled:bg-gray-100"
          >
            <option value="">{loading ? 'Loading map packs...' : packs.length ? 'Select a map pack' : 'No map packs available'}</option>
            {packs.map(pack => <option key={pack.id} value={pack.id}>{pack.name} ({pack.maps.length} maps)</option>)}
          </select>
        </label>
        <button
          data-help-id="action-apply-tournament-map-pack"
          type="button"
          onClick={applyPack}
          disabled={disabled || !selectedPack}
          className="rounded-md bg-purple-700 px-4 py-2 font-semibold text-white hover:bg-purple-800 disabled:opacity-50"
        >
          Apply Map Pack
        </button>
      </div>
      {selectedPack?.description && <p className="mt-2 text-sm text-gray-600">{selectedPack.description}</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <p className="mt-2 text-xs text-gray-600">
        Applying a pack replaces the current map checkboxes. You can then select or deselect individual maps; the pack itself is not saved with the tournament.
      </p>
      <span className="sr-only">{selectedMapIds.length} maps currently selected</span>
    </div>
  );
};

export default TournamentMapPackSelector;
