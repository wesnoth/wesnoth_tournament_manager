import { expect, test, type Page } from '@playwright/test';
import {
  cleanupInjectedReplays,
  getPlayerRating,
  injectLegacyGame,
  replayServerUrl,
  waitForReplayOutcome,
} from '../support/forumFixtures';
import { runSql, sqlLiteral, localStack } from '../support/localStack';
import { loginAs } from '../support/login';
import { createStartedSwissTournament, getPendingTournamentGames, getTournamentGame } from '../support/tournamentSetup';

/**
 * Manual replay link (issue #5): a game that automatic detection could not
 * attach to its tournament is linked from its replays.wesnoth.org URL.
 *
 * - Unranked tournament, game hosted without the Ranked add-on and with a
 *   wrong name: the forum sync skips it, a player links it from the
 *   competition view, and the parse job integrates the surrender
 *   (confidence 2). Linking the same replay again to the next game fails.
 * - Ranked tournament, game hosted with the tournament flag off: it is first
 *   counted as a plain ranked match; the organizer then links it and the
 *   existing match is attached to the tournament game without a second ELO
 *   update.
 */
const organizer = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';

test.afterAll(cleanupInjectedReplays);

/** Open the link form of the first pending game, submit a URL, and return the status text. */
async function linkFromCompetitionView(page: Page, tournamentId: string, url: string): Promise<string> {
  await page.goto(`/tournament/${tournamentId}`);
  const open = page.locator('[data-help-id="action-open-link-tournament-replay"]').first();
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await page.locator('[data-help-id="field-tournament-replay-url"]').fill(url);
  await page.locator('[data-help-id="action-link-tournament-replay"]').click();
  const status = page.locator('[data-help-id="region-tournament-phase-games"] [role="status"]');
  await expect(status).toBeVisible({ timeout: 30_000 });
  return (await status.locator('span').textContent()) || '';
}

function linkMethod(replayId: string): string | null {
  const rows = runSql(
    `SELECT tournament_link_method FROM ${localStack.tournamentDb}.replays WHERE id = ${sqlLiteral(replayId)};`,
  );
  return (rows[0]?.tournament_link_method as string) ?? null;
}

test('a player links an unranked tournament game hosted without the Ranked add-on', async ({ page }) => {
  test.setTimeout(600_000);
  const players = ['clmates', 'Caritas'];
  const name = `e2e_manual_link_unranked_${Date.now()}`;
  const tournamentId = await createStartedSwissTournament(page, { name, mode: 'unranked', organizer, players, bestOf: 3 });
  const [first] = getPendingTournamentGames(tournamentId);
  expect(first).toBeTruthy();

  // Wrong name and no add-on: nothing links it automatically.
  const game = injectLegacyGame({
    replayFixture: 'Ranked_Classic_Maps_Turn_4_(1)__no-tournament.bz2',
    gameName: 'casual game with a typo',
    rankedAddon: false,
  });

  await loginAs(page, 'Caritas');
  const message = await linkFromCompetitionView(page, tournamentId, replayServerUrl(game));
  expect(message).not.toMatch(/could not|error/i);

  const replay = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(replay, `replay: ${replay.parse_status} ${replay.parse_error_message}`).toMatchObject({
    parse_status: 'completed',
    integration_confidence: '2',
    tournament_id: tournamentId,
    tournament_game_id: first.gameId,
    match_id: null,
  });
  expect(linkMethod(replay.id)).toBe('manual_url');
  expect(getTournamentGame(first.gameId)).toMatchObject({ status: 'completed', winnerNickname: 'clmates' });

  // The same replay cannot be used for the next game of the series.
  await expect.poll(() => getPendingTournamentGames(tournamentId).length, { timeout: 30_000 }).toBe(1);
  const again = await linkFromCompetitionView(page, tournamentId, replayServerUrl(game));
  expect(again).toMatch(/already linked/i);
});

test('the organizer attaches a ranked tournament game already counted as a ranked match', async ({ page }) => {
  test.setTimeout(600_000);
  const players = ['Haldiel', 'clmates'];
  const name = `e2e_manual_link_ranked_${Date.now()}`;
  const tournamentId = await createStartedSwissTournament(page, { name, mode: 'ranked', organizer, players, bestOf: 1 });
  const [first] = getPendingTournamentGames(tournamentId);
  expect(first).toBeTruthy();
  const ratingsBefore = Object.fromEntries(players.map((nickname) => [nickname, getPlayerRating(nickname)]));

  // ranked_mode=yes, tournament_mode=no, clmates wins by surrender: a plain ranked match.
  const game = injectLegacyGame({ replayFixture: 'Ranked_Classic_Maps_Turn_2_(1)__tournament.bz2' });
  const ranked = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(ranked, `replay: ${ranked.parse_status} ${ranked.parse_error_message}`).toMatchObject({
    parse_status: 'completed',
    tournament_id: null,
  });
  expect(ranked.match_id).toBeTruthy();

  await loginAs(page, organizer);
  const message = await linkFromCompetitionView(page, tournamentId, replayServerUrl(game));
  expect(message).not.toMatch(/could not|error/i);

  const linked = await waitForReplayOutcome(game, (state) => state.tournament_game_id !== null, 30_000);
  expect(linked).toMatchObject({ tournament_id: tournamentId, tournament_game_id: first.gameId, match_id: ranked.match_id });
  expect(linkMethod(linked.id)).toBe('manual_url');
  expect(getTournamentGame(first.gameId)).toMatchObject({
    status: 'completed',
    winnerNickname: 'clmates',
    matchId: ranked.match_id,
  });
  const match = runSql(
    `SELECT tournament_id, tournament_type, tournament_mode FROM ${localStack.tournamentDb}.matches WHERE id = ${sqlLiteral(ranked.match_id!)};`,
  )[0];
  expect(match).toMatchObject({ tournament_id: tournamentId, tournament_type: 'ranked', tournament_mode: 'ranked' });

  // ELO was applied once, by the original ranked match.
  for (const nickname of players) {
    expect(getPlayerRating(nickname).matches, `${nickname} matches`).toBe(ratingsBefore[nickname].matches + 1);
  }
});
