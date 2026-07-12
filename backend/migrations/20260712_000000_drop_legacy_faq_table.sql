-- The FAQ content is now stored in the published Wiki article with slug `faq`.
-- Keep this migration idempotent so it is safe on databases already migrated manually.
DROP TABLE IF EXISTS faq;
