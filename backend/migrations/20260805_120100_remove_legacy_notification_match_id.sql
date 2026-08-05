ALTER TABLE user_notifications
  DROP INDEX idx_match_id,
  DROP COLUMN match_id;
