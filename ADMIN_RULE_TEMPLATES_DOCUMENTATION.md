# Tournament Rule Templates

This document describes the stable responsibilities and access policy of `/admin/rule-templates`, which is linked from Manage Tournaments.

## Responsibilities

Administrators and tournament moderators can create, edit, activate, deactivate, and preview reusable Markdown rule templates. Tournament creation uses active templates as a starting point and stores the selected rule reference and content with the tournament.

Templates are single-language Markdown documents. The page intentionally uses a focused Markdown textarea with a rendered preview rather than the multilingual Wiki editor. A template cannot be deleted while any tournament references it; deactivation is the safe alternative for retiring it from future tournament creation.

## Access policy

The frontend page requires an authenticated administrator or tournament moderator. Every list and mutation endpoint independently applies the same `moderatorOrAdminMiddleware` authorization boundary.

Create and update operations reject blank titles and blank Markdown content. Delete operations also verify template usage on the server before removing a record.

## Related documentation

- [ADMIN_TOURNAMENTS_DOCUMENTATION.md](ADMIN_TOURNAMENTS_DOCUMENTATION.md): Manage Tournaments and its navigation to this page.
- [TOURNAMENT_SCHEDULING_DOCUMENTATION.md](TOURNAMENT_SCHEDULING_DOCUMENTATION.md): tournament lifecycle and rule usage.
- [API_ENDPOINTS.md](API_ENDPOINTS.md): endpoint routes and access levels.
