import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { isClientSafeError } from '../utils/clientError.js';
import { logAuditEvent } from '../middleware/audit.js';

export type GlobalStatsRecalculationProgress = {
  phase: string;
  current: number;
  total: number;
};

export type RecalculationResult = {
  success: boolean;
  logs: string[];
  matchesProcessed: number;
  usersUpdated: number;
  /**
   * Machine-readable codes for optional follow-up steps that failed after the
   * main recalculation succeeded (for example `player_of_month_failed`). They
   * do not change the job outcome; they are persisted in `result_json` and in
   * the outcome audit event so the failure stays visible beyond the server log.
   */
  warnings?: string[];
};

type RecalculationExecutor = (
  onProgress: (progress: GlobalStatsRecalculationProgress) => Promise<void>
) => Promise<RecalculationResult>;

/**
 * In-process reservation of the single allowed recalculation.
 *
 * Invariant: it is assigned synchronously, before the first `await` of an
 * enqueue call, so two concurrent requests in this process can never both pass
 * the check. Only the job that owns the reservation may clear it. The backend
 * runs as a single instance, so this in-memory guard plus the persisted job row
 * (which also covers jobs left by a previous process) is sufficient.
 */
let activeJobId: string | null = null;

/**
 * Record how a recalculation job ended.
 *
 * Queuing is audited by the route that requested the job; the job itself runs
 * after the HTTP response, so its outcome is recorded here. The event carries
 * the requester as `user_id` (so filtering the log by that staff member shows
 * both the request and its result) and `localhost` as the address, matching the
 * scheduler's background events. Every job that reaches a final state produces
 * exactly one event: completed, failed, or interrupted by a restart.
 */
const auditJobOutcome = async (
  action: 'GLOBAL_STATS_RECALCULATION_COMPLETED' | 'GLOBAL_STATS_RECALCULATION_FAILED',
  job: { id: string; requestedBy: string | null; reason: string },
  details: Record<string, unknown>
): Promise<void> => {
  await logAuditEvent({
    event_type: 'ADMIN_ACTION',
    user_id: job.requestedBy ?? undefined,
    username: 'Background job',
    ip_address: 'localhost',
    details: { action, job_id: job.id, reason: job.reason, ...details },
  });
};

/** Oldest persisted job that has not reached a final state, if any. */
const findPersistedActiveJobId = async (): Promise<string | null> => {
  const result = await query(
    `SELECT id FROM global_stats_recalculation_jobs
     WHERE status IN ('queued', 'running')
     ORDER BY created_at ASC LIMIT 1`
  );
  return result.rows[0]?.id || null;
};

export const getActiveGlobalStatsRecalculationJobId = async (): Promise<string | null> => {
  if (activeJobId) return activeJobId;
  return findPersistedActiveJobId();
};

/** Clear the reservation only when it still belongs to `jobId`. */
const releaseReservation = (jobId: string): void => {
  if (activeJobId === jobId) activeJobId = null;
};

export class GlobalStatsRecalculationInProgressError extends Error {
  constructor(public readonly jobId: string) {
    super('A global statistics recalculation is already in progress');
    this.name = 'GlobalStatsRecalculationInProgressError';
  }
}

/**
 * Queue one global recalculation and execute it outside the HTTP request.
 * The database row makes progress observable and survives a frontend refresh;
 * the in-process guard prevents two expensive replays in the same backend.
 */
export const enqueueGlobalStatsRecalculation = async (options: {
  requestedBy: string | null;
  reason: string;
  execute: RecalculationExecutor;
}): Promise<string> => {
  // Reserve before any await (see `activeJobId`); a concurrent call that runs
  // while this one is waiting on the database sees the reservation and fails.
  if (activeJobId) {
    throw new GlobalStatsRecalculationInProgressError(activeJobId);
  }
  const jobId = uuidv4();
  activeJobId = jobId;

  try {
    const persistedJobId = await findPersistedActiveJobId();
    if (persistedJobId) {
      throw new GlobalStatsRecalculationInProgressError(persistedJobId);
    }
    await query(
      `INSERT INTO global_stats_recalculation_jobs
        (id, requested_by, reason, status, phase)
       VALUES (?, ?, ?, 'queued', 'queued')`,
      [jobId, options.requestedBy, options.reason]
    );
  } catch (error) {
    // No worker was scheduled, so nothing else would ever release it.
    releaseReservation(jobId);
    throw error;
  }

  setImmediate(() => {
    void runGlobalStatsRecalculationJob(
      { id: jobId, requestedBy: options.requestedBy, reason: options.reason },
      options.execute
    );
  });

  return jobId;
};

const runGlobalStatsRecalculationJob = async (
  job: { id: string; requestedBy: string | null; reason: string },
  execute: RecalculationExecutor
): Promise<void> => {
  const jobId = job.id;
  const startedAt = Date.now();
  try {
    await query(
      `UPDATE global_stats_recalculation_jobs
       SET status = 'running', started_at = CURRENT_TIMESTAMP, phase = 'starting'
       WHERE id = ?`,
      [jobId]
    );

    const result = await execute(async ({ phase, current, total }) => {
      await query(
        `UPDATE global_stats_recalculation_jobs
         SET phase = ?, progress_current = ?, progress_total = ?
         WHERE id = ?`,
        [phase, current, total, jobId]
      );
    });
    const warnings = result.warnings ?? [];

    await query(
      `UPDATE global_stats_recalculation_jobs
       SET status = ?, phase = ?, progress_current = ?, progress_total = ?,
           result_json = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        result.success ? 'completed' : 'failed',
        result.success ? 'completed' : 'failed',
        result.matchesProcessed,
        result.matchesProcessed,
        JSON.stringify({
          matchesProcessed: result.matchesProcessed,
          usersUpdated: result.usersUpdated,
          ...(warnings.length > 0 ? { warnings } : {}),
        }),
        jobId,
      ]
    );

    // `success: false` means the replay finished but some step reported
    // errors; it is still a failure from the auditor's point of view.
    await auditJobOutcome(
      result.success ? 'GLOBAL_STATS_RECALCULATION_COMPLETED' : 'GLOBAL_STATS_RECALCULATION_FAILED',
      job,
      {
        matches_processed: result.matchesProcessed,
        users_updated: result.usersUpdated,
        duration_seconds: Math.round((Date.now() - startedAt) / 1000),
        ...(warnings.length > 0 ? { warnings } : {}),
      }
    );
  } catch (error) {
    // `error_message` is returned by the job-status endpoint, so only domain
    // messages are persisted; internal details (SQL, stack-derived text) stay
    // in the server log.
    console.error(`Global stats recalculation job ${jobId} failed:`, error);
    // This runs in a detached promise (`void` in enqueue), so a failure while
    // recording the failure must be contained here: it would otherwise become
    // an unhandled rejection. The row then stays `queued`/`running` until the
    // next restart marks it interrupted; the in-process reservation is still
    // released below, and the persisted check is what keeps blocking new jobs.
    try {
      await query(
        `UPDATE global_stats_recalculation_jobs
         SET status = 'failed', phase = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [isClientSafeError(error) ? error.message : 'Internal error (see server log)', jobId]
      );
      // Same redaction as `error_message`: audit details are shown in the admin UI.
      await auditJobOutcome('GLOBAL_STATS_RECALCULATION_FAILED', job, {
        error: isClientSafeError(error) ? error.message : 'Internal error (see server log)',
        duration_seconds: Math.round((Date.now() - startedAt) / 1000),
      });
    } catch (recordError) {
      console.error(`Could not record the failure of recalculation job ${jobId}:`, recordError);
    }
  } finally {
    releaseReservation(jobId);
  }
};

export const getGlobalStatsRecalculationJob = async (jobId: string) => {
  const result = await query(
    `SELECT id, requested_by, reason, status, phase, progress_current,
            progress_total, result_json, error_message, created_at,
            started_at, completed_at
     FROM global_stats_recalculation_jobs WHERE id = ?`,
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
 * Mark work interrupted by a backend restart so it cannot block future jobs.
 *
 * The interrupted jobs are read first so each one still gets its closing audit
 * event; otherwise a queued recalculation would have no recorded outcome.
 */
export const recoverInterruptedGlobalStatsRecalculationJobs = async (): Promise<void> => {
  const interrupted = await query(
    `SELECT id, requested_by, reason, phase FROM global_stats_recalculation_jobs
     WHERE status IN ('queued', 'running')`
  );
  if (interrupted.rows.length === 0) return;

  await query(
    `UPDATE global_stats_recalculation_jobs
     SET status = 'failed', phase = 'failed',
         error_message = 'Backend restarted before the recalculation completed',
         completed_at = CURRENT_TIMESTAMP
     WHERE status IN ('queued', 'running')`
  );

  for (const row of interrupted.rows) {
    await auditJobOutcome(
      'GLOBAL_STATS_RECALCULATION_FAILED',
      { id: row.id, requestedBy: row.requested_by ?? null, reason: row.reason },
      { error: 'Backend restarted before the recalculation completed', interrupted_phase: row.phase }
    );
  }
};
