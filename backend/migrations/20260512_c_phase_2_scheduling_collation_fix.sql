-- Phase 2: Fix collation for match_schedule_confirmations user_id
-- Ensure utf8mb4_general_ci to match tournament_participants for JOIN operations

ALTER TABLE match_schedule_confirmations 
MODIFY user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
