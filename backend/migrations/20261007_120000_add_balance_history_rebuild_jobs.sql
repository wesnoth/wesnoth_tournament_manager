-- Persist balance history rebuilds (audit findings 20 and 25). The full
-- rebuild regenerates every daily snapshot date, so it runs in the background
-- and administrators follow its progress through this row.
CREATE TABLE IF NOT EXISTS balance_history_rebuild_jobs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  requested_by CHAR(36) NULL,
  status ENUM('queued', 'running', 'completed', 'failed') NOT NULL DEFAULT 'queued',
  progress_current INT NOT NULL DEFAULT 0,
  progress_total INT NOT NULL DEFAULT 0,
  result_json JSON NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  INDEX idx_balance_history_jobs_status_created (status, created_at)
);
