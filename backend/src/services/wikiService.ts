/**
 * Wiki Service
 * Handles database operations for wiki articles
 */

import { query } from '../config/database.js';
import type { WikiArticle, WikiArticlePublic, WikiListItem } from '../types/wiki.js';

/**
 * Fetch a published wiki article by slug and language
 * Falls back to English if requested language not available
 */
export async function getWikiArticle(
  slug: string,
  language: string = 'en'
): Promise<WikiArticlePublic | null> {
  try {
    // First try to fetch article in requested language
    let result = await query(
      `SELECT slug, title, content_markdown, language, created_at, updated_at
       FROM wiki_articles
       WHERE slug = ? AND language = ? AND is_published = 1
       LIMIT 1`,
      [slug, language]
    );

    // If not found and language is not English, try English
    if (result.rows.length === 0 && language !== 'en') {
      result = await query(
        `SELECT slug, title, content_markdown, language, created_at, updated_at
         FROM wiki_articles
         WHERE slug = ? AND language = 'en' AND is_published = 1
         LIMIT 1`,
        [slug]
      );
    }

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as WikiArticlePublic;
  } catch (error) {
    console.error('Error fetching wiki article:', error);
    throw error;
  }
}

/**
 * Fetch all published wiki articles (for navigation)
 * Optional: filter by language
 */
export async function getWikiArticlesList(
  language?: string
): Promise<WikiListItem[]> {
  try {
    let sql = `SELECT slug, title, language, updated_at
               FROM wiki_articles
               WHERE is_published = 1`;
    const params: any[] = [];

    if (language) {
      sql += ` AND language = ?`;
      params.push(language);
    }

    sql += ` ORDER BY language ASC, title ASC`;

    const result = await query(sql, params);
    return result.rows as WikiListItem[];
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
      `SELECT 1 FROM wiki_articles
       WHERE slug = ? AND language = ? AND is_published = 1
       LIMIT 1`,
      [slug, language]
    );
    return result.rows.length > 0;
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
      `SELECT DISTINCT language FROM wiki_articles
       WHERE slug = ? AND is_published = 1
       ORDER BY language ASC`,
      [slug]
    );
    return result.rows.map((row: any) => row.language);
  } catch (error) {
    console.error('Error fetching wiki article languages:', error);
    throw error;
  }
}
