export interface User {
  id: string;
  nickname: string;
  email: string;
  password_hash: string;
  language: 'en' | 'es' | 'zh' | 'de' | 'ru';
  discord_id?: string;
  elo_rating: number;
  level: string;
  is_active: boolean;
  is_blocked: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PasswordPolicy {
  id: string;
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_numbers: boolean;
  require_symbols: boolean;
  previous_passwords_count: number;
  updated_at: Date;
}

export interface Match {
  id: string;
  winner_id: string;
  loser_id: string;
  map: string;
  winner_faction: string;
  loser_faction: string;
  winner_comments: string;
  winner_rating: number; // 1-5
  loser_comments?: string;
  loser_rating?: number; // 1-5
  loser_confirmed: boolean;
  replay_file_path?: string;
  tournament_id?: string;
  elo_change: number;
  created_at: Date;
  updated_at: Date;
}

export interface News {
  id: string;
  title: string;
  content: string;
  translations: {
    en: { title: string; content: string };
    es: { title: string; content: string };
    zh: { title: string; content: string };
    de: { title: string; content: string };
    ru: { title: string; content: string };
  };
  author_id: string;
  published_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Faction {
  id: string;
  name: string;
  description?: string;
  icon_path?: string;
  created_at: Date;
}

export interface GameMap {
  id: string;
  name: string;
  created_at: Date;
  usage_count: number;
}
