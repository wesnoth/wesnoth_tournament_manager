import { expect, test } from '@playwright/test';
import type { TournamentFormatDefinition } from '../../frontend/src/types/tournament';
import { buildPhaseDefinition, newDefinitionId } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn, uiRequest } from '../support/uiApi';
import {
  closePrepareStart, competition, createTournament, englishDefaultNames, entriesBySeed, finalResults,
  groupSeries, groupStandings, legacyFieldWrites, participants, phaseGames, pickPlayers, recordWinner,
  registerPlayers, signInAll, startPhase, tournamentRow,
} from '../support/tournamentLifecycle';

/**
 * Mixed individual lifecycle: two league groups feed an elimination bracket
 * that also reserves one direct pass, best of one throughout.
 *
 * Seven players register; the strongest (seed 1) gets the direct pass and
 * skips the leagues. Seeded snake places seeds 2, 5, 6 in group A and 3, 4, 7
 * in group B. Rules map A1, B1, A2, B2 to bracket seeds 1–4, so the bracket
 * needs eight slots. The interface sends only the target group and round, and
 * the backend places the pass in the first round-1 slot that bypasses no mapped
 * qualifier: series 1, slot 2, against bracket seed 1 (group A's winner).
 *
 * With the better seed winning every series: the direct pass beats seed 2,
 * seeds 4, 3, and 5 advance by structural byes, semifinals 1–4 and 3–5 go to
 * seeds 1 and 3, seed 1 wins the final, and seed 4 the bronze. Final results
 * come from the last phase only, so the two group-stage eliminations (seeds 6
 * and 7) get no placement row.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';

test('individual leagues into an elimination bracket with a direct pass', async () => {
  test.setTimeout(180_000);
  const organizer = await signIn(organizerName);
  const players = await signInAll(pickPlayers(7, [organizerName]));

  const names = englishDefaultNames();
  const leagues = buildPhaseDefinition('Leagues', 1, 'round_robin', names, 2);
  leagues.default_best_of = 1;
  leagues.groups.forEach((group) => { group.advance_count = 2; });
  const bracket = buildPhaseDefinition('Bracket', 2, 'single_elimination', names, 1);
  bracket.default_best_of = 1;
  bracket.groups[0].direct_advancement_slots = 1;
  const [groupA, groupB] = leagues.groups;
  const target = bracket.groups[0];
  const definition: TournamentFormatDefinition = {
    phases: [leagues, bracket],
    advancement_rules: [[groupA, 1, 1], [groupB, 1, 2], [groupA, 2, 3], [groupB, 2, 4]].map(([group, rank, seed]) => ({
      id: newDefinitionId(), source_group_id: (group as typeof groupA).id, source_rank: rank as number,
      target_group_id: target.id, target_seed: seed as number,
    })),
  };
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle mixed ${Date.now()}`, mode: 'unranked', definition, maxParticipants: 7,
  });
  await registerPlayers(organizer, tournamentId, players);

  // Direct pass for the strongest player, as the participants tab saves it.
  const champion = (await participants(tournamentId)).find((row) => row.user_id === players[0].userId)!;
  const { data: placement } = await uiRequest(organizer, 'PUT', '/tournaments/:id/direct-pass/:entityType/:entityId', {
    params: { id: tournamentId, entityType: 'participant', entityId: champion.id },
    body: { group_id: target.id, round_number: 1, note: '' },
  });
  expect(placement).toMatchObject({ round_number: 1, series_position: 1, slot_number: 2 });

  await closePrepareStart(organizer, tournamentId);
  const entries = entriesBySeed(tournamentId);
  const seedOf = new Map([...entries].map(([seed, entry]) => [entry.id, seed]));
  // Phase and group ids are the client-generated ids of the definition.
  // Seed 1 is reserved for the bracket; the leagues hold the other six.
  const membersOf = (groupId: string) => [...groupStandings(groupId).keys()].sort();
  expect(membersOf(groupA.id)).toEqual([2, 5, 6]);
  expect(membersOf(groupB.id)).toEqual([3, 4, 7]);

  const playAll = async (phaseId: string) => {
    for (;;) {
      const pending = (await phaseGames(tournamentId)).filter((game) => game.phase_id === phaseId && game.status === 'pending');
      if (!pending.length) return;
      for (const game of pending) {
        const winner = seedOf.get(game.entry1_id)! < seedOf.get(game.entry2_id)! ? game.entry1_id : game.entry2_id;
        await recordWinner(organizer, tournamentId, game.game_id, winner);
      }
    }
  };
  await playAll(leagues.id);

  for (const [groupId, seeds] of [[groupA.id, [2, 5, 6]], [groupB.id, [3, 4, 7]]] as const) {
    const standings = groupStandings(groupId);
    // Three entries: two series and one rest point each.
    expect(seeds.map((seed) => [standings.get(seed)!.rank_position, standings.get(seed)!.points])).toEqual([[1, 3], [2, 2], [3, 1]]);
  }

  // Advancement compiled the bracket; it waits for the organizer to start it.
  const bracketRow = (await competition(tournamentId)).find((row) => row.phase_id === bracket.id)!;
  expect(bracketRow.phase_status).toBe('ready');
  expect(groupSeries(target.id).filter((series) => series.round === 1)).toEqual([
    { round: 1, position: 1, role: 'main', status: 'ready', seeds: [2, 1], winnerSeed: null },
    { round: 1, position: 2, role: 'main', status: 'completed', seeds: [4, null], winnerSeed: 4 },
    { round: 1, position: 3, role: 'main', status: 'completed', seeds: [3, null], winnerSeed: 3 },
    { round: 1, position: 4, role: 'main', status: 'completed', seeds: [5, null], winnerSeed: 5 },
  ]);
  await startPhase(organizer, tournamentId, bracket.id);
  await playAll(bracket.id);

  expect(groupSeries(target.id).filter((series) => series.round > 1).map((series) => [series.round, series.role, series.seeds, series.winnerSeed]))
    .toEqual([
      [2, 'main', [1, 4], 1],
      [2, 'main', [3, 5], 3],
      [3, 'main', [1, 3], 1],
      [3, 'third_place', [4, 5], 4],
    ]);
  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'finished', finished: '1' });
  expect(finalResults(tournamentId).map((row) => [row.placement, row.seed, row.label])).toEqual([
    [1, 1, 'Champion'], [2, 3, 'Runner-up'], [3, 4, 'Third place'], [4, 5, null], [5, 2, null],
  ]);
  expect(legacyFieldWrites(tournamentId)).toEqual({ participant_aggregates: 0, team_aggregates: 0, proposal_links: 0 });
});
