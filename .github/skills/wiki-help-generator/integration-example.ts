/**
 * Wiki Help Generator Integration Guide
 * 
 * This file demonstrates how to use the wiki-help-generator skill modules
 * in your own code or automation scripts.
 */

import { WikiPlaywrightHelper, generateImageFilename } from './playwright-wrapper';
import { MarkdownBuilder, WikiArticleContent } from './markdown-builder';
import { ImageProcessor } from './image-processor';

/**
 * Example: Generate help article for the "Matches" page
 * 
 * This example shows the complete workflow:
 * 1. Initialize Playwright
 * 2. Capture screenshots for each language
 * 3. Generate markdown
 * 4. Organize images
 */
export async function generateMatchesHelpArticle() {
  const pageSlug = 'matches';
  const baseUrl = 'https://tournament-test.wesnoth.org';
  const languages: ('en' | 'es' | 'de' | 'zh' | 'ru')[] = ['en', 'es', 'de', 'zh', 'ru'];

  // Initialize Playwright
  const playwright = new WikiPlaywrightHelper({
    testBaseUrl: baseUrl,
    headless: true,
    viewport: { width: 1920, height: 1080 },
    timeout: 30000,
  });

  // Initialize image processor
  const imageProcessor = new ImageProcessor(pageSlug);
  imageProcessor.initializeDirectories(languages);

  try {
    await playwright.init();

    // For each language, capture screenshots and generate markdown
    for (const lang of languages) {
      console.log(`\n=== Processing language: ${lang} ===`);

      // Set language
      await playwright.setLanguage(lang);

      // Navigate to matches page
      await playwright.navigate('/matches');
      await playwright.waitForPageLoad();

      // Capture screenshots for different match states
      const screenshotPath1 = imageProcessor.getScreenshotPath(lang);
      await playwright.takeScreenshot(`${screenshotPath1}/match-list.png`);

      // Take screenshot of preliminary match (scroll if needed)
      const hasPreliminary = await playwright.elementExists('.preliminary-match');
      if (hasPreliminary) {
        await playwright.scrollToElement('.preliminary-match');
        await playwright.takeScreenshot(`${screenshotPath1}/preliminary-match.png`);

        // Click to show confirmation form
        await playwright.click('.preliminary-match button');
        await playwright.waitForElement('.confirmation-form');
        await playwright.takeScreenshot(`${screenshotPath1}/confirmation-form.png`);
      }

      // Generate markdown for this language
      const articleContent: WikiArticleContent = {
        title: 'Matches',
        whatIsThis: {
          description:
            'The **Matches** page displays all ranked matches played in the Wesnoth Tournament Manager.',
          prerequisites: [
            'You are using the **Ranked** add-on',
            '**Ranked Matches** is enabled in your player profile',
          ],
          relatedArticles: [
            { text: 'Getting Started', slug: 'getting-started' },
            { text: 'Rankings', slug: 'rankings' },
          ],
        },
        whatCanYouDo: {
          actions: [
            { name: 'View matches', description: 'See all your ranked matches in a list' },
            {
              name: 'Confirm preliminary matches',
              description: 'Confirm the result if the system couldn\'t determine it automatically',
            },
            { name: 'Inform match', description: 'Add comments and rate your opponent after winning' },
            { name: 'Report match', description: 'Confirm result and provide feedback after losing' },
            {
              name: 'Dispute match',
              description: 'Request review of a match result if you believe it\'s incorrect',
            },
          ],
        },
        whatHappens: {
          sections: [
            {
              title: 'View Matches',
              description: 'When you open the Matches page, you see all your matches in a table:',
              images: [
                {
                  filename: 'match-list.png',
                  altText: 'Match list view',
                  description: 'All matches displayed in a table with player names, results, and timestamps',
                },
              ],
            },
            {
              title: 'Confirm Preliminary Match',
              description: 'For matches marked as preliminary (yellow background), click a confirmation button:',
              images: [
                {
                  filename: 'preliminary-match.png',
                  altText: 'Preliminary match',
                  description: 'Preliminary matches display with yellow background',
                },
                {
                  filename: 'confirmation-form.png',
                  altText: 'Confirmation form',
                  description: 'Form to confirm the match result and add comments',
                },
              ],
            },
          ],
        },
      };

      const markdown = MarkdownBuilder.buildArticle(articleContent);

      // Validate markdown
      const validation = MarkdownBuilder.validateMarkdown(markdown);
      if (!validation.valid) {
        console.error('Markdown validation errors:', validation.errors);
      }

      // Save markdown
      await imageProcessor.saveMarkdown(lang, markdown);
    }

    // Print summary
    console.log('\n=== Generation Complete ===');
    const summary = imageProcessor.getArticleSummary(pageSlug);
    summary.forEach((item) => {
      console.log(
        `${item.language}: ${item.imageCount} images, markdown: ${item.hasMarkdown ? 'yes' : 'no'}`,
      );
    });

    console.log(`\nOutput location: wiki-artifacts/${pageSlug}/`);
    console.log('Ready to import to wiki admin UI!');
  } finally {
    // Clean up
    await playwright.cleanup();
  }
}

/**
 * Example: Natural language command parsing
 * 
 * This would be called from the Copilot skill interface
 * when a user provides natural language input
 */
export function parseUserRequest(request: string): {
  pageSlug: string;
  actions: string[];
  languages: ('en' | 'es' | 'de' | 'zh' | 'ru')[];
  notes: string;
} {
  // Simple parsing - in real implementation, use LLM or more sophisticated parsing
  const lines = request.split('\n').filter((l) => l.trim());

  let pageSlug = '';
  const actions: string[] = [];
  const languages: ('en' | 'es' | 'de' | 'zh' | 'ru')[] = ['en', 'es', 'de', 'zh', 'ru'];
  let notes = '';

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    // Extract page slug
    if (lowerLine.includes('page') || lowerLine.includes('document')) {
      const match = line.match(/(?:page|document|help)\s+(?:for\s+)?["']?(\w+)["']?/i);
      if (match) pageSlug = match[1].toLowerCase();
    }

    // Extract actions
    if (lowerLine.includes('document') || lowerLine.includes('show') || lowerLine.includes('capture')) {
      actions.push(line);
    }

    // Extract language preferences
    if (lowerLine.includes('language') && lowerLine.includes('only')) {
      // User specified specific languages
      const langMatches = line.match(/(?:en|es|de|zh|ru)/gi);
      if (langMatches) {
        const uniqueLangs = [...new Set(langMatches.map((l) => l.toLowerCase()))];
        languages.length = 0;
        languages.push(
          ...uniqueLangs.filter(
            (l) => ['en', 'es', 'de', 'zh', 'ru'].includes(l),
          ) as ('en' | 'es' | 'de' | 'zh' | 'ru')[],
        );
      }
    }

    // Collect notes
    if (lowerLine.includes('note') || lowerLine.includes('important')) {
      notes = line;
    }
  }

  return { pageSlug, actions, languages, notes };
}

/**
 * Example: Export article to ZIP for import
 */
export async function exportArticleForImport(
  pageSlug: string,
  outputZipPath: string,
): Promise<void> {
  const imageProcessor = new ImageProcessor(pageSlug);
  const summary = imageProcessor.getArticleSummary(pageSlug);

  console.log(`\nExporting article: ${pageSlug}`);
  console.log('Languages included:');

  summary.forEach((item) => {
    if (item.hasMarkdown || item.imageCount > 0) {
      console.log(
        `  - ${item.language}: markdown=${item.hasMarkdown}, images=${item.imageCount}`,
      );
    }
  });

  console.log(`\nZIP file would be created at: ${outputZipPath}`);
  console.log('Ready to import to wiki admin UI or another instance');
}

/**
 * Usage in a script:
 *
 * // Option 1: Generate article
 * await generateMatchesHelpArticle();
 *
 * // Option 2: Parse user request
 * const parsed = parseUserRequest(
 *   "Create help for the matches page. Document auto-confirmed vs preliminary matches, " +
 *   "confirmation forms, and match actions. Use all 5 languages."
 * );
 * console.log('Parsed:', parsed);
 *
 * // Option 3: Export for import
 * await exportArticleForImport('matches', './matches-export.zip');
 */
