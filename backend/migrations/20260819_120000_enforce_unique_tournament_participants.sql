-- Remove only accidental duplicate rows that have no competitive or replacement references.
-- Referenced duplicates remain visible and make the unique-key statement fail for manual reconciliation.
DELETE duplicate_participant
FROM tournament_participants duplicate_participant
JOIN tournament_participants keeper
  ON keeper.tournament_id = duplicate_participant.tournament_id
 AND keeper.user_id = duplicate_participant.user_id
 AND (
   CASE keeper.participation_status
     WHEN 'accepted' THEN 6
     WHEN 'pending_replacement' THEN 5
     WHEN 'unconfirmed' THEN 4
     WHEN 'pending' THEN 3
     WHEN 'replaced' THEN 2
     ELSE 1
   END > CASE duplicate_participant.participation_status
     WHEN 'accepted' THEN 6
     WHEN 'pending_replacement' THEN 5
     WHEN 'unconfirmed' THEN 4
     WHEN 'pending' THEN 3
     WHEN 'replaced' THEN 2
     ELSE 1
   END
   OR (
     keeper.participation_status = duplicate_participant.participation_status
     AND (
       keeper.created_at < duplicate_participant.created_at
       OR (keeper.created_at = duplicate_participant.created_at AND keeper.id < duplicate_participant.id)
     )
   )
 )
LEFT JOIN tournament_entries competition_entry
  ON competition_entry.participant_id = duplicate_participant.id
LEFT JOIN tournament_phase_entry_assignments phase_assignment
  ON phase_assignment.participant_id = duplicate_participant.id
LEFT JOIN tournament_participants replacement_reference
  ON replacement_reference.replaced_by_participant_id = duplicate_participant.id
  OR replacement_reference.requested_replacement_of_id = duplicate_participant.id
WHERE competition_entry.id IS NULL
  AND phase_assignment.id IS NULL
  AND replacement_reference.id IS NULL;

ALTER TABLE tournament_participants
  ADD UNIQUE KEY uq_tournament_participants_tournament_user (tournament_id, user_id);
