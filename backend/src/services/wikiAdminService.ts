/**
 * Wiki Admin Service
 * Business logic for admin/moderator wiki management: CRUD articles, image uploads, usage tracking
 */

import { queryTournament } from '../config/tournamentDatabase.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CreateArticleParams {
  slug: string;
  title: string;
  content_markdown: string;
  language: string;
  author_id: number;
  is_published?: boolean;
}

interface UpdateArticleParams {
  slug: string;
  title?: string;
  content_markdown?: string;
  language?: string;
  is_published?: boolean;
  editor_id?: number;
}

interface ImageMetadata {
  id: number;
  filename: string;
  original_name: string;
  uploaded_by: number | null;
  created_at: string;
}

/**
 * Extract image URLs from markdown content
 * Matches ![alt](/uploads/wiki/FILENAME) patterns
 */
export const extractImageUrls = (markdown: string): string[] => {
  const urlRegex = /!\[.*?\]\(\/uploads\/wiki\/([^)]+)\)/g;
  const matches = [];
  let match;
  while ((match = urlRegex.exec(markdown)) !== null) {
    matches.push(match[1]); // Extract just the filename
  }
  return matches;
};

/**
 * Validate slug format (alphanumeric, hyphens, underscores)
 */
export const validateSlug = (slug: string): boolean => {
  return /^[a-z0-9_-]+$/.test(slug);
};

/**
 * Create new wiki article
 */
export const createArticle = async (params: CreateArticleParams): Promise<number> => {
  if (!validateSlug(params.slug)) {
    throw new Error('Invalid slug format. Use only lowercase letters, numbers, hyphens, and underscores.');
  }

  if (!params.title || params.title.trim().length === 0) {
    throw new Error('Title cannot be empty');
  }

  if (!params.content_markdown || params.content_markdown.trim().length === 0) {
    throw new Error('Content cannot be empty');
  }

  // Check if slug already exists for this language
  const existing = await queryTournament(
    'SELECT id FROM wiki_articles WHERE slug = ? AND language = ?',
    [params.slug, params.language]
  );

  if ((existing as any[]).length > 0) {
    throw new Error(`Article with slug "${params.slug}" already exists for language "${params.language}"`);
  }

  // Create article
  const result = await queryTournament(
    `INSERT INTO wiki_articles 
      (slug, title, content_markdown, language, author_id, is_published, created_at, updated_at) 
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [params.slug, params.title, params.content_markdown, params.language, params.author_id, params.is_published ? 1 : 0]
  );

  const articleId = (result as any).insertId as number;

  // Extract and link images
  const imageFilenames = extractImageUrls(params.content_markdown);
  await linkImagesToArticle(articleId, imageFilenames);

  return articleId;
};

/**
 * Update existing article
 */
export const updateArticle = async (slug: string, params: UpdateArticleParams): Promise<void> => {
  // Get current article
  const existing = await queryTournament(
    'SELECT id, content_markdown FROM wiki_articles WHERE slug = ?',
    [slug]
  );

  if ((existing as any[]).length === 0) {
    throw new Error(`Article "${slug}" not found`);
  }

  const articleId = (existing as any[])[0].id;
  const oldContent = (existing as any[])[0].content_markdown;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (params.title !== undefined) {
    updates.push('title = ?');
    values.push(params.title);
  }

  if (params.content_markdown !== undefined) {
    if (params.content_markdown.trim().length === 0) {
      throw new Error('Content cannot be empty');
    }
    updates.push('content_markdown = ?');
    values.push(params.content_markdown);
  }

  if (params.language !== undefined) {
    updates.push('language = ?');
    values.push(params.language);
  }

  if (params.is_published !== undefined) {
    updates.push('is_published = ?');
    values.push(params.is_published ? 1 : 0);
  }

  if (updates.length === 0) {
    return; // No updates
  }

  // Always update timestamp
  updates.push('updated_at = NOW()');

  values.push(slug);

  // Update article
  await queryTournament(
    `UPDATE wiki_articles SET ${updates.join(', ')} WHERE slug = ?`,
    values
  );

  // Sync images if content changed
  if (params.content_markdown !== undefined) {
    const oldImages = extractImageUrls(oldContent);
    const newImages = extractImageUrls(params.content_markdown);

    // Remove old image links
    for (const filename of oldImages) {
      if (!newImages.includes(filename)) {
        await queryTournament(
          `DELETE FROM wiki_article_images 
           WHERE wiki_article_id = ? 
           AND wiki_image_id = (SELECT id FROM wiki_images WHERE filename = ?)`,
          [articleId, filename]
        );
      }
    }

    // Add new image links
    for (const filename of newImages) {
      if (!oldImages.includes(filename)) {
        await linkImagesToArticle(articleId, [filename]);
      }
    }
  }
};

/**
 * Soft delete article (set is_published = 0)
 */
export const softDeleteArticle = async (slug: string): Promise<void> => {
  const result = await queryTournament(
    'UPDATE wiki_articles SET is_published = 0, updated_at = NOW() WHERE slug = ?',
    [slug]
  );

  if ((result as any).affectedRows === 0) {
    throw new Error(`Article "${slug}" not found`);
  }
};

/**
 * Hard delete article (permanent removal)
 */
export const hardDeleteArticle = async (slug: string): Promise<void> => {
  const result = await queryTournament(
    'DELETE FROM wiki_articles WHERE slug = ?',
    [slug]
  );

  if ((result as any).affectedRows === 0) {
    throw new Error(`Article "${slug}" not found`);
  }
};

/**
 * Upload image file and create metadata record
 */
export const uploadImage = async (
  file: Express.Multer.File,
  userId: number | null
): Promise<{ id: number; filename: string; url: string }> => {
  if (!file) {
    throw new Error('No file provided');
  }

  // Validate file type (images only)
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (!allowedMimes.includes(file.mimetype)) {
    throw new Error(`Invalid file type. Allowed: ${allowedMimes.join(', ')}`);
  }

  // Max 5MB
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File size exceeds 5MB limit');
  }

  // Generate unique filename: timestamp + random + extension
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = path.extname(file.originalname).toLowerCase();
  const filename = `${timestamp}_${random}${ext}`;

  // Ensure uploads/wiki directory exists
  const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'wiki');
  try {
    await fs.mkdir(uploadDir, { recursive: true });
  } catch (e) {
    console.error('Failed to create upload directory:', e);
    throw new Error('Failed to create upload directory');
  }

  // Save file
  const filepath = path.join(uploadDir, filename);
  try {
    await fs.writeFile(filepath, file.buffer);
  } catch (e) {
    console.error('Failed to save file:', e);
    throw new Error('Failed to save file');
  }

  // Create metadata record
  const result = await queryTournament(
    'INSERT INTO wiki_images (filename, original_name, uploaded_by) VALUES (?, ?, ?)',
    [filename, file.originalname, userId]
  );

  return {
    id: (result as any).insertId as number,
    filename,
    url: `/uploads/wiki/${filename}`
  };
};

/**
 * Link images to an article
 */
export const linkImagesToArticle = async (articleId: number, imageFilenames: string[]): Promise<void> => {
  for (const filename of imageFilenames) {
    // Get image ID (or skip if doesn't exist)
    const image = await queryTournament(
      'SELECT id FROM wiki_images WHERE filename = ?',
      [filename]
    );

    if ((image as any[]).length > 0) {
      const imageId = (image as any[])[0].id;

      // Insert junction record (ignore if already exists)
      await queryTournament(
        `INSERT IGNORE INTO wiki_article_images (wiki_article_id, wiki_image_id) 
         VALUES (?, ?)`,
        [articleId, imageId]
      );
    }
  }
};

/**
 * Get image usage (how many articles reference it)
 */
export const getImageUsage = async (filename: string): Promise<Array<{ id: number; slug: string; title: string }>> => {
  const result = await queryTournament(
    `SELECT wa.id, wa.slug, wa.title 
     FROM wiki_articles wa
     INNER JOIN wiki_article_images wai ON wa.id = wai.wiki_article_id
     INNER JOIN wiki_images wi ON wai.wiki_image_id = wi.id
     WHERE wi.filename = ?`,
    [filename]
  );

  return result as any[];
};

/**
 * Delete image file and metadata (after checking no refs)
 */
export const deleteImage = async (filename: string): Promise<void> => {
  // Check if image is referenced in any article
  const usage = await getImageUsage(filename);
  if (usage.length > 0) {
    throw new Error(
      `Cannot delete image. It is referenced in ${usage.length} article(s): ${usage.map(u => u.slug).join(', ')}`
    );
  }

  // Delete from disk
  const filepath = path.join(__dirname, '..', '..', 'uploads', 'wiki', filename);
  try {
    await fs.unlink(filepath);
  } catch (e) {
    console.error(`Failed to delete file ${filename}:`, e);
    throw new Error('Failed to delete image file');
  }

  // Delete metadata record
  await queryTournament('DELETE FROM wiki_images WHERE filename = ?', [filename]);
};

/**
 * Get all images with usage count
 */
export const getAllImages = async (): Promise<
  Array<{ id: number; filename: string; original_name: string; uploaded_by: number | null; created_at: string; usage_count: number }>
> => {
  const result = await queryTournament(
    `SELECT wi.id, wi.filename, wi.original_name, wi.uploaded_by, wi.created_at,
            COUNT(wai.id) as usage_count
     FROM wiki_images wi
     LEFT JOIN wiki_article_images wai ON wi.id = wai.wiki_image_id
     GROUP BY wi.id
     ORDER BY wi.created_at DESC`
  );

  return result as any[];
};
