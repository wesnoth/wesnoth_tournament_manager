import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { CUSTOM_THEME, THEMES, useThemeStore, type ThemeChoice } from '../store/themeStore';
import { chooseTheme } from '../theme/themePreference';

/** Public repository; AGPL-3.0 entitles network users to the source code. */
const SOURCE_URL = 'https://github.com/wesnoth/wesnoth_tournament_manager';

/**
 * Site footer with the project attribution, the site design copyright, and
 * the license notice.
 *
 * Copyright and attribution lines are legal notices with proper names, so
 * they are not translated (as on wesnoth.org). The design copyright ends in
 * the current year so it never needs a manual yearly update. The source link
 * is the AGPL-3.0 offer of the complete source to users of the network
 * service.
 */
const Footer: React.FC = () => {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const activeTheme = useThemeStore((state) => state.activeTheme);
  const hasCustomTheme = useThemeStore((state) => state.customTheme !== null);
  // The custom theme is offered only once its colors exist (Profile editor).
  const themeOptions: ThemeChoice[] = hasCustomTheme ? [...THEMES, CUSTOM_THEME] : [...THEMES];
  const currentYear = new Date().getFullYear();

  // The theme switcher lives in the footer rather than the navbar, whose
  // link row has no spare width at common desktop sizes. The Profile page
  // offers the full choice, including returning to the site default.
  const selectTheme = (theme: ThemeChoice) => {
    chooseTheme(theme, isAuthenticated).catch((err) => {
      console.error('Error saving theme preference:', err);
    });
  };
  return (
    <footer className="theme-bar theme-bar-links bg-gradient-to-r from-gray-900 to-gray-800 text-gray-100 py-4 px-4 border-t-4 border-blue-500 flex-shrink-0">
      <div className="text-center text-sm text-gray-400 space-y-1">
        <p className="m-0 text-xs" data-help-id="region-footer-theme">
          {t('theme.label')}:{' '}
          {themeOptions.map((theme, index) => (
            <React.Fragment key={theme}>
              {index > 0 && ' · '}
              <button
                type="button"
                data-help-id={`option-theme-${theme}`}
                onClick={() => selectTheme(theme)}
                aria-pressed={theme === activeTheme}
                className={theme === activeTheme ? 'font-semibold text-gray-100' : 'underline hover:text-gray-300'}
              >
                {t(`theme.name_${theme}`)}
              </button>
            </React.Fragment>
          ))}
        </p>
        <p className="m-0">Wesnoth Tournament Manager by The Battle for Wesnoth Project</p>
        <p className="m-0">Site design Copyright © 2024–{currentYear} by clmates</p>
        <p className="m-0 text-xs text-gray-500">
          Licensed under the GNU AGPL v3 or later ·{' '}
          <a
            data-help-id="action-open-source-code"
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-300"
          >
            Source code
          </a>
        </p>
      </div>
    </footer>
  );
};

export default Footer;
