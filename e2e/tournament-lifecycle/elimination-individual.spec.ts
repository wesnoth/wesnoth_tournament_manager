import { expect, test } from '@playwright/test';
import { buildFormatTemplate } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn } from '../support/uiApi';
import {
  awardSeries, closePrepareStart, competition, createTournament, englishDefaultNames, entriesBySeed,
  finalResults, groupByes, groupSeries, groupStandings, legacyFieldWrites, noLegacyWrites, phaseGames, pickPlayers,
  recordWinner, registerPlayers, signInAll, tournamentRow, type PhaseGameRow,
} from '../support/tournamentLifecycle';
import { localStack, runSql, sqlLiteral } from '../support/localStack';

/**
 * Full individual single-elimination lifecycle in ranked mode: six players in
 * an eight-slot bracket, best of one, with the final round (final and
 * third-place series) overridden to best of three.
 *
 * Seed order of an eight-slot bracket is 1–8, 4–5, 2–7, 3–6, so seeds 1 and 2
 * receive structural byes. Those byes only advance a slot: they create no
 * tournament_byes row, no played series, and no standings points.
 *
 * Results: seed 4 beats 5 by an administrative award (excluded from GWP), 3
 * beats 6; semifinals 1–4 and 2–3 go to the better seed; seed 1 wins the final
 * 2–1 after losing the first game; seed 3 wins the bronze 2–0. Seeds 5 and 6
 * both lost their only series; seed 6 ranks fifth because its opponent (seed 3,
 * two series wins in three) is stronger by OMP than seed 5's (seed 4, one in
 * three).
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';

test('individual elimination with structural byes, an award, and a third-place series', async () => {
  test.setTimeout(180_000);
  const organizer = await signIn(organizerName);
  const players = await signInAll(pickPlayers(6, [organizerName]));

  const definition = buildFormatTemplate('elimination', englishDefaultNames());
  definition.phases[0].default_best_of = 1;
  definition.phases[0].round_overrides = [{ id: crypto.randomUUID(), round_from_end: 1, best_of: 3 }];
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle elimination ${Date.now()}`, mode: 'ranked', definition, maxParticipants: 6,
  });
  await registerPlayers(organizer, tournamentId, players);
  await closePrepareStart(organizer, tournamentId);

  const entries = entriesBySeed(tournamentId);
  const seedOf = new Map([...entries].map(([seed, entry]) => [entry.id, seed]));
  const entryOf = (seed: number) => entries.get(seed)!.id;
  const [phase] = await competition(tournamentId);
  const groupId = phase.group_id!;

  // Compiled bracket: two structural byes already resolved, two playable series.
  expect(groupSeries(groupId).filter((series) => series.round === 1)).toEqual([
    { round: 1, position: 1, role: 'main', status: 'completed', seeds: [1, null], winnerSeed: 1 },
    { round: 1, position: 2, role: 'main', status: 'ready', seeds: [4, 5], winnerSeed: null },
    { round: 1, position: 3, role: 'main', status: 'completed', seeds: [2, null], winnerSeed: 2 },
    { round: 1, position: 4, role: 'main', status: 'ready', seeds: [3, 6], winnerSeed: null },
  ]);
  expect(groupByes(groupId)).toEqual([]);

  const pendingBetween = async (seedA: number, seedB: number): Promise<PhaseGameRow> => {
    const pending = (await phaseGames(tournamentId)).filter((game) => game.status === 'pending');
    const game = pending.find((candidate) =>
      [seedOf.get(candidate.entry1_id), seedOf.get(candidate.entry2_id)].sort().join() === [seedA, seedB].sort().join());
    if (!game) throw new Error(`No pending game between seeds ${seedA} and ${seedB}`);
    return game;
  };

  await awardSeries(organizer, tournamentId, (await pendingBetween(4, 5)).series_id, entryOf(4));
  await recordWinner(organizer, tournamentId, (await pendingBetween(3, 6)).game_id, entryOf(3));
  await recordWinner(organizer, tournamentId, (await pendingBetween(1, 4)).game_id, entryOf(1));
  await recordWinner(organizer, tournamentId, (await pendingBetween(2, 3)).game_id, entryOf(2));

  // Final round: both series are best of three and open together.
  const finalRound = groupSeries(groupId).filter((series) => series.round === 3);
  expect(finalRound).toEqual([
    { round: 3, position: 1, role: 'main', status: 'ready', seeds: [1, 2], winnerSeed: null },
    { round: 3, position: 2, role: 'third_place', status: 'ready', seeds: [4, 3], winnerSeed: null },
  ]);
  expect((await recordWinner(organizer, tournamentId, (await pendingBetween(1, 2)).game_id, entryOf(2))).seriesCompleted).toBe(false);
  expect((await recordWinner(organizer, tournamentId, (await pendingBetween(1, 2)).game_id, entryOf(1))).seriesCompleted).toBe(false);
  expect((await recordWinner(organizer, tournamentId, (await pendingBetween(1, 2)).game_id, entryOf(1))).seriesCompleted).toBe(true);
  expect(tournamentRow(tournamentId).status, 'the bronze series still blocks completion').toBe('in_progress');
  await recordWinner(organizer, tournamentId, (await pendingBetween(3, 4)).game_id, entryOf(3));
  const last = await recordWinner(organizer, tournamentId, (await pendingBetween(3, 4)).game_id, entryOf(3));
  expect(last).toEqual({ seriesCompleted: true, phaseCompleted: true, tournamentCompleted: true });

  // The award is presentation evidence only: one marked game, no fabricated second game.
  const awardGames = runSql(
    `SELECT g.organizer_action, COUNT(*) AS games
     FROM ${localStack.tournamentDb}.tournament_games g
     JOIN ${localStack.tournamentDb}.tournament_series s ON s.id = g.series_id
     JOIN ${localStack.tournamentDb}.tournament_phase_rounds r ON r.id = s.round_id
     WHERE r.group_id = ${sqlLiteral(groupId)} AND g.organizer_action IS NOT NULL
     GROUP BY g.organizer_action;`,
  );
  expect(awardGames).toEqual([{ organizer_action: 'forfeit', games: '1' }]);

  const standings = groupStandings(groupId);
  const summary = (seed: number) => {
    const row = standings.get(seed)!;
    return [row.rank_position, row.matches_played, row.wins, row.losses, row.byes, row.points];
  };
  // [rank, played, wins, losses, byes, points]: structural byes add nothing.
  expect([1, 2, 3, 4, 5, 6].map(summary)).toEqual([
    [1, 2, 2, 0, 0, 2],
    [2, 2, 1, 1, 0, 1],
    [3, 3, 2, 1, 0, 2],
    [4, 3, 1, 2, 0, 1],
    [6, 1, 0, 1, 0, 0],
    [5, 1, 0, 1, 0, 0],
  ]);
  // GWP counts played games only: seed 1 won 3 of 4, seed 2 won 2 of 4, and
  // seed 4's administrative win is not a game.
  expect(standings.get(1)!.gwp).toBeCloseTo(75, 1);
  expect(standings.get(2)!.gwp).toBeCloseTo(50, 1);
  expect(standings.get(4)!.gwp).toBeCloseTo(0, 1);
  expect([...standings.values()].every((row) => row.finalized)).toBe(true);

  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'finished', finished: '1' });
  expect(finalResults(tournamentId)).toEqual([
    { seed: 1, placement: 1, label: 'Champion', champion: true },
    { seed: 2, placement: 2, label: 'Runner-up', champion: false },
    { seed: 3, placement: 3, label: 'Third place', champion: false },
    { seed: 4, placement: 4, label: null, champion: false },
    { seed: 6, placement: 5, label: null, champion: false },
    { seed: 5, placement: 6, label: null, champion: false },
  ]);
  expect(legacyFieldWrites(tournamentId)).toEqual(noLegacyWrites);
});
