-- Migration: Clean up failed wiki migrations and restore from backup
-- This migration:
-- 1. Drops broken temporary tables from failed attempts
-- 2. Creates clean wiki_articles table with JSON structure
-- 3. Restores data from backup using simple aggregation

SET FOREIGN_KEY_CHECKS=0;

-- Step 1: Drop any broken/temporary tables from previous failed attempts
DROP TABLE IF EXISTS wiki_articles_new;
DROP TABLE IF EXISTS wiki_articles_backup_final;

-- Step 2: Drop the corrupted wiki_articles if it exists (to start fresh)
DROP TABLE IF EXISTS wiki_articles;

-- Step 3: Create wiki_articles with correct JSON structure
CREATE TABLE wiki_articles (
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
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 4: Restore data from backup table
-- Group by slug and build JSON object with all languages
INSERT INTO wiki_articles (id, slug, translations, author_id, is_published, created_at, updated_at)
SELECT
  UUID() as id,
  slug,
  JSON_OBJECT(
    'en', IF(COUNT(IF(language = 'en', 1, NULL)) > 0, JSON_OBJECT('title', MAX(IF(language = 'en', title, NULL)), 'content_markdown', MAX(IF(language = 'en', content_markdown, NULL))), NULL),
    'es', IF(COUNT(IF(language = 'es', 1, NULL)) > 0, JSON_OBJECT('title', MAX(IF(language = 'es', title, NULL)), 'content_markdown', MAX(IF(language = 'es', content_markdown, NULL))), NULL),
    'de', IF(COUNT(IF(language = 'de', 1, NULL)) > 0, JSON_OBJECT('title', MAX(IF(language = 'de', title, NULL)), 'content_markdown', MAX(IF(language = 'de', content_markdown, NULL))), NULL),
    'fr', IF(COUNT(IF(language = 'fr', 1, NULL)) > 0, JSON_OBJECT('title', MAX(IF(language = 'fr', title, NULL)), 'content_markdown', MAX(IF(language = 'fr', content_markdown, NULL))), NULL),
    'zh', IF(COUNT(IF(language = 'zh', 1, NULL)) > 0, JSON_OBJECT('title', MAX(IF(language = 'zh', title, NULL)), 'content_markdown', MAX(IF(language = 'zh', content_markdown, NULL))), NULL),
    'ru', IF(COUNT(IF(language = 'ru', 1, NULL)) > 0, JSON_OBJECT('title', MAX(IF(language = 'ru', title, NULL)), 'content_markdown', MAX(IF(language = 'ru', content_markdown, NULL))), NULL)
  ) as translations,
  MAX(author_id),
  MAX(is_published),
  MIN(created_at),
  MAX(updated_at)
FROM wiki_articles_backup_old_structure
GROUP BY slug;

SET FOREIGN_KEY_CHECKS=1;
