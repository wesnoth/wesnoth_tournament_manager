# TODO

## Match metadata cleanup

- Treat `matches` as the source of truth for every ranked match, including P2P matches and tournament matches.
- Keep every non-cancelled `matches` row in ranked statistics, regardless of whether it has a `tournament_id`.
- Keep `matches.tournament_id` because it links ranked tournament matches to their tournament context.
- Before changing the `matches` table, analyze the impact across schema, imports, APIs, pages, reports, and maintenance tools.
- First review and correct the replay import and replay confirmation processes that write rows to `matches`.
- Then review the pages and backend routes that display or consume `matches` data.
- Only after those reviews prepare and apply a migration that removes the redundant columns.
- Trace and remove readers and writers of the redundant `matches.tournament_mode` and `matches.tournament_type` columns.
- Recover tournament mode/type with a join to `tournaments` through `matches.tournament_id` when a feature needs that context.
- Prepare a schema migration to remove only `matches.tournament_mode` and `matches.tournament_type` after all application code has migrated.
- Do not use `tournament_mode` values such as `ladder` as a statistics filter; only `status = 'cancelled'` excludes a match.

## Statistics history

- Replace the current event snapshot marker semantics with dynamic event-to-event boundaries.
- Mark `balance_events.snapshot_before_date` and `snapshot_after_date` as legacy fields, then remove them only after the statistics page no longer depends on them.
- Rebuild test data after metadata normalization and compare live aggregates with cumulative snapshots.
- Keep cancelled matches excluded from derived statistics without deleting their historical records.
