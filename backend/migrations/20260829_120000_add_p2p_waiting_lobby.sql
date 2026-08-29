-- Stores one short-lived public availability announcement per player.
-- Expired rows are hidden by reads immediately and removed by the scheduler.
CREATE TABLE IF NOT EXISTS p2p_challenge_waiting (
  id CHAR(36) COLLATE utf8mb4_general_ci NOT NULL,
  user_id CHAR(36) COLLATE utf8mb4_general_ci NOT NULL,
  available_until DATETIME NOT NULL COMMENT 'UTC instant at which the public announcement expires',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_p2p_waiting_user (user_id),
  KEY idx_p2p_waiting_user_id (user_id),
  KEY idx_p2p_waiting_until (available_until),
  CONSTRAINT fk_p2p_waiting_user FOREIGN KEY (user_id) REFERENCES users_extension(id) ON DELETE CASCADE
);
