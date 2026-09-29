/**
 * Security-sensitive environment configuration, resolved and validated once.
 *
 * Invariant: outside local development, the backend must never start with a
 * configuration that silently weakens authentication or client identification.
 * Misconfigurations that used to degrade quietly (a hard-coded JWT fallback,
 * trusting no proxy behind Apache, a TEST_MODE flag in production) now abort
 * startup with a clear message instead.
 */

/** Normalized `NODE_ENV`; an unset value is treated as local development. */
const nodeEnv = (): string => (process.env.NODE_ENV || 'development').trim().toLowerCase();

const isDevelopment = (): boolean => nodeEnv() === 'development';

/** Shortest accepted HMAC secret. 32 characters keep HS256 keys brute-force resistant. */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Well-known example values that must never sign production tokens. The
 * `.env.example` placeholder is 33 characters long, so a length check alone
 * would accept it when an example file is copied unchanged.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'your-secret-key',
  'your-secret-key-here-min-32-chars',
]);

/**
 * Return the JWT signing secret.
 *
 * There is deliberately no fallback value: a hard-coded default would let
 * anyone who reads the source forge tokens (including administrator ids) on a
 * deployment that lost the variable. `validateSecurityConfig` rejects a missing
 * secret at startup, so this only throws if called before that validation.
 */
export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
};

/**
 * Whether the TEST_MODE login bypass is active.
 *
 * Double check: `TEST_MODE=true` alone is not enough; `NODE_ENV` must also be
 * something other than `production`. While active, the bypass still requires
 * the shared test password (`TEST_MODE_PASSWORD_HASH`). This keeps the bypass available on the
 * TEST server and in local development, where testers log in as real replay
 * players whose forum passwords they do not know. The production combination
 * is rejected at startup by `validateSecurityConfig`, so this check is a second
 * line of defense.
 */
export const isTestModeActive = (): boolean =>
  (process.env.TEST_MODE || '').trim().toLowerCase() === 'true' && nodeEnv() !== 'production';

/**
 * bcrypt hash format (`$2a$`/`$2b$`/`$2y$`, two-digit cost, 53-character salt
 * and digest). Checked at startup so a truncated value (for example, `$`
 * sequences expanded by a shell or an unquoted env file) fails loudly instead
 * of making every test login fail.
 */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * Return the bcrypt hash of the shared TEST_MODE password.
 *
 * Only the hash is stored in configuration, so reading the server settings
 * does not reveal the password. `validateSecurityConfig` guarantees a valid
 * hash whenever TEST_MODE is active, so login code can rely on it.
 */
export const getTestModePasswordHash = (): string => (process.env.TEST_MODE_PASSWORD_HASH || '').trim();

/**
 * Validate security configuration before the server accepts requests.
 *
 * Rules:
 * - `JWT_SECRET` missing: abort in every environment (there is no fallback).
 * - `JWT_SECRET` shorter than 32 characters or a known placeholder: abort
 *   outside development; warn in development so local setups keep working.
 * - Proxy trust disabled: abort outside development. TEST and production are
 *   reachable only through a reverse proxy, so without `TRUST_PROXY` every
 *   client shares the proxy address as its rate-limit key and audit IP.
 * - `TEST_MODE=true` with `NODE_ENV=production`: abort instead of silently
 *   ignoring the flag, so the misconfiguration is noticed.
 * - `TEST_MODE` active without a valid `TEST_MODE_PASSWORD_HASH`: abort in
 *   every environment. The bypass must never again accept an arbitrary
 *   password; testers need the shared secret.
 * - `TEST_MODE` active: log a prominent banner.
 *
 * @param trustProxy the value Express resolved for `trust proxy`.
 * @throws Error describing every violation found, so all can be fixed at once.
 */
export const validateSecurityConfig = (trustProxy: unknown): void => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const env = nodeEnv();
  const strictOrWarn = (message: string) => (isDevelopment() ? warnings : errors).push(message);

  const secret = process.env.JWT_SECRET || '';
  if (!secret) {
    errors.push('JWT_SECRET is not set.');
  } else if (KNOWN_PLACEHOLDER_SECRETS.has(secret)) {
    strictOrWarn('JWT_SECRET uses a known example value; generate a random secret.');
  } else if (secret.length < MIN_JWT_SECRET_LENGTH) {
    strictOrWarn(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long.`);
  }

  if (trustProxy === false) {
    strictOrWarn('TRUST_PROXY is not configured; client IPs would resolve to the proxy address.');
  }

  if ((process.env.TEST_MODE || '').trim().toLowerCase() === 'true' && env === 'production') {
    errors.push('TEST_MODE=true is not allowed with NODE_ENV=production.');
  }

  if (isTestModeActive() && !BCRYPT_HASH_PATTERN.test(getTestModePasswordHash())) {
    errors.push(
      getTestModePasswordHash()
        ? 'TEST_MODE_PASSWORD_HASH is not a valid bcrypt hash (quote it in single quotes so "$" is not expanded).'
        : 'TEST_MODE=true requires TEST_MODE_PASSWORD_HASH (bcrypt hash of the shared test password).'
    );
  }

  for (const warning of warnings) {
    console.warn(`⚠️  [CONFIG] ${warning}`);
  }

  if (isTestModeActive()) {
    console.warn('');
    console.warn('⚠️  ***************************************************************');
    console.warn(`⚠️  TEST_MODE IS ACTIVE (NODE_ENV=${env}): non-privileged users can log in`);
    console.warn('⚠️  with the shared test password. Admins and moderators still need their own.');
    console.warn('⚠️  ***************************************************************');
    console.warn('');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid security configuration (NODE_ENV=${env}):\n  - ${errors.join('\n  - ')}`);
  }
};
