import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { statisticsService } from '../services/statisticsService';
import api from '../services/api';
import UserProfileNav from '../components/UserProfileNav';
import { useAuthStore } from '../store/authStore';

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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
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
        setSuccess(t('balance_event_updated_success') || 'Balance event updated successfully');
        setEditingEventId(null);
      } else {
        // Create new event
        await statisticsService.createBalanceEvent(eventData as any);
        setSuccess(t('balance_event_created_success') || 'Balance event created successfully');
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
        ? (err.response?.data?.error || t('error_updating_balance_event') || 'Error updating balance event')
        : (err.response?.data?.error || t('error_creating_balance_event') || 'Error creating balance event');
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

  const handleRecalculateSnapshots = async () => {
    setRecalculatingSnapshots(true);
    setSnapshotError('');
    setSnapshotSuccess('');

    try {
      const response = await api.post('/admin/recalculate-snapshots', {
        eventId: null,
        recreateAll: true
      });
      
      const { totalSnapshotsCreated } = response.data;
      
      setSnapshotSuccess(
        t('snapshots_recalculated_success') || 
        `Historical snapshots recalculated successfully.\nSnapshots created: ${totalSnapshotsCreated}`
      );
    } catch (err: any) {
      setSnapshotError(err.response?.data?.error || t('error_recalculating_snapshots') || 'Error recalculating snapshots');
    } finally {
      setRecalculatingSnapshots(false);
    }
  };

  return (
    <>
      <UserProfileNav />
      <div data-help-id="region-balance-events-management" className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800">{t('admin_balance_events') || 'Balance Events'}</h1>
        <button 
          data-help-id="action-open-balance-event-form"
          onClick={() => setShowModal(true)} 
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          title={t('add_new_event') || 'Add new balance event'}
        >
          + {t('add_event') || 'Add Event'}
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
            title={t('recalculate_snapshots_tooltip') || 'Generate historical snapshots for balance event analysis'}
          >
            {recalculatingSnapshots 
              ? t('recalculating') || 'Recalculating...' 
              : t('recalculate_snapshots') || 'Recalculate Snapshots'
            }
          </button>
        </div>

        {snapshotSuccess && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-4">{snapshotSuccess}</div>}
        {snapshotError && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4">{snapshotError}</div>}

        {/* Events Table */}
        {events.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">{t('no_balance_events') || 'No balance events found'}</p>
          </div>
        ) : (
          <div data-help-id="region-balance-events-table" className="overflow-x-auto">
            <table className="w-full border-collapse bg-white shadow-md rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('date') || 'Date'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('event_type') || 'Type'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('description') || 'Description'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('faction') || 'Faction'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('map') || 'Map'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('patch_version') || 'Patch'}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('actions') || 'Actions'}</th>
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
                        title={t('edit') || 'Edit event'}
                      >
                        ✎ {t('edit') || 'Edit'}
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
              <h2 className="text-xl font-semibold text-gray-800">{editingEventId ? t('edit_balance_event') || 'Edit Balance Event' : t('create_balance_event') || 'Create Balance Event'}</h2>
              <button data-help-id="action-close-balance-event-form" onClick={handleCloseModal} className="text-2xl text-gray-600 hover:text-gray-800">✕</button>
            </div>

            {success && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 m-4 rounded-lg">{success}</div>}
            {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 m-4 rounded-lg">{error}</div>}

            <form onSubmit={handleSubmit} className="p-6">
              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">{t('event_date') || 'Event Date'} *</label>
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
                <label className="block text-gray-700 font-semibold mb-2">{t('event_type') || 'Event Type'} *</label>
                <select
                  data-help-id="field-balance-event-type"
                  name="event_type"
                  value={formData.event_type}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                >
                  <option value="BUFF">{t('buff') || 'Buff'}</option>
                  <option value="NERF">{t('nerf') || 'Nerf'}</option>
                  <option value="REWORK">{t('rework') || 'Rework'}</option>
                  <option value="HOTFIX">{t('hotfix') || 'Hotfix'}</option>
                  <option value="GENERAL_BALANCE_CHANGE">{t('general_balance_change') || 'General Balance Change'}</option>
                </select>
              </div>

              <div className="mb-4">
                <label className="block text-gray-700 font-semibold mb-2">{t('description') || 'Description'} *</label>
                <textarea
                  data-help-id="field-balance-event-description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder={t('description_placeholder') || 'Describe the balance change...'}
                  required
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">{t('faction') || 'Faction'} ({t('optional') || 'optional'})</label>
                  <select
                    data-help-id="field-balance-event-faction"
                    name="faction_id"
                    value={formData.faction_id}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="">--- {t('none') || 'None'} ---</option>
                    {factions.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-2">{t('map') || 'Map'} ({t('optional') || 'optional'})</label>
                  <select
                    data-help-id="field-balance-event-map"
                    name="map_id"
                    value={formData.map_id}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  >
                    <option value="">--- {t('none') || 'None'} ---</option>
                    {maps.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-gray-700 font-semibold mb-2">{t('patch_version') || 'Patch Version'} ({t('optional') || 'optional'})</label>
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
                  <label className="block text-gray-700 font-semibold mb-2">{t('notes') || 'Notes'} ({t('optional') || 'optional'})</label>
                  <input
                    data-help-id="field-balance-event-notes"
                    type="text"
                    name="notes"
                    value={formData.notes}
                    onChange={handleInputChange}
                    placeholder={t('additional_notes') || 'Additional notes...'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button data-help-id="action-cancel-balance-event-form" type="button" onClick={handleCloseModal} className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600">
                  {t('cancel') || 'Cancel'}
                </button>
                <button data-help-id="action-submit-balance-event-form" type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {loading 
                    ? (editingEventId ? t('updating') || 'Updating...' : t('creating') || 'Creating...') 
                    : (editingEventId ? t('update_event') || 'Update Event' : t('create_event') || 'Create Event')
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
