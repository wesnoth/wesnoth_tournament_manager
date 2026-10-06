import { expect, test } from '@playwright/test';
import { confirmTogether } from '../support/concurrentConfirm';
import { installFault, removeFault } from '../support/faultInjection';
import { cleanupInjectedReplays, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { localStack, runSql, sqlLiteral } from '../support/localStack';
import { loginAs } from '../support/login';
import { createStartedSwissTournament, getPendingTournamentGames, getTournamentGame } from '../support/tournamentSetup';

/**
 * A failed tournament follow-up is recovered by the organizer (audit
 * findings 3–4).
 *
 * The game result commits first; finishing the tournament runs afterwards,
 * outside that transaction. The fault makes finishing fail, which must leave
 * the result and the completed replay in place, record
 * TOURNAMENT_PROGRESSION_FAILED, and show the organizer the retry action on
 * the completed phase. Retrying finishes the tournament.
 */
const db = localStack.tournamentDb;
const fault = 'fail_tournament_finish';

test.afterAll(cleanupInjectedReplays);
test.afterEach(() => removeFault(fault));

function auditActions(tournamentId: string): string[] {
  return runSql(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(details, '$.action')) AS action
     FROM ${db}.audit_logs
     WHERE JSON_UNQUOTE(JSON_EXTRACT(details, '$.tournament_id')) = ${sqlLiteral(tournamentId)}
     ORDER BY created_at;`,
  ).map((row) => String(row.action));
}

function tournamentStatus(tournamentId: string): string {
  return String(runSql(`SELECT status FROM ${db}.tournaments WHERE id = ${sqlLiteral(tournamentId)};`)[0].status);
}

test('a failed tournament finish keeps the result and is completed by the organizer retry', async ({ page, browser }) => {
  test.setTimeout(600_000);
  const name = `e2e_advance_recovery_${Date.now()}`;
  const organizer = 'Blair';
  // One Swiss round between two players: the single game completes the only
  // phase, so the follow-up is finishing the tournament.
  const tournamentId = await createStartedSwissTournament(page, {
    name, mode: 'ranked', organizer, players: ['Haldiel', 'clmates'], bestOf: 1,
  });
  const [pending] = getPendingTournamentGames(tournamentId);
  const game = injectLegacyGame({
    replayFixture: 'Ranked_Classic_Maps_Turn_2_(1)__ranked-tournament_nosurrender.bz2',
    gameName: name,
  });
  const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(parsed).toMatchObject({ parse_status: 'parsed', tournament_game_id: pending.gameId });

  installFault({
    name: fault,
    table: 'tournaments',
    when: `NEW.status = 'finished' AND OLD.id = ${sqlLiteral(tournamentId)}`,
  });
  const [status] = await confirmTogether(browser, `/tournament/${tournamentId}`, [
    { nickname: 'Haldiel', choice: 'action-confirm-confidence-one-replay-won' },
  ]);
  // The result is durable, so the player's confirmation succeeds.
  expect(status).toBe(200);
  const completed = await waitForReplayOutcome(game, (state) => state.parse_status === 'completed', 60_000);
  expect(completed.match_id).not.toBeNull();
  expect(getTournamentGame(pending.gameId)).toMatchObject({ status: 'completed', winnerNickname: 'Haldiel' });
  expect(tournamentStatus(tournamentId)).not.toBe('finished');
  expect(auditActions(tournamentId)).toContain('TOURNAMENT_PROGRESSION_FAILED');

  // The organizer sees the retry on the completed phase and uses it.
  removeFault(fault);
  await loginAs(page, organizer);
  await page.goto(`/tournament/${tournamentId}`);
  await page.locator('[data-help-id="action-tab-competition"]').click();
  const retry = page.locator('[data-help-id="action-retry-phase-advancement"]');
  await expect(retry).toHaveCount(1, { timeout: 30_000 });
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/advance')),
    retry.click(),
  ]);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ compiled: false, finalized: true });

  expect(tournamentStatus(tournamentId)).toBe('finished');
  expect(auditActions(tournamentId)).toContain('TOURNAMENT_FINALIZED_BY_ADVANCE');
  // The result recorded before the failure is untouched.
  expect(getTournamentGame(pending.gameId)).toMatchObject({ status: 'completed', winnerNickname: 'Haldiel', matchId: completed.match_id });
  await expect(retry).toHaveCount(0, { timeout: 30_000 });
});
