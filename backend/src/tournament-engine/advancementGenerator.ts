import { buildEliminationSeedOrder } from './pairingAlgorithms.js';
import type { AdvancementRuleDefinition, PhaseDefinition } from './types.js';

export interface GeneratedAdvancementRule extends Omit<AdvancementRuleDefinition, 'id'> {}

export interface AdvancementGenerationResult {
  rules: GeneratedAdvancementRule[];
  sameSourceFirstRoundPairs: Array<{ target_group_id: string; seed_one: number; seed_two: number }>;
}

interface Qualifier {
  source_group_id: string;
  source_group_order: number;
  source_rank: number;
}

function compareQualifier(left: Qualifier, right: Qualifier): number {
  return left.source_rank - right.source_rank
    || left.source_group_order - right.source_group_order
    || left.source_group_id.localeCompare(right.source_group_id);
}

/**
 * Generate concrete rules from per-group qualification counts. Assignment is
 * deterministic: it balances target groups, then pairs different source groups
 * into first-round elimination matches whenever the remaining distribution allows.
 */
export function generateAdvancementRules(
  source: PhaseDefinition,
  target: PhaseDefinition
): AdvancementGenerationResult {
  if (target.order !== source.order + 1) {
    throw new Error('Automatic advancement only supports the immediately following phase');
  }
  if (source.groups.some(group => !Number.isInteger(group.advance_count) || Number(group.advance_count) < 1)) {
    throw new Error('Every source group must advance at least one entry');
  }
  if (!target.groups.length) throw new Error('The target phase must contain at least one group');

  const qualifiers = source.groups
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .flatMap(group => Array.from({ length: Number(group.advance_count) }, (_, index) => ({
      source_group_id: group.id,
      source_group_order: group.order,
      source_rank: index + 1,
    })));

  const buckets = target.groups
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(group => ({ group, qualifiers: [] as Qualifier[] }));

  // Spread each source group's rank list over the currently smallest target
  // buckets, preferring buckets that do not yet contain that source group.
  for (const qualifier of qualifiers) {
    const bucket = buckets.slice().sort((left, right) => {
      const leftHasSource = left.qualifiers.some(row => row.source_group_id === qualifier.source_group_id);
      const rightHasSource = right.qualifiers.some(row => row.source_group_id === qualifier.source_group_id);
      const leftLoad = left.qualifiers.length + (left.group.direct_advancement_slots || 0);
      const rightLoad = right.qualifiers.length + (right.group.direct_advancement_slots || 0);
      return leftLoad - rightLoad
        || Number(leftHasSource) - Number(rightHasSource)
        || left.group.order - right.group.order
        || left.group.id.localeCompare(right.group.id);
    }).find(candidate => {
      const bracketSize = target.format === 'single_elimination' ? target.elimination?.bracket_size : undefined;
      return !bracketSize
        || candidate.qualifiers.length + 1 + (candidate.group.direct_advancement_slots || 0) <= bracketSize;
    });
    if (!bucket) throw new Error('Per-group qualifiers and direct entries exceed target bracket capacity');
    bucket.qualifiers.push(qualifier);
  }

  const rules: GeneratedAdvancementRule[] = [];
  const conflicts: AdvancementGenerationResult['sameSourceFirstRoundPairs'] = [];
  for (const bucket of buckets) {
    const rows = bucket.qualifiers.slice().sort(compareQualifier);
    if (target.format !== 'single_elimination') {
      rows.forEach((row, index) => rules.push({
        source_group_id: row.source_group_id,
        source_rank: row.source_rank,
        target_group_id: bucket.group.id,
        target_seed: index + 1,
      }));
      continue;
    }

    const configuredSize = target.elimination?.bracket_size || undefined;
    const minimumSize = Math.max(2, configuredSize || rows.length + (bucket.group.direct_advancement_slots || 0));
    const bracketSize = 2 ** Math.ceil(Math.log2(minimumSize));
    if (configuredSize && rows.length + (bucket.group.direct_advancement_slots || 0) > configuredSize) {
      throw new Error(`Target bracket ${bucket.group.name} cannot fit its configured qualifiers`);
    }

    const seedOrder = buildEliminationSeedOrder(bracketSize);
    const pairSeedSlots: Array<[number, number]> = [];
    for (let index = 0; index < seedOrder.length; index += 2) {
      pairSeedSlots.push([seedOrder[index], seedOrder[index + 1]]);
    }
    const remaining = rows.slice();
    for (const [seedOne, seedTwo] of pairSeedSlots) {
      if (!remaining.length) break;
      const first = remaining.shift()!;
      // Pair against a different source group if one remains. This greedy
      // choice is optimal for avoiding same-source pairs in a single pass
      // because every remaining match has the same two available slots.
      const opponentIndex = remaining.findIndex(row => row.source_group_id !== first.source_group_id);
      const second = opponentIndex >= 0 ? remaining.splice(opponentIndex, 1)[0] : remaining.shift();
      rules.push({
        source_group_id: first.source_group_id,
        source_rank: first.source_rank,
        target_group_id: bucket.group.id,
        target_seed: seedOne,
      });
      if (second) {
        rules.push({
          source_group_id: second.source_group_id,
          source_rank: second.source_rank,
          target_group_id: bucket.group.id,
          target_seed: seedTwo,
        });
        if (second.source_group_id === first.source_group_id) {
          conflicts.push({ target_group_id: bucket.group.id, seed_one: seedOne, seed_two: seedTwo });
        }
      }
    }
  }

  return { rules, sameSourceFirstRoundPairs: conflicts };
}
