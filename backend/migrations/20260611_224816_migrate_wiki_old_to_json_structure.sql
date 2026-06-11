-- Migration: Migrate wiki_articles from old single-language structure to new JSON multi-language structure
-- Old structure: one row per article per language
-- New structure: one row per article with translations as JSON object
-- This migration is idempotent and handles partial execution

-- Disable foreign key constraints temporarily
SET FOREIGN_KEY_CHECKS=0;

-- Step 1: Backup the old table structure (if not already done)
CREATE TABLE IF NOT EXISTS wiki_articles_backup_old_structure AS SELECT * FROM wiki_articles;

-- Step 2: Drop intermediate tables if they exist from a failed migration
DROP TABLE IF EXISTS wiki_articles_new;

-- Step 3: Create new wiki_articles table with JSON structure
CREATE TABLE wiki_articles_new (
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

-- Step 4: Migrate data from old table to new table
-- Group by slug and build JSON object with all language translations
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
GROUP BY slug;

-- Step 5: Drop old table and rename new table
DROP TABLE wiki_articles;
RENAME TABLE wiki_articles_new TO wiki_articles;

-- Re-enable foreign key constraints
SET FOREIGN_KEY_CHECKS=1;
