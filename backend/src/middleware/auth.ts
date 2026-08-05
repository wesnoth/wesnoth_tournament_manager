import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/auth.js';
import { checkUserIsForumModerator } from '../services/phpbbAuth.js';
import { query } from '../config/database.js';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = verifyToken(token);
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
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  let userId: string;
  let username: string;
  try {
    const decoded = verifyToken(token);
    userId = decoded.userId;
    username = decoded.username;
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (!userId || !username) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.userId = userId;
  req.username = username;

  const result = await query('SELECT is_admin FROM users_extension WHERE id = ?', [userId]);

  if (result.rows.length === 0) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const isAdmin = result.rows[0].is_admin;
  if (isAdmin) return next();

  const isModerator = await checkUserIsForumModerator(username);
  if (isModerator) return next();

  return res.status(403).json({ error: 'Not authorized' });
};
