-- Enforce that every scheduling slot belongs to an existing proposal.
--
-- The TEST database has carried this foreign key (unnamed, generated as
-- match_schedule_slots_ibfk_1) while production never had it, so production
-- kept slots whose proposal had been deleted: 40 slots of 5 proposals created
-- between 2026-05-14 and 2026-06-06 (read-only check of the 2026-10-21 dump).
-- Current code already deletes slots before their proposal (cancellation and
-- the expired-schedule cleanup job), and no other table references
-- match_schedule_slots, so removing those orphans loses no reachable data.
--
-- The generated TEST constraint is dropped first and the key is recreated
-- under a stable name in every environment, so later schema comparisons see
-- one definition. Both columns use utf8mb4_unicode_ci, and idx_proposal_id
-- already indexes the referencing column. Each statement is safe to rerun.

ALTER TABLE match_schedule_slots
  DROP FOREIGN KEY IF EXISTS match_schedule_slots_ibfk_1;

DELETE slots
  FROM match_schedule_slots slots
  LEFT JOIN match_schedule_proposals proposals ON proposals.id = slots.proposal_id
  WHERE proposals.id IS NULL;

ALTER TABLE match_schedule_slots
  ADD CONSTRAINT fk_match_schedule_slots_proposal FOREIGN KEY IF NOT EXISTS (proposal_id)
    REFERENCES match_schedule_proposals (id) ON DELETE CASCADE;
