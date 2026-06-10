/**
 * Wiki Service
 * Handles database operations for wiki articles with JSON translations
 */

import { query } from '../config/database.js';
import type { WikiArticle, WikiArticlePublic, WikiListItem } from '../types/wiki.js';

interface WikiArticleRow {
  id: number;
  slug: string;
  translations: string; // JSON string
  author_id: string;
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
    const translations: WikiTranslations = JSON.parse(row.translations);

    // Try requested language first, fallback to English
    let translation = translations[language];
    if (!translation || !translation.title || !translation.content_markdown) {
      translation = translations['en'];
    }

    if (!translation || !translation.title || !translation.content_markdown) {
      return null;
    }

    return {
      slug: row.slug,
      title: translation.title,
      content_markdown: translation.content_markdown,
      language: Object.keys(translations).includes(language) ? language : 'en',
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
      const translations: WikiTranslations = JSON.parse(articleRow.translations);
      
      // Add an entry for each available language
      for (const lang of Object.keys(translations)) {
        const trans = translations[lang];
        if (trans && trans.title && trans.content_markdown) {
          // If language filter is specified, only include matching languages
          if (!language || lang === language) {
            items.push({
              slug: articleRow.slug,
              title: trans.title,
              language: lang,
              updated_at: articleRow.updated_at
            });
          }
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
 * Check if a wiki article exists (published)
 */
export async function wikiArticleExists(slug: string, language: string = 'en'): Promise<boolean> {
  try {
    const result = await query(
      `SELECT translations FROM wiki_articles
       WHERE slug = ? AND is_published = 1
       LIMIT 1`,
      [slug]
    );
    
    if (result.rows.length === 0) {
      return false;
    }

    const row = result.rows[0] as WikiArticleRow;
    const translations: WikiTranslations = JSON.parse(row.translations);
    const trans = translations[language] || translations['en'];
    
    return !!(trans && trans.title && trans.content_markdown);
  } catch (error) {
    console.error('Error checking wiki article existence:', error);
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
