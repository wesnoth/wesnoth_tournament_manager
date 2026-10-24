import { publicService, userService } from '../services/api';
import { isTheme, useThemeStore, type ThemeName } from '../store/themeStore';

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
 * - A profile choice wins, so the theme follows the user across devices.
 * - A profile without a choice adopts the one made in this browser before
 *   signing in, instead of silently discarding it.
 * - Neither side having a choice leaves the user on the site default.
 */
export async function syncThemeWithProfile(profileTheme: unknown): Promise<void> {
  const store = useThemeStore.getState();
  if (isTheme(profileTheme)) {
    if (profileTheme !== store.explicitTheme) store.setExplicitTheme(profileTheme);
    return;
  }
  if (store.explicitTheme) {
    try {
      await userService.updateProfile({ theme: store.explicitTheme });
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
export async function chooseTheme(theme: ThemeName | null, isAuthenticated: boolean): Promise<void> {
  useThemeStore.getState().setExplicitTheme(theme);
  if (isAuthenticated) {
    await userService.updateProfile({ theme });
  }
}
