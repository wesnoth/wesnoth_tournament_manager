-- Audit finding 27: a one-row table whose row lock coordinates the writers of
-- the rating history with the global recalculation. Writers lock the row in
-- share mode without waiting, and the recalculation locks it exclusively before
-- reading, so it starts only after admitted writers finish and refuses new
-- writers until it commits. See services/ratingHistoryLock.ts.
CREATE TABLE IF NOT EXISTS rating_history_lock (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=InnoDB;

INSERT IGNORE INTO rating_history_lock (id) VALUES (1);

-- Audit finding 31: written inside the recalculation transaction, so after a
-- commit error a fresh read tells a committed rewrite from a rolled-back one.
ALTER TABLE global_stats_recalculation_jobs
  ADD COLUMN IF NOT EXISTS ratings_committed_at DATETIME NULL;
