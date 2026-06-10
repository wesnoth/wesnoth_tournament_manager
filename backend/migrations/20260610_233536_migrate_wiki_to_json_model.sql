-- Migrate wiki_articles from separate language rows to JSON model
-- Aligns with FAQ/News pattern in the project

-- Step 1: Create new table with JSON structure
CREATE TABLE wiki_articles_new (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE COMMENT 'URL-friendly identifier',
  translations LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL 
    DEFAULT '{"en":{},"es":{},"de":{},"fr":{},"zh":{}}' 
    CHECK (json_valid(`translations`))
    COMMENT 'JSON object with translations: {"en":{"title":"...","content":"..."},"es":{...}}',
  author_id CHAR(36) COMMENT 'UUID of article author',
  is_published TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=published, 0=draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_slug (slug),
  INDEX idx_published (is_published),
  INDEX idx_author_id (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
COMMENT='Wiki articles with multi-language JSON support - aligned with FAQ/News pattern';

-- Step 2: Migrate existing data from old table
-- Group by slug, collect all language variants into JSON
INSERT INTO wiki_articles_new (slug, translations, author_id, is_published, created_at, updated_at)
SELECT 
  slug,
  JSON_OBJECT(
    'en', IF(MAX(CASE WHEN language='en' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END) IS NOT NULL,
             MAX(CASE WHEN language='en' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END),
             JSON_OBJECT()),
    'es', IF(MAX(CASE WHEN language='es' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END) IS NOT NULL,
             MAX(CASE WHEN language='es' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END),
             JSON_OBJECT()),
    'de', IF(MAX(CASE WHEN language='de' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END) IS NOT NULL,
             MAX(CASE WHEN language='de' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END),
             JSON_OBJECT()),
    'fr', IF(MAX(CASE WHEN language='fr' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END) IS NOT NULL,
             MAX(CASE WHEN language='fr' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END),
             JSON_OBJECT()),
    'zh', IF(MAX(CASE WHEN language='zh' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END) IS NOT NULL,
             MAX(CASE WHEN language='zh' THEN JSON_OBJECT('title', title, 'content_markdown', content_markdown) END),
             JSON_OBJECT())
  ) as translations,
  MAX(author_id),
  MAX(is_published),
  MIN(created_at),
  MAX(updated_at)
FROM wiki_articles
GROUP BY slug;

-- Step 3: Drop old table
DROP TABLE wiki_articles;

-- Step 4: Rename new table to original name
ALTER TABLE wiki_articles_new RENAME TO wiki_articles;

-- Verify migration (should show JSON structure with translated articles)
-- SELECT id, slug, JSON_KEYS(translations) as available_languages, is_published FROM wiki_articles;
