# Manage Users

This document describes the stable responsibilities and access policy of the Manage Users page at `/admin`. It focuses on the administrative workflow and security boundary rather than enumerating UI controls.

## Responsibilities

Manage Users provides a role-aware view of registered users with their account status, public player statistics, role, and ranked-play preference. Administrators can also trigger global statistics recalculation and manage site maintenance mode from this page.

The user list supports nickname and status filtering, pagination, navigation to public player profiles, and account actions. Nickname filtering is intentionally applied when the operator presses Enter or uses Refresh, not on every keystroke.

## Access policy

The page is available to authenticated site administrators and tournament moderators through the shared `MainLayout`. The backend remains the authorization boundary:

- Administrators can view users, block or unblock accounts, grant or revoke the site-admin role, and delete accounts.
- Tournament moderators can view users and block or unblock non-admin accounts.
- Only administrators can recalculate global statistics, toggle maintenance mode, change administrator roles, or delete accounts.
- Moderators cannot block or unblock administrator accounts.

Visibility of buttons in the frontend is not sufficient authorization. Every protected endpoint validates the caller role independently, and administrative mutations are audit-sensitive operations.

## Operational behavior

Blocking prevents the target account from normal use. Unlocking resets account lockout state and clears the blocked flag. Deleting removes the corresponding `users_extension` record and is irreversible from this interface.

Global statistics recalculation replays the supported match history and rebuilds derived player and balance statistics. Maintenance mode prevents non-admin users from logging in while it is enabled; administrators use the reason field to document the operational event.

## Related documentation

- [PLAYERS_AND_USERS_DOCUMENTATION.md](PLAYERS_AND_USERS_DOCUMENTATION.md): shared authenticated navigation and player/user area boundaries.
- [API_ENDPOINTS.md](API_ENDPOINTS.md): endpoint-level routes and access levels.
- [AUDIT_LOG_DOCUMENTATION.md](AUDIT_LOG_DOCUMENTATION.md): audit history and administrative event review.
- [MAINTENANCE_MODE_DOCUMENTATION.md](MAINTENANCE_MODE_DOCUMENTATION.md): maintenance-mode behavior and operational limits.
