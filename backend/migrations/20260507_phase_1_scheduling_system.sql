-- Phase 1: Enhanced Scheduling System - Database Schema
-- Adds timezone awareness, availability scheduling, and match schedule proposals

-- 1. Update users_extension table to include timezone and availability (if not already present)
ALTER TABLE users_extension
ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'UTC' COMMENT 'IANA timezone name (e.g., Europe/Madrid, America/New_York)' AFTER is_admin,
ADD COLUMN IF NOT EXISTS availability_schedule JSON NULL COMMENT 'Object with day keys (monday-sunday) containing array of {start, end} time ranges' AFTER timezone,
ADD COLUMN IF NOT EXISTS availability_updated_at DATETIME NULL COMMENT 'Timestamp when availability was last modified' AFTER availability_schedule;

-- 2. Create match_schedule_proposals table
-- Stores proposals for scheduling matches at tournament_round_matches or tournament_matches level
CREATE TABLE IF NOT EXISTS match_schedule_proposals (
  id CHAR(36) PRIMARY KEY COMMENT 'UUID v4',
  tournament_round_match_id CHAR(36) NULL COMMENT 'FK→tournament_round_matches.id (series-level)',
  tournament_match_id CHAR(36) NULL COMMENT 'FK→tournament_matches.id (game-level)',
  proposed_by_user_id CHAR(36) NOT NULL COMMENT 'FK→users_extension.id',
  proposed_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active | superseded | resolved',
  notes TEXT NULL COMMENT 'Player notes (max 500 chars)',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (tournament_round_match_id) REFERENCES tournament_round_matches(id) ON DELETE CASCADE,
  FOREIGN KEY (tournament_match_id) REFERENCES tournament_matches(id) ON DELETE CASCADE,
  FOREIGN KEY (proposed_by_user_id) REFERENCES users_extension(id) ON DELETE CASCADE,
  
  CONSTRAINT check_proposal_target CHECK (
    (tournament_round_match_id IS NOT NULL AND tournament_match_id IS NULL) OR
    (tournament_round_match_id IS NULL AND tournament_match_id IS NOT NULL)
  ),
  
  INDEX idx_round_match_id (tournament_round_match_id),
  INDEX idx_match_id (tournament_match_id),
  INDEX idx_proposed_by (proposed_by_user_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='Scheduling proposals at round or individual match level';

-- 3. Create match_schedule_slots table
-- Individual time slots within a proposal - slots are in UTC, rounded to nearest 30-minute mark
CREATE TABLE IF NOT EXISTS match_schedule_slots (
  id CHAR(36) PRIMARY KEY COMMENT 'UUID v4',
  proposal_id CHAR(36) NOT NULL COMMENT 'FK→match_schedule_proposals.id',
  slot_datetime DATETIME NOT NULL COMMENT 'UTC timestamp, rounded to nearest 30-minute mark (HH:00 or HH:30)',
  slot_duration_minutes INT DEFAULT 30 COMMENT 'Always 30 minutes',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | confirmed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (proposal_id) REFERENCES match_schedule_proposals(id) ON DELETE CASCADE,
  
  UNIQUE KEY uq_proposal_slot_time (proposal_id, slot_datetime),
  INDEX idx_proposal_id (proposal_id),
  INDEX idx_slot_datetime (slot_datetime),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='Individual 30-minute time slots within proposals';

-- 4. Create match_schedule_confirmations table
-- Tracks user/team confirmations for proposed time slots
CREATE TABLE IF NOT EXISTS match_schedule_confirmations (
  id CHAR(36) PRIMARY KEY COMMENT 'UUID v4',
  slot_id CHAR(36) NOT NULL COMMENT 'FK→match_schedule_slots.id',
  user_id CHAR(36) NOT NULL COMMENT 'FK→users_extension.id',
  team_id CHAR(36) NULL COMMENT 'FK→tournament_teams.id (only for team matches)',
  confirmed_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (slot_id) REFERENCES match_schedule_slots(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users_extension(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES tournament_teams(id) ON DELETE SET NULL,
  
  UNIQUE KEY uq_slot_user (slot_id, user_id),
  INDEX idx_slot_id (slot_id),
  INDEX idx_user_id (user_id),
  INDEX idx_team_id (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='User/team confirmations for proposed match slots';
