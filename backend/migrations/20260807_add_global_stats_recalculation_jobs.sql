-- Persist long-running global statistics recalculations so API requests can
-- return immediately while administrators can still observe their progress.
CREATE TABLE IF NOT EXISTS global_stats_recalculation_jobs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  requested_by CHAR(36) NULL,
  reason VARCHAR(100) NOT NULL,
  status ENUM('queued', 'running', 'completed', 'failed') NOT NULL DEFAULT 'queued',
  phase VARCHAR(50) NULL,
  progress_current INT NOT NULL DEFAULT 0,
  progress_total INT NOT NULL DEFAULT 0,
  result_json JSON NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  INDEX idx_global_stats_jobs_status_created (status, created_at)
);
