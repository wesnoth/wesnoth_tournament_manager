import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { logAuditEvent } from '../middleware/audit.js';
import { isClientSafeError } from '../utils/clientError.js';
import {
  BalanceSnapshotRecalculationInProgressError,
  rebuildFactionMapStatisticsHistory,
  releaseBalanceHistoryRebuild,
  reserveBalanceHistoryRebuild,
} from './statisticsCalculator.js';

/**
 * Background execution of the full balance history rebuild
 * (rebuildFactionMapStatisticsHistory).
 *
 * Follows the global statistics recalculation job (see
 * globalStatsRecalculationJobService): the request is answered with 202, the
 * persisted row makes progress observable across page reloads, and the
 * outcome is audited once. It does not use the global job's table or guard on
 * purpose: that guard pauses match actions while it runs, and rebuilding
 * derived history must not block players. Concurrency is limited by the
 * in-process reservation in statisticsCalculator, which also covers a row
 * left `queued`/`running` only until recoverInterruptedBalanceHistoryRebuildJobs
 * marks it failed at startup.
 */

type JobRef = { id: string; requestedBy: string | null };

const auditOutcome = async (
  action: 'BALANCE_HISTORY_REBUILD_COMPLETED' | 'BALANCE_HISTORY_REBUILD_FAILED',
  job: JobRef,
  details: Record<string, unknown>
): Promise<void> => {
  // Same shape as the global job outcome: requester as user_id, background
  // job as username, so filtering by the admin shows request and result.
  await logAuditEvent({
    event_type: 'ADMIN_ACTION',
    user_id: job.requestedBy ?? undefined,
    username: 'Background job',
    ip_address: 'localhost',
    details: { action, job_id: job.id, ...details },
  });
};

/** A queued or running job id, if any. */
export const getActiveBalanceHistoryRebuildJobId = async (): Promise<string | null> => {
  const result = await query(
    `SELECT id FROM balance_history_rebuild_jobs
     WHERE status IN ('queued', 'running') ORDER BY created_at ASC LIMIT 1`
  );
  return result.rows[0]?.id || null;
};

/**
 * Queue a full rebuild and run it after the response.
 *
 * @throws BalanceSnapshotRecalculationInProgressError when a rebuild is
 *   already reserved in this process.
 */
export const enqueueBalanceHistoryRebuild = async (requestedBy: string | null): Promise<string> => {
  // Reserve before any await, so two concurrent requests cannot both pass.
  reserveBalanceHistoryRebuild();
  const jobId = uuidv4();
  try {
    await query(
      `INSERT INTO balance_history_rebuild_jobs (id, requested_by, status) VALUES (?, ?, 'queued')`,
      [jobId, requestedBy]
    );
  } catch (error) {
    // No worker was scheduled, so nothing else would release it.
    releaseBalanceHistoryRebuild();
    throw error;
  }
  setImmediate(() => {
    void runBalanceHistoryRebuildJob({ id: jobId, requestedBy });
  });
  return jobId;
};

const runBalanceHistoryRebuildJob = async (job: JobRef): Promise<void> => {
  const startedAt = Date.now();
  try {
    await query(
      `UPDATE balance_history_rebuild_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [job.id]
    );
    const result = await rebuildFactionMapStatisticsHistory(async (current, total) => {
      await query(
        `UPDATE balance_history_rebuild_jobs SET progress_current = ?, progress_total = ? WHERE id = ?`,
        [current, total, job.id]
      );
    });
    await query(
      `UPDATE balance_history_rebuild_jobs
       SET status = 'completed', result_json = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(result), job.id]
    );
    await auditOutcome('BALANCE_HISTORY_REBUILD_COMPLETED', job, {
      ...result,
      duration_seconds: Math.round((Date.now() - startedAt) / 1000),
    });
  } catch (error) {
    console.error(`Balance history rebuild job ${job.id} failed:`, error);
    // Dates already rebuilt stay rebuilt and the others keep their previous
    // complete contents (each date is replaced atomically), so rerunning the
    // rebuild finishes the work. The failure is recorded here because this
    // runs in a detached promise; a failure while recording is contained.
    const message = isClientSafeError(error) ? error.message : 'Internal error (see server log)';
    try {
      await query(
        `UPDATE balance_history_rebuild_jobs
         SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [message, job.id]
      );
      await auditOutcome('BALANCE_HISTORY_REBUILD_FAILED', job, {
        error: message,
        duration_seconds: Math.round((Date.now() - startedAt) / 1000),
      });
    } catch (recordError) {
      console.error(`Could not record the failure of balance history rebuild job ${job.id}:`, recordError);
    }
  } finally {
    releaseBalanceHistoryRebuild();
  }
};

export const getBalanceHistoryRebuildJob = async (jobId: string) => {
  const result = await query(
    `SELECT id, requested_by, status, progress_current, progress_total, result_json,
            error_message, created_at, started_at, completed_at
     FROM balance_history_rebuild_jobs WHERE id = ?`,
    [jobId]
  );
  if (result.rows.length === 0) return null;
  const job = result.rows[0];
  if (typeof job.result_json === 'string') {
    try {
      job.result_json = JSON.parse(job.result_json);
    } catch {
      job.result_json = null;
    }
  }
  return job;
};

/**
 * Mark rebuilds interrupted by a backend restart as failed, with their
 * closing audit event. Their dates are consistent (each was replaced
 * atomically); rerunning the rebuild completes the history.
 */
export const recoverInterruptedBalanceHistoryRebuildJobs = async (): Promise<void> => {
  const interrupted = await query(
    `SELECT id, requested_by FROM balance_history_rebuild_jobs WHERE status IN ('queued', 'running')`
  );
  if (interrupted.rows.length === 0) return;
  await query(
    `UPDATE balance_history_rebuild_jobs
     SET status = 'failed', error_message = 'Backend restarted before the rebuild completed',
         completed_at = CURRENT_TIMESTAMP
     WHERE status IN ('queued', 'running')`
  );
  for (const row of interrupted.rows) {
    await auditOutcome('BALANCE_HISTORY_REBUILD_FAILED', { id: row.id, requestedBy: row.requested_by ?? null }, {
      error: 'Backend restarted before the rebuild completed',
    });
  }
};

export { BalanceSnapshotRecalculationInProgressError };
