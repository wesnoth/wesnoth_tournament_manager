import { query } from '../config/database.js';

/**
 * Visual themes shipped by the frontend (see frontend/src/theme/themes.ts).
 * Both lists must stay in sync: the backend rejects any other value so a
 * stored preference can never name a theme the frontend cannot render.
 */
export const SUPPORTED_THEMES = ['medieval', 'ranked'] as const;

export type ThemeName = (typeof SUPPORTED_THEMES)[number];

/** system_settings key holding the site-wide default theme. */
export const DEFAULT_THEME_SETTING_KEY = 'default_theme';

/**
 * Default used when the setting row is missing or holds an unknown value.
 * The migration seeds the row, but a database restored from an older dump
 * may lack it, and the site must still render a supported theme.
 */
export const FALLBACK_DEFAULT_THEME: ThemeName = 'medieval';

/** Type guard for values received from clients or read from the database. */
export const isSupportedTheme = (value: unknown): value is ThemeName =>
  typeof value === 'string' && (SUPPORTED_THEMES as readonly string[]).includes(value);

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
