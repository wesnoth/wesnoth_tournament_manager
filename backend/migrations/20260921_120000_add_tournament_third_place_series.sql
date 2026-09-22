ALTER TABLE tournament_series
  ADD COLUMN series_role VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'main' AFTER series_position;

-- Prepared final brackets already have their rounds and semifinal series.
-- Add the bronze series only while the final phase is ready and untouched.
INSERT INTO tournament_series
  (id, round_id, series_position, series_role, status, best_of, wins_required)
SELECT UUID(), final_round.id, 2, 'third_place', 'pending', final_round.best_of,
       FLOOR(final_round.best_of / 2) + 1
FROM tournament_phases phase
JOIN tournament_phase_groups group_row ON group_row.phase_id = phase.id
JOIN tournament_phase_rounds final_round ON final_round.group_id = group_row.id
JOIN tournament_phase_rounds semi_round ON semi_round.group_id = group_row.id
  AND semi_round.round_number = final_round.round_number - 1
WHERE phase.format = 'single_elimination' AND phase.status = 'ready'
  AND NOT EXISTS (
    SELECT 1 FROM tournament_phases later
    WHERE later.tournament_id = phase.tournament_id AND later.phase_order > phase.phase_order
  )
  AND (SELECT COUNT(*) FROM tournament_phase_groups g WHERE g.phase_id = phase.id) = 1
  AND (SELECT COUNT(*) FROM tournament_phase_entries e WHERE e.group_id = group_row.id) >= 4
  AND (SELECT COUNT(*) FROM tournament_series s WHERE s.round_id = semi_round.id) = 2
  AND (SELECT COUNT(*) FROM tournament_series s WHERE s.round_id = final_round.id) = 1
  AND (SELECT COUNT(*) FROM tournament_series s WHERE s.round_id = semi_round.id AND s.status = 'completed') = 0;

INSERT INTO tournament_series_slots
  (id, series_id, slot_number, source_type, source_series_id, source_outcome)
SELECT UUID(), bronze.id, semi.series_position, 'series_result', semi.id, 'loser'
FROM tournament_series bronze
JOIN tournament_phase_rounds final_round ON final_round.id = bronze.round_id
JOIN tournament_phase_rounds semi_round ON semi_round.group_id = final_round.group_id
  AND semi_round.round_number = final_round.round_number - 1
JOIN tournament_series semi ON semi.round_id = semi_round.id
WHERE bronze.series_role = 'third_place'
  AND NOT EXISTS (SELECT 1 FROM tournament_series_slots slot WHERE slot.series_id = bronze.id);
