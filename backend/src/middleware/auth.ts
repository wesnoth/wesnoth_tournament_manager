import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth.js';
import { checkUserIsForumModerator } from '../services/phpbbAuth.js';
import { query } from '../config/database.js';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = verifyToken(token);
    const userResult = await query(
      'SELECT is_admin, token_invalidated_at FROM users_extension WHERE id = ?',
      [decoded.userId]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Maintenance invalidates non-admin sessions both immediately and after it ends.
    if (user.token_invalidated_at && decoded.iat * 1000 <= new Date(user.token_invalidated_at).getTime()) {
      return res.status(401).json({ code: 'TOKEN_INVALIDATED', error: 'Your session has expired. Please log in again.' });
    }

    if (!user.is_admin) {
      const maintenanceResult = await query(
        'SELECT setting_value FROM system_settings WHERE setting_key = ?',
        ['maintenance_mode']
      );
      if (maintenanceResult.rows[0]?.setting_value === 'true') {
        return res.status(503).json({
          code: 'MAINTENANCE_MODE',
          error: 'Maintenance mode is active. Please try again later.',
        });
      }
    }
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Optional auth middleware - extracts user ID if token is provided, but doesn't fail if missing.
export const optionalAuthMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyToken(token);
      req.userId = decoded.userId;
      req.username = decoded.username;
    } catch (error) {
      // Token is invalid, but we continue anyway
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
