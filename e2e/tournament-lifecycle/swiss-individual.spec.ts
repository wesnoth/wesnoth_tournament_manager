import { expect, test } from '@playwright/test';
import { buildFormatTemplate } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn } from '../support/uiApi';
import {
  closePrepareStart, competition, createTournament, englishDefaultNames, entriesBySeed, finalResults,
  groupByes, groupSeries, groupStandings, legacyFieldWrites, participants, phaseGames, pickPlayers,
  recordWinner, registerPlayers, signInAll, tournamentRow,
} from '../support/tournamentLifecycle';

/**
 * Full individual Swiss lifecycle with an odd field: five players, three
 * rounds, best of one, created from the phase builder's Swiss template.
 *
 * Every series is won by the better (lower) initial seed, so pairings, byes,
 * standings, tiebreakers, and placements are fixed and were computed by hand:
 *
 * - Round 1 (FIDE split, lowest seed sits out): 1–3, 2–4, bye 5.
 * - Round 2 (bye to the lowest-ranked entry without one): bye 4; 1–2, 5–3.
 * - Round 3: bye 3; 1–4 (1–2 already played), 2–5.
 *
 * OMP excludes bye points: seed 5 faced seeds 3 (1 win in 2 played) and 2
 * (2 of 3), so its OMP is (50 + 66.67) / 2 = 58.33. Counting bye points would
 * have rated seed 3 at 100% and given 83.33.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';

test('individual Swiss with an odd field runs from creation to final standings', async () => {
  test.setTimeout(180_000);
  const organizer = await signIn(organizerName);
  const players = await signInAll(pickPlayers(5, [organizerName]));

  const definition = buildFormatTemplate('swiss', englishDefaultNames());
  definition.phases[0].default_best_of = 1;
  definition.phases[0].swiss = { round_count: 3, avoid_rematches: true };
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle Swiss ${Date.now()}`, mode: 'unranked', definition, maxParticipants: 5,
  });
  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'registration_open', competition_model_version: '2' });

  await registerPlayers(organizer, tournamentId, players);
  expect((await participants(tournamentId)).every((row) => row.participation_status === 'accepted')).toBe(true);
  await closePrepareStart(organizer, tournamentId);

  // Seeds follow ELO, strongest first, because nobody has a tournament ranking.
  const entries = entriesBySeed(tournamentId);
  expect([...entries.values()].map((entry) => entry.name)).toEqual(players.map((player) => player.nickname));
  const seedOf = new Map([...entries].map(([seed, entry]) => [entry.id, seed]));
  const [phase] = await competition(tournamentId);
  const groupId = phase.group_id!;

  // Points after each round already include the bye of the next round: the
  // round that completes pairs its successor in the same transaction.
  const expectedRounds: Array<{ pairs: Array<[number, number]>; bye: number; points: number[] }> = [
    { pairs: [[1, 3], [2, 4]], bye: 5, points: [1, 1, 0, 1, 1] },
    { pairs: [[1, 2], [5, 3]], bye: 4, points: [2, 1, 2, 1, 1] },
    { pairs: [[1, 4], [2, 5]], bye: 3, points: [3, 2, 2, 1, 1] },
  ];
  for (const [index, expected] of expectedRounds.entries()) {
    const round = index + 1;
    // Only the open round has games: Swiss rounds are paired after the
    // previous round's standings are final.
    const pending = (await phaseGames(tournamentId)).filter((game) => game.status === 'pending');
    expect(pending.every((game) => Number(game.round_number) === round), `only round ${round} is open`).toBe(true);
    expect(pending.map((game) => [seedOf.get(game.entry1_id), seedOf.get(game.entry2_id)])).toEqual(expected.pairs);
    expect(groupByes(groupId).filter((bye) => bye.round === round)).toEqual([{ round, seed: expected.bye, points: 1 }]);

    for (const game of pending) {
      const winner = seedOf.get(game.entry1_id)! < seedOf.get(game.entry2_id)! ? game.entry1_id : game.entry2_id;
      const outcome = await recordWinner(organizer, tournamentId, game.game_id, winner);
      expect(outcome.seriesCompleted).toBe(true);
    }
    const standings = groupStandings(groupId);
    expect([1, 2, 3, 4, 5].map((seed) => standings.get(seed)!.points), `points after round ${round}`).toEqual(expected.points);
  }

  // Every round closed, nothing pending, and no entry had two byes.
  const series = groupSeries(groupId);
  expect(series.every((item) => item.status === 'completed')).toBe(true);
  expect(series.map((item) => item.winnerSeed)).toEqual([1, 2, 1, 3, 1, 2]);
  expect(new Set(groupByes(groupId).map((bye) => bye.seed)).size).toBe(3);

  const standings = groupStandings(groupId);
  const expectedStandings = [
    { seed: 1, rank_position: 1, matches_played: 3, wins: 3, losses: 0, byes: 0, points: 3, omp: 38.89, gwp: 100, ogp: 38.89 },
    { seed: 2, rank_position: 2, matches_played: 3, wins: 2, losses: 1, byes: 0, points: 2, omp: 33.33, gwp: 66.67, ogp: 33.33 },
    { seed: 3, rank_position: 3, matches_played: 2, wins: 1, losses: 1, byes: 1, points: 2, omp: 50, gwp: 50, ogp: 50 },
    { seed: 4, rank_position: 4, matches_played: 2, wins: 0, losses: 2, byes: 1, points: 1, omp: 83.33, gwp: 0, ogp: 83.33 },
    { seed: 5, rank_position: 5, matches_played: 2, wins: 0, losses: 2, byes: 1, points: 1, omp: 58.33, gwp: 0, ogp: 58.33 },
  ];
  for (const expected of expectedStandings) {
    const actual = standings.get(expected.seed)!;
    expect({ ...actual, omp: undefined, gwp: undefined, ogp: undefined }, `seed ${expected.seed}`).toEqual({
      ...expected, omp: undefined, gwp: undefined, ogp: undefined, finalized: true,
    });
    expect(actual.omp, `OMP of seed ${expected.seed}`).toBeCloseTo(expected.omp, 1);
    expect(actual.gwp, `GWP of seed ${expected.seed}`).toBeCloseTo(expected.gwp, 1);
    expect(actual.ogp, `OGP of seed ${expected.seed}`).toBeCloseTo(expected.ogp, 1);
  }

  // The only phase completed, so the tournament finished with its placements.
  const [finishedPhase] = await competition(tournamentId);
  expect(finishedPhase).toMatchObject({ phase_status: 'completed', group_status: 'completed' });
  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'finished', finished: '1' });
  expect(finalResults(tournamentId)).toEqual([
    { seed: 1, placement: 1, label: 'Champion', champion: true },
    { seed: 2, placement: 2, label: 'Runner-up', champion: false },
    { seed: 3, placement: 3, label: null, champion: false },
    { seed: 4, placement: 4, label: null, champion: false },
    { seed: 5, placement: 5, label: null, champion: false },
  ]);
  expect(legacyFieldWrites(tournamentId)).toEqual({ participant_aggregates: 0, team_aggregates: 0, proposal_links: 0 });
});
