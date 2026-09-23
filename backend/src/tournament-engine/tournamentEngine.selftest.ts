import assert from 'node:assert/strict';
import { parseForumTopicUrl, parseTournamentCode, tournamentGameName } from './forumTopic.js';
import { validateTournamentFormat } from './formatValidator.js';
import type { TournamentFormatDefinition } from './types.js';
import { generateAdvancementRules } from './advancementGenerator.js';
import { buildEliminationSeedOrder, orderThirdPlaceStandings } from './pairingAlgorithms.js';

const swissGroup = '00000000-0000-4000-8000-000000000001';
const bracket = '00000000-0000-4000-8000-000000000002';
const definition: TournamentFormatDefinition = {
  phases: [
    {
      id: '00000000-0000-4000-8000-000000000011', name: 'Swiss', order: 1, format: 'swiss',
      assignment_method: 'seeded_snake', default_best_of: 3,
      groups: [{ id: swissGroup, name: 'Group A', order: 1 }], swiss: { round_count: 3 },
    },
    {
      id: '00000000-0000-4000-8000-000000000012', name: 'Final', order: 2, format: 'single_elimination',
      assignment_method: 'manual', default_best_of: 5,
      groups: [{ id: bracket, name: 'Final', order: 1 }], elimination: { bracket_size: 2 },
    },
  ],
  advancement_rules: [
    { id: '00000000-0000-4000-8000-000000000021', source_group_id: swissGroup, source_rank: 1, target_group_id: bracket, target_seed: 1 },
    { id: '00000000-0000-4000-8000-000000000022', source_group_id: swissGroup, source_rank: 2, target_group_id: bracket, target_seed: 2 },
  ],
};

assert.equal(parseForumTopicUrl(undefined), null);
assert.equal(parseForumTopicUrl(''), null);
assert.equal(parseForumTopicUrl('https://forums.wesnoth.org/viewtopic.php?t=60773'), 60773);
assert.throws(() => parseForumTopicUrl('https://example.org/viewtopic.php?t=60773'));
assert.equal(parseTournamentCode('T60773 semifinal'), 60773);
assert.equal(tournamentGameName(null, 'Test tournament'), 'Test tournament');
assert.equal(tournamentGameName(60773, 'Ignored'), 'T60773');
assert.deepEqual(buildEliminationSeedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
const generated = generateAdvancementRules({
  id: 'source', name: 'Groups', order: 1, format: 'swiss', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: Array.from({ length: 4 }, (_, index) => ({ id: `g${index + 1}`, name: `Group ${index + 1}`, order: index + 1, advance_count: 2 })),
}, {
  id: 'target', name: 'Elimination', order: 2, format: 'single_elimination', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: [{ id: 'bracket', name: 'Bracket', order: 1 }], elimination: { bracket_size: 8 },
});
assert.equal(generated.rules.length, 8);
assert.equal(new Set(generated.rules.map(rule => rule.target_seed)).size, 8);
assert.deepEqual(generated.sameSourceFirstRoundPairs, []);
const unavoidableSameGroupPair = generateAdvancementRules({
  id: 'one-group-source', name: 'Groups', order: 1, format: 'swiss', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: [{ id: 'only-group', name: 'Only group', order: 1, advance_count: 2 }],
}, {
  id: 'two-seed-bracket', name: 'Elimination', order: 2, format: 'single_elimination', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: [{ id: 'small-bracket', name: 'Bracket', order: 1 }], elimination: { bracket_size: 2 },
});
assert.equal(unavoidableSameGroupPair.sameSourceFirstRoundPairs.length, 1);
assert.deepEqual(generated, generateAdvancementRules({
  id: 'source', name: 'Groups', order: 1, format: 'swiss', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: Array.from({ length: 4 }, (_, index) => ({ id: `g${index + 1}`, name: `Group ${index + 1}`, order: index + 1, advance_count: 2 })),
}, {
  id: 'target', name: 'Elimination', order: 2, format: 'single_elimination', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: [{ id: 'bracket', name: 'Bracket', order: 1 }], elimination: { bracket_size: 8 },
}));
assert.throws(() => generateAdvancementRules({
  id: 'source', name: 'Groups', order: 1, format: 'swiss', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: [{ id: 'g1', name: 'Group 1', order: 1, advance_count: 0 }],
}, {
  id: 'target', name: 'Next', order: 2, format: 'round_robin', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: [{ id: 'next', name: 'Next', order: 1 }], round_robin: { cycle_count: 1 },
}));
assert.throws(() => generateAdvancementRules({
  id: 'source', name: 'Groups', order: 1, format: 'swiss', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: [{ id: 'g1', name: 'Group 1', order: 1, advance_count: 4 }],
}, {
  id: 'target', name: 'Elimination', order: 2, format: 'single_elimination', assignment_method: 'seeded_snake', default_best_of: 1,
  groups: [{ id: 'bracket', name: 'Bracket', order: 1, direct_advancement_slots: 1 }], elimination: { bracket_size: 4 },
}));
assert.deepEqual(
  orderThirdPlaceStandings(['semifinal-loser-a', 'final-loser', 'final-winner', 'fifth', 'semifinal-loser-b']
    .map(entry_id => ({ entry_id })), 'final-winner', 'final-loser', 'semifinal-loser-b', 'semifinal-loser-a')
    .map(row => row.entry_id),
  ['final-winner', 'final-loser', 'semifinal-loser-b', 'semifinal-loser-a', 'fifth']
);
assert.throws(() => orderThirdPlaceStandings([{ entry_id: 'a' }], 'a', 'a', 'b', 'c'));
assert.deepEqual(validateTournamentFormat(definition), { valid: true, issues: [] });

const cyclic = structuredClone(definition);
cyclic.advancement_rules[0] = { ...cyclic.advancement_rules[0], source_group_id: bracket, target_group_id: swissGroup };
assert.equal(validateTournamentFormat(cyclic).valid, false);

console.log('Tournament engine self-tests passed');
