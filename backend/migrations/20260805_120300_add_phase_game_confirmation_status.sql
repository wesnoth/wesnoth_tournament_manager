ALTER TABLE tournament_games
  ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(20)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    NOT NULL DEFAULT 'unconfirmed'
    COMMENT 'Manual result confirmation: unconfirmed | reported | confirmed | disputed'
    AFTER status,
  ADD KEY IF NOT EXISTS idx_tournament_games_confirmation_status (confirmation_status);

UPDATE tournament_games
SET confirmation_status = CASE
  WHEN loser_comments IS NOT NULL OR loser_rating IS NOT NULL THEN 'confirmed'
  WHEN winner_comments IS NOT NULL OR winner_rating IS NOT NULL THEN 'reported'
  ELSE 'unconfirmed'
END
WHERE status = 'completed' AND organizer_action IS NULL;

UPDATE tournament_games games
JOIN replays replay ON replay.tournament_game_id = games.id
SET games.confirmation_status = 'reported'
WHERE games.status = 'completed'
  AND games.organizer_action IS NULL
  AND replay.integration_confidence >= 2;
