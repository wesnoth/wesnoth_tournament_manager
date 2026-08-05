UPDATE match_schedule_proposals
SET visibility = 'public'
WHERE challenge_mode = 'p2p';

ALTER TABLE match_schedule_proposals
  MODIFY COLUMN visibility VARCHAR(20)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    NOT NULL DEFAULT 'public'
    COMMENT 'Visibility for events feed: public';
