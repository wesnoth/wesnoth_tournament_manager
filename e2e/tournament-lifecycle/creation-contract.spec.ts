import { expect, test } from '@playwright/test';
import type { TournamentFormatDefinition } from '../../frontend/src/types/tournament';
import { buildFormatTemplate, buildPhaseDefinition } from '../../frontend/src/utils/tournamentFormatTemplates';
import { signIn, uiRequest } from '../support/uiApi';
import { createTournament, englishDefaultNames, tournamentRow } from '../support/tournamentLifecycle';
import { faultHits, installFault, removeFault } from '../support/faultInjection';
import { localStack, runSql, sqlLiteral } from '../support/localStack';

/**
 * Version 2 creation contract (cleanup plan step 1): a tournament is created
 * with its whole phase graph in one transaction, or not at all.
 *
 * A rejected format must leave no root row and no partial graph, and an
 * accepted one must store every phase, group, and advancement rule it
 * declared, with `competition_model_version = 2`.
 */
const organizerName = process.env.E2E_TOURNAMENT_ORGANIZER || 'Blair';
const db = localStack.tournamentDb;

/** Rows a creation could have written, counted globally so stray rows of any tournament show up. */
function graphRowCounts(): Record<string, number> {
  const row = runSql(
    `SELECT
       (SELECT COUNT(*) FROM ${db}.tournaments) AS tournaments,
       (SELECT COUNT(*) FROM ${db}.tournament_phases) AS phases,
       (SELECT COUNT(*) FROM ${db}.tournament_phase_groups) AS phase_groups,
       (SELECT COUNT(*) FROM ${db}.tournament_advancement_rules) AS advancement_rules,
       (SELECT COUNT(*) FROM ${db}.tournament_swiss_settings) AS swiss_settings,
       (SELECT COUNT(*) FROM ${db}.tournament_elimination_settings) AS elimination_settings,
       (SELECT COUNT(*) FROM ${db}.tournament_organizers) AS organizers,
       (SELECT COUNT(*) FROM ${db}.tournament_rule_versions) AS rule_versions,
       (SELECT COUNT(*) FROM ${db}.tournament_unranked_factions) AS unranked_factions,
       (SELECT COUNT(*) FROM ${db}.tournament_unranked_maps) AS unranked_maps;`,
  )[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

test('creation stores the complete phase graph atomically', async () => {
  const organizer = await signIn(organizerName);
  const definition = buildFormatTemplate('swiss_brackets_final', englishDefaultNames());
  const tournamentId = await createTournament(organizer, {
    name: `Lifecycle creation ${Date.now()}`, mode: 'unranked', definition, maxParticipants: 16,
  });

  expect(tournamentRow(tournamentId)).toMatchObject({ status: 'registration_open', competition_model_version: '2' });
  const stored = runSql(
    `SELECT
       (SELECT COUNT(*) FROM ${db}.tournament_phases WHERE tournament_id = ${sqlLiteral(tournamentId)}) AS phases,
       (SELECT COUNT(*) FROM ${db}.tournament_phase_groups g JOIN ${db}.tournament_phases p ON p.id = g.phase_id
          WHERE p.tournament_id = ${sqlLiteral(tournamentId)}) AS phase_groups,
       (SELECT COUNT(*) FROM ${db}.tournament_advancement_rules r JOIN ${db}.tournament_phase_groups g ON g.id = r.target_group_id
          JOIN ${db}.tournament_phases p ON p.id = g.phase_id WHERE p.tournament_id = ${sqlLiteral(tournamentId)}) AS advancement_rules,
       (SELECT COUNT(*) FROM ${db}.tournament_organizers WHERE tournament_id = ${sqlLiteral(tournamentId)}) AS organizers;`,
  )[0];
  // Template: 4 Swiss groups, 2 brackets, 1 final; 8 rules into the brackets and 2 into the final.
  expect(stored).toEqual({ phases: '3', phase_groups: '7', advancement_rules: '10', organizers: '1' });

  // The format editor reads back what was declared.
  const { data } = await uiRequest<TournamentFormatDefinition | { definition: TournamentFormatDefinition }>(
    organizer, 'GET', '/tournaments/:id/format', { params: { id: tournamentId } });
  const readBack = 'phases' in data ? data : data.definition;
  expect(readBack.phases.map((phase) => phase.format)).toEqual(['swiss', 'single_elimination', 'single_elimination']);
  expect(readBack.advancement_rules).toHaveLength(10);
});

test('rejected formats write nothing', async () => {
  const organizer = await signIn(organizerName);
  const names = englishDefaultNames();
  const disconnected: TournamentFormatDefinition = {
    phases: [buildPhaseDefinition('First', 1, 'swiss', names), buildPhaseDefinition('Second', 2, 'swiss', names)],
    advancement_rules: [],
  };
  const malformed = { phases: [{ id: 'broken', order: 1, format: 'swiss', groups: 'not a list' }], advancement_rules: {} };

  for (const [label, definition, code] of [
    ['disconnected graph', disconnected, 'insufficient_incoming_entries'],
    ['malformed definition', malformed, 'invalid_type'],
  ] as const) {
    const before = graphRowCounts();
    const name = `Lifecycle rejected ${label} ${Date.now()}`;
    let rejection: Error | null = null;
    try {
      await createTournament(organizer, { name, mode: 'unranked', definition: definition as TournamentFormatDefinition, maxParticipants: 8 });
    } catch (error) {
      rejection = error as Error;
    }
    expect(rejection?.message, `${label} is rejected with its issues`).toMatch(new RegExp(`returned 400: .*${code}`));
    expect(graphRowCounts(), `${label} leaves no rows`).toEqual(before);
    expect(runSql(`SELECT COUNT(*) AS count FROM ${db}.tournaments WHERE name = ${sqlLiteral(name)};`)[0].count).toBe('0');
  }
});

/**
 * Rollback after a partial write (audit finding 41). The rejected formats
 * above fail validation before the transaction starts; here the format is
 * valid and the failure comes from the database after the root row, the
 * organizer, the allowed assets, and every phase and group are already
 * inserted: a trigger refuses the last advancement rule, the final statement
 * of the graph. Everything the creation wrote must roll back with it.
 */
test('a failure after a partial creation rolls everything back', async () => {
  const organizer = await signIn(organizerName);
  const definition = buildFormatTemplate('swiss_brackets_final', englishDefaultNames());
  const lastRule = definition.advancement_rules.at(-1)!;
  const name = `Lifecycle rollback ${Date.now()}`;
  const before = graphRowCounts();
  installFault({
    name: 'creation_last_rule',
    table: 'tournament_advancement_rules',
    event: 'INSERT',
    when: `NEW.id = ${sqlLiteral(lastRule.id)}`,
  });
  let rejection: Error | null = null;
  try {
    await createTournament(organizer, { name, mode: 'unranked', definition, maxParticipants: 16 });
  } catch (error) {
    rejection = error as Error;
  } finally {
    removeFault('creation_last_rule');
  }
  // The fault fired once, on the last statement, so everything before it had been written.
  expect(faultHits('creation_last_rule')).toBe(1);
  // An infrastructure failure: generic 500, no SQL detail for the client.
  expect(rejection?.message).toMatch(/returned 500: /);
  expect(rejection?.message).not.toContain('E2E injected failure');
  expect(graphRowCounts(), 'no creation-owned row survives').toEqual(before);
  expect(runSql(`SELECT COUNT(*) AS count FROM ${db}.tournaments WHERE name = ${sqlLiteral(name)};`)[0].count).toBe('0');
});
