import { expect, test } from '@playwright/test';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { localStack, runSql, sqlLiteral } from '../support/localStack';
import { loginAs } from '../support/login';

/**
 * Both participants confirm the same confidence-1 ranked replay at the same
 * moment, from two browsers (audit findings 3–4).
 *
 * The confirmations agree on the winner, so the only correct outcome is one
 * match, one ELO update, and one refused request.
 * Fixture: the surrender-free copy of clmates vs Blop (both have ranked enabled).
 */
const fixture = 'Ranked_Classic_Maps_Turn_2_(2)__no-tournament_nosurrender.bz2';
const winner = 'Blop';
const loser = 'clmates';

test.afterAll(cleanupInjectedReplays);

test('simultaneous confirmations of one replay create a single match', async ({ browser }) => {
  test.setTimeout(300_000);
  const winnerBefore = getPlayerRating(winner);
  const loserBefore = getPlayerRating(loser);

  const game = injectLegacyGame({ replayFixture: fixture });
  const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(parsed, `replay ended as ${parsed.parse_status}: ${parsed.parse_error_message}`).toMatchObject({
    parse_status: 'parsed',
    integration_confidence: '1',
  });

  // Prepare both players up to the last click, then submit together.
  const sides = [
    { nickname: winner, choice: 'action-confirm-ranked-replay-won' },
    { nickname: loser, choice: 'action-confirm-ranked-replay-lost' },
  ];
  const pages = await Promise.all(sides.map(async (side) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, side.nickname);
    await page.goto('/matches');
    const row = page.locator('tr').filter({ hasText: game.replayName });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.locator(`[data-help-id="${side.choice}"]`).click();
    await expect(page.locator('[data-help-id="action-submit-replay-confirmation"]')).toBeEnabled();
    return page;
  }));
  const responses = await Promise.all(pages.map((page) => Promise.all([
    page.waitForResponse((response) => response.url().includes('/confirm-winner')),
    page.locator('[data-help-id="action-submit-replay-confirmation"]').click(),
  ]).then(([response]) => response.status())));
  console.log(`confirm-winner statuses: ${responses.join(', ')}`);

  const completed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'parsed', 60_000);
  expect(completed.parse_status).toBe('completed');

  const matches = runSql(
    `SELECT COUNT(*) AS n FROM ${localStack.tournamentDb}.matches WHERE replay_id = ${sqlLiteral(completed.id)};`,
  );
  const winnerAfter = getPlayerRating(winner);
  const loserAfter = getPlayerRating(loser);
  console.log(`matches for replay: ${matches[0].n}; ${winner} matches ${winnerBefore.matches}→${winnerAfter.matches}, ${loser} ${loserBefore.matches}→${loserAfter.matches}`);
  expect(Number(matches[0].n)).toBe(1);
  expect(winnerAfter.matches).toBe(winnerBefore.matches + 1);
  expect(loserAfter.matches).toBe(loserBefore.matches + 1);
  // Exactly one request succeeds; the other is refused as a conflict. Before
  // findings 3–4 the loser of the race only hit the matches unique index
  // (unique_replay_game) and answered 500, which this assertion rejects.
  expect([...responses].sort()).toEqual([200, 409]);
});
