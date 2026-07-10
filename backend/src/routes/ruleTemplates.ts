import { Router } from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/', authMiddleware, async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, title, content_markdown, updated_at
       FROM tournament_rule_templates
       WHERE is_active = 1
       ORDER BY title ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching active rule templates:', error);
    res.status(500).json({ error: 'Failed to fetch active rule templates' });
  }
});

export default router;

