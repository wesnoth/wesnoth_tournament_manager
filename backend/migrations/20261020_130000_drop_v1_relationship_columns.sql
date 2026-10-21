-- Tournament v2 legacy cleanup, step 4 (docs/tournament-v2-legacy-cleanup-plan.md).
--
-- Drops the version 1 relationship columns. Their target tables
-- (tournament_round_matches, tournament_matches, tournament_rounds) were
-- removed by migration 20260805_150000, no application source reads or
-- writes them (scripts/check-legacy-columns.mjs enforces it in npm run
-- verify), and no foreign key references them.
--
-- Production audit 2026-10-20 (read-only): match_schedule_proposals 0 of 2
-- rows with a value, matches.round_id 0 of 502, replays 17 of 650. Those 17
-- replays are completed, linked to their tournament and phase-engine game
-- (tournament_game_id), and date from 2026-03-27 to 2026-06-02, so the
-- dropped ids pointed to rows that no longer exist.
--
-- Columns are dropped by name, not their indexes, because index names
-- differ between installations (a deployed replays table also carries
-- fk_replays_tournament_match_id). MariaDB removes a single-column index
-- together with its column. IF EXISTS keeps a rerun harmless.

ALTER TABLE match_schedule_proposals
  DROP COLUMN IF EXISTS tournament_round_match_id,
  DROP COLUMN IF EXISTS tournament_match_id;

ALTER TABLE replays
  DROP COLUMN IF EXISTS tournament_round_match_id,
  DROP COLUMN IF EXISTS tournament_match_id;

ALTER TABLE matches
  DROP COLUMN IF EXISTS round_id;
