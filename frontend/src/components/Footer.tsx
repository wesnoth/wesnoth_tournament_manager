import React from 'react';

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
  const currentYear = new Date().getFullYear();
  return (
    <footer className="bg-gradient-to-r from-gray-900 to-gray-800 text-gray-100 py-4 px-4 border-t-4 border-blue-500 flex-shrink-0">
      <div className="text-center text-sm text-gray-400 space-y-1">
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
