-- Remove the redundant proposal-level user reference.
-- The proposal creator is proposed_by_user_id and action confirmations use
-- match_schedule_confirmations.user_id, so this column stores no unique state.

ALTER TABLE match_schedule_proposals
  DROP INDEX idx_user_id,
  DROP COLUMN user_id;
