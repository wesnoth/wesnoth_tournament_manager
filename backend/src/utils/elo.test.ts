/**
 * Unit tests of the rating formulas (audit finding 13).
 *
 * The global recalculation replays every match through these functions, so
 * they define the whole rating history. The expected values are worked out
 * from the FIDE-style formulas documented in elo.ts, not taken from the code:
 * a change of formula (for example a move to Glicko-2) must fail here first.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateExpectedScore,
  calculateNewRating,
  calculateTrend,
  getKFactor,
  shouldPlayerBeRated,
} from './elo.js';

describe('calculateExpectedScore', () => {
  it('gives 0.5 between equal ratings', () => {
    assert.equal(calculateExpectedScore(1500, 1500), 0.5);
  });

  it('gives 1 / 1.1 to the player 400 points higher', () => {
    assert.ok(Math.abs(calculateExpectedScore(1900, 1500) - 1 / 1.1) < 1e-12);
  });

  it('is complementary for both players', () => {
    for (const [a, b] of [[1500, 1500], [1720, 1430], [2400, 1400]]) {
      assert.ok(Math.abs(calculateExpectedScore(a, b) + calculateExpectedScore(b, a) - 1) < 1e-12);
    }
  });
});

describe('getKFactor', () => {
  const cases: Array<[number | null, number, number]> = [
    [null, 0, 40], // unrated
    [0, 100, 40], // unrated, experience does not matter
    [1500, 29, 40], // fewer than 30 games
    [1500, 30, 24], // established below 2100
    [2099, 30, 24],
    [2100, 0, 16], // 2100–2399 regardless of games
    [2399, 500, 16],
    [2400, 0, 8], // elite
  ];
  for (const [rating, matches, expected] of cases) {
    it(`is ${expected} for rating ${rating} after ${matches} games`, () => {
      assert.equal(getKFactor(rating, matches), expected);
    });
  }
});

describe('calculateNewRating', () => {
  it('moves equal 1500 players by K/2 = 20 with K = 40', () => {
    assert.equal(calculateNewRating(1500, 1500, 'win', 0), 1520);
    assert.equal(calculateNewRating(1500, 1500, 'loss', 0), 1480);
    assert.equal(calculateNewRating(1500, 1500, 'draw', 0), 1500);
  });

  it('treats an unrated player as 1400', () => {
    // E(1400 vs 1500) = 1 / (1 + 10^0.25) ≈ 0.35994; 1400 + 40 · 0.64006 ≈ 1425.6
    assert.equal(calculateNewRating(null, 1500, 'win', 0), 1426);
  });

  it('applies K = 8 to an elite player losing to a weaker one', () => {
    // E(2400 vs 2000) = 1 / 1.1 ≈ 0.90909; 2400 − 8 · 0.90909 ≈ 2392.7
    assert.equal(calculateNewRating(2400, 2000, 'loss', 100), 2393);
  });

  it('applies K = 24 to an established player', () => {
    // E(1600 vs 1600) = 0.5; 1600 + 24 · 0.5
    assert.equal(calculateNewRating(1600, 1600, 'win', 30), 1612);
  });
});

describe('shouldPlayerBeRated', () => {
  it('needs 10 games and at least 1400', () => {
    assert.equal(shouldPlayerBeRated(10, 1400), true);
    assert.equal(shouldPlayerBeRated(9, 1800), false);
    assert.equal(shouldPlayerBeRated(10, 1399), false);
  });
});

describe('calculateTrend', () => {
  const cases: Array<[string, boolean, string]> = [
    ['-', true, '+1'],
    ['-', false, '-1'],
    ['+2', true, '+3'],
    ['+2', false, '-1'],
    ['-3', false, '-4'],
    ['-3', true, '+1'],
    ['', true, '+1'],
  ];
  for (const [current, isWin, expected] of cases) {
    it(`turns '${current}' into '${expected}' after a ${isWin ? 'win' : 'loss'}`, () => {
      assert.equal(calculateTrend(current, isWin), expected);
    });
  }
});
