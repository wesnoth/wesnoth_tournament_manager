# Players and User Areas

This document describes the stable responsibilities of the player-facing and authenticated user areas. It intentionally focuses on navigation boundaries and access policy rather than listing every control on each page. Page-specific behavior belongs in the relevant source comments and dedicated feature documentation.

## Player-facing surfaces

The public player area is available to authenticated and anonymous visitors unless a page states otherwise:

- **Player directory** (`/players`) exposes the public, paginated player list.
- **Player profile** (`/player/:id`) exposes public profile data, match history, ratings, and statistics. Authenticated users may challenge another player from this page; anonymous visitors do not see the challenge action.
- **Rankings** (`/rankings`) provides public ranking information.

Public player pages must not require authentication merely to read profile or ranking data. Actions that change application state, such as creating a challenge, remain authenticated operations and are enforced by both the UI and the backend.

## Authenticated user area

Authenticated pages use `MainLayout`, which renders `UserProfileNav` below the global `Navbar`. The shared user navigation currently provides these stable destinations:

| Area | Route | Responsibility |
| --- | --- | --- |
| My Profile | `/profile` | Edit account-facing preferences such as language, country, avatar, ranked-play preference, timezone, and availability. |
| My Tournaments | `/my-tournaments` | View tournaments associated with the current user and create or manage tournaments according to the user's permissions. |
| My Notifications | `/notifications` | Review and manage persisted in-app notifications. |
| Help | `/help` and `/help/:slug` | Browse the published help/wiki articles. |

These pages redirect unauthenticated visitors to `/login`, except for Help, which is public. The detailed notification and help responsibilities are documented separately in [NOTIFICATIONS_DOCUMENTATION.md](NOTIFICATIONS_DOCUMENTATION.md) and [WIKI_DOCUMENTATION.md](WIKI_DOCUMENTATION.md).

The global authenticated user menu also links to `/user`, the current-user profile/statistics view. This is distinct from `/profile`, which is the editable profile-management page in the authenticated user navigation.

## Navigation layers and roles

The application has two navigation layers:

1. `Navbar` is global. It contains public discovery links, authentication links, the authenticated user dropdown, notifications shortcut, language selection, and contextual Help navigation.
2. `UserProfileNav` is rendered by `MainLayout`. It contains authenticated user destinations and conditionally appends administration links.

Role-specific navigation is additive:

- **Regular authenticated users** see the common profile, tournament, notification, and help destinations.
- **Tournament moderators** see the moderator subset for user management, disputes, audit logs, and replay administration.
- **Administrators** see the full administrative navigation, including tournament management, announcements, FAQ, wiki, maps and factions, disputes, audit logs, replays, and balance events.

The UI visibility is not the authorization boundary. Protected routes and backend endpoints must continue to validate authentication and role permissions independently. A user may have both administrator and tournament-moderator flags; administrator navigation takes precedence over the moderator-only subset.

## Related documentation

- [NOTIFICATIONS_DOCUMENTATION.md](NOTIFICATIONS_DOCUMENTATION.md): notification persistence, delivery, UI, and retention.
- [PROFILE_DOCUMENTATION.md](PROFILE_DOCUMENTATION.md): authenticated profile-management settings and persistence policy.
- [WIKI_DOCUMENTATION.md](WIKI_DOCUMENTATION.md): public Help/wiki rendering and administrative article management.
- [P2P_CHALLENGES_DOCUMENTATION.md](P2P_CHALLENGES_DOCUMENTATION.md): player-to-player challenge scheduling.
- [NAV_INDEX_EN.md](NAV_INDEX_EN.md): navigation-oriented page and API index.

When a new authenticated user destination is added, update the navigation component and route protection first. Update this document only for a stable change to navigation responsibility, audience, or access policy; avoid turning it into a volatile control inventory.
