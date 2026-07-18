import assert from 'node:assert/strict';
import { parseForumTopicUrl, parseTournamentCode, tournamentGameName } from './forumTopic.js';
import { validateTournamentFormat } from './formatValidator.js';
import type { TournamentFormatDefinition } from './types.js';
import { buildEliminationSeedOrder } from './pairingAlgorithms.js';

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
assert.deepEqual(validateTournamentFormat(definition), { valid: true, issues: [] });

const cyclic = structuredClone(definition);
cyclic.advancement_rules[0] = { ...cyclic.advancement_rules[0], source_group_id: bracket, target_group_id: swissGroup };
assert.equal(validateTournamentFormat(cyclic).valid, false);

console.log('Tournament engine self-tests passed');
