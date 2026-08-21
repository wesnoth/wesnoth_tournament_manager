ALTER TABLE tournament_game_streams
  MODIFY game_id char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  ADD COLUMN match_id char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL AFTER game_id,
  ADD KEY idx_tournament_game_streams_match (match_id),
  ADD CONSTRAINT fk_tournament_game_streams_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_tournament_game_streams_target CHECK ((game_id IS NULL AND match_id IS NOT NULL) OR (game_id IS NOT NULL AND match_id IS NULL));
