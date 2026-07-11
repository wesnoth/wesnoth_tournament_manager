import cron from 'node-cron';
import { query } from '../config/database.js';
import { calculatePlayerOfMonth } from './playerOfMonthJob.js';
import { calculateGlobalStatisticsJob } from './globalStatisticsJob.js';
import { SyncGamesFromForumJob } from './syncGamesFromForum.js';
import ParseNewReplaysRefactored from './parseNewReplaysRefactored.js';
import { cleanupExpiredSchedules } from './cleanupExpiredSchedulesJob.js';
import { cleanupOldNotifications } from './cleanupOldNotificationsJob.js';
import { createFactionMapStatisticsSnapshot, recalculatePlayerMatchStatistics } from '../services/statisticsCalculator.js';
import { logAuditEvent } from '../middleware/audit.js';

/**
 * Mark unconfirmed replays as 'due' when they exceed the age threshold
 * Replays with parse_status='parsed' and integration_confidence=1 (unconfirmed)
 * are marked as 'due' after REPLAY_AUTO_DISCARD_TIME days
 * Due replays can still be downloaded but cannot be confirmed or used in matches
 */
export async function autoDiscardUnconfirmedReplays(): Promise<void> {
  const thresholdDays = parseInt(process.env.REPLAY_AUTO_DISCARD_TIME || '30', 10);
  
  try {
    const result = await query(
      `SELECT id, created_at, replay_filename, parse_summary
       FROM replays
       WHERE parse_status = 'parsed'
         AND integration_confidence = 1
         AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
         AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [thresholdDays]
    );
    
    const replays = (result as any).rows || [];
    let discardedCount = 0;
    let failedCount = 0;
    
    for (const replay of replays) {
      try {
        await query(
          `UPDATE replays SET parse_status = 'due', updated_at = NOW() WHERE id = ?`,
          [replay.id]
        );
        
        const ageDays = Math.floor((Date.now() - new Date(replay.created_at).getTime()) / (1000 * 60 * 60 * 24));
        
        await logAuditEvent({
          event_type: 'REPLAY_AUTO_DISCARDED',
          username: 'Scheduler',
          ip_address: 'localhost',
          details: { 
            replay_id: replay.id, 
            filename: replay.replay_filename, 
            age_days: ageDays,
            reason: 'Exceeded auto-discard threshold'
          }
        });
        
        discardedCount++;
      } catch (updateError) {
        console.error(`❌ [AUTO-DISCARD] Failed to discard replay ${replay.id}:`, updateError);
        failedCount++;
      }
    }
    
    if (replays.length > 0) {
      console.log(`✅ [CRON] Auto-discard completed: ${discardedCount} marked as due, ${failedCount} failed out of ${replays.length}`);
    }
  } catch (error) {
    console.error('❌ [CRON] Auto-discard job failed:', error);
  }
}

/**
 * Initialize all scheduled jobs
 * Runs at specific times in UTC:
 * - 00:30 UTC: Daily balance snapshot
 * - 00:45 UTC: Player statistics recalculation
 * - 01:00 UTC: Check and mark inactive players
 * - 01:30 UTC on 1st: Calculate player of the month
 * - 02:00 UTC: Auto-discard old unconfirmed replays
 * - 02:30 UTC: Cleanup expired P2P and tournament schedules
 * - 03:00 UTC: Cleanup old user notifications
 * - Every 30 minutes: Calculate global site statistics
 * - Every 60s: Sync new games from forum database
 * - Every 30s: Parse unparsed replays and create matches
 */
export const initializeScheduledJobs = (): void => {
  try {
    console.log('⏰ Initializing scheduled jobs...');

    // Schedule daily balance snapshot at 00:30 UTC
    cron.schedule('30 0 * * *', async () => {
      try {
        console.log('⏰ [CRON] Running daily balance snapshot...');
        await createFactionMapStatisticsSnapshot();
        console.log('✅ [CRON] Daily balance snapshot completed');
      } catch (error) {
        console.error('❌ [CRON] Failed to create daily snapshot:', error);
      }
    });
    
    // Schedule daily player statistics recalculation at 00:45 UTC
    cron.schedule('45 0 * * *', async () => {
      try {
        console.log('📊 [CRON] Recalculating player match statistics...');
        const result = await recalculatePlayerMatchStatistics();
        console.log(`✅ [CRON] Player statistics recalculated: ${result.records_updated} records`);
      } catch (error) {
        console.error('❌ [CRON] Failed to recalculate player statistics:', error);
      }
    });

    // Schedule daily inactive player check at 01:00 UTC
    // Marks players as inactive if they have no matches in the last 30 days
    cron.schedule('0 1 * * *', async () => {
      try {
        console.log('👤 [CRON] Running inactive player check...');
        const result = await query(
          `UPDATE users_extension 
           SET is_active = 0, updated_at = CURRENT_TIMESTAMP
           WHERE is_active = 1 
             AND is_blocked = 0
             AND (last_match_date IS NULL OR last_match_date < DATE_SUB(NOW(), INTERVAL 30 DAY))`
        );
        console.log(`✅ [CRON] Marked inactive players as inactive`);
      } catch (error) {
        console.error('❌ [CRON] Failed to check inactive players:', error);
      }
    });

    // Schedule forum database sync job every 60 seconds
    // Fetches new games from forum database and inserts them into replays table
    const forumSyncJob = new SyncGamesFromForumJob();
    
    const forumSyncIntervalSeconds = 60;
    const forumSyncIntervalMs = forumSyncIntervalSeconds * 1000;

    setInterval(async () => {
      try {
        await forumSyncJob.executeSync();
      } catch (error) {
        console.error('❌ [FORUM SYNC] Job execution failed:', error);
      }
    }, forumSyncIntervalMs);

    // Schedule replay parsing job every 30 seconds
    // Parses unparsed replays from forum database integration
    // Extracts victory conditions and creates/updates matches
    const parseNewReplaysRefactored = new ParseNewReplaysRefactored();
    
    const replayParseIntervalSeconds = 30;
    const replayParseIntervalMs = replayParseIntervalSeconds * 1000;

    setInterval(async () => {
      try {
        await parseNewReplaysRefactored.execute();
      } catch (error) {
        console.error('❌ [PARSE] Job execution failed:', error);
      }
    }, replayParseIntervalMs);
    
    // Schedule player of month calculation at 01:30 UTC on the 1st of every month
    cron.schedule('30 1 1 * *', async () => {
      try {
        console.log('🎯 [CRON] Calculating player of the month...');
        await calculatePlayerOfMonth();
        console.log('✅ [CRON] Player of month calculated');
      } catch (error) {
        console.error('❌ [CRON] Failed to calculate player of month:', error);
      }
    });
    
    // Schedule replay auto-discard at 02:00 UTC daily
    // Discards replays with parse_status='parsed' and integration_confidence=1 older than threshold
    cron.schedule('0 2 * * *', async () => {
      try {
        console.log('⏰ [CRON] Running auto-discard of old unconfirmed replays...');
        await autoDiscardUnconfirmedReplays();
      } catch (error) {
        console.error('❌ [CRON] Auto-discard failed:', error);
      }
    });
    
    // Schedule expired schedules cleanup at 02:30 UTC daily.
    cron.schedule('30 2 * * *', async () => {
      try {
        console.log('⏰ [CRON] Running cleanup of expired schedules...');
        await cleanupExpiredSchedules();
      } catch (error) {
        console.error('❌ [CRON] Expired schedules cleanup failed:', error);
      }
    });

    // Schedule old notifications cleanup at 03:00 UTC daily
    // Removes user_notifications older than OLD_NOTIFICATIONS_CLEANUP_DAYS
    cron.schedule('0 3 * * *', async () => {
      try {
        console.log('⏰ [CRON] Running cleanup of old notifications...');
        await cleanupOldNotifications();
      } catch (error) {
        console.error('❌ [CRON] Old notifications cleanup failed:', error);
      }
    });

    // Schedule global statistics calculation every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      try {
        await calculateGlobalStatisticsJob();
      } catch (error) {
        console.error('❌ [CRON] Global statistics calculation failed:', error);
      }
    });
    
    console.log('✅ Scheduled jobs initialized:');
    console.log('   - Balance snapshot: Daily at 00:30 UTC');
    console.log('   - Player statistics recalculation: Daily at 00:45 UTC');
    console.log('   - Inactive players check: Daily at 01:00 UTC');
    console.log('   - Player of month: 1st of month at 01:30 UTC');
    console.log('   - Auto-discard unconfirmed replays: Daily at 02:00 UTC');
    console.log('   - Proposal expiration & purge: Daily at 02:30 UTC');
    console.log('   - Expired schedules cleanup: Daily at 02:45 UTC');
    console.log('   - Old notifications cleanup: Daily at 03:00 UTC');
    console.log('   - Global statistics calculation: Every 30 minutes');
    console.log('   - Forum database sync: Every 60 seconds');
    console.log('   - Replay parsing & match creation: Every 30 seconds');
  } catch (error) {
    console.error('❌ Failed to initialize scheduler:', error);
    process.exit(1);
  }
};
