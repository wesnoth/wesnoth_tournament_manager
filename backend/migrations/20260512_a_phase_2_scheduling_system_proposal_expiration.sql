-- Phase 2: Enhanced Scheduling System - Proposal Expiration
-- Adds expiration tracking to scheduling proposals for automatic cleanup
-- IMPORTANT: expires_at should be calculated when proposal is created as max(slot_datetime) + 7 days

-- 1. Add expiration fields to match_schedule_proposals
ALTER TABLE match_schedule_proposals
ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL COMMENT 'Calculated when proposal created: max(slot_datetime) + 7 days. Used to auto-expire stale proposals' AFTER status,
ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL COMMENT 'Timestamp when proposal was cancelled or expired. After 7 days in cancelled state, proposal is purged' AFTER expires_at,
ADD COLUMN IF NOT EXISTS user_id CHAR(36) NULL COMMENT 'FK→users_extension.id. For future P2P proposals without tournament context. NULL if tournament-based.' AFTER cancelled_at;

-- 2. Add indexes for expiration and user queries
ALTER TABLE match_schedule_proposals
ADD INDEX IF NOT EXISTS idx_expires_at (expires_at),
ADD INDEX IF NOT EXISTS idx_cancelled_at (cancelled_at),
ADD INDEX IF NOT EXISTS idx_user_id (user_id);
