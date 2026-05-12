-- Phase 2: Enhanced Scheduling System - Confirmations Refactor
-- Restructures match_schedule_confirmations to use proposal-level confirmations instead of per-slot
-- This fixes ER_DUP_ENTRY errors and implements proper confirmation logic

-- 1. Drop old table (table is empty, no data loss)
DROP TABLE IF EXISTS match_schedule_confirmations;

-- 2. Create new match_schedule_confirmations table with proposal-level confirmations
CREATE TABLE IF NOT EXISTS match_schedule_confirmations (
  id CHAR(36) NOT NULL PRIMARY KEY COMMENT 'UUID v4',
  proposal_id CHAR(36) NOT NULL COMMENT 'Reference to match_schedule_proposals.id - CHANGED FROM slot_id',
  user_id CHAR(36) NOT NULL COMMENT 'Reference to users_extension.id - user confirming the proposal',
  confirmed_at DATETIME NOT NULL COMMENT 'Timestamp of confirmation',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- Each user can only confirm each proposal once
  UNIQUE KEY uq_proposal_user (proposal_id, user_id),
  
  -- Indexes for common queries
  INDEX idx_proposal_id (proposal_id),
  INDEX idx_user_id (user_id),
  
  -- Foreign key constraint to proposals (users_extension FK removed - handled at service layer for now)
  CONSTRAINT fk_confirmation_proposal FOREIGN KEY (proposal_id) REFERENCES match_schedule_proposals(id) ON DELETE CASCADE
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='User confirmations for scheduling proposals - proposal-level, not per-slot. Each user confirms entire proposal.';
