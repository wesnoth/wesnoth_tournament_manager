/**
 * Wiki Admin Service
 * Business logic for admin/moderator wiki management with JSON translations
 */

import { queryTournament } from '../config/tournamentDatabase.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CreateArticleParams {
  slug: string;
  translations: {
    [language: string]: {
      title: string;
      content_markdown: string;
    };
  };
  author_id: string;
  is_published?: boolean;
}

interface UpdateArticleParams {
  slug: string;
  translations?: {
    [language: string]: {
      title?: string;
      content_markdown?: string;
    };
  };
  is_published?: boolean;
  editor_id?: string;
}

interface ImageMetadata {
  id: number;
  filename: string;
  original_name: string;
  uploaded_by: string | null;
  created_at: string;
  usage_count: number;
}

interface WikiArticleRow {
  id: string;
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
 * Get all articles for admin listing
 */
export const getArticlesList = async (): Promise<any[]> => {
  try {
    const result = await queryTournament(
      `SELECT id, slug, translations, author_id, is_published, created_at, updated_at
       FROM wiki_articles
       ORDER BY updated_at DESC`
    );

    return (result as WikiArticleRow[]).map(row => ({
      id: row.id,
      slug: row.slug,
      translations: JSON.parse(row.translations),
      author_id: row.author_id,
      is_published: row.is_published === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  } catch (error) {
    console.error('Error fetching articles list:', error);
    throw error;
  }
};

/**
 * Extract image URLs from markdown content
 * Matches ![alt](/uploads/wiki/FILENAME) patterns
 */
export const extractImageUrls = (markdown: string): string[] => {
  const urlRegex = /!\[[^\]]*\]\((?:\/uploads\/wiki\/|\/api\/public\/wiki\/images\/)([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches: string[] = [];
  let match;
  while ((match = urlRegex.exec(markdown)) !== null) {
    if (isSafeImageFilename(match[1])) {
      matches.push(match[1]);
    }
  }
  return [...new Set(matches)];
};

/** Accept only generated image names; this value is also used in filesystem paths. */
export const isSafeImageFilename = (filename: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) && !filename.includes('..');

/**
 * Validate slug format (alphanumeric, hyphens, underscores)
 */
export const validateSlug = (slug: string): boolean => {
  return /^[a-z0-9_-]+$/.test(slug);
};

/**
 * Create new wiki article with translations
 */
export const createArticle = async (params: CreateArticleParams): Promise<string> => {
  if (!validateSlug(params.slug)) {
    throw new Error('Invalid slug format. Use only lowercase letters, numbers, hyphens, and underscores.');
  }

  // Validate translations
  const { en } = params.translations;
  if (!en || !en.title || !en.content_markdown) {
    throw new Error('English (en) translation with title and content is required');
  }

  for (const lang in params.translations) {
    const trans = params.translations[lang];
    if (trans.title && trans.title.trim().length === 0) {
      throw new Error(`Title for language "${lang}" cannot be empty`);
    }
    if (trans.content_markdown && trans.content_markdown.trim().length === 0) {
      throw new Error(`Content for language "${lang}" cannot be empty`);
    }
  }

  // Check if slug already exists
  const existing = await queryTournament(
    'SELECT id FROM wiki_articles WHERE slug = ?',
    [params.slug]
  );

  if ((existing as any[]).length > 0) {
    throw new Error(`Article with slug "${params.slug}" already exists`);
  }

  // Create article with translations JSON
  const translationsJson = JSON.stringify(params.translations);
  const articleId = uuidv4();
  await queryTournament(
    `INSERT INTO wiki_articles 
      (id, slug, translations, author_id, is_published, created_at, updated_at) 
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [articleId, params.slug, translationsJson, params.author_id, params.is_published ? 1 : 0]
  );

  // Extract and link images from all language versions
  const allImageFilenames = new Set<string>();
  for (const lang in params.translations) {
    const imageFilenames = extractImageUrls(params.translations[lang].content_markdown);
    imageFilenames.forEach(f => allImageFilenames.add(f));
  }

  if (allImageFilenames.size > 0) {
    await linkImagesToArticle(articleId, Array.from(allImageFilenames));
  }

  return articleId;
};

/**
 * Get article with all translations for editing
 */
export const getArticleForEditing = async (slug: string): Promise<any | null> => {
  try {
    const result = (await queryTournament(
      `SELECT id, slug, translations, author_id, is_published, created_at, updated_at
       FROM wiki_articles
       WHERE slug = ?
       LIMIT 1`,
      [slug]
    )) as WikiArticleRow[];

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      id: row.id,
      slug: row.slug,
      translations: JSON.parse(row.translations),
      author_id: row.author_id,
      is_published: row.is_published === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  } catch (error) {
    console.error('Error fetching article for editing:', error);
    throw error;
  }
};

/**
 * Update wiki article translations
 */
export const updateArticle = async (slug: string, params: UpdateArticleParams): Promise<void> => {
  try {
    // Get existing article
    const existing = (await queryTournament(
      `SELECT id, translations FROM wiki_articles WHERE slug = ?`,
      [slug]
    )) as WikiArticleRow[];

    if (existing.length === 0) {
      throw new Error(`Article with slug "${slug}" not found`);
    }

    const article = existing[0];
    const currentTranslations: WikiTranslations = JSON.parse(article.translations);

    // Merge new translations with existing ones
    let updatedTranslations = { ...currentTranslations };
    if (params.translations) {
      updatedTranslations = { ...updatedTranslations, ...params.translations };
    }

    // Ensure English translation exists
    if (!updatedTranslations.en?.title?.trim() || !updatedTranslations.en.content_markdown?.trim()) {
      throw new Error('English (en) translation with title and content is required');
    }

    // Update article
    const translationsJson = JSON.stringify(updatedTranslations);
    await queryTournament(
      `UPDATE wiki_articles 
       SET translations = ?, is_published = COALESCE(?, is_published), updated_at = NOW()
       WHERE slug = ?`,
      [translationsJson, params.is_published !== undefined ? (params.is_published ? 1 : 0) : null, slug]
    );

    // Extract and link images from all language versions
    const allImageFilenames = new Set<string>();
    for (const lang in updatedTranslations) {
      const trans = updatedTranslations[lang];
      if (trans && trans.content_markdown) {
        const imageFilenames = extractImageUrls(trans.content_markdown);
        imageFilenames.forEach(f => allImageFilenames.add(f));
      }
    }

    // Clear old image links and create new ones
    await queryTournament(
      `DELETE FROM wiki_article_images WHERE article_id = ?`,
      [article.id]
    );

    if (allImageFilenames.size > 0) {
      await linkImagesToArticle(article.id, Array.from(allImageFilenames));
    }
  } catch (error) {
    console.error('Error updating article:', error);
    throw error;
  }
};

/**
 * Delete wiki article and its image links
 */
export const deleteArticle = async (slug: string): Promise<void> => {
  try {
    const result = (await queryTournament(
      `SELECT id FROM wiki_articles WHERE slug = ?`,
      [slug]
    )) as any[];

    if (result.length === 0) {
      throw new Error(`Article with slug "${slug}" not found`);
    }

    const articleId = result[0].id;

    // Delete image links first
    await queryTournament(
      `DELETE FROM wiki_article_images WHERE article_id = ?`,
      [articleId]
    );

    // Delete article
    await queryTournament(
      `DELETE FROM wiki_articles WHERE id = ?`,
      [articleId]
    );
  } catch (error) {
    console.error('Error deleting article:', error);
    throw error;
  }
};

/**
 * Upload image for wiki articles
 */
export const uploadImage = async (
  file: Express.Multer.File,
  uploader_id: string | null
): Promise<{ id: number; filename: string; url: string }> => {
  if (!file) {
    throw new Error('No file provided');
  }

  const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  if (!allowedMimeTypes.has(file.mimetype)) {
    throw new Error('Only JPEG, PNG, GIF, and WebP images are supported');
  }

  const extension = path.extname(file.originalname).toLowerCase();
  const filename = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${extension}`;
  const uploadDir = path.join(__dirname, '../../uploads/wiki');

  // Ensure directory exists
  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (error) {
    console.error('Error creating upload directory:', error);
  }

  const filepath = path.join(uploadDir, filename);

  // Write file to disk
  try {
    await fs.writeFile(filepath, file.buffer);
  } catch (error) {
    console.error('Error writing file to disk:', error);
    throw new Error('Failed to save image file');
  }

  // Store metadata in database
  try {
    const result = await queryTournament(
      `INSERT INTO wiki_images (filename, original_name, uploaded_by, created_at)
       VALUES (?, ?, ?, NOW())`,
      [filename, file.originalname, uploader_id]
    );

    const imageId = (result as any).insertId as number;
    return {
      id: imageId,
      filename,
      url: `/api/public/wiki/images/${filename}`
    };
  } catch (error) {
    console.error('Error storing image metadata:', error);
    // Clean up file if database insert fails
    try {
      await fs.unlink(filepath);
    } catch (e) {
      console.error('Error cleaning up file:', e);
    }
    throw error;
  }
};

/**
 * Get all uploaded images
 */
export const getAllImages = async (): Promise<ImageMetadata[]> => {
  try {
    const result = await queryTournament(
      `SELECT wi.id, wi.filename, wi.original_name, wi.uploaded_by, wi.created_at,
              COUNT(wai.article_id) AS usage_count
       FROM wiki_images wi
       LEFT JOIN wiki_article_images wai ON wai.wiki_image_id = wi.id
       GROUP BY wi.id, wi.filename, wi.original_name, wi.uploaded_by, wi.created_at
       ORDER BY wi.created_at DESC`
    );

    // Aggregate values may be returned as strings depending on the database
    // driver configuration. Normalize the public contract for strict frontend
    // comparisons and JSON consumers.
    return (result as Array<Omit<ImageMetadata, 'usage_count'> & { usage_count: number | string }>).map((image) => ({
      ...image,
      usage_count: Number(image.usage_count),
    }));
  } catch (error) {
    console.error('Error fetching images:', error);
    throw error;
  }
};

/**
 * Get usage of an image (which articles use it)
 */
export const getImageUsage = async (filename: string): Promise<any[]> => {
  try {
    const result = (await queryTournament(
      `SELECT DISTINCT wa.id, wa.slug, wa.translations, wa.is_published
       FROM wiki_article_images wai
       JOIN wiki_images wi ON wai.wiki_image_id = wi.id
       JOIN wiki_articles wa ON wai.article_id = wa.id
       WHERE wi.filename = ?`,
      [filename]
    )) as any[];

    return result.map(row => ({
      article_id: row.id,
      slug: row.slug,
      is_published: row.is_published === 1,
      // Parse translations to get titles
      titles: (() => {
        try {
          const trans: WikiTranslations = JSON.parse(row.translations);
          return Object.keys(trans).reduce((acc, lang) => {
            if (trans[lang]?.title) {
              acc[lang] = trans[lang].title;
            }
            return acc;
          }, {} as any);
        } catch {
          return {};
        }
      })()
    }));
  } catch (error) {
    console.error('Error fetching image usage:', error);
    throw error;
  }
};

/**
 * Delete image file and metadata
 */
export const deleteImage = async (filename: string): Promise<void> => {
  try {
    if (!isSafeImageFilename(filename)) {
      throw new Error('Invalid image filename');
    }

    // Find image id
    const result = (await queryTournament(
      `SELECT id FROM wiki_images WHERE filename = ?`,
      [filename]
    )) as any[];

    if (result.length === 0) {
      throw new Error(`Image with filename "${filename}" not found`);
    }

    const imageId = result[0].id;

    const usage = (await queryTournament(
      `SELECT 1 FROM wiki_article_images WHERE wiki_image_id = ? LIMIT 1`,
      [imageId],
    )) as any[];
    if (usage.length > 0) {
      throw new Error('Image is still used by one or more articles');
    }

    // Repeat the usage check in the DELETE itself. The image library can change
    // between the initial request and UI confirmation, so the destructive
    // operation must enforce the zero-reference invariant again.
    const deleteResult = (await queryTournament(
      `DELETE FROM wiki_images
       WHERE id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM wiki_article_images
           WHERE wiki_image_id = ?
         )`,
      [imageId, imageId]
    )) as { affectedRows?: number };

    if (deleteResult.affectedRows !== 1) {
      throw new Error('Image is still used by one or more articles');
    }

    // Delete file from disk
    const filepath = path.join(__dirname, '../../uploads/wiki', filename);
    try {
      await fs.unlink(filepath);
    } catch (error) {
      console.warn(`Warning: Could not delete file "${filename}" from disk:`, error);
      // Don't throw - file might already be gone
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
};

/**
 * Delete a requested set of registered images that still have zero article links.
 *
 * Each image is checked independently so a concurrently reused image is reported
 * as failed without preventing other safe deletions in the same cleanup request.
 */
export const deleteUnusedImages = async (filenames: string[]): Promise<{
  deleted: string[];
  failed: string[];
}> => {
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const filename of [...new Set(filenames)]) {
    if (typeof filename !== 'string' || !isSafeImageFilename(filename)) {
      failed.push(filename);
      continue;
    }

    try {
      await deleteImage(filename);
      deleted.push(filename);
    } catch {
      failed.push(filename);
    }
  }

  return { deleted, failed };
};

/**
 * Link images to article
 */
export const linkImagesToArticle = async (articleId: string, imageFilenames: string[]): Promise<void> => {
  try {
    for (const filename of imageFilenames) {
      // Get image id by filename
      const imageResult = (await queryTournament(
        `SELECT id FROM wiki_images WHERE filename = ?`,
        [filename]
      )) as any[];

      if (imageResult.length > 0) {
        const imageId = imageResult[0].id;

        // Insert link (ignore duplicates)
        await queryTournament(
          `INSERT IGNORE INTO wiki_article_images (article_id, wiki_image_id, created_at)
           VALUES (?, ?, NOW())`,
          [articleId, imageId]
        );
      }
    }
  } catch (error) {
    console.error('Error linking images to article:', error);
    throw error;
  }
};

/**
 * Direct query database for export/import operations
 * Used by export/import endpoints to fetch data
 */
export const queryDatabase = async (sql: string, params?: any[]): Promise<any> => {
  try {
    return await queryTournament(sql, params);
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

/**
 * Detect orphaned images in filesystem (not registered in database)
 */
export const detectOrphanedImages = async (): Promise<{
  orphaned: Array<{ filename: string; path: string; size: number }>;
  total_size_bytes: number;
}> => {
  try {
    const uploadDir = path.join(__dirname, '../../uploads/wiki');

    // Get all files from filesystem
    let filesOnDisk: string[] = [];
    try {
      filesOnDisk = await fs.readdir(uploadDir);
    } catch (error) {
      console.warn('Could not read upload directory:', error);
      return { orphaned: [], total_size_bytes: 0 };
    }

    // Get all filenames from database
    const dbImages = (await queryTournament(
      `SELECT filename FROM wiki_images ORDER BY filename`
    )) as any[];

    const dbFilenames = new Set(dbImages.map((img) => img.filename));

    // Find orphaned files
    const orphaned: Array<{ filename: string; path: string; size: number }> = [];
    let total_size_bytes = 0;

    for (const filename of filesOnDisk) {
      if (!dbFilenames.has(filename)) {
        const filepath = path.join(uploadDir, filename);
        try {
          const stats = await fs.stat(filepath);
          orphaned.push({
            filename,
            path: filepath,
            size: stats.size,
          });
          total_size_bytes += stats.size;
        } catch (error) {
          console.warn(`Could not stat file: ${filename}`, error);
        }
      }
    }

    return {
      orphaned: orphaned.sort((a, b) => b.size - a.size),
      total_size_bytes,
    };
  } catch (error) {
    console.error('Error detecting orphaned images:', error);
    throw error;
  }
};

/**
 * Delete orphaned image files
 */
export const deleteOrphanedImages = async (filenames: string[]): Promise<{
  deleted: string[];
  failed: string[];
}> => {
  const uploadDir = path.join(__dirname, '../../uploads/wiki');
  const deleted: string[] = [];
  const failed: string[] = [];

  for (const filename of filenames) {
    try {
      if (!isSafeImageFilename(filename)) {
        failed.push(filename);
        continue;
      }
      const filepath = path.join(uploadDir, filename);

      // Security check: ensure path is within uploads directory
      const realpath = await fs.realpath(filepath);
      const realUploadDir = await fs.realpath(uploadDir);

      if (!realpath.startsWith(`${realUploadDir}${path.sep}`)) {
        console.warn(`Security: attempted to delete file outside upload directory: ${filename}`);
        failed.push(filename);
        continue;
      }

      // Check if file exists and is not in database
      const dbCheck = (await queryTournament(
        `SELECT id FROM wiki_images WHERE filename = ? LIMIT 1`,
        [filename]
      )) as any[];

      if (dbCheck.length > 0) {
        console.warn(`Security: attempted to delete registered image: ${filename}`);
        failed.push(filename);
        continue;
      }

      // Delete file
      await fs.unlink(filepath);
      deleted.push(filename);
    } catch (error) {
      console.error(`Error deleting orphaned image ${filename}:`, error);
      failed.push(filename);
    }
  }

  return { deleted, failed };
};
