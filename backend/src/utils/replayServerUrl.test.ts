/**
 * Unit tests of the replay-server URL parser used by the manual replay link
 * (issue #5). The parser is the only input the user controls, so it must
 * refuse other hosts and malformed paths, and extract the exact identifiers.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseReplayServerUrl } from './replayServerUrl.js';

describe('parseReplayServerUrl', () => {
  it('extracts version, UTC date, file name and game id', () => {
    const parts = parseReplayServerUrl(
      'https://replays.wesnoth.org/1.19/2026/11/05/2p__Devious_Dockyard_Turn_20_(1089).bz2'
    );
    assert.deepEqual(parts, {
      baseVersion: '1.19',
      endDate: '2026-11-05',
      replayName: '2p__Devious_Dockyard_Turn_20_(1089).bz2',
      gameId: 1089,
    });
  });

  it('decodes an encoded file name and ignores query and fragment', () => {
    const parts = parseReplayServerUrl(
      ' https://replays.wesnoth.org/1.18/2026/01/31/2p__Caves_of_the_Basilisk_Turn_12_%2842%29.bz2?x=1#top '
    );
    assert.equal(parts.replayName, '2p__Caves_of_the_Basilisk_Turn_12_(42).bz2');
    assert.equal(parts.gameId, 42);
  });

  it('refuses other hosts, including look-alike subdomains', () => {
    assert.throws(() => parseReplayServerUrl('https://example.org/1.18/2026/01/31/a_(1).bz2'));
    assert.throws(() => parseReplayServerUrl('https://replays.wesnoth.org.evil.test/1.18/2026/01/31/a_(1).bz2'));
  });

  it('refuses malformed paths, dates and file names', () => {
    assert.throws(() => parseReplayServerUrl('https://replays.wesnoth.org/1.18/2026/01/a_(1).bz2'));
    assert.throws(() => parseReplayServerUrl('https://replays.wesnoth.org/1.18/2026/02/31/a_(1).bz2'));
    assert.throws(() => parseReplayServerUrl('https://replays.wesnoth.org/1.18/2026/01/31/no_game_id.bz2'));
    assert.throws(() => parseReplayServerUrl('ftp://replays.wesnoth.org/1.18/2026/01/31/a_(1).bz2'));
    assert.throws(() => parseReplayServerUrl(''));
    assert.throws(() => parseReplayServerUrl(42));
  });
});
