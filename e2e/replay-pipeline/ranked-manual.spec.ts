import { expect, test } from '@playwright/test';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { loginAs } from '../support/login';

/**
 * Ranked 1v1 game outside tournaments, without a surrender (confidence 1).
 *
 * The WML carries no reliable victory signal, so the parse job records the
 * replay as `parsed` with confidence 1 and no match. A participant then
 * confirms the winner from the match list; that confirmation creates the
 * match and applies ELO once.
 * Fixture: the surrender-free copy of Haldiel vs clmates.
 */
const fixture = 'Ranked_Classic_Maps_Turn_2_(1)__tournament_nosurrender.bz2';
const winner = 'Haldiel';
const loser = 'clmates';

test.afterAll(cleanupInjectedReplays);

test('a participant confirms a ranked replay without surrender', async ({ page }) => {
  test.setTimeout(300_000);
  const winnerBefore = getPlayerRating(winner);
  const loserBefore = getPlayerRating(loser);

  const game = injectLegacyGame({ replayFixture: fixture });

  const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(parsed, `replay ended as ${parsed.parse_status}: ${parsed.parse_error_message}`).toMatchObject({
    parse_status: 'parsed',
    integration_confidence: '1',
    match_id: null,
  });
  // Nothing is applied before a participant confirms.
  expect(getPlayerRating(winner)).toEqual(winnerBefore);

  await loginAs(page, winner);
  await page.goto('/matches');
  const row = page.locator('tr').filter({ hasText: game.replayName });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('[data-help-id="action-confirm-ranked-replay-won"]').click();
  await page.locator('[data-help-id="action-submit-replay-confirmation"]').click();

  const completed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'parsed', 60_000);
  expect(completed).toMatchObject({ parse_status: 'completed' });
  expect(completed.match_id).toBeTruthy();

  const winnerAfter = getPlayerRating(winner);
  const loserAfter = getPlayerRating(loser);
  expect(winnerAfter.matches).toBe(winnerBefore.matches + 1);
  expect(loserAfter.matches).toBe(loserBefore.matches + 1);
  expect(winnerAfter.elo).toBeGreaterThan(winnerBefore.elo);
  expect(loserAfter.elo).toBeLessThan(loserBefore.elo);
});
