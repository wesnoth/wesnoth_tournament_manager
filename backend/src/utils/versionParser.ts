/**
 * Version Parser Utility
 * File: backend/src/utils/versionParser.ts
 * 
 * Purpose: Parse and validate Wesnoth version strings
 * Supports both single version and pipe-separated multiple versions
 * Examples:
 *   - "1.18" → ["1.18"]
 *   - "1.18|1.19" → ["1.18", "1.19"]
 *   - "1.18 | 1.19 | 1.20" → ["1.18", "1.19", "1.20"] (whitespace handled)
 */

/**
 * Parse Wesnoth version string into array of base versions
 * 
 * @param versionStr - Version string (e.g., "1.18" or "1.18|1.19")
 * @returns Array of base versions (e.g., ["1.18", "1.19"])
 * @throws Error if format is invalid
 */
export function parseWesnothVersions(versionStr: string): string[] {
  if (!versionStr || typeof versionStr !== 'string') {
    throw new Error('Invalid WESNOTH_VERSION: must be a non-empty string');
  }

  // Split by pipe and trim whitespace
  const versions = versionStr
    .split('|')
    .map(v => v.trim())
    .filter(v => v.length > 0);

  if (versions.length === 0) {
    throw new Error('WESNOTH_VERSION: no valid versions after parsing');
  }

  // Validate each version format (should be like "1.18" or "1.18.0")
  // Accept patterns: X.Y, X.Y.Z, X.Y.Z.W
  // Accept stable versions and development suffixes such as 1.19-dev or 1.19.25+dev.
  const versionRegex = /^\d+\.\d+(\.\d+)?(\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/;
  for (const version of versions) {
    if (!versionRegex.test(version)) {
      throw new Error(
        `Invalid version format: "${version}". Expected format like "1.18" or "1.18.0"`
      );
    }
  }

  return versions;
}

/**
 * Extract base version from a detailed version string
 * Examples: "1.18.0" → "1.18", "1.19.1" → "1.19", "1.20" → "1.20"
 * 
 * @param detailedVersion - Full version string (e.g., "1.18.0", "1.18")
 * @returns Base version with only major.minor (e.g., "1.18")
 */
export function getBaseVersion(detailedVersion: string): string {
  if (!detailedVersion) {
    return detailedVersion;
  }

  const parts = detailedVersion.split('.');
  // Return first two parts (major.minor)
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }

  return detailedVersion;
}

/**
 * Check if a detailed version matches any of the configured base versions
 * Examples:
 *   - matches("1.18.0", ["1.18", "1.19"]) → true
 *   - matches("1.19.1", ["1.18", "1.19"]) → true
 *   - matches("1.20.0", ["1.18", "1.19"]) → false
 * 
 * @param detailedVersion - Full version from forum database (e.g., "1.18.0")
 * @param baseVersions - Configured base versions (e.g., ["1.18", "1.19"])
 * @returns true if detailed version starts with any base version
 */
export function matchesVersion(
  detailedVersion: string,
  baseVersions: string[]
): boolean {
  if (!detailedVersion || baseVersions.length === 0) {
    return false;
  }

  return baseVersions.some(baseVersion =>
    detailedVersion.startsWith(baseVersion)
  );
}
