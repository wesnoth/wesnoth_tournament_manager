# Balance events

Balance events record changes to the game balance, such as buffs, nerfs, reworks, and hotfixes. Administrators can create and edit events from the admin interface. Public statistics pages can use the event timeline to compare cumulative faction and map results before and after a change.

## Responsibilities

- The scheduled statistics job creates the daily cumulative snapshot used by trend and impact views.
- A snapshot represents all eligible, non-cancelled matches recorded up to its snapshot date.
- The admin recalculation action is a maintenance operation. It clears the balance-event snapshot markers and historical snapshot table, then rebuilds the complete history from the recorded matches and balance events.
- Creating or editing an event does not expose arbitrary snapshot generation to regular users.

Balance-event write endpoints and the full-history recalculation endpoint require an authenticated administrator. Read-only event and statistics endpoints remain public where listed in `API_ENDPOINTS.md`.

No forum database tables are written by this feature. The snapshot rebuild reads the application match, faction, and map data and stores derived rows in `faction_map_statistics_history`.

Implementation comments and JSDoc beside the source code are the detailed source of truth for validation, side effects, and operational behavior.
