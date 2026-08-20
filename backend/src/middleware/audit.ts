import { query } from '../config/database.js';
import { Request, Response } from 'express';
import { AuthRequest } from './auth.js';
import { generateUUID } from '../utils/uuid.js';

export interface AuditLogEntry {
  event_type: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'REGISTRATION' | 'ADMIN_ACTION' | 'SECURITY_EVENT' | 'PASSWORD_RESET_REQUEST' | 'EMAIL_VERIFIED' | 'ACCOUNT_UNLOCKED' | 'PASSWORD_RESET' | 'MAINTENANCE_MODE_TOGGLE' | 'PROFILE_UPDATE' | 'USER_BLOCKED' | 'USER_UNBLOCKED' | 'STREAMER_GRANTED' | 'STREAMER_REVOKED' | 'REPLAY_FORCE_DISCARDED' | 'REPLAY_AUTO_DISCARDED' | 'REPLAY_REPROCESS_REQUESTED' | 'PARTICIPANT_REMOVED' | 'TEAM_RENAMED';
  user_id?: string;
  username?: string;
  ip_address?: string;
  user_agent?: string;
  details: Record<string, any>;
}

/**
 * Log security audit events to database
 */
export async function logAuditEvent(entry: AuditLogEntry) {
  try {
    const auditId = generateUUID();
    await query(
      `INSERT INTO audit_logs (id, event_type, user_id, username, ip_address, user_agent, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        auditId,
        entry.event_type,
        entry.user_id || null,
        entry.username || null,
        entry.ip_address || null,
        entry.user_agent || null,
        JSON.stringify(entry.details)
      ]
    );

    // Also log to console for real-time monitoring
    if (process.env.BACKEND_DEBUG_LOGS === 'true') console.log(`[AUDIT] ${entry.event_type}:`, {
      user: entry.username || entry.user_id || 'ANONYMOUS',
      ip: entry.ip_address,
      details: entry.details
    });
  } catch (error) {
    console.error('Failed to log audit event:', error);
    // Don't throw - audit logging shouldn't break the application
  }
}

/**
 * Get user's IP address (handles proxies)
 */
export function getUserIP(req: Request | AuthRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Get user agent
 */
export function getUserAgent(req: Request | AuthRequest): string {
  return (req.headers['user-agent'] as string) || 'unknown';
}

export default {
  logAuditEvent,
  getUserIP,
  getUserAgent
};
