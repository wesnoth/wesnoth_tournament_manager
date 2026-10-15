import { expect, test } from '@playwright/test';
import { buildFormatTemplate } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn } from '../support/uiApi';
import {
  closePrepareStart, competition, createTournament, englishDefaultNames, entriesBySeed, finalResults,
  groupByes, groupStandings, legacyFieldWrites, phaseGames, pickPlayers, recordWinner, registerTeams,
  signInAll, tournamentRow,
} from '../support/tournamentLifecycle';

/**
 * Team league with an odd field: three 2v2 teams, one round-robin cycle, best
 * of one, created from the phase builder's league template. Each team rests
 * once and keeps the rest point; the better seed wins every series, so seed k
 * ends with 3 - k series wins and 4 - k points.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';

test('team league with rests', async () => {
  const organizer = await signIn(organizerName);
  const members = await signInAll(pickPlayers(6, [organizerName]));
  const stamp = Date.now();
  const teams = [0, 1, 2].map((index) => ({
    name: `Lifecycle league team ${index + 1} ${stamp}`, captain: members[index * 2], teammate: members[index * 2 + 1],
  }));

  const definition = buildFormatTemplate('league', englishDefaultNames());
  definition.phases[0].default_best_of = 1;
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle team league ${stamp}`, mode: 'team', definition, maxParticipants: 3,
  });
  await registerTeams(organizer, tournamentId, teams);
  await closePrepareStart(organizer, tournamentId);

  const entries = entriesBySeed(tournamentId);
  const seedOf = new Map([...entries].map(([seed, entry]) => [entry.id, seed]));
  const [phase] = await competition(tournamentId);
  const groupId = phase.group_id!;
  expect(groupByes(groupId).map((rest) => rest.seed).sort()).toEqual([1, 2, 3]);

  const pending = (await phaseGames(tournamentId)).filter((game) => game.status === 'pending');
  expect(pending).toHaveLength(3);
  for (const game of pending) {
    const winner = seedOf.get(game.entry1_id)! < seedOf.get(game.entry2_id)! ? game.entry1_id : game.entry2_id;
    await recordWinner(organizer, tournamentId, game.game_id, winner);
  }

  const standings = groupStandings(groupId);
  for (const seed of [1, 2, 3]) {
    expect(standings.get(seed), `seed ${seed}`).toMatchObject({
      rank_position: seed, matches_played: 2, wins: 3 - seed, byes: 1, points: 4 - seed, finalized: true,
    });
  }
  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'finished', finished: '1' });
  expect(finalResults(tournamentId).map((row) => [row.placement, row.seed])).toEqual([[1, 1], [2, 2], [3, 3]]);
  expect(legacyFieldWrites(tournamentId)).toEqual({ participant_aggregates: 0, team_aggregates: 0, proposal_links: 0 });
});
