/**
 * Unit tests of the replay picker player matching (issue #6). The picker must
 * only offer server games played by exactly the players or teams of the
 * pending tournament game.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesTournamentGamePlayers, type ExpectedReplayPlayer } from './replayCandidateMatch.js';

const duel = { isTeamGame: false, user1Id: 'u1', user2Id: 'u2', team1Id: null, team2Id: null };
const duelPlayers = new Map<string, ExpectedReplayPlayer>([
  ['alice', { userId: 'u1', teamId: null }],
  ['bob', { userId: 'u2', teamId: null }],
]);

const teams = { isTeamGame: true, user1Id: null, user2Id: null, team1Id: 't1', team2Id: 't2' };
const teamPlayers = new Map<string, ExpectedReplayPlayer>([
  ['alice', { userId: 'u1', teamId: 't1' }],
  ['carol', { userId: 'u3', teamId: 't1' }],
  ['bob', { userId: 'u2', teamId: 't2' }],
  ['dave', { userId: 'u4', teamId: 't2' }],
  ['erin', { userId: 'u5', teamId: 't2' }],
]);

describe('matchesTournamentGamePlayers', () => {
  it('accepts the two players of a 1v1 game, case-insensitively', () => {
    assert.equal(matchesTournamentGamePlayers(
      [{ user_id: 10, username: 'Alice' }, { user_id: 11, username: 'BOB' }], duelPlayers, duel), true);
  });

  it('ignores anonymous sides', () => {
    assert.equal(matchesTournamentGamePlayers(
      [{ user_id: 10, username: 'alice' }, { user_id: -1, username: 'AI' }, { user_id: 11, username: 'bob' }], duelPlayers, duel), true);
  });

  it('refuses a 1v1 game against someone else', () => {
    const expected = new Map(duelPlayers).set('mallory', { userId: 'u9', teamId: null });
    assert.equal(matchesTournamentGamePlayers(
      [{ user_id: 10, username: 'alice' }, { user_id: 12, username: 'mallory' }], expected, duel), false);
    assert.equal(matchesTournamentGamePlayers(
      [{ user_id: 10, username: 'alice' }, { user_id: 12, username: 'stranger' }], duelPlayers, duel), false);
  });

  it('refuses a game with a single identified player or a duplicated player', () => {
    assert.equal(matchesTournamentGamePlayers([{ user_id: 10, username: 'alice' }], duelPlayers, duel), false);
    assert.equal(matchesTournamentGamePlayers(
      [{ user_id: 10, username: 'alice' }, { user_id: 10, username: 'Alice' }], duelPlayers, duel), false);
  });

  it('accepts a team game with members of both teams, even if not all members played', () => {
    assert.equal(matchesTournamentGamePlayers([
      { user_id: 1, username: 'alice' }, { user_id: 3, username: 'carol' },
      { user_id: 2, username: 'bob' }, { user_id: 5, username: 'erin' },
    ], teamPlayers, teams), true);
  });

  it('refuses a team game where only one team is represented or an outsider played', () => {
    assert.equal(matchesTournamentGamePlayers([
      { user_id: 1, username: 'alice' }, { user_id: 3, username: 'carol' },
    ], teamPlayers, teams), false);
    assert.equal(matchesTournamentGamePlayers([
      { user_id: 1, username: 'alice' }, { user_id: 2, username: 'bob' }, { user_id: 9, username: 'zed' },
    ], teamPlayers, teams), false);
  });
});
