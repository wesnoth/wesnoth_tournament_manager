import { query } from '../config/database.js';

interface ExpiredProposalRow {
  id: string;
}

/**
 * Remove expired phase-series and P2P proposals together with their slots and
 * confirmations. The retention window uses `expires_at`, falling back to the
 * latest slot when a proposal has no explicit expiration timestamp.
 */
export async function cleanupExpiredSchedules(): Promise<void> {
  const cleanupDays = parseInt(process.env.EXPIRED_SCHEDULE_CLEANUP_DAYS || '3', 10);

  try {
    console.log(`⏰ [SCHEDULES] Starting cleanup of expired schedules (threshold: ${cleanupDays} days)...`);

    const expiredResult = await query(
      `SELECT p.id
       FROM match_schedule_proposals p
       LEFT JOIN match_schedule_slots s ON s.proposal_id = p.id
       GROUP BY p.id, p.expires_at
       HAVING COALESCE(p.expires_at, MAX(s.slot_datetime)) < DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY COALESCE(p.expires_at, MAX(s.slot_datetime)) ASC`,
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
