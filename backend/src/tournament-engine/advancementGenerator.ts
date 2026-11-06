import { buildEliminationSeedOrder } from './pairingAlgorithms.js';
import type { AdvancementRuleDefinition, PhaseDefinition } from './types.js';

export interface GeneratedAdvancementRule extends Omit<AdvancementRuleDefinition, 'id'> {}

export interface AdvancementGenerationResult {
  rules: GeneratedAdvancementRule[];
  sameSourceFirstRoundPairs: Array<{ target_group_id: string; seed_one: number; seed_two: number }>;
  targetGroups: Array<{
    target_group_id: string;
    qualifier_count: number;
    direct_pass_capacity: number;
    projected_entries: number;
    recommended_bracket_size: number | null;
    byes: number | null;
  }>;
}

export interface Qualifier {
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
 * Place one bracket's qualifiers on its seeds.
 *
 * Which seeds are used does not depend on who qualified: the first-round
 * series are filled in bracket order, both slots while two qualifiers remain,
 * so the empty seeds (later filled by direct passes or left as structural
 * byes) sit where they always did. Who takes each used seed follows standard
 * group-stage seeding: every group winner ranks above every runner-up, and so
 * on by source rank, so the best used seeds go to the best ranks and the
 * first round pairs a high rank against a low one (winners meet runners-up,
 * never each other). Only within one rank tier may entries swap seeds: each
 * qualifier takes the free seed of its tier that keeps it furthest from the
 * entries of its own source group already placed, measured by the round in
 * which their bracket paths would join, so group mates meet as late as
 * possible. Ties keep the lower seed, which keeps the result deterministic
 * and in source-group order.
 *
 * Returns the placements and the first-round series whose two entrants still
 * share a source group, which happens only when the distribution leaves no
 * alternative (for example a single source group).
 */
export function seedEliminationQualifiers(
  rows: readonly Qualifier[],
  seedOrder: readonly number[],
): { placements: Array<{ qualifier: Qualifier; seed: number }>; sameSourcePairs: Array<[number, number]> } {
  const usedSeeds: number[] = [];
  for (let index = 0; index < seedOrder.length && usedSeeds.length < rows.length; index += 2) {
    usedSeeds.push(seedOrder[index]);
    if (usedSeeds.length < rows.length) usedSeeds.push(seedOrder[index + 1]);
  }
  usedSeeds.sort((left, right) => left - right);
  const bracketIndex = new Map(seedOrder.map((seed, index) => [seed, index]));
  const roundCount = Math.log2(seedOrder.length);
  // Two bracket positions first meet in the round where their paths join:
  // the highest differing bit of their zero-based indexes.
  const meetingRound = (left: number, right: number) => Math.floor(Math.log2(left ^ right)) + 1;
  const ordered = rows.slice().sort(compareQualifier);
  const placements: Array<{ qualifier: Qualifier; seed: number }> = [];
  let tierStart = 0;
  while (tierStart < ordered.length) {
    const rank = ordered[tierStart].source_rank;
    let tierEnd = tierStart;
    while (tierEnd < ordered.length && ordered[tierEnd].source_rank === rank) tierEnd += 1;
    const freeSeeds = usedSeeds.slice(tierStart, tierEnd);
    for (const qualifier of ordered.slice(tierStart, tierEnd)) {
      const mates = placements.filter(row => row.qualifier.source_group_id === qualifier.source_group_id);
      // An earlier meeting weighs more than any number of later ones.
      const cost = (seed: number) => mates.reduce((total, mate) => total
        + 4 ** (roundCount - meetingRound(bracketIndex.get(seed)!, bracketIndex.get(mate.seed)!)), 0);
      const seed = freeSeeds.reduce((best, candidate) => cost(candidate) < cost(best) ? candidate : best);
      freeSeeds.splice(freeSeeds.indexOf(seed), 1);
      placements.push({ qualifier, seed });
    }
    tierStart = tierEnd;
  }
  const groupBySeed = new Map(placements.map(row => [row.seed, row.qualifier.source_group_id]));
  const sameSourcePairs: Array<[number, number]> = [];
  for (let index = 0; index < seedOrder.length; index += 2) {
    const [seedOne, seedTwo] = [seedOrder[index], seedOrder[index + 1]];
    if (groupBySeed.has(seedOne) && groupBySeed.get(seedOne) === groupBySeed.get(seedTwo)) {
      sameSourcePairs.push([seedOne, seedTwo]);
    }
  }
  return { placements, sameSourcePairs };
}

/**
 * Generate concrete rules from per-group qualification counts. Assignment is
 * deterministic: it balances target groups, then seeds each elimination
 * bracket by source rank, keeping group mates apart (seedEliminationQualifiers).
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
    const { placements, sameSourcePairs } = seedEliminationQualifiers(rows, seedOrder);
    for (const { qualifier, seed } of placements) {
      rules.push({
        source_group_id: qualifier.source_group_id,
        source_rank: qualifier.source_rank,
        target_group_id: bucket.group.id,
        target_seed: seed,
      });
    }
    for (const [seedOne, seedTwo] of sameSourcePairs) {
      conflicts.push({ target_group_id: bucket.group.id, seed_one: seedOne, seed_two: seedTwo });
    }
  }

  const targetGroups = buckets.map(bucket => {
    const qualifierCount = bucket.qualifiers.length;
    const directPassCapacity = Number(bucket.group.direct_advancement_slots || 0);
    const projectedEntries = qualifierCount + directPassCapacity;
    if (target.format !== 'single_elimination') {
      return {
        target_group_id: bucket.group.id,
        qualifier_count: qualifierCount,
        direct_pass_capacity: directPassCapacity,
        projected_entries: projectedEntries,
        recommended_bracket_size: null,
        byes: null,
      };
    }
    const configuredSize = target.elimination?.bracket_size || undefined;
    const bracketSize = configuredSize || 2 ** Math.ceil(Math.log2(Math.max(2, projectedEntries)));
    return {
      target_group_id: bucket.group.id,
      qualifier_count: qualifierCount,
      direct_pass_capacity: directPassCapacity,
      projected_entries: projectedEntries,
      recommended_bracket_size: bracketSize,
      byes: Math.max(0, bracketSize - projectedEntries),
    };
  });

  return { rules, sameSourceFirstRoundPairs: conflicts, targetGroups };
}
