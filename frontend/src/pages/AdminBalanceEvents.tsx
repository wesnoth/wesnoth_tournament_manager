import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { statisticsService } from '../services/statisticsService';
import api from '../services/api';
import UserProfileNav from '../components/UserProfileNav';
import { useAuthStore } from '../store/authStore';
import i18next from 'i18next';

interface Faction {
  id: string;
  name: string;
}

interface GameMap {
  id: string;
  name: string;
}

interface BalanceEvent {
  id: string;
  event_date: string;
  event_type: string;
  description: string;
  faction_id?: string | null;
  faction_name?: string | null;
  map_id?: string | null;
  map_name?: string | null;
  patch_version?: string | null;
  notes?: string | null;
}

const formatEventDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(i18next.language);
};

const AdminBalanceEvents: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin } = useAuthStore();
  const [formData, setFormData] = useState({
    event_date: new Date().toISOString().split('T')[0],
    event_type: 'NERF' as const,
    description: '',
    faction_id: '',
    map_id: '',
    patch_version: '',
    notes: '',
  });

  const [factions, setFactions] = useState<Faction[]>([]);
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [events, setEvents] = useState<BalanceEvent[]>([]);
  const [recalculatingSnapshots, setRecalculatingSnapshots] = useState(false);
  const [snapshotSuccess, setSnapshotSuccess] = useState('');
  const [snapshotError, setSnapshotError] = useState('');
  const [snapshotProgress, setSnapshotProgress] = useState<{ current: number; total: number } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      navigate('/');
      return;
    }

    const loadData = async () => {
      try {
        const [factionsResponse, mapsResponse, eventsData] = await Promise.all([
          api.get('/public/factions'),
          api.get('/public/maps'),
          statisticsService.getBalanceEvents({ limit: 100 }),
        ]);
        
        setFactions(factionsResponse.data);
        setMaps(mapsResponse.data);
        setEvents(eventsData);
      } catch (err) {
        console.error('Error loading data:', err);
      }
    };
    loadData();
  }, [isAuthenticated, isAdmin, navigate]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value === '' ? '' : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const eventData = {
        ...formData,
        faction_id: formData.faction_id || undefined,
        map_id: formData.map_id || undefined,
        patch_version: formData.patch_version || undefined,
        notes: formData.notes || undefined,
      };

      if (editingEventId) {
        // Update existing event
        await statisticsService.updateBalanceEvent(editingEventId, eventData as any);
        setSuccess(t('balance_event_updated_success'));
        setEditingEventId(null);
      } else {
        // Create new event
        await statisticsService.createBalanceEvent(eventData as any);
        setSuccess(t('balance_event_created_success'));
      }

      setFormData({
        event_date: new Date().toISOString().split('T')[0],
        event_type: 'NERF',
        description: '',
        faction_id: '',
        map_id: '',
        patch_version: '',
        notes: '',
      });

      setShowModal(false);

      // Reload events
      const updatedEvents = await statisticsService.getBalanceEvents({ limit: 100 });
      setEvents(updatedEvents);
    } catch (err: any) {
      const errorMsg = editingEventId 
        ? (err.response?.data?.error || t('error_updating_balance_event'))
        : (err.response?.data?.error || t('error_creating_balance_event'));
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleEditEvent = (event: any) => {
    setFormData({
      event_date: event.event_date.split('T')[0],
      event_type: event.event_type,
      description: event.description,
      faction_id: event.faction_id || '',
      map_id: event.map_id || '',
      patch_version: event.patch_version || '',
      notes: event.notes || '',
    });
    setEditingEventId(event.id);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingEventId(null);
    setFormData({
      event_date: new Date().toISOString().split('T')[0],
      event_type: 'NERF',
      description: '',
      faction_id: '',
      map_id: '',
      patch_version: '',
      notes: '',
    });
    setError('');
    setSuccess('');
  };

  /**
   * Queue the full balance history rebuild and follow it until it ends.
   *
   * The rebuild runs as a background job (202 + job id) because it rewrites
   * every daily snapshot date. When one is already running, the 409 carries
   * its id, so a click after a page reload follows that job instead of
   * failing. Polling every 2 s is enough for a job that takes seconds to
   * minutes; the job row is the source of truth, not this component.
   */
  const handleRecalculateSnapshots = async () => {
    setRecalculatingSnapshots(true);
    setSnapshotError('');
    setSnapshotSuccess('');
    setSnapshotProgress(null);

    try {
      let jobId: string;
      try {
        const response = await api.post('/admin/recalculate-snapshots');
        jobId = response.data.jobId;
      } catch (queueError: any) {
        if (queueError.response?.status !== 409 || !queueError.response?.data?.jobId) throw queueError;
        jobId = queueError.response.data.jobId;
      }

      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const { data: job } = await api.get(`/admin/recalculate-snapshots/${jobId}`);
        setSnapshotProgress({ current: job.progress_current, total: job.progress_total });
        if (job.status === 'completed') {
          setSnapshotSuccess(t('balance_history_rebuild_done', {
            dates: job.result_json?.dates_rebuilt ?? 0,
            rows: job.result_json?.snapshots_created ?? 0,
          }));
          break;
        }
        if (job.status === 'failed') {
          setSnapshotError(job.error_message || t('error_recalculating_snapshots'));
          break;
        }
      }
    } catch (err: any) {
      setSnapshotError(err.response?.data?.error || t('error_recalculating_snapshots'));
    } finally {
      setRecalculatingSnapshots(false);
      setSnapshotProgress(null);
    }
  };

  return (
    <>
      <UserProfileNav />
      <div data-help-id="region-balance-events-management" className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800">{t('admin_balance_events')}</h1>
        <button 
          data-help-id="action-open-balance-event-form"
          onClick={() => setShowModal(true)} 
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          title={t('add_new_event')}
        >
          + {t('add_event')}
        </button>
      </div>

      <div>
        {/* Recalculate Snapshots Button */}
        <div className="mb-6">
          <button 
            data-help-id="action-recalculate-balance-snapshots"
            type="button" 
            onClick={handleRecalculateSnapshots} 
            disabled={recalculatingSnapshots}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            title={t('recalculate_snapshots_tooltip')}
          >
            {recalculatingSnapshots 
              ? t('recalculating') 
              : t('recalculate_snapshots')
            }
          </button>
          {snapshotProgress && snapshotProgress.total > 0 && (
            <p role="status" className="mt-2 text-sm text-gray-700">
              {t('balance_history_rebuild_progress', { current: snapshotProgress.current, total: snapshotProgress.total })}
            </p>
          )}
        </div>

        {snapshotSuccess && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-4">{snapshotSuccess}</div>}
        {snapshotError && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4">{snapshotError}</div>}

        {/* Events Table */}
        {events.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">{t('no_balance_events')}</p>
          </div>
        ) : (
          <div data-help-id="region-balance-events-table" className="overflow-x-auto">
            <table className="w-full border-collapse bg-white shadow-md rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('date')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('event_type')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('description')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('faction')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('map')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('patch_version')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map(event => (
                  <tr data-help-id="region-balance-event-row" key={event.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{formatEventDate(event.event_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        event.event_type === 'BUFF' ? 'bg-green-100 text-green-800' :
                        event.event_type === 'NERF' ? 'bg-red-100 text-red-800' :
                        event.event_type === 'REWORK' ? 'bg-purple-100 text-purple-800' :
                        event.event_type === 'HOTFIX' ? 'bg-orange-100 text-orange-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {event.event_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700" title={event.description}>
                      {event.description.length > 50 ? event.description.substring(0, 50) + '...' : event.description}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{event.faction_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{event.map_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{event.patch_version || '-'}</td>
                    <td className="px-4 py-3">
                      <button 
                        data-help-id="action-edit-balance-event"
                        onClick={() => handleEditEvent(event)}
                        className="px-3 py-1 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600"
                        title={t('edit')}
                      >
                        ✎ {t('edit')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for Create/Edit Form */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleCloseModal}>
          <div data-help-id="region-balance-event-form" className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-gray-100 px-6 py-4 border-b border-gray-300 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-800">{editingEventId ? t('edit_balance_event') : t('create_balance_event')}</h2>
              <button data-help-id="action-close-balance-event-form" onClick={handleCloseModal} className="text-2xl text-gray-600 hover:text-gray-800">✕</button>
            </div>

            {success && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 m-4 rounded-lg">{success}</div>}
            {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 m-4 rounded-lg">{error}</div>}

            <form onSubmit={handleSubmit} className="p-6">
              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">{t('event_date')} *</label>
                <input
                  data-help-id="field-balance-event-date"
                  type="date"
                  name="event_date"
                  value={formData.event_date}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">{t('event_type')} *</label>
                <select
                  data-help-id="field-balance-event-type"
                  name="event_type"
                  value={formData.event_type}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="BUFF">{t('buff')}</option>
                  <option value="NERF">{t('nerf')}</option>
                  <option value="REWORK">{t('rework')}</option>
                  <option value="HOTFIX">{t('hotfix')}</option>
                  <option value="GENERAL_BALANCE_CHANGE">{t('general_balance_change')}</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">{t('description')} *</label>
                <textarea
                  data-help-id="field-balance-event-description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder={t('description_placeholder')}
                  required
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">{t('faction')} ({t('optional')})</label>
                  <select
                    data-help-id="field-balance-event-faction"
                    name="faction_id"
                    value={formData.faction_id}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="">--- {t('none')} ---</option>
                    {factions.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-2">{t('map')} ({t('optional')})</label>
                  <select
                    data-help-id="field-balance-event-map"
                    name="map_id"
                    value={formData.map_id}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="">--- {t('none')} ---</option>
                    {maps.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">{t('patch_version')} ({t('optional')})</label>
                  <input
                    data-help-id="field-balance-event-patch"
                    type="text"
                    name="patch_version"
                    value={formData.patch_version}
                    onChange={handleInputChange}
                    placeholder="e.g., 1.5.0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-2">{t('notes')} ({t('optional')})</label>
                  <input
                    data-help-id="field-balance-event-notes"
                    type="text"
                    name="notes"
                    value={formData.notes}
                    onChange={handleInputChange}
                    placeholder={t('additional_notes')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button data-help-id="action-cancel-balance-event-form" type="button" onClick={handleCloseModal} className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600">
                  {t('cancel')}
                </button>
                <button data-help-id="action-submit-balance-event-form" type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {loading 
                    ? (editingEventId ? t('updating') : t('creating')) 
                    : (editingEventId ? t('update_event') : t('create_event'))
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default AdminBalanceEvents;
