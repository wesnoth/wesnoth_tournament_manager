-- Add last_match_date column to users_extension for tracking player activity
-- Used by the daily cron job to mark players as inactive if they haven't played in 30 days

ALTER TABLE users_extension
ADD COLUMN IF NOT EXISTS last_match_date DATETIME NULL COMMENT 'Timestamp of last match participation — used to determine active status';

-- Create index for efficient inactive player queries
CREATE INDEX IF NOT EXISTS idx_users_extension_last_match_date ON users_extension(last_match_date);
