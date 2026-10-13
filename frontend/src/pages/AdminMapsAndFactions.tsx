/** Administrative CRUD UI for canonical maps, factions, and their translations. */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import MainLayout from '../components/MainLayout';
import AdminMapPacksPanel from '../components/AdminMapPacksPanel';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

interface Map {
  id: string;
  name: string;
  is_active: boolean;
  is_ranked: boolean;
  created_at: string;
}

interface Faction {
  id: string;
  name: string;
  is_active: boolean;
  is_ranked: boolean;
  created_at: string;
}

type LangData = { name: string; description: string };
type LangFormData = Record<string, LangData>;

const LANGUAGES = ['en', 'es', 'de', 'zh', 'ru'];
const LANG_LABELS: Record<string, string> = { en: 'English', es: 'Español', de: 'Deutsch', zh: '中文', ru: 'Русский' };

const emptyLangForm = (): LangFormData =>
  Object.fromEntries(LANGUAGES.map(l => [l, { name: '', description: '' }]));

// Defined outside the parent component to avoid remounting on every render (which would lose focus)
const LangForm: React.FC<{
  langData: LangFormData; setLangData: (d: LangFormData) => void;
  activeTab: string; setActiveTab: (l: string) => void;
  flags: { is_active: boolean; is_ranked: boolean };
  setFlags: (f: { is_active: boolean; is_ranked: boolean }) => void;
  onSubmit: (e: React.FormEvent) => void; onCancel: () => void;
  editingId: string | null;
  /** Selects the per-entity sentences: word gender differs between languages, so no shared template. */
  entity: 'map' | 'faction';
}> = ({ langData, setLangData, activeTab, setActiveTab, flags, setFlags, onSubmit, onCancel, editingId, entity }) => {
  const { t } = useTranslation();
  return (
  <form onSubmit={onSubmit} className="bg-white rounded-lg shadow-md p-6 mb-6">
    {/* Language tabs */}
    <div className="flex border-b border-gray-300 mb-4 flex-wrap gap-1">
      {LANGUAGES.map(lang => (
        <button key={lang} type="button"
          className={`px-3 py-2 font-semibold border-b-2 text-sm ${
            activeTab === lang ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-800'
          }`}
          onClick={() => setActiveTab(lang)}
        >
          {LANG_LABELS[lang]}
          {langData[lang].name && <span className="ml-1 text-green-500 text-xs">✓</span>}
        </button>
      ))}
    </div>

    {/* Language content */}
    <div className="mb-4">
      <label className="block text-gray-700 font-semibold mb-1 text-sm">
        {t('maps_admin.name_label')} {activeTab === 'en' ? '*' : t('maps_admin.optional_suffix')}
      </label>
      <input type="text" required={activeTab === 'en'}
        value={langData[activeTab].name}
        onChange={e => setLangData({ ...langData, [activeTab]: { ...langData[activeTab], name: e.target.value } })}
        placeholder={activeTab === 'en' ? t(`maps_admin.${entity}_name_required`) : t(`maps_admin.${entity}_name_in`, { language: LANG_LABELS[activeTab] })}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
      />
    </div>
    <div className="mb-4">
      <label className="block text-gray-700 font-semibold mb-1 text-sm">{t('maps_admin.description_optional')}</label>
      <textarea rows={2}
        value={langData[activeTab].description}
        onChange={e => setLangData({ ...langData, [activeTab]: { ...langData[activeTab], description: e.target.value } })}
        placeholder={t('maps_admin.description_in', { language: LANG_LABELS[activeTab] })}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
      />
    </div>

    {/* Flags */}
    <div className="flex gap-5 mb-5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={flags.is_active}
          onChange={e => setFlags({ ...flags, is_active: e.target.checked })} className="w-4 h-4" />
        {t('maps_admin.is_active')}
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={flags.is_ranked}
          onChange={e => setFlags({ ...flags, is_ranked: e.target.checked })} className="w-4 h-4" />
        {t('maps_admin.is_ranked')}
      </label>
    </div>

    <div className="flex gap-2">
      <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
        {editingId ? t(`maps_admin.update_${entity}`) : t(`maps_admin.add_${entity}`)}
      </button>
      <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
        {t('common.cancel')}
      </button>
    </div>
  </form>
  );
};

const AdminMapsAndFactions: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, isTournamentModerator } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'maps' | 'factions' | 'map-packs'>(isAdmin ? 'maps' : 'map-packs');
  const [maps, setMaps] = useState<Map[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Map form
  const [showMapForm, setShowMapForm] = useState(false);
  const [editingMapId, setEditingMapId] = useState<string | null>(null);
  const [mapLangTab, setMapLangTab] = useState('en');
  const [mapLangData, setMapLangData] = useState<LangFormData>(emptyLangForm());
  const [mapFlags, setMapFlags] = useState({ is_active: true, is_ranked: true });

  // Faction form
  const [showFactionForm, setShowFactionForm] = useState(false);
  const [editingFactionId, setEditingFactionId] = useState<string | null>(null);
  const [factionLangTab, setFactionLangTab] = useState('en');
  const [factionLangData, setFactionLangData] = useState<LangFormData>(emptyLangForm());
  const [factionFlags, setFactionFlags] = useState({ is_active: true, is_ranked: true });

  useEffect(() => {
    if (!isAuthenticated || (!isAdmin && !isTournamentModerator)) { navigate('/'); return; }
    fetchData();
  }, [isAuthenticated, isAdmin, isTournamentModerator, navigate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      if (!isAdmin) {
        setMaps([]);
        setFactions([]);
        return;
      }
      const [mapsRes, factionsRes] = await Promise.all([
        api.get('/admin/maps'),
        api.get('/admin/factions'),
      ]);
      setMaps(mapsRes.data || []);
      setFactions(factionsRes.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || t('maps_admin.load_failed'));
    } finally {
      setLoading(false);
    }
  };

  // ── MAP handlers ──────────────────────────────────────────────

  const resetMapForm = () => {
    setMapLangData(emptyLangForm());
    setMapFlags({ is_active: true, is_ranked: true });
    setEditingMapId(null);
    setMapLangTab('en');
    setShowMapForm(false);
  };

  const handleEditMap = async (map: Map) => {
    setEditingMapId(map.id);
    setMapFlags({ is_active: map.is_active, is_ranked: map.is_ranked });
    const langData = emptyLangForm();
    try {
      const res = await api.get(`/admin/maps/${map.id}/translations`);
      (res.data || []).forEach((t: any) => {
        if (langData[t.language_code] !== undefined) {
          langData[t.language_code] = { name: t.name || '', description: t.description || '' };
        }
      });
    } catch { /* leave empty */ }
    // Fallback: if no EN translation found, use the name stored in game_maps
    if (!langData.en.name) {
      langData.en = { name: map.name, description: '' };
    }
    setMapLangData(langData);
    setMapLangTab('en');
    setShowMapForm(true);
  };

  const handleMapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapLangData.en.name) { setError(t('maps_admin.english_name_required')); return; }
    try {
      setError('');
      let mapId = editingMapId;
      if (editingMapId) {
        await api.patch(`/admin/maps/${editingMapId}`, { ...mapFlags, name: mapLangData.en.name });
      } else {
        const res = await api.post('/admin/maps', {
          name: mapLangData.en.name,
          description: mapLangData.en.description || null,
          language_code: 'en',
          ...mapFlags,
        });
        mapId = res.data.id;
      }
      // Upsert all languages (for new map: other langs; for edit: all langs)
      const langsToSave = editingMapId ? LANGUAGES : LANGUAGES.filter(l => l !== 'en');
      for (const lang of langsToSave) {
        if (mapLangData[lang].name) {
          await api.post(`/admin/maps/${mapId}/translations`, {
            language_code: lang,
            name: mapLangData[lang].name,
            description: mapLangData[lang].description || null,
          });
        }
      }
      setSuccess(editingMapId ? t('maps_admin.map_updated') : t('maps_admin.map_added'));
      resetMapForm();
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.error || t('maps_admin.map_save_failed'));
    }
  };

  const handleToggleMapStatus = async (mapId: string, isActive: boolean) => {
    try {
      await api.patch(`/admin/maps/${mapId}`, { is_active: !isActive });
      setSuccess(t('maps_admin.map_status_updated'));
      fetchData();
    } catch (err: any) { setError(err.response?.data?.error || t('maps_admin.map_status_failed')); }
  };

  const handleDeleteMap = async (mapId: string) => {
    if (!window.confirm(t('maps_admin.confirm_delete_map'))) return;
    try {
      const response = await api.delete(`/admin/maps/${mapId}`);
      setSuccess(response.data?.deactivated ? response.data.message : t('maps_admin.map_deleted'));
      fetchData();
    } catch (err: any) { setError(err.response?.data?.error || t('maps_admin.map_delete_failed')); }
  };

  // ── FACTION handlers ──────────────────────────────────────────

  const resetFactionForm = () => {
    setFactionLangData(emptyLangForm());
    setFactionFlags({ is_active: true, is_ranked: true });
    setEditingFactionId(null);
    setFactionLangTab('en');
    setShowFactionForm(false);
  };

  const handleEditFaction = async (faction: Faction) => {
    setEditingFactionId(faction.id);
    setFactionFlags({ is_active: faction.is_active, is_ranked: faction.is_ranked });
    const langData = emptyLangForm();
    try {
      const res = await api.get(`/admin/factions/${faction.id}/translations`);
      (res.data || []).forEach((t: any) => {
        if (langData[t.language_code] !== undefined) {
          langData[t.language_code] = { name: t.name || '', description: t.description || '' };
        }
      });
    } catch { /* leave empty */ }
    // Fallback: if no EN translation found, use the name stored in factions
    if (!langData.en.name) {
      langData.en = { name: faction.name, description: '' };
    }
    setFactionLangData(langData);
    setFactionLangTab('en');
    setShowFactionForm(true);
  };

  const handleFactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factionLangData.en.name) { setError(t('maps_admin.english_name_required')); return; }
    try {
      setError('');
      let factionId = editingFactionId;
      if (editingFactionId) {
        await api.patch(`/admin/factions/${editingFactionId}`, { ...factionFlags, name: factionLangData.en.name });
      } else {
        const res = await api.post('/admin/factions', {
          name: factionLangData.en.name,
          description: factionLangData.en.description || null,
          language_code: 'en',
          ...factionFlags,
        });
        factionId = res.data.id;
      }
      const langsToSave = editingFactionId ? LANGUAGES : LANGUAGES.filter(l => l !== 'en');
      for (const lang of langsToSave) {
        if (factionLangData[lang].name) {
          await api.post(`/admin/factions/${factionId}/translations`, {
            language_code: lang,
            name: factionLangData[lang].name,
            description: factionLangData[lang].description || null,
          });
        }
      }
      setSuccess(editingFactionId ? t('maps_admin.faction_updated') : t('maps_admin.faction_added'));
      resetFactionForm();
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.error || t('maps_admin.faction_save_failed'));
    }
  };

  const handleToggleFactionStatus = async (factionId: string, isActive: boolean) => {
    try {
      await api.patch(`/admin/factions/${factionId}`, { is_active: !isActive });
      setSuccess(t('maps_admin.faction_status_updated'));
      fetchData();
    } catch (err: any) { setError(err.response?.data?.error || t('maps_admin.faction_status_failed')); }
  };

  const handleDeleteFaction = async (factionId: string) => {
    if (!window.confirm(t('maps_admin.confirm_delete_faction'))) return;
    try {
      const response = await api.delete(`/admin/factions/${factionId}`);
      setSuccess(response.data?.deactivated ? response.data.message : t('maps_admin.faction_deleted'));
      fetchData();
    } catch (err: any) { setError(err.response?.data?.error || t('maps_admin.faction_delete_failed')); }
  };

  // ── Reusable lang-tab form defined outside this component (above) to avoid remounting on each render

  if (loading) return <MainLayout><div className="max-w-6xl mx-auto px-4 py-8"><p className="text-center text-gray-600">{t('common.loading')}</p></div></MainLayout>;
  if (!isAuthenticated || (!isAdmin && !isTournamentModerator)) return <MainLayout><div className="max-w-6xl mx-auto px-4 py-8"><p className="text-center text-red-600">{t('maps_admin.access_denied')}</p></div></MainLayout>;

  return (
    <MainLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">{t('maps_admin.title')}</h1>

        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}
        {success && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-4">{success}</div>}

        <div className="flex border-b border-gray-300 mb-6">
          {(isAdmin ? ['maps', 'factions', 'map-packs'] as const : ['map-packs'] as const).map(tab => (
            <button key={tab}
              data-help-id={`action-tab-admin-${tab}`}
              className={`px-4 py-2 font-semibold border-b-2 capitalize ${
                activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'maps' ? t('maps_admin.tab_maps', { count: maps.length }) : tab === 'factions' ? t('maps_admin.tab_factions', { count: factions.length }) : t('map_packs_admin.title')}
            </button>
          ))}
        </div>

        {/* MAPS TAB */}
        {activeTab === 'maps' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-gray-800">{t('maps_admin.maps_title')}</h2>
              <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                onClick={() => { if (showMapForm) resetMapForm(); else setShowMapForm(true); }}>
                {showMapForm ? t('common.cancel') : t('maps_admin.add_map_button')}
              </button>
            </div>

            {showMapForm && (
              <LangForm
                langData={mapLangData} setLangData={setMapLangData}
                activeTab={mapLangTab} setActiveTab={setMapLangTab}
                flags={mapFlags} setFlags={setMapFlags}
                onSubmit={handleMapSubmit} onCancel={resetMapForm}
                editingId={editingMapId} entity="map"
              />
            )}

            <div className="space-y-3">
              {maps.length === 0 ? <p className="text-gray-600">{t('maps_admin.no_maps')}</p> : maps.map(map => (
                <div key={map.id} className={`bg-white rounded-lg shadow-md p-4 flex justify-between items-start border-l-4 ${map.is_active ? 'border-blue-500' : 'border-gray-400'}`}>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">{map.name}</h3>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${map.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {map.is_active ? t('maps_admin.active') : t('maps_admin.inactive')}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${map.is_ranked ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                        {map.is_ranked ? t('maps_admin.ranked') : t('maps_admin.unranked')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{t('maps_admin.created', { date: new Date(map.created_at).toLocaleDateString(i18next.language) })}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 ml-4">
                    <button className={`px-3 py-1 text-sm rounded-lg font-semibold ${map.is_active ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-500 text-white hover:bg-gray-600'}`}
                      onClick={() => handleToggleMapStatus(map.id, map.is_active)}>
                      {map.is_active ? t('maps_admin.active') : t('maps_admin.inactive')}
                    </button>
                    <button className="px-3 py-1 text-sm bg-yellow-500 text-black rounded-lg font-semibold hover:bg-yellow-600"
                      onClick={() => handleEditMap(map)}>{t('edit')}</button>
                    <button className="px-3 py-1 text-sm bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600"
                      onClick={() => handleDeleteMap(map.id)}>{t('btn_delete')}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FACTIONS TAB */}
        {activeTab === 'factions' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-gray-800">{t('maps_admin.factions_title')}</h2>
              <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                onClick={() => { if (showFactionForm) resetFactionForm(); else setShowFactionForm(true); }}>
                {showFactionForm ? t('common.cancel') : t('maps_admin.add_faction_button')}
              </button>
            </div>

            {showFactionForm && (
              <LangForm
                langData={factionLangData} setLangData={setFactionLangData}
                activeTab={factionLangTab} setActiveTab={setFactionLangTab}
                flags={factionFlags} setFlags={setFactionFlags}
                onSubmit={handleFactionSubmit} onCancel={resetFactionForm}
                editingId={editingFactionId} entity="faction"
              />
            )}

            <div className="space-y-3">
              {factions.length === 0 ? <p className="text-gray-600">{t('maps_admin.no_factions')}</p> : factions.map(faction => (
                <div key={faction.id} className={`bg-white rounded-lg shadow-md p-4 flex justify-between items-start border-l-4 ${faction.is_active ? 'border-blue-500' : 'border-gray-400'}`}>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">{faction.name}</h3>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${faction.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {faction.is_active ? t('maps_admin.active') : t('maps_admin.inactive')}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${faction.is_ranked ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                        {faction.is_ranked ? t('maps_admin.ranked') : t('maps_admin.unranked')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{t('maps_admin.created', { date: new Date(faction.created_at).toLocaleDateString(i18next.language) })}</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 ml-4">
                    <button className={`px-3 py-1 text-sm rounded-lg font-semibold ${faction.is_active ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-500 text-white hover:bg-gray-600'}`}
                      onClick={() => handleToggleFactionStatus(faction.id, faction.is_active)}>
                      {faction.is_active ? t('maps_admin.active') : t('maps_admin.inactive')}
                    </button>
                    <button className="px-3 py-1 text-sm bg-yellow-500 text-black rounded-lg font-semibold hover:bg-yellow-600"
                      onClick={() => handleEditFaction(faction)}>{t('edit')}</button>
                    <button className="px-3 py-1 text-sm bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600"
                      onClick={() => handleDeleteFaction(faction.id)}>{t('btn_delete')}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'map-packs' && <AdminMapPacksPanel />}
      </div>
    </MainLayout>
  );
};

export default AdminMapsAndFactions;
