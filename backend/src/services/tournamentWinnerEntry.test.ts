/**
 * Unit tests of the winner-to-entry mapping shared by every tournament
 * integration path (audit finding 10).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { opponentEntryId, resolveWinnerEntryId } from './tournamentWinnerEntry.js';

const playerGame = {
  entry1Id: 'e1', entry2Id: 'e2',
  entry1UserId: 'u1', entry2UserId: 'u2',
  entry1ParticipantId: 'p1', entry2ParticipantId: 'p2',
  entry1TeamId: null, entry2TeamId: null,
};

const teamGame = {
  entry1Id: 'e1', entry2Id: 'e2',
  entry1UserId: null, entry2UserId: null,
  entry1ParticipantId: null, entry2ParticipantId: null,
  entry1TeamId: 't1', entry2TeamId: 't2',
};

describe('resolveWinnerEntryId', () => {
  it('maps a 1v1 winner by user or by participant', () => {
    assert.equal(resolveWinnerEntryId(playerGame, { userId: 'u2' }), 'e2');
    assert.equal(resolveWinnerEntryId(playerGame, { participantId: 'p1' }), 'e1');
  });

  it('maps a team game winner by team', () => {
    assert.equal(resolveWinnerEntryId(teamGame, { teamId: 't2' }), 'e2');
    // A team member's participant row carries the team id.
    assert.equal(resolveWinnerEntryId(teamGame, { participantId: 'p9', teamId: 't1' }), 'e1');
  });

  it('never matches through missing identities', () => {
    // Team entries have no participant: a winner without a team must not
    // match them through null == null.
    assert.equal(resolveWinnerEntryId(teamGame, { participantId: null, teamId: null }), null);
    assert.equal(resolveWinnerEntryId(playerGame, {}), null);
  });

  it('rejects a winner outside the game', () => {
    assert.equal(resolveWinnerEntryId(playerGame, { userId: 'u3' }), null);
    assert.equal(resolveWinnerEntryId(teamGame, { teamId: 't3' }), null);
  });

  it('rejects a winner found in both entries', () => {
    assert.equal(resolveWinnerEntryId(playerGame, { userId: 'u1', participantId: 'p2' }), null);
  });
});

describe('opponentEntryId', () => {
  it('returns the other entry', () => {
    assert.equal(opponentEntryId(playerGame, 'e1'), 'e2');
    assert.equal(opponentEntryId(playerGame, 'e2'), 'e1');
    assert.equal(opponentEntryId(playerGame, 'e3'), null);
  });
});
