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

/**
 * Number of rounds an elimination bracket plays before its group finishes.
 *
 * A bracket that feeds a later phase only has to reduce its field to the
 * entries that phase takes: with eight entrants and four qualifiers only the
 * quarterfinals are played, with two qualifiers the quarterfinals and the
 * semifinals. Playing on would stage a final whose two finalists meet again in
 * the next phase. `qualifierCount` is the highest source rank the advancement
 * rules take from the group; one (or none: the final phase) keeps the whole
 * bracket, so a champion is decided.
 *
 * Each played round halves the surviving field, so the cut needs a power of
 * two. The format validator rejects other counts; one that predates that check
 * is rounded up, cutting where enough entries survive to fill every mapped
 * rank. A count that leaves no round to play (qualifiers fill the bracket) also
 * predates validation and keeps the full bracket, the previous behaviour.
 */
export function eliminationRoundsToPlay(bracketSize: number, qualifierCount: number | null | undefined): number {
  const fullRounds = Math.log2(bracketSize);
  if (!Number.isInteger(fullRounds) || fullRounds < 1) throw new Error('Bracket size must be a power of two');
  const qualifiers = Number(qualifierCount || 0);
  if (qualifiers <= 1) return fullRounds;
  const survivors = Math.ceil(Math.log2(qualifiers));
  return survivors >= fullRounds ? fullRounds : fullRounds - survivors;
}

/** Outcome of one elimination series, as needed to rank its group. */
export interface EliminationSeriesOutcome {
  round_number: number;
  series_role: string | null;
  loser_entry_id: string | null;
}

/**
 * Rank an elimination group by how far each entry went, not by points.
 *
 * Points cannot order a bracket: a structural bye advances an entry without a
 * series win, so a bracket survivor can hold fewer points than an entry it
 * never met but which was eliminated later. Entries that have not lost a main
 * series rank first (in a cut bracket they are the qualifiers; in a finished
 * full bracket only the champion remains), then entries by the round in which
 * they were eliminated, latest first. Within one tier the incoming order is
 * kept: `rows` arrive sorted by points and the group tiebreakers (OMP, GWP,
 * OGP, initial seed), so entries with equal bracket progress are still
 * separated by the strength of what they faced, as before this ordering
 * existed. The third-place series is ignored here: both of its players fell
 * in the semifinals, and the caller orders them from that series' result
 * (orderThirdPlaceStandings).
 */
export function orderEliminationStandings<T extends { entry_id: string }>(
  rows: T[], series: readonly EliminationSeriesOutcome[]
): T[] {
  const eliminatedIn = new Map<string, number>();
  for (const row of series) {
    if (row.series_role === 'third_place' || !row.loser_entry_id) continue;
    eliminatedIn.set(row.loser_entry_id, Math.max(eliminatedIn.get(row.loser_entry_id) || 0, Number(row.round_number)));
  }
  const reach = (entryId: string) => eliminatedIn.get(entryId) ?? Number.MAX_SAFE_INTEGER;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => reach(right.row.entry_id) - reach(left.row.entry_id) || left.index - right.index)
    .map(({ row }) => row);
}
