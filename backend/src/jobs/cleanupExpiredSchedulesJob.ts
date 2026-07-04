import { query } from '../config/database.js';

/**
 * Clean up expired schedule proposals (both P2P and tournament)
 * 
 * A proposal is considered expired if:
 * 1. Status is NOT 'confirmed' or 'cancelled'
 * 2. The latest slot_datetime in the proposal + EXPIRED_SCHEDULE_CLEANUP_DAYS < NOW()
 * 
 * When expired:
 * - Delete all slots for the proposal
 * - Delete confirmations for the proposal
 * - Delete the proposal itself
 * - If tournament proposal: reset tournament_round_matches back to pending
 */
export async function cleanupExpiredSchedules(): Promise<void> {
  const cleanupDays = parseInt(process.env.EXPIRED_SCHEDULE_CLEANUP_DAYS || '3', 10);

  try {
    console.log(`⏰ [SCHEDULES] Starting cleanup of expired schedules (threshold: ${cleanupDays} days)...`);

    // Find all non-confirmed, non-cancelled proposals with expired latest slots
    const expiredResult = await query(
      `SELECT 
         msp.id,
         msp.proposal_type,
         msp.tournament_round_match_id,
         MAX(mss.slot_datetime) as latest_slot
       FROM match_schedule_proposals msp
       LEFT JOIN match_schedule_slots mss ON msp.id = mss.proposal_id
       WHERE msp.status NOT IN ('confirmed', 'cancelled')
         AND mss.status = 'pending'
       GROUP BY msp.id
       HAVING latest_slot IS NOT NULL
         AND latest_slot < DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY latest_slot ASC`,
      [cleanupDays]
    );

    const expiredProposals = (expiredResult as any).rows || [];
    let deletedCount = 0;
    let failedCount = 0;

    for (const proposal of expiredProposals) {
      try {
        const { id: proposalId, tournament_round_match_id } = proposal;

        // Delete slots
        await query(
          `DELETE FROM match_schedule_slots WHERE proposal_id = ?`,
          [proposalId]
        );

        // Delete confirmations
        await query(
          `DELETE FROM match_schedule_confirmations WHERE proposal_id = ?`,
          [proposalId]
        );

        // If tournament proposal, reset tournament_round_matches
        if (tournament_round_match_id) {
          await query(
            `UPDATE tournament_round_matches 
             SET scheduled_datetime = NULL, 
                 scheduled_status = 'pending',
                 scheduled_confirmed_at = NULL
             WHERE id = ?`,
            [tournament_round_match_id]
          );
        }

        // Delete proposal
        await query(
          `DELETE FROM match_schedule_proposals WHERE id = ?`,
          [proposalId]
        );

        deletedCount++;
      } catch (error) {
        console.error(`❌ [SCHEDULES] Failed to delete expired proposal ${proposal.id}:`, error);
        failedCount++;
      }
    }

    if (expiredProposals.length > 0) {
      console.log(
        `✅ [SCHEDULES] Cleanup completed: ${deletedCount} expired proposals deleted, ${failedCount} failed out of ${expiredProposals.length}`
      );
    }
  } catch (error) {
    console.error('❌ [SCHEDULES] Cleanup job failed:', error);
  }
}
