/**
 * Unit tests of the Swiss pairing and OMP rules (FIDE Dutch first round,
 * no repeated byes, byes excluded from opponent percentages).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSwissFirstRoundPairs, opponentMatchPercentage, selectSwissByeEntry } from './pairingAlgorithms.js';

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
