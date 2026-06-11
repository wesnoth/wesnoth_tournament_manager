/**
 * Wiki Admin Routes
 * Admin/moderator endpoints for managing wiki articles with JSON translations
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

    const result = await wikiAdminService.uploadImage(req.file, req.userId || null);
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
 * GET /api/admin/wiki
 * List all articles (for admin management)
 */
router.get('/', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await wikiAdminService.getArticlesList?.() || [];
    res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/admin/wiki
 * Create new article with translations
 * Body: {
 *   slug: "article-slug",
 *   translations: {
 *     en: { title: "Title", content_markdown: "..." },
 *     es: { title: "Título", content_markdown: "..." }
 *   },
 *   is_published: true
 * }
 */
router.post('/', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug, translations, is_published } = req.body;

    if (!slug || !translations || typeof translations !== 'object') {
      return res.status(400).json({ error: 'Missing required fields: slug, translations' });
    }

    const articleId = await wikiAdminService.createArticle({
      slug,
      translations,
      author_id: req.userId!,
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
 * Get article for editing (with all translations)
 */
router.get('/:slug', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    const article = await wikiAdminService.getArticleForEditing(slug);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json(article);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

/**
 * PUT /api/admin/wiki/:slug
 * Update article translations
 * Body: {
 *   translations: {
 *     en: { title: "...", content_markdown: "..." },
 *     es: { ... }
 *   },
 *   is_published: true
 * }
 */
router.put('/:slug', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;
    const { translations, is_published } = req.body;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    if (!translations && is_published === undefined) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    await wikiAdminService.updateArticle(slug, {
      slug,
      translations,
      is_published,
      editor_id: req.userId!
    });

    res.json({ slug, message: 'Article updated successfully' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * DELETE /api/admin/wiki/:slug
 * Delete article permanently
 */
router.delete('/:slug', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    await wikiAdminService.deleteArticle(slug);
    res.json({ slug, message: 'Article deleted successfully' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

export default router;
