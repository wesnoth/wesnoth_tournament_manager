import type { BestOf, TournamentPhaseDefinition } from '../types/tournament';

/** One per-round best-of rule of a phase, as stored by the backend. */
export interface RoundBestOfOverride {
  round_from_start?: number | null;
  round_from_end?: number | null;
  best_of: BestOf | number;
}

/**
 * Rounds an elimination bracket plays before its group finishes.
 *
 * Mirrors the backend's `eliminationRoundsToPlay` (tournament-engine
 * pairingAlgorithms), which decides what the compiler creates; both must
 * change together. A bracket feeding a later phase stops once only its
 * qualifiers survive, so eight entrants with two qualifiers play the
 * quarterfinals and the semifinals, never a final. One qualifier, or none
 * (the final phase), keeps the whole bracket. Counts that are not a power of
 * two round up; counts that leave no round to play keep the full bracket.
 */
export function eliminationRoundsToPlay(bracketSize: number, qualifierCount: number | null | undefined): number {
  const fullRounds = Math.log2(bracketSize);
  if (!Number.isInteger(fullRounds) || fullRounds < 1) return 0;
  const qualifiers = Number(qualifierCount || 0);
  if (qualifiers <= 1) return fullRounds;
  const survivors = Math.ceil(Math.log2(qualifiers));
  return survivors >= fullRounds ? fullRounds : fullRounds - survivors;
}

/**
 * Best-of the compiler gives a round: an override counted from the start wins,
 * then one counted from the end of the played rounds, then the phase default.
 * Mirrors `roundBestOf` in the backend competition compiler.
 */
export function roundBestOf(
  defaultBestOf: number,
  roundNumber: number,
  roundCount: number,
  overrides: readonly RoundBestOfOverride[] = [],
): number {
  const override = overrides.find(value => Number(value.round_from_start) === roundNumber)
    || overrides.find(value => Number(value.round_from_end) === roundCount - roundNumber + 1);
  return Number(override?.best_of || defaultBestOf);
}

/**
 * Entries still alive when an elimination round counted from the end starts.
 *
 * The last played round (`roundFromEnd` 1) halves the field down to the
 * survivors the next phase takes, so it starts with twice that many: a
 * bracket that hands two qualifiers on has semifinals as its last round, one
 * that crowns a champion has a final. `survivors` is the qualifier count
 * rounded up to a power of two, or 1 for a bracket that is played out.
 */
export function entrantsAtRoundFromEnd(roundFromEnd: number, qualifierCount: number | null | undefined): number {
  const qualifiers = Number(qualifierCount || 0);
  const survivors = qualifiers <= 1 ? 1 : 2 ** Math.ceil(Math.log2(qualifiers));
  return survivors * (2 ** roundFromEnd);
}

/**
 * Qualifier count that cuts every bracket of an elimination phase, or null
 * when the phase is played out (final phase) or its groups disagree.
 *
 * The phase editor labels rounds by stage ("Semifinals"), which is only
 * unambiguous when every bracket of the phase stops at the same depth. Per
 * group counts come from `advance_count`, falling back to the deepest rank
 * the advancement rules take, exactly the value the compiler cuts on.
 */
export function phaseQualifierCount(
  phase: TournamentPhaseDefinition,
  rules: ReadonlyArray<{ source_group_id: string; source_rank: number }>,
  isFinalPhase: boolean,
): number | null | 'mixed' {
  if (isFinalPhase) return null;
  const counts = phase.groups.map(group => {
    const deepestRank = Math.max(0, ...rules.filter(rule => rule.source_group_id === group.id).map(rule => Number(rule.source_rank)));
    return Number(group.advance_count || deepestRank || 0);
  });
  if (counts.length === 0 || counts.every(count => count === 0)) return null;
  return counts.every(count => count === counts[0]) ? counts[0] : 'mixed';
}
