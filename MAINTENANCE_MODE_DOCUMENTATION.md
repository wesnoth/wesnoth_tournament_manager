# Maintenance Mode

Maintenance mode is an administrative availability control stored in application settings. Administrators can enable or disable it from Manage Users and may provide an operational reason.

While enabled, the public status endpoint allows the frontend to display a maintenance banner. Login enforcement and administrative authorization remain backend responsibilities; hiding controls in the frontend is not a security boundary.

Every state change is written to the audit log. Discord and other auxiliary integrations do not control maintenance state.

Maintenance mode is not a deployment mechanism and does not stop background jobs or database access. Operators must still stop services before destructive database maintenance or cloning.
