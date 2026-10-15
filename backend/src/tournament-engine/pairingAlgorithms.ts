/** Return standard fixed-bracket seed positions, keeping the strongest seeds apart. */
export function buildEliminationSeedOrder(bracketSize: number): number[] {
  if (bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0) {
    throw new Error('Bracket size must be a power of two');
  }
  let order = [1, 2];
  while (order.length < bracketSize) {
    const complement = order.length * 2 + 1;
    order = order.flatMap(seed => [seed, complement - seed]);
  }
  return order;
}

/**
 * First-round Swiss pairings following the FIDE Dutch system.
 *
 * `seededEntryIds` is ordered strongest first (initial seed 1 first). With an
 * odd field the lowest seed receives the bye, so the free point goes to the
 * entry least able to distort the top tables. The remaining entries are split
 * into a top half and a bottom half and paired position by position (seed 1
 * against seed n/2 + 1, and so on), which keeps the favourites apart in the
 * opening round instead of pairing adjacent seeds.
 */
export function buildSwissFirstRoundPairs(seededEntryIds: string[]): {
  pairs: Array<[string, string]>;
  byeEntryId: string | null;
} {
  const playing = [...seededEntryIds];
  const byeEntryId = playing.length % 2 === 1 ? playing.pop()! : null;
  const half = playing.length / 2;
  const pairs = playing.slice(0, half).map((entryId, index) => [entryId, playing[half + index]] as [string, string]);
  return { pairs, byeEntryId };
}

/**
 * Entry that sits out a later Swiss round with an odd field.
 *
 * `rankedEntryIds` is the current group order, strongest first. Following the
 * FIDE rule, the bye goes to the lowest-ranked entry that has not had one yet,
 * so no entry collects a second free point while another has none. Only when
 * every entry already had a bye (more rounds than entries) may one repeat, and
 * then it is again the lowest-ranked. Returns null for an even field.
 */
export function selectSwissByeEntry(rankedEntryIds: string[], entriesWithBye: ReadonlySet<string>): string | null {
  if (rankedEntryIds.length % 2 === 0) return null;
  for (let index = rankedEntryIds.length - 1; index >= 0; index -= 1) {
    if (!entriesWithBye.has(rankedEntryIds[index])) return rankedEntryIds[index];
  }
  return rankedEntryIds[rankedEntryIds.length - 1];
}

/**
 * Match-win percentage of an opponent as used by OMP, on a 0..100 scale.
 *
 * Bye and league-rest points are part of the entry's standing but say nothing
 * about how strong it is, and they have no played series behind them, so they
 * are removed from the numerator to match a denominator that only counts
 * played (or administratively decided) series. Mixing the two would let an
 * opponent with a bye exceed 100% and inflate the OMP of everyone who faced
 * it. The percentage assumes the phase scoring of one point per series win,
 * the only scoring profile phases are created with. An opponent with no
 * played series contributes zero.
 */
export function opponentMatchPercentage(points: number, byePoints: number, matchesPlayed: number): number {
  if (matchesPlayed <= 0) return 0;
  return (Math.max(0, points - byePoints) / matchesPlayed) * 100;
}

/** Keep other entries in their existing order while match outcomes fix the podium. */
export function orderThirdPlaceStandings<T extends { entry_id: string }>(
  rows: T[], finalWinner: string, finalLoser: string, bronzeWinner: string, bronzeLoser: string
): T[] {
  const podiumIds = [finalWinner, finalLoser, bronzeWinner, bronzeLoser];
  const byId = new Map(rows.map(row => [row.entry_id, row]));
  if (new Set(podiumIds).size !== 4 || podiumIds.some(id => !byId.has(id))) {
    throw new Error('Third-place results must identify four distinct group entries');
  }
  return [...podiumIds.map(id => byId.get(id)!), ...rows.filter(row => !podiumIds.includes(row.entry_id))];
}
