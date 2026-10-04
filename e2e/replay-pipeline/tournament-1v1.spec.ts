import { expect, test } from '@playwright/test';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { loginAs } from '../support/login';
import { createStartedSwissTournament, getPendingTournamentGames, getTournamentGame } from '../support/tournamentSetup';

/**
 * 1v1 tournament games resolved through the live replay pipeline, for both
 * 1v1 tournament modalities: `tournament_ranked` (match + ELO) and
 * `tournament_unranked` (tournament result only, no match, no ELO).
 *
 * Each run creates a fresh two-player, one-round Swiss tournament played as a
 * best-of-3 series. The injected forum game is named after the tournament,
 * which is how the parser finds it:
 * - game 1 uses a replay with a surrender (confidence 2) and must be
 *   integrated automatically;
 * - game 2 uses the surrender-free copy (confidence 1) and is confirmed by a
 *   participant from the tournament competition view.
 */
const organizer = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';

const scenarios = [
  {
    // ranked_mode=yes, tournament_mode=yes (tournament_mode flipped in the copy).
    mode: 'ranked' as const,
    fixture: 'Ranked_Classic_Maps_Turn_2_(1)__ranked-tournament',
    players: ['Haldiel', 'clmates'],
    surrenderWinner: 'clmates',
    manualWinner: 'Haldiel',
  },
  {
    // ranked_mode=no, tournament_mode=yes, as recorded by the local wesnothd.
    mode: 'unranked' as const,
    fixture: 'Ranked_Classic_Maps_Turn_4_(1)__no-tournament',
    players: ['clmates', 'Caritas'],
    surrenderWinner: 'clmates',
    manualWinner: 'Caritas',
  },
];

test.afterAll(cleanupInjectedReplays);

for (const scenario of scenarios) {
  test(`tournament ${scenario.mode} 1v1 games are integrated automatically or after confirmation`, async ({ page }) => {
    test.setTimeout(600_000);
    const name = `e2e_replay_${scenario.mode}_${Date.now()}`;
    const tournamentId = await createStartedSwissTournament(page, {
      name,
      mode: scenario.mode,
      organizer,
      players: scenario.players,
      bestOf: 3,
    });
    const expectsElo = scenario.mode === 'ranked';
    const ratingsBefore = Object.fromEntries(scenario.players.map((nickname) => [nickname, getPlayerRating(nickname)]));

    // Game 1: surrender -> confidence 2, automatic.
    const [first] = getPendingTournamentGames(tournamentId);
    expect(first).toBeTruthy();
    const injected1 = injectLegacyGame({ replayFixture: `${scenario.fixture}.bz2`, gameName: name });
    const replay1 = await waitForReplayOutcome(injected1, (state) => state.parse_status !== 'new');
    expect(replay1, `game 1 replay: ${replay1.parse_status} ${replay1.parse_error_message}`).toMatchObject({
      parse_status: 'completed',
      integration_confidence: '2',
      tournament_id: tournamentId,
      tournament_game_id: first.gameId,
    });
    expect(Boolean(replay1.match_id)).toBe(expectsElo);
    expect(getTournamentGame(first.gameId)).toMatchObject({ status: 'completed', winnerNickname: scenario.surrenderWinner });

    // Game 2: no surrender -> confidence 1, a participant confirms.
    await expect.poll(() => getPendingTournamentGames(tournamentId).length, { timeout: 30_000 }).toBe(1);
    const [second] = getPendingTournamentGames(tournamentId);
    const injected2 = injectLegacyGame({ replayFixture: `${scenario.fixture}_nosurrender.bz2`, gameName: name });
    const replay2 = await waitForReplayOutcome(injected2, (state) => state.parse_status !== 'new');
    expect(replay2, `game 2 replay: ${replay2.parse_status} ${replay2.parse_error_message}`).toMatchObject({
      parse_status: 'parsed',
      integration_confidence: '1',
    });
    expect(getTournamentGame(second.gameId).status).toBe('pending');

    await loginAs(page, scenario.manualWinner);
    await page.goto(`/tournament/${tournamentId}`);
    const confirmWon = page.locator('[data-help-id="action-confirm-confidence-one-replay-won"]');
    await expect(confirmWon).toHaveCount(1, { timeout: 30_000 });
    await confirmWon.click();
    await page.locator('[data-help-id="action-submit-replay-confirmation"]').click();

    const confirmed2 = await waitForReplayOutcome(injected2, (state) => state.parse_status !== 'parsed', 60_000);
    expect(confirmed2.parse_status).toBe('completed');
    expect(Boolean(confirmed2.match_id)).toBe(expectsElo);
    expect(getTournamentGame(second.gameId)).toMatchObject({ status: 'completed', winnerNickname: scenario.manualWinner });

    // ELO: two games each; it moves only in ranked mode.
    for (const nickname of scenario.players) {
      const after = getPlayerRating(nickname);
      const before = ratingsBefore[nickname];
      expect(after.matches, `${nickname} matches`).toBe(before.matches + (expectsElo ? 2 : 0));
      if (!expectsElo) expect(after.elo, `${nickname} ELO`).toBe(before.elo);
    }
  });
}
