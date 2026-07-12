-- ============================================================
-- WESNOTH TOURNAMENT MANAGER - COMPLETE SCHEMA
-- Generated: 2025-12-16T21:40:17.186906
-- Source: Local PostgreSQL Database
-- ============================================================
-- This schema is idempotent (safe to run multiple times)
-- All CREATE TABLE statements use IF NOT EXISTS
-- ============================================================

-- chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- factions table
CREATE TABLE IF NOT EXISTS factions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name character varying(255) NOT NULL,
  description text,
  icon_path character varying(500),
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- game_maps table
CREATE TABLE IF NOT EXISTS game_maps (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name character varying(255) NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  usage_count integer DEFAULT 1,
  PRIMARY KEY (id)
);

-- matches table
CREATE TABLE IF NOT EXISTS matches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  winner_id uuid NOT NULL,
  loser_id uuid NOT NULL,
  map character varying(255) NOT NULL,
  winner_faction character varying(255) NOT NULL,
  loser_faction character varying(255) NOT NULL,
  winner_comments text,
  winner_rating integer,
  loser_comments text,
  loser_rating integer,
  loser_confirmed boolean DEFAULT false,
  replay_file_path character varying(500),
  tournament_id uuid,
  elo_change integer,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  status character varying(50) DEFAULT 'unconfirmed'::character varying,
  admin_reviewed boolean DEFAULT false,
  admin_reviewed_at timestamp without time zone,
  admin_reviewed_by uuid,
  winner_elo_before integer DEFAULT 1600,
  winner_elo_after integer DEFAULT 1600,
  loser_elo_before integer DEFAULT 1600,
  loser_elo_after integer DEFAULT 1600,
  winner_level_before character varying(50) DEFAULT 'novato'::character varying,
  winner_level_after character varying(50) DEFAULT 'novato'::character varying,
  loser_level_before character varying(50) DEFAULT 'novato'::character varying,
  loser_level_after character varying(50) DEFAULT 'novato'::character varying,
  replay_downloads integer DEFAULT 0,
  winner_ranking_pos integer,
  winner_ranking_change integer,
  loser_ranking_pos integer,
  loser_ranking_change integer,
  round_id uuid,
  PRIMARY KEY (id),
  FOREIGN KEY (winner_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (loser_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (admin_reviewed_by) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  FOREIGN KEY (round_id) REFERENCES tournament_rounds(id) ON DELETE SET NULL ON UPDATE NO ACTION
);

-- news table
CREATE TABLE IF NOT EXISTS news (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  title character varying(255) NOT NULL,
  content text NOT NULL,
  translations jsonb DEFAULT '{"de": {}, "en": {}, "es": {}, "zh": {}}'::jsonb,
  author_id uuid NOT NULL,
  published_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  language_code character varying(10) DEFAULT 'en'::character varying,
  PRIMARY KEY (id),
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- online_users table
CREATE TABLE IF NOT EXISTS online_users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  last_seen timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- password_history table
CREATE TABLE IF NOT EXISTS password_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  password_hash character varying(255) NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

-- password_policy table
CREATE TABLE IF NOT EXISTS password_policy (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  min_length integer DEFAULT 8,
  require_uppercase boolean DEFAULT true,
  require_lowercase boolean DEFAULT true,
  require_numbers boolean DEFAULT true,
  require_symbols boolean DEFAULT true,
  previous_passwords_count integer DEFAULT 5,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- registration_requests table
CREATE TABLE IF NOT EXISTS registration_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nickname character varying(255) NOT NULL,
  email character varying(255) NOT NULL,
  language character varying(2),
  discord_id character varying(255),
  status character varying(20) DEFAULT 'pending'::character varying,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  reviewed_at timestamp without time zone,
  reviewed_by uuid,
  PRIMARY KEY (id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- tournament_matches table
CREATE TABLE IF NOT EXISTS tournament_matches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tournament_id uuid NOT NULL,
  round_id uuid NOT NULL,
  player1_id uuid NOT NULL,
  player2_id uuid NOT NULL,
  winner_id uuid,
  match_id uuid,
  match_status character varying(20) DEFAULT 'pending'::character varying,
  played_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  tournament_round_match_id uuid,
  PRIMARY KEY (id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (round_id) REFERENCES tournament_rounds(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (player1_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (player2_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (winner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  FOREIGN KEY (tournament_round_match_id) REFERENCES tournament_round_matches(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  FOREIGN KEY (tournament_round_match_id) REFERENCES tournament_round_matches(id) ON DELETE SET NULL ON UPDATE NO ACTION
);

-- tournament_participants table
CREATE TABLE IF NOT EXISTS tournament_participants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tournament_id uuid NOT NULL,
  user_id uuid NOT NULL,
  current_round integer DEFAULT 1,
  status character varying(20) DEFAULT 'active'::character varying,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  participation_status character varying(20) DEFAULT 'pending'::character varying,
  tournament_ranking integer,
  tournament_wins integer DEFAULT 0,
  tournament_losses integer DEFAULT 0,
  tournament_points integer DEFAULT 0,
  PRIMARY KEY (id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- tournament_round_matches table
CREATE TABLE IF NOT EXISTS tournament_round_matches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tournament_id uuid NOT NULL,
  round_id uuid NOT NULL,
  player1_id uuid NOT NULL,
  player2_id uuid NOT NULL,
  best_of integer NOT NULL,
  wins_required integer NOT NULL,
  player1_wins integer DEFAULT 0 NOT NULL,
  player2_wins integer DEFAULT 0 NOT NULL,
  matches_scheduled integer DEFAULT 0 NOT NULL,
  series_status character varying(50) DEFAULT 'in_progress'::character varying NOT NULL,
  winner_id uuid,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (round_id) REFERENCES tournament_rounds(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (player1_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (player2_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY (winner_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE NO ACTION
);

-- tournament_rounds table
CREATE TABLE IF NOT EXISTS tournament_rounds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tournament_id uuid NOT NULL,
  round_number integer NOT NULL,
  match_format character varying(10) NOT NULL,
  round_status character varying(20) DEFAULT 'pending'::character varying,
  round_start_date timestamp without time zone,
  round_end_date timestamp without time zone,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  round_type character varying(20) DEFAULT 'general'::character varying,
  round_classification character varying(50) DEFAULT 'standard'::character varying,
  players_remaining integer,
  players_advancing_to_next integer,
  round_phase_label character varying(100),
  round_phase_description character varying(255),
  PRIMARY KEY (id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

-- tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name character varying(255) NOT NULL,
  description text NOT NULL,
  creator_id uuid NOT NULL,
  status character varying(20) DEFAULT 'pending'::character varying,
  approved_at timestamp without time zone,
  started_at timestamp without time zone,
  finished_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  general_rounds integer DEFAULT 0,
  final_rounds integer DEFAULT 0,
  registration_closed_at timestamp without time zone,
  prepared_at timestamp without time zone,
  tournament_type character varying(50),
  max_participants integer,
  round_duration_days integer DEFAULT 7,
  auto_advance_round boolean DEFAULT false,
  current_round integer DEFAULT 0,
  total_rounds integer DEFAULT 0,
  general_rounds_format character varying(10) DEFAULT 'bo3'::character varying,
  final_rounds_format character varying(10) DEFAULT 'bo5'::character varying,
  PRIMARY KEY (id),
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- users table
CREATE TABLE IF NOT EXISTS users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nickname character varying(255) NOT NULL,
  email character varying(255) NOT NULL,
  password_hash character varying(255) NOT NULL,
  language character varying(2) DEFAULT 'en'::character varying,
  discord_id character varying(255),
  elo_rating integer DEFAULT 1600,
  level character varying(50) DEFAULT 'novato'::character varying,
  is_active boolean DEFAULT false,
  is_blocked boolean DEFAULT false,
  is_admin boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  is_rated boolean DEFAULT false,
  matches_played integer DEFAULT 0,
  elo_provisional boolean DEFAULT false,
  total_wins integer DEFAULT 0,
  total_losses integer DEFAULT 0,
  trend character varying(10) DEFAULT '-'::character varying,
  PRIMARY KEY (id)
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_chat_receiver ON public.chat_messages USING btree (receiver_id);
CREATE INDEX idx_chat_sender ON public.chat_messages USING btree (sender_id);
CREATE INDEX idx_matches_admin_reviewed ON public.matches USING btree (admin_reviewed);
CREATE INDEX idx_matches_created_at ON public.matches USING btree (created_at DESC);
CREATE INDEX idx_matches_created_at_desc ON public.matches USING btree (created_at DESC);
CREATE INDEX idx_matches_loser ON public.matches USING btree (loser_id);
CREATE INDEX idx_matches_round ON public.matches USING btree (round_id);
CREATE INDEX idx_matches_status ON public.matches USING btree (status);
CREATE INDEX idx_matches_tournament ON public.matches USING btree (tournament_id);
CREATE INDEX idx_matches_winner ON public.matches USING btree (winner_id);
CREATE INDEX idx_news_author ON public.news USING btree (author_id);
CREATE INDEX idx_news_language_code ON public.news USING btree (language_code);
CREATE INDEX idx_tournament_matches_match ON public.tournament_matches USING btree (match_id);
CREATE INDEX idx_tournament_matches_player1 ON public.tournament_matches USING btree (player1_id);
CREATE INDEX idx_tournament_matches_player2 ON public.tournament_matches USING btree (player2_id);
CREATE INDEX idx_tournament_matches_round ON public.tournament_matches USING btree (round_id);
CREATE INDEX idx_tournament_matches_round_match ON public.tournament_matches USING btree (tournament_round_match_id);
CREATE INDEX idx_tournament_matches_status ON public.tournament_matches USING btree (match_status);
CREATE INDEX idx_tournament_matches_tournament ON public.tournament_matches USING btree (tournament_id);
CREATE INDEX idx_tournament_matches_winner ON public.tournament_matches USING btree (winner_id);
CREATE INDEX idx_tournament_round_matches_players ON public.tournament_round_matches USING btree (player1_id, player2_id);
CREATE INDEX idx_tournament_round_matches_round ON public.tournament_round_matches USING btree (round_id);
CREATE INDEX idx_tournament_round_matches_status ON public.tournament_round_matches USING btree (series_status);
CREATE INDEX idx_tournament_round_matches_tournament ON public.tournament_round_matches USING btree (tournament_id);
CREATE INDEX idx_tournament_rounds_classification ON public.tournament_rounds USING btree (round_classification);
CREATE INDEX idx_tournament_rounds_status ON public.tournament_rounds USING btree (round_status);
CREATE INDEX idx_tournament_rounds_tournament ON public.tournament_rounds USING btree (tournament_id);
CREATE INDEX idx_tournament_rounds_type ON public.tournament_rounds USING btree (round_type);
CREATE INDEX idx_tournament_creator ON public.tournaments USING btree (creator_id);
CREATE INDEX idx_tournament_status ON public.tournaments USING btree (status);
CREATE INDEX idx_tournaments_creator ON public.tournaments USING btree (creator_id);
CREATE INDEX idx_tournaments_formats ON public.tournaments USING btree (general_rounds_format, final_rounds_format);
CREATE INDEX idx_tournaments_status ON public.tournaments USING btree (status);
CREATE INDEX idx_users_elo_rating ON public.users USING btree (elo_rating);
CREATE INDEX idx_users_email ON public.users USING btree (email);
CREATE INDEX idx_users_is_rated ON public.users USING btree (is_rated);
CREATE INDEX idx_users_matches_played ON public.users USING btree (matches_played);
CREATE INDEX idx_users_nickname ON public.users USING btree (nickname);
CREATE INDEX idx_users_total_losses ON public.users USING btree (total_losses);
CREATE INDEX idx_users_total_wins ON public.users USING btree (total_wins DESC);
CREATE INDEX idx_users_trend ON public.users USING btree (trend);

-- ============================================================
-- Schema generation complete
-- Total tables: 16
-- Total indexes: 41
-- ============================================================
