/**
 * Wiki Service
 * Handles database operations for wiki articles with JSON translations
 */

import { query } from '../config/database.js';
import type { WikiArticlePublic, WikiListItem } from '../types/wiki.js';

interface WikiArticleRow {
  id: string;
  slug: string;
  translations: string; // JSON string
  author_id: string | null;
  is_published: number;
  created_at: string;
  updated_at: string;
}

interface WikiTranslations {
  [language: string]: {
    title?: string;
    content_markdown?: string;
  };
}

/** Parse the persisted translation object and reject malformed rows consistently. */
function parseTranslations(value: string): WikiTranslations {
  const translations = JSON.parse(value) as WikiTranslations;
  return translations && typeof translations === 'object' ? translations : {};
}

/** Return a complete translation, or null when the article has no usable content. */
function getCompleteTranslation(
  translations: WikiTranslations,
  language: string,
): { language: string; title: string; content_markdown: string } | null {
  const candidates = [language, 'en'];
  for (const candidate of candidates) {
    const translation = translations[candidate];
    if (translation?.title?.trim() && translation.content_markdown?.trim()) {
      return {
        language: candidate,
        title: translation.title,
        content_markdown: translation.content_markdown,
      };
    }
  }
  return null;
}

/**
 * Fetch a published wiki article by slug and language
 * Falls back to English if requested language not available
 */
export async function getWikiArticle(
  slug: string,
  language: string = 'en'
): Promise<WikiArticlePublic | null> {
  try {
    const result = await query(
      `SELECT id, slug, translations, created_at, updated_at
       FROM wiki_articles
       WHERE slug = ? AND is_published = 1
       LIMIT 1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as WikiArticleRow;
    const translation = getCompleteTranslation(parseTranslations(row.translations), language);
    if (!translation) {
      return null;
    }

    return {
      slug: row.slug,
      title: translation.title,
      content_markdown: translation.content_markdown,
      language: translation.language,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  } catch (error) {
    console.error('Error fetching wiki article:', error);
    throw error;
  }
}

/**
 * Fetch all published wiki articles (for navigation)
 * Returns one entry per slug with all available languages
 */
export async function getWikiArticlesList(
  language?: string
): Promise<WikiListItem[]> {
  try {
    const result = await query(
      `SELECT id, slug, translations, updated_at
       FROM wiki_articles
       WHERE is_published = 1
       ORDER BY slug ASC`,
      []
    );

    const items: WikiListItem[] = [];
    
    for (const row of result.rows) {
      const articleRow = row as WikiArticleRow;
      const translations = parseTranslations(articleRow.translations);
      const languages = language
        ? [language, ...(language !== 'en' ? ['en'] : [])]
        : Object.keys(translations);

      // List the requested translation and English fallback once per article.
      for (const candidate of languages) {
        const translation = getCompleteTranslation(translations, candidate);
        if (translation && translation.language === candidate) {
          items.push({
            slug: articleRow.slug,
            title: translation.title,
            language: translation.language,
            updated_at: articleRow.updated_at,
          });
          break;
        }
      }
    }

    return items;
  } catch (error) {
    console.error('Error fetching wiki articles list:', error);
    throw error;
  }
}

/**
 * Get available languages for a wiki article
 */
export async function getWikiArticleLanguages(slug: string): Promise<string[]> {
  try {
    const result = await query(
      `SELECT translations FROM wiki_articles
       WHERE slug = ? AND is_published = 1
       LIMIT 1`,
      [slug]
    );
    
    if (result.rows.length === 0) {
      return [];
    }

    const row = result.rows[0] as WikiArticleRow;
    const translations: WikiTranslations = JSON.parse(row.translations);
    
    return Object.keys(translations).filter(lang => {
      const trans = translations[lang];
      return trans && trans.title && trans.content_markdown;
    }).sort();
  } catch (error) {
    console.error('Error fetching wiki article languages:', error);
    throw error;
  }
}
