-- Visual theme preferences.
--
-- users_extension.theme stores the theme a user picked explicitly
-- ('medieval' or 'ranked'). NULL means the user never chose one and follows
-- the site default, so changing the default later still reaches them.
--
-- system_settings.default_theme is the site-wide default for anonymous
-- visitors and users without an explicit choice. Administrators switch it
-- back to 'ranked' if the medieval theme causes a regression. The backend
-- also treats a missing row as 'medieval', so this seed only makes the
-- setting visible to the generic settings editor. Both statements are safe
-- to rerun.

ALTER TABLE users_extension
  ADD COLUMN IF NOT EXISTS theme varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'Explicit visual theme choice (medieval or ranked), NULL follows the site default'
    AFTER language;

INSERT IGNORE INTO system_settings (setting_key, setting_value, description) VALUES
('default_theme', 'medieval', 'Default visual theme for visitors and users without an explicit choice (medieval or ranked)');
