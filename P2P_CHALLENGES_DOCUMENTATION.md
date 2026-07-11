# P2P Challenges

This document is a high-level overview of player-to-player challenge scheduling. The TypeScript source comments and JSDoc are the detailed source of truth for validation, authorization, state transitions, and notification payloads.

## Purpose

P2P challenges let one player propose one or more UTC match times to another player. The challenged player can confirm selected slots, reject all slots, or create a counter-proposal. The proposer can edit a pending proposal or cancel it.

The feature is separate from tournament scheduling at the business-rule level, while sharing the `match_schedule_proposals` and `match_schedule_slots` tables. P2P records are identified by `challenge_mode = 'p2p'` and do not reference a tournament match.

## Main components

| Area | Location | Responsibility |
| --- | --- | --- |
| HTTP API | `backend/src/routes/challenges.ts` | Authenticate requests, call the domain service, and publish in-app/Discord side effects. |
| Domain service | `backend/src/services/p2pSchedulingService.ts` | Validate ownership, persist proposals and slots, and apply state transitions. |
| Web API client | `frontend/src/services/p2pChallengesService.ts` | Encapsulate authenticated requests for the challenge endpoints. |
| Event integration | `frontend/src/pages/Events.tsx` | Show P2P proposals alongside tournament events and expose challenge actions. |
| Scheduling UI | `frontend/src/components/ScheduleProposalModalP2P.tsx` | Select slots, inspect proposal state, and perform propose/confirm/counter/edit/cancel actions. |
| Conflict lookup | `backend/src/routes/challenges.ts` | Report slots reserved by active P2P or tournament proposals so scheduling grids can block them. |
| Notifications | `backend/src/services/discordNotificationService.ts` | Persist notifications for the affected application users. |

## Lifecycle

1. The proposer submits future, valid, 30-minute-aligned slots.
2. A pending proposal is created and the proposer is recorded as confirmed.
3. Slots that overlap an active P2P or tournament proposal are rejected by the backend.
4. The challenged player confirms a subset of slots or rejects all of them.
5. A confirmed proposal has at least one confirmed slot; a proposal with no confirmed slots becomes rejected.
6. A counter-proposal rejects the current record and creates a new proposal in the opposite direction.
7. Only the proposer can edit or cancel a pending proposal.

## Notifications and Discord

Every challenge action creates a persisted in-app notification for the other affected player. Public challenge events may also be sent to `DISCORD_P2P_CHALLENGE_CHANNEL_ID` as an optional side effect. Discord delivery failures are logged and do not invalidate a successful challenge operation.

Before proposing or editing slots, the frontend checks the authenticated participants' active P2P and tournament proposals. Reserved slots are shown with a source-specific color and cannot be selected. The proposal currently being answered or edited is excluded from the conflict lookup so its own slots remain usable.

The availability grid keeps its expensive slot generation, availability lookup, and virtualized columns memoized. Parent forms also keep grid inputs stable while notes are edited, so typing does not rebuild the full matrix.

The legacy `superseded` status remains readable for historical data, but new proposals are no longer automatically marked superseded. Overlapping slots are rejected instead, while non-overlapping proposals remain independent.

The current event categories are proposal, confirmation, rejection, counter-proposal, update, and cancellation. Public Discord messages use application nicknames and UTC slot ranges; they do not depend on Discord usernames, discriminators, or internal Discord user IDs.

## Maintenance policy

When behavior changes, update the English comments/JSDoc next to the implementation first. Update this document only when the architecture, lifecycle, supported operations, persistence model, or notification policy changes. Keep exact route contracts in `API_ENDPOINTS.md` and operational test procedures under `tests/e2e/`.
