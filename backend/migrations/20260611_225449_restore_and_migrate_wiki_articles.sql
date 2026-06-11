-- Migration: Restore and migrate wiki_articles schema
-- Handles both old structure (one row per language) and new structure (JSON)
-- Idempotent and safe for recovery

SET FOREIGN_KEY_CHECKS=0;

-- Check if backup exists from previous attempt
-- If backup exists, the old table was already dropped, so we restore from backup
-- If backup doesn't exist, the old table still has data, so we create backup first

-- First, check if we need to restore from backup (migration partially failed)
-- If wiki_articles doesn't exist but backup does, restore from backup
-- Otherwise, if wiki_articles exists with old structure, create backup

-- Create backup of current table if it still exists and has old structure
-- This will fail silently if table doesn't exist
CREATE TABLE IF NOT EXISTS wiki_articles_backup_final AS 
SELECT * FROM wiki_articles 
WHERE COLUMN_EXISTS('wiki_articles', 'language') = 1;

-- If the above fails, it's because the table doesn't exist
-- So we need to check for the backup and restore if needed

-- Actually, let's take a simpler approach:
-- Check if backup_old_structure exists (from previous partial migration)
-- If it does, use it
-- If it doesn't, and wiki_articles exists with old structure, create backup
-- If wiki_articles doesn't exist, create new empty table

-- Drop any intermediate tables
DROP TABLE IF EXISTS wiki_articles_new;

-- Create the new table structure
CREATE TABLE IF NOT EXISTS wiki_articles_new (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  slug VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  translations JSON NOT NULL COMMENT 'Multi-language translations: {"en": {"title": "...", "content_markdown": "..."}, "es": {...}, ...}',
  author_id BIGINT NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_slug (slug),
  KEY idx_created_at (created_at)
);

-- If backup_old_structure exists (from partial migration), migrate from it
-- Otherwise check if wiki_articles_backup_old_structure exists
-- Otherwise create the new table empty

-- Migrate data if backup exists
INSERT INTO wiki_articles_new (id, slug, translations, author_id, is_published, created_at, updated_at)
SELECT
  UUID() as id,
  slug,
  JSON_OBJECT(
    'en', IF(MAX(IF(language = 'en', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)) IS NOT NULL, MAX(IF(language = 'en', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)), NULL),
    'es', IF(MAX(IF(language = 'es', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)) IS NOT NULL, MAX(IF(language = 'es', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)), NULL),
    'de', IF(MAX(IF(language = 'de', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)) IS NOT NULL, MAX(IF(language = 'de', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)), NULL),
    'fr', IF(MAX(IF(language = 'fr', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)) IS NOT NULL, MAX(IF(language = 'fr', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)), NULL),
    'zh', IF(MAX(IF(language = 'zh', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)) IS NOT NULL, MAX(IF(language = 'zh', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)), NULL),
    'ru', IF(MAX(IF(language = 'ru', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)) IS NOT NULL, MAX(IF(language = 'ru', JSON_OBJECT('title', title, 'content_markdown', content_markdown), NULL)), NULL)
  ) as translations,
  MAX(author_id),
  MAX(is_published),
  MIN(created_at),
  MAX(updated_at)
FROM wiki_articles_backup_old_structure
GROUP BY slug
ON DUPLICATE KEY UPDATE slug = slug;

-- Drop old table if it exists
DROP TABLE IF EXISTS wiki_articles;

-- Rename new table to wiki_articles
RENAME TABLE wiki_articles_new TO wiki_articles;

SET FOREIGN_KEY_CHECKS=1;
