import { create } from 'zustand';

/**
 * Visual themes. Keep in sync with SUPPORTED_THEMES in
 * backend/src/services/themeSettingsService.ts, with the `data-theme` blocks
 * in src/styles/themes.css and with the bootstrap script in index.html.
 */
export const THEMES = ['medieval', 'ranked'] as const;

export type ThemeName = (typeof THEMES)[number];

/**
 * Used until the server default is known (first visit, or the request
 * failed). It matches the backend fallback so both sides agree when the
 * `default_theme` setting is missing.
 */
export const FALLBACK_THEME: ThemeName = 'medieval';

/** Theme the visitor picked explicitly. Absent means "follow the site default". */
const EXPLICIT_THEME_KEY = 'theme';
/** Last site default received from the server, cached to avoid a flash on reload. */
const SITE_DEFAULT_THEME_KEY = 'themeDefault';

export const isTheme = (value: unknown): value is ThemeName =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value);

/**
 * localStorage can throw (private windows, blocked site data). The theme is
 * cosmetic, so storage failures degrade to the in-memory value silently.
 */
const readStoredTheme = (key: string): ThemeName | null => {
  try {
    const value = localStorage.getItem(key);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
};

const writeStoredTheme = (key: string, value: ThemeName | null) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Ignored: see readStoredTheme.
  }
};

/** Applies a theme by switching the `data-theme` attribute read by themes.css. */
const applyTheme = (theme: ThemeName) => {
  document.documentElement.dataset.theme = theme;
};

interface ThemeState {
  /** Explicit choice of this visitor, or null to follow `siteDefault`. */
  explicitTheme: ThemeName | null;
  /** Site-wide default from the `default_theme` system setting. */
  siteDefault: ThemeName;
  /** Theme currently rendered: the explicit choice wins over the default. */
  activeTheme: ThemeName;
  /**
   * Stores this visitor's explicit choice (null returns to the default).
   * Persisting it to the profile is the caller's job, because only the
   * caller knows whether the visitor is authenticated.
   */
  setExplicitTheme: (theme: ThemeName | null) => void;
  /** Records the site default and applies it when no explicit choice exists. */
  setSiteDefault: (theme: ThemeName) => void;
}

const initialExplicit = readStoredTheme(EXPLICIT_THEME_KEY);
const initialDefault = readStoredTheme(SITE_DEFAULT_THEME_KEY) ?? FALLBACK_THEME;

export const useThemeStore = create<ThemeState>((set, get) => ({
  explicitTheme: initialExplicit,
  siteDefault: initialDefault,
  activeTheme: initialExplicit ?? initialDefault,

  setExplicitTheme: (theme) => {
    writeStoredTheme(EXPLICIT_THEME_KEY, theme);
    const activeTheme = theme ?? get().siteDefault;
    applyTheme(activeTheme);
    set({ explicitTheme: theme, activeTheme });
  },

  setSiteDefault: (theme) => {
    writeStoredTheme(SITE_DEFAULT_THEME_KEY, theme);
    const activeTheme = get().explicitTheme ?? theme;
    applyTheme(activeTheme);
    set({ siteDefault: theme, activeTheme });
  },
}));

// The index.html bootstrap script normally applied this already; repeating
// it keeps the attribute correct if that script was removed or failed.
applyTheme(useThemeStore.getState().activeTheme);
