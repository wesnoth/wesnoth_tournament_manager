import { expect, test, type Page } from '@playwright/test';
import { faultHits, installFault, removeFault } from '../support/faultInjection';
import { localStack, runSql, sqlLiteral } from '../support/localStack';
import { loginAs } from '../support/login';

/**
 * Faction/map statistics snapshots are published atomically per date
 * (audit finding 20).
 *
 * Driven through the admin snapshot backfill endpoint, which calls the same
 * creator as the daily job and the balance rebuild. Each test uses a far
 * future date, so its snapshot covers every local match and never collides
 * with real history; the rows are deleted afterwards.
 *
 * The local data yields more rows than one insert batch (500), so failing a
 * row of the second batch proves that rows already inserted by the first
 * statement are rolled back too, not only the failing statement.
 */
const db = localStack.tournamentDb;
const fault = 'fail_snapshot_insert';

test.afterEach(() => removeFault(fault));

/** Rows stored for a date and how many of their keys are duplicated. */
function snapshotState(date: string): { rows: number; duplicatedKeys: number } {
  const [row] = runSql(
    `SELECT COUNT(*) AS rows_count,
            COUNT(*) - COUNT(DISTINCT map_id, faction_id, opponent_faction_id, faction_side) AS duplicated
     FROM ${db}.faction_map_statistics_history WHERE snapshot_date = ${sqlLiteral(date)};`,
  );
  return { rows: Number(row.rows_count), duplicatedKeys: Number(row.duplicated) };
}

function deleteSnapshot(date: string): void {
  runSql(`DELETE FROM ${db}.faction_map_statistics_history WHERE snapshot_date = ${sqlLiteral(date)};`);
}

/** Call the admin backfill endpoint with the session of the logged-in page. */
async function backfill(page: Page, date: string): Promise<{ status: number; body: any }> {
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const response = await page.request.post(`${localStack.apiUrl}/statistics/history/snapshot`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { date },
  });
  return { status: response.status(), body: await response.json() };
}

test('a failed snapshot leaves no rows and a retry writes the complete date', async ({ page }) => {
  const date = '2099-12-30';
  deleteSnapshot(date);
  try {
    await loginAs(page, 'clmates');

    // Baseline: the complete row count for this date.
    const baseline = await backfill(page, date);
    expect(baseline.status).toBe(200);
    const complete = baseline.body.snapshots_created;
    expect(complete, 'needs more rows than one insert batch').toBeGreaterThan(500);
    deleteSnapshot(date);

    // Fail one row of the second batch, after 500 rows were already inserted.
    installFault({
      name: fault,
      table: 'faction_map_statistics_history',
      event: 'INSERT',
      when: `NEW.snapshot_date = ${sqlLiteral(date)}`,
      skipFirst: 600,
      failTimes: 1,
    });
    const failed = await backfill(page, date);
    expect(failed.status).toBe(500);
    expect(faultHits(fault)).toBe(601);
    expect(snapshotState(date).rows, 'no partial date may remain').toBe(0);

    // Before finding 20 a partial date was taken as complete and skipped.
    removeFault(fault);
    const retried = await backfill(page, date);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ snapshots_created: complete, snapshots_skipped: 0 });
    expect(snapshotState(date)).toEqual({ rows: complete, duplicatedKeys: 0 });
  } finally {
    deleteSnapshot(date);
  }
});

test('concurrent creators of one date write it once', async ({ page }) => {
  const date = '2099-12-31';
  deleteSnapshot(date);
  try {
    await loginAs(page, 'clmates');
    const results = await Promise.all([backfill(page, date), backfill(page, date), backfill(page, date)]);
    for (const result of results) expect(result.status).toBe(200);

    // One creator writes the date; the others wait for the lock, see it and skip.
    const created = results.map((r) => r.body.snapshots_created).filter((n) => n > 0);
    expect(created).toHaveLength(1);
    for (const result of results.filter((r) => r.body.snapshots_created === 0)) {
      expect(result.body.snapshots_skipped).toBe(created[0]);
    }
    expect(snapshotState(date)).toEqual({ rows: created[0], duplicatedKeys: 0 });
  } finally {
    deleteSnapshot(date);
  }
});
