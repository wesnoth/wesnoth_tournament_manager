-- Add tournament co-organizers with full organizer permissions
-- Non-invasive rollout: backfill current creator as organizer for each tournament

CREATE TABLE IF NOT EXISTS tournament_organizers (
  tournament_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  created_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tournament_id, user_id),
  KEY idx_tournament_organizers_user_id (user_id),
  KEY idx_tournament_organizers_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO tournament_organizers (tournament_id, user_id, created_by)
SELECT id, creator_id, creator_id
FROM tournaments
WHERE creator_id IS NOT NULL;
