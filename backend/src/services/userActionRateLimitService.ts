import { randomUUID } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool } from '../config/database.js';
import { resolveSupportedLanguage, translate } from '../i18n/translationService.js';

/**
 * Stable persisted categories used by the rolling per-user limiter.
 *
 * `tournament_creation` counts only successful tournament creation attempts.
 * The P2P and tournament-schedule categories are broader action budgets: an
 * initial proposal, a counter-proposal, and an edit all consume the same quota
 * because each operation can produce another public Discord notification.
 * Confirmations and terminal cancellation/rejection transitions are excluded
 * because they cannot be repeated without another already-limited mutation.
 */
export type UserActionRateLimitType =
  | 'tournament_creation'
  | 'p2p_challenge'
  | 'tournament_schedule';

interface UserRateLimitProfileRow extends RowDataPacket {
  language: string | null;
  timezone: string | null;
}

interface RateLimitCountRow extends RowDataPacket {
  action_count: number | string;
  oldest_created_at: Date | string | null;
}

interface LocalizedRateLimitDetails {
  message: string;
  retryAtLocal: string;
  timezone: string;
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Parse positive integer configuration while keeping production safe when a
 * value is absent or malformed. Zero never disables these abuse protections.
 */
const getPositiveInteger = (name: string, fallback: number): number => {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
};

/** Rolling-window duration shared by every action category. Defaults to one hour. */
export const USER_ACTION_RATE_LIMIT_WINDOW_MS = getPositiveInteger(
  'USER_ACTION_RATE_LIMIT_WINDOW_MS',
  DEFAULT_WINDOW_MS
);

/**
 * Maximum actions per user and rolling window. These defaults remain active
 * when deployment variables are missing, zero, negative, fractional, or not numeric.
 */
export const USER_ACTION_RATE_LIMITS: Record<UserActionRateLimitType, number> = {
  tournament_creation: getPositiveInteger('TOURNAMENT_CREATION_RATE_LIMIT_MAX', 3),
  p2p_challenge: getPositiveInteger('P2P_CHALLENGE_RATE_LIMIT_MAX', 5),
  tournament_schedule: getPositiveInteger('TOURNAMENT_SCHEDULE_RATE_LIMIT_MAX', 10),
};

/**
 * Build the user-facing error from the language and IANA timezone stored in
 * the profile. The canonical retry instant remains a UTC `Date`; this function
 * adds a display value only. Invalid legacy timezones fall back to UTC so an
 * error response can never fail while it is reporting throttling.
 */
const localizeRateLimit = (
  actionType: UserActionRateLimitType,
  retryAt: Date,
  profile: UserRateLimitProfileRow
): LocalizedRateLimitDetails => {
  const language = resolveSupportedLanguage(profile.language);
  let timezone = profile.timezone || 'UTC';
  let retryAtLocal: string;

  try {
    retryAtLocal = new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short',
    }).format(retryAt);
  } catch {
    // Legacy profiles may predate timezone validation. UTC keeps the response deterministic.
    timezone = 'UTC';
    retryAtLocal = new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short',
    }).format(retryAt);
  }

  return {
    message: translate(language, `rate_limits.${actionType}`, { retryAt: retryAtLocal }),
    retryAtLocal,
    timezone,
  };
};

/**
 * Domain error carrying every value needed for a standards-friendly HTTP 429.
 * Route handlers must preserve the canonical UTC instant as well as the local
 * display value so API consumers do not have to parse localized date text.
 */
export class UserActionRateLimitError extends Error {
  readonly code = 'USER_ACTION_RATE_LIMIT_EXCEEDED';

  /**
   * @param actionType Exhausted independent budget.
   * @param limit Maximum actions allowed inside `windowMs`.
   * @param windowMs Effective rolling-window duration after environment fallback.
   * @param retryAt Canonical UTC instant when the oldest action leaves the window.
   * @param retryAfterSeconds Rounded-up relative delay for the HTTP header.
   * @param retryAtLocal Display-only retry instant formatted for the profile.
   * @param timezone Effective profile timezone, or UTC after validation fallback.
   * @param message Fully localized user-facing message.
   */
  constructor(
    readonly actionType: UserActionRateLimitType,
    readonly limit: number,
    readonly windowMs: number,
    readonly retryAt: Date,
    readonly retryAfterSeconds: number,
    readonly retryAtLocal: string,
    readonly timezone: string,
    message: string
  ) {
    super(message);
    this.name = 'UserActionRateLimitError';
  }
}

/**
 * Atomically consume one action in a rolling per-user window.
 *
 * Locking the application user serializes concurrent requests for that user,
 * while the composite index keeps window cleanup and counting bounded. When a
 * caller supplies a connection, it owns the surrounding transaction; this is
 * used to make tournament insertion and quota consumption one atomic change.
 * Standalone callers receive an independently committed reservation and may
 * release it if their protected primary mutation fails before persistence.
 *
 * Expired rows for the user and category are deleted during successful checks.
 * This bounds retained history to a small number of rows per category without
 * requiring a background cleanup job. A rejected check rolls its cleanup back,
 * but expired rows are excluded by the cutoff and removed by the next success.
 *
 * @param userId Authenticated application user whose budget is consumed.
 * @param actionType Stable category whose independent budget should be checked.
 * @param existingConnection Optional transaction-owned connection. The caller
 * must commit, roll back, and release it.
 * @returns UUID of the persisted reservation event.
 * @throws UserActionRateLimitError with a localized retry time when exhausted.
 */
export const consumeUserActionRateLimit = async (
  userId: string,
  actionType: UserActionRateLimitType,
  existingConnection?: PoolConnection
): Promise<string> => {
  const connection = existingConnection || await pool.getConnection();
  const managesTransaction = !existingConnection;

  try {
    if (managesTransaction) await connection.beginTransaction();

    // The user row is the serialization lock shared by every backend instance.
    // Different action categories for one user intentionally serialize as well;
    // these mutations are infrequent and correctness matters more than parallelism.
    const [profileRows] = await connection.execute<UserRateLimitProfileRow[]>(
      `SELECT language, timezone
       FROM users_extension
       WHERE id = ?
       FOR UPDATE`,
      [userId]
    );
    // Authentication normally guarantees a profile row. Null language lets the
    // translation service own the fallback if legacy data is unexpectedly absent.
    const profile = profileRows[0] || { language: null, timezone: 'UTC' };
    const cutoff = new Date(Date.now() - USER_ACTION_RATE_LIMIT_WINDOW_MS);

    await connection.execute(
      `DELETE FROM user_action_rate_limit_events
       WHERE user_id = ? AND action_type = ? AND created_at < ?`,
      [userId, actionType, cutoff]
    );

    const [countRows] = await connection.execute<RateLimitCountRow[]>(
      `SELECT COUNT(*) AS action_count, MIN(created_at) AS oldest_created_at
       FROM user_action_rate_limit_events
       WHERE user_id = ? AND action_type = ? AND created_at >= ?`,
      [userId, actionType, cutoff]
    );
    const actionCount = Number(countRows[0]?.action_count || 0);
    const limit = USER_ACTION_RATE_LIMITS[actionType];

    if (actionCount >= limit) {
      // In a rolling window the oldest retained event is the first capacity
      // that will become available, so it defines the exact retry instant.
      const oldestCreatedAt = new Date(countRows[0].oldest_created_at!);
      const retryAt = new Date(oldestCreatedAt.getTime() + USER_ACTION_RATE_LIMIT_WINDOW_MS);
      const retryAfterSeconds = Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000));
      const localized = localizeRateLimit(actionType, retryAt, profile);
      throw new UserActionRateLimitError(
        actionType,
        limit,
        USER_ACTION_RATE_LIMIT_WINDOW_MS,
        retryAt,
        retryAfterSeconds,
        localized.retryAtLocal,
        localized.timezone,
        localized.message
      );
    }

    const eventId = randomUUID();
    const createdAt = new Date();
    await connection.execute(
      `INSERT INTO user_action_rate_limit_events (id, user_id, action_type, created_at)
       VALUES (?, ?, ?, ?)`,
      [eventId, userId, actionType, createdAt]
    );

    if (managesTransaction) await connection.commit();
    return eventId;
  } catch (error) {
    if (managesTransaction) await connection.rollback();
    throw error;
  } finally {
    if (managesTransaction) connection.release();
  }
};

/**
 * Release a standalone reservation when the protected primary mutation did not
 * persist. Once the main entity or state transition exists, the event must be
 * retained even if slots, in-app notifications, or Discord delivery later fail.
 *
 * Compensation is best-effort: masking the original operation error would make
 * diagnosis harder, and any undeleted event naturally expires from the rolling
 * window.
 *
 * @param eventId Reservation returned by `consumeUserActionRateLimit`.
 * @param userId Owner used to prevent deleting another user's reservation.
 * @param actionType Category used to prevent cross-budget deletion.
 */
export const releaseUserActionRateLimit = async (
  eventId: string,
  userId: string,
  actionType: UserActionRateLimitType
): Promise<void> => {
  const connection = await pool.getConnection();
  try {
    await connection.execute(
      `DELETE FROM user_action_rate_limit_events
       WHERE id = ? AND user_id = ? AND action_type = ?`,
      [eventId, userId, actionType]
    );
  } catch (error) {
    // Preserve the primary mutation error. A stale reservation expires through
    // normal rolling-window cleanup even if this compensating delete fails.
    console.error('Failed to release user action rate-limit reservation:', error);
  } finally {
    connection.release();
  }
};
