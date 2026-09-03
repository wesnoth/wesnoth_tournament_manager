export type TournamentType = 'elimination' | 'league' | 'swiss' | 'swiss_elimination';
export type TournamentMode = 'ranked' | 'unranked' | 'team';
export type MatchFormat = 'bo1' | 'bo3' | 'bo5';
export type PhaseFormat = 'swiss' | 'round_robin' | 'single_elimination';
export type BestOf = 1 | 3 | 5;

export interface TournamentPhaseGroupDefinition {
  id: string;
  name: string;
  order: number;
  entry_ids?: string[];
}

export interface TournamentPhaseDefinition {
  id: string;
  name: string;
  description?: string | null;
  order: number;
  format: PhaseFormat;
  assignment_method: 'manual' | 'random' | 'seeded_snake';
  default_best_of: BestOf;
  auto_start?: boolean;
  groups: TournamentPhaseGroupDefinition[];
  swiss?: { round_count: number; avoid_rematches?: boolean };
  round_robin?: { cycle_count: 1 | 2; open_rounds_together?: boolean };
  elimination?: { bracket_size?: number | null; seeding_policy?: 'seeded' | 'random' | 'manual'; reseed_each_round?: boolean };
  round_overrides?: Array<{ id: string; round_from_start?: number | null; round_from_end?: number | null; best_of: BestOf }>;
}

export interface TournamentFormatDefinition {
  phases: TournamentPhaseDefinition[];
  advancement_rules: Array<{
    id: string;
    source_group_id: string;
    source_rank: number;
    target_group_id: string;
    target_seed: number;
  }>;
}

export interface TournamentFormData {
  name: string;
  description: string;
  tournament_type: TournamentType;
  tournament_mode: TournamentMode;
  max_participants: number | null;
  round_duration_days: number;
  auto_advance_round: boolean;
  scheduled_start_at?: string | null;
  general_rounds: number;
  final_rounds: number;
  general_rounds_format: MatchFormat;
  final_rounds_format: MatchFormat;
  rules_template_id?: string | null;
  rules_content?: string;
  organizer_ids?: string[];
  forum_topic_url?: string | null;
  format_definition?: TournamentFormatDefinition;
}

export interface TournamentRuleVersion {
  version_number: number;
  rules_content: string | null;
  changed_at: string;
  changed_by_id: string | null;
  changed_by_nickname: string | null;
}

export interface TournamentCreatePayload extends TournamentFormData {
  unranked_factions?: string[];
  unranked_maps?: string[];
}

export type TournamentUpdatePayload = Partial<Omit<TournamentFormData, 'organizer_ids'>>;
