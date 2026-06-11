/**
 * Wiki Routes (Public)
 * Endpoints for viewing wiki articles and navigation
 */

import { Router, Request, Response } from 'express';
import * as wikiService from '../services/wikiService.js';
import type { WikiArticlePublic } from '../types/wiki.js';

const router = Router();

/**
 * GET /api/public/wiki/list
 * Get all published wiki articles (for navigation/sitemap)
 * Optional: filter by language
 * 
 * Query Parameters:
 * - lang: Filter by language code (optional)
 * 
 * NOTE: This MUST come before /:slug to prevent /:slug from matching /list
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const language = (req.query.lang as string) || undefined;

    if (language && !/^[a-z]{2,5}$/.test(language)) {
      return res.status(400).json({
        error: 'Invalid language code'
      });
    }

    const articles = await wikiService.getWikiArticlesList(language);
    res.json(articles);
  } catch (error) {
    console.error('Error fetching wiki articles list:', error);
    res.status(500).json({ error: 'Failed to fetch articles list' });
  }
});

/**
 * GET /api/public/wiki/:slug/languages
 * Get available languages for a specific wiki article
 * 
 * NOTE: This MUST come before /:slug to prevent /:slug from matching /:slug/languages
 */
router.get('/:slug/languages', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    if (!/^[a-z0-9_-]+$/.test(slug)) {
      return res.status(400).json({
        error: 'Invalid article slug format'
      });
    }

    const languages = await wikiService.getWikiArticleLanguages(slug);

    if (languages.length === 0) {
      return res.status(404).json({
        error: 'Article not found',
        slug
      });
    }

    res.json({ slug, languages });
  } catch (error) {
    console.error('Error fetching wiki article languages:', error);
    res.status(500).json({ error: 'Failed to fetch available languages' });
  }
});

/**
 * GET /api/public/wiki/:slug
 * Fetch a published wiki article by slug with optional language parameter
 * Falls back to English if requested language not available
 * 
 * Query Parameters:
 * - lang: Language code (default: 'en')
 * 
 * NOTE: This MUST come last to avoid matching other routes like /list or /:slug/languages
 */
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const language = (req.query.lang as string) || 'en';

    // Validate slug format (alphanumeric, hyphens, underscores only)
    if (!/^[a-z0-9_-]+$/.test(slug)) {
      return res.status(400).json({
        error: 'Invalid article slug format'
      });
    }

    // Validate language code (2-5 characters, lowercase)
    if (!/^[a-z]{2,5}$/.test(language)) {
      return res.status(400).json({
        error: 'Invalid language code'
      });
    }

    const article = await wikiService.getWikiArticle(slug, language);

    if (!article) {
      return res.status(404).json({
        error: 'Article not found',
        slug,
        language
      });
    }

    res.json(article);
  } catch (error) {
    console.error('Error fetching wiki article:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

export default router;
