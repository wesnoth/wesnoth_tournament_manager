-- Fix wiki_articles UNIQUE constraint to support multiple languages
-- Change from UNIQUE(slug) to UNIQUE(slug, language)
-- This allows the same slug with different language codes

-- Drop existing UNIQUE constraint on slug
ALTER TABLE wiki_articles DROP INDEX slug;

-- Add composite UNIQUE constraint on (slug, language)
ALTER TABLE wiki_articles ADD UNIQUE INDEX idx_slug_language_unique (slug, language)
  COMMENT 'Ensure unique slug per language (same slug can exist in en, es, fr, etc.)';
