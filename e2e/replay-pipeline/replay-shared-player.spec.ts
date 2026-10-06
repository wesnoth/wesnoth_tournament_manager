import { expect, test } from '@playwright/test';
import { confirmRankedTogether } from '../support/concurrentConfirm';
import { cleanupInjectedReplays, getPlayerRating, injectLegacyGame, waitForReplayOutcome } from '../support/forumFixtures';
import { localStack, runSql, sqlLiteral } from '../support/localStack';

/**
 * Two different replays that share a player are confirmed at the same moment
 * (audit finding 4).
 *
 * clmates has a pending replay against Blop and another against Haldiel;
 * Blop and Haldiel each confirm their win simultaneously. Both results are
 * valid, so both requests must succeed. Before finding 4 each integration
 * read clmates' ELO, computed in memory, and wrote it back without a lock, so
 * one update could overwrite the other. With the user rows locked, the two
 * matches serialize: the ELO clmates had before one match is the ELO left by
 * the other, and the final rating is the last of the chain.
 */
const shared = 'clmates';
const games = [
  { opponent: 'Blop', fixture: 'Ranked_Classic_Maps_Turn_2_(2)__no-tournament_nosurrender.bz2' },
  // Fixture names predate the parser fix (0dacb62): both are ranked_mode=yes,
  // tournament_mode=no, i.e. standalone ranked games.
  { opponent: 'Haldiel', fixture: 'Ranked_Classic_Maps_Turn_2_(1)__tournament_nosurrender.bz2' },
];

test.afterAll(cleanupInjectedReplays);

test('simultaneous confirmations of two replays sharing a player chain the ELO updates', async ({ browser }) => {
  test.setTimeout(400_000);
  const sharedBefore = getPlayerRating(shared);
  const injected = games.map((g) => ({ ...g, game: injectLegacyGame({ replayFixture: g.fixture }) }));
  const parsed = await Promise.all(injected.map(({ game }) =>
    waitForReplayOutcome(game, (state) => state.parse_status !== 'new')));
  for (const state of parsed) expect(state).toMatchObject({ parse_status: 'parsed', integration_confidence: '1' });

  const statuses = await confirmRankedTogether(browser, injected.map(({ opponent, game }) => ({
    nickname: opponent, choice: 'action-confirm-ranked-replay-won', replayName: game.replayName,
  })));
  console.log(`confirm-winner statuses (${games.map((g) => g.opponent).join(', ')}): ${statuses.join(', ')}`);
  expect(statuses).toEqual([200, 200]);

  const matches = runSql(
    `SELECT m.loser_elo_before AS eloBefore, m.loser_elo_after AS eloAfter
     FROM ${localStack.tournamentDb}.matches m
     JOIN ${localStack.tournamentDb}.users_extension u ON u.id = m.loser_id
     WHERE LOWER(u.nickname) = LOWER(${sqlLiteral(shared)})
       AND m.replay_id IN (${parsed.map((s) => sqlLiteral(s.id)).join(', ')})
     ORDER BY m.created_at;`,
  ).map((row) => ({ before: Number(row.eloBefore), after: Number(row.eloAfter) }));
  expect(matches).toHaveLength(2);

  // Whatever order the locks granted, the two matches form one chain that
  // starts at the original rating and ends at the stored one.
  const first = matches.find((m) => m.before === sharedBefore.elo);
  expect(first, `a match must start from ${shared}'s original ELO ${sharedBefore.elo}: ${JSON.stringify(matches)}`).toBeDefined();
  const second = matches.find((m) => m !== first)!;
  expect(second.before).toBe(first!.after);
  const sharedAfter = getPlayerRating(shared);
  expect(sharedAfter.elo).toBe(second.after);
  expect(sharedAfter.matches).toBe(sharedBefore.matches + 2);
});
