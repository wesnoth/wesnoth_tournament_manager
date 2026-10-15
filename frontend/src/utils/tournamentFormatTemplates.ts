import type {
  MatchFormat,
  PhaseFormat,
  TournamentFormatDefinition,
  TournamentPhaseDefinition,
  TournamentType,
} from '../types/tournament';

/**
 * Pure builders behind the tournament creation form: the phase templates of
 * the phase builder and the summary fields the form derives from a format.
 *
 * They live outside the React components, with no translation or browser
 * dependency, so the tournament lifecycle tests build exactly the creation
 * payload the interface sends instead of a hand-written copy that could drift
 * from it.
 */

/** Client-generated identifier of a phase, group, or advancement rule. */
export const newDefinitionId = () => crypto.randomUUID();

/**
 * Default names written into a new format. Phase and group names are saved
 * with the tournament as editable data, so they are produced in the
 * organizer's interface language when the template is applied; nothing else
 * reads them, and switching language later does not rename saved phases.
 */
export interface DefaultNames {
  swiss: string;
  league: string;
  elimination: string;
  swissGroups: string;
  eliminationBrackets: string;
  grandFinal: string;
  group: (number: number) => string;
  phase: (number: number) => string;
}

/** Template codes offered by the phase builder's template selector. */
export type FormatTemplateCode = 'swiss' | 'league' | 'elimination' | 'swiss_brackets_final';

/** One phase with the builder's defaults (seeded snake, best of 3). */
export function buildPhaseDefinition(name: string, order: number, format: PhaseFormat, names: DefaultNames, groupCount = 1): TournamentPhaseDefinition {
  return {
    id: newDefinitionId(),
    name,
    order,
    format,
    assignment_method: 'seeded_snake',
    default_best_of: 3,
    groups: Array.from({ length: groupCount }, (_, index) => ({ id: newDefinitionId(), name: groupCount === 1 ? name : names.group(index + 1), order: index + 1 })),
    swiss: format === 'swiss' ? { round_count: 3, avoid_rematches: true } : undefined,
    round_robin: format === 'round_robin' ? { cycle_count: 1, open_rounds_together: true } : undefined,
    elimination: format === 'single_elimination' ? { bracket_size: null, seeding_policy: 'seeded', reseed_each_round: false } : undefined,
  };
}

/**
 * Format of a template. `swiss_brackets_final` maps the top two of each of
 * four Swiss groups into two brackets (groups alternate between brackets and
 * keep their rank as the seed), and each bracket winner into the final.
 */
export function buildFormatTemplate(code: string, names: DefaultNames): TournamentFormatDefinition {
  if (code === 'swiss_brackets_final') {
    const swiss = buildPhaseDefinition(names.swissGroups, 1, 'swiss', names, 4);
    const brackets = buildPhaseDefinition(names.eliminationBrackets, 2, 'single_elimination', names, 2);
    const final = buildPhaseDefinition(names.grandFinal, 3, 'single_elimination', names, 1);
    const rules = swiss.groups.flatMap((source, sourceIndex) => [1, 2].map((rank) => ({
      id: newDefinitionId(),
      source_group_id: source.id,
      source_rank: rank,
      target_group_id: brackets.groups[sourceIndex % 2].id,
      target_seed: Math.floor(sourceIndex / 2) * 2 + rank,
    })));
    brackets.groups.forEach((source, index) => rules.push({
      id: newDefinitionId(), source_group_id: source.id, source_rank: 1,
      target_group_id: final.groups[0].id, target_seed: index + 1,
    }));
    return { phases: [swiss, brackets, final], advancement_rules: rules };
  }
  if (code === 'league') return { phases: [buildPhaseDefinition(names.league, 1, 'round_robin', names)], advancement_rules: [] };
  if (code === 'elimination') return { phases: [buildPhaseDefinition(names.elimination, 1, 'single_elimination', names)], advancement_rules: [] };
  return { phases: [buildPhaseDefinition(names.swiss, 1, 'swiss', names)], advancement_rules: [] };
}

/**
 * Root summary fields the form keeps in step with the phase format. The
 * backend still validates and stores them for summaries and notifications
 * (cleanup plan step 5), so every format change rewrites them: a multi-phase
 * format with an elimination phase is `swiss_elimination`, otherwise the first
 * phase decides the type, and the first phase's rounds and best-of fill the
 * general round fields.
 */
export function summaryFieldsForFormat(definition: TournamentFormatDefinition): {
  tournament_type: TournamentType;
  general_rounds: number;
  final_rounds: number;
  general_rounds_format: MatchFormat;
} {
  const first = definition.phases[0];
  const hasElimination = definition.phases.some(item => item.format === 'single_elimination');
  const legacyType: TournamentType = definition.phases.length > 1 && hasElimination
    ? 'swiss_elimination'
    : first?.format === 'round_robin' ? 'league'
      : first?.format === 'single_elimination' ? 'elimination' : 'swiss';
  return {
    tournament_type: legacyType,
    general_rounds: first?.format === 'round_robin'
      ? (first.round_robin?.cycle_count || 1)
      : (first?.swiss?.round_count || (legacyType === 'elimination' ? 0 : 1)),
    final_rounds: definition.phases.length > 1 && hasElimination ? 1 : 0,
    general_rounds_format: `bo${first?.default_best_of || 3}` as MatchFormat,
  };
}
