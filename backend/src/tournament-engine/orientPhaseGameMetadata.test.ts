/**
 * Unit tests of the organizer-resolution metadata orientation.
 *
 * An organizer may award a confidence-one replay to either entry, so the
 * stored factions and winner side must follow the chosen winner rather than
 * the replay's own victory claim.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { orientPhaseGameMetadata, phaseGameDisplayMetadata } from './competitionProgression.js';

const summary = {
  forumMap: '2p — Scarred Foothills',
  forumPlayers: [
    { user_name: 'Konrad2', side_number: 1 },
    { user_name: 'Gabbek', side_number: 2 },
  ],
  forumFactions: { side1: 'Balanced Dunefolk', side2: 'Balanced Northerners' },
  replayVictory: { winner_side: 1, winner_name: 'Konrad2', loser_name: 'Gabbek' },
};

describe('orientPhaseGameMetadata', () => {
  const metadata = phaseGameDisplayMetadata(summary);

  it('keeps the replay orientation when the organizer confirms the replay winner', () => {
    assert.deepEqual(orientPhaseGameMetadata(metadata, 'konrad-entry', 'konrad-entry'), {
      map: '2p — Scarred Foothills',
      winnerFaction: 'Balanced Dunefolk',
      loserFaction: 'Balanced Northerners',
      winnerSide: 1,
    });
  });

  it('swaps factions and side when the organizer awards the replay loser', () => {
    assert.deepEqual(orientPhaseGameMetadata(metadata, 'konrad-entry', 'gabbek-entry'), {
      map: '2p — Scarred Foothills',
      winnerFaction: 'Balanced Northerners',
      loserFaction: 'Balanced Dunefolk',
      winnerSide: 2,
    });
  });

  it('keeps only the map when the replay winner entry is unknown', () => {
    assert.deepEqual(orientPhaseGameMetadata(metadata, null, 'gabbek-entry'), {
      map: '2p — Scarred Foothills',
      winnerFaction: null,
      loserFaction: null,
      winnerSide: null,
    });
  });

  it('leaves the side empty for team games', () => {
    const team = { ...metadata, winnerSide: null };
    assert.equal(orientPhaseGameMetadata(team, 'a', 'b').winnerSide, null);
  });
});
