-- Record which participant opened a ranked match dispute.
-- Either participant may now dispute (the reported winner too, e.g. after a
-- mistaken surrender), so loser_id no longer identifies the disputing player.
-- NULL for matches that were never disputed and for disputes opened before
-- this column existed. The value is kept after an admin resolves the dispute
-- as part of the match history.
ALTER TABLE matches
  ADD COLUMN disputed_by CHAR(36) NULL AFTER admin_reviewed_by;
