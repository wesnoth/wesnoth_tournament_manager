# Manage Tournaments

This document describes the stable responsibilities and access policy of the administrator tournament page at `/admin/tournaments`. It focuses on the administrative workflow and shared-list behavior rather than duplicating the tournament feature's full operational rules.

## Responsibilities

Manage Tournaments provides administrators with a paginated view of tournaments, including pending and other non-public administrative states. The page supports filtering by name, status, and tournament type, navigation to tournament details, and cancellation of eligible tournaments.

The list reuses the shared `TournamentList` component. Text filters are applied when the operator presses Enter or Refresh; select and checkbox filters apply immediately. Pagination and filter changes return to the first page.

The page also links to rule-template management because tournament rules are maintained as reusable templates rather than as a separate tournament-list concern.

## Access policy

Only authenticated site administrators can access `/admin/tournaments`. The frontend guard controls navigation, while the backend remains authoritative for destructive operations.

Administrators may cancel tournaments owned by other users, but only before a tournament is in progress or finished. Regular organizers use the same general tournament endpoint for their own eligible tournaments; they do not receive administrator list access from this page.

## Related documentation

- [TOURNAMENTS_DOCUMENTATION.md](TOURNAMENTS_DOCUMENTATION.md): tournament modes, formats, lifecycle, and round progression.
- [TOURNAMENT_SCHEDULING_DOCUMENTATION.md](TOURNAMENT_SCHEDULING_DOCUMENTATION.md): participant match-time scheduling.
- [API_ENDPOINTS.md](API_ENDPOINTS.md): endpoint routes and authorization levels.
- [PLAYERS_AND_USERS_DOCUMENTATION.md](PLAYERS_AND_USERS_DOCUMENTATION.md): shared authenticated navigation and administrative entry points.
