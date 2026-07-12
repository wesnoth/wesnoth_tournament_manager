# Matches

The public `/matches` page is the global match history for ranked games. It is available without authentication and combines completed ranked matches with eligible confidence-one replays that still need player confirmation.

## Responsibilities

- The frontend page owns filters, pagination controls, refresh and modal state.
- `MatchesTable` renders regular matches and pending replay rows, including links to player profiles and replay files.
- The public API supplies the filtered, ordered result set and pagination metadata.
- Authenticated participants may confirm or dispute their own pending result. Administrators may discard eligible pending replays according to the backend authorization rules.

## Filtering and pagination

The page supports player, map, status and faction filters. Player and map text searches are applied on Enter or Refresh rather than on every keystroke. Status and faction selectors apply immediately. Pending replays are evaluated against the same filters as persisted matches before the combined result set is paginated, so the displayed count and page boundaries describe what the user can actually see.

Sorting in the table is local to the current page. The API remains responsible for the global date order and page selection.

## Failure and visibility policy

The page shows a retry action when the match or faction request fails instead of presenting an empty result as if no matches existed. Anonymous visitors can browse public data, while confirmation, dispute and administrative actions remain conditional on the authenticated identity and backend authorization.

Implementation comments and JSDoc in the frontend and backend are the detailed source of truth for field mappings, replay states and authorization behavior.
