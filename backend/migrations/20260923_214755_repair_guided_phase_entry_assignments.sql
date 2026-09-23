-- 20260923_214755_repair_guided_phase_entry_assignments.sql
-- Repair guided phase entry assignments
--
-- Migration for Wesnoth Tournament Manager
-- Use unqualified table names only.
-- Never modify forum.* tables.

-- The original guided-advancement migration was recorded before its final
-- assignment-table changes were added to the file. Migration runners skip
-- recorded filenames, so apply the missing assignments update under a new
-- migration name.
ALTER TABLE tournament_phase_entry_assignments
  MODIFY COLUMN group_seed INT NULL,
  ADD COLUMN IF NOT EXISTS assignment_type VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual' AFTER group_seed,
  ADD COLUMN IF NOT EXISTS direct_round_number SMALLINT NULL AFTER assignment_type,
  ADD COLUMN IF NOT EXISTS direct_series_position SMALLINT NULL AFTER direct_round_number,
  ADD COLUMN IF NOT EXISTS direct_slot_number TINYINT NULL AFTER direct_series_position,
  ADD CONSTRAINT chk_tournament_phase_assignment_type CHECK (assignment_type IN ('manual', 'direct_pass')),
  ADD CONSTRAINT chk_tournament_phase_assignment_direct_slot CHECK (
    (direct_round_number IS NULL AND direct_series_position IS NULL AND direct_slot_number IS NULL)
    OR (assignment_type = 'direct_pass' AND direct_round_number >= 1 AND direct_series_position >= 1 AND direct_slot_number IN (1, 2))
  ),
  ADD UNIQUE KEY uq_tournament_phase_assignment_direct_slot
    (group_id, direct_round_number, direct_series_position, direct_slot_number);
