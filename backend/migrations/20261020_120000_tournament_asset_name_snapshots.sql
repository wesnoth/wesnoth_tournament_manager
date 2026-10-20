-- Store the asset name beside each tournament asset selection.
--
-- tournament_unranked_maps and tournament_unranked_factions only kept the
-- asset id, so a tournament's allowed list needed the game_maps or factions
-- row forever and any selection, even in a finished tournament, prevented
-- the admin from deleting a map or faction (it was only deactivated).
-- With the name stored here the tournament list is read from these rows alone,
-- a finished tournament still shows its list after the asset is deleted, and
-- only active tournaments block deletion.
--
-- The columns use utf8mb4_general_ci, the collation of game_maps.name and
-- factions.name, so the copied name compares and sorts exactly like its
-- source column and a join or comparison against the masters never mixes
-- two implicit collations.
-- Rows whose asset was already deleted keep a NULL name.

ALTER TABLE tournament_unranked_maps
  ADD COLUMN IF NOT EXISTS map_name varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL AFTER map_id;

ALTER TABLE tournament_unranked_factions
  ADD COLUMN IF NOT EXISTS faction_name varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL AFTER faction_id;

UPDATE tournament_unranked_maps tum
  JOIN game_maps m ON m.id = tum.map_id
  SET tum.map_name = m.name
  WHERE tum.map_name IS NULL;

UPDATE tournament_unranked_factions tuf
  JOIN factions f ON f.id = tuf.faction_id
  SET tuf.faction_name = f.name
  WHERE tuf.faction_name IS NULL;
