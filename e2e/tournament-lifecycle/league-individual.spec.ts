import { expect, test } from '@playwright/test';
import { buildFormatTemplate } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn } from '../support/uiApi';
import {
  awardSeries, closePrepareStart, competition, createTournament, englishDefaultNames, entriesBySeed,
  finalResults, groupByes, groupSeries, groupStandings, legacyFieldWrites, phaseGames, pickPlayers,
  recordWinner, registerPlayers, signInAll, tournamentRow,
} from '../support/tournamentLifecycle';

/**
 * Full individual league lifecycle with an odd field: five players in one
 * round-robin cycle, best of one, every round open at once.
 *
 * Results are recorded from the last round backwards, so rounds complete out
 * of order and the group may only close after the last pending series. Every
 * series is won by the better seed; the seed 1 against seed 5 series is an
 * administrative award.
 *
 * League rests keep their point (one per entry, as every entry rests once), so
 * seed k ends with 5 - k series wins and 6 - k points. OMP excludes rest
 * points: seed 1 faced seeds 2–5 with 3, 2, 1, and 0 wins in four series, so
 * (75 + 50 + 25 + 0) / 4 = 37.5 (62.5 if rest points counted). GWP excludes
 * the administrative game: seed 1 won 3 of 3 played games, seed 5 none of 3.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';

test('individual league with rests, out-of-order rounds, and an award', async () => {
  test.setTimeout(180_000);
  const organizer = await signIn(organizerName);
  const players = await signInAll(pickPlayers(5, [organizerName]));

  const definition = buildFormatTemplate('league', englishDefaultNames());
  definition.phases[0].default_best_of = 1;
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle league ${Date.now()}`, mode: 'unranked', definition, maxParticipants: 5,
  });
  await registerPlayers(organizer, tournamentId, players);
  await closePrepareStart(organizer, tournamentId);

  const entries = entriesBySeed(tournamentId);
  const seedOf = new Map([...entries].map(([seed, entry]) => [entry.id, seed]));
  const [phase] = await competition(tournamentId);
  const groupId = phase.group_id!;

  // Berger schedule: five rounds, two series each, one rest per round, and
  // every pairing exactly once.
  const series = groupSeries(groupId);
  expect(series).toHaveLength(10);
  expect(new Set(series.map((item) => [...item.seeds].sort().join('-'))).size).toBe(10);
  const rests = groupByes(groupId);
  expect(rests.map((rest) => rest.round)).toEqual([1, 2, 3, 4, 5]);
  expect(rests.map((rest) => rest.seed).sort()).toEqual([1, 2, 3, 4, 5]);
  expect(rests.every((rest) => rest.points === 1)).toBe(true);

  // All rounds are open together, so all ten games are pending at once.
  const pending = (await phaseGames(tournamentId)).filter((game) => game.status === 'pending');
  expect(pending).toHaveLength(10);
  pending.sort((a, b) => Number(b.round_number) - Number(a.round_number));
  for (const [index, game] of pending.entries()) {
    const [seed1, seed2] = [seedOf.get(game.entry1_id)!, seedOf.get(game.entry2_id)!];
    const winner = seed1 < seed2 ? game.entry1_id : game.entry2_id;
    const outcome = [seed1, seed2].sort().join() === '1,5'
      ? await awardSeries(organizer, tournamentId, game.series_id, winner)
      : await recordWinner(organizer, tournamentId, game.game_id, winner);
    const isLast = index === pending.length - 1;
    expect((outcome as any).tournamentCompleted, `game ${index + 1} of 10`).toBe(isLast);
    if (!isLast) {
      const [current] = await competition(tournamentId);
      expect(current.group_status, 'the group stays open until its last series').toBe('in_progress');
    }
  }

  const standings = groupStandings(groupId);
  for (const seed of [1, 2, 3, 4, 5]) {
    expect(standings.get(seed), `seed ${seed}`).toMatchObject({
      rank_position: seed, matches_played: 4, wins: 5 - seed, losses: seed - 1, byes: 1, points: 6 - seed, finalized: true,
    });
  }
  expect(standings.get(1)!.omp).toBeCloseTo(37.5, 1);
  expect(standings.get(5)!.omp).toBeCloseTo(62.5, 1);
  expect(standings.get(1)!.gwp).toBeCloseTo(100, 1);
  expect(standings.get(5)!.gwp).toBeCloseTo(0, 1);

  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'finished', finished: '1' });
  expect(finalResults(tournamentId).map((row) => [row.placement, row.seed, row.label])).toEqual([
    [1, 1, 'Champion'], [2, 2, 'Runner-up'], [3, 3, null], [4, 4, null], [5, 5, null],
  ]);
  expect(legacyFieldWrites(tournamentId)).toEqual({ participant_aggregates: 0, team_aggregates: 0, proposal_links: 0 });
});
