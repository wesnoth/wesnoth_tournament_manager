import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { confirmRankedTogether } from '../support/concurrentConfirm';
import { delayActive, installFault, removeFault } from '../support/faultInjection';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { localStack, runSql, sqlLiteral } from '../support/localStack';
import { loginAs } from '../support/login';

/**
 * Global recalculation vs concurrent rating writers (audit findings 27, 28).
 *
 * The recalculation reads the whole history and rewrites ratings. Writers
 * admitted before it was reserved must finish first and be included (27),
 * and a dispute resolution must commit its match change together with the
 * recalculation job, never one without the other (28). Delays and failures
 * are injected with MariaDB triggers; the backend code runs unchanged.
 *
 * Every scenario ends by checking that one more recalculation changes no row:
 * the persisted history then equals a fresh full replay.
 */
const fixture = 'Ranked_Classic_Maps_Turn_2_(2)__no-tournament_nosurrender.bz2';
const players = ['Blop', 'clmates'];
const faults = ['hold_elo_writer', 'hold_recalculation_commit', 'fail_job_insert'];

test.describe.configure({ mode: 'serial' });
test.afterAll(cleanupInjectedReplays);
test.afterEach(() => faults.forEach(removeFault));

interface Api {
  post: (path: string, data?: unknown) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

/** Authenticated API client for a local user, through the real login form. */
async function apiAs(browser: Browser, nickname: string): Promise<Api> {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, nickname);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  return {
    post: async (path, data) => {
      const response = await page.request.post(`${localStack.apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: data ?? {},
      });
      return { status: response.status(), body: await response.json().catch(() => null) };
    },
    close: () => context.close(),
  };
}

async function waitUntil(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

interface JobRow {
  status: string;
  reason: string;
  matchesUpdated: number;
  usersUpdated: number;
}

function jobRow(jobId: string): JobRow | null {
  const row = runSql(
    `SELECT status, reason, result_json FROM ${localStack.tournamentDb}.global_stats_recalculation_jobs
     WHERE id = ${sqlLiteral(jobId)};`,
  )[0];
  if (!row) return null;
  const result = row.result_json ? JSON.parse(row.result_json) : {};
  return { status: row.status!, reason: row.reason!, matchesUpdated: result.matchesUpdated, usersUpdated: result.usersUpdated };
}

async function waitForJob(jobId: string): Promise<JobRow> {
  await waitUntil(() => ['completed', 'failed'].includes(jobRow(jobId)?.status ?? ''), 120_000, `job ${jobId}`);
  return jobRow(jobId)!;
}

async function queueRecalculation(admin: Api): Promise<string> {
  const response = await admin.post('/admin/recalculate-all-stats');
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return response.body.jobId;
}

/** One more recalculation must find nothing to change. */
async function expectHistoryMatchesFullReplay(admin: Api): Promise<void> {
  const job = await waitForJob(await queueRecalculation(admin));
  expect(job.status).toBe('completed');
  expect({ matchesUpdated: job.matchesUpdated, usersUpdated: job.usersUpdated }).toEqual({ matchesUpdated: 0, usersUpdated: 0 });
}

/** A ranked match between the fixture players, integrated through the real pipeline. */
async function createConfirmedMatch(browser: Browser): Promise<string> {
  const game = injectLegacyGame({ replayFixture: fixture });
  const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(parsed).toMatchObject({ parse_status: 'parsed', integration_confidence: '1' });
  const [status] = await confirmRankedTogether(browser, [
    { nickname: 'Blop', choice: 'action-confirm-ranked-replay-won', replayName: game.replayName },
  ]);
  expect(status).toBe(200);
  const completed = await waitForReplayOutcome(game, (state) => state.parse_status === 'completed', 60_000);
  return completed.match_id!;
}

function matchRow(matchId: string): { status: string; winner_id: string } {
  return runSql(
    `SELECT status, winner_id FROM ${localStack.tournamentDb}.matches WHERE id = ${sqlLiteral(matchId)};`,
  )[0] as { status: string; winner_id: string };
}

function jobCount(): number {
  return Number(runSql(`SELECT COUNT(*) AS n FROM ${localStack.tournamentDb}.global_stats_recalculation_jobs;`)[0].n);
}

async function disputeAsBlop(browser: Browser, matchId: string): Promise<void> {
  const blop = await apiAs(browser, 'Blop');
  try {
    const response = await blop.post(`/matches/${matchId}/confirm`, { action: 'dispute', comments: 'E2E dispute' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  } finally {
    await blop.close();
  }
}

test('a writer admitted before the recalculation finishes first and is included', async ({ browser }) => {
  test.setTimeout(420_000);
  const admin = await apiAs(browser, 'clmates');
  try {
    // Start from a history that already equals a full replay.
    expect((await waitForJob(await queueRecalculation(admin))).status).toBe('completed');
    const before = Object.fromEntries(players.map((p) => [p, getPlayerRating(p)]));

    const game = injectLegacyGame({ replayFixture: fixture });
    await waitForReplayOutcome(game, (state) => state.parse_status === 'parsed');

    // The confirmation passes the "job active" check, then stalls inside its
    // transaction on the ELO update, holding the rating-history lock shared.
    installFault({
      name: 'hold_elo_writer',
      table: 'users_extension',
      when: `NEW.matches_played <> OLD.matches_played AND OLD.nickname IN (${players.map(sqlLiteral).join(', ')})`,
      delaySeconds: 8,
      failTimes: 1,
    });
    const confirming = confirmRankedTogether(browser, [
      { nickname: 'Blop', choice: 'action-confirm-ranked-replay-won', replayName: game.replayName },
    ]);
    await waitUntil(() => delayActive('hold_elo_writer'), 120_000, 'the confirmation to reach the ELO update');

    const jobId = await queueRecalculation(admin);
    expect(await confirming).toEqual([200]);
    const job = await waitForJob(jobId);
    expect(job.status).toBe('completed');

    // The recalculation waited for the writer and kept its match.
    for (const p of players) expect(getPlayerRating(p).matches, `${p} matches`).toBe(before[p].matches + 1);
    await expectHistoryMatchesFullReplay(admin);
  } finally {
    await admin.close();
  }
});

test('the recalculation holds the rating history until it commits', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await apiAs(browser, 'clmates');
  const nowaitShare = `SELECT id FROM ${localStack.tournamentDb}.rating_history_lock WHERE id = 1 LOCK IN SHARE MODE NOWAIT;`;
  try {
    // Stall the last statement of the recalculation transaction.
    installFault({
      name: 'hold_recalculation_commit',
      table: 'global_stats_recalculation_jobs',
      when: 'NEW.ratings_committed_at IS NOT NULL AND OLD.ratings_committed_at IS NULL',
      delaySeconds: 6,
    });
    const jobId = await queueRecalculation(admin);
    await waitUntil(() => delayActive('hold_recalculation_commit'), 60_000, 'the recalculation to reach its commit');

    // A writer would be refused at once, not queued behind the recalculation.
    expect(() => runSql(`BEGIN; ${nowaitShare}`)).toThrow(/1205|Lock wait timeout/);

    expect((await waitForJob(jobId)).status).toBe('completed');
    expect(runSql(`BEGIN; ${nowaitShare}`)).toEqual([{ id: '1' }]);
  } finally {
    await admin.close();
  }
});

test('concurrent dispute resolutions: one runs, the other changes nothing', async ({ browser }) => {
  test.setTimeout(600_000);
  const first = await createConfirmedMatch(browser);
  const second = await createConfirmedMatch(browser);
  await disputeAsBlop(browser, first);
  await disputeAsBlop(browser, second);
  const originalWinner = matchRow(second).winner_id;

  const admin = await apiAs(browser, 'clmates');
  try {
    const responses = await Promise.all([
      admin.post(`/matches/admin/${first}/dispute`, { action: 'validate' }),
      admin.post(`/matches/admin/${second}/dispute`, { action: 'validate' }),
    ]);
    const statuses = responses.map((r) => r.status);
    expect([...statuses].sort(), JSON.stringify(responses.map((r) => r.body))).toEqual([200, 409]);

    const winnerIndex = statuses.indexOf(200);
    const [resolved, refused] = winnerIndex === 0 ? [first, second] : [second, first];
    expect(matchRow(resolved).status).toBe('cancelled');
    expect(matchRow(refused).status).toBe('disputed');
    expect((await waitForJob(responses[winnerIndex].body.recalculationJobId)).status).toBe('completed');

    // The refused one is resolved normally afterwards; award inverts the result.
    const award = await admin.post(`/matches/admin/${refused}/dispute`, { action: 'award' });
    expect(award.status, JSON.stringify(award.body)).toBe(200);
    expect(matchRow(refused).status).toBe('confirmed');
    if (refused === second) expect(matchRow(second).winner_id).not.toBe(originalWinner);
    expect((await waitForJob(award.body.recalculationJobId)).status).toBe('completed');

    await expectHistoryMatchesFullReplay(admin);
  } finally {
    await admin.close();
  }
});

test('a dispute resolution whose job cannot be stored keeps the match disputed', async ({ browser }) => {
  test.setTimeout(420_000);
  const matchId = await createConfirmedMatch(browser);
  await disputeAsBlop(browser, matchId);

  const admin = await apiAs(browser, 'clmates');
  try {
    const jobsBefore = jobCount();
    installFault({ name: 'fail_job_insert', table: 'global_stats_recalculation_jobs', event: 'INSERT', when: '1 = 1' });
    const failed = await admin.post(`/matches/admin/${matchId}/dispute`, { action: 'validate' });
    expect(failed.status).toBe(500);
    expect(matchRow(matchId).status).toBe('disputed');
    expect(jobCount()).toBe(jobsBefore);

    // The recalculation slot was released: once storage works again, both a
    // manual recalculation and the resolution go through.
    removeFault('fail_job_insert');
    expect((await waitForJob(await queueRecalculation(admin))).status).toBe('completed');
    const resolved = await admin.post(`/matches/admin/${matchId}/dispute`, { action: 'validate' });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect(matchRow(matchId).status).toBe('cancelled');
    expect((await waitForJob(resolved.body.recalculationJobId)).status).toBe('completed');

    await expectHistoryMatchesFullReplay(admin);
  } finally {
    await admin.close();
  }
});
