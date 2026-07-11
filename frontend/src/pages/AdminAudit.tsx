import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import { adminService } from '../services/api';
import UserProfileNav from '../components/UserProfileNav';

/** Audit log row returned by the normalized administrative API. */
interface AuditLog {
  id: string;
  event_type: string;
  user_id: string | null;
  username: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, any>;
  created_at: string;
}

export default function AdminAudit() {
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, isTournamentModerator } = useAuthStore();
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    eventType: '',
    username: '',
    ipAddress: '',
    daysBack: 7
  });
  const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Check authentication and admin status
  useEffect(() => {
    if (!isAuthenticated || (!isAdmin && !isTournamentModerator)) {
      navigate('/');
      return;
    }
    
    // Only fetch logs if admin
    fetchAuditLogs();
  }, [isAuthenticated, isAdmin, isTournamentModerator, navigate]);

  // Fetch audit logs
  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      setError('');

      // Build query params
      const params: any = {};
      if (filters.eventType) params.eventType = filters.eventType;
      if (filters.username) params.username = filters.username;
      if (filters.ipAddress) params.ipAddress = filters.ipAddress;
      params.daysBack = filters.daysBack;

      const response = await adminService.getAuditLogs(params);
      setAuditLogs(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  // Delete selected logs
  const deleteSelectedLogs = async () => {
    if (selectedLogs.size === 0) {
      setError('Please select logs to delete');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const logIds = Array.from(selectedLogs);
      await adminService.deleteAuditLogs(logIds);

      setAuditLogs(auditLogs.filter(log => !selectedLogs.has(log.id)));
      setSelectedLogs(new Set());
      setShowDeleteConfirm(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete logs');
    } finally {
      setLoading(false);
    }
  };

  // Delete all logs older than X days
  const deleteOldLogs = async () => {
    if (!window.confirm(`Delete all logs older than ${filters.daysBack} days?`)) {
      return;
    }

    try {
      setLoading(true);
      setError('');

      await adminService.deleteOldAuditLogs(filters.daysBack);

      fetchAuditLogs();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete logs');
    } finally {
      setLoading(false);
    }
  };

  // Toggle log selection
  const toggleLogSelection = (id: string) => {
    const newSelected = new Set(selectedLogs);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedLogs(newSelected);
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedLogs.size === auditLogs.length) {
      setSelectedLogs(new Set());
    } else {
      setSelectedLogs(new Set(auditLogs.map(log => log.id)));
    }
  };

  // Format timestamp
  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <>
      <UserProfileNav />
      <div className="w-full mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">🔒 Audit Logs</h1>

      {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</div>}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Filters</h3>
        <div className="grid grid-cols-5 gap-4">
          <input
            type="text"
            placeholder="Event Type (e.g., LOGIN_FAILED)"
            value={filters.eventType}
            onChange={(e) => setFilters({ ...filters, eventType: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="Username"
            value={filters.username}
            onChange={(e) => setFilters({ ...filters, username: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            placeholder="IP Address"
            value={filters.ipAddress}
            onChange={(e) => setFilters({ ...filters, ipAddress: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
          <select
            value={filters.daysBack}
            onChange={(e) => setFilters({ ...filters, daysBack: parseInt(e.target.value) })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          >
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button onClick={fetchAuditLogs} disabled={loading} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {loading ? 'Loading...' : 'Search'}
          </button>
        </div>
      </div>

      {/* Action Buttons — admin only */}
      {isAdmin && (
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setShowDeleteConfirm(true)}
          disabled={selectedLogs.size === 0 || loading}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          🗑️ Delete Selected ({selectedLogs.size})
        </button>
        <button
          onClick={deleteOldLogs}
          disabled={loading}
          className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50"
        >
          🧹 Delete Logs Older Than {filters.daysBack} Days
        </button>
      </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">⚠️ Confirm Deletion</h3>
            <p className="text-gray-700 mb-6">Delete {selectedLogs.size} selected log(s)? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={deleteSelectedLogs}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <h3 className="text-lg font-semibold text-gray-800 px-6 py-4 border-b border-gray-300">Logs ({auditLogs.length})</h3>

        {auditLogs.length === 0 ? (
          <div className="text-center py-8 text-gray-600">No audit logs found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-200">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedLogs.size === auditLogs.length && auditLogs.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">Time</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">Event Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">User</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">IP Address</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className={`border-b border-gray-200 ${
                    selectedLogs.has(log.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedLogs.has(log.id)}
                        onChange={() => toggleLogSelection(log.id)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-sm">{formatTime(log.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        log.event_type.includes('SUCCESS') ? 'bg-green-100 text-green-800' :
                        log.event_type.includes('FAILED') ? 'bg-red-100 text-red-800' :
                        log.event_type === 'REGISTRATION' ? 'bg-blue-100 text-blue-800' :
                        log.event_type === 'ADMIN_ACTION' ? 'bg-yellow-100 text-yellow-800' :
                        log.event_type === 'SECURITY_EVENT' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {log.event_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-sm">
                      {log.username || log.user_id || 'ANONYMOUS'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-sm">{log.ip_address || 'UNKNOWN'}</td>
                    <td className="px-4 py-3 text-gray-700 text-sm">
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">{JSON.stringify(log.details, null, 2)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </>
  );
}
