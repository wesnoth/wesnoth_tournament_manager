-- Users extension table (actual user profiles with app-specific data)
-- Extends forum phpbb3_users with tournament application fields
CREATE TABLE IF NOT EXISTS users_extension (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL UNIQUE COMMENT 'Foreign key to forum phpbb3_users.user_id',
  nickname VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  language VARCHAR(2) DEFAULT 'en',
  discord_id VARCHAR(255),
  elo_rating INTEGER DEFAULT 1200,
  level VARCHAR(50) DEFAULT 'novato',
  is_active BOOLEAN DEFAULT false,
  is_blocked BOOLEAN DEFAULT false,
  is_admin BOOLEAN DEFAULT false,
  is_moderator BOOLEAN DEFAULT false,
  country VARCHAR(2),
  avatar VARCHAR(255),
  enable_ranked BOOLEAN DEFAULT false,
  is_rated BOOLEAN DEFAULT false,
  matches_played INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  trend VARCHAR(50),
  timezone VARCHAR(100) DEFAULT 'UTC' COMMENT 'IANA timezone name (e.g., Europe/Madrid, America/New_York)',
  availability_schedule JSON NULL COMMENT 'Object with day keys (monday-sunday) containing array of {start, end} time ranges',
  availability_updated_at DATETIME NULL COMMENT 'Timestamp when availability was last modified',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Password policy table
CREATE TABLE IF NOT EXISTS password_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_length INTEGER DEFAULT 8,
  require_uppercase BOOLEAN DEFAULT true,
  require_lowercase BOOLEAN DEFAULT true,
  require_numbers BOOLEAN DEFAULT true,
  require_symbols BOOLEAN DEFAULT true,
  previous_passwords_count INTEGER DEFAULT 5,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Password history table
CREATE TABLE IF NOT EXISTS password_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users_extension(id) ON DELETE CASCADE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Registration requests table
CREATE TABLE IF NOT EXISTS registration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  language VARCHAR(2),
  discord_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by UUID REFERENCES users_extension(id)
);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_id UUID NOT NULL REFERENCES users_extension(id),
  loser_id UUID NOT NULL REFERENCES users_extension(id),
  map VARCHAR(255) NOT NULL,
  winner_faction VARCHAR(255) NOT NULL,
  loser_faction VARCHAR(255) NOT NULL,
  winner_comments TEXT,
  winner_rating INTEGER CHECK (winner_rating >= 1 AND winner_rating <= 5),
  loser_comments TEXT,
  loser_rating INTEGER CHECK (loser_rating >= 1 AND loser_rating <= 5),
  status VARCHAR(20) DEFAULT 'unconfirmed',
  replay_file_path VARCHAR(500),
  replay_downloads INTEGER DEFAULT 0,
  tournament_id UUID,
  elo_change INTEGER,
  winner_elo_before INTEGER,
  winner_elo_after INTEGER,
  loser_elo_before INTEGER,
  loser_elo_after INTEGER,
  winner_level_before VARCHAR(50),
  winner_level_after VARCHAR(50),
  loser_level_before VARCHAR(50),
  loser_level_after VARCHAR(50),
  winner_ranking_pos INTEGER,
  winner_ranking_change INTEGER,
  loser_ranking_pos INTEGER,
  loser_ranking_change INTEGER,
  admin_reviewed BOOLEAN DEFAULT false,
  admin_reviewed_at TIMESTAMP,
  admin_reviewed_by UUID REFERENCES users_extension(id),
  round_id UUID REFERENCES tournament_rounds(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  creator_id UUID NOT NULL REFERENCES users_extension(id),
  status VARCHAR(30) DEFAULT 'registration_open',
  tournament_type VARCHAR(50) NOT NULL,
  max_participants INTEGER NOT NULL,
  current_round INTEGER DEFAULT 0,
  total_rounds INTEGER DEFAULT 0,
  round_duration_days INTEGER DEFAULT 7,
  auto_advance_round BOOLEAN DEFAULT false,
  round_deadline TIMESTAMP,
  general_rounds INTEGER DEFAULT 0,
  final_rounds INTEGER DEFAULT 0,
  general_rounds_format VARCHAR(10) DEFAULT 'bo3' CHECK (general_rounds_format IN ('bo1', 'bo3', 'bo5')),
  final_rounds_format VARCHAR(10) DEFAULT 'bo5' CHECK (final_rounds_format IN ('bo1', 'bo3', 'bo5')),
  approved_at TIMESTAMP,
  registration_closed_at TIMESTAMP,
  prepared_at TIMESTAMP,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  winner_id UUID REFERENCES users_extension(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tournament participants table
CREATE TABLE IF NOT EXISTS tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users_extension(id),
  participation_status VARCHAR(20) DEFAULT 'pending',
  tournament_ranking INTEGER,
  tournament_wins INTEGER DEFAULT 0,
  tournament_losses INTEGER DEFAULT 0,
  tournament_points INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, user_id)
);

-- Tournament rounds configuration table
CREATE TABLE IF NOT EXISTS tournament_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  round_type VARCHAR(20) NOT NULL CHECK (round_type IN ('general', 'final')),
  match_format VARCHAR(10) NOT NULL CHECK (match_format IN ('bo1', 'bo3', 'bo5')),
  round_status VARCHAR(20) DEFAULT 'pending' CHECK (round_status IN ('pending', 'in_progress', 'completed')),
  round_phase_label VARCHAR(100),
  round_phase_description VARCHAR(255),
  round_classification VARCHAR(50) CHECK (round_classification IN ('standard', 'swiss', 'general', 'elimination', 'quarterfinals', 'semifinals', 'final')),
  players_remaining INTEGER,
  players_advancing_to_next INTEGER,
  round_start_date TIMESTAMP,
  round_end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, round_number)
);

-- News table
CREATE TABLE IF NOT EXISTS news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  translations JSONB DEFAULT '{"en":{},"es":{},"zh":{},"de":{}}',
  author_id UUID NOT NULL REFERENCES users_extension(id),
  language_code VARCHAR(10) DEFAULT 'en',
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, language_code)
);

-- FAQ table
CREATE TABLE IF NOT EXISTS faq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question VARCHAR(500) NOT NULL,
  answer TEXT NOT NULL,
  language_code VARCHAR(10) DEFAULT 'en',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Factions table
CREATE TABLE IF NOT EXISTS factions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  icon_path VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Game maps table
CREATE TABLE IF NOT EXISTS game_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  usage_count INTEGER DEFAULT 1
);

-- Online users table
CREATE TABLE IF NOT EXISTS online_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users_extension(id),
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users_extension(id),
  receiver_id UUID NOT NULL REFERENCES users_extension(id),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tournament matches table (tracks individual matches in tournament rounds)
CREATE TABLE IF NOT EXISTS tournament_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
  player1_id UUID NOT NULL REFERENCES users_extension(id) ON DELETE CASCADE,
  player2_id UUID NOT NULL REFERENCES users_extension(id) ON DELETE CASCADE,
  winner_id UUID REFERENCES users_extension(id) ON DELETE SET NULL,
  match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
  tournament_round_match_id UUID,
  match_status VARCHAR(20) DEFAULT 'pending' CHECK (match_status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  played_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tournament round matches table (tracks Best Of series per player pairing)
CREATE TABLE IF NOT EXISTS tournament_round_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
  player1_id UUID NOT NULL REFERENCES users_extension(id) ON DELETE CASCADE,
  player2_id UUID NOT NULL REFERENCES users_extension(id) ON DELETE CASCADE,
  best_of INT NOT NULL CHECK (best_of IN (1, 3, 5)),
  wins_required INT NOT NULL,
  player1_wins INT NOT NULL DEFAULT 0,
  player2_wins INT NOT NULL DEFAULT 0,
  matches_scheduled INT NOT NULL DEFAULT 0,
  series_status VARCHAR(50) NOT NULL DEFAULT 'in_progress' CHECK (series_status IN ('in_progress', 'completed')),
  winner_id UUID REFERENCES users_extension(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tournament_id, round_id, player1_id, player2_id)
);

-- Add foreign key constraint for tournament_round_match_id after table creation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'tournament_matches' 
    AND constraint_name = 'fk_tournament_round_match_id'
  ) THEN
    ALTER TABLE tournament_matches
    ADD CONSTRAINT fk_tournament_round_match_id
    FOREIGN KEY (tournament_round_match_id)
    REFERENCES tournament_round_matches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_extension_nickname ON users_extension(nickname);
CREATE INDEX IF NOT EXISTS idx_users_extension_email ON users_extension(email);
CREATE INDEX IF NOT EXISTS idx_matches_winner ON matches(winner_id);
CREATE INDEX IF NOT EXISTS idx_matches_loser ON matches(loser_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round_id);
CREATE INDEX IF NOT EXISTS idx_tournament_creator ON tournaments(creator_id);
CREATE INDEX IF NOT EXISTS idx_tournament_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournament_rounds_tournament ON tournament_rounds(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_rounds_status ON tournament_rounds(round_status);
CREATE INDEX IF NOT EXISTS idx_tournament_round_matches_tournament ON tournament_round_matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_round_matches_round ON tournament_round_matches(round_id);
CREATE INDEX IF NOT EXISTS idx_tournament_round_matches_status ON tournament_round_matches(series_status);
CREATE INDEX IF NOT EXISTS idx_news_author ON news(author_id);
CREATE INDEX IF NOT EXISTS idx_news_language_code ON news(language_code);
CREATE INDEX IF NOT EXISTS idx_chat_sender ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_receiver ON chat_messages(receiver_id);

-- Match scheduling tables (Phase 1)
-- Stores proposals for scheduling matches at tournament_round_matches or tournament_matches level
CREATE TABLE IF NOT EXISTS match_schedule_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_round_match_id UUID REFERENCES tournament_round_matches(id) ON DELETE CASCADE,
  tournament_match_id UUID REFERENCES tournament_matches(id) ON DELETE CASCADE,
  proposed_by_user_id UUID NOT NULL REFERENCES users_extension(id) ON DELETE CASCADE,
  proposed_at TIMESTAMP NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'resolved')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_match_schedule_proposals_round_match ON match_schedule_proposals(tournament_round_match_id);
CREATE INDEX IF NOT EXISTS idx_match_schedule_proposals_match ON match_schedule_proposals(tournament_match_id);
CREATE INDEX IF NOT EXISTS idx_match_schedule_proposals_status ON match_schedule_proposals(status);
CREATE INDEX IF NOT EXISTS idx_match_schedule_proposals_proposed_by ON match_schedule_proposals(proposed_by_user_id);

-- Individual time slots within a proposal (slots are in UTC, rounded to nearest 30-minute mark)
CREATE TABLE IF NOT EXISTS match_schedule_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES match_schedule_proposals(id) ON DELETE CASCADE,
  slot_datetime TIMESTAMP NOT NULL,
  slot_duration_minutes INTEGER DEFAULT 30,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(proposal_id, slot_datetime)
);

CREATE INDEX IF NOT EXISTS idx_match_schedule_slots_proposal ON match_schedule_slots(proposal_id);
CREATE INDEX IF NOT EXISTS idx_match_schedule_slots_datetime ON match_schedule_slots(slot_datetime);
CREATE INDEX IF NOT EXISTS idx_match_schedule_slots_status ON match_schedule_slots(status);

-- User/team confirmations for proposed time slots
CREATE TABLE IF NOT EXISTS match_schedule_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES match_schedule_slots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users_extension(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_match_schedule_confirmations_slot ON match_schedule_confirmations(slot_id);
CREATE INDEX IF NOT EXISTS idx_match_schedule_confirmations_user ON match_schedule_confirmations(user_id);
