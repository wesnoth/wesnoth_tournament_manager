import React, { useEffect, useState } from 'react';
import { api } from '../services/api';

interface MapOption {
  id: string;
  name: string;
  is_active: boolean;
  is_ranked: boolean;
}

interface MapPack {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  maps: MapOption[];
}

const emptyForm = () => ({ name: '', description: '', is_active: true, map_ids: [] as string[] });

/** Administrative and moderator CRUD surface for reusable map collections. */
const AdminMapPacksPanel: React.FC = () => {
  const [packs, setPacks] = useState<MapPack[]>([]);
  const [maps, setMaps] = useState<MapOption[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const [packsResponse, mapsResponse] = await Promise.all([
        api.get('/admin/map-packs'),
        api.get('/admin/map-packs/maps'),
      ]);
      setPacks(packsResponse.data || []);
      setMaps(mapsResponse.data || []);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Failed to load map packs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const reset = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(false);
  };

  const edit = (pack: MapPack) => {
    setEditingId(pack.id);
    setForm({
      name: pack.name,
      description: pack.description || '',
      is_active: pack.is_active,
      map_ids: pack.maps.map(map => map.id),
    });
    setShowForm(true);
  };

  const toggleMap = (mapId: string) => {
    setForm(current => ({
      ...current,
      map_ids: current.map_ids.includes(mapId)
        ? current.map_ids.filter(id => id !== mapId)
        : [...current.map_ids, mapId],
    }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.name.trim().length < 2 || form.map_ids.length === 0) return;
    try {
      setSaving(true);
      setError('');
      if (editingId) await api.put(`/admin/map-packs/${editingId}`, form);
      else await api.post('/admin/map-packs', form);
      setMessage(editingId ? 'Map pack updated successfully' : 'Map pack created successfully');
      reset();
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Failed to save map pack');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (pack: MapPack) => {
    if (!window.confirm(`Delete map pack "${pack.name}"? This does not change any tournament.`)) return;
    try {
      setError('');
      await api.delete(`/admin/map-packs/${pack.id}`);
      setMessage('Map pack deleted successfully');
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Failed to delete map pack');
    }
  };

  if (loading) return <p className="text-gray-600">Loading map packs...</p>;

  return (
    <section data-help-id="region-admin-map-packs" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Map Packs</h2>
          <p className="text-sm text-gray-600">Reusable map collections for fast tournament setup.</p>
        </div>
        <button
          data-help-id="action-add-map-pack"
          type="button"
          onClick={() => showForm ? reset() : setShowForm(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ Add Map Pack'}
        </button>
      </div>

      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-red-700">{error}</p>}
      {message && <p className="rounded border border-green-300 bg-green-50 p-3 text-green-700">{message}</p>}

      {showForm && <form data-help-id="region-map-pack-editor" onSubmit={submit} className="space-y-4 rounded-lg border bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">Name
            <input
              data-help-id="field-map-pack-name"
              value={form.name}
              onChange={event => setForm({ ...form, name: event.target.value })}
              minLength={2}
              maxLength={100}
              required
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-gray-700">
            <input
              data-help-id="option-map-pack-active"
              type="checkbox"
              checked={form.is_active}
              onChange={event => setForm({ ...form, is_active: event.target.checked })}
            />
            Available in tournament setup
          </label>
        </div>
        <label className="block text-sm font-medium text-gray-700">Description
          <textarea
            data-help-id="field-map-pack-description"
            value={form.description}
            onChange={event => setForm({ ...form, description: event.target.value })}
            maxLength={500}
            rows={2}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-gray-700">Maps ({form.map_ids.length} selected)</legend>
          <div data-help-id="region-map-pack-maps" className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto rounded border p-3 md:grid-cols-2 lg:grid-cols-3">
            {maps.map(map => <label key={map.id} className={`flex items-center gap-2 rounded p-2 ${map.is_active ? 'hover:bg-gray-50' : 'bg-gray-100 text-gray-500'}`}>
              <input
                data-help-id="option-map-pack-map"
                type="checkbox"
                checked={form.map_ids.includes(map.id)}
                onChange={() => toggleMap(map.id)}
              />
              <span className="text-sm">{map.name}</span>
              {map.is_ranked && <span className="text-xs text-blue-700">Ranked</span>}
              {!map.is_active && <span className="text-xs">Inactive</span>}
            </label>)}
          </div>
        </fieldset>
        <div className="flex gap-2">
          <button
            data-help-id="action-save-map-pack"
            type="submit"
            disabled={saving || form.name.trim().length < 2 || form.map_ids.length === 0}
            className="rounded bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Saving...' : editingId ? 'Update Map Pack' : 'Create Map Pack'}
          </button>
          <button data-help-id="action-cancel-map-pack" type="button" onClick={reset} className="rounded bg-gray-200 px-4 py-2 text-gray-800">Cancel</button>
        </div>
      </form>}

      <div className="space-y-3">
        {packs.length === 0 ? <p className="text-gray-600">No map packs found.</p> : packs.map(pack => <article key={pack.id} className="rounded-lg border-l-4 border-purple-500 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">{pack.name}</h3>
              {pack.description && <p className="mt-1 text-sm text-gray-600">{pack.description}</p>}
              <p className="mt-2 text-sm text-gray-700">{pack.maps.map(map => map.name).join(', ')}</p>
              <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${pack.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                {pack.is_active ? 'Available' : 'Inactive'} · {pack.maps.length} maps
              </span>
            </div>
            <div className="flex items-start gap-2">
              <button data-help-id="action-edit-map-pack" type="button" onClick={() => edit(pack)} className="rounded bg-yellow-500 px-3 py-1 text-sm font-semibold text-black">Edit</button>
              <button data-help-id="action-delete-map-pack" type="button" onClick={() => remove(pack)} className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white">Delete</button>
            </div>
          </div>
        </article>)}
      </div>
    </section>
  );
};

export default AdminMapPacksPanel;
