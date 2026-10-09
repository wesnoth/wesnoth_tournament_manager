-- Every tournament runs on the phase engine (version 2): the creation API now
-- requires a phase format and stores it in the same transaction as the
-- tournament, which also sets competition_model_version = 2. The default is
-- aligned so a row inserted by any other path is never a version 1 root
-- without a graph. Existing rows are not touched, and no version 1
-- tournaments remain (see docs/tournament-v2-legacy-cleanup-plan.md).
ALTER TABLE tournaments ALTER COLUMN competition_model_version SET DEFAULT 2;
