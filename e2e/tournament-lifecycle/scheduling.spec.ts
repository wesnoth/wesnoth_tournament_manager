import { expect, test } from '@playwright/test';
import type { TournamentFormatDefinition } from '../../frontend/src/types/tournament';
import { buildPhaseDefinition } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn, uiRequest } from '../support/uiApi';
import {
  closePrepareStart, createTournament, englishDefaultNames, legacyFieldWrites, noLegacyWrites, phaseGames,
  pickPlayers, recordWinner, registerPlayers, signInAll, tournamentRow,
} from '../support/tournamentLifecycle';
import { localStack, runSql, sqlLiteral } from '../support/localStack';

/**
 * Scheduling writes no version 1 relationship (audit finding 41).
 *
 * The other lifecycle scenarios never schedule a series, so their zero
 * proposal-link count says nothing about the scheduling write path. Here one
 * player proposes slots for a phase-engine series from the schedule modal, the
 * opponent confirms them, and the stored proposal must reference the series
 * only, never the dropped `tournament_round_match_id` / `tournament_match_id`.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';
const db = localStack.tournamentDb;

/** A future slot on a 30-minute boundary, spread out so reruns never collide. */
function futureSlot(): string {
  const slot = new Date(Date.now() + (30 + Math.floor(Math.random() * 300)) * 86_400_000);
  slot.setUTCHours(18, 0, 0, 0);
  return slot.toISOString();
}

test('a scheduled and played series stores only phase-engine links', async () => {
  const organizer = await signIn(organizerName);
  const [first, second] = await signInAll(pickPlayers(2, [organizerName]));
  const league = buildPhaseDefinition('League', 1, 'round_robin', englishDefaultNames(), 1);
  league.default_best_of = 1;
  const definition: TournamentFormatDefinition = { phases: [league], advancement_rules: [] };
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle scheduling ${Date.now()}`, mode: 'unranked', definition, maxParticipants: 2,
  });
  await registerPlayers(organizer, tournamentId, [first, second]);
  await closePrepareStart(organizer, tournamentId);

  const [game] = (await phaseGames(tournamentId)).filter((row) => row.status === 'pending');
  const params = { tournamentId, seriesId: game.series_id };
  await uiRequest(first, 'POST', '/tournament-scheduling/tournament/:tournamentId/series/:seriesId/propose-slots', {
    params, body: { slot_datetimes: [futureSlot(), futureSlot()], notes: null },
  });
  const { data: { proposal } } = await uiRequest<{ proposal: { id: string; slots: Array<{ id: string }> } }>(
    second, 'GET', '/tournament-scheduling/tournament/:tournamentId/series/:seriesId/proposal', { params });
  const { data: confirmation } = await uiRequest<{ fullyConfirmed: boolean }>(
    second, 'POST', '/tournament-scheduling/tournament/:tournamentId/series/:seriesId/confirm-slots', {
      params, body: { proposal_id: proposal.id, confirmed_slot_ids: [proposal.slots[0].id] },
    });
  expect(confirmation.fullyConfirmed).toBe(true);

  // The stored proposal points at the series and nothing else.
  expect(runSql(
    `SELECT tournament_series_id, tournament_round_match_id, tournament_match_id, status
     FROM ${db}.match_schedule_proposals WHERE id = ${sqlLiteral(proposal.id)};`,
  )[0]).toEqual({
    tournament_series_id: game.series_id, tournament_round_match_id: null, tournament_match_id: null, status: 'confirmed',
  });

  await recordWinner(organizer, tournamentId, game.game_id, game.entry1_id);
  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'finished', finished: '1' });
  expect(legacyFieldWrites(tournamentId)).toEqual(noLegacyWrites);
});
