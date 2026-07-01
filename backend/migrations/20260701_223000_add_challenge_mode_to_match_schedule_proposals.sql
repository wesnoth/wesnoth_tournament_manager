-- Add explicit challenge context fields to scheduling proposals
-- Tournament proposals remain tied to tournament_round_match_id/tournament_match_id
-- P2P proposals use challenge_mode='p2p' + challenged_user_id

ALTER TABLE match_schedule_proposals
ADD COLUMN IF NOT EXISTS challenge_mode VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tournament' COMMENT 'Proposal context: tournament | p2p' AFTER user_id,
ADD COLUMN IF NOT EXISTS challenged_user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL COMMENT 'Target user for P2P challenges. NULL for tournament proposals' AFTER challenge_mode,
ADD COLUMN IF NOT EXISTS discord_thread_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Optional Discord thread/message id for challenge conversations' AFTER challenged_user_id,
ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'private' COMMENT 'Visibility for events feed: private | public' AFTER discord_thread_id;

ALTER TABLE match_schedule_proposals
ADD INDEX IF NOT EXISTS idx_challenge_mode (challenge_mode),
ADD INDEX IF NOT EXISTS idx_challenged_user_id (challenged_user_id);

-- Backfill legacy P2P-like rows:
-- only rows with no tournament context and legacy user_id populated.
UPDATE match_schedule_proposals
SET challenge_mode = 'p2p',
    challenged_user_id = user_id
WHERE user_id IS NOT NULL
  AND tournament_round_match_id IS NULL
  AND tournament_match_id IS NULL
  AND challenge_mode = 'tournament'
  AND challenged_user_id IS NULL;
