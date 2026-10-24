import { create } from 'zustand';
import { buildCustomPalette, isCustomThemeConfig, type CustomThemeConfig } from '../theme/customTheme';

/**
 * Built-in visual themes. Keep in sync with SUPPORTED_THEMES in
 * backend/src/services/themeSettingsService.ts, with the `data-theme` blocks
 * in src/styles/themes.css and with the bootstrap script in index.html.
 * Only built-in themes can be the site default.
 */
export const THEMES = ['medieval', 'ranked'] as const;

export type ThemeName = (typeof THEMES)[number];

/** A user's own colors on top of a built-in base theme (see theme/customTheme.ts). */
export const CUSTOM_THEME = 'custom';

/** What a visitor can pick explicitly: a built-in theme or their custom one. */
export type ThemeChoice = ThemeName | typeof CUSTOM_THEME;

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
/**
 * Saved custom theme: `{ config, vars }`. `vars` caches the derived CSS
 * variables so the index.html bootstrap script can apply them before the
 * first paint without shipping the palette generator inline.
 */
const CUSTOM_THEME_KEY = 'themeCustom';

export const isTheme = (value: unknown): value is ThemeName =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value);

export const isThemeChoice = (value: unknown): value is ThemeChoice =>
  isTheme(value) || value === CUSTOM_THEME;

/**
 * localStorage can throw (private windows, blocked site data). The theme is
 * cosmetic, so storage failures degrade to the in-memory value silently.
 */
const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Ignored: see readStorage.
  }
};

const readStoredCustomTheme = (): CustomThemeConfig | null => {
  try {
    const parsed = JSON.parse(readStorage(CUSTOM_THEME_KEY) || 'null');
    return isCustomThemeConfig(parsed?.config) ? parsed.config : null;
  } catch {
    return null;
  }
};

/** Names of the variables a custom theme sets inline, so they can be removed again. */
let appliedCustomVars: string[] = [];

/**
 * Renders a theme. Built-in themes only switch the `data-theme` attribute
 * read by themes.css. A custom theme keeps its base theme's attribute (fonts,
 * artwork, bar styling), marks the root with `data-custom-theme` and sets
 * its derived color variables inline, which override the stylesheet values.
 */
const renderTheme = (theme: ThemeName, custom: CustomThemeConfig | null) => {
  const root = document.documentElement;
  for (const name of appliedCustomVars) root.style.removeProperty(name);
  appliedCustomVars = [];
  if (custom) {
    const { vars } = buildCustomPalette(custom);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    appliedCustomVars = Object.keys(vars);
    root.dataset.theme = custom.base;
    root.dataset.customTheme = '';
  } else {
    root.dataset.theme = theme;
    delete root.dataset.customTheme;
  }
};

interface ThemeState {
  /** Explicit choice of this visitor, or null to follow `siteDefault`. */
  explicitTheme: ThemeChoice | null;
  /** Saved custom colors, kept even while another theme is active. */
  customTheme: CustomThemeConfig | null;
  /** Site-wide default from the `default_theme` system setting. */
  siteDefault: ThemeName;
  /**
   * Theme currently rendered. The explicit choice wins over the default,
   * except a 'custom' choice without saved colors, which has nothing to
   * render and falls back to the default.
   */
  activeTheme: ThemeChoice;
  /**
   * Stores this visitor's explicit choice (null returns to the default).
   * Persisting it to the profile is the caller's job, because only the
   * caller knows whether the visitor is authenticated.
   */
  setExplicitTheme: (theme: ThemeChoice | null) => void;
  /** Stores the custom colors locally (null forgets them) and re-renders. */
  setCustomTheme: (config: CustomThemeConfig | null) => void;
  /** Records the site default and applies it when no explicit choice exists. */
  setSiteDefault: (theme: ThemeName) => void;
  /**
   * Renders unsaved custom colors for a live preview in the editor, or with
   * null renders the saved state again. Nothing is stored.
   */
  previewCustomTheme: (config: CustomThemeConfig | null) => void;
}

const resolveActive = (
  explicit: ThemeChoice | null,
  custom: CustomThemeConfig | null,
  siteDefault: ThemeName
): ThemeChoice => {
  if (explicit === CUSTOM_THEME) return custom ? CUSTOM_THEME : siteDefault;
  return explicit ?? siteDefault;
};

/** Renders the stored state and returns the resolved active theme. */
const applyState = (explicit: ThemeChoice | null, custom: CustomThemeConfig | null, siteDefault: ThemeName) => {
  const activeTheme = resolveActive(explicit, custom, siteDefault);
  renderTheme(activeTheme === CUSTOM_THEME ? siteDefault : activeTheme, activeTheme === CUSTOM_THEME ? custom : null);
  return activeTheme;
};

const storedExplicit = readStorage(EXPLICIT_THEME_KEY);
const initialExplicit = isThemeChoice(storedExplicit) ? storedExplicit : null;
const storedDefault = readStorage(SITE_DEFAULT_THEME_KEY);
const initialDefault = isTheme(storedDefault) ? storedDefault : FALLBACK_THEME;
const initialCustom = readStoredCustomTheme();

export const useThemeStore = create<ThemeState>((set, get) => ({
  explicitTheme: initialExplicit,
  customTheme: initialCustom,
  siteDefault: initialDefault,
  // The index.html bootstrap script normally applied this already; rendering
  // it again keeps the page correct if that script was removed or failed.
  activeTheme: applyState(initialExplicit, initialCustom, initialDefault),

  setExplicitTheme: (theme) => {
    writeStorage(EXPLICIT_THEME_KEY, theme);
    const { customTheme, siteDefault } = get();
    set({ explicitTheme: theme, activeTheme: applyState(theme, customTheme, siteDefault) });
  },

  setCustomTheme: (config) => {
    writeStorage(
      CUSTOM_THEME_KEY,
      config ? JSON.stringify({ config, vars: buildCustomPalette(config).vars }) : null
    );
    const { explicitTheme, siteDefault } = get();
    set({ customTheme: config, activeTheme: applyState(explicitTheme, config, siteDefault) });
  },

  setSiteDefault: (theme) => {
    writeStorage(SITE_DEFAULT_THEME_KEY, theme);
    const { explicitTheme, customTheme } = get();
    set({ siteDefault: theme, activeTheme: applyState(explicitTheme, customTheme, theme) });
  },

  previewCustomTheme: (config) => {
    const { explicitTheme, customTheme, siteDefault } = get();
    if (config) renderTheme(config.base, config);
    else applyState(explicitTheme, customTheme, siteDefault);
  },
}));
