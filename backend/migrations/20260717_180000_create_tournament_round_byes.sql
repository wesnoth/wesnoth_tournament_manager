-- Persist automatic byes as round events so pairing history and UI details
-- do not need to infer them from missing round-match rows.
CREATE TABLE IF NOT EXISTS tournament_round_byes (
  id char(36) NOT NULL,
  tournament_id char(36) NOT NULL,
  round_id char(36) NOT NULL,
  participant_id char(36) DEFAULT NULL,
  team_id char(36) DEFAULT NULL,
  reason varchar(50) NOT NULL DEFAULT 'automatic_bye',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tournament_round_bye_participant (round_id, participant_id),
  UNIQUE KEY uq_tournament_round_bye_team (round_id, team_id),
  KEY idx_tournament_round_byes_tournament (tournament_id),
  KEY idx_tournament_round_byes_round (round_id),
  CONSTRAINT chk_tournament_round_bye_entity CHECK (
    (participant_id IS NOT NULL AND team_id IS NULL)
    OR (participant_id IS NULL AND team_id IS NOT NULL)
  ),
  CONSTRAINT fk_tournament_round_byes_tournament
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_round_byes_round
    FOREIGN KEY (round_id) REFERENCES tournament_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_round_byes_participant
    FOREIGN KEY (participant_id) REFERENCES tournament_participants(id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_round_byes_team
    FOREIGN KEY (team_id) REFERENCES tournament_teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
