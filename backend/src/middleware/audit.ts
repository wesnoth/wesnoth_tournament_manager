import { query } from '../config/database.js';
import { Request, Response } from 'express';
import { AuthRequest } from './auth.js';
import { generateUUID } from '../utils/uuid.js';

export interface AuditLogEntry {
  event_type: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'REGISTRATION' | 'ADMIN_ACTION' | 'SECURITY_EVENT' | 'PASSWORD_RESET_REQUEST' | 'EMAIL_VERIFIED' | 'ACCOUNT_UNLOCKED' | 'PASSWORD_RESET' | 'MAINTENANCE_MODE_TOGGLE' | 'PROFILE_UPDATE' | 'USER_BLOCKED' | 'USER_UNBLOCKED' | 'STREAMER_GRANTED' | 'STREAMER_REVOKED' | 'STREAM_LINK_DELETED' | 'REPLAY_FORCE_DISCARDED' | 'REPLAY_AUTO_DISCARDED' | 'REPLAY_REPROCESS_REQUESTED' | 'PARTICIPANT_REMOVED' | 'TEAM_RENAMED' | 'DIRECT_PASS_UPDATED';
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
 * TEMPORARY proxy diagnostics for the 2026-09-28 audit (findings 1-2). Remove
 * after the reverse-proxy chain and the correct `trust proxy` value are known.
 *
 * Captures the raw forwarding headers exactly as the backend receives them so
 * the number of proxy hops can be counted: each proxy appends the address of
 * the peer that connected to it to `X-Forwarded-For`, so a single proxy yields
 * `client` (or `spoofed, client`), while Apache -> nginx yields an extra entry.
 * `X-Forwarded-Server`/`X-Forwarded-Host` are added by Apache mod_proxy, and
 * `X-Real-IP` is commonly set by nginx, which helps identify each hop.
 * `socket_remote_address` is the direct TCP peer (the last proxy), and
 * `express_req_ip` is what the rate limiters currently key on.
 */
export function getProxyDiagnostics(req: Request | AuthRequest): Record<string, unknown> {
  return {
    x_forwarded_for: req.headers['x-forwarded-for'] ?? null,
    x_real_ip: req.headers['x-real-ip'] ?? null,
    x_forwarded_host: req.headers['x-forwarded-host'] ?? null,
    x_forwarded_server: req.headers['x-forwarded-server'] ?? null,
    x_forwarded_proto: req.headers['x-forwarded-proto'] ?? null,
    via: req.headers['via'] ?? null,
    socket_remote_address: req.socket.remoteAddress ?? null,
    express_req_ip: req.ip ?? null,
    trust_proxy: req.app.get('trust proxy') ?? null,
  };
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
