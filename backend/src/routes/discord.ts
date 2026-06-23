import { Router, Request, Response } from 'express';
import { validateDiscordId } from '../services/discord.js';
import discordService from '../services/discordService.js';

const router = Router();

/**
 * POST /api/discord/validate-user
 * Validate Discord ID and send notification to validation channel
 * 
 * Request body:
 *   - discordId (string): Discord ID or mention format (required)
 * 
 * Response:
 *   - success (boolean): Whether validation and notification were successful
 *   - message (string): Status message
 *   - userNickname (string, optional): Discord nickname if validation succeeded
 */
router.post('/validate-user', async (req: Request, res: Response) => {
  try {
    const { discordId } = req.body;

    if (!discordId) {
      return res.status(400).json({
        success: false,
        message: 'Discord ID is required'
      });
    }

    console.log('[DISCORD-API] Validating Discord ID:', discordId);

    // Validate Discord ID and get user nickname
    const userNickname = await validateDiscordId(discordId);
    if (!userNickname) {
      console.warn('[DISCORD-API] Discord ID validation failed:', discordId);
      return res.status(400).json({
        success: false,
        message: 'Invalid Discord ID or user not found in guild'
      });
    }

    // Send notification to validation channel
    const notificationSent = await discordService.sendDiscordIdValidationNotification(userNickname);
    if (!notificationSent) {
      console.warn('[DISCORD-API] Failed to send validation notification');
      return res.status(500).json({
        success: false,
        message: 'Validation notification could not be sent. Please contact support.'
      });
    }

    console.log('[DISCORD-API] Discord ID validation successful:', userNickname);
    return res.json({
      success: true,
      message: `Validation notification sent to Discord channel`,
      userNickname
    });
  } catch (error: any) {
    console.error('[DISCORD-API] Error validating Discord ID:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;
