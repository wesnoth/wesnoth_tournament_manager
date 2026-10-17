import { expect, test } from '@playwright/test';
import type { TournamentFormatDefinition } from '../../frontend/src/types/tournament';
import { buildPhaseDefinition, newDefinitionId } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn, uiRequest } from '../support/uiApi';
import {
  createTournament, englishDefaultNames, participants, pickPlayers, registerPlayers, signInAll,
} from '../support/tournamentLifecycle';
import { localStack, runSql, sqlLiteral } from '../support/localStack';

/**
 * Configuration edits are all-or-nothing (audit finding 40).
 *
 * The tournament page saves the summary fields, the rules, and the phase
 * graph in one `PUT /tournaments/:id`. A graph refused only once the stored
 * state is known (a direct pass would lose its target capacity) or a
 * malformed one must leave every part of the configuration as it was, and an
 * accepted edit must store all of its parts together.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';
const db = localStack.tournamentDb;

/** Everything one configuration edit can change. */
function configuration(tournamentId: string): Record<string, string | null> {
  const id = sqlLiteral(tournamentId);
  return runSql(
    `SELECT t.description, t.rules_content,
       (SELECT COUNT(*) FROM ${db}.tournament_rule_versions WHERE tournament_id = ${id}) AS rule_versions,
       (SELECT GROUP_CONCAT(CONCAT(p.phase_order, ':', p.name, ':', COALESCE(p.description, ''))
          ORDER BY p.phase_order SEPARATOR '|') FROM ${db}.tournament_phases p WHERE p.tournament_id = ${id}) AS phases,
       (SELECT GROUP_CONCAT(CONCAT(g.id, ':', g.direct_advancement_slots) ORDER BY p.phase_order, g.group_order SEPARATOR '|')
          FROM ${db}.tournament_phase_groups g JOIN ${db}.tournament_phases p ON p.id = g.phase_id
          WHERE p.tournament_id = ${id}) AS groups
     FROM ${db}.tournaments t WHERE t.id = ${id};`,
  )[0];
}

test('configuration edits commit the summary, rules, and phase graph together or not at all', async () => {
  const organizer = await signIn(organizerName);
  const players = await signInAll(pickPlayers(3, [organizerName]));

  // Two leagues into a bracket that reserves one direct pass, as in the mixed scenario.
  const names = englishDefaultNames();
  const leagues = buildPhaseDefinition('Leagues', 1, 'round_robin', names, 2);
  leagues.groups.forEach((group) => { group.advance_count = 2; });
  const bracket = buildPhaseDefinition('Bracket', 2, 'single_elimination', names, 1);
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
    name: `Lifecycle edit ${Date.now()}`, mode: 'unranked', definition, maxParticipants: 7,
  });
  await registerPlayers(organizer, tournamentId, players);
  const nominee = (await participants(tournamentId)).find((row) => row.user_id === players[0].userId)!;
  await uiRequest(organizer, 'PUT', '/tournaments/:id/direct-pass/:entityType/:entityId', {
    params: { id: tournamentId, entityType: 'participant', entityId: nominee.id },
    body: { group_id: target.id, round_number: 1, note: '' },
  });

  const original = configuration(tournamentId);
  const edit = (format: unknown, marker: string) => uiRequest<{ error?: string; issues?: Array<{ code: string }> }>(
    organizer, 'PUT', '/tournaments/:id', {
      params: { id: tournamentId },
      body: { description: `# Edited ${marker}`, rules_content: `Rules ${marker}`, format_definition: format },
    }).catch((error: Error) => error);

  // A valid graph that removes the reserved slot: refused against the stored direct pass.
  const withoutSlot = structuredClone(definition);
  withoutSlot.phases[1].groups[0].direct_advancement_slots = 0;
  withoutSlot.phases[1].name = 'Renamed bracket';
  const conflict = await edit(withoutSlot, 'conflict');
  expect(conflict).toBeInstanceOf(Error);
  expect((conflict as Error).message).toMatch(/returned 409: .*direct passes/);
  expect(configuration(tournamentId), 'a refused graph keeps the summary and rules too').toEqual(original);

  // A malformed phase description: answered with its issue, nothing written.
  const malformed = structuredClone(definition) as unknown as { phases: Array<Record<string, unknown>> };
  malformed.phases[0].description = 42;
  const invalid = await edit(malformed, 'malformed');
  expect((invalid as Error).message).toMatch(/returned 400: .*invalid_type/);
  expect(configuration(tournamentId)).toEqual(original);

  // An accepted edit stores every part together.
  const accepted = structuredClone(definition);
  accepted.phases[1].name = 'Renamed bracket';
  accepted.phases[1].description = 'Top two of each league';
  const ok = await edit(accepted, 'accepted');
  expect(ok).not.toBeInstanceOf(Error);
  expect(configuration(tournamentId)).toEqual({
    ...original,
    description: '# Edited accepted',
    rules_content: 'Rules accepted',
    rule_versions: String(Number(original.rule_versions) + 1),
    phases: `${original.phases!.split('|')[0]}|2:Renamed bracket:Top two of each league`,
  });
});
