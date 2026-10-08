/**
 * Row shapes of SELECT statements on the core tables (audit finding 12).
 *
 * Each type describes the columns a specific family of queries selects, not
 * the whole table, and is passed to `query<T>()`. A query that selects other
 * columns should declare its own type here rather than widen one of these
 * with optional fields. Nullability follows the schema: a column without
 * NOT NULL is typed `| null`. MariaDB returns TINYINT(1) as a number and
 * DATETIME as a Date (the pool is configured in UTC).
 */

/** `users_extension` rating columns, read and rewritten by the global recalculation. */
export interface UserRatingRow {
  id: string;
  is_blocked: number | null;
  elo_rating: number | null;
  matches_played: number | null;
  total_wins: number | null;
  total_losses: number | null;
  trend: string | null;
  level: string | null;
  is_rated: number | null;
  is_active: number | null;
  last_match_date: Date | null;
}

/** `matches` rating columns of a non-cancelled match, in replay order. */
export interface MatchRatingRow {
  id: string;
  winner_id: string;
  loser_id: string;
  created_at: Date;
  winner_elo_before: number | null;
  winner_elo_after: number | null;
  loser_elo_before: number | null;
  loser_elo_after: number | null;
  winner_level_before: string | null;
  winner_level_after: string | null;
  loser_level_before: string | null;
  loser_level_after: string | null;
  winner_ranking_pos: number | null;
  winner_ranking_change: number | null;
  loser_ranking_pos: number | null;
  loser_ranking_change: number | null;
  elo_change: number | null;
}

/**
 * A `tournament_games` row joined with its two `tournament_entries` (and, for
 * player entries, their `tournament_participants`). An entry is either one
 * participant or one team, so exactly one of each pair of identity columns is
 * set; the participant user ids are null for team entries.
 */
export interface TournamentGameEntriesRow {
  id: string;
  entry1_id: string;
  entry2_id: string;
  participant1_id: string | null;
  participant2_id: string | null;
  team1_id: string | null;
  team2_id: string | null;
  user1_id: string | null;
  user2_id: string | null;
}
