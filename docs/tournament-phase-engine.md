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

## Discord progression notifications

Phase-engine notifications are emitted only after the corresponding database transaction commits. Starting a phase publishes its format, active rounds, and currently available pairings. Completing a round publishes that group's standings with points and OMP/GWP/OGP tiebreakers; completing a phase publishes finalized standings and marks entries that advance through configured qualification rules. Tournament completion publishes the champion, runner-up, and final-phase standings. Team entry names include their accepted members.

Discord delivery is best-effort. Query, formatting, credential, or API failures are logged but never roll back a phase transition, recorded result, or completed tournament.

## Administrative results

Organizers may award an unresolved version 2 series administratively. The pending game records the administrative action for audit and presentation, while the series advances with its required winning score. Administrative awards count as series wins and losses but not as played games for GWP or OGP calculations. Competition views present them separately from played matches and automatic byes. Converted legacy competitions recover the same presentation by comparing authoritative series counters with their copied played games.

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

Before migrating a retained legacy tournament, run the read-only audit with an explicit deployment environment: `npm run audit:tournament-migration:test -- --tournament=<uuid>` in TEST or `npm run audit:tournament-migration:production -- --tournament=<uuid>` in production. The report never mutates tournament data.

The legacy converter is deliberately limited to the two retained production formats: completed version 1 team leagues become one- or two-cycle round-robin phases, and completed version 1 individual elimination tournaments become single-elimination brackets. League elimination and individual round-robin combinations are rejected. It preserves registrations and team-replacement history, copies rounds, authoritative series outcomes, played games, rankings and tiebreakers, keeps ranked `matches` links, and adds version 2 replay and scheduling links without removing their legacy links. Administrative placeholder games remain in the frozen legacy history; their authoritative series winner and score are copied without misrepresenting those placeholders as played games. Embedded legacy series schedules become series-linked proposals and slots, but the converter never invents individual confirmation records that were not stored. For elimination, it reconstructs each round from actual winners and byes, records bracket slot provenance, and materializes only champion and runner-up so lower positions continue to use the phase engine's elimination-round and game-margin rules. Any incomplete, inconsistent, ambiguous, or already partially converted history blocks the conversion.

Run conversion as a two-step operation:

1. Build the backend and run `npm run test:tournament-migration`, then generate a read-only reconciliation plan with `npm run migrate:tournament:legacy:test -- --tournament=<uuid>` in TEST or `npm run migrate:tournament:legacy:production -- --tournament=<uuid>` in production. Dry-run is the default and rolls back its transaction.
2. After reviewing a plan with no errors, apply it with the same environment-specific command plus `--apply --confirm=<same-uuid>`. The UUID confirmation prevents accidental writes to a different tournament.

Apply mode locks the legacy tournament row, writes the complete version 2 graph in one transaction, reconciles every copied count, standing, series result, game result, ranked match link, replay link, and schedule link, and changes `competition_model_version` only after all checks pass. Any failure rolls back the complete operation. Retain a database backup and the dry-run JSON report as release evidence even though legacy rows are not deleted.

## Deferred streaming scope

Streaming remains a low-priority follow-up. The platform will not host or deliver video; it will manage external stream links and their relationship with tournament games.

`streamer` is a global user capability, independent of the user's other capabilities. A user may therefore be a regular user, moderator, administrator, or any combination of one of those capabilities with streamer status. Streamer status is not declared, approved, or scoped per tournament. Any user with streamer status may prepare streams for any tournament; tournament organizers do not need to maintain a tournament-specific streamer roster.

The players query and player list must expose streamer status so users can identify which accounts are available to prepare broadcasts. This indicator is additive and must remain visible alongside, rather than replace, the user's regular, moderator, or administrator role information.

Granting or revoking streamer status is an administrative security-sensitive action and must create an audit event containing the acting administrator and the target user's identity.

A stream link is planned by linking it directly to one pending game. Phase, group, round, series, tournament, and participant context is derived from that game link rather than being a separate stream target. The initial version does not support phase-level or group-level broadcasts without game links. A game may have multiple stream links. If one broadcast covers multiple games, the streamer creates one game link for each covered game; the model does not introduce a separate multi-game association.

The external URL may be added or updated while the game is pending. Completing a game does not remove or invalidate its stream links: the relationship remains queryable from the completed game and from the finalized tournament, allowing users to access the broadcast after competition has ended. Deleting or replacing a stream link must be an explicit action and must not be coupled to result recording or tournament finalization.
