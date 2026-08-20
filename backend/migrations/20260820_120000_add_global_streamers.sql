-- Add the global streamer capability and persistent per-game external stream links.
ALTER TABLE users_extension
  ADD COLUMN IF NOT EXISTS is_streamer tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Global capability to prepare external stream links for tournament games' AFTER is_admin;

CREATE TABLE IF NOT EXISTS tournament_game_streams (
  id char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'Immutable UUID for one stream link assignment',
  game_id char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'Tournament game covered by this link',
  streamer_user_id char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'User who created and owns the link',
  stream_url varchar(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'External HTTP(S) stream URL',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_tournament_game_streams_game (game_id),
  KEY idx_tournament_game_streams_streamer (streamer_user_id),
  CONSTRAINT fk_tournament_game_streams_game FOREIGN KEY (game_id) REFERENCES tournament_games (id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_game_streams_streamer FOREIGN KEY (streamer_user_id) REFERENCES users_extension (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='External stream links assigned independently to tournament games';
