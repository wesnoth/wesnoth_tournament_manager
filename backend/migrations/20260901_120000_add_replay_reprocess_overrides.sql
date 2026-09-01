ALTER TABLE replays
  ADD COLUMN reprocess_overrides TEXT DEFAULT NULL
    COMMENT 'Temporary administrator overrides consumed by replay reprocessing';
