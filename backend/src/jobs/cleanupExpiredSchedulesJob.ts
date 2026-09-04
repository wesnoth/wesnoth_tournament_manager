import { query } from '../config/database.js';

interface ExpiredProposalRow {
  id: string;
}

/**
 * Mark stale pending proposals as expired, then remove old proposals together
 * with their slots and confirmations. A proposal with no pending future slot
 * is no longer actionable even when a legacy or incorrectly extended
 * `expires_at` still lies in the future.
 */
export async function cleanupExpiredSchedules(): Promise<void> {
  const cleanupDays = parseInt(process.env.EXPIRED_SCHEDULE_CLEANUP_DAYS || '3', 10);

  try {
    console.log(`⏰ [SCHEDULES] Starting cleanup of expired schedules (threshold: ${cleanupDays} days)...`);

    await query(
      `UPDATE match_schedule_proposals p
       SET status = 'expired',
           cancelled_at = COALESCE(cancelled_at, UTC_TIMESTAMP())
       WHERE p.status IN ('pending', 'active')
         AND (
           (p.expires_at IS NOT NULL AND p.expires_at <= UTC_TIMESTAMP())
           OR NOT EXISTS (
             SELECT 1
             FROM match_schedule_slots s
             WHERE s.proposal_id = p.id
               AND s.status = 'pending'
               AND s.slot_datetime > UTC_TIMESTAMP()
           )
         )`,
      []
    );

    const expiredResult = await query(
      `SELECT p.id
       FROM match_schedule_proposals p
       LEFT JOIN match_schedule_slots s ON s.proposal_id = p.id
       GROUP BY p.id, p.expires_at, p.cancelled_at
       HAVING COALESCE(p.cancelled_at, p.expires_at, MAX(s.slot_datetime))
              < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
       ORDER BY COALESCE(p.cancelled_at, p.expires_at, MAX(s.slot_datetime)) ASC`,
      [cleanupDays]
    );

    const expiredProposals = (expiredResult.rows || []) as ExpiredProposalRow[];
    let deletedCount = 0;
    let failedCount = 0;

    for (const proposal of expiredProposals) {
      try {
        await query(`DELETE FROM match_schedule_confirmations WHERE proposal_id = ?`, [proposal.id]);
        await query(`DELETE FROM match_schedule_slots WHERE proposal_id = ?`, [proposal.id]);

        await query(`DELETE FROM match_schedule_proposals WHERE id = ?`, [proposal.id]);
        deletedCount++;
      } catch (error) {
        console.error(`❌ [SCHEDULES] Failed to delete expired proposal ${proposal.id}:`, error);
        failedCount++;
      }
    }

    if (expiredProposals.length > 0) {
      console.log(
        `✅ [SCHEDULES] Cleanup completed: ${deletedCount} proposals deleted, ${failedCount} failed`
      );
    }
  } catch (error) {
    console.error('❌ [SCHEDULES] Cleanup job failed:', error);
  }
}
