import { expect, test } from '@playwright/test';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';

/**
 * Ranked 1v1 game outside tournaments, won by surrender (confidence 2).
 *
 * Exercises the live replay pipeline end to end: the forum sync job imports
 * the injected wesnothd game (Ranked add-on marker), the parse job reads the
 * replay WML (ranked_mode=yes, tournament_mode=no, a surrender), creates the
 * match and applies ELO, and the public match list shows it.
 * Fixture: Haldiel (side 1) vs clmates (side 2); Haldiel surrenders.
 */
const fixture = 'Ranked_Classic_Maps_Turn_2_(1)__tournament.bz2';
const winner = 'clmates';
const loser = 'Haldiel';

test.afterAll(cleanupInjectedReplays);

test('a ranked game won by surrender is integrated automatically and updates ELO', async ({ page }) => {
  test.setTimeout(300_000);
  const winnerBefore = getPlayerRating(winner);
  const loserBefore = getPlayerRating(loser);

  const game = injectLegacyGame({ replayFixture: fixture });

  const replay = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(replay, `replay ended as ${replay.parse_status}: ${replay.parse_error_message}`).toMatchObject({
    parse_status: 'completed',
    integration_confidence: '2',
    tournament_id: null,
  });
  expect(replay.match_id).toBeTruthy();

  // ELO is applied exactly once: one more match for each player, winner up, loser down.
  const winnerAfter = getPlayerRating(winner);
  const loserAfter = getPlayerRating(loser);
  expect(winnerAfter.matches).toBe(winnerBefore.matches + 1);
  expect(loserAfter.matches).toBe(loserBefore.matches + 1);
  expect(winnerAfter.elo).toBeGreaterThan(winnerBefore.elo);
  expect(loserAfter.elo).toBeLessThan(loserBefore.elo);

  // The newest row of the public match list is the integrated game.
  await page.goto('/matches');
  const firstRow = page.locator('[data-help-id="region-match-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await expect(firstRow).toContainText(winner);
  await expect(firstRow).toContainText(loser);
});
