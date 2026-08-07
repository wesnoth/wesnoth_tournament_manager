import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';

export type GlobalStatsRecalculationProgress = {
  phase: string;
  current: number;
  total: number;
};

type RecalculationResult = {
  success: boolean;
  logs: string[];
  matchesProcessed: number;
  usersUpdated: number;
};

type RecalculationExecutor = (
  onProgress: (progress: GlobalStatsRecalculationProgress) => Promise<void>
) => Promise<RecalculationResult>;

let activeJobId: string | null = null;

export const getActiveGlobalStatsRecalculationJobId = async (): Promise<string | null> => {
  if (activeJobId) return activeJobId;
  const result = await query(
    `SELECT id FROM global_stats_recalculation_jobs
     WHERE status IN ('queued', 'running')
     ORDER BY created_at ASC LIMIT 1`
  );
  return result.rows[0]?.id || null;
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
  const currentJobId = await getActiveGlobalStatsRecalculationJobId();
  if (currentJobId) {
    throw new GlobalStatsRecalculationInProgressError(currentJobId);
  }

  const jobId = uuidv4();
  activeJobId = jobId;
  await query(
    `INSERT INTO global_stats_recalculation_jobs
      (id, requested_by, reason, status, phase)
     VALUES (?, ?, ?, 'queued', 'queued')`,
    [jobId, options.requestedBy, options.reason]
  );

  setImmediate(() => {
    void runGlobalStatsRecalculationJob(jobId, options.execute);
  });

  return jobId;
};

const runGlobalStatsRecalculationJob = async (
  jobId: string,
  execute: RecalculationExecutor
): Promise<void> => {
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
        JSON.stringify({ matchesProcessed: result.matchesProcessed, usersUpdated: result.usersUpdated }),
        jobId,
      ]
    );
  } catch (error) {
    await query(
      `UPDATE global_stats_recalculation_jobs
       SET status = 'failed', phase = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [error instanceof Error ? error.message : String(error), jobId]
    );
  } finally {
    activeJobId = null;
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

/** Mark work interrupted by a backend restart so it cannot block future jobs. */
export const recoverInterruptedGlobalStatsRecalculationJobs = async (): Promise<void> => {
  await query(
    `UPDATE global_stats_recalculation_jobs
     SET status = 'failed', phase = 'failed',
         error_message = 'Backend restarted before the recalculation completed',
         completed_at = CURRENT_TIMESTAMP
     WHERE status IN ('queued', 'running')`
  );
};
