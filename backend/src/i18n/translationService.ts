import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type TranslationCatalog = Record<string, unknown>;
type TranslationParameters = Record<string, string | number>;

const DEFAULT_LANGUAGE = 'en';
const localesDirectory = fileURLToPath(new URL('./locales/', import.meta.url));

/**
 * Load backend locale catalogs from their filenames so feature code never owns
 * a duplicate language list. The build copies this directory beside the
 * compiled service, preserving the same discovery behavior in source and dist.
 */
const loadTranslationCatalogs = (): Map<string, TranslationCatalog> => {
  const catalogs = new Map<string, TranslationCatalog>();

  for (const entry of fs.readdirSync(localesDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== '.json') continue;

    const language = path.basename(entry.name, '.json').toLowerCase();
    const contents = fs.readFileSync(path.join(localesDirectory, entry.name), 'utf8');
    catalogs.set(language, JSON.parse(contents) as TranslationCatalog);
  }

  if (!catalogs.has(DEFAULT_LANGUAGE)) {
    throw new Error(`Default backend locale is missing: ${DEFAULT_LANGUAGE}.json`);
  }

  return catalogs;
};

const translationCatalogs = loadTranslationCatalogs();

/** Return true only for a language backed by a locale file. */
export const isSupportedLanguage = (language: unknown): language is string =>
  typeof language === 'string' && translationCatalogs.has(language);

/**
 * Resolve a profile language to an available catalog, accepting regional forms
 * such as `es-ES` and falling back to English for absent or unknown values.
 */
export const resolveSupportedLanguage = (language: string | null | undefined): string => {
  const normalized = String(language || DEFAULT_LANGUAGE).toLowerCase();
  if (translationCatalogs.has(normalized)) return normalized;

  const baseLanguage = normalized.split('-')[0];
  return translationCatalogs.has(baseLanguage) ? baseLanguage : DEFAULT_LANGUAGE;
};

/** Resolve a dot-separated key from a locale catalog without mutating it. */
const resolveTranslationValue = (catalog: TranslationCatalog, key: string): unknown =>
  key.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as TranslationCatalog)[segment];
  }, catalog);

/**
 * Translate a backend message using locale-file discovery and English fallback.
 * Placeholders use the same `{{name}}` syntax as the frontend catalogs. Missing
 * keys return the key itself, making incomplete catalogs visible without
 * breaking the HTTP response that requested the translation.
 */
export const translate = (
  language: string | null | undefined,
  key: string,
  parameters: TranslationParameters = {}
): string => {
  const resolvedLanguage = resolveSupportedLanguage(language);
  const localizedValue = resolveTranslationValue(translationCatalogs.get(resolvedLanguage)!, key);
  const fallbackValue = resolveTranslationValue(translationCatalogs.get(DEFAULT_LANGUAGE)!, key);
  const template = typeof localizedValue === 'string'
    ? localizedValue
    : typeof fallbackValue === 'string'
      ? fallbackValue
      : key;

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (placeholder, parameterName: string) =>
    Object.prototype.hasOwnProperty.call(parameters, parameterName)
      ? String(parameters[parameterName])
      : placeholder
  );
};
