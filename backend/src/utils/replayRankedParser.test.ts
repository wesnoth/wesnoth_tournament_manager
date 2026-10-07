/**
 * Unit tests of the Ranked replay parser against real replays
 * (audit finding 13).
 *
 * Fixtures live in backend/test-fixtures/replay-samples/<Wesnoth version>/:
 * each replay comes with the forum rows wesnothd stored for it
 * (<replay>.forum.json), so the parser receives exactly what the parse job
 * gives it. Expected outcomes are what really happened in each game
 * (confirmed by the maintainer), not what the parser happened to return.
 * When Wesnoth or the Ranked add-on changes its replay format, add samples
 * for the new version next to the old ones.
 *
 * Variants (a surrender removed or moved, a tournament flag flipped) are
 * edits of a real replay made in memory, so only real replays are stored.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseRankedReplay, type ParsedRankedReplay } from './replayRankedParser.js';

// src/utils and the compiled .verify-dist/utils are both two levels below backend/.
const samplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-fixtures/replay-samples');

interface ForumSample {
  player_info: Array<{ USER_ID: number; SIDE_NUMBER: number; FACTION: string; USER_NAME: string }>;
}

/** Forum players as the parse job loads them: empty seats (USER_ID -1) excluded. */
function forumPlayers(version: string, replay: string) {
  const forum: ForumSample = JSON.parse(
    fs.readFileSync(path.join(samplesDir, version, replay.replace(/\.bz2$/, '.forum.json')), 'utf8')
  );
  return forum.player_info
    .filter((row) => row.USER_ID !== -1)
    .map((row) => ({ side_number: row.SIDE_NUMBER, user_name: row.USER_NAME, faction: row.FACTION }));
}

async function decompressSample(version: string, replay: string): Promise<string> {
  const bz2Module: any = await import('bz2');
  const decompress = bz2Module.decompress || bz2Module.default?.decompress || bz2Module.default || bz2Module;
  const buffer = fs.readFileSync(path.join(samplesDir, version, replay));
  return Buffer.from(decompress(buffer)).toString('utf8');
}

/**
 * Parse a sample the way the parse job does. With `edit`, the decompressed
 * WML is changed in memory and parsed from a temporary .gz copy.
 */
async function parseSample(
  version: string,
  replay: string,
  edit?: (wml: string) => string
): Promise<ParsedRankedReplay> {
  const players = forumPlayers(version, replay);
  // The job extracts players from the WML when the forum only says "Custom".
  const options = {
    skipExtractPlayers: !players.some((player) => player.faction === 'Custom'),
    forumPlayers: players,
  };
  if (!edit) return parseRankedReplay(path.join(samplesDir, version, replay), options);

  const edited = edit(await decompressSample(version, replay));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-sample-'));
  const tempPath = path.join(tempDir, replay.replace(/\.bz2$/, '.gz'));
  fs.writeFileSync(tempPath, zlib.gzipSync(edited));
  try {
    return await parseRankedReplay(tempPath, options);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Replace exactly one occurrence, so an edit never silently does nothing. */
function replaceOnce(text: string, from: string | RegExp, to: string): string {
  const matches = typeof from === 'string' ? text.split(from).length - 1 : (text.match(new RegExp(from, 'g')) || []).length;
  assert.equal(matches, 1, `expected one occurrence of ${from}`);
  return text.replace(from, to);
}

// The parser logs every step; keep test output readable.
const silence = () => {
  const original = { log: console.log, warn: console.warn };
  console.log = () => undefined;
  console.warn = () => undefined;
  return () => Object.assign(console, original);
};

describe('Wesnoth 1.18 ranked games', () => {
  it('Caves of the Basilisk (1.18.4): clmates surrenders, Haldiel wins with confidence 2', async () => {
    const restore = silence();
    const parsed = await parseSample('1.18', '2p__Caves_of_the_Basilisk_Turn_11_(37997).bz2').finally(restore);
    // 1.18.4 writes quoted values and still carries the legacy `tournament` variable.
    assert.deepEqual([parsed.addon.ranked_mode, parsed.addon.tournament], [true, false]);
    assert.equal(parsed.victory.reason, 'surrender');
    assert.equal(parsed.victory.confidence_level, 2);
    assert.equal(parsed.victory.winner_name, 'Haldiel');
    assert.equal(parsed.victory.loser_name, 'clmates');
    assert.deepEqual([parsed.victory.winner_sides, parsed.victory.loser_sides], [[1], [2]]);
  });

  it('Swamp of Dread (1.18.8): no surrender, so a player confirms (confidence 1)', async () => {
    const restore = silence();
    const parsed = await parseSample('1.18', '2p__Swamp_of_Dread_Turn_22_(38128).bz2').finally(restore);
    // 1.18.8 writes unquoted values.
    assert.deepEqual([parsed.addon.ranked_mode, parsed.addon.tournament], [true, false]);
    assert.equal(parsed.victory.reason, 'unknown');
    assert.equal(parsed.victory.confidence_level, 1);
  });

  it('Tombs of Kesorak: matto kills SkyEnd\'s leader, SkyEnd then surrenders; matto wins with confidence 2', async () => {
    // The leaderkill itself leaves no trace in the WML (attacks carry no
    // results and the add-on event did not sync a winner); the surrender
    // SkyEnd sent afterwards, as an observer, decides the game.
    const restore = silence();
    const parsed = await parseSample('1.18', '2p__Tombs_of_Kesorak_Turn_10_(1975).bz2').finally(restore);
    assert.equal(parsed.victory.reason, 'surrender');
    assert.equal(parsed.victory.confidence_level, 2);
    assert.equal(parsed.victory.winner_name, 'matto');
    assert.equal(parsed.victory.loser_name, 'SkyEnd');
  });

  it('a ranked tournament game is detected from tournament_mode (Caves edited in memory)', async () => {
    // No ranked tournament has been played yet; flip the real flag.
    const restore = silence();
    const parsed = await parseSample('1.18', '2p__Caves_of_the_Basilisk_Turn_11_(37997).bz2', (wml) =>
      replaceOnce(wml, 'tournament_mode="no"', 'tournament_mode="yes"')
    ).finally(restore);
    assert.deepEqual([parsed.addon.ranked_mode, parsed.addon.tournament], [true, true]);
    assert.equal(parsed.victory.winner_name, 'Haldiel');
    assert.equal(parsed.victory.confidence_level, 2);
  });
});

describe('Wesnoth 1.18 team tournament (2v2)', () => {
  const replay = '4p__Isars_Cross_Turn_11_(27645).bz2';

  it('both north-east players surrender: south-west wins with confidence 2', async () => {
    // Sides: 1 NanRoig and 4 Danniel_BR (south-west), 2 clmates and
    // 3 KhorneflakesBA (north-east); sides change control during the game.
    const restore = silence();
    const parsed = await parseSample('1.18', replay).finally(restore);
    assert.deepEqual([parsed.addon.ranked_mode, parsed.addon.tournament], [false, true]);
    assert.deepEqual(parsed.teams, { 1: 'south-west', 2: 'north-east', 3: 'north-east', 4: 'south-west' });
    assert.equal(parsed.victory.reason, 'surrender');
    assert.equal(parsed.victory.confidence_level, 2);
    assert.deepEqual(parsed.victory.winner_sides, [1, 4]);
    assert.deepEqual(parsed.victory.loser_sides, [2, 3]);
  });

  it('only one north-east player surrenders: undecided (confidence 1)', async () => {
    const restore = silence();
    const parsed = await parseSample('1.18', replay, (wml) =>
      replaceOnce(wml, 'message="KhorneflakesBA has surrendered."', 'message="KhorneflakesBA says gg."')
    ).finally(restore);
    assert.equal(parsed.victory.confidence_level, 1);
    assert.equal(parsed.victory.winner_sides, undefined);
  });

  it('one surrender in each team, then the game ends: undecided (confidence 1)', async () => {
    // The maintainer's case: neither alliance surrendered as a whole.
    const restore = silence();
    const parsed = await parseSample('1.18', replay, (wml) =>
      replaceOnce(wml, 'message="KhorneflakesBA has surrendered."', 'message="NanRoig has surrendered."')
    ).finally(restore);
    assert.equal(parsed.victory.confidence_level, 1);
  });

  it('never decides a team game from the add-on leaderkill variable', async () => {
    // The add-on event only compares sides 1 and 2, which says nothing about
    // alliances. A synced Winner_1 appended to the replay must be ignored.
    const restore = silence();
    const parsed = await parseSample('1.18', replay, (wml) =>
      replaceOnce(wml, 'message="KhorneflakesBA has surrendered."', 'message="KhorneflakesBA says gg."')
        .replace(/\[\/replay\]\s*$/, syncedWinnerCommand(1) + '[/replay]\n')
    ).finally(restore);
    assert.equal(parsed.victory.confidence_level, 1);
  });
});

describe('Wesnoth 1.19 tournament games (The Quality Tournament, T60881)', () => {
  it('game 145: clmates confirms the surrender menu, momom2 wins with confidence 2', async () => {
    const restore = silence();
    const parsed = await parseSample('1.19', 'The_Quality_Tournament_Maps_Turn_22_(145).bz2').finally(restore);
    assert.deepEqual([parsed.addon.ranked_mode, parsed.addon.tournament], [false, true]);
    assert.equal(parsed.victory.reason, 'surrender');
    assert.equal(parsed.victory.confidence_level, 2);
    assert.equal(parsed.victory.winner_name, 'momom2');
    assert.equal(parsed.victory.loser_name, 'clmates');
    assert.deepEqual(parsed.surrenders, [{ side: 2, confirmed: true }]);
  });

  it('game 92: no surrender, so a player confirms (confidence 1)', async () => {
    const restore = silence();
    const parsed = await parseSample('1.19', 'The_Quality_Tournament_Maps_Turn_9_(92).bz2').finally(restore);
    assert.deepEqual([parsed.addon.ranked_mode, parsed.addon.tournament], [false, true]);
    assert.equal(parsed.victory.confidence_level, 1);
  });

  it('game 281: a leaderkill without surrender stays at confidence 1', async () => {
    // These 1.19 replays do not even define the add-on leaderkill event, and
    // attacks carry no results: only server-side result recording can
    // decide this game automatically.
    const restore = silence();
    const parsed = await parseSample('1.19', 'The_Quality_Tournament_Maps_Turn_11_(281).bz2').finally(restore);
    assert.equal(parsed.victory.reason, 'unknown');
    assert.equal(parsed.victory.confidence_level, 1);
  });

  it('a synced add-on leaderkill decides a 1v1 game, even after post-game chat', async () => {
    // Shape assumed from the add-on's [sync_variable]: no real replay with a
    // synced winner exists yet. Appended after the final chat, so it is far
    // from the end of the command list.
    const restore = silence();
    const parsed = await parseSample('1.19', 'The_Quality_Tournament_Maps_Turn_11_(281).bz2', (wml) =>
      wml.replace(/\[\/replay\]\s*$/, syncedWinnerCommand(2) + chatCommands(60) + '[/replay]\n')
    ).finally(restore);
    assert.equal(parsed.victory.reason, 'victory_conditions');
    assert.equal(parsed.victory.confidence_level, 2);
    assert.equal(parsed.victory.winner_name, 'StonyDrew');
  });
});

/** A synced Winner_N input as the add-on's [sync_variable] would record it. */
function syncedWinnerCommand(side: number): string {
  return `[command]\ndependent="yes"\nfrom_side="${side}"\n[input]\n[variable]\nname="Winner_${side}"\nvalue="${side}"\n[/variable]\n[/input]\n[/command]\n`;
}

/** Chat after the end of a game. */
function chatCommands(count: number): string {
  let commands = '';
  for (let i = 0; i < count; i += 1) {
    commands += `[command]\nundo="no"\n[speak]\nid="observer"\nmessage="gg ${i}"\n[/speak]\n[/command]\n`;
  }
  return commands;
}
