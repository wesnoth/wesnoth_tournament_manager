/**
 * Unit tests of the phase-format validator (audit findings 29, 30, and 32).
 *
 * Creation and format editing save a definition only when this validator
 * accepts it, so it is the guard that keeps unusable graphs out of the
 * database: a graph whose later phase can never be compiled (29), a Swiss
 * round count the creation API rejects (30), and malformed JSON that used to
 * throw instead of returning issues (32).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_SWISS_ROUNDS, validateTournamentFormat } from './formatValidator.js';
import type { PhaseDefinition, TournamentFormatDefinition } from './types.js';

function swissPhase(order: number, groupIds: string[], roundCount = 3): PhaseDefinition {
  return {
    id: `phase-${order}`, name: `Phase ${order}`, order, format: 'swiss',
    assignment_method: 'seeded_snake', default_best_of: 1,
    groups: groupIds.map((groupId, index) => ({ id: groupId, name: groupId, order: index + 1 })),
    swiss: { round_count: roundCount },
  };
}

function rule(sourceGroup: string, sourceRank: number, targetGroup: string, targetSeed: number) {
  return {
    id: `${sourceGroup}-${sourceRank}-${targetGroup}`,
    source_group_id: sourceGroup, source_rank: sourceRank,
    target_group_id: targetGroup, target_seed: targetSeed,
  };
}

function codes(definition: unknown): string[] {
  return validateTournamentFormat(definition as TournamentFormatDefinition).issues.map(item => item.code);
}

describe('later-phase capacity (finding 29)', () => {
  it('rejects a second phase that no rule or direct pass feeds', () => {
    const definition = { phases: [swissPhase(1, ['a']), swissPhase(2, ['b'])], advancement_rules: [] };
    assert.deepEqual(codes(definition), ['insufficient_incoming_entries']);
  });

  it('rejects a later group that can receive only one entry', () => {
    const definition = {
      phases: [swissPhase(1, ['a']), swissPhase(2, ['b'])],
      advancement_rules: [rule('a', 1, 'b', 1)],
    };
    assert.deepEqual(codes(definition), ['insufficient_incoming_entries']);
  });

  it('accepts two qualifiers into the next phase', () => {
    const definition = {
      phases: [swissPhase(1, ['a']), swissPhase(2, ['b'])],
      advancement_rules: [rule('a', 1, 'b', 1), rule('a', 2, 'b', 2)],
    };
    assert.deepEqual(validateTournamentFormat(definition), { valid: true, issues: [] });
  });

  it('counts reserved direct passes as incoming entries', () => {
    const second = swissPhase(2, ['b']);
    second.groups[0].direct_advancement_slots = 1;
    const definition = { phases: [swissPhase(1, ['a']), second], advancement_rules: [rule('a', 1, 'b', 1)] };
    assert.deepEqual(validateTournamentFormat(definition), { valid: true, issues: [] });
  });

  it('checks every group of the later phase, not only the phase as a whole', () => {
    const definition = {
      phases: [swissPhase(1, ['a']), swissPhase(2, ['b', 'c']), swissPhase(3, ['d'])],
      advancement_rules: [
        rule('a', 1, 'b', 1), rule('a', 2, 'b', 2), rule('a', 3, 'c', 1),
        rule('b', 1, 'd', 1), rule('c', 1, 'd', 2),
      ],
    };
    assert.deepEqual(codes(definition), ['insufficient_incoming_entries']);
  });
});

describe('Swiss round limit (finding 30)', () => {
  it('accepts the supported maximum', () => {
    const definition = { phases: [swissPhase(1, ['a'], MAX_SWISS_ROUNDS)], advancement_rules: [] };
    assert.deepEqual(validateTournamentFormat(definition), { valid: true, issues: [] });
  });

  it('rejects one round above the maximum, which creation would refuse', () => {
    const definition = { phases: [swissPhase(1, ['a'], MAX_SWISS_ROUNDS + 1)], advancement_rules: [] };
    assert.deepEqual(codes(definition), ['invalid_round_count']);
  });

  it('keeps the limit aligned with the creation API summary limit', () => {
    assert.equal(MAX_SWISS_ROUNDS, 10);
  });
});

describe('malformed definitions (finding 32)', () => {
  const malformed: Array<[string, unknown, string]> = [
    ['a null phase', { phases: [null], advancement_rules: [] }, 'invalid_phase'],
    ['a phase given as a string', { phases: ['swiss'], advancement_rules: [] }, 'invalid_phase'],
    ['groups given as an object', { phases: [{ ...swissPhase(1, ['a']), groups: {} }], advancement_rules: [] }, 'groups_required'],
    ['missing groups', { phases: [{ ...swissPhase(1, ['a']), groups: undefined }], advancement_rules: [] }, 'groups_required'],
    ['a null group', { phases: [{ ...swissPhase(1, ['a']), groups: [null] }], advancement_rules: [] }, 'invalid_group'],
    ['a numeric phase name', { phases: [{ ...swissPhase(1, ['a']), name: 7 }], advancement_rules: [] }, 'invalid_type'],
    ['a numeric phase description', { phases: [{ ...swissPhase(1, ['a']), description: 42 }], advancement_rules: [] }, 'invalid_type'],
    ['a numeric group name', { phases: [{ ...swissPhase(1, ['a']), groups: [{ id: 'a', name: 7, order: 1 }] }], advancement_rules: [] }, 'invalid_type'],
    ['entry ids given as a string', { phases: [{ ...swissPhase(1, ['a']), groups: [{ id: 'a', name: 'A', order: 1, entry_ids: 'x' }] }], advancement_rules: [] }, 'invalid_type'],
    ['round overrides given as an object', { phases: [{ ...swissPhase(1, ['a']), round_overrides: {} }], advancement_rules: [] }, 'invalid_type'],
    ['a null round override', { phases: [{ ...swissPhase(1, ['a']), round_overrides: [null] }], advancement_rules: [] }, 'invalid_type'],
    ['Swiss settings given as a number', { phases: [{ ...swissPhase(1, ['a']), swiss: 3 }], advancement_rules: [] }, 'invalid_type'],
    ['advancement rules given as an object', { phases: [swissPhase(1, ['a'])], advancement_rules: {} }, 'invalid_type'],
    ['a null advancement rule', { phases: [swissPhase(1, ['a'])], advancement_rules: [null] }, 'invalid_type'],
  ];

  for (const [label, definition, expectedCode] of malformed) {
    it(`returns an issue instead of throwing for ${label}`, () => {
      let result: ReturnType<typeof validateTournamentFormat> | undefined;
      assert.doesNotThrow(() => { result = validateTournamentFormat(definition as TournamentFormatDefinition); });
      assert.equal(result?.valid, false);
      assert.ok(result?.issues.some(item => item.code === expectedCode), `expected ${expectedCode}, got ${JSON.stringify(result?.issues)}`);
    });
  }

  it('rejects a definition that is not an object', () => {
    assert.deepEqual(codes(null), ['required']);
    assert.deepEqual(codes('swiss'), ['required']);
  });
});

describe('elimination brackets that feed a later phase', () => {
  function eliminationPhase(order: number, groupIds: string[], bracketSize: number | null = null): PhaseDefinition {
    return {
      id: `phase-${order}`, name: `Phase ${order}`, order, format: 'single_elimination',
      assignment_method: 'seeded_snake', default_best_of: 1,
      groups: groupIds.map((groupId, index) => ({ id: groupId, name: groupId, order: index + 1 })),
      elimination: { bracket_size: bracketSize },
    };
  }

  it('accepts a power-of-two qualifier count smaller than the bracket', () => {
    const definition = {
      phases: [swissPhase(1, ['a']), eliminationPhase(2, ['top']), eliminationPhase(3, ['final'])],
      advancement_rules: [
        rule('a', 1, 'top', 1), rule('a', 2, 'top', 2), rule('a', 3, 'top', 3), rule('a', 4, 'top', 4),
        rule('top', 1, 'final', 1), rule('top', 2, 'final', 2),
      ],
    };
    assert.deepEqual(validateTournamentFormat(definition), { valid: true, issues: [] });
  });

  it('rejects a qualifier count that no round can produce', () => {
    const top = eliminationPhase(2, ['top']);
    top.groups[0].advance_count = 3;
    const definition = {
      phases: [swissPhase(1, ['a']), top, swissPhase(3, ['final'])],
      advancement_rules: [
        ...Array.from({ length: 8 }, (_, index) => rule('a', index + 1, 'top', index + 1)),
        rule('top', 1, 'final', 1), rule('top', 2, 'final', 2), rule('top', 3, 'final', 3),
      ],
    };
    assert.deepEqual(codes(definition), ['elimination_qualifiers_power_of_two']);
  });

  it('rejects qualifiers that fill the whole bracket', () => {
    const definition = {
      phases: [swissPhase(1, ['a']), eliminationPhase(2, ['top']), eliminationPhase(3, ['final'])],
      advancement_rules: [
        rule('a', 1, 'top', 1), rule('a', 2, 'top', 2),
        rule('top', 1, 'final', 1), rule('top', 2, 'final', 2),
      ],
    };
    assert.deepEqual(codes(definition), ['elimination_qualifiers_fill_bracket']);
  });

  it('leaves a first-phase bracket without a configured size to the compiler', () => {
    const definition = {
      phases: [eliminationPhase(1, ['top']), eliminationPhase(2, ['final'])],
      advancement_rules: [rule('top', 1, 'final', 1), rule('top', 2, 'final', 2)],
    };
    assert.deepEqual(validateTournamentFormat(definition), { valid: true, issues: [] });
  });
});
