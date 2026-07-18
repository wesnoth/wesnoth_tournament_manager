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
