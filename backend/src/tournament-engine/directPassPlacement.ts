import { buildEliminationSeedOrder } from './pairingAlgorithms.js';

export interface DirectPassPlacement {
  round_number: number;
  series_position: number;
  slot_number: number;
}

export interface MappedQualifierSeed {
  id: string;
  target_seed: number;
  source_rank: number;
}

/**
 * Move as few qualifier seeds as possible so an entrant explicitly assigned to
 * round one actually plays there. A donor must come from a fully mapped
 * first-round series: moving a lone entrant would erase an entire feeder path
 * and could leave a later bracket branch without a competitor.
 */
export function rebalanceRoundOneDirectPasses(
  bracketSize: number,
  mappings: readonly MappedQualifierSeed[],
  placements: readonly DirectPassPlacement[],
): Array<{ id: string; from_seed: number; to_seed: number }> {
  const seedOrder = buildEliminationSeedOrder(bracketSize);
  const seedToIndex = new Map(seedOrder.map((seed, index) => [seed, index]));
  const mappedBySeed = new Map(mappings.map(mapping => [Number(mapping.target_seed), mapping]));
  const roundOnePasses = placements.filter(placement => placement.round_number === 1);
  const roundOnePassSeeds = new Set(roundOnePasses.map(placement =>
    seedOrder[(placement.series_position - 1) * 2 + placement.slot_number - 1]));
  const reservedByLaterPass = new Set<number>();
  for (const placement of placements.filter(row => row.round_number > 1)) {
    const start = (placement.series_position - 1) * (2 ** placement.round_number)
      + (placement.slot_number - 1) * (2 ** (placement.round_number - 1));
    for (const seed of seedOrder.slice(start, start + (2 ** (placement.round_number - 1)))) {
      reservedByLaterPass.add(seed);
    }
  }
  const changes: Array<{ id: string; from_seed: number; to_seed: number }> = [];
  for (const pass of roundOnePasses) {
    const passIndex = (pass.series_position - 1) * 2 + pass.slot_number - 1;
    const partnerSeed = seedOrder[passIndex ^ 1];
    if (partnerSeed == null || mappedBySeed.has(partnerSeed)
      || roundOnePassSeeds.has(partnerSeed) || reservedByLaterPass.has(partnerSeed)) continue;
    const donor = [...mappedBySeed.values()]
      .filter(mapping => {
        const index = seedToIndex.get(Number(mapping.target_seed));
        if (index == null || reservedByLaterPass.has(Number(mapping.target_seed))) return false;
        return mappedBySeed.has(seedOrder[index ^ 1]);
      })
      // Source rank, not bracket seed number, determines which qualifier has
      // earned the bye: generated cross-group pairings can put a group winner
      // at a numerically high seed such as eight.
      .sort((left, right) => Number(right.source_rank) - Number(left.source_rank)
        || Number(right.target_seed) - Number(left.target_seed))[0];
    if (!donor) continue;
    const fromSeed = Number(donor.target_seed);
    mappedBySeed.delete(fromSeed);
    mappedBySeed.set(partnerSeed, { ...donor, target_seed: partnerSeed });
    changes.push({ id: donor.id, from_seed: fromSeed, to_seed: partnerSeed });
  }
  return changes;
}

/**
 * Select the first safe slot in the requested round. A direct entrant reserves
 * its entire feeder path, so neither a mapped qualifier nor another direct
 * entrant may occupy any seed position covered by that path.
 */
export function findDirectPassPlacement(
  bracketSize: number,
  roundNumber: number,
  mappedSeeds: ReadonlySet<number>,
  existingPlacements: readonly DirectPassPlacement[] = [],
  preferredPosition?: { series_position: number; slot_number: number },
): DirectPassPlacement | null {
  const roundCount = Math.log2(bracketSize);
  if (!Number.isInteger(roundCount) || roundNumber < 1 || roundNumber > roundCount) return null;

  const seedOrder = buildEliminationSeedOrder(bracketSize);
  const coveredSeeds = (placement: DirectPassPlacement): Set<number> => {
    const start = (placement.series_position - 1) * (2 ** placement.round_number)
      + (placement.slot_number - 1) * (2 ** (placement.round_number - 1));
    return new Set(seedOrder.slice(start, start + (2 ** (placement.round_number - 1))));
  };
  const reserved = existingPlacements.map(coveredSeeds);
  const seriesCount = bracketSize / (2 ** roundNumber);

  const candidates = preferredPosition
    ? [preferredPosition]
    : Array.from({ length: seriesCount }, (_, index) => [1, 2].map(slot => ({ series_position: index + 1, slot_number: slot }))).flat();
  for (const { series_position: series, slot_number: slot } of candidates) {
    if (series < 1 || series > seriesCount || ![1, 2].includes(slot)) continue;
      const candidate = { round_number: roundNumber, series_position: series, slot_number: slot };
      const seeds = coveredSeeds(candidate);
      if (seeds.size === 0 || [...seeds].some(seed => mappedSeeds.has(seed))) continue;
      if (reserved.some(path => [...seeds].some(seed => path.has(seed)))) continue;
      return candidate;
  }
  return null;
}
