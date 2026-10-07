-- matches had two identical foreign keys on replay_id (audit finding 14):
-- fk_matches_replay_id, from the 2026-02-18 replay processing migration,
-- and fk_matches_replay, which the 2026-02-21 migrations recreate. Both are
-- ON DELETE SET NULL / ON UPDATE RESTRICT and share the idx_replay_id index
-- (checked on production 2026-10-08), so dropping the older one changes no
-- behavior and leaves no orphan index. IF EXISTS keeps the migration safe on
-- databases where it was never created.
ALTER TABLE matches DROP FOREIGN KEY IF EXISTS fk_matches_replay_id;
