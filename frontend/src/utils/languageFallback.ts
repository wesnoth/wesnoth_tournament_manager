/**
 * Language Fallback Utility
 * 
 * Handles multi-language content with fallback to English (EN)
 * Strategy:
 * 1. Load all records (all languages mixed together)
 * 2. Group by ID to get all language variants
 * 3. For each item, use user's language if available, otherwise fallback to EN
 */

export interface MultiLanguageItem {
  id: string;
  [key: string]: any; // language_code as key mapping to { title, content, ... }
}

export interface RawMultiLanguageItem {
  id: string;
  language_code: string;
  title?: string;
  content?: string;
  question?: string;
  answer?: string;
  [key: string]: any;
}

/**
 * Group raw multi-language records by ID
 * Input: Array of records where each record has a language_code
 * Output: Object where key is ID and value is object with language_code as keys
 */
export function groupByLanguage(items: RawMultiLanguageItem[]): Record<string, MultiLanguageItem> {
  const grouped: Record<string, MultiLanguageItem> = {};

  items.forEach(item => {
    if (!grouped[item.id]) {
      grouped[item.id] = { id: item.id };
    }
    
    const langCode = item.language_code || 'en';
    grouped[item.id][langCode] = item;
  });

  return grouped;
}

/**
 * Get content for a specific item in the user's language with EN fallback
 * 
 * @param groupedItem - Object with language codes as keys (from groupByLanguage)
 * @param userLanguage - User's preferred language code (e.g., 'es', 'zh', 'de', 'ru')
 * @returns Content in user's language or English fallback
 */
export function getLocalizedContent(
  groupedItem: MultiLanguageItem,
  userLanguage: string
): any {
  // Step 1: Try to get user's language version
  if (groupedItem[userLanguage]) {
    return groupedItem[userLanguage];
  }

  // Step 2: Fallback to English
  if (groupedItem['en']) {
    return groupedItem['en'];
  }

  // Step 3: If no EN available, return any available language
  const availableLanguages = Object.keys(groupedItem).filter(key => key !== 'id');
  if (availableLanguages.length > 0) {
    return groupedItem[availableLanguages[0]];
  }

  // Fallback to just the ID if nothing is available
  return groupedItem;
}

/**
 * Process raw multi-language items for display
 * This combines grouping and localization into one step
 * 
 * @param items - Array of raw records with language_code
 * @param userLanguage - User's preferred language
 * @returns Array of localized items ready for display
 */
export function processMultiLanguageItems(
  items: RawMultiLanguageItem[],
  userLanguage: string
): any[] {
  // Step 1: Group by ID
  const grouped = groupByLanguage(items);

  // Step 2: For each group, get the localized content
  const localized = Object.values(grouped).map(groupedItem => 
    getLocalizedContent(groupedItem, userLanguage)
  );

  // Step 3: Remove duplicates (in case multiple items map to same ID)
  const unique = Array.from(new Map(localized.map(item => [item.id, item])).values());

  return unique;
}

/**
 * Example usage in a component:
 * 
 * const { i18n } = useTranslation();
 * const userLanguage = i18n.language; // 'en', 'es', 'zh', 'de', 'ru'
 * 
 * const rawNews = await publicService.getNews(); // all languages mixed
 * const localizedNews = processMultiLanguageItems(
 *   rawNews,
 *   userLanguage
 * );
 * 
 * // Now each news item is in the user's language (or EN if not available)
 * localizedNews.forEach(newsItem => {
 *   console.log(newsItem.title, newsItem.content, newsItem.language_code);
 * });
 */

export default {
  groupByLanguage,
  getLocalizedContent,
  processMultiLanguageItems,
};
