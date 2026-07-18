export type PhaseFormat = 'swiss' | 'round_robin' | 'single_elimination';
export type AssignmentMethod = 'manual' | 'random' | 'seeded_snake';
export type BestOf = 1 | 3 | 5;

export interface PhaseGroupDefinition {
  id: string;
  name: string;
  order: number;
  /** Participant or team ids in preclassification order, used only by manual assignment. */
  entry_ids?: string[];
}

export interface SwissSettings {
  round_count: number;
  pairing_policy?: 'score_then_tiebreak';
  avoid_rematches?: boolean;
}

export interface RoundRobinSettings {
  cycle_count: 1 | 2;
  open_rounds_together?: boolean;
}

export interface EliminationSettings {
  bracket_size?: number | null;
  seeding_policy?: 'seeded' | 'random' | 'manual';
  reseed_each_round?: boolean;
}

export interface RoundOverrideDefinition {
  id: string;
  round_from_start?: number | null;
  round_from_end?: number | null;
  best_of: BestOf;
}

export interface PhaseDefinition {
  id: string;
  name: string;
  description?: string | null;
  order: number;
  format: PhaseFormat;
  assignment_method: AssignmentMethod;
  default_best_of: BestOf;
  auto_start?: boolean;
  groups: PhaseGroupDefinition[];
  swiss?: SwissSettings;
  round_robin?: RoundRobinSettings;
  elimination?: EliminationSettings;
  round_overrides?: RoundOverrideDefinition[];
}

export interface AdvancementRuleDefinition {
  id: string;
  source_group_id: string;
  source_rank: number;
  target_group_id: string;
  target_seed: number;
}

export interface TournamentFormatDefinition {
  phases: PhaseDefinition[];
  advancement_rules: AdvancementRuleDefinition[];
}

export interface FormatValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface FormatValidationResult {
  valid: boolean;
  issues: FormatValidationIssue[];
}
