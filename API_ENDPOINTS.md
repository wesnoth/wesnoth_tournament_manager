# API Endpoints Reference

*Update this file whenever an endpoint is added, modified, or removed.*

**Format:** `[METHOD] /path` — Auth — params/body — Description

**Source:** Backend route files in `backend/src/routes/`. Frontend service wrappers in `frontend/src/services/api.ts`, `statisticsService.ts`, `playerStatisticsService.ts`.

---

## Auth

- `[POST] /api/auth/login` — Public — body: `{nickname, password}` — Authenticate against `phpbb3_users` forum table and return JWT token + userId + isTournamentModerator. Returns `{error: 'forum_banned', banReason, banUntil}` (401) if user has an active phpBB ban.
- `[GET] /api/auth/validate-token` — Private — none — Validate JWT and return current user info including `isAdmin` and `isTournamentModerator`.

> Forum registration, password reset, and email verification are handled by the **Wesnoth forum** at `https://forum.wesnoth.org`. The application profile in `users_extension` is created only on first successful application login. Replay processing requires existing profiles, and direct ranked matches require both players to enable ranked matches.

---

## Public API (no auth)

- FAQ content is served by the published Wiki article at `/help/faq`; `/faq` is the stable navbar redirect.
- `[GET] /api/public/tournaments` — Public — query: `page, name, status, type` — List tournaments.
- `[GET] /api/public/tournaments/:id` — Public — Tournament details.
- `[GET] /api/public/tournaments/:id/participants` — Public — Tournament participant list.
- `[GET] /api/public/tournaments/:id/matches` — Public — Tournament matches (public view).
- `[GET] /api/public/tournaments/:id/unranked-assets` — Public — Unranked maps/factions for a tournament.
- `[GET] /api/public/tournaments/:id/teams` — Public — Teams in a team tournament.
- `[GET] /api/public/tournaments/:tournamentId/pending-replays` — Public — Confidence=1 replays matched to open tournament matches.
- `[GET] /api/public/news` — Public — none — All published News items (all languages).
- `[GET] /api/public/matches/recent` — Public — none — Recent confirmed matches.
- `[GET] /api/public/players` — Public — query: `page, nickname, min_elo, max_elo, min_matches, rated_only` — Player directory.
- `[GET] /api/public/matches` — Public — query: `page, player, map, status, confirmed, faction` — All matches.
- `[GET] /api/public/maps` — Public — none — All active maps.
- `[GET] /api/public/factions` — Public — query: `is_ranked` (optional) — All active factions.
- `[GET] /api/public/player-of-month` — Public — none — Current player of the month.
- `[GET] /api/public/debug` — Public — none — Debug info (shown to admins in UI only).
- `[POST] /api/public/tournament-matches/:matchId/replay/download-count` — Public — Increment download counter for a tournament match replay.

---

## User Routes

- `[GET] /api/users/profile` — Private — none — Get current authenticated user's profile. Includes `enable_ranked` flag.
- `[PUT] /api/users/profile/discord` — Private — body: `{discord_id}` — Update Discord ID.
- `[PUT] /api/users/profile/update` — Private — body: `{avatar, country, language, ...}` — Update profile preferences.
- `[PUT] /api/users/profile/ranked` — Private — body: `{enable_ranked: boolean}` — Enable/disable participation in ranked matches.
- `[GET] /api/users/:id/stats` — Public — Player aggregated stats (wins/losses/elo).
- `[GET] /api/users/:id/stats/month` — Public — Player stats for the current month.
- `[GET] /api/users/:id/matches` — Public — Recent matches for a player.
- `[GET] /api/users/search/:searchQuery` — Public — Search users by nickname.
- `[GET] /api/users/ranking/global` — Public — query: `page, nickname, min_elo, max_elo` — Global ELO ranking.
- `[GET] /api/users/ranking/active` — Public — query: `page` — Active players ranking.
- `[GET] /api/users/all` — Public — none — All active users (for opponent selector).
- `[GET] /api/users/data/countries` — Public — none — Available country codes for profile.
- `[GET] /api/users/data/avatars` — Public — none — Available avatar options.

---

## Match Routes

- `[POST] /api/matches/preview-replay-base64` — Private — body: `{replayData: base64string}` — Parse replay file and extract match data (no upload stored).
- `[POST] /api/matches/preview-replay` — Private — multipart: `replay` file — Parse replay (multipart form version; base64 version preferred).
- `[POST] /api/matches/:id/confirm` — Private — body: `{action: 'confirm'|'dispute', comments?, rating?}` — Loser confirms or disputes a match.
- `[GET] /api/matches/disputed/all` — Private (admin) — All disputed matches.
- `[GET] /api/matches/pending/all` — Private (admin) — All pending/unconfirmed matches.
- `[GET] /api/matches/pending/user` — Private — Pending matches for current user.
- `[POST] /api/matches/admin/:id/dispute` — Private (admin) — body: `{action: 'validate'|'reject'}` — Resolve a disputed match.
- `[GET] /api/matches/:matchId/replay/download` — Public — Download replay file for a match.
- `[POST] /api/matches/:matchId/replay/download-count` — Public — Increment replay download count.
- `[GET] /api/matches` — Private — query: `page, winner, loser, map, status, confirmed, faction` — List matches.
- `[POST] /api/matches/:id/cancel-own` — Private — Cancel own pending match report.
- `[POST] /api/matches/report-confidence-1-replay` — Private — body: `{replayId, winner_choice, comments?, rating?, tournament_match_id?}` — Player confirms result of a confidence=1 auto-detected replay.
- `[POST] /api/matches/cancel-confidence-1-replay` — Private — body: `{replayId}` — Cancel a confidence=1 replay before reporting.
- `[POST] /api/matches/admin-discard-replay` — Private (admin) — body: `{replayId}` — Admin discards a replay from the confirmation queue.

---

## Tournament Routes

- `[POST] /api/tournaments` — Private — body: tournament config fields including optional `organizer_ids: string[]` and `scheduled_start_at` — Create a tournament.
- `[GET] /api/tournaments/my` — Private — Tournaments managed by the current user as creator or co-organizer.
- `[GET] /api/tournaments/:id` — Public — Tournament full details.
- `[GET] /api/tournaments/:id/organizers` — Public — List tournament organizers (creator + co-organizers).
- `[POST] /api/tournaments/:id/organizers` — Private (organizer) — body: `{user_id}` — Add co-organizer with full organizer permissions.
- `[DELETE] /api/tournaments/:id/organizers/:organizerUserId` — Private (organizer) — Remove co-organizer (creator cannot be removed).
- `[PUT] /api/tournaments/:id` — Private (organizer) — body: `{tournament_type?, description?, rules_template_id?, rules_content?, max_participants?, round_duration_days?, auto_advance_round?, scheduled_start_at?, general_rounds?, final_rounds?, general_rounds_format?, final_rounds_format?}` — Update tournament configuration. The planned start is editable before the real start; lifecycle status and `started_at` are controlled by dedicated actions.
- `[PUT] /api/tournaments/:id/assets` — Private (organizer) — body: `{faction_ids: string[], map_ids: string[]}` — Atomically replace allowed assets before preparation; empty arrays clear a set.
- `[DELETE] /api/tournaments/:id` — Private (organizer/admin) — Cancel/delete a tournament before it starts; administrators may manage any eligible tournament.
- `[GET] /api/tournaments/:id/rounds` — Public — Tournament rounds list.
- `[GET] /api/tournaments` — Public — query: `page` — All tournaments.
- `[POST] /api/tournaments/:id/request-join` — Private — body: `{team_name?, teammate_name?}` — Request individual entry, create a team, or join a one-member team during open registration.
- `[POST] /api/tournaments/:id/participants/:participantId/accept` — Private (organizer) — Accept participant.
- `[POST] /api/tournaments/:id/participants/:participantId/confirm` — Private — Participant confirms join.
- `[POST] /api/tournaments/:id/participants/:participantId/reject` — Private (organizer) — Reject participant.
- `[GET] /api/tournaments/:id/ranking` — Public — Tournament ranking.
- `[GET] /api/tournaments/:id/standings` — Public — query: `round_id?` — Tournament standings (with tiebreakers).
- `[POST] /api/tournaments/:id/close-registration` — Private (organizer) — Close registration.
- `[POST] /api/tournaments/:id/prepare` — Private (organizer) — Generate rounds.
- `[POST] /api/tournaments/:id/start` — Private (organizer) — Start tournament.
- `[GET] /api/tournaments/:id/rounds/:roundId/matches` — Public — Matches for a specific round.
- `[GET] /api/tournaments/:id/round-matches` — Public — Best-Of series summaries.
- `[GET] /api/tournaments/:id/matches` — Public — All individual matches.
- `[POST] /api/tournaments/:id/matches/:matchId/result` — Private — body: `{winner_id, reported_match_id?}` — Record tournament match result.
- `[POST] /api/tournaments/:id/matches/:matchId/determine-winner` — Private (organizer) — body: `{winner_id}` — Force match winner.
- `[POST] /api/tournaments/:id/matches/:matchId/dispute` — Private — Dispute a tournament match.
- `[POST] /api/tournaments/:id/next-round` — Private (organizer) — Activate next round.
- `[GET] /api/tournaments/:id/config` — Private (organizer) — Tournament internal config.
- `[POST] /api/tournaments/:id/calculate-tiebreakers` — Private (organizer) — Calculate tiebreakers.
- `[GET] /api/tournaments/suggestions/by-count` — Private — Tournament suggestions by participation count.
- `[PUT] /api/tournaments/:tournamentId/teams/:teamId/rename` — Private (organizer/team member/admin/moderator) — body: `{name: string}` — Rename a tournament team.
- `[DELETE] /api/tournaments/:tournamentId/participants/:participantId` — Private (self/organizer/admin/moderator) — Remove a participant before the tournament starts. Cleans up empty teams in team tournaments.

---

## Rule Template Routes

- `[GET] /api/rule-templates` — Private — List active tournament rule templates available to organizers (`id, title, content_markdown`).

---

## Tournament Scheduling Routes

- `[GET] /api/tournament-scheduling/pending-confirmations` — Private — Proposal confirmations pending for current user.
- `[GET] /api/tournament-scheduling/:tournamentRoundMatchId/schedule` — Public — Active schedule context for a tournament round match.
- `[GET] /api/tournament-scheduling/:tournamentId/matches-pending-schedule` — Private — Round matches waiting for schedule proposal.
- `[POST] /api/tournament-scheduling/:tournamentRoundMatchId/propose-schedule` — Legacy — Single-slot compatibility endpoint; new UI uses multi-slot scheduling below.
- `[POST] /api/tournament-scheduling/:tournamentRoundMatchId/confirm-schedule` — Legacy — Single-slot compatibility endpoint; new UI uses multi-slot scheduling below.
- `[POST] /api/tournament-scheduling/:tournamentRoundMatchId/cancel-schedule` — Legacy — Single-slot compatibility endpoint.
- `[POST] /api/tournament-scheduling/tournament/:tournamentId/round-match/:roundMatchId/propose-slots` — Private — body: `{ slot_datetimes[], notes? }` — Create a multi-slot round-match proposal.
- `[POST] /api/tournament-scheduling/tournament/:tournamentId/match/:matchId/propose-slots` — Private — body: `{ slot_datetimes[], notes? }` — Create a multi-slot game proposal.
- `[POST] /api/tournament-scheduling/tournament/:tournamentId/round-match/:roundMatchId/confirm-slots` — Private — body: `{ proposal_id, confirmed_slot_ids[] }` — Confirm selected round-match slots.
- `[POST] /api/tournament-scheduling/tournament/:tournamentId/match/:matchId/confirm-slots` — Private — body: `{ proposal_id, confirmed_slot_ids[] }` — Confirm selected game slots.
- `[POST] /api/tournament-scheduling/proposals/:proposalId/confirm` — Private — Confirm proposal participation.
- `[POST] /api/tournament-scheduling/proposals/:proposalId/cancel-confirmation` — Private — Remove own confirmation.
- `[POST] /api/tournament-scheduling/proposals/:proposalId/counter-propose` — Private — body: `{ slot_datetimes[], message?, user_timezone? }` — Create counter-proposal for tournament schedule.
- `[PUT] /api/tournament-scheduling/proposals/:proposalId` — Private — Update proposal metadata/slots.
- `[DELETE] /api/tournament-scheduling/proposals/:proposalId` — Private — Delete/cancel proposal.

---

## P2P Challenges Routes

- `[GET] /api/challenges/proposals` — Private — query: `mode=incoming|outgoing|all` — List P2P proposals for current user.
- `[GET] /api/challenges/proposals/:proposalId` — Private — Full P2P proposal detail (proposal, slots, confirmations).
- `[GET] /api/challenges/occupied-slots` — Private — query: `user_ids=comma,separated,ids`, optional `exclude_proposal_id` — List slots reserved by active P2P or tournament proposals involving those users.
- `[POST] /api/challenges/proposals` — Private — body: `{ challenged_user_id, slot_datetimes[], notes?, visibility? }` — Create new P2P challenge proposal (`challenge_mode='p2p'`).
- `[POST] /api/challenges/proposals/:proposalId/confirm-slots` — Private — body: `{ confirmed_slot_ids[] }` — Confirm selected slots or reject if none confirmed.
- `[POST] /api/challenges/proposals/:proposalId/counter-propose` — Private — body: `{ slot_datetimes[], notes?, visibility? }` — Create P2P counter-proposal.
- `[POST] /api/challenges/proposals/:proposalId/cancel` — Private — Cancel P2P proposal.
- `[PUT] /api/challenges/proposals/:proposalId` — Private — body: `{ slot_datetimes[], notes? }` — Update a pending proposal owned by its proposer.

---

## Statistics Routes

- `[GET] /api/statistics/config` — Public — Faction/map configuration (active items, min games).
- `[GET] /api/statistics/faction-by-map` — Public — Faction win rates per map.
- `[GET] /api/statistics/matchups` — Public — query: `minGames` — Faction vs faction matchup stats.
- `[GET] /api/statistics/faction-global` — Public — Global faction win rates.
- `[GET] /api/statistics/map-balance` — Public — Map balance overview.
- `[GET] /api/statistics/faction/:factionId` — Public — Stats for a specific faction.
- `[GET] /api/statistics/map/:mapId` — Public — Stats for a specific map.
- `[GET] /api/statistics/history/events` — Public — query: `factionId, mapId, eventType, limit, offset` — Balance events list.
- `[POST] /api/statistics/history/events` — Private (admin) — body: event data — Create balance event.
- `[PUT] /api/statistics/history/events/:eventId` — Private (admin) — body: event data — Update balance event.
- `[GET] /api/statistics/history/events/:eventId/impact` — Public — Impact analysis for the non-overlapping interval before and after a balance event.
- `[GET] /api/statistics/history/trend` — Public — query: `mapId, factionId, opponentFactionId, dateFrom, dateTo` — Win rate trend.
- `[GET] /api/statistics/history/snapshot` — Public — query: `date, minGames` — Historical statistics snapshot.
- `[POST] /api/statistics/history/snapshot` — Private (admin) — Create or backfill one cumulative snapshot date for historical correction.

---

## Player Statistics Routes

- `[GET] /api/player-statistics/player/:playerId/global` — Public — Player global stats.
- `[GET] /api/player-statistics/player/:playerId/by-map` — Public — query: `minGames` — Stats per map.
- `[GET] /api/player-statistics/player/:playerId/by-faction` — Public — query: `minGames` — Stats per faction.
- `[GET] /api/player-statistics/player/:playerId/vs-player/:opponentId` — Public — Head-to-head stats.
- `[GET] /api/player-statistics/player/:playerId/map/:mapId` — Public — Stats on a specific map.
- `[GET] /api/player-statistics/player/:playerId/faction/:factionId` — Public — Stats with a specific faction.
- `[GET] /api/player-statistics/player/:playerId/map/:mapId/faction/:factionId` — Public — Stats on map+faction combo.
- `[GET] /api/player-statistics/player/:playerId/recent-opponents` — Public — query: `limit` — Recent opponents list.

---

## Replays Routes

> These endpoints are used internally for the admin replay confirmation workflow. Direct replay processing uses `POST /api/matches/admin-discard-replay` and `POST /api/matches/report-confidence-1-replay`.

- `[GET] /api/replays/pending-confirmation` — Private (admin) — List replays pending manual confirmation.
- `[POST] /api/replays/:replayId/confirm-winner` — Private (admin) — body: `{winner_id}` — Confirm winner of a replay.
- `[POST] /api/replays/:replayId/discard` — Private (admin) — Discard a replay.

---

## Admin Routes

> **Note on access levels**: Some admin routes are accessible to `tournament_moderator` users (members of phpBB group `FORUM_MODERATOR_GROUP_ID`). These are marked *(admin + moderator)*. All other admin routes require site admin (`is_admin = 1`).

### User Management
- `[GET] /api/admin/users/all` — Private (admin + moderator) — List users with management status and public player fields.
- `[POST] /api/admin/users/:id/block` — Private (admin + moderator) — Block user (`is_blocked = 1`). Moderators cannot block admin users.
- `[POST] /api/admin/users/:id/unlock` — Private (admin + moderator) — Reset failed login attempts and unblock user.
- `[POST] /api/admin/users/:id/make-admin` — Private (admin) — Grant site admin role (`is_admin = 1`).
- `[POST] /api/admin/users/:id/remove-admin` — Private (admin) — Revoke site admin role.
- `[DELETE] /api/admin/users/:id` — Private (admin) — Delete user account from `users_extension`.

### Maintenance Mode
- `[GET] /api/admin/maintenance-status` — Private (admin) — Get current maintenance mode status.
- `[POST] /api/admin/toggle-maintenance` — Private (admin) — body: `{enable: bool, reason?: string}` — Enable/disable maintenance mode.
- `[GET] /api/admin/maintenance-logs` — Private (admin) — query: `limit` — Maintenance mode change history.

### Audit Logs
- `[GET] /api/admin/audit-logs` — Private (admin + moderator) — query: optional filters — List audit log entries.
- `[DELETE] /api/admin/audit-logs` — Private (admin) — body: `{logIds: string[]}` — Delete specific audit logs.
- `[DELETE] /api/admin/audit-logs/old` — Private (admin) — body: `{daysBack: number}` — Delete old audit logs.

### Replays
- `[GET] /api/admin/replays` — Private (admin + moderator) — query: `{status?, limit?, offset?}` — List replays with filtering.
- `[POST] /api/admin/replays/:replayId/force-discard` — Private (admin + moderator) — Force-discard a replay with status `new`, `parsed`, or `error`. Sets `parse_status='rejected'`.
- `[POST] /api/admin/replays/:replayId/reprocess` — Private (admin + moderator) — Requeue a replay for reprocessing. Allowed statuses: `error`, `failed`, `rejected`, `parsed`, `skipped`, `discarded`. Blocked if replay has a `match_id`. Resets `parse_status='new'` and clears parse fields so the background job picks it up again within 30 seconds.

### Tournament Rule Templates
- `[GET] /api/admin/rule-templates` — Private (admin + moderator) — List all rule templates including inactive.
- `[POST] /api/admin/rule-templates` — Private (admin + moderator) — body: `{title, content_markdown, is_active?}` — Create a new reusable tournament rule template.
- `[PUT] /api/admin/rule-templates/:id` — Private (admin + moderator) — body: `{title?, content_markdown?, is_active?}` — Update template content or activation state.
- `[DELETE] /api/admin/rule-templates/:id` — Private (admin + moderator) — Delete template only if not referenced by any tournament.

### Statistics & Debug
- `[POST] /api/admin/recalculate-all-stats` — Private (admin) — Recalculate all player statistics.
- `[POST] /api/admin/recalculate-snapshots` — Private (admin) — Clear and rebuild the complete cumulative balance snapshot history; maintenance/recovery operation.
- `[GET] /api/admin/debug/faction-map-stats` — Private (admin) — Debug: raw faction/map stats data.
- `[GET] /api/admin/player-of-month` — Private (admin) — Get player of the month data.
- `[POST] /api/admin/calculate-player-of-month` — Private (admin) — Recalculate player of the month.

### News & FAQ
- `[GET] /api/admin/news` — Private (admin) — List all news items.
- `[POST] /api/admin/news` — Private (admin) — body: `{title, content, language, ...}` — Create news item.
- `[PUT] /api/admin/news/:id` — Private (admin) — Update news item.
- `[DELETE] /api/admin/news/:id` — Private (admin) — Delete news item.
- FAQ content is managed as the published Wiki article with slug `faq`; use the Wiki endpoints documented below.

### Maps & Factions
- `[GET] /api/admin/maps` — Private (admin) — List all maps.
- `[GET] /api/admin/maps/:mapId/translations` — Private (admin) — Map translations.
- `[POST] /api/admin/maps` — Private (admin) — Create map.
- `[POST] /api/admin/maps/:mapId/translations` — Private (admin) — Add/update map translation.
- `[DELETE] /api/admin/maps/:mapId` — Private (admin) — Delete map (checks usage).
- `[GET] /api/admin/factions` — Private (admin) — List all factions.
- `[GET] /api/admin/factions/:factionId/translations` — Private (admin) — Faction translations.
- `[POST] /api/admin/factions` — Private (admin) — Create faction.
- `[POST] /api/admin/factions/:factionId/translations` — Private (admin) — Add/update faction translation.
- `[DELETE] /api/admin/factions/:factionId` — Private (admin) — Delete faction (checks usage).

### Unranked Assets
- `[GET] /api/admin/unranked-factions` — Private (admin) — List unranked factions.
- `[POST] /api/admin/unranked-factions` — Private (admin) — Add unranked faction.
- `[GET] /api/admin/unranked-factions/:id/usage` — Private (admin) — Check usage of an unranked faction.
- `[DELETE] /api/admin/unranked-factions/:id` — Private (admin) — Remove unranked faction.
- `[GET] /api/admin/unranked-maps` — Private (admin) — List unranked maps.
- `[POST] /api/admin/unranked-maps` — Private (admin) — Add unranked map.
- `[GET] /api/admin/unranked-maps/:id/usage` — Private (admin) — Check usage.
- `[DELETE] /api/admin/unranked-maps/:id` — Private (admin) — Remove unranked map.

### Team Management (2v2 Tournaments)
- `[GET] /api/admin/tournaments/:id/teams` — Private (organizer) — List teams, competitive members, and configured substitutes.
- `[POST] /api/admin/tournaments/:id/teams` — Private (organizer) — Create team.
- `[POST] /api/admin/tournaments/:id/teams/:teamId/members` — Private (organizer) — Add member to team.
- `[DELETE] /api/admin/tournaments/:id/teams/:teamId/members/:playerId` — Private (organizer) — Remove member.
- `[POST] /api/admin/tournaments/:id/teams/:teamId/substitutes` — Private (organizer) — Add substitute.
- `[DELETE] /api/admin/tournaments/:id/teams/:teamId/substitutes/:playerId` — Private (organizer) — Remove substitute.
- `[POST] /api/admin/tournaments/:id/teams/:teamId/replace-member` — Private (organizer) — Start an atomic member replacement during closed registration, preparation, or active play.
- `[DELETE] /api/admin/tournaments/:id/teams/:teamId` — Private (organizer) — Delete a team without matches.

---

## Notes

- All `Private` endpoints require `Authorization: Bearer <token>` header.
- `Private (admin)` additionally requires `is_admin = 1` in `users_extension`.
- Tournament and match results interoperate: reporting a match with `tournament_id` + `tournament_match_id` updates tournament_matches, tournament_participants stats, and Best-Of series state atomically.
- Replays are never uploaded by users — they are read from the Wesnoth replay server filesystem by the backend's background jobs.


---

## Background Jobs (Scheduler)

Initialized in `backend/src/jobs/scheduler.ts`, started automatically on server boot after migrations run.

| Schedule | Job | What it does |
|----------|-----|--------------|
| Every 60s | `SyncGamesFromForumJob` | Queries `forum.wesnothd_game_info` (WHERE `END_TIME > lastCheckTimestamp` AND addon type `modification` AND `ADDON_ID='Ranked'`), inserts new rows into `tournament.replays` with `parse_status='new'`. Persists `lastCheckTimestamp` in `system_settings`. |
| Every 30s | `ParseNewReplaysRefactored` | Reads `replays WHERE parse_status='new'`, loads `.bz2` file from replay server filesystem (`REPLAY_BASE_PATH/version/YYYY/MM/DD/filename`), parses WML via `replayRankedParser`. Calls `matchCreationService.createMatch()` for confidence=2 results (auto-confirm). For confidence=1 (ambiguous winner), saves parsed data and marks replay for player confirmation. |
| Daily 00:30 UTC | Balance snapshot cron | Calls `createFactionMapStatisticsSnapshot()` → saves a point-in-time row into `faction_map_statistics_history`. |
| Daily 00:45 UTC | Player stats recalculation | Calls `recalculatePlayerMatchStatistics()` → rebuilds `player_match_statistics` table from all non-cancelled matches. |
| Daily 01:00 UTC | Inactive player check | Direct DB `UPDATE users_extension SET is_active=0` for players with no matches in the last 30 days. |
| 1st of month 01:30 UTC | Player of month | Calls `calculatePlayerOfMonth()` → writes result to `player_of_month` table. |

---

## Server Startup Sequence

`backend/src/server.ts` → `app.ts`:
1. Connect to MariaDB.
2. Run `migrationRunner.runMigrations()` → scans `backend/migrations/*.sql`, applies any not yet recorded in `migrations` table. Idempotent (each migration is only applied once).
3. Mount route files (`auth`, `users`, `matches`, `tournaments`, `statistics`, `player-statistics`, `replays`, `public`, `admin`).
4. Call `initializeScheduledJobs()` → starts all cron/interval jobs above.

---

## Internal Call Chains

These are the backend-internal service calls triggered by key endpoints (not visible from the frontend API surface).

### Match creation (auto, via replay pipeline)
`ParseNewReplaysRefactored.execute()` → `createMatch()` in `matchCreationService`:
- Reads ELO for both players from `users_extension`.
- Calculates new ELO via `calculateNewRating()` (FIDE formula in `utils/elo.ts`).
- Inserts row into `matches` table.
- Updates `users_extension` for winner: `elo_rating`, `matches_played`, `total_wins`, `trend`, `level`.
- Updates `users_extension` for loser: `elo_rating`, `matches_played`, `total_losses`, `trend`, `level`.
- If `linkedTournamentRoundMatchId` is set: calls `updateTournamentRoundMatch()` → updates `tournament_round_matches.player1_wins/player2_wins/status/winner_id`.
- **Does NOT** call `updateFactionMapStatistics` — faction/map stats are rebuilt by the nightly cron or by explicit admin recalculation.

### `POST /api/matches/report-confidence-1-replay`
Player confirms winner of a confidence=1 replay:
- Validates replay exists and caller is a participant.
- Reads ELO, calculates new ratings inline.
- Inserts into `matches`, updates both players' `users_extension` rows.
- Calls `updateFactionMapStatistics(map, winnerFaction, loserFaction, side)` → increments counters in `faction_map_statistics`.
- If `tournament_match_id` provided: updates `tournament_round_matches` and checks `checkAndCompleteRound()`.

### `POST /api/matches/:id/confirm` (action: 'confirm')
Loser (or winner) rates and acknowledges the match:
- **No ELO recalculation** — ELO was already applied when the match was first created.
- Updates `matches.loser_rating/winner_rating/loser_comments/winner_comments`.
- If both players have now rated: sets `matches.status = 'confirmed'`.
- If tournament match: mirrors comments/rating into `tournament_matches`.

### `POST /api/matches/admin/:id/dispute` (action: 'validate')
Admin validates a dispute (cancels the match and reverses ELO):
- Marks match as `cancelled`.
- **Full ELO cascade**: replays ALL non-cancelled matches from scratch → recalculates every player's ELO in chronological order → writes updated values back to `users_extension`.
- Calls `recalculatePlayerMatchStatistics()` → rebuilds `player_match_statistics`.
- Calls `recalculateFactionMapStatistics()` → rebuilds `faction_map_statistics`.
- Attempts to call `calculatePlayerOfMonth()` to refresh player-of-month data.
- Match is re-opened for re-reporting.

### `POST /api/matches/:id/cancel-own`
Reporter cancels their own pending match:
- Sets match status to `cancelled`.
- Same full ELO cascade and `recalculatePlayerMatchStatistics()` as dispute validate.

### `POST /api/admin/recalculate-all-stats`
Admin triggers manual full recalculation:
- Full ELO cascade (same as dispute validate).
- `recalculatePlayerMatchStatistics()`.
- `recalculateFactionMapStatistics()`.
- `calculatePlayerOfMonth()`.

### `POST /api/admin/recalculate-snapshots`
- Calls `recalculateBalanceEventSnapshots(recreateAll?)` from `statisticsCalculator`.
- Rebuilds `faction_map_statistics_history` snapshots anchored to balance events.

### `POST /api/tournaments` (create tournament)
- Inserts tournament into DB.
- **Discord side effect** (if Discord configured): calls `discordService.createTournamentThread()` → creates a forum thread in the configured Discord server, stores `discord_thread_id` in `tournaments` table. Posts `postTournamentCreated()` message to the thread.

### Tournament lifecycle Discord notifications
Triggered by organizer actions on the tournament:
- `POST .../request-join` → `discordService.postPlayerRegistered()`.
- `POST .../participants/:id/accept` → `discordService.postPlayerAccepted()`.
- `POST .../close-registration` → `discordService.postRegistrationClosed()`.
- `POST .../start` → `discordService.postTournamentStarted()` + `postRoundStarted()` + `postMatchups()`.
- `POST .../next-round` → `discordService.postRoundStarted()` + `postMatchups()`.

### `POST /api/admin/users/:id/unlock`
- Resets `failed_login_attempts = 0`, `locked_until = NULL`.
- Sets `is_blocked = 0`.
- **Discord side effect**: calls `notifyUserUnlocked()` from `services/discord.ts` → sends DM to user's Discord account (if `discord_id` set and Discord enabled).

---

## Replay Data Flow (Full Picture)

```
Wesnoth game server
        │ uploads replay file to filesystem
        ▼
forum.wesnothd_game_info table
        │ (every 60s) SyncGamesFromForumJob
        ▼
tournament.replays (parse_status='new')
        │ (every 30s) ParseNewReplaysRefactored
        ▼
    replayRankedParser (WML parse, bz2 decompress)
        │
        ├── confidence=2 → matchCreationService.createMatch()
        │         → INSERT matches + UPDATE users_extension (ELO)
        │         → UPDATE tournament_round_matches (if tournament)
        │
        └── confidence=1 → replay marked as pending
                  │ (player sees it in Matches / TournamentDetail UI)
                  ▼
        POST /api/matches/report-confidence-1-replay
                  → INSERT matches + UPDATE users_extension (ELO)
                  → updateFactionMapStatistics()
                  → UPDATE tournament_round_matches (if tournament)
```
