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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

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
 * DELETE /api/admin/wiki/images/unused/cleanup
 * Delete registered images that are no longer linked to any article.
 * Body: { filenames: string[] }
 */
router.delete('/images/unused/cleanup', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { filenames } = req.body;

    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'No filenames provided' });
    }

    const result = await wikiAdminService.deleteUnusedImages(filenames);
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
    if (!wikiAdminService.isSafeImageFilename(filename)) {
      return res.status(400).json({ error: 'Invalid image filename' });
    }
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
    if (!wikiAdminService.isSafeImageFilename(filename)) {
      return res.status(400).json({ error: 'Invalid image filename' });
    }
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
    const result = await wikiAdminService.getArticlesList();
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
 * GET /api/admin/wiki/import-check/:slug
 * Check if article exists and get conflict info
 */
router.get('/import-check/:slug', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { slug } = req.params;

    if (!wikiAdminService.validateSlug(slug)) {
      return res.status(400).json({ error: 'Invalid slug format' });
    }

    // Check if article exists
    const result = await wikiAdminService.queryDatabase(
      `SELECT id, translations, updated_at FROM wiki_articles WHERE slug = ? LIMIT 1`,
      [slug],
    );

    const exists = result && (result as any[]).length > 0;
    let current_languages: string[] = [];

    if (exists) {
      const row = (result as any[])[0];
      try {
        const translations = JSON.parse(row.translations);
        current_languages = Object.keys(translations).filter((lang) => translations[lang].title);
      } catch (err) {
        console.error('Failed to parse translations:', err);
      }
    }

    res.json({
      exists,
      current_languages,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /api/admin/wiki/import
 * Import article from metadata JSON with images
 * Body: {
 *   metadata: { slug, articles: [...], images: [...] },
 *   images: [{ filename, data: Buffer | string }],
 *   force: boolean (if article exists)
 * }
 */
router.post('/import', moderatorOrAdminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { metadata, images, force, overwriteConfirmed } = req.body;

    if (!metadata) {
      return res.status(400).json({ error: 'Missing metadata in request' });
    }

    if (force === true && overwriteConfirmed !== true) {
      return res.status(400).json({ error: 'Overwrite requires explicit user confirmation' });
    }

    // Validate metadata structure
    const validation = wikiExportImportService.validateZipStructure(metadata);
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid metadata structure',
        details: validation.errors,
      });
    }

    // Convert images: handle both Buffer objects and base64 strings
    const processedImages: Array<{ filename: string; data: Buffer }> = [];

    if (Array.isArray(images)) {
      for (const img of images) {
        try {
          let buffer: Buffer;

          if (typeof img.data === 'string') {
            // Base64 string
            buffer = Buffer.from(img.data, 'base64');
          } else if (img.data instanceof ArrayBuffer) {
            // ArrayBuffer from frontend
            buffer = Buffer.from(img.data);
          } else if (Buffer.isBuffer(img.data)) {
            // Already a buffer
            buffer = img.data;
          } else if (typeof img.data === 'object' && img.data.type === 'Buffer') {
            // Serialized buffer object { type: 'Buffer', data: [...] }
            buffer = Buffer.from(img.data.data);
          } else {
            console.warn(`Unknown image data type for ${img.filename}, skipping`);
            continue;
          }

          processedImages.push({
            filename: img.filename,
            data: buffer,
          });
        } catch (err) {
          console.error(`Failed to process image ${img.filename}:`, err);
        }
      }
    }

    // Import article (will overwrite if existing and force=true)
    const result = await wikiExportImportService.importArticle(
      metadata,
      processedImages,
      req.userId!,
      force
    );

    res.status(force ? 200 : 201).json(result);
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
