import { Router, Response } from 'express';
import { query } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Notifications are persisted and served over authenticated HTTP; this router
// intentionally contains no WebSocket or push-transport integration.

/**
 * GET /unread-count
 * Get count of unread notifications for navbar badge
 */
router.get('/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await query(
      `SELECT COUNT(*) as count
       FROM user_notifications
       WHERE user_id = ? AND is_read = false AND is_deleted = false`,
      [userId]
    );

    const count = (result.rows && result.rows[0]) ? result.rows[0].count : 0;
    res.json({
      success: true,
      unreadCount: count,
    });
  } catch (error) {
    console.error('❌ Error fetching unread count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /
 * Get all notifications for current user with optional filtering
 * Query params: type, limit, offset
 */
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { type, limit = '50', offset = '0' } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let whereClause = 'user_id = ? AND is_deleted = false';
    const params: any[] = [userId];

    if (type && type !== '') {
      whereClause += ' AND type = ?';
      params.push(type);
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM user_notifications WHERE ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT id, user_id, tournament_id, game_id, series_id, type, title, message, message_extra, is_read, created_at
       FROM user_notifications
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit as string), parseInt(offset as string)]
    );

    const notifications = result.rows || [];
    const total = (countResult.rows && countResult.rows[0]) ? countResult.rows[0].total : 0;

    res.json({
      success: true,
      notifications,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        total,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /pending
 * Get all unread (pending) notifications
 */
router.get('/pending', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await query(
      `SELECT id, user_id, tournament_id, game_id, series_id, type, title, message, message_extra, is_read, created_at
       FROM user_notifications
       WHERE user_id = ? AND is_read = false AND is_deleted = false
       ORDER BY created_at DESC`,
      [userId]
    );

    const notifications = result.rows || [];
    res.json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error('❌ Error fetching pending notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /accepted
 * Get all accepted (schedule_confirmed) notifications
 */
router.get('/accepted', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await query(
      `SELECT id, user_id, tournament_id, game_id, series_id, type, title, message, message_extra, is_read, created_at
       FROM user_notifications
       WHERE user_id = ? AND type = 'schedule_confirmed' AND is_deleted = false
       ORDER BY created_at DESC`,
      [userId]
    );

    const notifications = result.rows || [];
    res.json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error('❌ Error fetching accepted notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:notificationId/mark-read
 * Mark a specific notification as read
 */
router.post('/:notificationId/mark-read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { notificationId } = req.params;
    const userId = req.userId;

    if (!userId || !notificationId) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Verify ownership of notification
    const notificationResult = await query(
      'SELECT user_id FROM user_notifications WHERE id = ?',
      [notificationId]
    );

    if (!notificationResult.rows || notificationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notificationResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Mark as read
    await query(
      'UPDATE user_notifications SET is_read = true WHERE id = ?',
      [notificationId]
    );

    res.json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:notificationId/mark-unread
 * Mark a specific notification as unread
 */
router.post('/:notificationId/mark-unread', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { notificationId } = req.params;
    const userId = req.userId;

    if (!userId || !notificationId) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Verify ownership of notification
    const notificationResult = await query(
      'SELECT user_id FROM user_notifications WHERE id = ?',
      [notificationId]
    );

    if (!notificationResult.rows || notificationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notificationResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Mark as unread
    await query(
      'UPDATE user_notifications SET is_read = false WHERE id = ?',
      [notificationId]
    );

    res.json({
      success: true,
      message: 'Notification marked as unread',
    });
  } catch (error) {
    console.error('❌ Error marking notification as unread:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:notificationId/delete
 * Soft delete a specific notification
 */
router.post('/:notificationId/delete', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { notificationId } = req.params;
    const userId = req.userId;

    if (!userId || !notificationId) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // Verify ownership of notification
    const notificationResult = await query(
      'SELECT user_id FROM user_notifications WHERE id = ?',
      [notificationId]
    );

    if (!notificationResult.rows || notificationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notificationResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Soft delete
    await query(
      'UPDATE user_notifications SET is_deleted = true WHERE id = ?',
      [notificationId]
    );

    res.json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (error) {
    console.error('❌ Error deleting notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /mark-all-read
 * Mark all unread notifications as read for the current user
 */
router.post('/mark-all-read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await query(
      'UPDATE user_notifications SET is_read = true WHERE user_id = ? AND is_read = false AND is_deleted = false',
      [userId]
    );

    const affectedRows = (result as any).affectedRows || 0;
    res.json({
      success: true,
      message: `Marked ${affectedRows} notifications as read`,
    });
  } catch (error) {
    console.error('❌ Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /delete-all
 * Soft delete all notifications for the current user
 */
router.post('/delete-all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await query(
      'UPDATE user_notifications SET is_deleted = true WHERE user_id = ? AND is_deleted = false',
      [userId]
    );

    const affectedRows = (result as any).affectedRows || 0;
    res.json({
      success: true,
      message: `Deleted ${affectedRows} notifications`,
    });
  } catch (error) {
    console.error('❌ Error deleting all notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
