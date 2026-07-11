/**
 * Wiki Export/Import Service
 * Handles exporting and importing wiki articles with images as ZIP files
 * 
 * Export process:
 * 1. Get article metadata from database
 * 2. Download all referenced images from /api/public/wiki/images/
 * 3. Replace image URLs with relative paths (./images/filename)
 * 4. Create ZIP with article-metadata.json + images/ folder
 * 
 * Import process:
 * 1. Extract metadata.json from ZIP
 * 2. Upload all images from images/ folder to database
 * 3. Replace relative URLs back to /api/public/wiki/images/
 * 4. Create or update article with new image references
 */

import { queryTournament } from '../config/tournamentDatabase.js';
import { promises as fs } from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import { Writable, PassThrough } from 'stream';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ArticleMetadata {
  slug: string;
  articles: Array<{
    language: string;
    title: string;
    content: string;
  }>;
  exported_at: string;
  app_version: string;
  images: Array<{
    original_filename: string;
    relative_path: string;
  }>;
}

interface ImportedImage {
  filename: string;
  data: Buffer;
}

/**
 * Extract image filenames from markdown content
 * Returns Map of original_filename -> appears_in_languages
 */
function extractImageFilenames(
  translations: Record<string, any>,
): Map<string, string[]> {
  const imageMap = new Map<string, string[]>();
  const regex = /\/api\/public\/wiki\/images\/([^\)]+)/g;

  Object.entries(translations).forEach(([lang, data]: [string, any]) => {
    const content = data.content_markdown || '';
    let match;
    while ((match = regex.exec(content)) !== null) {
      const filename = match[1];
      if (!imageMap.has(filename)) {
        imageMap.set(filename, []);
      }
      if (!imageMap.get(filename)!.includes(lang)) {
        imageMap.get(filename)!.push(lang);
      }
    }
  });

  return imageMap;
}

/**
 * Read image from filesystem (local disk)
 */
async function readImageFromDisk(filename: string): Promise<Buffer | null> {
  try {
    const uploadDir = path.join(__dirname, '../../uploads/wiki');
    const filepath = path.join(uploadDir, filename);

    // Security: ensure path is within uploads directory
    const realpath = await fs.realpath(filepath);
    const realUploadDir = await fs.realpath(uploadDir);

    if (!realpath.startsWith(realUploadDir)) {
      console.warn(`Security: attempted to read file outside upload directory: ${filename}`);
      return null;
    }

    const data = await fs.readFile(filepath);
    return data;
  } catch (error) {
    console.warn(`Failed to read image from disk: ${filename}`, error);
    return null;
  }
}

/**
 * Replace image URLs in markdown with relative paths (for export)
 */
function replaceImageUrlsWithRelative(content: string, oldToNewMapping: Map<string, string>): string {
  let updated = content;
  oldToNewMapping.forEach((newPath, oldFilename) => {
    const oldUrl = `/api/public/wiki/images/${oldFilename}`;
    updated = updated.replace(new RegExp(oldUrl, 'g'), newPath);
  });
  return updated;
}

/**
 * Replace relative image URLs with absolute URLs (for import)
 */
function replaceRelativeUrlsWithAbsolute(content: string, imageMapping: Map<string, string>): string {
  let updated = content;
  imageMapping.forEach((absoluteUrl, relativePath) => {
    updated = updated.replace(new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), absoluteUrl);
  });
  return updated;
}

/**
 * Save image to wiki_images table
 * Returns the ID of the created/updated image record
 */
async function saveImageToDatabase(filename: string, buffer: Buffer): Promise<number> {
  try {
    const safeFilename = path.basename(filename);
    if (safeFilename !== filename) {
      throw new Error(`Invalid image filename: ${filename}`);
    }

    const uploadDir = path.join(__dirname, '../../uploads/wiki');
    await fs.mkdir(uploadDir, { recursive: true });
    const filepath = path.join(uploadDir, safeFilename);

    // Always write/overwrite file on disk so imported ZIP image is the source of truth.
    await fs.writeFile(filepath, buffer);

    // Check if image already exists
    const existing = await queryTournament(
      `SELECT id FROM wiki_images WHERE filename = ? LIMIT 1`,
      [safeFilename],
    );

    let imageId: number;

    if (existing && (existing as any[]).length > 0) {
      // Keep DB metadata aligned without assuming non-existent columns.
      imageId = (existing as any[])[0].id;
      await queryTournament(
        `UPDATE wiki_images SET original_name = ?, uploaded_by = ? WHERE id = ?`,
        [safeFilename, null, imageId],
      );
    } else {
      // Create new metadata row.
      const result = await queryTournament(
        `INSERT INTO wiki_images (filename, original_name, uploaded_by, created_at)
         VALUES (?, ?, ?, NOW())`,
        [safeFilename, safeFilename, null],
      );
      imageId = (result as any).insertId || 0;
    }

    return imageId;
  } catch (error) {
    console.error(`Failed to save image to database: ${filename}`, error);
    throw error;
  }
}

/**
 * Export article as ZIP with metadata and images
 * Returns a stream that can be piped to response
 */
export async function exportArticleAsZip(
  slug: string,
): Promise<{ stream: Writable; filename: string }> {
  try {
    // Get article from database
    const article = await queryTournament(
      `SELECT slug, translations, is_published, updated_at
       FROM wiki_articles
       WHERE slug = ?
       LIMIT 1`,
      [slug],
    );

    if (!article || (article as any[]).length === 0) {
      throw new Error(`Article not found: ${slug}`);
    }

    const articleRow = (article as any[])[0];
    const translations = JSON.parse(articleRow.translations);

    // Extract image filenames and read them from disk
    const imageMap = extractImageFilenames(translations);
    const imageMapping = new Map<string, string>(); // old filename -> new relative path
    const downloadedImages: Array<{ buffer: Buffer; filename: string }> = [];

    for (const [filename] of imageMap) {
      const imageBuffer = await readImageFromDisk(filename);
      if (imageBuffer) {
        downloadedImages.push({ buffer: imageBuffer, filename });
        imageMapping.set(filename, `./images/${filename}`);
      }
    }

    // Update markdown content with new image URLs
    const updatedTranslations = Object.entries(translations).reduce(
      (acc, [lang, data]: [string, any]) => {
        acc[lang] = {
          ...data,
          content_markdown: replaceImageUrlsWithRelative(data.content_markdown || '', imageMapping),
        };
        return acc;
      },
      {} as Record<string, any>,
    );

    // Create metadata
    const metadata: ArticleMetadata = {
      slug,
      articles: Object.entries(updatedTranslations).map(([lang, data]: [string, any]) => ({
        language: lang,
        title: data.title,
        content: data.content_markdown,
      })),
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      images: Array.from(imageMapping.entries()).map(([original, relative]) => ({
        original_filename: original,
        relative_path: relative,
      })),
    };

    // Create ZIP stream
    const passThrough = new PassThrough();
    const archive = new ZipArchive({ zlib: { level: 9 } });

    // Handle archive events
    archive.on('error', (err: Error) => {
      passThrough.destroy(err);
    });

    passThrough.on('error', (err: Error) => {
      archive.destroy();
    });

    // Pipe archive to passthrough
    archive.pipe(passThrough);

    // Add metadata.json
    archive.append(JSON.stringify(metadata, null, 2), {
      name: 'article-metadata.json',
    });

    // Add images to ZIP
    for (const { buffer, filename } of downloadedImages) {
      archive.append(buffer, { name: `images/${filename}` });
    }

    // Finalize the archive
    await archive.finalize();

    return {
      stream: passThrough,
      filename: `${slug}-${Date.now()}.zip`,
    };
  } catch (error) {
    throw new Error(`Failed to export article: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Check for import conflicts
 * Returns whether article exists and current languages
 */
export async function checkImportConflicts(slug: string): Promise<{
  exists: boolean;
  current_languages?: string[];
}> {
  try {
    // Check if article exists
    const existing = await queryTournament(
      `SELECT slug, translations FROM wiki_articles WHERE slug = ? LIMIT 1`,
      [slug],
    );

    if (existing && (existing as any[]).length > 0) {
      const row = (existing as any[])[0];
      const translations = JSON.parse(row.translations);
      const languages = Object.keys(translations).filter((lang) => translations[lang].title);

      return {
        exists: true,
        current_languages: languages,
      };
    }

    return { exists: false };
  } catch (error) {
    throw new Error(`Failed to check import conflicts: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Import article from metadata and images
 * Creates new article or updates existing (if force=true)
 */
export async function importArticle(
  metadata: ArticleMetadata,
  images: ImportedImage[],
  userId: string,
  force: boolean = false,
): Promise<{
  slug: string;
  imported_languages: string[];
  message: string;
}> {
  try {
    const { slug, articles } = metadata;

    // Validate slug
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new Error('Invalid slug format');
    }

    // Check if article exists
    const existing = await queryTournament(
      `SELECT id FROM wiki_articles WHERE slug = ? LIMIT 1`,
      [slug],
    );

    if (existing && (existing as any[]).length > 0 && !force) {
      throw new Error(
        `Article "${slug}" already exists. Use force=true to overwrite.`,
      );
    }

    // Upload images and create URL mapping
    const imageUrlMapping = new Map<string, string>(); // relative path -> absolute URL

    for (const image of images) {
      try {
        const imageId = await saveImageToDatabase(image.filename, image.data);
        // Map relative path to new absolute URL
        imageUrlMapping.set(`./images/${image.filename}`, `/api/public/wiki/images/${image.filename}`);
      } catch (error) {
        console.warn(`Failed to upload image: ${image.filename}`, error);
      }
    }

    // Prepare translations object and update image URLs back to absolute
    const translations: Record<string, any> = {};
    const importedLanguages: string[] = [];

    for (const article of articles) {
      if (article.title) {
        // Replace relative paths back to absolute URLs
        const updatedContent = replaceRelativeUrlsWithAbsolute(article.content, imageUrlMapping);

        translations[article.language] = {
          title: article.title,
          content_markdown: updatedContent,
        };
        importedLanguages.push(article.language);
      }
    }

    if (importedLanguages.length === 0) {
      throw new Error('No valid language translations found in import');
    }

    // Create or update article in database
    if (existing && (existing as any[]).length > 0) {
      // Update existing
      await queryTournament(
        `UPDATE wiki_articles 
         SET translations = ?, updated_at = NOW()
         WHERE slug = ?`,
        [JSON.stringify(translations), slug],
      );
    } else {
      // Create new
      await queryTournament(
        `INSERT INTO wiki_articles (id, slug, translations, author_id, is_published, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, 1, NOW(), NOW())`,
        [slug, JSON.stringify(translations), userId],
      );
    }

    return {
      slug,
      imported_languages: importedLanguages,
      message: `Article "${slug}" imported successfully with ${importedLanguages.length} languages and ${images.length} images.`,
    };
  } catch (error) {
    throw new Error(`Failed to import article: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate ZIP structure
 * Checks for required article-metadata.json
 */
export function validateZipStructure(metadata: ArticleMetadata): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!metadata.slug) {
    errors.push('Missing slug in metadata');
  }

  if (!Array.isArray(metadata.articles) || metadata.articles.length === 0) {
    errors.push('No articles found in metadata');
  } else {
    const validArticles = metadata.articles.filter((a) => a.language && a.title && a.content);
    if (validArticles.length === 0) {
      errors.push('No valid articles with language, title, and content');
    }
  }

  if (!Array.isArray(metadata.images)) {
    metadata.images = [];
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Export article stats (for UI feedback)
 */
export async function getExportStats(slug: string): Promise<{
  languages: string[];
  image_count: number;
}> {
  try {
    const article = await queryTournament(
      `SELECT translations FROM wiki_articles WHERE slug = ? LIMIT 1`,
      [slug],
    );

    if (!article || (article as any[]).length === 0) {
      throw new Error(`Article not found: ${slug}`);
    }

    const translations = JSON.parse((article as any[])[0].translations);
    const languages = Object.keys(translations).filter((lang) => translations[lang].title);
    const imageMap = extractImageFilenames(translations);

    return {
      languages,
      image_count: imageMap.size,
    };
  } catch (error) {
    throw new Error(`Failed to get export stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
