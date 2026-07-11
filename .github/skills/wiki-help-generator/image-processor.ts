/**
 * Image Processor for Wiki Help Generator Skill
 * Organizes and manages images by language
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ImageMetadata {
  filename: string;
  language: 'en' | 'es' | 'de' | 'zh' | 'ru';
  timestamp: number;
  section?: string;
  description?: string;
}

export interface LanguageImageCollection {
  language: 'en' | 'es' | 'de' | 'zh' | 'ru';
  imagesPath: string;
  images: ImageMetadata[];
}

export class ImageProcessor {
  private baseArtifactsPath: string;
  private pageSlug: string;

  constructor(pageSlug: string, baseArtifactsPath = 'wiki-artifacts') {
    this.pageSlug = pageSlug;
    this.baseArtifactsPath = baseArtifactsPath;
  }

  /**
   * Initialize directory structure for a page
   */
  initializeDirectories(languages: ('en' | 'es' | 'de' | 'zh' | 'ru')[]): void {
    languages.forEach((lang) => {
      const screenshotPath = this.getScreenshotPath(lang);
      if (!fs.existsSync(screenshotPath)) {
        fs.mkdirSync(screenshotPath, { recursive: true });
        console.log(`Created directory: ${screenshotPath}`);
      }
    });
  }

  /**
   * Get path for screenshot directory for a language
   */
  getScreenshotPath(language: 'en' | 'es' | 'de' | 'zh' | 'ru'): string {
    return path.join(this.baseArtifactsPath, this.pageSlug, language, 'screenshots');
  }

  /**
   * Get path for markdown file for a language
   */
  getMarkdownPath(language: 'en' | 'es' | 'de' | 'zh' | 'ru'): string {
    return path.join(this.baseArtifactsPath, this.pageSlug, language, 'markdown.md');
  }

  /**
   * Get path for language metadata file
   */
  getMetadataPath(language: 'en' | 'es' | 'de' | 'zh' | 'ru'): string {
    return path.join(this.baseArtifactsPath, this.pageSlug, language, 'metadata.json');
  }

  /**
   * Save an image for a specific language
   */
  async saveImage(
    language: 'en' | 'es' | 'de' | 'zh' | 'ru',
    sourceImagePath: string,
    targetFilename?: string,
  ): Promise<ImageMetadata> {
    const screenshotPath = this.getScreenshotPath(language);

    // Ensure directory exists
    if (!fs.existsSync(screenshotPath)) {
      fs.mkdirSync(screenshotPath, { recursive: true });
    }

    // Generate filename if not provided
    const filename = targetFilename || this.generateFilename();

    // Copy image to language-specific folder
    const targetPath = path.join(screenshotPath, filename);
    if (fs.existsSync(sourceImagePath)) {
      fs.copyFileSync(sourceImagePath, targetPath);
    } else {
      throw new Error(`Source image not found: ${sourceImagePath}`);
    }

    console.log(`Saved image for ${language}: ${filename}`);

    const metadata: ImageMetadata = {
      filename,
      language,
      timestamp: Date.now(),
    };

    return metadata;
  }

  /**
   * Save markdown content for a language
   */
  async saveMarkdown(
    language: 'en' | 'es' | 'de' | 'zh' | 'ru',
    content: string,
  ): Promise<void> {
    const markdownPath = this.getMarkdownPath(language);
    const dir = path.dirname(markdownPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(markdownPath, content, 'utf-8');
    console.log(`Saved markdown for ${language}: ${markdownPath}`);
  }

  /**
   * Save language metadata
   */
  async saveMetadata(
    language: 'en' | 'es' | 'de' | 'zh' | 'ru',
    metadata: any,
  ): Promise<void> {
    const metadataPath = this.getMetadataPath(language);
    const dir = path.dirname(metadataPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    console.log(`Saved metadata for ${language}: ${metadataPath}`);
  }

  /**
   * Get all images for a language
   */
  getImagesForLanguage(language: 'en' | 'es' | 'de' | 'zh' | 'ru'): string[] {
    const screenshotPath = this.getScreenshotPath(language);
    if (!fs.existsSync(screenshotPath)) {
      return [];
    }

    return fs
      .readdirSync(screenshotPath)
      .filter((file) => /\.(png|jpg|jpeg|gif)$/i.test(file));
  }

  /**
   * Get all images organized by language
   */
  getAllImages(): LanguageImageCollection[] {
    const languages: ('en' | 'es' | 'de' | 'zh' | 'ru')[] = [
      'en',
      'es',
      'de',
      'zh',
      'ru',
    ];

    return languages
      .map((lang) => {
        const images = this.getImagesForLanguage(lang).map((filename) => ({
          filename,
          language: lang,
          timestamp: Date.now(),
        }));

        return {
          language: lang,
          imagesPath: this.getScreenshotPath(lang),
          images,
        };
      })
      .filter((col) => col.images.length > 0);
  }

  /**
   * Get total number of images across all languages
   */
  getTotalImageCount(): number {
    const allImages = this.getAllImages();
    return allImages.reduce((sum, col) => sum + col.images.length, 0);
  }

  /**
   * List all created articles (folders in wiki-artifacts)
   */
  listArticles(): string[] {
    if (!fs.existsSync(this.baseArtifactsPath)) {
      return [];
    }

    return fs
      .readdirSync(this.baseArtifactsPath)
      .filter((file) => {
        const fullPath = path.join(this.baseArtifactsPath, file);
        return fs.statSync(fullPath).isDirectory();
      });
  }

  /**
   * Get summary of an article (which languages have content)
   */
  getArticleSummary(
    pageSlug: string,
  ): { language: 'en' | 'es' | 'de' | 'zh' | 'ru'; hasMarkdown: boolean; imageCount: number }[] {
    const languages: ('en' | 'es' | 'de' | 'zh' | 'ru')[] = [
      'en',
      'es',
      'de',
      'zh',
      'ru',
    ];
    const processor = new ImageProcessor(pageSlug, this.baseArtifactsPath);

    return languages.map((lang) => {
      const markdownPath = processor.getMarkdownPath(lang);
      const images = processor.getImagesForLanguage(lang);

      return {
        language: lang,
        hasMarkdown: fs.existsSync(markdownPath),
        imageCount: images.length,
      };
    });
  }

  /**
   * Validate image filenames and references
   */
  validateImageReferences(markdownContent: string): {
    valid: boolean;
    missingImages: string[];
    foundReferences: string[];
  } {
    // Find all image references in markdown
    const pattern = /!\[([^\]]*)\]\(\/api\/public\/wiki\/images\/([^)]+)\)/g;
    const matches = Array.from(markdownContent.matchAll(pattern));

    const foundReferences = matches.map((m) => m[2]);

    // Get actual images in current screenshot folder
    // Note: We can't validate across languages, so we just check format
    const invalidReferences = foundReferences.filter((ref) => {
      // Should match format: {timestamp}_{suffix}.{ext}
      return !/^\d{13,}_[a-z0-9]+\.png$/i.test(ref);
    });

    return {
      valid: invalidReferences.length === 0,
      missingImages: invalidReferences,
      foundReferences,
    };
  }

  /**
   * Generate a timestamp-based filename
   */
  private generateFilename(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${random}.png`;
  }

  /**
   * Clean up (remove) an article and all its images
   */
  removeArticle(pageSlug: string): boolean {
    const articlePath = path.join(this.baseArtifactsPath, pageSlug);
    if (fs.existsSync(articlePath)) {
      fs.rmSync(articlePath, { recursive: true, force: true });
      console.log(`Removed article: ${articlePath}`);
      return true;
    }
    return false;
  }

  /**
   * Get file size of all images for an article
   */
  getTotalImageSize(pageSlug: string): number {
    const processor = new ImageProcessor(pageSlug, this.baseArtifactsPath);
    const languages: ('en' | 'es' | 'de' | 'zh' | 'ru')[] = [
      'en',
      'es',
      'de',
      'zh',
      'ru',
    ];

    let totalSize = 0;
    languages.forEach((lang) => {
      const screenshotPath = processor.getScreenshotPath(lang);
      if (fs.existsSync(screenshotPath)) {
        const files = fs.readdirSync(screenshotPath);
        files.forEach((file) => {
          const filePath = path.join(screenshotPath, file);
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        });
      }
    });

    return totalSize;
  }

  /**
   * Export images to a temporary folder (for ZIP creation)
   */
  async exportImagesForZip(pageSlug: string, zipTempPath: string): Promise<void> {
    const processor = new ImageProcessor(pageSlug, this.baseArtifactsPath);
    const languages: ('en' | 'es' | 'de' | 'zh' | 'ru')[] = [
      'en',
      'es',
      'de',
      'zh',
      'ru',
    ];

    const imagesDir = path.join(zipTempPath, 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    languages.forEach((lang) => {
      const screenshotPath = processor.getScreenshotPath(lang);
      if (fs.existsSync(screenshotPath)) {
        const files = fs.readdirSync(screenshotPath);
        files.forEach((file) => {
          const source = path.join(screenshotPath, file);
          const destination = path.join(imagesDir, file);
          fs.copyFileSync(source, destination);
        });
      }
    });

    console.log(`Exported images to: ${imagesDir}`);
  }
}

/**
 * Example usage:
 *
 * const processor = new ImageProcessor('matches');
 * processor.initializeDirectories(['en', 'es', 'de', 'zh', 'ru']);
 *
 * // Save images
 * await processor.saveImage('en', '/tmp/screenshot1.png', '1781817452133_auto.png');
 * await processor.saveImage('es', '/tmp/screenshot1.png', '1781817452133_auto.png');
 *
 * // Save markdown
 * await processor.saveMarkdown('en', markdownContent);
 * await processor.saveMarkdown('es', markdownContentEspanol);
 *
 * // Get summary
 * const summary = processor.getArticleSummary('matches');
 * console.log(summary);
 * // Output:
 * // [
 * //   { language: 'en', hasMarkdown: true, imageCount: 3 },
 * //   { language: 'es', hasMarkdown: true, imageCount: 3 },
 * //   ...
 * // ]
 */
