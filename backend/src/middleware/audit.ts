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
 * Get the client IP address recorded in audit events.
 *
 * When `TRUST_PROXY` is configured, this returns `req.ip`: Express walks
 * `X-Forwarded-For` from the right and stops at the first untrusted address,
 * so the value cannot be forged by the client and matches the rate-limit key.
 *
 * Compatibility: without `TRUST_PROXY`, `req.ip` is always the proxy address,
 * so the legacy behavior is kept and the left-most `X-Forwarded-For` entry is
 * returned. That entry is client-controlled (the proxy appends to, rather than
 * replaces, a client-supplied header), so audit IPs are only trustworthy once
 * `TRUST_PROXY` is set.
 */
export function getUserIP(req: Request | AuthRequest): string {
  if (req.app?.get('trust proxy')) {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * Whether proxy diagnostics are added to audit events, controlled by
 * `AUDIT_LOG_HEADERS` (on/off; also accepts true/false and 1/0). Off by default
 * because the extra data is only needed while diagnosing the proxy chain.
 */
const auditLogHeadersEnabled = (): boolean =>
  ['on', 'true', '1'].includes(String(process.env.AUDIT_LOG_HEADERS || '').trim().toLowerCase());

/**
 * Optional audit `details` fragment with proxy diagnostics. Returns an empty
 * object when `AUDIT_LOG_HEADERS` is off, so callers can always spread it.
 */
export function getAuditProxyDetails(req: Request | AuthRequest): Record<string, unknown> {
  return auditLogHeadersEnabled() ? { proxy_diagnostics: getProxyDiagnostics(req) } : {};
}

/**
 * Capture the raw forwarding data exactly as the backend receives it, to
 * determine the reverse-proxy chain and the correct `TRUST_PROXY` value.
 *
 * Each proxy appends the address of the peer that connected to it to
 * `X-Forwarded-For`, so the number of entries after any client-supplied value
 * equals the number of proxy hops. `X-Forwarded-Server`/`X-Forwarded-Host` are
 * added by Apache mod_proxy and `X-Real-IP` is commonly set by nginx, which
 * helps identify each hop. `socket_remote_address` is the direct TCP peer (the
 * last proxy), and `express_req_ip` is the value the rate limiters key on.
 */
function getProxyDiagnostics(req: Request | AuthRequest): Record<string, unknown> {
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
