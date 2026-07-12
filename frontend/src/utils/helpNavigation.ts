/** Default article shown when a route has no dedicated published help article. */
const DEFAULT_HELP_SLUG = 'getting-started';

/**
 * Routes with stable contextual articles. Dynamic detail routes are represented
 * by their static prefix; private and administrative routes deliberately fall
 * back instead of guessing from a broad first URL segment such as `admin`.
 */
const CONTEXTUAL_HELP_ROUTES: Record<string, string> = {
  '/': DEFAULT_HELP_SLUG,
  '/help': DEFAULT_HELP_SLUG,
  '/players': 'players',
  '/player': 'player',
  '/rankings': 'rankings',
  '/statistics': 'statistics',
  '/tournaments': 'tournaments',
  '/tournament': 'tournament',
  '/events': 'events',
  '/matches': 'matches',
  '/my-matches': 'my-matches',
  '/my-stats': 'my-stats',
  '/faq': 'faq',
  '/admin/audit': 'admin',
};

export const getHelpSlugFromPath = (pathname: string): string => {
  const normalizedPath = `/${pathname.split('?')[0].split('/').filter(Boolean).join('/')}` || '/';

  if (CONTEXTUAL_HELP_ROUTES[normalizedPath]) {
    return CONTEXTUAL_HELP_ROUTES[normalizedPath];
  }

  const matchingRoute = Object.keys(CONTEXTUAL_HELP_ROUTES)
    .filter(route => route !== '/' && normalizedPath.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];

  return matchingRoute ? CONTEXTUAL_HELP_ROUTES[matchingRoute] : DEFAULT_HELP_SLUG;
};
