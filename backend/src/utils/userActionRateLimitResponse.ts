import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { getUserAgent, getUserIP, logAuditEvent } from '../middleware/audit.js';
import { UserActionRateLimitError } from '../services/userActionRateLimitService.js';

/**
 * Convert a domain rate-limit error into the common HTTP 429 contract.
 *
 * `retry_at` is canonical UTC for machines, while `retry_at_local` is already
 * formatted with the profile language and timezone for direct UI display.
 * `Retry-After` and `retry_after` contain the same rounded-up number of seconds.
 * Returning a boolean lets route catch blocks preserve their existing handling
 * for validation, authorization, and persistence errors.
 *
 * @param req Authenticated request used to associate the rejection with its
 * user, source IP, and user agent in the security audit trail.
 * @param res Express response that receives the 429 payload and header.
 * @param error Caught value that may or may not be a rate-limit error.
 * @returns True when the response was sent, otherwise false.
 */
export const sendUserActionRateLimitError = (
  req: AuthRequest,
  res: Response,
  error: unknown
): boolean => {
  if (!(error instanceof UserActionRateLimitError)) return false;

  // The rate-limit event table is the enforcement ledger. This separate audit
  // record captures denied attempts, which otherwise leave no durable trace.
  void logAuditEvent({
    event_type: 'SECURITY_EVENT',
    user_id: req.userId,
    ip_address: getUserIP(req),
    user_agent: getUserAgent(req),
    details: {
      reason: 'rate_limit_exceeded',
      limiter: 'user_action',
      action_type: error.actionType,
      endpoint: req.originalUrl || req.path,
      method: req.method,
      limit: error.limit,
      window_ms: error.windowMs,
      retry_after_seconds: error.retryAfterSeconds,
      retry_at: error.retryAt.toISOString(),
    },
  });

  res.setHeader('Retry-After', String(error.retryAfterSeconds));
  res.status(429).json({
    error: error.message,
    code: error.code,
    action: error.actionType,
    limit: error.limit,
    window_ms: error.windowMs,
    retry_after: error.retryAfterSeconds,
    retry_at: error.retryAt.toISOString(),
    retry_at_local: error.retryAtLocal,
    timezone: error.timezone,
  });
  return true;
};
