-- Migrate wiki_articles from separate language rows to JSON model
-- Aligns with FAQ/News pattern in the project

-- Step 0: Cleanup and disable foreign key checks
DROP TABLE IF EXISTS wiki_articles_new;
SET FOREIGN_KEY_CHECKS=0;

-- Step 1: Create new table with JSON structure
CREATE TABLE wiki_articles_new (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE COMMENT 'URL-friendly identifier',
  translations LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL 
    DEFAULT '{"en":{},"es":{},"de":{},"fr":{},"zh":{}}' 
    COMMENT 'Multi-language translations stored as JSON object',
  author_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci COMMENT 'UUID of article author',
  is_published TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=published, 0=draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_slug (slug),
  INDEX idx_published (is_published),
  INDEX idx_author_id (author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
COMMENT='Wiki articles with multi-language JSON support';

-- Step 2: Migrate existing data from old table
-- Group by slug, collect all language variants into JSON
INSERT INTO wiki_articles_new (id, slug, translations, author_id, is_published, created_at, updated_at)
SELECT 
  MAX(id),
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

-- Step 3: Drop old table (FK constraints disabled)
DROP TABLE wiki_articles;

-- Step 4: Rename new table to original name
ALTER TABLE wiki_articles_new RENAME TO wiki_articles;

-- Step 5: Recreate foreign key constraint for wiki_article_images
ALTER TABLE wiki_article_images
ADD CONSTRAINT fk_wiki_article_images_article
  FOREIGN KEY (article_id) REFERENCES wiki_articles(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS=1;
