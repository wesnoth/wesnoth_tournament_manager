import { publicService, userService } from '../services/api';
import { CUSTOM_THEME, isTheme, isThemeChoice, useThemeStore, type ThemeChoice } from '../store/themeStore';
import { isCustomThemeConfig, type CustomThemeConfig } from './customTheme';

/**
 * Loads the site-wide default theme (the `default_theme` system setting).
 * A failed request keeps the cached or fallback default: the theme is
 * cosmetic and must never block or break rendering.
 */
export async function loadSiteDefaultTheme(): Promise<void> {
  try {
    const res = await publicService.getSiteTheme();
    if (isTheme(res.data?.default_theme)) {
      useThemeStore.getState().setSiteDefault(res.data.default_theme);
    }
  } catch (error) {
    console.error('Error loading default theme:', error);
  }
}

/**
 * Reconciles the theme stored in the user's profile with this browser after
 * the profile is loaded (login or profile page).
 *
 * - Profile colors and a profile choice win, so the theme follows the user
 *   across devices.
 * - A profile without a choice adopts the one made in this browser before
 *   signing in (with its colors when it is the custom theme), instead of
 *   silently discarding it.
 * - Neither side having a choice leaves the user on the site default.
 */
export async function syncThemeWithProfile(profileTheme: unknown, profileCustomTheme: unknown): Promise<void> {
  const store = useThemeStore.getState();
  if (isCustomThemeConfig(profileCustomTheme)) {
    store.setCustomTheme(profileCustomTheme);
  }
  if (isThemeChoice(profileTheme)) {
    if (profileTheme !== store.explicitTheme) store.setExplicitTheme(profileTheme);
    return;
  }
  const { explicitTheme, customTheme } = useThemeStore.getState();
  if (explicitTheme) {
    try {
      await userService.updateProfile({
        theme: explicitTheme,
        ...(explicitTheme === CUSTOM_THEME && customTheme ? { theme_custom: customTheme } : {}),
      });
    } catch (error) {
      console.error('Error saving theme preference:', error);
    }
  }
}

/**
 * Changes this visitor's explicit theme (null returns to the site default)
 * and, for authenticated users, stores it in the profile. The theme is
 * applied before the request so the switch feels instant. A failed save
 * keeps the local choice and is reported to the caller.
 */
export async function chooseTheme(theme: ThemeChoice | null, isAuthenticated: boolean): Promise<void> {
  useThemeStore.getState().setExplicitTheme(theme);
  if (isAuthenticated) {
    const { customTheme } = useThemeStore.getState();
    // The backend only accepts 'custom' together with colors (sent now or
    // saved earlier), so the local colors travel with that choice.
    await userService.updateProfile({
      theme,
      ...(theme === CUSTOM_THEME && customTheme ? { theme_custom: customTheme } : {}),
    });
  }
}

/**
 * Saves custom colors and selects the custom theme, locally and, for
 * authenticated users, in the profile.
 */
export async function saveCustomTheme(config: CustomThemeConfig, isAuthenticated: boolean): Promise<void> {
  const store = useThemeStore.getState();
  store.setCustomTheme(config);
  store.setExplicitTheme(CUSTOM_THEME);
  if (isAuthenticated) {
    await userService.updateProfile({ theme: CUSTOM_THEME, theme_custom: config });
  }
}
