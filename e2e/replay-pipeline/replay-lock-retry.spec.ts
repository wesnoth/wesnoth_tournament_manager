import { expect, test } from '@playwright/test';
import { confirmRankedTogether } from '../support/concurrentConfirm';
import { faultHits, installFault, removeFault } from '../support/faultInjection';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { localStack, runSql, sqlLiteral } from '../support/localStack';

/**
 * Deadlocks during replay integration are retried (audit findings 3–4).
 *
 * The integration locks replay -> tournament -> game -> users, but tournament
 * progression locks more rows, so deadlocks cannot be ruled out and the
 * service retries the whole transaction (3 attempts). The fault raises a
 * deadlock (errno 1213) on the ELO update of a player, the point where the
 * user row locks are taken.
 */
const fixture = 'Ranked_Classic_Maps_Turn_2_(2)__no-tournament_nosurrender.bz2';
const players = ['Blop', 'clmates'];
const fault = 'deadlock_on_elo_update';

test.afterAll(cleanupInjectedReplays);
test.afterEach(() => removeFault(fault));

function deadlockOnEloUpdate(failTimes: number): void {
  installFault({
    name: fault,
    table: 'users_extension',
    when: `NEW.matches_played <> OLD.matches_played AND OLD.nickname IN (${players.map(sqlLiteral).join(', ')})`,
    errno: 1213,
    failTimes,
  });
}

function matchesForReplay(replayId: string): number {
  return Number(runSql(
    `SELECT COUNT(*) AS n FROM ${localStack.tournamentDb}.matches WHERE replay_id = ${sqlLiteral(replayId)};`,
  )[0].n);
}

test('a deadlock that clears on retry integrates the result once', async ({ browser }) => {
  test.setTimeout(300_000);
  const before = Object.fromEntries(players.map((p) => [p, getPlayerRating(p)]));
  const game = injectLegacyGame({ replayFixture: fixture });
  const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(parsed).toMatchObject({ parse_status: 'parsed', integration_confidence: '1' });

  deadlockOnEloUpdate(2);
  const [status] = await confirmRankedTogether(browser, [
    { nickname: 'Blop', choice: 'action-confirm-ranked-replay-won', replayName: game.replayName },
  ]);
  expect(status).toBe(200);

  // Two failed attempts hit once each (the first user update); the third
  // updates both users. Each retry starts from a rolled-back state, so the
  // ELO is applied exactly once.
  expect(faultHits(fault)).toBe(4);
  const completed = await waitForReplayOutcome(game, (state) => state.parse_status === 'completed', 60_000);
  expect(matchesForReplay(completed.id)).toBe(1);
  for (const p of players) expect(getPlayerRating(p).matches, `${p} matches`).toBe(before[p].matches + 1);
});

test('a deadlock that persists through every retry keeps nothing', async ({ browser }) => {
  test.setTimeout(300_000);
  const before = Object.fromEntries(players.map((p) => [p, getPlayerRating(p)]));
  const game = injectLegacyGame({ replayFixture: fixture });
  const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(parsed).toMatchObject({ parse_status: 'parsed', integration_confidence: '1' });

  deadlockOnEloUpdate(1_000);
  const [status] = await confirmRankedTogether(browser, [
    { nickname: 'Blop', choice: 'action-confirm-ranked-replay-won', replayName: game.replayName },
  ]);
  expect(status).toBe(500);
  expect(faultHits(fault)).toBe(3);

  const state = await waitForReplayOutcome(game, () => true);
  expect(state).toMatchObject({ parse_status: 'parsed', match_id: null });
  expect(matchesForReplay(parsed.id)).toBe(0);
  for (const p of players) expect(getPlayerRating(p), `${p} rating`).toEqual(before[p]);

  // Once the database recovers, the player can confirm again.
  removeFault(fault);
  const [retryStatus] = await confirmRankedTogether(browser, [
    { nickname: 'Blop', choice: 'action-confirm-ranked-replay-won', replayName: game.replayName },
  ]);
  expect(retryStatus).toBe(200);
  await waitForReplayOutcome(game, (s) => s.parse_status === 'completed', 60_000);
  for (const p of players) expect(getPlayerRating(p).matches, `${p} matches`).toBe(before[p].matches + 1);
});
