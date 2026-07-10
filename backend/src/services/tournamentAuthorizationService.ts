import { query } from '../config/database.js';

export async function isTournamentOrganizer(tournamentId: string, userId: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT 1
       FROM tournaments t
       WHERE t.id = ?
         AND (
           t.creator_id = ?
           OR EXISTS (
             SELECT 1
             FROM tournament_organizers tor
             WHERE tor.tournament_id = t.id
               AND tor.user_id = ?
           )
         )
       LIMIT 1`,
      [tournamentId, userId, userId]
    );

    return result.rows.length > 0;
  } catch (error: any) {
    // Compatibility fallback for environments where migration is not yet applied.
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      const fallback = await query(
        `SELECT 1
         FROM tournaments
         WHERE id = ? AND creator_id = ?
         LIMIT 1`,
        [tournamentId, userId]
      );
      return fallback.rows.length > 0;
    }

    throw error;
  }
}
