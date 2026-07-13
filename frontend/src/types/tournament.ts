export type TournamentType = 'elimination' | 'league' | 'swiss' | 'swiss_elimination';
export type TournamentMode = 'ranked' | 'unranked' | 'team';
export type MatchFormat = 'bo1' | 'bo3' | 'bo5';

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
}

export interface TournamentCreatePayload extends TournamentFormData {
  unranked_factions?: string[];
  unranked_maps?: string[];
}

export type TournamentUpdatePayload = Partial<Omit<TournamentFormData, 'organizer_ids'>>;
