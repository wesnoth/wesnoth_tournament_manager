# Tournament Scheduling

This document is a high-level overview of tournament match scheduling. The TypeScript source comments and JSDoc are the detailed source of truth for validation, authorization, state transitions, participant resolution, and notification payloads.

Tournament creation, formats, preparation, standings, and round progression are documented in [TOURNAMENTS_DOCUMENTATION.md](TOURNAMENTS_DOCUMENTATION.md).

## Purpose

Tournament scheduling lets participants negotiate one or more future UTC match slots before confirming a match. The same workflow supports:

- 1v1 tournaments, where a match has two player IDs.
- Team tournaments, where a round match or game resolves to all members of both participating teams.

Tournament proposals are stored in `match_schedule_proposals` with `challenge_mode = 'tournament'`, together with their half-hour slots and confirmations.

## Main components

| Area | Location | Responsibility |
| --- | --- | --- |
| HTTP API | `backend/src/routes/tournament-scheduling.ts` | Authenticate participants, resolve match/team context, invoke scheduling operations, and publish notifications. |
| Domain service | `backend/src/services/tournamentSchedulingService.ts` | Validate slots, persist proposals, manage confirmations, and update match scheduling state. |
| Conflict service | `backend/src/services/schedulingConflictService.ts` | Find active P2P/tournament reservations and reject overlapping slots at the backend boundary. |
| Web API client | `frontend/src/services/tournamentSchedulingService.ts` | Encapsulate multi-slot scheduling requests used by the tournament UI. |
| Scheduling modal | `frontend/src/components/ScheduleProposalModal.tsx` | Display participant availability, reservations, and propose/confirm/counter/edit/cancel actions. |
| Availability grid | `frontend/src/components/SchedulingFreeBusyGrid.tsx` | Render and block reserved half-hour slots for every involved participant. |

The old single-slot client methods were removed because the application uses the multi-slot workflow. The corresponding backend routes remain explicitly marked as legacy compatibility endpoints for external callers.

## Participant resolution

For a 1v1 match, the grid contains both players. For a team match, the backend resolves the members of both teams from `tournament_participants`; the resulting participant list may contain four players. The same IDs are used to query reservations, so a slot proposed by any involved player is visible to the whole scheduling group.

## Proposal lifecycle

1. A participant submits future, valid, 30-minute-aligned UTC slots.
2. The backend verifies that the requester belongs to the match or its team.
3. Existing active reservations for all involved players are checked. Overlapping slots are rejected before insertion.
4. A pending proposal and its slots are persisted; the proposer is recorded as confirmed where the workflow requires it.
5. The other participant or team members confirm selected slots, reject them, or submit a counter-proposal.
6. A confirmed proposal updates the associated match or round-match schedule.
7. The proposer may modify or cancel a pending proposal according to the route authorization rules.

The legacy `superseded` value remains readable for historical records but is no longer generated for new proposals. Non-overlapping proposals remain independent.

## Reservations and grid behavior

Before opening or refreshing the modal, the frontend loads active P2P and tournament reservations for every participant. Reserved P2P slots are shown in orange and reserved tournament slots in purple; they cannot be selected. The proposal currently being answered or edited is excluded from the conflict lookup so its own slots remain usable.

The grid works in UTC slot keys while displaying them in the selected viewing timezone. A reserved one-hour interval therefore blocks its two 30-minute slots. If a user selects slots before and after that interval, the range formatter keeps them as two separate ranges.

## Notifications

Schedule proposals, confirmations, rejections, changes, counter-proposals, and cancellations create persisted in-app notifications for the affected application users. Discord delivery is optional and best-effort; it uses canonical internal Discord IDs only and does not resolve usernames or discriminators.

## Maintenance policy

When behavior changes, update the English comments/JSDoc beside the implementation first. Update this document only when architecture, participant resolution, lifecycle, reservation policy, notification policy, or supported operations change. Keep exact route contracts in `API_ENDPOINTS.md` and operational procedures under `tests/e2e/`.
