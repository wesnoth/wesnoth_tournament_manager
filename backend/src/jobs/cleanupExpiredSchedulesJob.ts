import { query } from '../config/database.js';

interface ExpiredProposalRow {
  id: string;
  linked_round_match_id: string | null;
}

/**
 * Remove old P2P and tournament proposals together with their slots and
 * confirmations. The retention window uses `expires_at`, falling back to the
 * latest slot for legacy proposals without an expiration timestamp.
 */
export async function cleanupExpiredSchedules(): Promise<void> {
  const cleanupDays = parseInt(process.env.EXPIRED_SCHEDULE_CLEANUP_DAYS || '3', 10);

  try {
    console.log(`⏰ [SCHEDULES] Starting cleanup of expired schedules (threshold: ${cleanupDays} days)...`);

    const expiredResult = await query(
      `SELECT p.id,
              COALESCE(p.tournament_round_match_id, tm.tournament_round_match_id) AS linked_round_match_id
       FROM match_schedule_proposals p
       LEFT JOIN match_schedule_slots s ON s.proposal_id = p.id
       LEFT JOIN tournament_matches tm ON tm.id = p.tournament_match_id
       GROUP BY p.id, p.tournament_round_match_id, tm.tournament_round_match_id, p.expires_at
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

        // Do not clear a match schedule if another active proposal replaced it.
        if (proposal.linked_round_match_id) {
          await query(
            `UPDATE tournament_round_matches
             SET scheduled_datetime = NULL,
                 scheduled_status = 'pending',
                 scheduled_by_player_id = NULL,
                 scheduled_confirmed_at = NULL
             WHERE id = ?
               AND NOT EXISTS (
                 SELECT 1 FROM match_schedule_proposals
                 WHERE tournament_round_match_id = ?
                   AND id <> ?
                   AND status IN ('pending', 'confirmed', 'active')
               )`,
            [proposal.linked_round_match_id, proposal.linked_round_match_id, proposal.id]
          );
        }

        await query(`DELETE FROM match_schedule_proposals WHERE id = ?`, [proposal.id]);
        deletedCount++;
      } catch (error) {
        console.error(`❌ [SCHEDULES] Failed to delete expired proposal ${proposal.id}:`, error);
        failedCount++;
      }
    }

    // Clear schedules created by the legacy single-slot endpoints, which may
    // have no row in match_schedule_proposals to anchor their retention.
    const legacyScheduleResult = await query(
      `UPDATE tournament_round_matches trm
       SET scheduled_datetime = NULL,
           scheduled_status = 'pending',
           scheduled_by_player_id = NULL,
           scheduled_confirmed_at = NULL
       WHERE trm.scheduled_datetime IS NOT NULL
         AND trm.scheduled_datetime < DATE_SUB(NOW(), INTERVAL ? DAY)
         AND NOT EXISTS (
           SELECT 1
           FROM match_schedule_proposals p
           LEFT JOIN tournament_matches tm ON tm.id = p.tournament_match_id
           WHERE (p.tournament_round_match_id = trm.id OR tm.tournament_round_match_id = trm.id)
             AND p.status IN ('pending', 'confirmed', 'active')
         )`,
      [cleanupDays]
    );
    const legacySchedulesCleared = legacyScheduleResult.rowCount || 0;

    if (expiredProposals.length > 0 || legacySchedulesCleared > 0) {
      console.log(
        `✅ [SCHEDULES] Cleanup completed: ${deletedCount} proposals deleted, ${legacySchedulesCleared} legacy schedules cleared, ${failedCount} failed`
      );
    }
  } catch (error) {
    console.error('❌ [SCHEDULES] Cleanup job failed:', error);
  }
}
