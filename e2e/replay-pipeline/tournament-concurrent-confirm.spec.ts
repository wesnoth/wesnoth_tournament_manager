import { expect, test } from '@playwright/test';
import { confirmTogether } from '../support/concurrentConfirm';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { localStack, runSql, sqlLiteral } from '../support/localStack';
import {
  createStartedSwissTournament,
  createStartedTeamTournament,
  getPendingTeamGames,
  getPendingTournamentGames,
  getTournamentGame,
} from '../support/tournamentSetup';

/**
 * Two players confirm the same confidence-1 tournament replay at the same
 * moment (audit findings 3–4).
 *
 * Expected for every case: exactly one confirmation succeeds and the other is
 * refused with 409, and the stored result is single and consistent (one
 * tournament result and, in ranked mode, one match and one ELO update).
 * When both players claim the win, the first claim wins; the other player
 * may dispute it afterwards, so no dispute is created automatically
 * (maintainer decision, 2026-10-05). Today the race is only stopped by
 * last-resort guards (unique index, tournament lock) and the refused request
 * answers 500, so these specs stay red until findings 3–4 are fixed.
 */
const rankedFixture = 'Ranked_Classic_Maps_Turn_2_(1)__ranked-tournament_nosurrender.bz2';
const rankedPlayers = ['Haldiel', 'clmates'];

test.afterAll(cleanupInjectedReplays);

for (const variant of [
  { label: 'won and lost', haldiel: 'action-confirm-confidence-one-replay-won', clmates: 'action-confirm-confidence-one-replay-lost' },
  { label: 'both won', haldiel: 'action-confirm-confidence-one-replay-won', clmates: 'action-confirm-confidence-one-replay-won' },
]) {
  test(`tournament ranked 1v1: simultaneous confirmations (${variant.label}) keep a single result`, async ({ page, browser }) => {
    test.setTimeout(600_000);
    const name = `e2e_concurrent_ranked_${Date.now()}`;
    const tournamentId = await createStartedSwissTournament(page, {
      name, mode: 'ranked', organizer: 'Blair', players: rankedPlayers, bestOf: 1,
    });
    const [pending] = getPendingTournamentGames(tournamentId);
    const before = Object.fromEntries(rankedPlayers.map((p) => [p, getPlayerRating(p)]));

    const game = injectLegacyGame({ replayFixture: rankedFixture, gameName: name });
    const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
    expect(parsed).toMatchObject({ parse_status: 'parsed', integration_confidence: '1', tournament_game_id: pending.gameId });

    const statuses = await confirmTogether(browser, `/tournament/${tournamentId}`, [
      { nickname: 'Haldiel', choice: variant.haldiel },
      { nickname: 'clmates', choice: variant.clmates },
    ]);
    console.log(`confirm-winner statuses (Haldiel, clmates): ${statuses.join(', ')}`);

    // One match, one tournament result, the same match on both sides.
    const db = localStack.tournamentDb;
    const [counts] = runSql(
      `SELECT (SELECT COUNT(*) FROM ${db}.matches WHERE replay_id = ${sqlLiteral(parsed.id)}) AS replay_matches,
              (SELECT COUNT(*) FROM ${db}.matches WHERE tournament_id = ${sqlLiteral(tournamentId)}) AS tournament_matches;`,
    );
    expect(Number(counts.replay_matches)).toBe(1);
    expect(Number(counts.tournament_matches)).toBe(1);
    const result = getTournamentGame(pending.gameId);
    expect(result.status).toBe('completed');
    for (const p of rankedPlayers) expect(getPlayerRating(p).matches, `${p} matches`).toBe(before[p].matches + 1);

    if (variant.label === 'both won') {
      // The accepted claim decides the winner everywhere.
      const acceptedNickname = statuses[0] === 200 ? 'Haldiel' : 'clmates';
      expect(result.winnerNickname).toBe(acceptedNickname);
    } else {
      expect(result.winnerNickname).toBe('Haldiel');
    }
    expect([...statuses].sort()).toEqual([200, 409]);
  });
}

test('tournament team 2v2: simultaneous confirmations from opposite teams keep a single result', async ({ page, browser }) => {
  test.setTimeout(600_000);
  const name = `e2e_concurrent_team_${Date.now()}`;
  // Real 1.18.7 team replay without any surrender: south-west turkish001 +
  // Olosta against north-east KhorneflakesBA + clmates. No alliance
  // surrendered as a whole, so the result stays at confidence 1 and players
  // confirm it (a whole-team surrender is integrated automatically, see
  // tournament-team.spec.ts). The confirmations decide the winner here.
  const winners = 'turkish001 & Olosta';
  const losers = 'clmates & KhorneflakesBA';
  const tournamentId = await createStartedTeamTournament(page, {
    name,
    organizer: 'clmates',
    teams: [
      { name: losers, members: ['clmates', 'KhorneflakesBA'] },
      { name: winners, members: ['turkish001', 'Olosta'] },
    ],
  });
  const [pending] = getPendingTeamGames(tournamentId);

  // Forum rows mirror a production game of this tournament (2026-04): Ladder
  // era add-on, Ranked 1.0.6, mainline scenario; factions come from the WML.
  const game = injectLegacyGame({
    replayFixture: '4p__Isars_Cross_Turn_13_(14753).bz2',
    gameName: name,
    content: {
      era: { id: 'ladder_era', addonId: 'Ladder_Era', addonVersion: '1.2.1', name: 'Ladder Era' },
      scenario: { id: 'multiplayer_Isars_Cross', addonId: 'mainline', addonVersion: '1.18.7', name: '4p — Isar’s Cross' },
      rankedAddonVersion: '1.0.6',
    },
  });
  const parsed = await waitForReplayOutcome(game, (state) => state.parse_status !== 'new');
  expect(parsed).toMatchObject({ parse_status: 'parsed', integration_confidence: '1', tournament_game_id: pending.gameId });

  const statuses = await confirmTogether(browser, `/tournament/${tournamentId}`, [
    { nickname: 'Olosta', choice: 'action-confirm-confidence-one-replay-won' },
    { nickname: 'clmates', choice: 'action-confirm-confidence-one-replay-lost' },
  ], [winners, losers]);
  console.log(`confirm-winner statuses (Olosta, clmates): ${statuses.join(', ')}`);

  const result = getTournamentGame(pending.gameId);
  expect(result.status).toBe('completed');
  expect(result.winnerTeamName).toBe(winners);
  expect(result.matchId).toBeNull();
  const [series] = runSql(
    `SELECT COUNT(*) AS games FROM ${localStack.tournamentDb}.tournament_games
     WHERE series_id = (SELECT series_id FROM ${localStack.tournamentDb}.tournament_games WHERE id = ${sqlLiteral(pending.gameId)});`,
  );
  expect(Number(series.games)).toBe(1);
  expect([...statuses].sort()).toEqual([200, 409]);
});
