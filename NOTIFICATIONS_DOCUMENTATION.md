# In-App Notifications

This document provides a high-level overview of the persisted notification system. The source code and its English comments/JSDoc are the detailed source of truth for implementation behavior.

The application does not use Socket.IO or any other WebSocket notification channel. Notifications are persisted in the database and retrieved over authenticated HTTP requests.

## Responsibilities

| Area | Main location | Responsibility |
| --- | --- | --- |
| Notification creation | `backend/src/services/discordNotificationService.ts` | Store scheduling and challenge notifications in `user_notifications`. |
| Notification API | `backend/src/routes/notifications.ts` | List, filter, count, read/unread, and soft-delete notifications. |
| Retention | `backend/src/jobs/cleanupOldNotificationsJob.ts` | Delete notifications older than the configured retention period. |
| Scheduling producers | `backend/src/routes/tournament-scheduling.ts` | Create notifications for schedule proposals and decisions. |
| Challenge producers | `backend/src/routes/challenges.ts` | Create notifications for P2P challenge events. |
| Full-page UI | `frontend/src/components/NotificationsList.tsx` | Fetch, filter, paginate, read, unread, and delete notifications. |
| Navbar UI | `frontend/src/components/Navbar.tsx` | Poll unread count and show a recent pending-notification dropdown. |

## Data flow

1. A scheduling or challenge action changes application state.
2. The producer stores one notification per affected application user.
3. The navbar polls the unread count every 30 seconds while authenticated.
4. The full notification page retrieves notification data through the API.
5. Users can mark notifications read/unread or soft-delete them.
6. The scheduled cleanup job removes records older than the retention threshold.

Discord publishing is an optional parallel side effect for relevant events. It does not replace database notifications and does not provide the in-app notification transport.

## Notification categories

The current persisted categories cover:

- Tournament schedule proposals, confirmations, rejections, changes, and cancellations.
- P2P challenge proposals, confirmations, rejections, counter-proposals, updates, and cancellations.

The notification type is stored in `user_notifications.type` and controls the title, icon, filtering, and navigation behavior in the frontend.

## API surface

The authenticated notification API provides:

- Unread count for the navbar badge.
- All notifications with optional type filtering and pagination.
- Pending unread notifications for the navbar dropdown.
- Accepted schedule notifications.
- Mark one notification read or unread.
- Soft-delete one or all notifications.
- Mark all active notifications as read.

The exact routes, SQL statements, response shapes, and authorization checks are documented in the source comments and route implementation.

## Retention and deletion

User deletion is soft deletion through `is_deleted`, so deleted records are excluded from normal reads while remaining available for database-level maintenance. The scheduled retention job permanently removes old records using `OLD_NOTIFICATIONS_CLEANUP_DAYS`, which defaults to 90 days.

## Maintenance rule

When notification behavior changes:

1. Update the English comments/JSDoc beside the implementation first.
2. Update this document only when responsibilities, data flow, supported categories, transport, API capabilities, or retention policy changes.
3. Keep test procedures and test assertions with the actual E2E test files under `tests/e2e/`.
4. Do not copy function inventories, line numbers, SQL listings, or transient test results into this document.
