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
import * as wikiExportImportService from '../services/wikiExportImportService.js';

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
 * GET /api/admin/wiki/images/orphaned
 * Detect orphaned image files in filesystem (not in database)
 */
router.get('/images/orphaned/list', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await wikiAdminService.detectOrphanedImages();
    res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /api/admin/wiki/images/orphaned/cleanup
 * Delete specified orphaned image files
 * Body: { filenames: string[] }
 */
router.delete('/images/orphaned/cleanup', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { filenames } = req.body;

    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'No filenames provided' });
    }

    const result = await wikiAdminService.deleteOrphanedImages(filenames);
    res.json(result);
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
 * GET /api/admin/wiki/:slug/export
 * Export article with all languages and images as ZIP
 * Query params: ?download=true to download instead of stream
 */
router.get('/:slug/export', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    const { stream, filename } = await wikiExportImportService.exportArticleAsZip(
      slug,
      process.env.FORUM_URL || 'http://localhost:7100'
    );

    // Set response headers for ZIP download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    // Pipe the ZIP stream to response
    stream.pipe(res);

    stream.on('error', (error) => {
      console.error('ZIP stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to generate ZIP' });
      }
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /api/admin/wiki/import-metadata
 * Check if article exists and get conflict info
 * Body: { slug, metadata }
 */
router.post('/import-check/:slug', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    // Check if article exists
    const result = await wikiAdminService.queryDatabase(
      `SELECT id, updated_at FROM wiki_articles WHERE slug = ? LIMIT 1`,
      [slug],
    );

    const exists = result && (result as any[]).length > 0;

    res.json({
      slug,
      exists,
      last_updated: exists ? (result as any[])[0].updated_at : null,
      message: exists ? `Article "${slug}" already exists. Confirm to overwrite.` : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /api/admin/wiki/import
 * Import article from metadata JSON
 * Body: {
 *   metadata: { slug, articles: [...] },
 *   overwrite: boolean (if article exists)
 * }
 * 
 * Note: For full ZIP import with images, use separate image upload endpoint
 */
router.post('/import', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { metadata, overwrite } = req.body;

    if (!metadata) {
      return res.status(400).json({ error: 'Missing metadata in request' });
    }

    // Validate metadata structure
    const validation = wikiExportImportService.validateZipStructure(metadata);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid metadata structure',
        details: validation.errors,
      });
    }

    // Check if article exists
    const existing = await wikiAdminService.queryDatabase(
      `SELECT id FROM wiki_articles WHERE slug = ? LIMIT 1`,
      [metadata.slug],
    );

    if (existing && (existing as any[]).length > 0 && !overwrite) {
      return res.status(409).json({
        error: `Article "${metadata.slug}" already exists`,
        slug: metadata.slug,
        conflict: true,
      });
    }

    // Import article (will overwrite if existing and overwrite=true)
    const result = await wikiExportImportService.importArticle(
      metadata,
      [],
      req.userId!,
      overwrite
    );

    res.status(overwrite ? 200 : 201).json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
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
