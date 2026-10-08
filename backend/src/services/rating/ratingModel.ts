import { calculateNewRating } from '../../utils/elo.js';

/**
 * A rating model: how one game result changes the two players' ratings.
 *
 * The global recalculation replays every non-cancelled match through the
 * active model (full-replay principle), so switching to another model (for
 * example Glicko-2) rewrites the whole history with the new formula instead of
 * converting stored ratings. A model only owns the rating arithmetic; match
 * counting, streaks, levels, rated status, and ranking positions are the same
 * for every model and live in the replay core.
 *
 * @typeParam S - per-player rating state. It must be treated as immutable:
 *   `applyResult` returns new states. Elo needs the rating and the number of
 *   games already played (for the K-factor); Glicko-2 would add the rating
 *   deviation and volatility, which would also need their own columns.
 */
export interface RatingModel<S> {
  /** Stable identifier, for logs and job results. */
  readonly id: string;
  /** State of a player who has not played any game yet. */
  initialState(): S;
  /**
   * New states of both players after `winner` beat `loser`. Both results are
   * computed from the states before the game, so the order of the two players
   * never influences the outcome.
   */
  applyResult(winner: S, loser: S, context: { playedAt: Date }): { winner: S; loser: S };
  /**
   * The single number stored in `elo_rating`, shown to users, used for the
   * level, and used to order the global ranking.
   */
  displayRating(state: S): number;
}

/** Elo state: the rating and the number of games already played. */
export interface EloState {
  rating: number;
  matchesPlayed: number;
}

/** Baseline rating of a player without games (FIDE-style floor). */
export const ELO_BASELINE_RATING = 1400;

/**
 * FIDE-style Elo as implemented in `utils/elo.ts`: K depends on the rating
 * and on the games played before this one, and every new rating is rounded
 * to an integer. Integer ratings make ties common, which the ranking breaks
 * by user id.
 */
export const eloFideModel: RatingModel<EloState> = {
  id: 'elo-fide',
  initialState: () => ({ rating: ELO_BASELINE_RATING, matchesPlayed: 0 }),
  applyResult(winner, loser) {
    return {
      winner: {
        rating: calculateNewRating(winner.rating, loser.rating, 'win', winner.matchesPlayed),
        matchesPlayed: winner.matchesPlayed + 1,
      },
      loser: {
        rating: calculateNewRating(loser.rating, winner.rating, 'loss', loser.matchesPlayed),
        matchesPlayed: loser.matchesPlayed + 1,
      },
    };
  },
  displayRating: (state) => state.rating,
};

/** The model used by match creation and the global recalculation. */
export const activeRatingModel = eloFideModel;
