import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import { AuthRequest, moderatorOrAdminMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/', moderatorOrAdminMiddleware, async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, title, content_markdown, is_active, created_by, updated_by, created_at, updated_at
       FROM tournament_rule_templates
       ORDER BY updated_at DESC, title ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tournament rule templates:', error);
    res.status(500).json({ error: 'Failed to fetch tournament rule templates' });
  }
});

router.post('/', moderatorOrAdminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { title, content_markdown, is_active } = req.body;

    if (!title || !content_markdown) {
      return res.status(400).json({ error: 'Missing required fields: title, content_markdown' });
    }

    const templateId = randomUUID();
    await query(
      `INSERT INTO tournament_rule_templates
        (id, title, content_markdown, is_active, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [templateId, title.trim(), content_markdown, is_active === false ? 0 : 1, req.userId || null, req.userId || null]
    );

    const created = await query(
      `SELECT id, title, content_markdown, is_active, created_by, updated_by, created_at, updated_at
       FROM tournament_rule_templates
       WHERE id = ?`,
      [templateId]
    );

    res.status(201).json(created.rows[0]);
  } catch (error) {
    console.error('Error creating tournament rule template:', error);
    res.status(500).json({ error: 'Failed to create tournament rule template' });
  }
});

router.put('/:id', moderatorOrAdminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { title, content_markdown, is_active } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(String(title).trim());
    }

    if (content_markdown !== undefined) {
      updates.push('content_markdown = ?');
      values.push(content_markdown);
    }

    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_by = ?');
    values.push(req.userId || null);
    values.push(id);

    const result = await query(
      `UPDATE tournament_rule_templates
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Rule template not found' });
    }

    const updated = await query(
      `SELECT id, title, content_markdown, is_active, created_by, updated_by, created_at, updated_at
       FROM tournament_rule_templates
       WHERE id = ?`,
      [id]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.error('Error updating tournament rule template:', error);
    res.status(500).json({ error: 'Failed to update tournament rule template' });
  }
});

router.delete('/:id', moderatorOrAdminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const usageResult = await query(
      'SELECT COUNT(*) AS total FROM tournaments WHERE rules_template_id = ?',
      [id]
    );
    const totalUsage = Number(usageResult.rows[0]?.total || 0);

    if (totalUsage > 0) {
      return res.status(400).json({
        error: 'Template is used by existing tournaments. Deactivate it instead of deleting.'
      });
    }

    const result = await query('DELETE FROM tournament_rule_templates WHERE id = ?', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Rule template not found' });
    }

    res.json({ message: 'Rule template deleted successfully' });
  } catch (error) {
    console.error('Error deleting tournament rule template:', error);
    res.status(500).json({ error: 'Failed to delete tournament rule template' });
  }
});

export default router;

