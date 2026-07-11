# Maps and Factions Administration

This document describes the stable behavior of the Maps and Factions administration area. The source code is the authoritative reference for endpoint details, validation, and database behavior.

## Purpose

Administrators manage the canonical map and faction registry from `/admin/maps-and-factions`. Each asset has:

- a stable UUID used by tournament configuration and statistics;
- a canonical English name used by replay data and historical match records;
- active/inactive status controlling whether it can be selected; and
- ranked/unranked status controlling its pool eligibility.

The page supports creating, editing, activating or deactivating, and deleting maps and factions. It also manages optional translations in English, Spanish, German, Chinese, and Russian through `map_translations` and `faction_translations`.

## Selection behavior

Tournament asset selectors use the authenticated `/api/admin/unranked-maps` and `/api/admin/unranked-factions` endpoints. These endpoints intentionally return only active assets. Ranked-only tournament forms apply the ranked filter in the selector; unranked and team forms can use both ranked and unranked active assets.

The canonical `name` remains the value used for replay matching, statistics joins, and legacy filters. Translation data must not replace that canonical value in persistence or historical records.

## Deletion safety

Deleting an asset is only allowed when it has no current or historical references. If it is used by an active tournament, a completed tournament, a match, statistics, player statistics, or a balance event, the delete action safely deactivates it instead. Historical match rows keep their canonical map/faction names and no derived data is deleted.

For assets with historical or relational references, administrators should use the active/inactive control instead of deleting the record. Deactivation removes the asset from future selectors while preserving the identifiers needed by historical data.

## Authorization and validation

Administrative routes require an authenticated administrator. Public map and faction routes expose active records only. The backend remains responsible for validating ownership of the administrative operation, asset existence, and safe deletion; the frontend checks improve usability but are not security boundaries.

## Related entry points

- Admin page: `frontend/src/pages/AdminMapsAndFactions.tsx`
- Tournament selectors: `frontend/src/components/UnrankedMapSelect.tsx` and `frontend/src/components/UnrankedFactionSelect.tsx`
- Admin API: `backend/src/routes/admin.ts`
- Public API: `backend/src/routes/public.ts`
- Schema reference: `backend/src/config/schema.sql` and `DB_SCHEMA.md`
