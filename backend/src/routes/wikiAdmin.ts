/**
 * Wiki Admin Routes
 * Admin/moderator endpoints for managing wiki articles and images
 * Route: /api/admin/wiki
 * 
 * IMPORTANT: Route order is critical!
 * Specific routes (with /images) MUST come before generic /:slug routes
 * Otherwise GET /images will match /:slug with slug="images"
 */

import { Router, Request, Response } from 'express';
import { AuthRequest, moderatorOrAdminMiddleware } from '../middleware/auth.js';
import multer from 'multer';
import * as wikiAdminService from '../services/wikiAdminService.js';
import { queryTournament } from '../config/tournamentDatabase.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * ==================== IMAGE ROUTES (specific - come first!) ====================
 */

/**
 * POST /api/admin/wiki/upload-image
 * Upload image file
 * Returns: { id, filename, url }
 */
router.post('/upload-image', moderatorOrAdminMiddleware, upload.single('image'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const result = await wikiAdminService.uploadImage(req.file, parseInt(req.userId!));
    res.status(201).json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * GET /api/admin/wiki/images
 * List all uploaded images with usage count
 */
router.get('/images', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const images = await wikiAdminService.getAllImages();
    res.json(images);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/admin/wiki/images/:filename/usage
 * Get articles that use this image
 */
router.get('/images/:filename/usage', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { filename } = req.params;
    const usage = await wikiAdminService.getImageUsage(filename);
    res.json(usage);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /api/admin/wiki/images/:filename
 * Delete image (after checking no refs)
 */
router.delete('/images/:filename', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { filename } = req.params;
    await wikiAdminService.deleteImage(filename);
    res.json({ filename, message: 'Image deleted successfully' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * ==================== ARTICLE ROUTES (generic - come last!) ====================
 */

/**
 * POST /api/admin/wiki
 * Create new article
 */
router.post('/', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug, title, content_markdown, language, is_published } = req.body;

    if (!slug || !title || !content_markdown || !language) {
      return res.status(400).json({ error: 'Missing required fields: slug, title, content_markdown, language' });
    }

    const articleId = await wikiAdminService.createArticle({
      slug,
      title,
      content_markdown,
      language,
      author_id: parseInt(req.userId!),
      is_published: is_published ?? true
    });

    res.status(201).json({ id: articleId, slug, message: 'Article created successfully' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * GET /api/admin/wiki/:slug
 * Get article for editing
 */
router.get('/:slug', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    const result = await queryTournament(
      'SELECT id, slug, title, content_markdown, language, is_published, created_at, updated_at FROM wiki_articles WHERE slug = ?',
      [slug]
    );

    if ((result as any[]).length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json((result as any[])[0]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

/**
 * PUT /api/admin/wiki/:slug
 * Update article
 */
router.put('/:slug', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const { title, content_markdown, language, is_published } = req.body;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    if (!title && !content_markdown && language === undefined && is_published === undefined) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    await wikiAdminService.updateArticle(slug, {
      slug,
      title,
      content_markdown,
      language,
      is_published,
      editor_id: parseInt(req.userId!)
    });

    res.json({ slug, message: 'Article updated successfully' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * DELETE /api/admin/wiki/:slug
 * Delete article (soft or hard)
 * Query param: ?hard=true for hard delete, else soft delete
 */
router.delete('/:slug', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const { hard } = req.query;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    if (hard === 'true') {
      await wikiAdminService.hardDeleteArticle(slug);
      res.json({ slug, message: 'Article permanently deleted' });
    } else {
      await wikiAdminService.softDeleteArticle(slug);
      res.json({ slug, message: 'Article marked as deleted (draft mode)' });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

export default router;
