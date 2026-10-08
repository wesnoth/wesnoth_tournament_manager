/**
 * Unit tests of the rating replay core (audit finding 10).
 *
 * `naiveReplay` below is the algorithm the global recalculation used before
 * the core was extracted (routes/matches.ts, 2026-10-08), with its ranking
 * scan over every player. The core must reproduce it exactly on random
 * histories: the stored history was produced by that algorithm, and the
 * extraction must not rewrite it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateNewRating, calculateTrend, shouldPlayerBeRated } from '../../utils/elo.js';
import { getUserLevel } from '../../utils/auth.js';
import { eloFideModel, type RatingModel } from './ratingModel.js';
import { replayRatings, type ReplayMatch, type ReplayUser } from './ratingReplay.js';

const NOW = new Date('2026-10-08T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function naiveReplay(users: ReplayUser[], matches: ReplayMatch[], now: Date) {
  type State = {
    elo: number; ranked: boolean; played: number; wins: number; losses: number;
    trend: string; level: string; last: Date | null;
  };
  const states = new Map<string, State>();
  const fresh = (ranked: boolean): State =>
    ({ elo: 1400, ranked, played: 0, wins: 0, losses: 0, trend: '-', level: 'novice', last: null });
  for (const user of users) states.set(user.id, fresh(!user.isBlocked));

  const position = (playerId: string, elo: number) =>
    1 + Array.from(states.entries()).filter(([otherId, other]) =>
      other.ranked && otherId !== playerId && (other.elo > elo || (other.elo === elo && otherId < playerId))
    ).length;

  const matchRows = matches.map((match) => {
    if (!states.has(match.winnerId)) states.set(match.winnerId, fresh(true));
    if (!states.has(match.loserId)) states.set(match.loserId, fresh(true));
    const winner = states.get(match.winnerId)!;
    const loser = states.get(match.loserId)!;
    const winnerBefore = winner.elo;
    const loserBefore = loser.elo;
    const winnerPosBefore = position(match.winnerId, winnerBefore);
    const loserPosBefore = position(match.loserId, loserBefore);
    const winnerAfter = calculateNewRating(winner.elo, loser.elo, 'win', winner.played);
    const loserAfter = calculateNewRating(loser.elo, winner.elo, 'loss', loser.played);
    winner.elo = winnerAfter;
    loser.elo = loserAfter;
    winner.last = match.playedAt;
    loser.last = match.playedAt;
    winner.played++;
    loser.played++;
    winner.wins++;
    loser.losses++;
    winner.trend = calculateTrend(winner.trend, true);
    loser.trend = calculateTrend(loser.trend, false);
    winner.level = getUserLevel(winnerAfter);
    loser.level = getUserLevel(loserAfter);
    const winnerPosAfter = position(match.winnerId, winnerAfter);
    const loserPosAfter = position(match.loserId, loserAfter);
    return {
      matchId: match.id,
      winnerRatingBefore: winnerBefore,
      winnerRatingAfter: winnerAfter,
      loserRatingBefore: loserBefore,
      loserRatingAfter: loserAfter,
      winnerLevelBefore: getUserLevel(winnerBefore),
      winnerLevelAfter: getUserLevel(winnerAfter),
      loserLevelBefore: getUserLevel(loserBefore),
      loserLevelAfter: getUserLevel(loserAfter),
      winnerRankingPos: winnerPosAfter,
      winnerRankingChange: winnerPosBefore - winnerPosAfter,
      loserRankingPos: loserPosAfter,
      loserRankingChange: loserPosBefore - loserPosAfter,
      ratingChange: winnerAfter - winnerBefore,
    };
  });

  const userRows = Array.from(states.entries()).map(([userId, s]) => ({
    userId,
    rating: s.elo,
    matchesPlayed: s.played,
    totalWins: s.wins,
    totalLosses: s.losses,
    trend: s.trend,
    level: s.level,
    isRated: shouldPlayerBeRated(s.played, s.elo),
    isActive: s.last !== null && s.last >= new Date(now.getTime() - 30 * DAY),
    lastMatchDate: s.last,
  }));
  return { matches: matchRows, users: userRows };
}

/** Deterministic pseudo-random generator (mulberry32), so failures reproduce. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** UUID-like ids in shuffled order, so id order and creation order differ. */
function randomHistory(seed: number, userCount: number, matchCount: number) {
  const next = random(seed);
  const hex = () => Math.floor(next() * 0xffffffff).toString(16).padStart(8, '0');
  const users: ReplayUser[] = Array.from({ length: userCount }, () => ({
    id: `${hex()}-0000-4000-8000-${hex()}0000`,
    isBlocked: next() < 0.1,
  }));
  // A few players who exist only in matches.
  const ghosts = ['ffffffff-ghost-a', '00000000-ghost-b'];
  const pool = [...users.map((user) => user.id), ...ghosts];
  // A small pool of regulars makes rematches and K-factor changes frequent.
  const regulars = pool.slice(0, Math.max(4, Math.floor(pool.length / 3)));
  const start = NOW.getTime() - 400 * DAY;
  const matches: ReplayMatch[] = Array.from({ length: matchCount }, (_, index) => {
    const source = next() < 0.7 ? regulars : pool;
    const winnerId = source[Math.floor(next() * source.length)];
    let loserId = winnerId;
    while (loserId === winnerId) loserId = source[Math.floor(next() * source.length)];
    return { id: `match-${index}`, winnerId, loserId, playedAt: new Date(start + index * (400 * DAY / matchCount)) };
  });
  return { users, matches };
}

describe('replayRatings with the FIDE Elo model', () => {
  it('reproduces the previous recalculation exactly on random histories', () => {
    for (const [seed, userCount, matchCount] of [[1, 6, 40], [2, 25, 400], [3, 60, 1500], [4, 3, 200]]) {
      const { users, matches } = randomHistory(seed, userCount, matchCount);
      const expected = naiveReplay(users, matches, NOW);
      const actual = replayRatings(eloFideModel, users, matches, NOW);
      assert.deepEqual(actual, expected, `seed ${seed}`);
    }
  });

  it('breaks rating ties by user id', () => {
    // Everyone at 1400: after one game, the loser of a's game sits among the
    // untouched 1400 players ordered by id.
    const users = ['b', 'a', 'd', 'c'].map((id) => ({ id, isBlocked: false }));
    const { matches } = replayRatings(eloFideModel, users, [
      { id: 'm1', winnerId: 'c', loserId: 'b', playedAt: NOW },
    ], NOW);
    // c: 1420, first. b: 1380, last. Before the game b was second (behind a).
    assert.equal(matches[0].winnerRankingPos, 1);
    assert.equal(matches[0].winnerRankingChange, 2);
    assert.equal(matches[0].loserRankingPos, 4);
    assert.equal(matches[0].loserRankingChange, -2);
  });

  it('keeps blocked players out of everyone else\'s positions but still ranks them', () => {
    const users = [
      { id: 'a', isBlocked: false },
      { id: 'b', isBlocked: true },
      { id: 'c', isBlocked: false },
    ];
    const { matches } = replayRatings(eloFideModel, users, [
      { id: 'm1', winnerId: 'b', loserId: 'c', playedAt: NOW },
      { id: 'm2', winnerId: 'c', loserId: 'a', playedAt: NOW },
    ], NOW);
    // b (blocked, 1420) is placed above everyone, but nobody counts b.
    assert.equal(matches[0].winnerRankingPos, 1);
    assert.equal(matches[1].winnerRankingPos, 1);
  });

  it('leaves players without games at novice, unrated and inactive', () => {
    const { users } = replayRatings(eloFideModel, [{ id: 'idle', isBlocked: false }], [], NOW);
    assert.deepEqual(users, [{
      userId: 'idle', rating: 1400, matchesPlayed: 0, totalWins: 0, totalLosses: 0,
      trend: '-', level: 'novice', isRated: false, isActive: false, lastMatchDate: null,
    }]);
  });

  it('marks a player active only within the last 30 days', () => {
    const users = [{ id: 'a', isBlocked: false }, { id: 'b', isBlocked: false }];
    const result = replayRatings(eloFideModel, users, [
      { id: 'old', winnerId: 'a', loserId: 'b', playedAt: new Date(NOW.getTime() - 31 * DAY) },
    ], NOW);
    assert.deepEqual(result.users.map((user) => user.isActive), [false, false]);
    const recent = replayRatings(eloFideModel, users, [
      { id: 'new', winnerId: 'a', loserId: 'b', playedAt: new Date(NOW.getTime() - 29 * DAY) },
    ], NOW);
    assert.deepEqual(recent.users.map((user) => user.isActive), [true, true]);
  });
});

describe('replayRatings with another model', () => {
  it('ranks and stores whatever the model reports as display rating', () => {
    // A trivial model with non-integer ratings, standing in for Glicko-2.
    const plusMinus: RatingModel<{ value: number }> = {
      id: 'test-plus-minus',
      initialState: () => ({ value: 1500 }),
      applyResult: (winner, loser) => ({ winner: { value: winner.value + 10.5 }, loser: { value: loser.value - 10.5 } }),
      displayRating: (state) => state.value,
    };
    const users = ['a', 'b', 'c'].map((id) => ({ id, isBlocked: false }));
    const result = replayRatings(plusMinus, users, [
      { id: 'm1', winnerId: 'c', loserId: 'a', playedAt: NOW },
    ], NOW);
    assert.equal(result.matches[0].winnerRatingAfter, 1510.5);
    assert.equal(result.matches[0].ratingChange, 10.5);
    assert.equal(result.matches[0].winnerRankingPos, 1);
    assert.equal(result.matches[0].loserRankingPos, 3);
    assert.equal(result.users.find((user) => user.userId === 'c')!.level, 'initiated');
  });
});
