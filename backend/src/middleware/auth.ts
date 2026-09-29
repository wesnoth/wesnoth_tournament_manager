import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth.js';
import { checkUserIsForumModerator } from '../services/phpbbAuth.js';
import { query } from '../config/database.js';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

/** Reason a bearer token does not grant an authenticated session. */
export interface SessionRejection {
  status: 401 | 503;
  body: { error: string; code?: string };
}

/** Authenticated session data resolved from a valid bearer token. */
export interface ResolvedSession {
  userId: string;
  username: string;
  isAdmin: boolean;
  isStreamer: boolean;
}

/**
 * Resolve a bearer token into a session, applying every account-level rule.
 *
 * This is the single source of truth for session validity. `authMiddleware`,
 * `optionalAuthMiddleware`, and `GET /auth/validate-token` all use it, so a
 * rule added here (such as the blocked-account check) cannot be missed by one
 * entry point while the others enforce it.
 *
 * Rules, in order:
 * 1. The JWT signature and expiry must be valid.
 * 2. The user must still exist in `users_extension`.
 * 3. The account must not be administratively blocked. This is checked before
 *    revocation on purpose: blocking also sets `token_invalidated_at`, and the
 *    client should receive the more specific `ACCOUNT_BLOCKED` code.
 * 4. The token must have been issued after `token_invalidated_at` (set by
 *    maintenance mode and by blocking). `iat` has one-second granularity, so a
 *    token issued in the same second as the invalidation is treated as revoked.
 * 5. During maintenance mode only administrators keep their sessions.
 *
 * @returns the session, or the HTTP status and body the caller should send.
 */
export const resolveSession = async (
  token: string
): Promise<{ session: ResolvedSession } | { rejection: SessionRejection }> => {
  let decoded: any;
  try {
    decoded = verifyToken(token);
  } catch {
    return { rejection: { status: 401, body: { error: 'Invalid token' } } };
  }

  const userResult = await query(
    'SELECT is_admin, is_blocked, is_streamer, token_invalidated_at FROM users_extension WHERE id = ?',
    [decoded.userId]
  );
  const user = userResult.rows[0];
  if (!user) return { rejection: { status: 401, body: { error: 'User not found' } } };

  if (user.is_blocked) {
    return {
      rejection: {
        status: 401,
        body: { code: 'ACCOUNT_BLOCKED', error: 'Your account has been blocked by an administrator.' },
      },
    };
  }

  if (user.token_invalidated_at && decoded.iat * 1000 <= new Date(user.token_invalidated_at).getTime()) {
    return {
      rejection: {
        status: 401,
        body: { code: 'TOKEN_INVALIDATED', error: 'Your session has expired. Please log in again.' },
      },
    };
  }

  if (!user.is_admin) {
    const maintenanceResult = await query(
      'SELECT setting_value FROM system_settings WHERE setting_key = ?',
      ['maintenance_mode']
    );
    if (maintenanceResult.rows[0]?.setting_value === 'true') {
      return {
        rejection: {
          status: 503,
          body: { code: 'MAINTENANCE_MODE', error: 'Maintenance mode is active. Please try again later.' },
        },
      };
    }
  }

  return {
    session: {
      userId: decoded.userId,
      username: decoded.username,
      isAdmin: Boolean(user.is_admin),
      isStreamer: Boolean(user.is_streamer),
    },
  };
};

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const result = await resolveSession(token);
    if ('rejection' in result) {
      return res.status(result.rejection.status).json(result.rejection.body);
    }
    req.userId = result.session.userId;
    req.username = result.session.username;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * Response header that tells the client its stored token no longer grants a
 * session, on endpoints that answer anonymously instead of failing. The value
 * is the rejection code (for example `ACCOUNT_BLOCKED`), or `INVALID` when the
 * rejection has no code. Exposed through CORS in `app.ts`.
 */
export const SESSION_REJECTED_HEADER = 'X-Session-Rejected';

/**
 * Optional authentication for public endpoints that personalize their output.
 *
 * A request with a token that `resolveSession` would reject (invalid, revoked,
 * blocked account, or maintenance for non-admins) is served as anonymous
 * instead of failing: the endpoint is public, so the caller must still get the
 * anonymous response rather than a 401/503. Only a fully valid session sets
 * `req.userId`.
 *
 * For 401-class rejections the response also carries `SESSION_REJECTED_HEADER`,
 * so the frontend can end its stale session (otherwise a blocked user browsing
 * public pages keeps a logged-in navbar until a protected request fails).
 * Maintenance (503) is not signaled: the session is still valid and resumes
 * when maintenance ends.
 */
export const optionalAuthMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (token) {
    try {
      const result = await resolveSession(token);
      if ('session' in result) {
        req.userId = result.session.userId;
        req.username = result.session.username;
      } else if (result.rejection.status === 401) {
        res.setHeader(SESSION_REJECTED_HEADER, result.rejection.body.code || 'INVALID');
      }
    } catch (error) {
      // A lookup failure also degrades to an anonymous request.
    }
  }

  next();
};

export const adminMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const result = await query('SELECT id FROM users_extension WHERE id = ? AND is_admin = 1', [req.userId]);

  if (result.rows.length === 0) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  next();
};

export const moderatorOrAdminMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  await authMiddleware(req, res, async () => {
    const userId = req.userId!;
    const username = req.username!;
    const result = await query('SELECT is_admin FROM users_extension WHERE id = ?', [userId]);

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const isAdmin = result.rows[0].is_admin;
    if (isAdmin) return next();

    const isModerator = await checkUserIsForumModerator(username);
    if (isModerator) return next();

    return res.status(403).json({ error: 'Not authorized' });
  });
};

/** Require the global streamer capability without changing the user's other roles. */
export const streamerMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  await authMiddleware(req, res, async () => {
    const result = await query(
      'SELECT is_streamer FROM users_extension WHERE id = ? AND is_streamer = 1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Streamer capability required' });
    }

    next();
  });
};
