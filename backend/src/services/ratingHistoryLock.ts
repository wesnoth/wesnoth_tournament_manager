/**
 * Reader–writer coordination between rating-history writers and the global
 * recalculation (audit findings 27 and 28).
 *
 * The global recalculation reads every user and match, replays them, and
 * rewrites ratings. Anything committed between its read and its commit would
 * be overwritten with values computed from the older history. The in-memory
 * reservation and the "job active" checks refuse new work early, but they
 * cannot wait for work that passed the check before the job was reserved.
 *
 * The guarantee comes from the row lock on the single row of
 * `rating_history_lock`, taken inside each transaction:
 *   - Writers (match creation with ELO, dispute resolutions that change the
 *     replay input) take it in SHARE mode with NOWAIT, as the first lock of
 *     their transaction. Writers do not block each other. While a
 *     recalculation holds or waits for the exclusive lock, the request fails
 *     at once with RatingHistoryLockedError instead of queuing behind it.
 *   - The recalculation takes it FOR UPDATE, waiting, before its first read.
 *     InnoDB grants it only after every admitted writer has committed or rolled
 *     back, and the reads that follow see all of them. It is held until the
 *     recalculation commits.
 *
 * Because writers take this lock before any other row lock and never wait for
 * it, it cannot take part in a deadlock with the writers' own lock order.
 */
import type { PoolConnection } from 'mysql2/promise';

/** A global recalculation holds (or is waiting for) the rating history. */
export class RatingHistoryLockedError extends Error {
  constructor() {
    super('A global statistics recalculation is in progress. Please try again in a few minutes.');
    this.name = 'RatingHistoryLockedError';
  }
}

/**
 * MariaDB reports a NOWAIT conflict as a lock wait timeout (1205). MySQL uses
 * a dedicated code (3572); it is accepted too so the check does not depend on
 * the server flavour.
 */
function isLockUnavailable(error: any): boolean {
  return error?.errno === 1205 || error?.errno === 3572
    || error?.code === 'ER_LOCK_WAIT_TIMEOUT' || error?.code === 'ER_LOCK_NOWAIT';
}

function assertLockRow(rows: unknown): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    // Without the row there is nothing to lock and no protection at all, so
    // fail loudly instead of silently running unprotected.
    throw new Error('rating_history_lock row is missing (migration 20261011_120000)');
  }
}

/**
 * Admit a rating-history writer. Call it first inside the writer's
 * transaction; the shared lock lasts until that transaction ends.
 *
 * @throws RatingHistoryLockedError when a recalculation holds or awaits the lock.
 */
export async function acquireSharedRatingHistoryLock(connection: PoolConnection): Promise<void> {
  try {
    const [rows] = await connection.query('SELECT id FROM rating_history_lock WHERE id = 1 LOCK IN SHARE MODE NOWAIT');
    assertLockRow(rows);
  } catch (error) {
    if (isLockUnavailable(error)) throw new RatingHistoryLockedError();
    throw error;
  }
}

/**
 * Take exclusive ownership of the rating history for a recalculation. Call it
 * inside the recalculation transaction before reading anything; it waits for
 * admitted writers (they are short) and lasts until that transaction ends.
 * A lock wait timeout here propagates as a normal failure of the job.
 */
export async function acquireExclusiveRatingHistoryLock(connection: PoolConnection): Promise<void> {
  const [rows] = await connection.query('SELECT id FROM rating_history_lock WHERE id = 1 FOR UPDATE');
  assertLockRow(rows);
}
