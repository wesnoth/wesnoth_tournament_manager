import { query } from '../config/database.js';

/**
 * Clean up old user notifications
 * 
 * Deletes notifications that are older than OLD_NOTIFICATIONS_CLEANUP_DAYS
 * based on their created_at timestamp.
 */
export async function cleanupOldNotifications(): Promise<void> {
  const cleanupDays = parseInt(process.env.OLD_NOTIFICATIONS_CLEANUP_DAYS || '90', 10);

  try {
    console.log(`⏰ [NOTIFICATIONS] Starting cleanup of old notifications (threshold: ${cleanupDays} days)...`);

    // Find and delete old notifications
    const result = await query(
      `DELETE FROM user_notifications
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [cleanupDays]
    );

    const deletedCount = (result as any).affectedRows || 0;

    if (deletedCount > 0) {
      console.log(`✅ [NOTIFICATIONS] Deleted ${deletedCount} old notifications (older than ${cleanupDays} days)`);
    }
  } catch (error) {
    console.error('❌ [NOTIFICATIONS] Cleanup job failed:', error);
  }
}
