/**
 * Unit tests of the player level bands shown with ratings (audit finding 13).
 * Each band starts at its lower bound, so the boundaries are tested on both
 * sides. Levels are English identifiers; the frontend translates them.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getUserLevel } from './auth.js';

describe('getUserLevel', () => {
  const cases: Array<[number, string]> = [
    [0, 'novice'],
    [1399, 'novice'],
    [1400, 'initiated'],
    [1599, 'initiated'],
    [1600, 'veteran'],
    [1799, 'veteran'],
    [1800, 'expert'],
    [1999, 'expert'],
    [2000, 'master'],
    [2600, 'master'],
  ];
  for (const [rating, level] of cases) {
    it(`is ${level} at ${rating}`, () => {
      assert.equal(getUserLevel(rating), level);
    });
  }
});
