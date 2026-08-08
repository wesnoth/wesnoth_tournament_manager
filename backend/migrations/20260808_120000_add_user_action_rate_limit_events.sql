-- Persist per-user action timestamps for rolling application rate limits.

CREATE TABLE IF NOT EXISTS user_action_rate_limit_events (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'Immutable UUID for one consumed action',
  user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'Authenticated user whose rolling budget was consumed',
  action_type VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Stable category: tournament_creation, p2p_challenge, or tournament_schedule',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'UTC action timestamp used as the rolling-window boundary',
  PRIMARY KEY (id),
  KEY idx_user_action_rate_limit_window (user_id, action_type, created_at),
  -- Application users are permanent and rate-limit history must never cascade away.
  CONSTRAINT fk_user_action_rate_limit_user
    FOREIGN KEY (user_id) REFERENCES users_extension(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Rolling per-user action timestamps for persistent abuse protection';
