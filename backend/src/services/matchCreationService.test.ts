/**
 * Unit tests of the rated-status and ranking-position rules applied after
 * every match (audit findings 13 and 10). Importing the service does not
 * touch the database: the pool connects lazily, resolveRated is pure, and the
 * ranking query is faked.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getRankingPositionAfterGame, resolveRated } from './matchCreationService.js';

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

describe('getRankingPositionAfterGame', () => {
  // The stored-row count (everyone except the two players) is faked; the
  // function adds the opponent at its new rating and the player itself.
  const othersAhead = (count: number) => async () => ({ rows: [{ higher_count: count }] });

  it('counts the opponent when its new rating is higher', async () => {
    assert.equal(await getRankingPositionAfterGame(othersAhead(3),
      { id: 'b', rating: 1500 }, { id: 'a', rating: 1510, isBlocked: false }), 5);
  });

  it('breaks an equal new rating by id', async () => {
    assert.equal(await getRankingPositionAfterGame(othersAhead(0),
      { id: 'b', rating: 1500 }, { id: 'a', rating: 1500, isBlocked: false }), 2);
    assert.equal(await getRankingPositionAfterGame(othersAhead(0),
      { id: 'a', rating: 1500 }, { id: 'b', rating: 1500, isBlocked: false }), 1);
  });

  it('ignores a lower or blocked opponent', async () => {
    assert.equal(await getRankingPositionAfterGame(othersAhead(2),
      { id: 'b', rating: 1500 }, { id: 'a', rating: 1490, isBlocked: false }), 3);
    assert.equal(await getRankingPositionAfterGame(othersAhead(2),
      { id: 'b', rating: 1500 }, { id: 'a', rating: 1600, isBlocked: true }), 3);
  });
});
