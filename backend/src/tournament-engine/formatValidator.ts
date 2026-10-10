import type {
  AdvancementRuleDefinition,
  FormatValidationIssue,
  FormatValidationResult,
  PhaseDefinition,
  TournamentFormatDefinition,
} from './types.js';

const BEST_OF_VALUES = new Set([1, 3, 5]);

/**
 * Highest Swiss round count a phase may declare. It matches the creation API's
 * limit for the tournament summary fields (`general_rounds`, 1–10), which the
 * form derives from the first Swiss phase: allowing more here would let the
 * phase editor offer formats that creation then rejects (audit finding 30).
 * The maintainer set 10 as the supported limit on 2026-10-11.
 */
export const MAX_SWISS_ROUNDS = 10;

/**
 * The compiler needs at least two entries in every group: a group with fewer
 * cannot produce a single series (see compileNextPhaseCompetition).
 */
const MIN_GROUP_ENTRIES = 2;

function issue(issues: FormatValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value == null || typeof value === 'string';
}

/**
 * Check the runtime shape of a definition before any semantic rule runs.
 *
 * The definition arrives as untrusted JSON; the TypeScript interface is only
 * a cast. The semantic checks below dereference phases, groups, rules, and
 * their string fields directly, so a `null` phase, a non-array `groups`, or a
 * numeric name would throw a TypeError and surface as a 500 (audit finding
 * 32). Shape problems are therefore reported first as ordinary issues, and
 * the semantic pass runs only on a well-formed definition. Value ranges and
 * cross-references stay in the semantic pass.
 */
function validateStructure(definition: TournamentFormatDefinition, issues: FormatValidationIssue[]): void {
  for (const [index, phase] of (definition.phases as unknown[]).entries()) {
    const path = `phases[${index}]`;
    if (!isRecord(phase)) {
      issue(issues, path, 'invalid_phase', 'Each phase must be an object');
      continue;
    }
    if (!isOptionalString(phase.name)) issue(issues, `${path}.name`, 'invalid_type', 'Phase name must be text');
    for (const key of ['swiss', 'round_robin', 'elimination'] as const) {
      if (phase[key] != null && !isRecord(phase[key])) {
        issue(issues, `${path}.${key}`, 'invalid_type', 'Phase settings must be an object');
      }
    }
    if (phase.round_overrides != null) {
      if (!Array.isArray(phase.round_overrides)) {
        issue(issues, `${path}.round_overrides`, 'invalid_type', 'Round overrides must be a list');
      } else {
        phase.round_overrides.forEach((override: unknown, overrideIndex: number) => {
          if (!isRecord(override)) issue(issues, `${path}.round_overrides[${overrideIndex}]`, 'invalid_type', 'Each round override must be an object');
        });
      }
    }
    if (!Array.isArray(phase.groups) || phase.groups.length === 0) {
      issue(issues, `${path}.groups`, 'groups_required', 'Every phase requires at least one group or bracket');
      continue;
    }
    for (const [groupIndex, group] of phase.groups.entries()) {
      const groupPath = `${path}.groups[${groupIndex}]`;
      if (!isRecord(group)) {
        issue(issues, groupPath, 'invalid_group', 'Each group must be an object');
        continue;
      }
      if (!isOptionalString(group.name)) issue(issues, `${groupPath}.name`, 'invalid_type', 'Group name must be text');
      if (group.entry_ids != null && !Array.isArray(group.entry_ids)) {
        issue(issues, `${groupPath}.entry_ids`, 'invalid_type', 'Fixed entries must be a list');
      }
    }
  }
  const rules: unknown = definition.advancement_rules;
  if (rules != null) {
    if (!Array.isArray(rules)) {
      issue(issues, 'advancement_rules', 'invalid_type', 'Advancement rules must be a list');
    } else {
      rules.forEach((rule: unknown, index: number) => {
        if (!isRecord(rule)) issue(issues, `advancement_rules[${index}]`, 'invalid_type', 'Each advancement rule must be an object');
      });
    }
  }
}

function validatePhase(phase: PhaseDefinition, index: number, issues: FormatValidationIssue[]): void {
  const path = `phases[${index}]`;
  if (!phase.id) issue(issues, `${path}.id`, 'required', 'Phase id is required');
  if (!phase.name?.trim()) issue(issues, `${path}.name`, 'required', 'Phase name is required');
  if (!Number.isInteger(phase.order) || phase.order < 1) {
    issue(issues, `${path}.order`, 'invalid_order', 'Phase order must be a positive integer');
  }
  if (!BEST_OF_VALUES.has(phase.default_best_of)) {
    issue(issues, `${path}.default_best_of`, 'invalid_best_of', 'Best-of must be 1, 3, or 5');
  }
  if (!['manual', 'random', 'seeded_snake'].includes(phase.assignment_method)) {
    issue(issues, `${path}.assignment_method`, 'invalid_assignment', 'Unsupported assignment method');
  }
  const groupIds = new Set<string>();
  const groupOrders = new Set<number>();
  const manuallyAssignedEntries = new Set<string>();
  for (const [groupIndex, group] of (phase.groups || []).entries()) {
    const groupPath = `${path}.groups[${groupIndex}]`;
    if (!group.id || groupIds.has(group.id)) issue(issues, `${groupPath}.id`, 'duplicate_group', 'Group ids must be unique');
    if (!group.name?.trim()) issue(issues, `${groupPath}.name`, 'required', 'Group name is required');
    if (!Number.isInteger(group.order) || group.order < 1 || groupOrders.has(group.order)) {
      issue(issues, `${groupPath}.order`, 'duplicate_group_order', 'Group order must be a unique positive integer');
    }
    if (group.advance_count != null && (!Number.isInteger(group.advance_count) || group.advance_count < 1)) {
      issue(issues, `${groupPath}.advance_count`, 'invalid_advance_count', 'A group with a following phase must advance at least one entry');
    }
    if (group.direct_advancement_slots != null
      && (!Number.isInteger(group.direct_advancement_slots) || group.direct_advancement_slots < 0)) {
      issue(issues, `${groupPath}.direct_advancement_slots`, 'invalid_direct_capacity', 'Direct-entry capacity must be a non-negative integer');
    }
    groupIds.add(group.id);
    groupOrders.add(group.order);
    for (const [entryIndex, entryId] of (group.entry_ids || []).entries()) {
      if (phase.assignment_method !== 'manual') {
        issue(issues, `${groupPath}.entry_ids`, 'unexpected_manual_assignment', 'Fixed entries require manual assignment');
        break;
      }
      if (!entryId || manuallyAssignedEntries.has(entryId)) {
        issue(issues, `${groupPath}.entry_ids[${entryIndex}]`, 'duplicate_manual_entry', 'An entry can be assigned to only one group in a phase');
      }
      manuallyAssignedEntries.add(entryId);
    }
  }

  if (phase.format === 'swiss') {
    if (!phase.swiss || !Number.isInteger(phase.swiss.round_count) || phase.swiss.round_count < 1 || phase.swiss.round_count > MAX_SWISS_ROUNDS) {
      issue(issues, `${path}.swiss.round_count`, 'invalid_round_count', `Swiss phases require between 1 and ${MAX_SWISS_ROUNDS} rounds`);
    }
  } else if (phase.format === 'round_robin') {
    if (!phase.round_robin || ![1, 2].includes(phase.round_robin.cycle_count)) {
      issue(issues, `${path}.round_robin.cycle_count`, 'invalid_cycle_count', 'Round-robin phases require one or two cycles');
    }
  } else if (phase.format === 'single_elimination') {
    const bracketSize = phase.elimination?.bracket_size;
    if (bracketSize != null && (!Number.isInteger(bracketSize) || bracketSize < 2 || (bracketSize & (bracketSize - 1)) !== 0)) {
      issue(issues, `${path}.elimination.bracket_size`, 'invalid_bracket_size', 'Bracket size must be a power of two and at least two');
    }
  } else {
    issue(issues, `${path}.format`, 'invalid_format', 'Unsupported phase format');
  }

  for (const [overrideIndex, override] of (phase.round_overrides || []).entries()) {
    const overridePath = `${path}.round_overrides[${overrideIndex}]`;
    const fromStart = override.round_from_start != null;
    const fromEnd = override.round_from_end != null;
    if (fromStart === fromEnd) {
      issue(issues, overridePath, 'invalid_round_selector', 'Select exactly one round offset');
    }
    if (!BEST_OF_VALUES.has(override.best_of)) {
      issue(issues, `${overridePath}.best_of`, 'invalid_best_of', 'Best-of must be 1, 3, or 5');
    }
  }
}

function validateAdvancement(
  rules: AdvancementRuleDefinition[],
  phases: PhaseDefinition[],
  issues: FormatValidationIssue[]
): void {
  const groupPhaseOrder = new Map<string, number>();
  for (const phase of phases) {
    for (const group of phase.groups || []) groupPhaseOrder.set(group.id, phase.order);
  }

  const targetSlots = new Set<string>();
  const sourceTargets = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const path = `advancement_rules[${index}]`;
    const sourceOrder = groupPhaseOrder.get(rule.source_group_id);
    const targetOrder = groupPhaseOrder.get(rule.target_group_id);
    if (sourceOrder == null) issue(issues, `${path}.source_group_id`, 'unknown_group', 'Source group does not exist');
    if (targetOrder == null) issue(issues, `${path}.target_group_id`, 'unknown_group', 'Target group does not exist');
    if (sourceOrder != null && targetOrder != null && targetOrder !== sourceOrder + 1) {
      issue(issues, path, 'non_adjacent_advancement', 'Advancement must point to the immediately following phase');
    }
    if (!Number.isInteger(rule.source_rank) || rule.source_rank < 1) {
      issue(issues, `${path}.source_rank`, 'invalid_rank', 'Source rank must be a positive integer');
    }
    if (!Number.isInteger(rule.target_seed) || rule.target_seed < 1) {
      issue(issues, `${path}.target_seed`, 'invalid_seed', 'Target preclassification must be a positive integer');
    }
    const targetKey = `${rule.target_group_id}:${rule.target_seed}`;
    if (targetSlots.has(targetKey)) issue(issues, path, 'duplicate_target', 'A target position can have only one source');
    targetSlots.add(targetKey);
    // A group position represents one entry, so it cannot advance into multiple
    // target slots even when those slots belong to different groups.
    const sourceKey = `${rule.source_group_id}:${rule.source_rank}`;
    if (sourceTargets.has(sourceKey)) issue(issues, path, 'duplicate_source', 'A source group position can advance only once');
    sourceTargets.add(sourceKey);
  }
}

/** Validate the complete declarative tournament graph without touching persistence. */
export function validateTournamentFormat(definition: TournamentFormatDefinition): FormatValidationResult {
  const issues: FormatValidationIssue[] = [];
  if (!definition || !Array.isArray(definition.phases) || definition.phases.length === 0) {
    return { valid: false, issues: [{ path: 'phases', code: 'required', message: 'At least one phase is required' }] };
  }
  validateStructure(definition, issues);
  if (issues.length > 0) return { valid: false, issues };

  const phaseIds = new Set<string>();
  const phaseOrders = new Set<number>();
  const allGroupIds = new Set<string>();
  for (const [index, phase] of definition.phases.entries()) {
    validatePhase(phase, index, issues);
    if (phaseIds.has(phase.id)) issue(issues, `phases[${index}].id`, 'duplicate_phase', 'Phase ids must be unique');
    if (phaseOrders.has(phase.order)) issue(issues, `phases[${index}].order`, 'duplicate_phase_order', 'Phase order must be unique');
    phaseIds.add(phase.id);
    phaseOrders.add(phase.order);
    for (const group of phase.groups || []) {
      if (allGroupIds.has(group.id)) issue(issues, `phases[${index}].groups`, 'duplicate_group', 'Group ids must be unique across the tournament');
      allGroupIds.add(group.id);
    }
  }

  const sortedOrders = [...phaseOrders].sort((a, b) => a - b);
  if (sortedOrders.some((value, index) => value !== index + 1)) {
    issue(issues, 'phases', 'non_contiguous_order', 'Phase order must be contiguous starting at one');
  }
  const finalPhase = definition.phases.find(phase => phase.order === sortedOrders[sortedOrders.length - 1]);
  if (finalPhase && finalPhase.groups.length !== 1) {
    issue(issues, 'phases', 'ambiguous_champion', 'The final phase must contain exactly one group or bracket');
  }
  validateAdvancement(definition.advancement_rules || [], definition.phases, issues);

  const orderedPhases = [...definition.phases].sort((a, b) => a.order - b.order);
  const nextByOrder = new Map(orderedPhases.map((phase, index) => [phase.order, orderedPhases[index + 1]]));
  for (const [phaseIndex, phase] of orderedPhases.entries()) {
    const nextPhase = nextByOrder.get(phase.order);
    for (const [groupIndex, group] of phase.groups.entries()) {
      const groupPath = `phases[${phaseIndex}].groups[${groupIndex}]`;
      if (group.advance_count != null) {
        if (!nextPhase) {
          issue(issues, `${groupPath}.advance_count`, 'final_phase_advance_count', 'The final phase cannot configure qualifiers to a later phase');
        } else {
          const count = (definition.advancement_rules || []).filter(rule =>
            rule.source_group_id === group.id
            && nextPhase.groups.some(targetGroup => targetGroup.id === rule.target_group_id)
          ).length;
          if (count !== group.advance_count) {
            issue(issues, `${groupPath}.advance_count`, 'advancement_count_mismatch', 'Generate or review mappings so they match this group’s qualifier count');
          }
        }
      }
      const directSlots = group.direct_advancement_slots || 0;
      if (directSlots > 0 && phase.order === 1) {
        issue(issues, `${groupPath}.direct_advancement_slots`, 'first_phase_direct_entry', 'Direct passes can only enter a later phase');
      }
      // A later-phase group is filled only by the qualifiers its advancement
      // rules map into it plus its reserved direct passes (preparation
      // requires exactly `direct_advancement_slots` nominations). If those
      // cannot reach the compiler's minimum, the phase can never be compiled,
      // so the graph is rejected before it is saved (audit finding 29). This
      // also rejects disconnected graphs, where a later phase has no incoming
      // rules at all. Whether each source rank is actually occupied depends on
      // the accepted field and is still checked when the phase is compiled.
      if (phaseIndex > 0) {
        const incoming = (definition.advancement_rules || []).filter(rule => rule.target_group_id === group.id).length
          + directSlots;
        if (incoming < MIN_GROUP_ENTRIES) {
          issue(issues, groupPath, 'insufficient_incoming_entries',
            'A later-phase group needs at least two entries from advancement rules or direct passes');
        }
      }
      if (phase.format === 'single_elimination' && phase.elimination?.bracket_size) {
        const targetRules = (definition.advancement_rules || []).filter(rule => rule.target_group_id === group.id);
        const mapped = targetRules.length;
        if (mapped + directSlots > phase.elimination.bracket_size) {
          issue(issues, `${groupPath}.direct_advancement_slots`, 'target_bracket_over_capacity', 'Qualifiers and direct entries exceed this bracket’s configured size');
        }
        if (targetRules.some(rule => rule.target_seed > phase.elimination!.bracket_size!)) {
          issue(issues, `${groupPath}.elimination.bracket_size`, 'target_seed_outside_bracket', 'A mapped preclassification is outside this bracket size');
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
