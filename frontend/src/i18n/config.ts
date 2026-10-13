import i18n, { type BackendModule, type ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';
import enTranslations from './locales/en.json';

/**
 * Locale loading.
 *
 * English is the reference and fallback language, so it is bundled with the
 * application: any key a lazily loaded locale lacks, and the whole interface
 * while that locale is still downloading, falls back to it. The other locales
 * are separate chunks fetched on demand: bundling all five put about 500 kB
 * of JSON into the entry chunk, although each user only needs one language.
 *
 * The loader is an i18next backend, so `i18n.changeLanguage()` waits for the
 * locale to arrive before switching, and callers (navbar, profile, login) need
 * no loading logic of their own.
 */
const localeLoaders: Record<string, () => Promise<{ default: ResourceKey }>> = {
  es: () => import('./locales/es.json'),
  de: () => import('./locales/de.json'),
  zh: () => import('./locales/zh.json'),
  ru: () => import('./locales/ru.json'),
};

const lazyLocales: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(language, _namespace, callback) {
    const load = localeLoaders[language];
    // English is already bundled, and an unknown language code (an old value
    // in localStorage, for example) resolves to nothing, so both fall back
    // to the bundled English catalog.
    if (!load) {
      callback(null, {});
      return;
    }
    load()
      .then((module) => callback(null, module.default))
      .catch((error) => callback(error, null));
  },
};

/**
 * Resolves once the initial language is loaded. main.tsx waits for it before
 * the first render, so a reader of another language never sees an English
 * flash on page load.
 */
export const i18nReady = i18n
  .use(lazyLocales)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTranslations },
    },
    // Keep the bundled English catalog and load the other languages through
    // the backend above.
    partialBundledLanguages: true,
    lng: localStorage.getItem('language') || 'en',
    fallbackLng: 'en',
    ns: ['translation'],
    defaultNS: 'translation',
    interpolation: {
      escapeValue: false,
    },
    missingKeyHandler: (lngs, ns, key) => {
      console.warn(`Missing translation key: ${key} for languages: ${lngs}`);
      return key;
    },
  });

export default i18n;
