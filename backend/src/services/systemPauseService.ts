import { query } from '../config/database.js';
import { getActiveGlobalStatsRecalculationJobId } from './globalStatsRecalculationJobService.js';

export type SystemPauseStatus = {
  maintenanceMode: boolean;
  globalRecalculationJobId: string | null;
};

/** Read the two backend-controlled states that pause mutable replay operations. */
export const getSystemPauseStatus = async (): Promise<SystemPauseStatus> => {
  const [maintenanceResult, globalRecalculationJobId] = await Promise.all([
    query(
      'SELECT setting_value FROM system_settings WHERE setting_key = ?',
      ['maintenance_mode']
    ),
    getActiveGlobalStatsRecalculationJobId(),
  ]);

  return {
    maintenanceMode: maintenanceResult.rows[0]?.setting_value === 'true',
    globalRecalculationJobId,
  };
};

/** Return a stable API error for replay writes while a global replay is running. */
export const globalRecalculationInProgressResponse = (res: any, jobId: string) =>
  res.status(409).json({
    code: 'GLOBAL_RECALCULATION_IN_PROGRESS',
    error: 'A global statistics recalculation is in progress. Please try again in a few minutes.',
    jobId,
  });

/** Middleware for operations whose results must not race with a global recalculation. */
export const globalRecalculationMiddleware = async (_req: any, res: any, next: any) => {
  try {
    const jobId = await getActiveGlobalStatsRecalculationJobId();
    if (jobId) return globalRecalculationInProgressResponse(res, jobId);
    next();
  } catch (error) {
    console.error('Failed to check global recalculation status:', error);
    res.status(503).json({
      code: 'SYSTEM_STATUS_UNAVAILABLE',
      error: 'System status is temporarily unavailable. Please try again shortly.',
    });
  }
};

/** Background replay jobs use this guard so they stop before changing any rows. */
export const shouldPauseReplayProcessing = async (): Promise<boolean> => {
  const status = await getSystemPauseStatus();
  return status.maintenanceMode || status.globalRecalculationJobId !== null;
};

/** Ensure a restart during maintenance also invalidates pre-existing non-admin sessions. */
export const invalidateNonAdminTokensIfMaintenanceIsActive = async (): Promise<void> => {
  const maintenanceResult = await query(
    'SELECT setting_value FROM system_settings WHERE setting_key = ?',
    ['maintenance_mode']
  );
  if (maintenanceResult.rows[0]?.setting_value !== 'true') return;

  await invalidateNonAdminTokens();
};

/** Invalidate all sessions that are not exempt from maintenance restrictions. */
export const invalidateNonAdminTokens = async (): Promise<void> => {
  await query(
    `UPDATE users_extension
     SET token_invalidated_at = CURRENT_TIMESTAMP
     WHERE is_admin = 0 OR is_admin IS NULL`
  );
};
