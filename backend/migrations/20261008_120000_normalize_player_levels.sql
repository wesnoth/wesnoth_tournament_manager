-- Player levels become stable English identifiers (novice, initiated,
-- veteran, expert, master). They were stored as Spanish words, while every
-- other user-facing text is an identifier translated by the frontend, Spanish
-- included. Values are matched case-insensitively because older rows used
-- lowercase defaults ('novato'). Unknown values are left untouched.
-- The table matches_faction_fix_backup_20260429 is a historical backup and is
-- deliberately not changed.
UPDATE users_extension
SET level = CASE LOWER(level)
  WHEN 'novato' THEN 'novice'
  WHEN 'iniciado' THEN 'initiated'
  WHEN 'veterano' THEN 'veteran'
  WHEN 'experto' THEN 'expert'
  WHEN 'maestro' THEN 'master'
  ELSE level END
WHERE LOWER(level) IN ('novato', 'iniciado', 'veterano', 'experto', 'maestro');

UPDATE matches
SET winner_level_before = CASE LOWER(winner_level_before)
      WHEN 'novato' THEN 'novice' WHEN 'iniciado' THEN 'initiated' WHEN 'veterano' THEN 'veteran'
      WHEN 'experto' THEN 'expert' WHEN 'maestro' THEN 'master' ELSE winner_level_before END,
    winner_level_after = CASE LOWER(winner_level_after)
      WHEN 'novato' THEN 'novice' WHEN 'iniciado' THEN 'initiated' WHEN 'veterano' THEN 'veteran'
      WHEN 'experto' THEN 'expert' WHEN 'maestro' THEN 'master' ELSE winner_level_after END,
    loser_level_before = CASE LOWER(loser_level_before)
      WHEN 'novato' THEN 'novice' WHEN 'iniciado' THEN 'initiated' WHEN 'veterano' THEN 'veteran'
      WHEN 'experto' THEN 'expert' WHEN 'maestro' THEN 'master' ELSE loser_level_before END,
    loser_level_after = CASE LOWER(loser_level_after)
      WHEN 'novato' THEN 'novice' WHEN 'iniciado' THEN 'initiated' WHEN 'veterano' THEN 'veteran'
      WHEN 'experto' THEN 'expert' WHEN 'maestro' THEN 'master' ELSE loser_level_after END;

ALTER TABLE users_extension ALTER COLUMN level SET DEFAULT 'novice';

ALTER TABLE matches
  ALTER COLUMN winner_level_before SET DEFAULT 'novice',
  ALTER COLUMN winner_level_after SET DEFAULT 'novice',
  ALTER COLUMN loser_level_before SET DEFAULT 'novice',
  ALTER COLUMN loser_level_after SET DEFAULT 'novice';
