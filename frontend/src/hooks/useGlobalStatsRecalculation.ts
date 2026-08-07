import { useCallback, useState } from 'react';
import { adminService } from '../services/api';

export type RecalculationStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface RecalculationProgress {
  phase: string;
  current: number;
  total: number;
}

const initialProgress: RecalculationProgress = { phase: 'starting', current: 0, total: 0 };

/** Share the asynchronous global recalculation lifecycle between admin pages. */
export const useGlobalStatsRecalculation = () => {
  const [status, setStatus] = useState<RecalculationStatus>('idle');
  const [progress, setProgress] = useState<RecalculationProgress>(initialProgress);

  const trackJob = useCallback(async (jobId: string): Promise<RecalculationStatus> => {
    setStatus('running');
    try {
      let jobStatus = 'queued';

      while (jobStatus === 'queued' || jobStatus === 'running') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const response = await adminService.getRecalculateAllStatsStatus(jobId);
        const job = response.data;
        jobStatus = job.status;
        setProgress({
          phase: job.phase || 'starting',
          current: Number(job.progress_current || 0),
          total: Number(job.progress_total || 0),
        });
      }

      const finalStatus: RecalculationStatus = jobStatus === 'completed' ? 'completed' : 'failed';
      setStatus(finalStatus);
      return finalStatus;
    } catch (error) {
      setStatus('failed');
      throw error;
    }
  }, []);

  const start = useCallback(async (): Promise<RecalculationStatus> => {
    setStatus('running');
    setProgress(initialProgress);
    try {
      const response = await adminService.recalculateAllStats();
      return trackJob(response.data.jobId);
    } catch (error) {
      setStatus('failed');
      throw error;
    }
  }, [trackJob]);

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(initialProgress);
  }, []);

  return { status, progress, start, trackJob, reset };
};
