export interface User {
  id: string;
  nickname: string;
  language: 'en' | 'es' | 'zh' | 'de' | 'ru';
  timezone?: string;
  discord_id?: string;
  elo_rating: number;
  level: string;
  is_rated?: boolean;
  matches_played?: number;
  is_admin: boolean;
  is_streamer?: boolean;
  created_at: string;
}

export interface Match {
  id: string;
  winner_id: string;
  loser_id: string;
  map: string;
  winner_faction: string;
  loser_faction: string;
  winner_comments: string;
  winner_rating: number;
  loser_confirmed: boolean;
  created_at: string;
}

export interface Tournament {
  id: string;
  name: string;
  description: string;
  creator_id: string;
  status: 'pending' | 'approved' | 'in_progress' | 'finished';
  system: string;
  created_at: string;
}

export interface News {
  id: string;
  title: string;
  content: string;
  published_at: string;
}
