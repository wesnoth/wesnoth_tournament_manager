# Replay Administration

This document describes the stable responsibilities of the replay administration area. The replay-processing source code and its comments are the authoritative reference for query details, state transitions, and parser behavior.

## Scope

The `/admin/replays` page provides a searchable, paginated view of replay records discovered from the forum/game-server integration. It exposes the replay status, parser confidence, detected players and map, parse errors, and links to the parse summary.

Replay records are stored in the tournament database. Forum database tables are read-only integration sources and are never modified by this administration area.

## Access and actions

- Administrators and forum tournament moderators may view the replay list.
- Administrators and forum tournament moderators may force-discard eligible unprocessed replays or request reprocessing.
- Reprocessing and discard operations are rejected for soft-deleted records and for replays already linked to a match.
- Global replay-processing settings are displayed separately from the replay list and can only be edited by administrators.
- Administrative replay actions are recorded in `audit_logs`.

In the test environment, authorized administrators and tournament moderators also have a `Simulate Match` tool. It supports direct ranked matches and open tournament series, selects valid assets on the server, and reports the result through the same ELO/statistics and tournament progression services used by replay integration. Simulated matches have no replay row or replay URL and are recorded in `audit_logs`; they are not exposed or accepted by production backend routes.

## Filtering and pagination

The API applies status, game ID, map, and player filters in the database before pagination. Map searches use the same precedence as the UI: `finalMap`, `forumMap`, `resolvedMap`, then `map_name`. Player searches inspect parsed `forumPlayers[*].user_name` values.

The list uses a page size of 20 and returns total and current-page metadata. Results are ordered by detection time with the replay UUID as a stable tie-breaker.

## Processing lifecycle

Replay discovery, parsing, match integration, confirmation, and automatic expiration are handled by backend jobs and replay routes. The daily scheduler marks unconfirmed parsed replays as `due` after the configured retention period; this is a state change, not a physical deletion.

For implementation details, consult the comments and JSDoc in `backend/src/routes/admin.ts`, `backend/src/routes/replays.ts`, `backend/src/jobs/parseNewReplaysRefactored.ts`, and `backend/src/jobs/scheduler.ts`.
