import { query } from '../config/database.js';

/**
 * Built-in visual themes shipped by the frontend (see
 * frontend/src/store/themeStore.ts). Both lists must stay in sync: the
 * backend rejects any other value so a stored preference can never name a
 * theme the frontend cannot render. Only built-in themes can be the site
 * default, because a custom theme belongs to one user.
 */
export const SUPPORTED_THEMES = ['medieval', 'ranked'] as const;

export type ThemeName = (typeof SUPPORTED_THEMES)[number];

/** Value of users_extension.theme selecting the user's own custom colors. */
export const CUSTOM_THEME = 'custom';

/** system_settings key holding the site-wide default theme. */
export const DEFAULT_THEME_SETTING_KEY = 'default_theme';

/**
 * Default used when the setting row is missing or holds an unknown value.
 * The migration seeds the row, but a database restored from an older dump
 * may lack it, and the site must still render a supported theme.
 */
export const FALLBACK_DEFAULT_THEME: ThemeName = 'medieval';

/** Type guard for built-in theme values received from clients or the database. */
export const isSupportedTheme = (value: unknown): value is ThemeName =>
  typeof value === 'string' && (SUPPORTED_THEMES as readonly string[]).includes(value);

/** Values a user may store as their explicit choice: a built-in theme or 'custom'. */
export const isUserTheme = (value: unknown): value is ThemeName | typeof CUSTOM_THEME =>
  isSupportedTheme(value) || value === CUSTOM_THEME;

/**
 * Colors of a user's custom theme. Only the three picked colors and the base
 * theme are stored; the frontend derives every color scale from them, so the
 * stored shape stays small and independent of how scales are generated.
 */
/**
 * Derived colors a user may replace in the advanced editor. Keep in sync
 * with ADVANCED_TOKEN_GROUPS in frontend/src/theme/customTheme.ts. The list
 * also bounds the size of the stored JSON.
 */
export const ADVANCED_TOKENS = [
  'white', 'gray-50', 'gray-100', 'gray-200', 'gray-300',
  'gray-400', 'gray-500', 'gray-600', 'gray-700', 'gray-800', 'gray-900', 'primary',
  'blue-50', 'blue-100', 'blue-200', 'blue-300', 'blue-400', 'blue-500', 'blue-600', 'blue-700', 'blue-800', 'blue-900',
] as const;

export interface CustomThemeConfig {
  base: ThemeName;
  background: string;
  text: string;
  accent: string;
  /** Advanced overrides by token, omitted when the user replaced nothing. */
  overrides?: Partial<Record<(typeof ADVANCED_TOKENS)[number], string>>;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX_COLOR.test(value);

/**
 * Validates a custom theme received from a client and returns a normalized
 * copy (lowercase colors), or null when the value is malformed. Unknown
 * top-level keys are dropped so the stored JSON cannot grow with arbitrary
 * client data. Overrides are stricter: an unknown token or a non-hex value
 * rejects the whole theme, because silently dropping one would save colors
 * different from what the user previewed.
 */
export function parseCustomTheme(value: unknown): CustomThemeConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { base, background, text, accent, overrides } = value as Record<string, unknown>;
  if (!isSupportedTheme(base)) return null;
  if (![background, text, accent].every(isHexColor)) return null;

  const config: CustomThemeConfig = {
    base,
    background: (background as string).toLowerCase(),
    text: (text as string).toLowerCase(),
    accent: (accent as string).toLowerCase(),
  };
  if (overrides !== undefined && overrides !== null) {
    if (typeof overrides !== 'object' || Array.isArray(overrides)) return null;
    const normalized: Record<string, string> = {};
    for (const [token, color] of Object.entries(overrides)) {
      if (!(ADVANCED_TOKENS as readonly string[]).includes(token) || !isHexColor(color)) return null;
      normalized[token] = color.toLowerCase();
    }
    if (Object.keys(normalized).length > 0) config.overrides = normalized;
  }
  return config;
}

/**
 * Reads the site-wide default theme from system_settings.
 *
 * Falls back to {@link FALLBACK_DEFAULT_THEME} on a missing row or an
 * unsupported value instead of failing, because the theme is cosmetic and
 * must never block a page from loading.
 */
export async function getDefaultTheme(): Promise<ThemeName> {
  const result = await query(
    'SELECT setting_value FROM system_settings WHERE setting_key = ?',
    [DEFAULT_THEME_SETTING_KEY]
  );
  const value = result.rows[0]?.setting_value;
  return isSupportedTheme(value) ? value : FALLBACK_DEFAULT_THEME;
}
