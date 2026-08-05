ALTER TABLE user_notifications
  MODIFY COLUMN match_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  ADD COLUMN game_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Phase-engine tournament_games reference',
  ADD COLUMN series_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Phase-engine tournament_series reference',
  ADD INDEX idx_game_id (game_id),
  ADD INDEX idx_series_id (series_id);
