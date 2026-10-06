import { execFileSync } from 'node:child_process';
import path from 'node:path';
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

/** Every UTC day from `first` to `last`, inclusive, as YYYY-MM-DD. */
function daysBetween(first: string, last: string): string[] {
  const days: string[] = [];
  for (const day = new Date(`${first}T00:00:00Z`); day.toISOString().slice(0, 10) <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Run the read-only history check against the local stack and return its
 * summary line; it exits 1 when a date has duplicated or missing rows.
 */
function runHistoryCheck(): string {
  const output = execFileSync('npx', ['tsx', 'src/scripts/checkSnapshotHistory.ts'], {
    cwd: path.resolve(__dirname, '../../backend'),
    env: { ...process.env, NODE_ENV: 'development', DB_PORT: process.env.E2E_DB_PORT || '3308' },
    encoding: 'utf8',
  });
  return output.trim().split('\n').pop() || '';
}

test('the full rebuild regenerates every day up to yesterday and removes stale dates', async ({ page }) => {
  test.setTimeout(300_000);
  // A stale future date (an early snapshot that must not survive) and a
  // broken past date (half its rows deleted) that the rebuild must repair.
  await loginAs(page, 'clmates');
  expect((await backfill(page, '2099-12-27')).status).toBe(200);
  const [{ day: brokenDay }] = runSql(
    `SELECT DATE_FORMAT(MAX(snapshot_date), '%Y-%m-%d') AS day FROM ${db}.faction_map_statistics_history WHERE snapshot_date < UTC_DATE();`,
  ) as Array<{ day: string }>;
  if (brokenDay) {
    runSql(`DELETE FROM ${db}.faction_map_statistics_history WHERE snapshot_date = ${sqlLiteral(brokenDay)} LIMIT 100;`);
  }

  await page.goto('/admin/balance-events');
  const [queued] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/admin/recalculate-snapshots')),
    page.locator('[data-help-id="action-recalculate-balance-snapshots"]').click(),
  ]);
  expect(queued.status()).toBe(202);
  await expect(page.locator('.bg-green-100')).toBeVisible({ timeout: 240_000 });

  // Expected dates: every day from the first match to yesterday, plus event
  // boundaries up to yesterday.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [{ first, latest }] = runSql(
    `SELECT DATE_FORMAT(MIN(created_at), '%Y-%m-%d') AS first, DATE_FORMAT(MAX(created_at), '%Y-%m-%d') AS latest
     FROM ${db}.matches WHERE status <> 'cancelled';`,
  ) as Array<{ first: string; latest: string }>;
  const eventDays = runSql(
    `SELECT DATE_FORMAT(event_date, '%Y-%m-%d') AS day FROM ${db}.balance_events ORDER BY event_date;`,
  ).map((row) => String(row.day));
  // A boundary before the first match has no rows, so it is never stored.
  const boundaries = [...eventDays, eventDays.length ? latest : null]
    .filter((d): d is string => Boolean(d) && d! >= first && d! <= yesterday);
  const expectedDates = [...new Set([...daysBetween(first, yesterday), ...boundaries])].sort();
  const storedDates = runSql(
    `SELECT DISTINCT DATE_FORMAT(snapshot_date, '%Y-%m-%d') AS day FROM ${db}.faction_map_statistics_history ORDER BY day;`,
  ).map((row) => String(row.day));
  expect(storedDates).toEqual(expectedDates);
  expect(storedDates).not.toContain('2099-12-27');

  // Every stored date matches the matches it covers, including the repaired one.
  expect(runHistoryCheck()).toMatch(/0 with duplicated or missing rows/);
});
