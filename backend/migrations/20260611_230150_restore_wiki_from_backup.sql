-- Migration: Restore and migrate wiki_articles from backup
-- Simple approach: just restore from the backup table that has the old data

SET FOREIGN_KEY_CHECKS=0;

-- Create new wiki_articles table with JSON structure (only if it doesn't exist)
CREATE TABLE IF NOT EXISTS wiki_articles (
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

-- Only migrate if wiki_articles_backup_old_structure exists and has data
-- and wiki_articles is empty
INSERT INTO wiki_articles (id, slug, translations, author_id, is_published, created_at, updated_at)
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
WHERE NOT EXISTS (SELECT 1 FROM wiki_articles LIMIT 1)
GROUP BY slug
ON DUPLICATE KEY UPDATE slug = slug;

SET FOREIGN_KEY_CHECKS=1;
