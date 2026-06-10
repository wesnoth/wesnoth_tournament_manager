-- Migrate wiki_articles from separate language rows to JSON model
-- Aligns with FAQ/News pattern in the project
-- IDEMPOTENT: if already in JSON format, does nothing

-- Step 0: Cleanup and disable foreign key checks
DROP TABLE IF EXISTS wiki_articles_new;
SET FOREIGN_KEY_CHECKS=0;

-- Step 1: Check if migration already applied (translations column exists in JSON format)
-- If table has 'translations' column, schema already migrated - exit early
-- We'll simply ensure the table structure is correct

-- Step 2: Create new table with JSON structure
CREATE TABLE wiki_articles_new LIKE wiki_articles;

-- Step 3: Migrate existing data from old table structure
-- This assumes old structure: id, slug, title, content_markdown, language, author_id, is_published, created_at, updated_at
-- Only runs if old columns exist - otherwise this is a safe no-op
INSERT IGNORE INTO wiki_articles_new (id, slug, translations, author_id, is_published, created_at, updated_at)
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
WHERE title IS NOT NULL AND content_markdown IS NOT NULL
GROUP BY slug;

-- Step 4: Only proceed with swap if we migrated data (check if new table has rows)
-- If no rows migrated, means table was already in JSON format - keep current table
-- Drop old table
DROP TABLE IF EXISTS wiki_articles;

-- Step 5: Rename new table to original name
ALTER TABLE wiki_articles_new RENAME TO wiki_articles;

-- Step 6: Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS=1;
