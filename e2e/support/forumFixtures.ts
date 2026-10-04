import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { localStack, runSql, sqlLiteral } from './localStack';

/** A side as recorded in the replay WML. */
export interface ReplaySide {
  side: number;
  nickname: string;
  /** Faction as wesnothd stores it for the Ranked era, e.g. "Ranked Undead". */
  faction: string;
}

export interface InjectedGame {
  instanceUuid: string;
  gameId: number;
  replayName: string;
  sides: ReplaySide[];
}

/** Replay copies placed in REPLAY_SAVE_PATH by this process, removed by cleanupInjectedReplays(). */
const copiedReplays = new Set<string>();

/**
 * Read the sides of a replay fixture: side number, controlling player, and
 * faction, in side order.
 *
 * The live detection model (Ranked add-on + WML) takes the winner from a
 * surrender in the WML and matches it against the forum players by nickname,
 * so the forum rows must use exactly the replay's players and sides.
 */
export function readReplaySides(replayFixture: string): ReplaySide[] {
  const wml = execFileSync('bzcat', [path.join(localStack.replayFixturesDir, replayFixture)], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // The first [side] blocks of the starting state carry current_player and
  // faction_name; later occurrences (snapshots) repeat them, so keep the first
  // occurrence per side number.
  const sides = new Map<number, ReplaySide>();
  for (const block of wml.split('[side]').slice(1)) {
    const body = block.split('[/side]')[0];
    // Starting-state sides write side="1" and the full era faction id
    // (faction="Ranked Undead"), which is what wesnothd stores in the forum.
    const side = Number(body.match(/^\s*side="?(\d+)"?\s*$/m)?.[1]);
    const nickname = body.match(/^\s*current_player="([^"]+)"/m)?.[1];
    const faction = body.match(/^\s*faction="([^"]+)"/m)?.[1];
    if (side && nickname && faction && !sides.has(side)) {
      sides.set(side, { side, nickname, faction });
    }
  }
  const ordered = [...sides.values()].sort((a, b) => a.side - b.side);
  if (ordered.length < 2) throw new Error(`Could not read two sides from replay fixture ${replayFixture}`);
  return ordered;
}

/**
 * Insert one finished game into the local forum tables in the shape of the
 * live detection model, so the real forum sync and replay parse jobs pick it up.
 *
 * Shape (from legacy games recorded by the local wesnothd, 2026-08):
 * - `wesnothd_game_info` with END_TIME = now, a version matching the
 *   backend's WESNOTH_VERSION, no COMPETITIVE_GAME_ID, and GAME_NAME. For a
 *   tournament game the name is the tournament name, which is how the
 *   tournament is found;
 * - one `wesnothd_game_player_info` row per replay side (user id from phpBB);
 * - content rows: Ranked era, Ranked map picker, and the `Ranked` add-on
 *   modification, which is the marker the sync and parse jobs require.
 *
 * The result itself comes from the replay file: a surrender gives confidence
 * 2, anything else confidence 1. END_TIME uses UTC_TIMESTAMP() because the
 * sync job compares it with a UTC checkpoint. The copied replay gets a unique
 * name that never contains `Turn_1_`, which the parser deletes.
 */
export function injectLegacyGame(options: { replayFixture: string; gameName?: string }): InjectedGame {
  const instanceUuid = randomUUID();
  const gameId = 1;
  const sides = readReplaySides(options.replayFixture);
  const sourceName = options.replayFixture.replace(/__.*\.bz2$/, '.bz2');
  const replayName = `E2E_${instanceUuid.slice(0, 8)}_${sourceName.replace(/Turn_1_/g, 'Turn_01_')}`;
  const gameName = options.gameName || `${sides[0].nickname}’s game`;

  const users = runSql(
    `SELECT user_id, username FROM ${localStack.forumDb}.phpbb3_users WHERE username IN (${sides.map((s) => sqlLiteral(s.nickname)).join(', ')});`,
  );
  const userIdByName = new Map(users.map((row) => [String(row.username).toLowerCase(), Number(row.user_id)]));
  for (const side of sides) {
    if (!userIdByName.has(side.nickname.toLowerCase())) {
      throw new Error(`Forum user ${side.nickname} does not exist in ${localStack.forumDb}.phpbb3_users`);
    }
  }

  copyReplayFixture(options.replayFixture, replayName);
  const sql = [
    `USE ${localStack.forumDb};`,
    'START TRANSACTION;',
    `INSERT INTO wesnothd_game_info (INSTANCE_UUID, GAME_ID, INSTANCE_VERSION, GAME_NAME, START_TIME, END_TIME, REPLAY_NAME,
                                     OOS, RELOAD, OBSERVERS, PASSWORD, PUBLIC, COMPETITIVE_GAME_ID)
     VALUES (${sqlLiteral(instanceUuid)}, ${gameId}, ${sqlLiteral(localStack.wesnothVersion)}, ${sqlLiteral(gameName)},
             UTC_TIMESTAMP() - INTERVAL 15 MINUTE, UTC_TIMESTAMP(), ${sqlLiteral(replayName)},
             b'0', b'0', b'1', b'0', b'1', NULL);`,
    ...sides.map((side) =>
      `INSERT INTO wesnothd_game_player_info (INSTANCE_UUID, GAME_ID, USER_ID, SIDE_NUMBER, IS_HOST, FACTION, CLIENT_VERSION, USER_NAME, LEADERS)
       VALUES (${sqlLiteral(instanceUuid)}, ${gameId}, ${userIdByName.get(side.nickname.toLowerCase())}, ${side.side},
               ${side.side === 1 ? "b'1'" : "b'0'"}, ${sqlLiteral(side.faction)}, '1.19.26+dev', ${sqlLiteral(side.nickname)}, '');`),
    `INSERT INTO wesnothd_game_content_info (INSTANCE_UUID, GAME_ID, TYPE, ID, ADDON_ID, ADDON_VERSION, NAME) VALUES
       (${sqlLiteral(instanceUuid)}, ${gameId}, 'era', 'ranked_era', 'ranked_era', '1.0.4', 'Ranked Era'),
       (${sqlLiteral(instanceUuid)}, ${gameId}, 'scenario', 'ranked_classic_maps', 'ranked_map_picker', '1.0.4', 'Ranked Classic Maps'),
       (${sqlLiteral(instanceUuid)}, ${gameId}, 'modification', 'ranked', 'Ranked', '1.0.10', 'Ranked');`,
    'COMMIT;',
  ].join('\n');
  runSql(sql);

  return { instanceUuid, gameId, replayName, sides };
}

/** Copy a fixture replay into REPLAY_SAVE_PATH under the game's unique name. */
function copyReplayFixture(sourceName: string, replayName: string): void {
  const source = path.join(localStack.replayFixturesDir, sourceName);
  if (!fs.existsSync(source)) {
    throw new Error(`Replay fixture not found: ${source} (set E2E_REPLAY_FIXTURES_DIR)`);
  }
  if (!fs.existsSync(localStack.replaySavePath)) {
    throw new Error(`REPLAY_SAVE_PATH not found: ${localStack.replaySavePath} (set E2E_REPLAY_SAVE_PATH)`);
  }
  const target = path.join(localStack.replaySavePath, replayName);
  fs.copyFileSync(source, target);
  copiedReplays.add(target);
}

/**
 * Remove the replay copies this process placed in REPLAY_SAVE_PATH, which is
 * also the local wesnothd replay directory. Forum and tournament rows stay;
 * reset them with localdatabase/restore-instance.sh.
 */
export function cleanupInjectedReplays(): void {
  for (const file of copiedReplays) {
    fs.rmSync(file, { force: true });
    copiedReplays.delete(file);
  }
}

export interface ReplayState {
  id: string;
  parse_status: string;
  integration_confidence: string | null;
  match_id: string | null;
  tournament_id: string | null;
  tournament_game_id: string | null;
  parse_error_message: string | null;
}

/**
 * Read the Tournament Manager replay row created for an injected game.
 * Returns null until the forum sync job has imported it.
 */
export function getReplayState(game: InjectedGame): ReplayState | null {
  const rows = runSql(
    `SELECT id, parse_status, integration_confidence, match_id, tournament_id, tournament_game_id, parse_error_message
     FROM ${localStack.tournamentDb}.replays
     WHERE instance_uuid = ${sqlLiteral(game.instanceUuid)} AND game_id = ${game.gameId};`,
  );
  return (rows[0] as unknown as ReplayState) || null;
}

/**
 * Wait until the scheduled jobs move the injected game's replay past a state.
 * The default timeout covers one 60 s forum sync plus one 30 s parse cycle
 * with margin; no backend trigger is used on purpose, so the specs run the
 * jobs exactly as they run in every environment.
 */
export async function waitForReplayOutcome(
  game: InjectedGame,
  isDone: (state: ReplayState) => boolean,
  timeoutMs = 240_000,
): Promise<ReplayState> {
  const deadline = Date.now() + timeoutMs;
  let last: ReplayState | null = null;
  while (Date.now() < deadline) {
    last = getReplayState(game);
    if (last && isDone(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Replay for ${game.instanceUuid}:${game.gameId} did not finish in ${timeoutMs} ms; last state: ${JSON.stringify(last)}`);
}

/** Current ELO and match count of a Tournament Manager user, by nickname. */
export function getPlayerRating(nickname: string): { elo: number; matches: number } {
  const rows = runSql(
    `SELECT elo_rating, matches_played FROM ${localStack.tournamentDb}.users_extension WHERE LOWER(nickname) = LOWER(${sqlLiteral(nickname)});`,
  );
  if (!rows[0]) throw new Error(`Tournament Manager user ${nickname} does not exist`);
  return { elo: Number(rows[0].elo_rating), matches: Number(rows[0].matches_played) };
}
