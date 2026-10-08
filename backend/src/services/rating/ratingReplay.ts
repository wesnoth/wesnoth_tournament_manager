import { calculateTrend, shouldPlayerBeRated } from '../../utils/elo.js';
import { getUserLevel, type PlayerLevel } from '../../utils/auth.js';
import type { RatingModel } from './ratingModel.js';

/** A player known before the replay starts (a `users_extension` row). */
export interface ReplayUser {
  id: string;
  /** Blocked players keep their history but take no place in the ranking. */
  isBlocked: boolean;
}

/** A non-cancelled match, in the order it must be replayed. */
export interface ReplayMatch {
  id: string;
  winnerId: string;
  loserId: string;
  playedAt: Date;
}

/** The rating columns of one `matches` row, as the replay rewrites them. */
export interface MatchRatingUpdate {
  matchId: string;
  winnerRatingBefore: number;
  winnerRatingAfter: number;
  loserRatingBefore: number;
  loserRatingAfter: number;
  winnerLevelBefore: PlayerLevel;
  winnerLevelAfter: PlayerLevel;
  loserLevelBefore: PlayerLevel;
  loserLevelAfter: PlayerLevel;
  /** Global position after the game (both players already at their new rating). */
  winnerRankingPos: number;
  /** Positions gained: position before minus position after. */
  winnerRankingChange: number;
  loserRankingPos: number;
  loserRankingChange: number;
  /** Winner's rating change, stored as `matches.elo_change`. */
  ratingChange: number;
}

/** The rating columns of one `users_extension` row after the whole replay. */
export interface UserRatingResult {
  userId: string;
  rating: number;
  matchesPlayed: number;
  totalWins: number;
  totalLosses: number;
  /** Current streak: `+N`, `-N`, or `-` without games. */
  trend: string;
  level: PlayerLevel;
  isRated: boolean;
  /** Played within the activity window before `now`. */
  isActive: boolean;
  lastMatchDate: Date | null;
}

export interface RatingReplayResult {
  matches: MatchRatingUpdate[];
  users: UserRatingResult[];
}

/** Days without games after which a player counts as inactive. */
export const ACTIVITY_WINDOW_DAYS = 30;

interface RankingEntry {
  id: string;
  rating: number;
}

/**
 * Ranking order: higher rating first; equal ratings by ascending user id
 * (JavaScript code-unit order, which for lowercase UUIDs is the same as the
 * database order used by match creation). Ids are unique, so the order is
 * total and an entry's position is well defined.
 */
function compareRanking(a: RankingEntry, b: RankingEntry): number {
  if (a.rating !== b.rating) return b.rating - a.rating;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The global ranking during the replay, kept sorted at all times.
 *
 * The previous implementation counted, for every position it needed, all
 * players ranked above (four full scans per match, so matches × users). Here
 * the position is a binary search, and a rating change moves one entry (a
 * binary search plus an array splice, which is a memory move). Positions are
 * identical to the scan: 1 + ranked players ordered before the queried
 * (rating, id) pair, never counting the queried player.
 */
class SortedRanking {
  private readonly entries: RankingEntry[] = [];

  /** Index of the first entry that does not sort before `key`. */
  private lowerBound(key: RankingEntry): number {
    let low = 0;
    let high = this.entries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compareRanking(this.entries[middle], key) < 0) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  insert(id: string, rating: number): void {
    const entry = { id, rating };
    this.entries.splice(this.lowerBound(entry), 0, entry);
  }

  /** Move a ranked player from `oldRating` to `newRating`. */
  move(id: string, oldRating: number, newRating: number): void {
    if (oldRating === newRating) return;
    const index = this.lowerBound({ id, rating: oldRating });
    const current = this.entries[index];
    if (!current || current.id !== id) {
      throw new Error(`Ranking entry for ${id} at rating ${oldRating} not found`);
    }
    this.entries.splice(index, 1);
    this.insert(id, newRating);
  }

  /**
   * Position of `id` at `rating`. The player's own entry, if any, is equal to
   * the key (ids are unique) and therefore never counted, so the same call
   * works for ranked players, blocked players, and hypothetical ratings.
   */
  position(id: string, rating: number): number {
    return this.lowerBound({ id, rating }) + 1;
  }
}

interface PlayerReplayState<S> {
  rating: S;
  ranked: boolean;
  matchesPlayed: number;
  totalWins: number;
  totalLosses: number;
  trend: string;
  level: PlayerLevel;
  lastMatchDate: Date | null;
}

/**
 * Replay a complete match history through a rating model, without any
 * database access (audit finding 10).
 *
 * Invariants, all inherited from the original route implementation so that a
 * replay of an unchanged history reproduces the stored values:
 * - Every player starts from the model's initial state, with level `novice`
 *   until their first game (not the level of the initial rating).
 * - The ranking contains every non-blocked player from the start, including
 *   players who have not played yet. A player found only in matches (no
 *   `users_extension` row) joins the ranking when first seen.
 * - "Before" positions use both players' ratings before the game; "after"
 *   positions are taken once both players hold their new rating.
 * - Matches are replayed in the given order; the caller sorts them.
 *
 * @param now - reference time for `isActive`; a parameter so results are
 *   reproducible in tests.
 */
export function replayRatings<S>(
  model: RatingModel<S>,
  users: ReplayUser[],
  matches: ReplayMatch[],
  now: Date
): RatingReplayResult {
  const ranking = new SortedRanking();
  const players = new Map<string, PlayerReplayState<S>>();

  const addPlayer = (id: string, ranked: boolean): PlayerReplayState<S> => {
    const state: PlayerReplayState<S> = {
      rating: model.initialState(),
      ranked,
      matchesPlayed: 0,
      totalWins: 0,
      totalLosses: 0,
      trend: '-',
      level: 'novice',
      lastMatchDate: null,
    };
    players.set(id, state);
    if (ranked) ranking.insert(id, model.displayRating(state.rating));
    return state;
  };

  for (const user of users) addPlayer(user.id, !user.isBlocked);

  const matchUpdates: MatchRatingUpdate[] = [];
  for (const match of matches) {
    const winner = players.get(match.winnerId) ?? addPlayer(match.winnerId, true);
    const loser = players.get(match.loserId) ?? addPlayer(match.loserId, true);

    const winnerBefore = model.displayRating(winner.rating);
    const loserBefore = model.displayRating(loser.rating);
    const winnerPosBefore = ranking.position(match.winnerId, winnerBefore);
    const loserPosBefore = ranking.position(match.loserId, loserBefore);

    const next = model.applyResult(winner.rating, loser.rating, { playedAt: match.playedAt });
    winner.rating = next.winner;
    loser.rating = next.loser;
    const winnerAfter = model.displayRating(winner.rating);
    const loserAfter = model.displayRating(loser.rating);
    if (winner.ranked) ranking.move(match.winnerId, winnerBefore, winnerAfter);
    if (loser.ranked) ranking.move(match.loserId, loserBefore, loserAfter);

    winner.matchesPlayed += 1;
    loser.matchesPlayed += 1;
    winner.totalWins += 1;
    loser.totalLosses += 1;
    winner.trend = calculateTrend(winner.trend, true);
    loser.trend = calculateTrend(loser.trend, false);
    winner.level = getUserLevel(winnerAfter);
    loser.level = getUserLevel(loserAfter);
    winner.lastMatchDate = match.playedAt;
    loser.lastMatchDate = match.playedAt;

    const winnerPosAfter = ranking.position(match.winnerId, winnerAfter);
    const loserPosAfter = ranking.position(match.loserId, loserAfter);
    matchUpdates.push({
      matchId: match.id,
      winnerRatingBefore: winnerBefore,
      winnerRatingAfter: winnerAfter,
      loserRatingBefore: loserBefore,
      loserRatingAfter: loserAfter,
      winnerLevelBefore: getUserLevel(winnerBefore),
      winnerLevelAfter: winner.level,
      loserLevelBefore: getUserLevel(loserBefore),
      loserLevelAfter: loser.level,
      winnerRankingPos: winnerPosAfter,
      winnerRankingChange: winnerPosBefore - winnerPosAfter,
      loserRankingPos: loserPosAfter,
      loserRankingChange: loserPosBefore - loserPosAfter,
      ratingChange: winnerAfter - winnerBefore,
    });
  }

  const activeSince = now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const userResults: UserRatingResult[] = [];
  for (const [userId, state] of players) {
    const rating = model.displayRating(state.rating);
    userResults.push({
      userId,
      rating,
      matchesPlayed: state.matchesPlayed,
      totalWins: state.totalWins,
      totalLosses: state.totalLosses,
      trend: state.trend,
      level: state.level,
      // Rebuilt from the replayed history rather than preserved, so
      // cancellations and imported data follow the eligibility rule.
      isRated: shouldPlayerBeRated(state.matchesPlayed, rating),
      isActive: state.lastMatchDate !== null && state.lastMatchDate.getTime() >= activeSince,
      lastMatchDate: state.lastMatchDate,
    });
  }

  return { matches: matchUpdates, users: userResults };
}
