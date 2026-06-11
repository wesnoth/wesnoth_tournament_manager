/**
 * Smart Help Navigation
 * Converts current URL path to help article slug
 * 
 * Examples:
 * /tournaments → tournaments
 * /tournament/59d6df68-1087-47b7-8229-d7140aec6019 → tournament
 * /rankings/player/123 → rankings
 * /admin/wiki → admin
 * / → getting-started (default)
 */

export const getHelpSlugFromPath = (pathname: string): string => {
  // Remove leading slash and split by /
  const segments = pathname.split('/').filter(Boolean);
  
  // If no segments (root path), return default
  if (segments.length === 0) {
    return 'getting-started';
  }
  
  // Return first segment (the main section)
  // /tournaments → tournaments
  // /tournament/123 → tournament
  // /admin/wiki → admin
  return segments[0];
};
