import { query } from '../config/database.js';

export interface TournamentPlacement {
  /** Tournament entry id (kept for existing list consumers). */
  id: string;
  /** Display name: the player's nickname, or the team name for team entries. */
  nickname: string;
  /** User behind a player entry; null for team entries, which have no single profile. */
  user_id: string | null;
  /** Team entries only: the accepted members in team order; empty for player entries. */
  members: Array<{ user_id: string; nickname: string }>;
}

/** Read final phase-engine placements without consulting legacy tournament rows. */
export async function getTournamentPlacements(tournamentId: string): Promise<{
  winner: TournamentPlacement | null;
  runnerUp: TournamentPlacement | null;
}> {
  const result = await query(
    `SELECT entries.id,
            COALESCE(teams.name, users.nickname) AS nickname,
            participants.user_id,
            entries.team_id,
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
  const [winner, runnerUp] = await Promise.all(
    [result.rows[0], result.rows[1]].map(row => row ? withTeamMembers(row) : null)
  );
  return { winner, runnerUp };
}

/**
 * Attach the members of a team placement so it can be shown as
 * "Team name (player A, player B)". Members replaced mid-tournament are moved
 * out of the team, so the accepted members on the team row are the ones who
 * finished it (the same rule the laurel counts use).
 */
async function withTeamMembers(row: any): Promise<TournamentPlacement> {
  const { team_id: teamId, ...placement } = row;
  if (!teamId) return { ...placement, members: [] };
  const members = await query(
    `SELECT participants.user_id, users.nickname
     FROM tournament_participants participants
     JOIN users_extension users ON users.id = participants.user_id
     WHERE participants.team_id = ? AND participants.participation_status = 'accepted'
     ORDER BY participants.team_position, users.nickname`,
    [teamId]
  );
  return { ...placement, members: members.rows };
}

/**
 * Derived table with one row per user who reached a podium in a finished
 * tournament: `user_id`, `tournaments_gold`, `tournaments_silver`,
 * `tournaments_bronze`. Callers LEFT JOIN it on `user_id` and COALESCE the
 * counts to 0 for users without podiums.
 *
 * Rules (agreed with the maintainer):
 * - The source is `tournament_results.placement` written by the phase engine
 *   when the last phase completes: 1 = gold, 2 = silver, 3 = bronze, in every
 *   format. Placements are unique per tournament, so an elimination bracket
 *   without a third-place series still yields exactly one bronze (decided by
 *   the standings tiebreakers between the semifinal losers).
 * - Every modality counts (ranked, unranked 1v1 and team tournaments).
 * - A team placement credits each current team member. Members replaced
 *   mid-tournament are moved out of the team (`team_id` changes and their
 *   status becomes `replaced`), so only `accepted` members on the team row are
 *   credited and the substitute receives the laurel instead.
 * - Player and team entries are mutually exclusive (CHECK on
 *   `tournament_entries`), so UNION ALL never counts one result twice for the
 *   same user.
 *
 * The aggregation runs on read: `tournament_results` holds only a few rows per
 * finished tournament, so no denormalized counters are kept in users_extension.
 * The string contains no placeholders, so it can be embedded in any query
 * without changing parameter order.
 */
export const TOURNAMENT_LAURELS_SUBQUERY = `
  SELECT podium.user_id,
         SUM(podium.placement = 1) AS tournaments_gold,
         SUM(podium.placement = 2) AS tournaments_silver,
         SUM(podium.placement = 3) AS tournaments_bronze
  FROM (
    SELECT participants.user_id, results.placement
    FROM tournament_results results
    JOIN tournaments finished ON finished.id = results.tournament_id AND finished.status = 'finished'
    JOIN tournament_entries entries ON entries.id = results.entry_id
    JOIN tournament_participants participants ON participants.id = entries.participant_id
    WHERE results.placement BETWEEN 1 AND 3
    UNION ALL
    SELECT members.user_id, results.placement
    FROM tournament_results results
    JOIN tournaments finished ON finished.id = results.tournament_id AND finished.status = 'finished'
    JOIN tournament_entries entries ON entries.id = results.entry_id
    JOIN tournament_participants members ON members.team_id = entries.team_id
      AND members.participation_status = 'accepted'
    WHERE results.placement BETWEEN 1 AND 3
  ) podium
  GROUP BY podium.user_id`;

/**
 * SELECT-list fragment exposing the laurel counts of a LEFT JOINed
 * TOURNAMENT_LAURELS_SUBQUERY aliased `laurels`; users without podiums get 0
 * instead of NULL so the frontend and sorting never deal with missing values.
 */
export const TOURNAMENT_LAURELS_COLUMNS = `
  COALESCE(laurels.tournaments_gold, 0) AS tournaments_gold,
  COALESCE(laurels.tournaments_silver, 0) AS tournaments_silver,
  COALESCE(laurels.tournaments_bronze, 0) AS tournaments_bronze`;

/** Sort expressions for the laurel columns, for the list endpoints' sort whitelists. */
export const TOURNAMENT_LAURELS_SORT_COLUMNS: Record<string, string> = {
  tournaments_gold: 'COALESCE(laurels.tournaments_gold, 0)',
  tournaments_silver: 'COALESCE(laurels.tournaments_silver, 0)',
  tournaments_bronze: 'COALESCE(laurels.tournaments_bronze, 0)',
};

export interface LatestFinishedTournament {
  id: string;
  name: string;
  tournament_mode: string | null;
  finished_at: string | null;
  winner: TournamentPlacement | null;
  runner_up: TournamentPlacement | null;
}

/**
 * Most recently finished tournaments with their champion and runner-up, for
 * the home page. Only tournaments with phase-engine results are returned so a
 * finished tournament never shows up without a podium.
 */
export async function getLatestFinishedTournaments(limit: number): Promise<LatestFinishedTournament[]> {
  const result = await query(
    `SELECT t.id, t.name, t.tournament_mode, t.finished_at
     FROM tournaments t
     WHERE t.status = 'finished'
       AND EXISTS (SELECT 1 FROM tournament_results results WHERE results.tournament_id = t.id)
     ORDER BY t.finished_at DESC, t.id ASC
     LIMIT ?`,
    [limit]
  );
  return Promise.all(result.rows.map(async (t: any) => {
    const { winner, runnerUp } = await getTournamentPlacements(t.id);
    return { ...t, winner, runner_up: runnerUp };
  }));
}
