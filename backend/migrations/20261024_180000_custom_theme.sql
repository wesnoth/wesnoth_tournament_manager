-- Custom visual theme colors per user.
--
-- users_extension.theme_custom holds the colors of the user's custom theme
-- as JSON: {"base": "medieval" | "ranked", "background", "text", "accent"},
-- each color a #rrggbb string. The frontend derives the full color scales
-- from those three colors, so only the user's picks are stored. The column
-- is kept when the user switches to another theme, so returning to the
-- custom theme restores their colors. NULL means no custom theme was saved.
-- users_extension.theme accepts the value 'custom' from now on, validated by
-- the backend, and its column comment is updated to say so. Safe to rerun.

ALTER TABLE users_extension
  ADD COLUMN IF NOT EXISTS theme_custom longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
    COMMENT 'Custom theme colors as JSON (base, background, text, accent), NULL when never saved'
    CHECK (json_valid(theme_custom))
    AFTER theme;

ALTER TABLE users_extension
  MODIFY COLUMN theme varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'Explicit visual theme choice (medieval, ranked or custom), NULL follows the site default';
