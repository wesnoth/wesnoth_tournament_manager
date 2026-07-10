-- Add reusable rule templates and tournament-level rule snapshots
-- Organizers can pick a template and then edit their own tournament copy

CREATE TABLE IF NOT EXISTS tournament_rule_templates (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  title VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  content_markdown LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  updated_by CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tournament_rule_templates_active (is_active),
  KEY idx_tournament_rule_templates_created_by (created_by),
  KEY idx_tournament_rule_templates_updated_by (updated_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE tournaments
ADD COLUMN IF NOT EXISTS rules_template_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL AFTER description,
ADD COLUMN IF NOT EXISTS rules_content LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER rules_template_id;

ALTER TABLE tournaments
ADD INDEX IF NOT EXISTS idx_tournaments_rules_template_id (rules_template_id);

UPDATE tournaments
SET rules_content = description
WHERE (rules_content IS NULL OR rules_content = '')
  AND description IS NOT NULL
  AND description <> '';

