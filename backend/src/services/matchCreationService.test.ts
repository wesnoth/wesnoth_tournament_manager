/**
 * Unit tests of the rated-status rule applied after every match
 * (audit finding 13). Importing the service does not touch the database: the
 * pool connects lazily and resolveRated is pure.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRated } from './matchCreationService.js';

describe('resolveRated', () => {
  it('rates an unrated player at 10 matches with at least 1400', () => {
    assert.equal(resolveRated(false, 1400, 10), true);
  });

  it('keeps an unrated player unrated before 10 matches or below 1400', () => {
    assert.equal(resolveRated(false, 1800, 9), false);
    assert.equal(resolveRated(false, 1399, 25), false);
  });

  it('unrates a rated player who drops below 1400', () => {
    assert.equal(resolveRated(true, 1399, 40), false);
  });

  it('keeps a rated player rated at 1400 or more', () => {
    assert.equal(resolveRated(true, 1400, 40), true);
  });
});
