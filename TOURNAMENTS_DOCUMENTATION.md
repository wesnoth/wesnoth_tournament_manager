# Tournaments

This document describes the stable tournament model shared by `/tournaments`, `/my-tournaments`, and `/tournament/:id`. Source comments and JSDoc remain the detailed source of truth for SQL, validation, pairing, and transition behavior.

## Pages and ownership

- `/tournaments` is the public paginated catalogue. Text filters apply on Enter or Refresh; select filters apply immediately.
- `/my-tournaments` is the authenticated organizer workspace. It lists tournaments where the user is either creator or co-organizer and provides tournament creation.
- `/tournament/:id` is the public detail and operational workspace. Authenticated visitors retain the shared user navigation; organizer controls are available to creators and co-organizers.

The creator is always an organizer. Co-organizers have the same tournament-management authorization, but the creator identity remains immutable.

## Competitive modes

| Mode | Competitive unit | Rating | Asset policy |
| --- | --- | --- | --- |
| `ranked` | One player | Results affect player ELO | Only active ranked factions and maps may be selected. |
| `unranked` | One player | No ELO change | Any active configured factions and maps may be selected. |
| `team` | One 2v2 team | No ELO change | Any active configured factions and maps may be selected. Pairing and standings IDs represent teams. |

During registration, a team may be incomplete while members request, confirm, and receive organizer acceptance. During replacement, three participant records may temporarily reference the team: two competitive members and one unconfirmed substitute. The outgoing `pending_replacement` member remains competitive until confirmation atomically promotes the substitute. Preparation and pairing therefore require exactly two competitive members with status `accepted` or `pending_replacement`; an `unconfirmed` substitute is not yet competitive.

For team tournaments, `max_participants` is the maximum number of teams, not players. Live team ELO is the sum of the two competitive members and is used only as a deterministic pairing or ranking fallback; it is not persisted as a rating result.

## Tournament formats

- **Elimination:** the bracket depth is calculated from the accepted field. Non-power-of-two fields receive byes where required. Winners advance until the final.
- **League:** Berger round-robin scheduling is generated during preparation. One wave plays every opponent once; two waves repeat with reversed sides. A wave uses `N-1` rounds for an even field and `N` rounds for an odd field.
- **Swiss:** each round pairs competitors by score and tiebreakers while avoiding rematches where possible. Odd fields receive one bye. Swiss tournaments support 1 to 10 rounds.
- **Swiss-Elimination:** 1 to 10 Swiss rounds qualify the top `2^final_rounds` competitors for a 1 to 3 round elimination bracket. Tiebreakers must be calculated successfully before qualification.

Each round has a `bo1`, `bo3`, or `bo5` series format. A round-level pairing is stored separately from its individual games.

## Lifecycle

The canonical lifecycle is:

1. `registration_open`: participants request entry, confirmations and organizer acceptance are resolved, configuration and assets remain editable.
2. `registration_closed`: the competitive field is fixed and invalid/incomplete teams are excluded.
3. `prepared`: rounds and any pre-generated league pairings exist. Failed preparation removes its partial schedule and remains retryable.
4. `in_progress`: the real `started_at` timestamp is recorded and the first round starts. League rounds open together; other formats progress sequentially.
5. `finished`: all required rounds are complete, final tiebreakers are stored, and the winner is resolved.

`scheduled_start_at` is an organizer-controlled informational date that may be changed before the tournament starts. It is intentionally separate from `started_at`, which is the immutable operational timestamp written by the Start action.

Lifecycle fields cannot be changed through the general configuration endpoint. Closing registration, preparing, starting, and advancing use dedicated endpoints so each transition validates its prerequisites.

## Round progression and standings

Manual progression and `auto_advance_round` use the same round activation function. Automatic advancement occurs only after a non-empty round has completed all of its series. League rounds are already active concurrently and finish only when no open league round remains.

Standings use tournament points and wins followed by OMP, GWP, and OGP. Individual and team calculations read completed round series. A tiebreak calculation failure blocks qualification or final winner selection rather than silently selecting from stale values.

## Assets and rules

Tournament asset associations are a per-tournament allow-list. Replacing the faction and map sets is atomic, and empty arrays intentionally clear a set. Associations can change only before preparation. Ranked mode rejects non-ranked assets at the backend boundary.

Rules may be bootstrapped from an active reusable template. The template Markdown is copied into the tournament, after which the tournament owns an editable snapshot and later template changes do not alter existing rules.

## Related documentation

- [TOURNAMENT_SCHEDULING_DOCUMENTATION.md](TOURNAMENT_SCHEDULING_DOCUMENTATION.md): participant negotiation of match times.
- [ADMIN_TOURNAMENTS_DOCUMENTATION.md](ADMIN_TOURNAMENTS_DOCUMENTATION.md): administrator list and cancellation policy.
- [ADMIN_RULE_TEMPLATES_DOCUMENTATION.md](ADMIN_RULE_TEMPLATES_DOCUMENTATION.md): reusable rule templates.
- [API_ENDPOINTS.md](API_ENDPOINTS.md): route contracts and authorization.
- [DB_SCHEMA.md](DB_SCHEMA.md): persisted tables and columns.
