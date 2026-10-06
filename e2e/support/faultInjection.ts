import { localStack, runSql, sqlLiteral } from './localStack';

/**
 * Database fault injection for the replay-pipeline specs (audit findings 3–4).
 *
 * The failure paths of replay integration (rollback after the ELO update,
 * deadlock retries, post-commit tournament follow-up) cannot be reached by
 * ordinary inputs, and the backend has no test hooks for them on purpose. A
 * temporary MariaDB trigger raises the error at the exact statement instead,
 * so the real backend code runs unchanged against the real database.
 *
 * Each fault counts its hits in a MyISAM table: MyISAM writes are not
 * transactional, so a hit survives the rollback that the injected error
 * causes. That lets a fault fail only its first N executions, which is how a
 * transient deadlock that succeeds on retry is simulated.
 *
 * Triggers live in the local tournament database only; always remove them in
 * a `finally` or `afterEach`, or later specs will fail.
 */

export interface FaultOptions {
  /** Unique fault name; also the trigger suffix (letters, digits, underscore). */
  name: string;
  /** Table whose `BEFORE <event>` trigger raises the error. */
  table: 'replays' | 'users_extension' | 'tournaments' | 'faction_map_statistics_history';
  /** Statement that fires the trigger; default UPDATE. INSERT triggers have no OLD row. */
  event?: 'UPDATE' | 'INSERT';
  /** SQL condition over OLD/NEW that selects the targeted row. */
  when: string;
  /**
   * Error number to raise. 1213 (deadlock) is retried by the replay result
   * service; the default 1644 (user-defined signal) is a permanent failure.
   */
  errno?: number;
  /** Fail only the first N matching rows; later ones pass. Default: always. */
  failTimes?: number;
  /** Let the first N matching rows pass before failing; default 0. */
  skipFirst?: number;
}

const counterTable = `${localStack.tournamentDb}.e2e_fault_hits`;

function triggerName(name: string): string {
  if (!/^\w+$/.test(name)) throw new Error(`Invalid fault name: ${name}`);
  return `${localStack.tournamentDb}.e2e_fault_${name}`;
}

/**
 * Install a fault. The SQLSTATE follows the error class: 40001 for a
 * deadlock (as MariaDB reports it), 45000 for any other injected failure.
 */
export function installFault(options: FaultOptions): void {
  const errno = options.errno ?? 1644;
  const sqlState = errno === 1213 ? '40001' : '45000';
  const failTimes = options.failTimes ?? 1_000_000;
  const skipFirst = options.skipFirst ?? 0;
  removeFault(options.name);
  runSql([
    `CREATE TABLE IF NOT EXISTS ${counterTable} (name VARCHAR(64) PRIMARY KEY, hits INT NOT NULL) ENGINE=MyISAM;`,
    `DELETE FROM ${counterTable} WHERE name = ${sqlLiteral(options.name)};`,
    'DELIMITER //',
    `CREATE TRIGGER ${triggerName(options.name)} BEFORE ${options.event ?? 'UPDATE'} ON ${localStack.tournamentDb}.${options.table} FOR EACH ROW
     BEGIN
       IF ${options.when} THEN
         INSERT INTO ${counterTable} (name, hits) VALUES (${sqlLiteral(options.name)}, 1)
           ON DUPLICATE KEY UPDATE hits = hits + 1;
         IF (SELECT hits FROM ${counterTable} WHERE name = ${sqlLiteral(options.name)}) BETWEEN ${skipFirst + 1} AND ${skipFirst + failTimes} THEN
           SIGNAL SQLSTATE '${sqlState}' SET MYSQL_ERRNO = ${errno}, MESSAGE_TEXT = 'E2E injected failure';
         END IF;
       END IF;
     END//`,
    'DELIMITER ;',
  ].join('\n'));
}

/** Remove a fault's trigger; safe to call when it is not installed. */
export function removeFault(name: string): void {
  runSql(`DROP TRIGGER IF EXISTS ${triggerName(name)};`);
}

/** How many times the fault's condition matched, failed or not. */
export function faultHits(name: string): number {
  const rows = runSql(
    `SELECT COALESCE((SELECT hits FROM ${counterTable} WHERE name = ${sqlLiteral(name)}), 0) AS hits;`,
  );
  return Number(rows[0]?.hits ?? 0);
}
