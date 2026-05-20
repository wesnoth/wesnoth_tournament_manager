import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { userService, adminService } from '../services/api';
import MainLayout from '../components/MainLayout';

const AdminUsers: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, isTournamentModerator } = useAuthStore();
  
  const [users, setUsers] = useState<any[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [actionType, setActionType] = useState('');
  const [searchNIC, setSearchNIC] = useState('');
  const [recalculatingStats, setRecalculatingStats] = useState(false);
  const [userStatusFilter, setUserStatusFilter] = useState('all'); // 'all', 'active', 'blocked'
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceReason, setMaintenanceReason] = useState('');
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [togglingMaintenance, setTogglingMaintenance] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    if (!isAuthenticated || (!isAdmin && !isTournamentModerator)) {
      navigate('/');
      return;
    }

    fetchUsers();
    if (isAdmin) {
      fetchMaintenanceStatus();
    }
  }, [isAuthenticated, isAdmin, isTournamentModerator, navigate]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await adminService.getAllUsers();
      const usersData = res.data || [];
      setUsers(usersData);
      applyFilters(searchNIC, userStatusFilter, usersData);
      setError('');
    } catch (err: any) {
      console.error('Error fetching users:', err);
      setError('Error loading users');
      setUsers([]);
      setFilteredUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (nicValue: string, statusValue: string, usersData?: any[]) => {
    const data = usersData || users;
    let filtered = data;

    // Filter by nickname
    if (nicValue.trim() !== '') {
      const lowerSearch = nicValue.toLowerCase();
      filtered = filtered.filter((user: any) => user.nickname.toLowerCase().includes(lowerSearch));
    }

    // Filter by status
    if (statusValue === 'blocked') {
      filtered = filtered.filter((user: any) => !!user.is_blocked);
    } else if (statusValue === 'active') {
      filtered = filtered.filter((user: any) => !user.is_blocked && !!user.is_active);
    } else if (statusValue === 'inactive') {
      filtered = filtered.filter((user: any) => !user.is_blocked && !user.is_active);
    }

    setFilteredUsers(filtered);
    setCurrentPage(1);
  };

  const fetchMaintenanceStatus = async () => {
    try {
      const res = await adminService.getMaintenanceStatus();
      setMaintenanceMode(res.data.maintenance_mode);
    } catch (err: any) {
      console.error('Error fetching maintenance status:', err);
    }
  };

  const handleToggleMaintenance = async () => {
    try {
      setTogglingMaintenance(true);
      setError('');
      const newStatus = !maintenanceMode;
      await adminService.toggleMaintenance(newStatus, maintenanceReason || undefined);
      setMaintenanceMode(newStatus);
      setMessage(
        newStatus
          ? t('admin.maintenance_enabled', 'Maintenance mode enabled')
          : t('admin.maintenance_disabled', 'Maintenance mode disabled')
      );
      setShowMaintenanceModal(false);
      setMaintenanceReason('');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to toggle maintenance mode');
    } finally {
      setTogglingMaintenance(false);
    }
  };

  const handleSearchNIC = (value: string) => {
    setSearchNIC(value);
    applyFilters(value, userStatusFilter);
  };

  const handleStatusFilterChange = (status: string) => {
    setUserStatusFilter(status);
    applyFilters(searchNIC, status);
  };

  const handlePageChange = (newPage: number) => {
    const totalPages = Math.ceil(filteredUsers.length / pageSize);
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const confirmAction = async () => {
    if (!selectedUser) return;

    try {
      setError('');
      setMessage('');

      switch (actionType) {
        case 'block':
          await adminService.blockUser(selectedUser.id);
          setMessage(t('admin.user_blocked', { nickname: selectedUser.nickname }));
          break;
        case 'unblock':
          await adminService.unlockAccount(selectedUser.id);
          setMessage(t('admin.user_unblocked', { nickname: selectedUser.nickname }));
          break;
        case 'makeAdmin':
          await adminService.makeAdmin(selectedUser.id);
          setMessage(t('admin.user_promoted', { nickname: selectedUser.nickname }));
          break;
        case 'removeAdmin':
          await adminService.removeAdmin(selectedUser.id);
          setMessage(t('admin.user_demoted', { nickname: selectedUser.nickname }));
          break;
        case 'delete':
          await adminService.deleteUser(selectedUser.id);
          setMessage(t('admin.user_deleted', { nickname: selectedUser.nickname }));
          break;
      }

      setShowModal(false);
      setSelectedUser(null);
      setActionType('');
      
      // Refresh users list
      fetchUsers();
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Action failed');
    }
  };

  const handleAction = (user: any, action: string) => {
    setSelectedUser(user);
    setActionType(action);
    setShowModal(true);
  };

  const handleConfirmDelete = (user: any) => {
    if (window.confirm(t('admin.confirm_delete_warning'))) {
      handleAction(user, 'delete');
    }
  };

  const handleRecalculateAllStats = async () => {
    if (!window.confirm(t('admin.recalculate_confirm'))) {
      return;
    }

    try {
      setRecalculatingStats(true);
      setError('');
      setMessage('');
      const res = await adminService.recalculateAllStats();
      const matchesProcessed = res.data.matchesProcessed || 0;
      const usersUpdated = res.data.usersUpdated || 0;
      setMessage(
        `Stats recalculated successfully! Processed ${matchesProcessed} matches and updated ${usersUpdated} users.`
      );
      // Refresh users list
      fetchUsers();
      setTimeout(() => setMessage(''), 5000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to recalculate stats');
    } finally {
      setRecalculatingStats(false);
    }
  };

  if (loading) {
    return <MainLayout><div className="max-w-6xl mx-auto px-4 py-8"><p className="text-center text-gray-600">{t('loading')}</p></div></MainLayout>;
  }

  return (
    <MainLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">{t('admin_users_title')}</h1>

      {error && <p className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</p>}
      {message && <p className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-4">{message}</p>}

      <section className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-gray-600 text-sm font-semibold">{t('admin.total_users', 'Total Users')}</div>
          <div className="text-3xl font-bold text-gray-800 mt-2">{users.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-gray-600 text-sm font-semibold">{t('admin.blocked_users', 'Blocked Users')}</div>
          <div className="text-3xl font-bold text-red-600 mt-2">{users.filter(u => u.is_blocked).length}</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-gray-600 text-sm font-semibold">{t('admin.active_users', 'Active Users')}</div>
          <div className="text-3xl font-bold text-green-600 mt-2">{users.filter(u => !u.is_blocked && u.is_active).length}</div>
        </div>
      </section>

      <section className="mb-6">
        {isAdmin && (
          <>
        <button
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 mr-3"
          onClick={handleRecalculateAllStats}
          disabled={recalculatingStats}
        >
          {recalculatingStats ? t('admin.recalculating') : t('admin.recalculate_all_stats')}
        </button>
        <button
          className={`px-4 py-2 rounded-lg text-white font-semibold ${
            maintenanceMode
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-yellow-600 hover:bg-yellow-700'
          } disabled:opacity-50`}
          onClick={() => setShowMaintenanceModal(true)}
          disabled={togglingMaintenance}
        >
          {maintenanceMode ? '⚠️ Maintenance ON' : '✓ Maintenance OFF'}
        </button>
          </>
        )}
      </section>

      <section>
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              placeholder={t('admin.search_by_nic')}
              value={searchNIC}
              onChange={(e) => handleSearchNIC(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
            />
            <select 
              value={userStatusFilter} 
              onChange={(e) => handleStatusFilterChange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
            >
              <option value="all">{t('admin.filter_all_users', 'All Users')}</option>
              <option value="active">{t('admin.filter_active', 'Active')}</option>
              <option value="inactive">Inactive</option>
              <option value="blocked">{t('admin.filter_blocked', 'Blocked')}</option>
            </select>
          </div>
          <span className="text-sm text-gray-600">
            {t('showing_count', { count: filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize).length, total: filteredUsers.length, page: currentPage, totalPages: Math.ceil(filteredUsers.length / pageSize) })}
          </span>
        </div>

        {/* Pagination Controls - Top */}
        {Math.ceil(filteredUsers.length / pageSize) > 1 && (
          <div className="flex justify-center items-center gap-2 mb-6">
            <button 
              className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
            >
              {t('pagination_first')}
            </button>
            <button 
              className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              {t('pagination_prev')}
            </button>
            
            <div className="text-gray-600 px-4">
              {t('pagination_page_info', { page: currentPage, totalPages: Math.ceil(filteredUsers.length / pageSize) })}
            </div>
            
            <button 
              className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === Math.ceil(filteredUsers.length / pageSize)}
            >
              {t('pagination_next')}
            </button>
            <button 
              className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(Math.ceil(filteredUsers.length / pageSize))}
              disabled={currentPage === Math.ceil(filteredUsers.length / pageSize)}
            >
              {t('pagination_last')}
            </button>
          </div>
        )}

        {users.length > 0 ? (
          <div className="overflow-x-auto">
          <table className="w-full border-collapse bg-white shadow-md rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_nickname')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_elo')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_level')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_status')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_role')}</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">Ranked</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">{t('label_actions')}</th>
                </tr>
            </thead>
            <tbody>
             {filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((user) => {
                return (
                <tr key={user.id} className="border-b border-gray-200 hover:bg-gray-50">
                 <td className="px-4 py-3 text-gray-700">
                   <a 
                     href="#" 
                     onClick={(e) => {
                       e.preventDefault();
                       navigate(`/player/${user.id}`);
                     }}
                     className="font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                   >
                     {user.nickname}
                   </a>
                 </td>
                  <td className="px-4 py-3 text-gray-700">{user.elo_rating || 1200}</td>
                  <td className="px-4 py-3 text-gray-700">{user.level || t('level_novice')}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      user.is_blocked ? 'bg-red-100 text-red-800' : user.is_active ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {user.is_blocked ? t('status_blocked') : user.is_active ? t('status_active') : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      user.is_admin ? 'bg-purple-100 text-purple-800' :
                      user.is_moderator ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {user.is_admin ? t('role_admin') : user.is_moderator ? 'Moderator' : t('role_user')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      user.enable_ranked ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {user.enable_ranked ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {/* Block/unblock: moderators cannot target admin users */}
                      {!(isTournamentModerator && !isAdmin && user.is_admin) && (
                        user.is_blocked ? (
                          <button
                            className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                            onClick={() => handleAction(user, 'unblock')}
                          >
                            {t('btn_unblock')}
                          </button>
                        ) : (
                          <button
                            className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                            onClick={() => handleAction(user, 'block')}
                          >
                            {t('btn_block')}
                          </button>
                        )
                      )}
                      {/* Admin-only actions */}
                      {isAdmin && (
                        <>
                          {user.is_admin ? (
                            <button
                              className="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600"
                              onClick={() => handleAction(user, 'removeAdmin')}
                            >
                              {t('btn_remove_admin')}
                            </button>
                          ) : (
                            <button
                              className="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
                              onClick={() => handleAction(user, 'makeAdmin')}
                            >
                              {t('btn_make_admin')}
                            </button>
                          )}
                          <button
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                            onClick={() => handleConfirmDelete(user)}
                          >
                            {t('btn_delete')}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="text-center py-8 text-gray-600">{t('no_data')}</p>
        )}

        {/* Pagination Controls - Bottom */}
        {Math.ceil(filteredUsers.length / pageSize) > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button 
              className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(1)}
              disabled={currentPage === 1}
            >
              {t('pagination_first')}
            </button>
            <button 
              className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              {t('pagination_prev')}
            </button>
            
            <div className="text-gray-600 px-4">
              {t('pagination_page_info', { page: currentPage, totalPages: Math.ceil(filteredUsers.length / pageSize) })}
            </div>
            
            <button 
              className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === Math.ceil(filteredUsers.length / pageSize)}
            >
              {t('pagination_next')}
            </button>
            <button 
              className="px-3 py-2 border border-gray-300 rounded hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handlePageChange(Math.ceil(filteredUsers.length / pageSize))}
              disabled={currentPage === Math.ceil(filteredUsers.length / pageSize)}
            >
              {t('pagination_last')}
            </button>
          </div>
        )}
      </section>

      {showModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              {actionType === 'delete' && t('admin.confirm_delete_title')}
              {actionType === 'block' && t('admin.confirm_block_title')}
              {actionType === 'unblock' && t('admin.confirm_unblock_title', 'Unblock User')}
            </h3>
            <p className="text-gray-700 mb-6">
              {actionType === 'delete' && t('admin.confirm_delete', { nickname: selectedUser.nickname })}
              {actionType === 'block' && t('admin.confirm_block', { nickname: selectedUser.nickname })}
              {actionType === 'unblock' && `Are you sure you want to unblock ${selectedUser.nickname}?`}
            </p>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600" onClick={() => setShowModal(false)}>
                {t('btn_cancel')}
              </button>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" onClick={confirmAction}>
                {t('btn_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMaintenanceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-md">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              {maintenanceMode ? '⚠️ Disable Maintenance Mode?' : '🔧 Enable Maintenance Mode?'}
            </h3>
            <p className="text-gray-700 mb-4">
              {maintenanceMode
                ? 'Disabling maintenance mode will allow all users to login again.'
                : 'Enabling maintenance mode will prevent non-admin users from logging in. Only admins will have access.'}
            </p>
            {!maintenanceMode && (
              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Reason (optional):</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  rows={3}
                  placeholder="E.g., Database migration, server updates..."
                  value={maintenanceReason}
                  onChange={(e) => setMaintenanceReason(e.target.value)}
                />
              </div>
            )}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-yellow-800">
                💡 A banner will be displayed to inform users about the maintenance mode.
              </p>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                onClick={() => {
                  setShowMaintenanceModal(false);
                  setMaintenanceReason('');
                }}
                disabled={togglingMaintenance}
              >
                Cancel
              </button>
              <button
                className={`px-4 py-2 text-white rounded-lg font-semibold ${
                  maintenanceMode
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50`}
                onClick={handleToggleMaintenance}
                disabled={togglingMaintenance}
              >
                {togglingMaintenance
                  ? 'Updating...'
                  : maintenanceMode
                  ? 'Disable Maintenance'
                  : 'Enable Maintenance'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </MainLayout>
  );
};

export default AdminUsers;
