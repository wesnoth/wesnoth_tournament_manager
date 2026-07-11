/**
 * Wiki Export/Import Service
 * Handles exporting and importing wiki articles with images as ZIP files
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
}

interface ImportedImage {
  filename: string;
  data: Buffer;
}

/**
 * Export article as ZIP with metadata and images
 * Returns a stream that can be piped to response
 */
export async function exportArticleAsZip(
  slug: string,
  imageGetterCallback: (filename: string) => Promise<Buffer | null>,
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

    // Create metadata
    const metadata: ArticleMetadata = {
      slug,
      articles: Object.entries(translations).map(([lang, data]: [string, any]) => ({
        language: lang,
        title: data.title,
        content: data.content_markdown,
      })),
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
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

    // Find all image filenames in content
    const imageFilenames = new Set<string>();
    Object.values(translations).forEach((data: any) => {
      const content = data.content_markdown || '';
      const matches = content.match(/\/api\/public\/wiki\/images\/([^\)]+)/g);
      if (matches) {
        matches.forEach((match: string) => {
          const filename = match.replace('/api/public/wiki/images/', '');
          imageFilenames.add(filename);
        });
      }
    });

    // Add images to ZIP
    for (const filename of imageFilenames) {
      try {
        const imageBuffer = await imageGetterCallback(filename);
        if (imageBuffer) {
          archive.append(imageBuffer, { name: `images/${filename}` });
        }
      } catch (error) {
        console.warn(`Could not add image to ZIP: ${filename}`);
      }
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
 * Parse ZIP import and extract article data
 */
export async function parseImportZip(buffer: Buffer): Promise<{
  metadata: ArticleMetadata;
  images: ImportedImage[];
}> {
  try {
    // For now, we'll use a simple approach: the ZIP is expected to contain
    // article-metadata.json and images/ folder
    // In production, you'd use unzipper or similar library

    // This is a placeholder - actual implementation would need
    // to properly unzip the buffer. For this, we'd need another library.
    // For now, we'll assume the client sends metadata + images separately.

    throw new Error('ZIP parsing not fully implemented - use metadata + images API');
  } catch (error) {
    throw new Error(`Failed to parse import ZIP: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Import article from metadata and images
 * Checks for conflicts before importing
 */
export async function importArticle(
  metadata: ArticleMetadata,
  images: ImportedImage[],
  userId: string,
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

    if (existing && (existing as any[]).length > 0) {
      // Return conflict info - caller must confirm overwrite
      return {
        slug,
        imported_languages: [],
        message: `Article "${slug}" already exists. Confirm to overwrite all translations.`,
      };
    }

    // Prepare translations object
    const translations: Record<string, any> = {};
    const importedLanguages: string[] = [];

    for (const article of articles) {
      translations[article.language] = {
        title: article.title,
        content_markdown: article.content,
      };
      importedLanguages.push(article.language);
    }

    // Save images first (if image handler provided in controller)
    // For now, we'll just validate the metadata

    // Create article in database
    await queryTournament(
      `INSERT INTO wiki_articles (slug, translations, author_id, is_published, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [slug, JSON.stringify(translations), userId, 1],
    );

    return {
      slug,
      imported_languages: importedLanguages,
      message: `Article "${slug}" imported successfully with ${importedLanguages.length} languages.`,
    };
  } catch (error) {
    throw new Error(`Failed to import article: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Confirm overwrite of existing article
 */
export async function overwriteArticle(
  slug: string,
  metadata: ArticleMetadata,
  images: ImportedImage[],
  userId: string,
): Promise<{
  slug: string;
  updated_languages: string[];
  message: string;
}> {
  try {
    // Prepare translations object
    const translations: Record<string, any> = {};
    const updatedLanguages: string[] = [];

    for (const article of metadata.articles) {
      translations[article.language] = {
        title: article.title,
        content_markdown: article.content,
      };
      updatedLanguages.push(article.language);
    }

    // Update existing article
    await queryTournament(
      `UPDATE wiki_articles
       SET translations = ?, editor_id = ?, updated_at = NOW()
       WHERE slug = ?`,
      [JSON.stringify(translations), userId, slug],
    );

    return {
      slug,
      updated_languages: updatedLanguages,
      message: `Article "${slug}" overwritten successfully with ${updatedLanguages.length} languages.`,
    };
  } catch (error) {
    throw new Error(
      `Failed to overwrite article: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Get images for an article and create image map
 */
export async function getArticleImages(slug: string): Promise<Map<string, Buffer>> {
  try {
    const article = await queryTournament(
      `SELECT translations FROM wiki_articles WHERE slug = ? LIMIT 1`,
      [slug],
    );

    if (!article || (article as any[]).length === 0) {
      return new Map();
    }

    const translations = JSON.parse((article as any[])[0].translations);
    const imageFilenames = new Set<string>();

    // Extract all image filenames from markdown
    Object.values(translations).forEach((data: any) => {
      const content = data.content_markdown || '';
      const matches = content.match(/\/api\/public\/wiki\/images\/([^\)]+)/g);
      if (matches) {
        matches.forEach((match: string) => {
          const filename = match.replace('/api/public/wiki/images/', '');
          imageFilenames.add(filename);
        });
      }
    });

    // Fetch images from database
    const imageMap = new Map<string, Buffer>();

    for (const filename of imageFilenames) {
      try {
        const result = await queryTournament(
          `SELECT file_data FROM wiki_images WHERE filename = ? LIMIT 1`,
          [filename],
        );

        if (result && (result as any[]).length > 0) {
          const imageBuffer = (result as any[])[0].file_data;
          imageMap.set(filename, imageBuffer);
        }
      } catch (error) {
        console.warn(`Failed to fetch image: ${filename}`);
      }
    }

    return imageMap;
  } catch (error) {
    throw new Error(
      `Failed to get article images: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Validate exported ZIP structure
 */
export function validateZipStructure(metadata: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check metadata structure
  if (!metadata.slug || typeof metadata.slug !== 'string') {
    errors.push('Missing or invalid slug in metadata');
  }

  if (!Array.isArray(metadata.articles) || metadata.articles.length === 0) {
    errors.push('No articles found in metadata');
  }

  // Check article structure
  metadata.articles?.forEach((article: any, index: number) => {
    if (!article.language) {
      errors.push(`Article ${index}: missing language`);
    }
    if (!article.title) {
      errors.push(`Article ${index}: missing title`);
    }
    if (!article.content) {
      errors.push(`Article ${index}: missing content`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get export/import statistics
 */
export async function getExportStats(slug: string): Promise<{
  slug: string;
  languages: string[];
  image_count: number;
  total_size_kb: number;
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
    const languages = Object.keys(translations);

    // Get image count
    const imageFilenames = new Set<string>();
    Object.values(translations).forEach((data: any) => {
      const content = data.content_markdown || '';
      const matches = content.match(/\/api\/public\/wiki\/images\/([^\)]+)/g);
      if (matches) {
        matches.forEach((match: string) => {
          const filename = match.replace('/api/public/wiki/images/', '');
          imageFilenames.add(filename);
        });
      }
    });

    // Calculate size estimate (metadata + images)
    let totalSize = JSON.stringify(translations).length;
    for (const filename of imageFilenames) {
      try {
        const result = await queryTournament(
          `SELECT LENGTH(file_data) as size FROM wiki_images WHERE filename = ? LIMIT 1`,
          [filename],
        );
        if (result && (result as any[]).length > 0) {
          totalSize += (result as any[])[0].size || 0;
        }
      } catch (error) {
        // Ignore image size errors
      }
    }

    return {
      slug,
      languages,
      image_count: imageFilenames.size,
      total_size_kb: Math.ceil(totalSize / 1024),
    };
  } catch (error) {
    throw new Error(`Failed to get export stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
