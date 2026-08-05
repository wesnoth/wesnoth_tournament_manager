import { query } from '../config/database.js';

export interface TournamentPlacement {
  id: string;
  nickname: string;
}

/** Read final phase-engine placements without consulting legacy tournament rows. */
export async function getTournamentPlacements(tournamentId: string): Promise<{
  winner: TournamentPlacement | null;
  runnerUp: TournamentPlacement | null;
}> {
  const result = await query(
    `SELECT entries.id,
            COALESCE(teams.name, users.nickname) AS nickname,
            results.placement
     FROM tournament_results results
     JOIN tournament_entries entries ON entries.id = results.entry_id
     LEFT JOIN tournament_participants participants ON participants.id = entries.participant_id
     LEFT JOIN users_extension users ON users.id = participants.user_id
     LEFT JOIN tournament_teams teams ON teams.id = entries.team_id
     WHERE results.tournament_id = ?
     ORDER BY results.placement ASC
     LIMIT 2`,
    [tournamentId]
  );
  return {
    winner: result.rows[0] || null,
    runnerUp: result.rows[1] || null,
  };
}
