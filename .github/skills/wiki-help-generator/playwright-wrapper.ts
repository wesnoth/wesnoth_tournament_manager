/**
 * Playwright Wrapper for Wiki Help Generator Skill
 * Handles browser automation, language switching, and screenshot capture
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export interface PlaywrightConfig {
  testBaseUrl: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  timeout?: number;
}

export interface LanguageConfig {
  language: string;
  locale: string;
  code: 'en' | 'es' | 'de' | 'zh' | 'ru';
}

const LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
  en: { language: 'English', locale: 'en-US', code: 'en' },
  es: { language: 'Spanish', locale: 'es-ES', code: 'es' },
  de: { language: 'German', locale: 'de-DE', code: 'de' },
  zh: { language: 'Chinese', locale: 'zh-CN', code: 'zh' },
  ru: { language: 'Russian', locale: 'ru-RU', code: 'ru' },
};

export class WikiPlaywrightHelper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: PlaywrightConfig;

  constructor(config: PlaywrightConfig) {
    this.config = {
      testBaseUrl: config.testBaseUrl,
      headless: config.headless !== false,
      viewport: config.viewport || { width: 1920, height: 1080 },
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Initialize browser and context
   */
  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
    });

    this.context = await this.browser.newContext({
      viewport: this.config.viewport,
    });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeout);
  }

  /**
   * Close browser and context
   */
  async cleanup(): Promise<void> {
    if (this.page) {
      await this.page.close();
    }
    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * Navigate to a URL in test environment
   */
  async navigate(path: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    const url = this.config.testBaseUrl + path;
    await this.page.goto(url, { waitUntil: 'networkidle' });
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Set UI language
   * @param languageCode Language code: en, es, de, zh, ru
   */
  async setLanguage(languageCode: 'en' | 'es' | 'de' | 'zh' | 'ru'): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    const langConfig = LANGUAGE_CONFIG[languageCode];
    if (!langConfig) {
      throw new Error(`Unknown language code: ${languageCode}`);
    }

    // Look for language selector in the UI
    // This assumes the app has a language selector, adjust selector as needed
    const langSelector = '[data-testid="language-selector"], .language-selector, .lang-selector';

    try {
      // Try to find and click language selector
      const selector = await this.page.$(langSelector);
      if (selector) {
        await this.page.click(langSelector);
        await this.page.waitForTimeout(300);

        // Click the specific language option
        const langOption = `[data-lang="${languageCode}"], [lang="${languageCode}"], button:has-text("${langConfig.language}")`;
        await this.page.click(langOption);
        await this.page.waitForTimeout(500);
      } else {
        console.warn(
          `Language selector not found. UI may not change language. Verify language selector exists in the app.`,
        );
      }
    } catch (error) {
      console.warn(`Failed to change language to ${languageCode}: ${error}`);
      console.warn('Proceeding anyway - screenshots may be in original language');
    }
  }

  /**
   * Take a screenshot and save to file
   * @param filePath Full path where to save screenshot
   */
  async takeScreenshot(filePath: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await this.page.screenshot({
      path: filePath,
      fullPage: false,
    });

    console.log(`Screenshot saved: ${filePath}`);
  }

  /**
   * Wait for an element to appear
   */
  async waitForElement(selector: string, timeout = 10000): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.waitForSelector(selector, { timeout });
  }

  /**
   * Click an element
   */
  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.click(selector);
  }

  /**
   * Fill a form field
   */
  async fill(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.fill(selector, text);
  }

  /**
   * Get text content of an element
   */
  async getText(selector: string): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    return await this.page.textContent(selector) || '';
  }

  /**
   * Check if element exists
   */
  async elementExists(selector: string): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    return (await this.page.$(selector)) !== null;
  }

  /**
   * Wait for page to fully load
   */
  async waitForPageLoad(): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Scroll to element
   */
  async scrollToElement(selector: string): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    await this.page.locator(selector).scrollIntoViewIfNeeded();
  }

  /**
   * Execute JavaScript in page context
   */
  async evaluate<T>(fn: string | (() => T)): Promise<T> {
    if (!this.page) throw new Error('Browser not initialized');
    return await this.page.evaluate(fn);
  }

  /**
   * Get current URL
   */
  async getCurrentUrl(): Promise<string> {
    if (!this.page) throw new Error('Browser not initialized');
    return this.page.url();
  }

  /**
   * Get all language codes
   */
  getLanguageCodes(): Array<'en' | 'es' | 'de' | 'zh' | 'ru'> {
    return Object.keys(LANGUAGE_CONFIG) as Array<'en' | 'es' | 'de' | 'zh' | 'ru'>;
  }
}

/**
 * Helper function to get language config
 */
export function getLanguageConfig(code: 'en' | 'es' | 'de' | 'zh' | 'ru'): LanguageConfig {
  const config = LANGUAGE_CONFIG[code];
  if (!config) throw new Error(`Unknown language code: ${code}`);
  return config;
}

/**
 * Helper function to generate timestamp-based filename
 */
export function generateImageFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${random}.png`;
}
