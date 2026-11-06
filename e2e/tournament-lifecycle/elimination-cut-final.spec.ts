import { expect, test } from '@playwright/test';
import type { TournamentFormatDefinition } from '../../frontend/src/types/tournament';
import { buildPhaseDefinition, newDefinitionId } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn } from '../support/uiApi';
import {
  closePrepareStart, competition, createTournament, englishDefaultNames, entriesBySeed, finalResults,
  groupSeries, groupStandings, legacyFieldWrites, noLegacyWrites, phaseGames, pickPlayers, recordWinner,
  registerPlayers, signInAll, startPhase, tournamentRow,
} from '../support/tournamentLifecycle';
import { localStack, runSql, sqlLiteral } from '../support/localStack';

/**
 * Two consecutive elimination phases: a league of four feeds a Top Cut that
 * hands two qualifiers to a Grand final.
 *
 * The Top Cut must stop after its semifinals (four entrants, two qualifiers),
 * so its finalists do not meet twice. Per-round best-of is counted from the
 * last played round: the Top Cut defaults to best of three but its last round
 * (the semifinals) is overridden to best of one, and the Grand final defaults
 * to best of one with its final overridden to best of three.
 *
 * The league goes to the better seed in every game, so league ranks equal
 * initial seeds and the Top Cut pairs 1–4 and 2–3. Seed 4 upsets seed 1 and
 * seed 2 beats seed 3: both survivors hold one win, and the tied group
 * tiebreakers fall back to the initial seed, so seed 2 qualifies first. Seed 4
 * wins the Grand final 2–0.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';
const db = localStack.tournamentDb;

/** Best-of of every series of a group, by round, as compiled. */
function seriesBestOf(groupId: string): Array<[number, number]> {
  return runSql(
    `SELECT r.round_number, s.best_of
     FROM ${db}.tournament_series s
     JOIN ${db}.tournament_phase_rounds r ON r.id = s.round_id
     WHERE r.group_id = ${sqlLiteral(groupId)}
     ORDER BY r.round_number, s.series_position;`,
  ).map((row) => [Number(row.round_number), Number(row.best_of)]);
}

test('a Top Cut feeding a Grand final stops before its own final', async () => {
  test.setTimeout(180_000);
  const organizer = await signIn(organizerName);
  const players = await signInAll(pickPlayers(4, [organizerName]));

  const names = englishDefaultNames();
  const league = buildPhaseDefinition('League', 1, 'round_robin', names);
  league.default_best_of = 1;
  league.groups[0].advance_count = 4;
  const topCut = buildPhaseDefinition('Top Cut', 2, 'single_elimination', names);
  topCut.default_best_of = 3;
  topCut.round_overrides = [{ id: newDefinitionId(), round_from_end: 1, best_of: 1 }];
  topCut.groups[0].advance_count = 2;
  const grandFinal = buildPhaseDefinition('Grand final', 3, 'single_elimination', names);
  grandFinal.default_best_of = 1;
  grandFinal.round_overrides = [{ id: newDefinitionId(), round_from_end: 1, best_of: 3 }];
  const definition: TournamentFormatDefinition = {
    phases: [league, topCut, grandFinal],
    advancement_rules: [
      ...[1, 2, 3, 4].map((rank) => ({
        id: newDefinitionId(), source_group_id: league.groups[0].id, source_rank: rank,
        target_group_id: topCut.groups[0].id, target_seed: rank,
      })),
      ...[1, 2].map((rank) => ({
        id: newDefinitionId(), source_group_id: topCut.groups[0].id, source_rank: rank,
        target_group_id: grandFinal.groups[0].id, target_seed: rank,
      })),
    ],
  };
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle cut bracket ${Date.now()}`, mode: 'unranked', definition, maxParticipants: 4,
  });
  await registerPlayers(organizer, tournamentId, players);
  await closePrepareStart(organizer, tournamentId);

  const entries = entriesBySeed(tournamentId);
  const seedOf = new Map([...entries].map(([seed, entry]) => [entry.id, seed]));
  const entryOf = (seed: number) => entries.get(seed)!.id;
  const pendingIn = async (phaseId: string) =>
    (await phaseGames(tournamentId)).filter((game) => game.phase_id === phaseId && game.status === 'pending');

  for (const game of await pendingIn(league.id)) {
    const better = Math.min(seedOf.get(game.entry1_id)!, seedOf.get(game.entry2_id)!);
    await recordWinner(organizer, tournamentId, game.game_id, entryOf(better));
  }
  const leagueStandings = groupStandings(league.groups[0].id);
  expect([1, 2, 3, 4].map((seed) => leagueStandings.get(seed)!.rank_position)).toEqual([1, 2, 3, 4]);

  // Only the semifinals exist, at the overridden best of one.
  const topCutGroup = topCut.groups[0].id;
  expect((await competition(tournamentId)).find((row) => row.phase_id === topCut.id)!.phase_status).toBe('ready');
  expect(groupSeries(topCutGroup).map((series) => [series.round, series.seeds])).toEqual([
    [1, [1, 4]], [1, [2, 3]],
  ]);
  expect(seriesBestOf(topCutGroup)).toEqual([[1, 1], [1, 1]]);

  await startPhase(organizer, tournamentId, topCut.id);
  const semifinals = await pendingIn(topCut.id);
  expect(semifinals).toHaveLength(2);
  for (const game of semifinals) {
    const seeds = [seedOf.get(game.entry1_id)!, seedOf.get(game.entry2_id)!].sort().join();
    await recordWinner(organizer, tournamentId, game.game_id, entryOf(seeds === '1,4' ? 4 : 2));
  }

  // Bracket progress ranks the survivors first; the tiebreakers order each tier.
  const topCutStandings = groupStandings(topCutGroup);
  expect([2, 4, 1, 3].map((seed) => topCutStandings.get(seed)!.rank_position)).toEqual([1, 2, 3, 4]);
  expect(tournamentRow(tournamentId).status, 'the Grand final is still to play').toBe('in_progress');

  // The Grand final receives the two survivors in one best-of-three series.
  const finalGroup = grandFinal.groups[0].id;
  expect(groupSeries(finalGroup).map((series) => [series.round, series.seeds])).toEqual([[1, [2, 4]]]);
  expect(seriesBestOf(finalGroup)).toEqual([[1, 3]]);
  await startPhase(organizer, tournamentId, grandFinal.id);
  const firstGame = await recordWinner(organizer, tournamentId, (await pendingIn(grandFinal.id))[0].game_id, entryOf(4));
  expect(firstGame.seriesCompleted).toBe(false);
  const lastGame = await recordWinner(organizer, tournamentId, (await pendingIn(grandFinal.id))[0].game_id, entryOf(4));
  expect(lastGame).toEqual({ seriesCompleted: true, phaseCompleted: true, tournamentCompleted: true });

  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'finished', finished: '1' });
  expect(finalResults(tournamentId).map((row) => [row.placement, row.seed, row.label])).toEqual([
    [1, 4, 'Champion'], [2, 2, 'Runner-up'],
  ]);
  expect(legacyFieldWrites(tournamentId)).toEqual(noLegacyWrites);
});
