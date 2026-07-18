# Tournament phase engine

## Architecture

The version 2 competition model separates tournament identity and registration from its competitive structure. A tournament owns an ordered phase graph. Each phase uses Swiss, round robin, or single elimination and may contain parallel groups or brackets. Groups own rounds, rounds own best-of series, and series own individual games.

`tournament_entries` provides a stable competitive identity for either an accepted participant or a complete team. This avoids polymorphic player/team columns throughout the competition graph. Advancement rules form a directed acyclic graph from a finalized source rank to a target group preclassification.

The legacy tables remain present during validation. `competition_model_version` selects the engine; new tournaments created with a phase definition use version 2. Ranked `matches`, `users_extension`, `replays`, and `replays.match_id` remain outside the replacement boundary.

## Format workflow

Organizers can start from a template or edit phases, parallel group counts, systems, best-of values, assignment policies, and system-specific settings. The server validates the complete graph before replacing a configurable format in one transaction. A format becomes immutable when preparation compiles accepted participants or complete teams into entries, rounds, series, bracket slots, and initial games.

“Preclassification” is the UI term for a seed. It controls initial distribution or bracket position; it is not a score or a final rank.

Swiss rounds are paired when the prior round completes, preferring opponents that have not already met. Round robin schedules use the Berger rotation. Elimination brackets persist slot provenance, so a slot can point to a group preclassification or to the winner of an earlier series.

## Forum identity and replay linking

The official forum topic URL is optional in every environment. The backend extracts and stores its numeric `t` parameter. When it exists, the recommended Wesnoth room name is `T<topic-id>`; otherwise the exact tournament name is used.

Replay resolution prefers an explicit forum code and then an exact tournament name. It then resolves the participant/team pair against one open phase game. Zero or multiple candidates remain unlinked for manual confirmation. The phase-game link is additive and never removes or replaces the ranked `replays.match_id` relationship.

## Test workflow

The test-only join tool writes accepted registrations to the retained participant and team tables. Preparation is the integration boundary that converts those registrations into version 2 tournament entries. The Admin Replays simulator lists only active `tournament_games` and records results through the same phase progression service used by parsed replays; it does not fall back to legacy tournament match tables.

The Playwright scenario exercises format creation, simulated individual or team registration, preparation, phase starts, game results, advancement, brackets, and final tournament completion. Authentication state is generated locally and excluded from version control. Run `npm run test:e2e:list` to validate discovery, or `npm run test:e2e` against the configured test deployment.

## Rollout

Deployment follows four separate stages:

1. **Expand:** apply the additive migration and deploy code that can read both models.
2. **Migrate:** purge disposable test tournaments, run representative tournament scenarios, and audit the production team league for optional migration.
3. **Switch:** deploy with no active production tournaments and create new competitions with version 2.
4. **Contract:** after at least 14 days of stable production operation, remove frozen legacy columns, foreign keys, services, and UI in a separate migration and release.

The expansion migration is intentionally reversible at application level by switching back to legacy code before version 2 data becomes authoritative. The contract stage is not included in the expansion and must have its own backup, restore test, and approval.

## Deferred streaming scope

Streams remain a low-priority follow-up. The intended model attaches multiple stream records to a scheduled series, game, or broad round time window and introduces a streamer role. No stream field is embedded in a round or game because a round can span days and may have several simultaneous broadcasts.
