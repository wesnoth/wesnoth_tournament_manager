import { expect, test } from '@playwright/test';
import { cleanupInjectedReplays, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { createStartedTeamTournament, getPendingTeamGames, getTournamentGame } from '../support/tournamentSetup';

/**
 * A team game decided by a whole-team surrender is integrated automatically
 * (maintainer rule, 2026-10-07).
 *
 * Real 1.18.7 replay: south-west NanRoig (side 1) + Danniel_BR (side 4)
 * against north-east clmates (side 2) + KhorneflakesBA (side 3). Both
 * north-east players surrender, with sides changing control along the way.
 * The parser decides the game alliance by alliance; the job accepts the
 * result only because the alliances are exactly the two tournament teams,
 * so the game completes without any player confirmation.
 */
test.afterAll(cleanupInjectedReplays);

test('tournament team 2v2: a whole-team surrender is integrated automatically', async ({ page }) => {
  test.setTimeout(600_000);
  const name = `e2e_team_surrender_${Date.now()}`;
  const winners = 'NanRoig & Danniel_BR';
  const losers = 'clmates & KhorneflakesBA';
  const tournamentId = await createStartedTeamTournament(page, {
    name,
    organizer: 'clmates',
    teams: [
      { name: losers, members: ['clmates', 'KhorneflakesBA'] },
      { name: winners, members: ['NanRoig', 'Danniel_BR'] },
    ],
  });
  const [pending] = getPendingTeamGames(tournamentId);

  const game = injectLegacyGame({
    replayFixture: '4p__Isars_Cross_Turn_8_(27635).bz2',
    gameName: name,
    content: {
      era: { id: 'ladder_era', addonId: 'Ladder_Era', addonVersion: '1.2.1', name: 'Ladder Era' },
      scenario: { id: 'multiplayer_Isars_Cross', addonId: 'mainline', addonVersion: '1.18.7', name: '4p — Isar’s Cross' },
      rankedAddonVersion: '1.0.6',
    },
  });
  const completed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(completed, `replay ended as ${completed.parse_status}: ${completed.parse_error_message}`).toMatchObject({
    parse_status: 'completed',
    integration_confidence: '2',
    tournament_game_id: pending.gameId,
  });

  const result = getTournamentGame(pending.gameId);
  expect(result.status).toBe('completed');
  expect(result.winnerTeamName).toBe(winners);
  // Unranked team games have no global match; automatic integration does not
  // impersonate the winners' report.
  expect(result.matchId).toBeNull();
  expect(result.confirmationStatus).toBe('unconfirmed');
});
