import { expect, test } from '@playwright/test';
import type { TournamentFormatDefinition } from '../../frontend/src/types/tournament';
import { buildPhaseDefinition, newDefinitionId } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn } from '../support/uiApi';
import {
  closePrepareStart, competition, createTournament, englishDefaultNames, entriesBySeed, finalResults,
  groupSeries, groupStandings, legacyFieldWrites, participants, phaseGames, pickPlayers, recordWinner,
  registerTeams, signInAll, startPhase, tournamentRow,
} from '../support/tournamentLifecycle';

/**
 * Team lifecycle: four 2v2 teams play two Swiss rounds (best of one), and the
 * top two meet in a best-of-three final.
 *
 * Teams register as the join modal does: the captain creates the team and
 * invites the teammate, who confirms; the organizer accepts both. Assertions
 * are by initial seed, so they hold whatever team ELO the members have.
 *
 * The better seed wins every series: round 1 (FIDE split) 1–3 and 2–4, round
 * 2 1–2 and 3–4. Seeds 2 and 3 tie on points, wins, OMP, GWP, and OGP, so the
 * initial seed ranks seed 2 second. The final goes to seed 1, 2–0.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';

test('team Swiss into a best-of-three final', async () => {
  test.setTimeout(180_000);
  const organizer = await signIn(organizerName);
  const members = await signInAll(pickPlayers(8, [organizerName]));
  const stamp = Date.now();
  const teams = [0, 1, 2, 3].map((index) => ({
    name: `Lifecycle team ${index + 1} ${stamp}`, captain: members[index * 2], teammate: members[index * 2 + 1],
  }));

  const names = englishDefaultNames();
  const swiss = buildPhaseDefinition('Swiss', 1, 'swiss', names);
  swiss.default_best_of = 1;
  swiss.swiss = { round_count: 2, avoid_rematches: true };
  swiss.groups[0].advance_count = 2;
  const final = buildPhaseDefinition('Final', 2, 'single_elimination', names);
  final.default_best_of = 3;
  const definition: TournamentFormatDefinition = {
    phases: [swiss, final],
    advancement_rules: [1, 2].map((rank) => ({
      id: newDefinitionId(), source_group_id: swiss.groups[0].id, source_rank: rank,
      target_group_id: final.groups[0].id, target_seed: rank,
    })),
  };
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle team Swiss ${stamp}`, mode: 'team', definition, maxParticipants: 4,
  });
  await registerTeams(organizer, tournamentId, teams);
  const roster = await participants(tournamentId);
  expect(roster).toHaveLength(8);
  expect(roster.every((row) => row.participation_status === 'accepted' && row.team_id)).toBe(true);
  await closePrepareStart(organizer, tournamentId);

  // One team entry per team, named after the team.
  const entries = entriesBySeed(tournamentId);
  expect([...entries.values()].map((entry) => entry.name).sort()).toEqual(teams.map((team) => team.name).sort());
  const seedOf = new Map([...entries].map(([seed, entry]) => [entry.id, seed]));
  const play = async (phaseId: string, winnerFor = (seed1: number, seed2: number) => Math.min(seed1, seed2)) => {
    for (;;) {
      const pending = (await phaseGames(tournamentId)).filter((game) => game.phase_id === phaseId && game.status === 'pending');
      if (!pending.length) return;
      for (const game of pending) {
        const winnerSeed = winnerFor(seedOf.get(game.entry1_id)!, seedOf.get(game.entry2_id)!);
        await recordWinner(organizer, tournamentId, game.game_id, seedOf.get(game.entry1_id) === winnerSeed ? game.entry1_id : game.entry2_id);
      }
    }
  };
  await play(swiss.id);

  expect(groupSeries(swiss.groups[0].id).map((series) => [series.round, series.seeds, series.winnerSeed])).toEqual([
    [1, [1, 3], 1], [1, [2, 4], 2], [2, [1, 2], 1], [2, [3, 4], 3],
  ]);
  const standings = groupStandings(swiss.groups[0].id);
  expect([1, 2, 3, 4].map((seed) => [standings.get(seed)!.rank_position, standings.get(seed)!.points])).toEqual([
    [1, 2], [2, 1], [3, 1], [4, 0],
  ]);
  expect(standings.get(2)!.omp).toBeCloseTo(standings.get(3)!.omp, 5);

  expect((await competition(tournamentId)).find((row) => row.phase_id === final.id)!.phase_status).toBe('ready');
  await startPhase(organizer, tournamentId, final.id);
  await play(final.id);
  expect(groupSeries(final.groups[0].id).map((series) => [series.seeds, series.winnerSeed, series.status])).toEqual([
    [[1, 2], 1, 'completed'],
  ]);
  const finalStandings = groupStandings(final.groups[0].id);
  expect(finalStandings.get(1)!.gwp).toBeCloseTo(100, 1);

  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'finished', finished: '1' });
  expect(finalResults(tournamentId).map((row) => [row.placement, row.seed, row.label])).toEqual([
    [1, 1, 'Champion'], [2, 2, 'Runner-up'],
  ]);
  expect(legacyFieldWrites(tournamentId)).toEqual({ participant_aggregates: 0, team_aggregates: 0, proposal_links: 0 });
});
