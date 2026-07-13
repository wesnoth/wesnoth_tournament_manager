ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS scheduled_start_at DATETIME NULL AFTER approved_at;
