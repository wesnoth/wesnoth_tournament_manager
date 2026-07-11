# Administrative Audit Logs

This document describes the stable behavior of the administrative audit-log feature. The source code is the authoritative reference for event names, validation, and endpoint details.

## Visibility and access

Administrators and forum tournament moderators can view audit events through `/admin/audit`. Only administrators can delete selected events or purge events older than a chosen retention period. The backend enforces these permissions; frontend role checks only control navigation and button visibility.

The audit trail is stored in `audit_logs` in the tournament database. It contains a UUID, event type, acting user snapshot, client metadata, structured JSON details, and creation timestamp. It does not modify the external `forum` database.

## Filtering and retention

The screen filters by event type, username, IP address, and age. The API bounds `daysBack` to 1–3650 days before building the date predicate. The current response is capped at 1,000 rows; deletion requests accept at most 500 validated UUIDs at a time.

Audit details are normalized from MariaDB JSON text into an object before being returned to the frontend. Malformed legacy values remain visible under a `raw` field instead of breaking the audit screen.

## Deletion behavior

Selected deletion and age-based purging are administrator-only destructive operations. Each destructive operation writes a new `ADMIN_ACTION` audit event after the requested rows are removed, preserving a record that cleanup occurred. Audit logging failures are intentionally non-blocking for the application, but are reported by the backend.

## Related entry points

- Admin page: `frontend/src/pages/AdminAudit.tsx`
- Admin API: `backend/src/routes/admin.ts`
- Audit writer and request metadata helpers: `backend/src/middleware/audit.ts`
- Schema reference: `backend/src/config/schema.sql` and `DB_SCHEMA.md`
