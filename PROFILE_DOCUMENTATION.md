# My Profile

This document describes the authenticated profile-management area at `/profile`. It is a high-level guide to responsibilities, persistence, and access policy. The frontend source comments and backend route validation remain the detailed implementation source of truth.

## Responsibilities

The page combines the user's public player summary with settings that affect account presentation and match scheduling:

- Discord account association and guild validation.
- Interface language preference.
- Country and avatar selection.
- Ranked-play participation preference.
- IANA timezone and weekly availability ranges for scheduling.
- A link to the Wesnoth forum for password management.

The page is part of the authenticated `MainLayout` and is exposed through `UserProfileNav`. It is not the same view as `/user`, which presents the current user's profile and statistics without being the profile-management surface.

## Access and data flow

`/profile` requires an authenticated session. The frontend redirects unauthenticated visitors to `/login`, and every profile read or update endpoint is protected by backend authentication middleware.

On load, the page retrieves the authenticated profile from `GET /api/users/profile`. The response supplies player statistics and the persisted preferences needed to initialize the controls. Updates are sent through authenticated endpoints and the UI updates its local state only after the server accepts the change.

The backend owns validation and persistence. The client-side checks improve feedback but are not an authorization or data-integrity boundary.

## Settings policy

### Language

The selected language is saved in `users_extension.language`, applied to the active i18n instance, and mirrored in local storage for initial client startup. Only locales shipped by the frontend are accepted by the profile API: English, Spanish, Chinese, German, and Russian.

### Discord

Discord IDs must use the numeric Discord snowflake format. A profile can store a valid ID and can separately validate that ID against the configured Discord guild. Validation does not replace the authenticated update operation.

### Ranked participation

Ranked participation is opt-in. Once enabled, it is permanent and cannot be disabled through the UI or API. The backend enforces this invariant so clients cannot bypass it.

### Scheduling preferences

The timezone is an IANA identifier. Availability ranges use the user's local timezone and 30-minute granularity. The backend validates both the timezone and the weekly schedule before storing them; clearing the schedule removes the stored availability and update timestamp.

## Related entry points

- Frontend page: `frontend/src/pages/Profile.tsx`
- Shared authenticated layout: `frontend/src/components/MainLayout.tsx`
- Profile navigation: `frontend/src/components/UserProfileNav.tsx`
- Frontend service wrapper: `frontend/src/services/api.ts`
- Backend routes: `backend/src/routes/users.ts`
- Scheduling validation: `backend/src/utils/timezoneUtils.ts`
- General player and user-area overview: [PLAYERS_AND_USERS_DOCUMENTATION.md](PLAYERS_AND_USERS_DOCUMENTATION.md)
- Notifications: [NOTIFICATIONS_DOCUMENTATION.md](NOTIFICATIONS_DOCUMENTATION.md)
- Help/Wiki: [WIKI_DOCUMENTATION.md](WIKI_DOCUMENTATION.md)

When profile behavior changes, update source comments and validation first. Update this document only when a stable responsibility, persistence rule, supported locale, access policy, or integration boundary changes.
