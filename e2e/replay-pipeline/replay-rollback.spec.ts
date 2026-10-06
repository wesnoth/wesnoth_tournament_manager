import { expect, test } from '@playwright/test';
import { confirmTogether } from '../support/concurrentConfirm';
import { installFault, removeFault } from '../support/faultInjection';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { localStack, runSql, sqlLiteral } from '../support/localStack';
import { loginAs } from '../support/login';
import { createStartedSwissTournament, getPendingTournamentGames, getTournamentGame } from '../support/tournamentSetup';

/**
 * A failure after the ELO update rolls the whole result back (audit
 * findings 3–4).
 *
 * The fault fails the last write of the integration transaction: the replay
 * row moving to `completed`. By then the match is inserted, both players'
 * ELO is updated and, in a tournament, the game result and standings are
 * recorded, so a surviving write of any of them would show here. The
 * maintainer requirement is that a failed replay keeps no match_id and stays
 * reprocessable: a manual confirmation can simply be repeated, and an
 * automatic one is recovered with the admin Reprocess action.
 */
const db = localStack.tournamentDb;

test.afterAll(cleanupInjectedReplays);
test.afterEach(() => removeFault('rollback_replay_completion'));

function failReplayCompletion(replayFilename: string): void {
  installFault({
    name: 'rollback_replay_completion',
    table: 'replays',
    when: `NEW.parse_status = 'completed' AND OLD.replay_filename = ${sqlLiteral(replayFilename)}`,
  });
}

function matchesForReplay(replayId: string): number {
  return Number(runSql(`SELECT COUNT(*) AS n FROM ${db}.matches WHERE replay_id = ${sqlLiteral(replayId)};`)[0].n);
}

/** Games played summed over every standings row of a tournament. */
function standingsGamesPlayed(tournamentId: string): number {
  const [row] = runSql(
    `SELECT COALESCE(SUM(st.matches_played), 0) AS played
     FROM ${db}.tournament_phase_standings st
     JOIN ${db}.tournament_phase_groups gr ON gr.id = st.group_id
     JOIN ${db}.tournament_phases ph ON ph.id = gr.phase_id
     WHERE ph.tournament_id = ${sqlLiteral(tournamentId)};`,
  );
  return Number(row.played);
}

test('manual tournament confirmation: a failure after ELO keeps nothing and can be confirmed again', async ({ page, browser }) => {
  test.setTimeout(600_000);
  const name = `e2e_rollback_manual_${Date.now()}`;
  const players = ['Haldiel', 'clmates'];
  const tournamentId = await createStartedSwissTournament(page, {
    name, mode: 'ranked', organizer: 'Blair', players, bestOf: 1,
  });
  const [pending] = getPendingTournamentGames(tournamentId);
  const before = Object.fromEntries(players.map((p) => [p, getPlayerRating(p)]));

  const game = injectLegacyGame({
    replayFixture: 'Ranked_Classic_Maps_Turn_2_(1)__ranked-tournament_nosurrender.bz2',
    gameName: name,
  });
  const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(parsed).toMatchObject({ parse_status: 'parsed', integration_confidence: '1', tournament_game_id: pending.gameId });

  failReplayCompletion(game.replayName);
  const [failedStatus] = await confirmTogether(browser, `/tournament/${tournamentId}`, [
    { nickname: 'Haldiel', choice: 'action-confirm-confidence-one-replay-won' },
  ]);
  expect(failedStatus).toBe(500);

  // Nothing written by the failed transaction survives.
  const afterFailure = await waitForReplayOutcome(game, () => true);
  expect(afterFailure).toMatchObject({ parse_status: 'parsed', match_id: null });
  expect(matchesForReplay(parsed.id)).toBe(0);
  for (const p of players) expect(getPlayerRating(p), `${p} rating after the failure`).toEqual(before[p]);
  expect(getTournamentGame(pending.gameId).status).toBe('pending');
  expect(standingsGamesPlayed(tournamentId)).toBe(0);

  // The same confirmation succeeds once the cause is gone.
  removeFault('rollback_replay_completion');
  const [retryStatus] = await confirmTogether(browser, `/tournament/${tournamentId}`, [
    { nickname: 'Haldiel', choice: 'action-confirm-confidence-one-replay-won' },
  ]);
  expect(retryStatus).toBe(200);
  const completed = await waitForReplayOutcome(game, (state) => state.parse_status === 'completed', 60_000);
  expect(completed.match_id).not.toBeNull();
  expect(matchesForReplay(parsed.id)).toBe(1);
  for (const p of players) expect(getPlayerRating(p).matches, `${p} matches`).toBe(before[p].matches + 1);
  const result = getTournamentGame(pending.gameId);
  expect(result).toMatchObject({ status: 'completed', winnerNickname: 'Haldiel', matchId: completed.match_id });
});

test('automatic integration: a failure after ELO leaves the replay in error, and Reprocess recovers it', async ({ page }) => {
  test.setTimeout(600_000);
  // Surrender in the WML gives confidence 2, so the parse job integrates it.
  // Fixture names predate the parser fix (0dacb62); this one is ranked_mode=yes,
  // tournament_mode=no, so it integrates as a standalone ranked game.
  const fixture = 'Ranked_Classic_Maps_Turn_2_(2)__no-tournament.bz2';
  const players = ['Blop', 'clmates'];
  const before = Object.fromEntries(players.map((p) => [p, getPlayerRating(p)]));

  const game = injectLegacyGame({ replayFixture: fixture });
  failReplayCompletion(game.replayName);
  const failed = await waitForReplayOutcome(game, (state) => !['new', 'processing'].includes(state.parse_status));
  expect(failed).toMatchObject({ parse_status: 'error', match_id: null });
  expect(failed.parse_error_message).toContain('E2E injected failure');
  expect(matchesForReplay(failed.id)).toBe(0);
  for (const p of players) expect(getPlayerRating(p), `${p} rating after the failure`).toEqual(before[p]);

  // An admin reprocesses it from the panel once the cause is fixed.
  removeFault('rollback_replay_completion');
  await loginAs(page, 'clmates');
  await page.goto('/admin/replays');
  await page.locator('[data-help-id="field-replay-status-filter"]').selectOption('error');
  const row = page.locator('tr').filter({ hasText: game.replayName });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('[data-help-id="action-reprocess-replay"]').click();
  // The form is pre-filled from the parse summary the job kept on error, so
  // the admin reprocesses it as the ranked game it is without editing.
  await expect(page.locator('[data-help-id="option-reprocess-ranked-mode"]')).toBeChecked();
  await expect(page.locator('[data-help-id="option-reprocess-tournament"]')).not.toBeChecked();
  const reprocessed = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/reprocess'));
  await page.locator('[data-help-id="action-submit-reprocess-replay"]').click();
  expect((await reprocessed).ok()).toBe(true);

  const completed = await waitForReplayOutcome(game, (state) => state.parse_status === 'completed');
  expect(completed.match_id).not.toBeNull();
  expect(matchesForReplay(completed.id)).toBe(1);
  for (const p of players) expect(getPlayerRating(p).matches, `${p} matches`).toBe(before[p].matches + 1);
});
