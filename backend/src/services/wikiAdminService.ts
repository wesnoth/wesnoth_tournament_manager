/**
 * Wiki Admin Service
 * Business logic for admin/moderator wiki management with JSON translations
 */

import { queryTournament } from '../config/tournamentDatabase.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
}

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
 * Create new wiki article with translations
 */
export const createArticle = async (params: CreateArticleParams): Promise<number> => {
  if (!validateSlug(params.slug)) {
    throw new Error('Invalid slug format. Use only lowercase letters, numbers, hyphens, and underscores.');
  }

  // Validate translations
  const { en, ...otherLangs } = params.translations;
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
  const result = await queryTournament(
    `INSERT INTO wiki_articles 
      (id, slug, translations, author_id, is_published, created_at, updated_at) 
     VALUES (UUID(), ?, ?, ?, ?, NOW(), NOW())`,
    [params.slug, translationsJson, params.author_id, params.is_published ? 1 : 0]
  );

  const articleId = (result as any).insertId as number;

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
    if (!updatedTranslations.en || !updatedTranslations.en.title) {
      throw new Error('English (en) translation with title is required');
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

  const timestamp = Date.now();
  const filename = `${timestamp}_${Math.random().toString(36).substring(7)}.${file.originalname.split('.').pop()}`;
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
      `SELECT id, filename, original_name, uploaded_by, created_at
       FROM wiki_images
       ORDER BY created_at DESC`
    );

    return result as ImageMetadata[];
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
    // Find image id
    const result = (await queryTournament(
      `SELECT id FROM wiki_images WHERE filename = ?`,
      [filename]
    )) as any[];

    if (result.length === 0) {
      throw new Error(`Image with filename "${filename}" not found`);
    }

    const imageId = result[0].id;

    // Delete image links
    await queryTournament(
      `DELETE FROM wiki_article_images WHERE wiki_image_id = ?`,
      [imageId]
    );

    // Delete metadata
    await queryTournament(
      `DELETE FROM wiki_images WHERE id = ?`,
      [imageId]
    );

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
 * Link images to article
 */
const linkImagesToArticle = async (articleId: number, imageFilenames: string[]): Promise<void> => {
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
