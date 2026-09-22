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
