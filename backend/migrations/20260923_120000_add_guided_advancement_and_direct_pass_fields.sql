ALTER TABLE tournament_phase_groups
  ADD COLUMN advance_count SMALLINT NULL AFTER name,
  ADD COLUMN direct_advancement_slots SMALLINT NOT NULL DEFAULT 0 AFTER advance_count,
  ADD CONSTRAINT chk_tournament_phase_group_advance_count CHECK (advance_count IS NULL OR advance_count >= 1),
  ADD CONSTRAINT chk_tournament_phase_group_direct_slots CHECK (direct_advancement_slots >= 0);

ALTER TABLE tournament_phase_entry_assignments
  MODIFY COLUMN group_seed INT NULL,
  ADD COLUMN assignment_type VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual' AFTER group_seed,
  ADD COLUMN direct_round_number SMALLINT NULL AFTER assignment_type,
  ADD COLUMN direct_series_position SMALLINT NULL AFTER direct_round_number,
  ADD COLUMN direct_slot_number TINYINT NULL AFTER direct_series_position,
  ADD CONSTRAINT chk_tournament_phase_assignment_type CHECK (assignment_type IN ('manual', 'direct_pass')),
  ADD CONSTRAINT chk_tournament_phase_assignment_direct_slot CHECK (
    (direct_round_number IS NULL AND direct_series_position IS NULL AND direct_slot_number IS NULL)
    OR (assignment_type = 'direct_pass' AND direct_round_number >= 1 AND direct_series_position >= 1 AND direct_slot_number IN (1, 2))
  ),
  ADD UNIQUE KEY uq_tournament_phase_assignment_direct_slot
    (group_id, direct_round_number, direct_series_position, direct_slot_number);

ALTER TABLE tournament_participants
  ADD COLUMN direct_group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL AFTER team_position,
  ADD COLUMN direct_round_number SMALLINT NULL AFTER direct_group_id,
  ADD COLUMN direct_series_position SMALLINT NULL AFTER direct_round_number,
  ADD COLUMN direct_slot_number TINYINT NULL AFTER direct_series_position,
  ADD COLUMN direct_pass_note VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER direct_slot_number,
  ADD KEY idx_tournament_participants_direct_group (direct_group_id);

ALTER TABLE tournament_teams
  ADD COLUMN direct_group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL AFTER team_elo,
  ADD COLUMN direct_round_number SMALLINT NULL AFTER direct_group_id,
  ADD COLUMN direct_series_position SMALLINT NULL AFTER direct_round_number,
  ADD COLUMN direct_slot_number TINYINT NULL AFTER direct_series_position,
  ADD COLUMN direct_pass_note VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER direct_slot_number,
  ADD KEY idx_tournament_teams_direct_group (direct_group_id);
