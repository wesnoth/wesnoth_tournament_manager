ALTER TABLE tournament_games
  ADD COLUMN IF NOT EXISTS winner_side TINYINT UNSIGNED NULL AFTER loser_faction,
  ADD CONSTRAINT chk_tournament_games_winner_side
    CHECK (winner_side IS NULL OR winner_side IN (1, 2));
