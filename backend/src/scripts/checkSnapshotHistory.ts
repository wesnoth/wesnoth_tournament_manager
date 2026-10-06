/**
 * Read-only consistency check of faction/map statistics history
 * (audit finding 20).
 *
 * Before snapshot dates were published atomically under a per-date lock, a
 * failed write could leave a date partial, and two concurrent creators could
 * duplicate it. This script lists the dates that may be affected. It never
 * writes.
 *
 * For every stored snapshot date it rebuilds the expected rows with the same
 * aggregation the creator uses (buildFactionMapSnapshotEntries) and compares
 * them by key (map, faction, opponent faction, side):
 *   - duplicated keys: two creators wrote the same date. Definitive.
 *   - missing keys: rows the current data expects but the date lacks. This is
 *     the signature of a partial write, but a match whose map or faction was
 *     renamed after the snapshot also produces it.
 *   - extra keys or different totals: usually data that changed after the
 *     snapshot (for example a match cancelled later), not a write failure.
 * Reported dates can be repaired by deleting their rows and backfilling the
 * date again (admin snapshot backfill), or by the full balance rebuild.
 *
 * Usage (exit code 1 when duplicated or missing keys are found):
 *   development: NODE_ENV=development npx tsx src/scripts/checkSnapshotHistory.ts
 *   built:       NODE_ENV=production npm run check:snapshot-history
 */
import { pool, query } from '../config/database.js';
import { buildFactionMapSnapshotEntries } from '../services/statisticsCalculator.js';

interface DateReport {
  date: string;
  storedRows: number;
  expectedRows: number;
  duplicatedKeys: number;
  missingKeys: number;
  extraKeys: number;
  differentTotals: number;
}

const rowKey = (row: { map_id: string; faction_id: string; opponent_faction_id: string; faction_side: number }) =>
  `${row.map_id}|${row.faction_id}|${row.opponent_faction_id}|${Number(row.faction_side)}`;

async function checkDate(date: string): Promise<DateReport> {
  const stored = (await query(
    `SELECT map_id, faction_id, opponent_faction_id, faction_side, total_games
     FROM faction_map_statistics_history WHERE snapshot_date = ?`,
    [date]
  )).rows;
  const expected = await buildFactionMapSnapshotEntries(date);

  const storedByKey = new Map<string, number[]>();
  for (const row of stored) {
    const totals = storedByKey.get(rowKey(row)) || [];
    totals.push(Number(row.total_games));
    storedByKey.set(rowKey(row), totals);
  }
  const expectedByKey = new Map(expected.map((entry) => [rowKey(entry), entry.total_games]));

  let duplicatedKeys = 0;
  let extraKeys = 0;
  let differentTotals = 0;
  for (const [key, totals] of storedByKey) {
    if (totals.length > 1) duplicatedKeys += 1;
    const expectedTotal = expectedByKey.get(key);
    if (expectedTotal === undefined) extraKeys += 1;
    else if (totals[0] !== expectedTotal) differentTotals += 1;
  }
  let missingKeys = 0;
  for (const key of expectedByKey.keys()) if (!storedByKey.has(key)) missingKeys += 1;

  return {
    date,
    storedRows: stored.length,
    expectedRows: expected.length,
    duplicatedKeys,
    missingKeys,
    extraKeys,
    differentTotals,
  };
}

async function main(): Promise<number> {
  // DATE_FORMAT keeps the date as text; a DATE column would come back as a
  // JavaScript Date and could shift with the client timezone.
  const dates = (await query(
    `SELECT DISTINCT DATE_FORMAT(snapshot_date, '%Y-%m-%d') AS date
     FROM faction_map_statistics_history ORDER BY date`
  )).rows.map((row: any) => String(row.date));
  console.log(`Checking ${dates.length} snapshot dates (read-only)...`);

  const reports: DateReport[] = [];
  for (const date of dates) reports.push(await checkDate(date));

  const suspicious = reports.filter((r) => r.duplicatedKeys || r.missingKeys);
  const drifted = reports.filter((r) => !r.duplicatedKeys && !r.missingKeys && (r.extraKeys || r.differentTotals));

  if (suspicious.length) {
    console.log('\nDates with duplicated or missing rows (likely write failures):');
    console.table(suspicious);
  }
  if (drifted.length) {
    console.log('\nDates that differ only by later data changes (extra rows or different totals):');
    console.table(drifted);
  }
  console.log(
    `\n${dates.length} dates checked: ${suspicious.length} with duplicated or missing rows, ` +
    `${drifted.length} with later data drift, ${dates.length - suspicious.length - drifted.length} consistent.`
  );
  return suspicious.length ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error('Snapshot history check failed:', error);
    process.exitCode = 2;
  })
  .finally(() => pool.end());
