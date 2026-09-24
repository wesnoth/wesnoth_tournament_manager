# Tournament v2 legacy cleanup plan

## Status

This work is deferred until the tournament that was active on 2026-09-08 has finished. This document records the investigation and the proposed sequence only. It does not authorize code changes, schema changes, data migrations, or production commands.

The cleanup must be delivered as several small releases. Destructive schema changes come only after the application no longer reads or writes the affected fields and production observations confirm that the compatibility paths are unused.

## Current boundary

The version 2 competition graph is stored in phases, groups, entries, rounds, series, and games. The root tournament, registration, team, ranked match, and replay models are shared infrastructure and remain in use.

The following version 1 competition tables were already removed by `backend/migrations/20260805_150000_remove_legacy_tournament_tables.sql` and are absent from the canonical schema:

- `tournament_rounds`
- `tournament_round_matches`
- `tournament_matches`
- `tournament_round_byes`

The following tables remain valid and are not part of the legacy competition removal:

- `tournaments`
- `tournament_participants`
- `tournament_teams`
- `matches`
- `replays`
- `tournament_unranked_factions`
- `tournament_unranked_maps`

The last two names describe their original purpose poorly, but the current application uses them as tournament asset allow lists in more than one mode. Renaming them is a separate refactor.

## Confirmed cleanup candidates

### Orphaned schema fields

No current application path was found reading or writing these version 1 relationship fields:

- `match_schedule_proposals.tournament_round_match_id`
- `match_schedule_proposals.tournament_match_id`
- `replays.tournament_round_match_id`
- `replays.tournament_match_id`
- `matches.round_id`

Their associated indexes are also candidates for removal:

- `idx_round_match_id`
- `idx_match_id`
- `idx_replay_trm_id`

`matches_faction_fix_backup_20260429` has no identified application consumer. Treat it as an independent backup-table cleanup so its retention decision and backup evidence are explicit.

### Backend compatibility code

The application still contains HTTP compatibility handlers that return `410 Gone` for removed tournament and scheduling routes. These handlers are useful only while old clients or saved links may still call them. Remove them after endpoint telemetry shows an agreed period with no relevant traffic.

The old `GET /:id/ranking` implementation remains in the tournament router but is intercepted by the compatibility layer, so it is unreachable through the mounted application. It can be deleted with the other retired backend routes.

### Frontend compatibility code

The API client still exposes version 1 methods for tournament rounds, standings, tournament matches, round matches, result recording, winner determination, next-round start, and tournament tiebreaker calculation.

`TournamentDetail` also retains hidden version 1 tabs, state, actions, modals, and rendering branches. Version 2 clears the old arrays and renders `TournamentCompetitionView` and `TournamentOverallStandings`. These hidden branches should be removed only after confirming there are no supported version 1 tournaments.

### Migration tooling and documentation

`backend/src/migrations/` contains an obsolete PostgreSQL-style migration set, while the active runner reads `backend/migrations/`. `backend/src/scripts/migrate.ts` is an unused alternative runner. The backend package script also refers to `scripts/migrate.js`, which does not exist.

Do not delete the SQL history under `backend/migrations/`. Fresh installations and upgrades need the complete active migration chain, including the migration that removes the old competition tables.

The following documentation is stale and must be corrected when the relevant cleanup lands:

- `README.md` still describes version 1 tournament tables and queries.
- `docs/tournament-phase-engine.md` still says the legacy tables remain present.
- `DB_SCHEMA.md` still includes version 1 relationships and aggregate fields.

## Fields that require a product decision

These fields are mixed with active version 2 behavior and are not safe first-pass deletions:

- `competition_model_version` still selects validation, compilation, API, event, test, and frontend paths. Its schema default is still version 1, while saving a phase format changes the tournament to version 2.
- `tournament_type`, `general_rounds`, `final_rounds`, format fields, `total_rounds`, and `current_round` still feed UI, API, notifications, or summaries even where the phase graph contains equivalent information.
- `auto_progress` is consumed by the compiler. `auto_advance_round` remains exposed through UI and API paths, and current writes keep the two concepts aligned.
- Participant and team aggregates such as tournament wins, losses, points, OMP, GWP, OGP, and current round have no identified version 2 writer. Hidden version 1 UI still reads some of them.
- `tournament_ranking` remains an input to version 2 entry seeding in the competition compiler. An explicit replacement seeding rule is required before removing it.
- `tournament_participants.status` appears to be a public compatibility field, while `participation_status` is authoritative. Confirm all API consumers before consolidating it.
- `tournament_teams.status` is actively used to select complete or active teams and must remain.
- `legacy_admin_decision` is still synthesized for converted series that have authoritative counters but no explicit organizer action. Converted historical data must be audited and normalized before this fallback can disappear.

## Preconditions

Cleanup begins only when all of these conditions are true:

1. The active tournament has completed and its final standings, progression, replays, schedules, and notifications have been checked.
2. A production backup exists and its restore procedure has been tested on an isolated database.
3. Every supported tournament has a complete version 2 phase graph and `competition_model_version = 2`.
4. No current client depends on version 1 endpoints or frontend routes.
5. Integration tests cover all supported formats and the full lifecycle from creation through completion.
6. Application code has stopped reading and writing each field before a migration drops it.
7. The production audit results and deployment decision are retained with the release evidence.

## Read-only production audit

Run these checks only after the tournament finishes and only with explicit authorization for production access.

Confirm that the old competition tables are absent:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'tournament_rounds',
    'tournament_round_matches',
    'tournament_matches',
    'tournament_round_byes'
  );
```

Inventory tournament engine versions and statuses:

```sql
SELECT competition_model_version, status, COUNT(*) AS tournament_count
FROM tournaments
GROUP BY competition_model_version, status
ORDER BY competition_model_version, status;
```

Find tournaments that are not version 2 or have no phase graph:

```sql
SELECT
  t.id,
  t.name,
  t.status,
  t.competition_model_version,
  COUNT(DISTINCT p.id) AS phase_count
FROM tournaments t
LEFT JOIN tournament_phases p ON p.tournament_id = t.id
GROUP BY t.id, t.name, t.status, t.competition_model_version
HAVING t.competition_model_version <> 2 OR COUNT(DISTINCT p.id) = 0
ORDER BY t.created_at;
```

Measure residual values in orphaned relationship fields:

```sql
SELECT
  COUNT(*) AS proposal_count,
  SUM(tournament_round_match_id IS NOT NULL) AS proposals_with_round_match,
  SUM(tournament_match_id IS NOT NULL) AS proposals_with_tournament_match
FROM match_schedule_proposals;

SELECT
  COUNT(*) AS replay_count,
  SUM(tournament_round_match_id IS NOT NULL) AS replays_with_round_match,
  SUM(tournament_match_id IS NOT NULL) AS replays_with_tournament_match
FROM replays;

SELECT
  COUNT(*) AS match_count,
  SUM(round_id IS NOT NULL) AS matches_with_round
FROM matches;
```

Before removing aggregate or administrative compatibility fields, add audit queries that compare them with `tournament_phase_standings`, series counters, played games, and explicit organizer actions. The queries must report mismatches rather than mutate data.

Collect server access metrics for the old routes that currently return `410 Gone`. Agree on an observation window before removing those handlers.

## Delivery sequence

### 1. Close the version 2 creation contract

- Require a valid phase `format_definition` in the tournament creation API.
- Create the root tournament and its phase graph atomically.
- Change the database and application defaults to version 2 only after the atomic path exists.
- Reject incomplete version 2 tournaments instead of silently retaining a version 1 root row.
- Add integration coverage for individual and team tournaments across Swiss, round robin, elimination, and mixed phase graphs.

This release establishes that new data cannot recreate the legacy state after cleanup starts.

### 2. Remove frontend version 1 behavior

- Delete the unused API client methods.
- Remove the hidden version 1 tabs, state, actions, and modals from `TournamentDetail`.
- Keep version 2 competition and overall standings components as the only supported tournament views.
- Split `TournamentDetail` into smaller responsibility-based components during or immediately after the removal, without changing visible behavior.
- Update help hooks only when their related controls are removed or conceptually changed.

Validate tournament viewing, organizer actions, scheduling, standings, replay links, administrative results, and responsive layouts.

### 3. Remove backend version 1 behavior

- Delete unreachable ranking and competition handlers.
- Remove `410 Gone` compatibility shims after the telemetry window passes.
- Remove unused version 1 services, types, validation, and conversion-only code that has no remaining operational or audit purpose.
- Remove the inactive migration runner and obsolete `backend/src/migrations/` tree.
- Repair the backend migration package command so it points to the one supported runner.

Keep conversion reports or historical migration tools outside the runtime path if they are still needed as audit evidence.

### 4. Apply the low-risk schema contraction

Use one self-contained MariaDB migration under `backend/migrations/` to remove only fields whose code consumers were removed in earlier releases:

- Old scheduling relationship columns and their indexes.
- Old replay relationship columns and their indexes.
- `matches.round_id` and its index or foreign key, if present in the deployed schema.

Handle `matches_faction_fix_backup_20260429` in a separate migration or operational task after confirming that its backup is no longer required.

Update `backend/src/config/schema.sql` and `DB_SCHEMA.md` in the same change. Use unqualified table names, preserve the required UUID collations on retained relationships, and validate the migration with the database schema reviewer.

### 5. Consolidate mixed fields

Treat each item as a separate, reviewable change:

- Replace `tournament_ranking` as an implicit seed source with an explicit version 2 seed policy.
- Remove obsolete participant and team standings aggregates after reconciliation proves phase standings are authoritative.
- Consolidate participant status fields after checking API compatibility.
- Decide whether tournament summary fields should be retained, derived from the phase graph, or stored as cached values with one authoritative writer.
- Consolidate automatic progression settings into one clearly defined field.
- Normalize converted administrative decisions and then remove the legacy presentation fallback.
- Remove `competition_model_version` last, after no branch, schema default, event, test, or client depends on it.

## Validation matrix

Run the final candidate against both a restored production clone and a clean database built from the complete migration history.

For each supported individual and team format, validate:

- Creation, registration, preparation, and start.
- Swiss pairing, odd-player Swiss byes, and out-of-order round completion where supported.
- Round-robin groups, including odd-player rest rounds with no awarded point.
- Elimination progression and automatic byes without standings points.
- Played wins, ordinary organizer-recorded wins, and administrative series awards.
- OMP, GWP, and OGP recalculation and group result notification.
- Scheduling proposals and confirmations.
- Replay linking to ranked matches and version 2 games.
- Qualification between phases, final standings, tournament completion, and Discord events.
- Public, participant, organizer, moderator, and administrator views.

The existing engine self-test and source-based group progression test are insufficient for schema contraction. Add database-backed integration tests that assert transactions, stored graph state, standing rows, and progression after each result.

## Deployment and rollback

Use separate releases for code cleanup and destructive schema contraction. Deploy code that no longer uses a field first, observe it, and drop the field in a later release.

MariaDB DDL rollback is limited, so rollback of the contraction release depends on a tested database restore plus the previous application release. Record the backup identifier, restore test result, migration output, schema snapshot, and smoke-test result before promotion.

After each release, monitor unknown-column errors, unexpected `404` or `410` responses, replay linking failures, scheduling failures, standings discrepancies, and phase progression errors. Stop the sequence and restore the previous release if any authoritative tournament data cannot be reconciled.

## Completion criteria

The cleanup is complete when:

- All supported tournaments use one version 2 creation and runtime path.
- No runtime code or client method references version 1 competition tables or endpoints.
- No compatibility branch depends on `competition_model_version`.
- Scheduling, replay, and ranked match tables contain only current relationships.
- Participant and team fields have one documented authority for status, seed, and standings.
- The active migration runner, canonical schema, and schema documentation agree.
- Upgrade and clean-install tests pass, and production monitoring shows no legacy traffic or schema errors.
