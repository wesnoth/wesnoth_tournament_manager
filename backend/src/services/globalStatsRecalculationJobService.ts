import { v4 as uuidv4 } from 'uuid';
import type { PoolConnection } from 'mysql2/promise';
import { pool, query } from '../config/database.js';
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
  /** Match rows whose stored rating columns differed from the replay and were rewritten. */
  matchesUpdated: number;
  /** Users whose stored rating columns differed from the replay and were rewritten. */
  usersUpdated: number;
  /**
   * Machine-readable codes for optional follow-up steps that failed after the
   * main recalculation succeeded (for example `player_of_month_failed`). They
   * do not change the job outcome; they are persisted in `result_json` and in
   * the outcome audit event so the failure stays visible beyond the server log.
   */
  warnings?: string[];
};

/** What the running job tells its executor about itself. */
export type RecalculationExecutionContext = {
  /** The job row; the executor marks it inside its own transaction (audit finding 31). */
  jobId: string;
};

export type RecalculationExecutor = (
  onProgress: (progress: GlobalStatsRecalculationProgress) => Promise<void>,
  context: RecalculationExecutionContext
) => Promise<RecalculationResult>;

/**
 * A recalculation slot taken by `reserveGlobalStatsRecalculation`. It must end
 * in exactly one of `startGlobalStatsRecalculationJob` (after its job row is
 * committed) or `releaseGlobalStatsRecalculationReservation`.
 */
export type GlobalStatsRecalculationReservation = {
  readonly jobId: string;
  readonly requestedBy: string | null;
  readonly reason: string;
  readonly execute: RecalculationExecutor;
};

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
 * exactly one event: completed, failed, or interrupted by a restart. The one
 * job queued without a request, the restart recovery, records its queuing here
 * too.
 */
const auditJobOutcome = async (
  action: 'GLOBAL_STATS_RECALCULATION_COMPLETED' | 'GLOBAL_STATS_RECALCULATION_FAILED' | 'GLOBAL_STATS_RECALCULATION_QUEUED',
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

const ACTIVE_JOB_SQL = `SELECT id FROM global_stats_recalculation_jobs
     WHERE status IN ('queued', 'running')
     ORDER BY created_at ASC LIMIT 1`;

/** Oldest persisted job that has not reached a final state, if any. */
const findPersistedActiveJobId = async (connection?: PoolConnection): Promise<string | null> => {
  if (connection) {
    const [rows] = await connection.query<any[]>(ACTIVE_JOB_SQL);
    return rows[0]?.id || null;
  }
  const result = await query(ACTIVE_JOB_SQL);
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
 * Take the single recalculation slot without touching the database.
 *
 * Reserving happens synchronously, before any await, so a concurrent caller
 * in this process is refused (see `activeJobId`). Callers that must commit
 * their own change together with the job row (dispute resolutions, audit
 * finding 28) reserve first, then persist the job inside their transaction,
 * and start it only after the commit.
 *
 * @throws GlobalStatsRecalculationInProgressError when the slot is taken.
 */
export const reserveGlobalStatsRecalculation = (options: {
  requestedBy: string | null;
  reason: string;
  execute: RecalculationExecutor;
}): GlobalStatsRecalculationReservation => {
  if (activeJobId) {
    throw new GlobalStatsRecalculationInProgressError(activeJobId);
  }
  const jobId = uuidv4();
  activeJobId = jobId;
  return { jobId, ...options };
};

/**
 * Insert the reserved job as `queued`, on the caller's transaction when one is
 * given. Also refuses when a job row left by a previous process is still
 * active, which the in-memory slot cannot see.
 *
 * @throws GlobalStatsRecalculationInProgressError for a persisted active job.
 */
export const persistGlobalStatsRecalculationJob = async (
  reservation: GlobalStatsRecalculationReservation,
  connection?: PoolConnection
): Promise<void> => {
  const persistedJobId = await findPersistedActiveJobId(connection);
  if (persistedJobId) {
    throw new GlobalStatsRecalculationInProgressError(persistedJobId);
  }
  const sql = `INSERT INTO global_stats_recalculation_jobs
        (id, requested_by, reason, status, phase)
       VALUES (?, ?, ?, 'queued', 'queued')`;
  const params = [reservation.jobId, reservation.requestedBy, reservation.reason];
  if (connection) await connection.execute(sql, params);
  else await query(sql, params);
};

/** Give the slot back when no job will run for this reservation. */
export const releaseGlobalStatsRecalculationReservation = (reservation: GlobalStatsRecalculationReservation): void => {
  releaseReservation(reservation.jobId);
};

/**
 * Run a reserved job whose row is committed. The worker owns the reservation
 * from here on and releases it when it ends.
 */
export const startGlobalStatsRecalculationJob = (reservation: GlobalStatsRecalculationReservation): void => {
  setImmediate(() => {
    void runGlobalStatsRecalculationJob(
      { id: reservation.jobId, requestedBy: reservation.requestedBy, reason: reservation.reason },
      reservation.execute
    );
  });
};

/** Whether a job row exists; used to settle a commit whose outcome is unknown. */
export const globalStatsRecalculationJobExists = async (jobId: string): Promise<boolean> => {
  const result = await query('SELECT id FROM global_stats_recalculation_jobs WHERE id = ?', [jobId]);
  return result.rows.length > 0;
};

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
  const reservation = reserveGlobalStatsRecalculation(options);
  try {
    await persistGlobalStatsRecalculationJob(reservation);
  } catch (error) {
    // No worker was scheduled, so nothing else would ever release it.
    releaseGlobalStatsRecalculationReservation(reservation);
    throw error;
  }
  startGlobalStatsRecalculationJob(reservation);
  return reservation.jobId;
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
    }, { jobId });
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
          matchesUpdated: result.matchesUpdated,
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
        matches_updated: result.matchesUpdated,
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
 * Mark work interrupted by a backend restart so it cannot block future jobs,
 * then queue one recovery recalculation.
 *
 * The interrupted jobs are read first so each one still gets its closing audit
 * event; otherwise a queued recalculation would have no recorded outcome.
 *
 * An interrupted job may stand for a committed change whose ratings were never
 * rebuilt, for example a dispute resolution committed together with its job row
 * just before a crash (audit finding 28). Its ratings would stay stale with
 * nothing signalling it, so a new job with reason `RESTART_RECOVERY` is queued
 * (maintainer decision, 2026-10-11). A full replay is idempotent, so rerunning
 * it is always safe, even when the interrupted job was a manual one.
 *
 * Closing the interrupted jobs and inserting the recovery job happen in one
 * transaction (audit finding 34): if the insert fails, or the process dies
 * before the commit, the interrupted jobs stay `queued`/`running` and the
 * next startup retries the whole recovery. The audit events are written only
 * after the commit and after the worker is scheduled, and their failures are
 * contained, so an audit problem cannot lose the pending work either.
 *
 * @returns the recovery job id, or null when nothing was interrupted.
 */
export const recoverInterruptedGlobalStatsRecalculationJobs = async (
  execute: RecalculationExecutor
): Promise<string | null> => {
  const pending = await query(
    `SELECT id FROM global_stats_recalculation_jobs WHERE status IN ('queued', 'running') LIMIT 1`
  );
  if (pending.rows.length === 0) return null;

  const reservation = reserveGlobalStatsRecalculation({ requestedBy: null, reason: 'RESTART_RECOVERY', execute });
  const connection = await pool.getConnection();
  let interrupted: any[];
  try {
    await connection.beginTransaction();
    [interrupted] = await connection.query<any[]>(
      `SELECT id, requested_by, reason, phase FROM global_stats_recalculation_jobs
       WHERE status IN ('queued', 'running') FOR UPDATE`
    );
    await connection.execute(
      `UPDATE global_stats_recalculation_jobs
       SET status = 'failed', phase = 'failed',
           error_message = 'Backend restarted before the recalculation completed',
           completed_at = CURRENT_TIMESTAMP
       WHERE status IN ('queued', 'running')`
    );
    // The interrupted rows are closed inside this transaction, so the active
    // job check in persist sees none of them.
    await persistGlobalStatsRecalculationJob(reservation, connection);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    releaseGlobalStatsRecalculationReservation(reservation);
    throw error;
  } finally {
    connection.release();
  }
  startGlobalStatsRecalculationJob(reservation);
  console.log(`🔄 Queued recovery recalculation ${reservation.jobId} for ${interrupted.length} interrupted job(s)`);

  try {
    for (const row of interrupted) {
      await auditJobOutcome(
        'GLOBAL_STATS_RECALCULATION_FAILED',
        { id: row.id, requestedBy: row.requested_by ?? null, reason: row.reason },
        { error: 'Backend restarted before the recalculation completed', interrupted_phase: row.phase }
      );
    }
    await auditJobOutcome(
      'GLOBAL_STATS_RECALCULATION_QUEUED',
      { id: reservation.jobId, requestedBy: null, reason: 'RESTART_RECOVERY' },
      { interrupted_job_ids: interrupted.map((row: any) => row.id) }
    );
  } catch (error) {
    console.error('Could not audit the restart recovery of global recalculations:', error);
  }
  return reservation.jobId;
};
