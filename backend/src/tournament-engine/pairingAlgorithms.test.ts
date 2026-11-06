/**
 * Unit tests of the Swiss pairing and OMP rules (FIDE Dutch first round,
 * no repeated byes, byes excluded from opponent percentages).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSwissFirstRoundPairs, eliminationRoundsToPlay, opponentMatchPercentage, orderEliminationStandings, selectSwissByeEntry,
} from './pairingAlgorithms.js';

describe('buildSwissFirstRoundPairs', () => {
  it('pairs the top half against the bottom half', () => {
    assert.deepEqual(buildSwissFirstRoundPairs(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']), {
      pairs: [['s1', 's5'], ['s2', 's6'], ['s3', 's7'], ['s4', 's8']],
      byeEntryId: null,
    });
  });

  it('gives the bye of an odd field to the lowest seed and splits the rest', () => {
    assert.deepEqual(buildSwissFirstRoundPairs(['s1', 's2', 's3', 's4', 's5']), {
      pairs: [['s1', 's3'], ['s2', 's4']],
      byeEntryId: 's5',
    });
  });

  it('handles the smallest fields', () => {
    assert.deepEqual(buildSwissFirstRoundPairs(['s1', 's2']), { pairs: [['s1', 's2']], byeEntryId: null });
    assert.deepEqual(buildSwissFirstRoundPairs(['s1', 's2', 's3']), { pairs: [['s1', 's2']], byeEntryId: 's3' });
  });
});

describe('selectSwissByeEntry', () => {
  it('returns null for an even field', () => {
    assert.equal(selectSwissByeEntry(['a', 'b', 'c', 'd'], new Set()), null);
  });

  it('gives the bye to the lowest-ranked entry', () => {
    assert.equal(selectSwissByeEntry(['a', 'b', 'c'], new Set()), 'c');
  });

  it('skips entries that already had a bye', () => {
    assert.equal(selectSwissByeEntry(['a', 'b', 'c', 'd', 'e'], new Set(['e'])), 'd');
    assert.equal(selectSwissByeEntry(['a', 'b', 'c', 'd', 'e'], new Set(['e', 'd', 'c'])), 'b');
  });

  it('repeats a bye only when every entry already had one, again for the lowest-ranked', () => {
    assert.equal(selectSwissByeEntry(['a', 'b', 'c'], new Set(['a', 'b', 'c'])), 'c');
  });
});

describe('opponentMatchPercentage', () => {
  it('measures played series only', () => {
    assert.equal(opponentMatchPercentage(3, 0, 3), 100);
    assert.equal(opponentMatchPercentage(1, 0, 4), 25);
  });

  it('removes bye points so an opponent with a bye cannot exceed 100%', () => {
    // A bye plus two wins: 3 points from 2 played series.
    assert.equal(opponentMatchPercentage(3, 1, 2), 100);
    // A bye, one win and one loss.
    assert.equal(opponentMatchPercentage(2, 1, 2), 50);
  });

  it('returns zero without played series', () => {
    assert.equal(opponentMatchPercentage(1, 1, 0), 0);
    assert.equal(opponentMatchPercentage(0, 0, 0), 0);
  });
});

describe('eliminationRoundsToPlay', () => {
  it('plays the whole bracket when it decides a champion', () => {
    assert.equal(eliminationRoundsToPlay(8, null), 3);
    assert.equal(eliminationRoundsToPlay(8, 1), 3);
  });

  it('stops once only the qualifiers survive', () => {
    assert.equal(eliminationRoundsToPlay(8, 4), 1);
    assert.equal(eliminationRoundsToPlay(8, 2), 2);
    assert.equal(eliminationRoundsToPlay(4, 2), 1);
  });

  it('rounds an unvalidated qualifier count up to the next survivor tier', () => {
    assert.equal(eliminationRoundsToPlay(8, 3), 1);
  });

  it('keeps the full bracket when the qualifiers would fill it', () => {
    assert.equal(eliminationRoundsToPlay(4, 4), 2);
  });
});

describe('orderEliminationStandings', () => {
  // Rows arrive in points-and-tiebreaker order, as rankGroup reads them.
  const entries = [{ entry_id: 'e1' }, { entry_id: 'e2' }, { entry_id: 'e3' }, { entry_id: 'e4' }];

  it('ranks the survivors of a cut bracket first, keeping the tiebreaker order', () => {
    // Semifinals only: e4 beat e1, e2 beat e3.
    const ranked = orderEliminationStandings(entries, [
      { round_number: 1, series_role: 'main', loser_entry_id: 'e1' },
      { round_number: 1, series_role: 'main', loser_entry_id: 'e3' },
    ]).map(row => row.entry_id);
    assert.deepEqual(ranked, ['e2', 'e4', 'e1', 'e3']);
  });

  it('ranks later eliminations above earlier ones', () => {
    const ranked = orderEliminationStandings(entries, [
      { round_number: 1, series_role: 'main', loser_entry_id: 'e1' },
      { round_number: 1, series_role: 'main', loser_entry_id: 'e3' },
      { round_number: 2, series_role: 'main', loser_entry_id: 'e2' },
    ]).map(row => row.entry_id);
    assert.deepEqual(ranked, ['e4', 'e2', 'e1', 'e3']);
  });

  it('ranks a bye survivor above an entry eliminated later with more points', () => {
    // e1 had a structural bye and won nothing yet; e3 won a round, then lost.
    const ranked = orderEliminationStandings(
      [{ entry_id: 'e3' }, { entry_id: 'e1' }],
      [{ round_number: 2, series_role: 'main', loser_entry_id: 'e3' }],
    ).map(row => row.entry_id);
    assert.deepEqual(ranked, ['e1', 'e3']);
  });

  it('ignores the third-place series', () => {
    const ranked = orderEliminationStandings(entries, [
      { round_number: 1, series_role: 'main', loser_entry_id: 'e3' },
      { round_number: 1, series_role: 'main', loser_entry_id: 'e4' },
      { round_number: 2, series_role: 'third_place', loser_entry_id: 'e3' },
    ]).map(row => row.entry_id);
    assert.deepEqual(ranked, ['e1', 'e2', 'e3', 'e4']);
  });
});
