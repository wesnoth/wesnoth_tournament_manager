import { execFileSync } from 'node:child_process';

/**
 * Configuration of the local E2E stack used by the replay-pipeline specs.
 *
 * These specs do not run against the deployed TEST site: they need write
 * access to the forum tables that wesnothd normally fills, which only the
 * local MariaDB instances provide (see localdatabase/restore-instance.sh).
 * Both local instances expose the same database names, so only the container
 * selects which one is used; the backend under test must point to the same
 * instance (DB_PORT / PHPBB_DB_PORT) and to the same REPLAY_SAVE_PATH.
 */
export const localStack = {
  /** Docker container of the MariaDB instance the backend is using. */
  dbContainer: process.env.E2E_DB_CONTAINER || 'tournament-test-mariadb-1',
  forumDb: process.env.E2E_FORUM_DB || 'wesnoth_dev',
  tournamentDb: process.env.E2E_TOURNAMENT_DB || 'tournament_dev',
  /** Must equal the backend's REPLAY_SAVE_PATH; the parse job reads replay files from here. */
  replaySavePath: process.env.E2E_REPLAY_SAVE_PATH
    || '/home/clmates/programación/wesnoth-server/.local/wesnothd-tournament/replays',
  /**
   * Real 1.19 Ranked replays (and edited copies without surrender or with
   * tournament_mode flipped). In the live detection model the replay decides
   * players, sides, factions, ranked/tournament flags, and a surrender win.
   */
  replayFixturesDir: process.env.E2E_REPLAY_FIXTURES_DIR
    || '/home/clmates/programación/localdatabase/replay-fixtures',
  /** Must match a version accepted by the backend's WESNOTH_VERSION filter. */
  wesnothVersion: process.env.E2E_WESNOTH_VERSION || '1.19-dev',
};

/**
 * Quote a value as a MariaDB string literal.
 *
 * Fixture values come from test code, but nicknames and file names may still
 * contain quotes or backslashes, so every literal is escaped rather than
 * trusted. `null` maps to SQL NULL.
 */
export function sqlLiteral(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite SQL number: ${value}`);
    return String(value);
  }
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Run SQL as root inside the database container and return the rows of the
 * last result set as objects keyed by column name.
 *
 * The root password stays inside the container's environment; the test
 * process never reads or prints it. Values are returned as strings exactly as
 * the `mariadb` batch client prints them (`NULL` becomes `null`).
 */
export function runSql(sql: string): Array<Record<string, string | null>> {
  const output = execFileSync(
    'docker',
    ['exec', '-i', localStack.dbContainer, 'sh', '-c', 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" --batch'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const lines = output.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(header.map((name, index) => [name, cells[index] === 'NULL' ? null : cells[index]]));
  });
}
