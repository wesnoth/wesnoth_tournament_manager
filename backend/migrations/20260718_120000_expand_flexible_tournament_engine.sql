-- Additive expansion for the phase-based tournament engine.
-- Legacy tournament tables and columns remain available during validation.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS forum_topic_id BIGINT UNSIGNED NULL AFTER description,
  ADD COLUMN IF NOT EXISTS competition_model_version SMALLINT NOT NULL DEFAULT 1 AFTER forum_topic_id,
  ADD COLUMN IF NOT EXISTS auto_progress TINYINT(1) NOT NULL DEFAULT 0 AFTER auto_advance_round,
  ADD UNIQUE KEY IF NOT EXISTS uq_tournaments_forum_topic_id (forum_topic_id);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  tournament_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  entry_type VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  participant_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  team_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  initial_seed INT NULL,
  status VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_entries_participant (tournament_id, participant_id),
  UNIQUE KEY uq_tournament_entries_team (tournament_id, team_id),
  KEY idx_tournament_entries_tournament_status (tournament_id, status),
  KEY idx_tournament_entries_participant (participant_id),
  KEY idx_tournament_entries_team (team_id),
  CONSTRAINT chk_tournament_entry_type CHECK (entry_type IN ('player', 'team')),
  CONSTRAINT chk_tournament_entry_entity CHECK (
    (entry_type = 'player' AND participant_id IS NOT NULL AND team_id IS NULL)
    OR (entry_type = 'team' AND participant_id IS NULL AND team_id IS NOT NULL)
  ),
  CONSTRAINT chk_tournament_entry_status CHECK (status IN ('active', 'withdrawn', 'disqualified')),
  CONSTRAINT fk_tournament_entries_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_entries_participant FOREIGN KEY (participant_id) REFERENCES tournament_participants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_entries_team FOREIGN KEY (team_id) REFERENCES tournament_teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phases (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  tournament_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  phase_order SMALLINT NOT NULL,
  name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  description VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  format VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  assignment_method VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  default_best_of SMALLINT NOT NULL DEFAULT 3,
  status VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  auto_start TINYINT(1) NOT NULL DEFAULT 0,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_phases_order (tournament_id, phase_order),
  KEY idx_tournament_phases_status (tournament_id, status),
  CONSTRAINT chk_tournament_phase_format CHECK (format IN ('swiss', 'round_robin', 'single_elimination')),
  CONSTRAINT chk_tournament_phase_assignment CHECK (assignment_method IN ('manual', 'random', 'seeded_snake')),
  CONSTRAINT chk_tournament_phase_best_of CHECK (default_best_of IN (1, 3, 5)),
  CONSTRAINT chk_tournament_phase_status CHECK (status IN ('draft', 'pending', 'ready', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT fk_tournament_phases_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_swiss_settings (
  phase_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  round_count SMALLINT NOT NULL,
  pairing_policy VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'score_then_tiebreak',
  avoid_rematches TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (phase_id),
  CONSTRAINT chk_tournament_swiss_round_count CHECK (round_count BETWEEN 1 AND 20),
  CONSTRAINT fk_tournament_swiss_phase FOREIGN KEY (phase_id) REFERENCES tournament_phases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_round_robin_settings (
  phase_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  cycle_count SMALLINT NOT NULL DEFAULT 1,
  open_rounds_together TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (phase_id),
  CONSTRAINT chk_tournament_round_robin_cycles CHECK (cycle_count IN (1, 2)),
  CONSTRAINT fk_tournament_round_robin_phase FOREIGN KEY (phase_id) REFERENCES tournament_phases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_elimination_settings (
  phase_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  bracket_size INT NULL,
  seeding_policy VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'seeded',
  reseed_each_round TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (phase_id),
  CONSTRAINT chk_tournament_elimination_bracket CHECK (bracket_size IS NULL OR bracket_size >= 2),
  CONSTRAINT chk_tournament_elimination_seeding CHECK (seeding_policy IN ('seeded', 'random', 'manual')),
  CONSTRAINT fk_tournament_elimination_phase FOREIGN KEY (phase_id) REFERENCES tournament_phases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phase_round_overrides (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  phase_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  round_from_start SMALLINT NULL,
  round_from_end SMALLINT NULL,
  best_of SMALLINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_tournament_phase_round_overrides_phase (phase_id),
  CONSTRAINT chk_tournament_phase_round_override_selector CHECK (
    (round_from_start IS NOT NULL AND round_from_end IS NULL AND round_from_start >= 1)
    OR (round_from_start IS NULL AND round_from_end IS NOT NULL AND round_from_end >= 1)
  ),
  CONSTRAINT chk_tournament_phase_round_override_best_of CHECK (best_of IN (1, 3, 5)),
  CONSTRAINT fk_tournament_phase_round_overrides_phase FOREIGN KEY (phase_id) REFERENCES tournament_phases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phase_groups (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  phase_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  group_order SMALLINT NOT NULL,
  name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  status VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_phase_groups_order (phase_id, group_order),
  KEY idx_tournament_phase_groups_status (phase_id, status),
  CONSTRAINT chk_tournament_phase_group_status CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT fk_tournament_phase_groups_phase FOREIGN KEY (phase_id) REFERENCES tournament_phases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phase_entries (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  group_seed INT NULL,
  status VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  qualified_at DATETIME NULL,
  eliminated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_phase_entries_entry (group_id, entry_id),
  UNIQUE KEY uq_tournament_phase_entries_seed (group_id, group_seed),
  KEY idx_tournament_phase_entries_entry (entry_id),
  CONSTRAINT chk_tournament_phase_entry_status CHECK (status IN ('pending', 'active', 'qualified', 'eliminated', 'withdrawn')),
  CONSTRAINT fk_tournament_phase_entries_group FOREIGN KEY (group_id) REFERENCES tournament_phase_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_phase_entries_entry FOREIGN KEY (entry_id) REFERENCES tournament_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phase_entry_assignments (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  participant_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  team_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  group_seed INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_phase_assignment_participant (group_id, participant_id),
  UNIQUE KEY uq_tournament_phase_assignment_team (group_id, team_id),
  UNIQUE KEY uq_tournament_phase_assignment_seed (group_id, group_seed),
  KEY idx_tournament_phase_assignment_participant (participant_id),
  KEY idx_tournament_phase_assignment_team (team_id),
  CONSTRAINT chk_tournament_phase_assignment_entity CHECK (
    (participant_id IS NOT NULL AND team_id IS NULL)
    OR (participant_id IS NULL AND team_id IS NOT NULL)
  ),
  CONSTRAINT fk_tournament_phase_assignment_group FOREIGN KEY (group_id) REFERENCES tournament_phase_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_phase_assignment_participant FOREIGN KEY (participant_id) REFERENCES tournament_participants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_phase_assignment_team FOREIGN KEY (team_id) REFERENCES tournament_teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phase_scoring (
  phase_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  profile_code VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  win_points DECIMAL(8,2) NOT NULL DEFAULT 1.00,
  loss_points DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  bye_points DECIMAL(8,2) NOT NULL DEFAULT 1.00,
  PRIMARY KEY (phase_id),
  CONSTRAINT fk_tournament_phase_scoring_phase FOREIGN KEY (phase_id) REFERENCES tournament_phases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phase_tiebreakers (
  phase_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  priority SMALLINT NOT NULL,
  metric VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (phase_id, priority),
  UNIQUE KEY uq_tournament_phase_tiebreaker_metric (phase_id, metric),
  CONSTRAINT chk_tournament_phase_tiebreaker_metric CHECK (metric IN ('wins', 'omp', 'gwp', 'ogp', 'initial_seed', 'elo')),
  CONSTRAINT fk_tournament_phase_tiebreakers_phase FOREIGN KEY (phase_id) REFERENCES tournament_phases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_advancement_rules (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  source_group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  source_rank INT NOT NULL,
  target_group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  target_seed INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_advancement_target (target_group_id, target_seed),
  UNIQUE KEY uq_tournament_advancement_source_target (source_group_id, source_rank, target_group_id),
  KEY idx_tournament_advancement_source (source_group_id, source_rank),
  CONSTRAINT chk_tournament_advancement_rank CHECK (source_rank >= 1),
  CONSTRAINT chk_tournament_advancement_seed CHECK (target_seed >= 1),
  CONSTRAINT fk_tournament_advancement_source_group FOREIGN KEY (source_group_id) REFERENCES tournament_phase_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_advancement_target_group FOREIGN KEY (target_group_id) REFERENCES tournament_phase_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phase_rounds (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  round_number SMALLINT NOT NULL,
  name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  status VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  best_of SMALLINT NOT NULL,
  starts_at DATETIME NULL,
  deadline_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_phase_rounds_number (group_id, round_number),
  KEY idx_tournament_phase_rounds_status (group_id, status),
  CONSTRAINT chk_tournament_phase_round_status CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT chk_tournament_phase_round_best_of CHECK (best_of IN (1, 3, 5)),
  CONSTRAINT fk_tournament_phase_rounds_group FOREIGN KEY (group_id) REFERENCES tournament_phase_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_series (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  round_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  series_position SMALLINT NOT NULL,
  status VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  best_of SMALLINT NOT NULL,
  wins_required SMALLINT NOT NULL,
  entry1_wins SMALLINT NOT NULL DEFAULT 0,
  entry2_wins SMALLINT NOT NULL DEFAULT 0,
  winner_entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  loser_entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_series_position (round_id, series_position),
  KEY idx_tournament_series_status (round_id, status),
  KEY idx_tournament_series_winner (winner_entry_id),
  KEY idx_tournament_series_loser (loser_entry_id),
  CONSTRAINT chk_tournament_series_status CHECK (status IN ('pending', 'ready', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT chk_tournament_series_best_of CHECK (best_of IN (1, 3, 5)),
  CONSTRAINT fk_tournament_series_round FOREIGN KEY (round_id) REFERENCES tournament_phase_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_series_winner FOREIGN KEY (winner_entry_id) REFERENCES tournament_entries(id) ON DELETE SET NULL,
  CONSTRAINT fk_tournament_series_loser FOREIGN KEY (loser_entry_id) REFERENCES tournament_entries(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_series_slots (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  series_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  slot_number TINYINT NOT NULL,
  source_type VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  source_group_seed INT NULL,
  source_series_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  source_outcome VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  resolved_entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_series_slots_side (series_id, slot_number),
  KEY idx_tournament_series_slots_source_series (source_series_id),
  KEY idx_tournament_series_slots_entry (resolved_entry_id),
  CONSTRAINT chk_tournament_series_slot_number CHECK (slot_number IN (1, 2)),
  CONSTRAINT chk_tournament_series_slot_source CHECK (source_type IN ('direct', 'group_seed', 'series_result')),
  CONSTRAINT chk_tournament_series_slot_outcome CHECK (source_outcome IS NULL OR source_outcome IN ('winner', 'loser')),
  CONSTRAINT fk_tournament_series_slots_series FOREIGN KEY (series_id) REFERENCES tournament_series(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_series_slots_source_series FOREIGN KEY (source_series_id) REFERENCES tournament_series(id) ON DELETE SET NULL,
  CONSTRAINT fk_tournament_series_slots_entry FOREIGN KEY (resolved_entry_id) REFERENCES tournament_entries(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_games (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  series_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  game_number SMALLINT NOT NULL,
  entry1_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  entry2_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  winner_entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  loser_entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  match_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  status VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  organizer_action VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  map VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  winner_faction VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  loser_faction VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  winner_comments TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  winner_rating INT NULL,
  loser_comments TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  loser_rating INT NULL,
  replay_downloads INT NOT NULL DEFAULT 0,
  played_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_games_number (series_id, game_number),
  KEY idx_tournament_games_match (match_id),
  KEY idx_tournament_games_status (status),
  KEY idx_tournament_games_entry1 (entry1_id),
  KEY idx_tournament_games_entry2 (entry2_id),
  KEY idx_tournament_games_winner (winner_entry_id),
  KEY idx_tournament_games_loser (loser_entry_id),
  CONSTRAINT chk_tournament_game_status CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT chk_tournament_game_entries CHECK (entry1_id <> entry2_id),
  CONSTRAINT fk_tournament_games_series FOREIGN KEY (series_id) REFERENCES tournament_series(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_games_entry1 FOREIGN KEY (entry1_id) REFERENCES tournament_entries(id),
  CONSTRAINT fk_tournament_games_entry2 FOREIGN KEY (entry2_id) REFERENCES tournament_entries(id),
  CONSTRAINT fk_tournament_games_winner FOREIGN KEY (winner_entry_id) REFERENCES tournament_entries(id) ON DELETE SET NULL,
  CONSTRAINT fk_tournament_games_loser FOREIGN KEY (loser_entry_id) REFERENCES tournament_entries(id) ON DELETE SET NULL,
  CONSTRAINT fk_tournament_games_match FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_byes (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  round_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  reason VARCHAR(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'automatic_bye',
  points_awarded DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_byes_round_entry (round_id, entry_id),
  KEY idx_tournament_byes_entry (entry_id),
  CONSTRAINT fk_tournament_byes_round FOREIGN KEY (round_id) REFERENCES tournament_phase_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_byes_entry FOREIGN KEY (entry_id) REFERENCES tournament_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_phase_standings (
  group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  matches_played INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  points DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  byes INT NOT NULL DEFAULT 0,
  omp DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  gwp DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  ogp DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  rank_position INT NULL,
  is_qualified TINYINT(1) NOT NULL DEFAULT 0,
  finalized_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, entry_id),
  KEY idx_tournament_phase_standings_rank (group_id, rank_position),
  KEY idx_tournament_phase_standings_entry (entry_id),
  CONSTRAINT fk_tournament_phase_standings_group FOREIGN KEY (group_id) REFERENCES tournament_phase_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_phase_standings_entry FOREIGN KEY (entry_id) REFERENCES tournament_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS tournament_results (
  tournament_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  entry_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  placement INT NULL,
  placement_label VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  is_champion TINYINT(1) NOT NULL DEFAULT 0,
  determined_by_group_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  determined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tournament_id, entry_id),
  KEY idx_tournament_results_placement (tournament_id, placement),
  KEY idx_tournament_results_entry (entry_id),
  KEY idx_tournament_results_group (determined_by_group_id),
  CONSTRAINT fk_tournament_results_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_results_entry FOREIGN KEY (entry_id) REFERENCES tournament_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_results_group FOREIGN KEY (determined_by_group_id) REFERENCES tournament_phase_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE replays
  ADD COLUMN IF NOT EXISTS tournament_game_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL AFTER tournament_match_id,
  ADD COLUMN IF NOT EXISTS tournament_link_method VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER tournament_game_id,
  ADD COLUMN IF NOT EXISTS tournament_linked_at DATETIME NULL AFTER tournament_link_method,
  ADD KEY IF NOT EXISTS idx_replays_tournament_game_id (tournament_game_id),
  ADD CONSTRAINT fk_replays_tournament_game_id
    FOREIGN KEY IF NOT EXISTS fk_replays_tournament_game_id (tournament_game_id)
    REFERENCES tournament_games(id) ON DELETE SET NULL;

ALTER TABLE match_schedule_proposals
  ADD COLUMN IF NOT EXISTS tournament_series_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL AFTER tournament_round_match_id,
  ADD KEY IF NOT EXISTS idx_match_schedule_proposals_series (tournament_series_id),
  ADD CONSTRAINT fk_match_schedule_proposals_series
    FOREIGN KEY IF NOT EXISTS fk_match_schedule_proposals_series (tournament_series_id)
    REFERENCES tournament_series(id) ON DELETE SET NULL;
