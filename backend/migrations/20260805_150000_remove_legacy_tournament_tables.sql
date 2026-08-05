ALTER TABLE replays
  DROP FOREIGN KEY fk_replays_tournament_match_id;

DROP TABLE IF EXISTS tournament_round_byes;
DROP TABLE IF EXISTS tournament_matches;
DROP TABLE IF EXISTS tournament_round_matches;
DROP TABLE IF EXISTS tournament_rounds;
