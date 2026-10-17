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
 *
 * Backend overrides the suite needs besides those: WESNOTH_VERSION matching
 * `wesnothVersion` below, TOURNAMENT_SIMULATION=on (team helpers),
 * TOURNAMENT_CREATION_RATE_LIMIT_MAX=100 (one tournament per scenario), and
 * RATE_LIMIT_LOGIN_MAX=1000 (the full suite logs in well over the development
 * default of 50 per 15 minutes from one address).
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
  /** Backend API base URL, for admin endpoints that have no UI flow. */
  apiUrl: process.env.E2E_API_URL || 'http://localhost:7100/api',
  /** Frontend dev server the replay-pipeline browser specs open. */
  frontendUrl: process.env.E2E_LOCAL_BASE_URL || 'http://localhost:5173',
  /** Must match a version accepted by the backend's WESNOTH_VERSION filter. */
  wesnothVersion: process.env.E2E_WESNOTH_VERSION || '1.19-dev',
};

/** Host names that can only reach this machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Refuse to run local-stack specs unless the operator opted in and every URL
 * they talk to is on this machine.
 *
 * The replay-pipeline and lifecycle suites write fixtures, tournaments, and
 * temporary triggers straight into the database, so running them by mistake on
 * a server (for example `npm run verify:lifecycle` in a deployed clone) would
 * pollute real data. Two independent checks guard against that: an explicit
 * `E2E_LOCAL_STACK=1` that is never set by the npm scripts themselves, and a
 * loopback-only rule for the API and frontend URLs, so a variable exported in
 * a server's shell profile is still not enough to reach a remote backend.
 * The database container is not checked: `docker exec` can only reach
 * containers on this machine anyway.
 *
 * It runs from the `local-stack-guard` Playwright project, which both local
 * projects depend on, and again before every database or API call, so
 * `--no-deps` or importing these helpers from another project cannot skip it.
 */
export function assertLocalStack(): void {
  if (process.env.E2E_LOCAL_STACK !== '1') {
    throw new Error(
      'Local-stack E2E suites write to the database and must only run against the local stack. '
      + 'Set E2E_LOCAL_STACK=1 to confirm (see TESTING.md).',
    );
  }
  for (const [name, url] of [['E2E_API_URL', localStack.apiUrl], ['E2E_LOCAL_BASE_URL', localStack.frontendUrl]]) {
    const host = new URL(url).hostname;
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(`${name} points to ${host}; local-stack E2E suites only run against localhost.`);
    }
  }
}

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
  assertLocalStack();
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
