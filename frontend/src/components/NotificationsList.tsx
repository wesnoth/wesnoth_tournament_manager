import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/** Notification record returned by the authenticated notification API. */
interface Notification {
  id: string;
  user_id: string;
  tournament_id: string | null;
  game_id: string | null;
  series_id: string | null;
  type:
    | 'schedule_proposal'
    | 'schedule_confirmed'
    | 'schedule_rejected'
    | 'schedule_changed'
    | 'schedule_cancelled'
    | 'challenge_proposal'
    | 'challenge_confirmed'
    | 'challenge_rejected'
    | 'challenge_counter_proposal'
    | 'challenge_updated'
    | 'challenge_cancelled';
  title: string;
  message: string;
  message_extra?: string | null;
  is_read: boolean;
  created_at: string;
}

/** Filter options for the full-page notification list. */
interface NotificationsListProps {
  filter?: 'all' | 'pending' | 'accepted';
}

/** Render the persisted notification list and its read/delete controls. */
const NotificationsList: React.FC<NotificationsListProps> = ({
  filter = 'all',
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pageOffset, setPageOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentFilter, setCurrentFilter] = useState<'all' | 'pending' | 'accepted'>(filter);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkMarking, setBulkMarking] = useState(false);
  const [actionError, setActionError] = useState('');
  const ITEMS_PER_PAGE = 20;

  useEffect(() => {
    loadNotifications();
  }, [currentFilter, pageOffset]);

  /** Toggle one notification in the current bulk-action selection. */
  const toggleSelectNotification = (notificationId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(notificationId)) {
      newSelected.delete(notificationId);
    } else {
      newSelected.add(notificationId);
    }
    setSelectedIds(newSelected);
  };

  /** Select or clear every notification currently visible on the page. */
  const toggleSelectAll = () => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map(n => n.id)));
    }
  };

  const handleBulkMarkAsRead = async () => {
    if (selectedIds.size === 0) return;
    setActionError('');
    setBulkMarking(true);
    try {
      const token = localStorage.getItem('token');
      const promises = Array.from(selectedIds).map(id =>
        fetch(`/api/notifications/${id}/mark-read`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      );

      const responses = await Promise.all(promises);
      const successfulIds = Array.from(selectedIds).filter((_, index) => responses[index].ok);
      setNotifications(notifications.map(n =>
        successfulIds.includes(n.id) ? { ...n, is_read: true } : n
      ));
      setSelectedIds(new Set(Array.from(selectedIds).filter(id => !successfulIds.includes(id))));
      if (successfulIds.length !== selectedIds.size) {
        setActionError(t('notifications_partial_action', 'Some notifications could not be updated.'));
      }
    } catch (err) {
      setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
    } finally {
      setBulkMarking(false);
    }
  };

  const handleBulkMarkAsUnread = async () => {
    if (selectedIds.size === 0) return;
    setActionError('');
    setBulkMarking(true);
    try {
      const token = localStorage.getItem('token');
      const promises = Array.from(selectedIds).map(id =>
        fetch(`/api/notifications/${id}/mark-unread`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      );

      const responses = await Promise.all(promises);
      const successfulIds = Array.from(selectedIds).filter((_, index) => responses[index].ok);
      setNotifications(notifications.map(n =>
        successfulIds.includes(n.id) ? { ...n, is_read: false } : n
      ));
      setSelectedIds(new Set(Array.from(selectedIds).filter(id => !successfulIds.includes(id))));
      if (successfulIds.length !== selectedIds.size) {
        setActionError(t('notifications_partial_action', 'Some notifications could not be updated.'));
      }
    } catch (err) {
      setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
    } finally {
      setBulkMarking(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setActionError('');
    setBulkDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const promises = Array.from(selectedIds).map(id =>
        fetch(`/api/notifications/${id}/delete`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })
      );

      const responses = await Promise.all(promises);
      const successfulIds = Array.from(selectedIds).filter((_, index) => responses[index].ok);
      setNotifications(notifications.filter(n => !successfulIds.includes(n.id)));
      setSelectedIds(new Set(Array.from(selectedIds).filter(id => !successfulIds.includes(id))));
      if (successfulIds.length !== selectedIds.size) {
        setActionError(t('notifications_partial_action', 'Some notifications could not be updated.'));
      }
    } catch (err) {
      setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
    } finally {
      setBulkDeleting(false);
    }
  };

  /** Select the HTTP endpoint matching the active filter. */
  const getEndpoint = () => {
    switch (currentFilter) {
      case 'pending':
        return '/api/notifications/pending';
      case 'accepted':
        return '/api/notifications/accepted';
      default:
        return '/api/notifications';
    }
  };

  /** Fetch the current page of notifications over authenticated HTTP. */
  const loadNotifications = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const endpoint = getEndpoint();
      const url = currentFilter === 'all'
        ? `${endpoint}?limit=${ITEMS_PER_PAGE}&offset=${pageOffset}`
        : `${endpoint}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load notifications');
      }

      const data = await response.json();
      setNotifications(data.notifications || []);
      if (data.pagination) {
        setTotal(data.pagination.total);
      }
      setError('');
    } catch (err) {
      console.error('Error loading notifications:', err);
      setError('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/notifications/${notificationId}/mark-read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setNotifications(
          notifications.map(n =>
            n.id === notificationId ? { ...n, is_read: true } : n
          )
        );
      } else {
        setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
      }
    } catch (err) {
      setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
    }
  };

  const handleMarkAsUnread = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/notifications/${notificationId}/mark-unread`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setNotifications(
          notifications.map(n =>
            n.id === notificationId ? { ...n, is_read: false } : n
          )
        );
      } else {
        setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
      }
    } catch (err) {
      setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
    }
  };

  const handleDelete = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/notifications/${notificationId}/delete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setNotifications(notifications.filter(n => n.id !== notificationId));
      } else {
        setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
      }
    } catch (err) {
      setActionError(t('notifications_action_error', 'The notification action could not be completed.'));
    }
  };

  /** Map persisted notification categories to their UI icon. */
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'schedule_proposal':
        return '📅';
      case 'schedule_confirmed':
        return '✅';
      case 'schedule_cancelled':
        return '❌';
      default:
        return '📬';
    }
  };

  /** Format API timestamps for the user's local display. */
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString(i18n.language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-gray-600">{t('notifications_loading', 'Loading notifications...')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="text-red-800">❌ {t('notifications_load_error', error)}</div>
      </div>
    );
  }

  if (notifications.length === 0 && !loading) {
    return (
      <>
        {/* Filter Tabs */}
        <div className="mb-6 flex gap-2 border-b border-gray-200">
          {['all', 'pending', 'accepted'].map((filterOption) => (
            <button
              key={filterOption}
              onClick={() => {
                setCurrentFilter(filterOption as 'all' | 'pending' | 'accepted');
                setPageOffset(0);
                setSelectedIds(new Set());
              }}
              className={`px-4 py-2 font-semibold border-b-2 transition-colors ${
                currentFilter === filterOption
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              {filterOption === 'all' && (t('all') || 'All')}
              {filterOption === 'pending' && (t('pending') || 'Pending')}
              {filterOption === 'accepted' && (t('accepted') || 'Accepted')}
            </button>
          ))}
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-md p-8 text-center">
          <div className="text-gray-600">
            {currentFilter === 'pending' && t('notifications_empty_pending', 'No pending notifications')}
            {currentFilter === 'accepted' && t('notifications_empty_accepted', 'No accepted notifications')}
            {currentFilter === 'all' && t('notifications_empty', 'No notifications')}
          </div>
        </div>
      </>
    );
  }

  return (
    <div data-help-id="region-notifications" className="space-y-4">
      {actionError && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-yellow-800 text-sm">
          {actionError}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {['all', 'pending', 'accepted'].map((filterOption) => (
          <button
            key={filterOption}
            onClick={() => {
              setCurrentFilter(filterOption as 'all' | 'pending' | 'accepted');
              setPageOffset(0);
              setSelectedIds(new Set());
            }}
            className={`px-4 py-2 font-semibold border-b-2 transition-colors ${
              currentFilter === filterOption
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-800'
            }`}
          >
            {filterOption === 'all' && (t('all') || 'All')}
            {filterOption === 'pending' && (t('pending') || 'Pending')}
            {filterOption === 'accepted' && (t('accepted') || 'Accepted')}
          </button>
        ))}
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-4 items-center justify-between">
          <div className="text-sm text-gray-700">
            {t('notifications_selected', { count: selectedIds.size, defaultValue: `${selectedIds.size} selected` })}
          </div>
          <div className="flex gap-2">
            <button
              data-help-id="action-mark-selected-read"
              onClick={handleBulkMarkAsRead}
              disabled={bulkMarking || bulkDeleting}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkMarking ? t('notifications_working', 'Working...') : t('notifications_mark_read', '✓ Mark as Read')}
            </button>
            <button
              data-help-id="action-mark-selected-unread"
              onClick={handleBulkMarkAsUnread}
              disabled={bulkMarking || bulkDeleting}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkMarking ? t('notifications_working', 'Working...') : t('notifications_mark_unread', '↩️ Mark as Unread')}
            </button>
            <button
              data-help-id="action-delete-selected-notifications"
              onClick={handleBulkDelete}
              disabled={bulkDeleting || bulkMarking}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bulkDeleting ? t('notifications_working', 'Working...') : t('notifications_delete', '🗑️ Delete')}
            </button>
          </div>
        </div>
      )}

      {/* Select All Checkbox (only if we have notifications) */}
      {notifications.length > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <input
            data-help-id="field-select-all-notifications"
            type="checkbox"
            checked={selectedIds.size === notifications.length && notifications.length > 0}
            onChange={toggleSelectAll}
            className="w-4 h-4 cursor-pointer"
            title="Select all notifications"
          />
          <label className="text-sm text-gray-600 cursor-pointer">
            Select All ({notifications.length})
          </label>
        </div>
      )}

      {/* Notifications List */}
      {notifications.map((notification) => (
        <div
          data-help-id="region-notification-item"
          key={notification.id}
          className={`border rounded-lg p-4 transition-colors flex gap-3 ${
            notification.is_read
              ? 'bg-white border-gray-200'
              : 'bg-blue-50 border-blue-200'
          } ${selectedIds.has(notification.id) ? 'ring-2 ring-blue-500' : ''}`}
        >
          <input
            data-help-id="field-select-notification"
            type="checkbox"
            checked={selectedIds.has(notification.id)}
            onChange={() => toggleSelectNotification(notification.id)}
            className="w-4 h-4 mt-1 cursor-pointer flex-shrink-0"
          />

          <div className="flex-1 flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{getNotificationIcon(notification.type)}</span>
                <h3 className="font-semibold text-gray-900">{notification.title}</h3>
                {!notification.is_read && (
                  <span className="inline-block w-2 h-2 bg-blue-600 rounded-full ml-auto" />
                )}
              </div>

              <p className="text-gray-700 mb-2">{notification.message}</p>

              {notification.message_extra && (
                <div className="bg-gray-100 rounded p-3 mb-2 border-l-4 border-blue-500">
                  <p className="text-sm text-gray-700 italic">
                    <strong>{t('message', 'Message')}:</strong> {notification.message_extra}
                  </p>
                </div>
              )}

              <div className="text-xs text-gray-500">
                {formatDate(notification.created_at)}
              </div>
            </div>

            <div className="flex gap-2 flex-shrink-0 flex-col">
              <div className="flex gap-2">
                {!notification.is_read && (
                  <button
                    data-help-id="action-mark-notification-read"
                    onClick={() => handleMarkAsRead(notification.id)}
                    className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                    title="Mark as read"
                  >
                    ✓
                  </button>
                )}
                {notification.is_read && (
                  <button
                    data-help-id="action-mark-notification-unread"
                    onClick={() => handleMarkAsUnread(notification.id)}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                    title="Mark as unread"
                  >
                    ↩️
                  </button>
                )}
                <button
                  data-help-id="action-delete-notification"
                  onClick={() => handleDelete(notification.id)}
                  className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
              {notification.type?.startsWith('challenge_') ? (
                <button
                  data-help-id="action-go-events-from-notification"
                  onClick={() => navigate(`/events`)}
                  className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors font-semibold"
                  title="Go to events"
                >
                  → {t('label_go_events') || 'Go to Events'}
                </button>
              ) : notification.tournament_id ? (
                <button
                  data-help-id="action-go-tournament-from-notification"
                  onClick={() => navigate(`/tournament/${notification.tournament_id}?tab=competition${notification.series_id ? `&seriesId=${notification.series_id}` : ''}`)}
                  className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors font-semibold"
                  title="Go to tournament details"
                >
                  → {t('label_go_tournament') || 'Go to Tournament'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ))}

      {currentFilter === 'all' && total > ITEMS_PER_PAGE && (
        <div className="flex gap-2 justify-center mt-6">
          <button
            onClick={() => setPageOffset(Math.max(0, pageOffset - ITEMS_PER_PAGE))}
            disabled={pageOffset === 0}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">
              {pageOffset + 1} - {Math.min(pageOffset + ITEMS_PER_PAGE, total)} of {total}
            </span>
          </div>
          <button
            onClick={() => setPageOffset(pageOffset + ITEMS_PER_PAGE)}
            disabled={pageOffset + ITEMS_PER_PAGE >= total}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationsList;
