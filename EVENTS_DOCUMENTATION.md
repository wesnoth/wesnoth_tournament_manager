# Events

This document is a high-level overview of the Events page. The TypeScript source comments and JSDoc are the detailed source of truth for event mapping, filtering, timezone conversion, and action behavior.

## Purpose

Events provides one view of upcoming tournament schedules and P2P challenge proposals. It supports calendar and list views, type/tournament/player filters, date ranges, and a “My Events” filter.

## Data sources

| Source | Client location | Event mapping |
| --- | --- | --- |
| Tournament round matches | `frontend/src/services/api.ts` and `frontend/src/pages/Events.tsx` | Schedules with a scheduled datetime, including team member names and participation state. |
| P2P proposals | `frontend/src/services/p2pChallengesService.ts` | Proposals with at least one slot, using the first slot as the event date and preserving the full proposal for actions. |
| User profile | `frontend/src/services/api.ts` | Supplies the authenticated user's IANA timezone for display and date grouping. |

## Display and filtering policy

Stored schedule and slot timestamps are UTC. Events converts them to the authenticated user's timezone for displayed date/time values, day grouping, and date-filter comparisons.

The default view contains upcoming events only. Historical events can be displayed by selecting an explicit start date in the date filter. Pending tournament confirmations that do not involve the current user remain hidden unless the “My Events” filter is enabled.

P2P proposals show their contiguous slot ranges and expose management actions for participants. Tournament entries show the match/team context and current schedule status.

## Retention

The scheduled cleanup job in `backend/src/jobs/cleanupExpiredSchedulesJob.ts` removes expired P2P and tournament proposals, their slots, and confirmations. It uses `expires_at` where available and falls back to the latest slot for legacy records. Expired proposals no longer provide data to future event loads; confirmed historical schedules are also cleared from their match when no replacement proposal exists.

The job runs daily through `backend/src/jobs/scheduler.ts` and uses unqualified application table names, matching the configured database connection.

## Maintenance policy

When event behavior changes, update the English comments/JSDoc next to the implementation first. Update this document only when data sources, timezone policy, filtering behavior, actions, or retention policy changes. Keep detailed API and service behavior in the source code and exact route contracts in `API_ENDPOINTS.md`.
