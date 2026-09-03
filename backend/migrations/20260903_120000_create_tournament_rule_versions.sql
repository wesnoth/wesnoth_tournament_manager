-- Store immutable snapshots of tournament rules so players can review past versions.

CREATE TABLE IF NOT EXISTS tournament_rule_versions (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  tournament_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  rules_content LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  changed_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_rule_versions_version (tournament_id, version_number),
  KEY idx_tournament_rule_versions_tournament (tournament_id, version_number),
  KEY idx_tournament_rule_versions_changed_by (changed_by),
  CONSTRAINT fk_tournament_rule_versions_tournament
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_rule_versions_changed_by
    FOREIGN KEY (changed_by) REFERENCES users_extension(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Existing tournaments start with one historical snapshot at their creation time.
INSERT INTO tournament_rule_versions (
  id, tournament_id, version_number, rules_content, changed_by, changed_at
)
SELECT UUID(), t.id, 1, COALESCE(t.rules_content, t.description), t.creator_id,
       COALESCE(t.created_at, CURRENT_TIMESTAMP)
FROM tournaments t
WHERE NOT EXISTS (
  SELECT 1
  FROM tournament_rule_versions v
  WHERE v.tournament_id = t.id
);
