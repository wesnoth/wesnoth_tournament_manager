# Database Schema Reference

## Quick Reference for SQL Queries

> **When writing any SQL queries, consult the full schema details below.** Key tables are listed in alphabetical order by schema. For detailed column definitions, use `DESCRIBE table_name` or see the relevant sections below.

### Tournament Schema — Key Tables
| Table | Purpose | Primary Key | Important Columns |
|---|---|---|---|
| `users_extension` | Player profiles | `id` | `user_id`, `nickname`, `elo`, `level`, `is_admin` |

### Notification References

`user_notifications` links tournament events through `series_id` for series
schedules or `game_id` for game-specific events. P2P challenge notifications use
neither reference and are identified by their notification type and tournament
context.
| `matches` | Direct matches (1v1) | `id` | `player1_id`, `player2_id`, `winner_id`, `loser_id`, `status` |
| `tournaments` | Tournament identity and lifecycle | `id` | `name`, `forum_topic_id`, `competition_model_version`, `tournament_mode`, `status` |
| `tournament_entries` | Immutable competitive player/team identities | `id` | `tournament_id`, `entry_type`, `participant_id`, `team_id`, `initial_seed` |
| `tournament_phases` | Ordered phase graph | `id` | `tournament_id`, `phase_order`, `format`, `status` |
| `tournament_phase_groups` | Parallel groups or brackets inside a phase | `id` | `phase_id`, `group_order`, `status` |
| `tournament_phase_entries` | Entry membership and preclassification per group | `id` | `group_id`, `entry_id`, `group_seed`, `status` |
| `tournament_phase_rounds` | Rounds scoped to one group/bracket | `id` | `group_id`, `round_number`, `best_of`, `status` |
| `tournament_series` | Best-of competitive series | `id` | `round_id`, `best_of`, `winner_entry_id`, `status` |
| `tournament_series_slots` | Direct or derived bracket positions | `id` | `series_id`, `slot_number`, `source_type`, `resolved_entry_id` |
| `tournament_games` | Individual games belonging to a series, including result feedback and manual confirmation state | `id` | `series_id`, `game_number`, `match_id`, `status`, `confirmation_status` |
| `tournament_phase_standings` | Materialized group standings | (`group_id`,`entry_id`) | `points`, `omp`, `gwp`, `ogp`, `rank_position` |
| `tournament_organizers` | Co-organizers per tournament | (`tournament_id`,`user_id`) | `tournament_id`, `user_id`, `created_by` |
| `tournament_rule_templates` | Reusable markdown rules templates | `id` | `title`, `content_markdown`, `is_active` |
| `tournament_participants` | Players in tournaments | `id` | `user_id`, `team_id`, `status` |
| `tournament_teams` | Team records (2v2) | `id` | `name`, `tournament_id`, `status` |
| `match_schedule_proposals` | Series-level tournament and P2P schedule proposals | `id` | `tournament_series_id`, `proposed_by_user_id`, `challenge_mode`, `challenged_user_id`, `status` |
| `match_schedule_slots` | Time slots within a proposal | `id` | `proposal_id`, `slot_datetime`, `status` |
| `match_schedule_confirmations` | User confirmations of proposals | `id` | `proposal_id`, `user_id`, `confirmed_at` |
| `replays` | Discovered replays | `id` | `replay_file_path`, `parse_status`, `parsed_data` |
| `game_maps` | Valid maps | `id` | `name`, `is_ranked` |
| `factions` | Valid factions | `id` | `name`, `is_ranked` |
| `balance_events` | Balance patches | `id` | `event_name`, `affected_factions`, `affected_maps` |
| `global_statistics` | Aggregated site statistics cache | `id` | `statistic_key`, `statistic_value`, `last_updated` |
| `system_settings` | Config key-value | `id` | `setting_key`, `setting_value` |
| `migrations` | Migration tracking | `id` | `name`, `executed_at` |

### Forum Schema — Key Tables (READ-ONLY)
| Table | Purpose | Primary Key | Important Columns |
|---|---|---|---|
| `phpbb3_users` | User accounts | `user_id` (int) | `username`, `username_clean`, `user_email`, `user_password` |
| `phpbb3_banlist` | User bans | `ban_id` | `ban_userid`, `ban_start`, `ban_end` |
| `phpbb3_user_group` | User group membership | (group_id, user_id) | `group_id`, `user_id` |
| `wesnothd_game_info` | Game sessions | (INSTANCE_UUID, GAME_ID) | `GAME_NAME`, `START_TIME`, `END_TIME`, `REPLAY_NAME` |
| `wesnothd_game_player_info` | Game players | (INSTANCE_UUID, GAME_ID, SIDE_NUMBER) | `USER_ID`, `FACTION`, `USER_NAME` |
| `wesnothd_game_content_info` | Game addons | (INSTANCE_UUID, GAME_ID, TYPE, ID, ADDON_ID) | `TYPE`, `ADDON_ID`, `ADDON_VERSION` |
| `wesnothd_extra_data` | Moderator flags | `username` | `user_is_moderator`, `user_lastvisit` |

---

## Architecture Overview

The application uses **two MariaDB schemas** on the same server:

| Schema | Purpose | Control |
|---|---|---|
| `forum` | phpBB forum users + Wesnoth game server data | **READ-ONLY** — managed by the wesnoth.org team. Never create migrations for these tables. |
| `tournament` | All tournament application data | **Full control** — migrations are applied automatically on backend startup. |

### Tournament competition model

Tournament identity, registration, participants, teams, ranked `matches`, and `replays.match_id` remain stable. Tournaments with `competition_model_version=2` use an ordered acyclic phase graph. A phase owns one or more parallel groups; each group owns rounds; rounds own best-of series; and series own individual games. Advancement rules map a finalized source rank to a target group preclassification.

The rollout follows expand, migrate, switch, and contract. Version 2 tournaments now use the phase-engine tables as their sole competition source of truth. Legacy round and match tables are removed by the contract migration after all tournaments have been migrated.

`forum_topic_id` is optional. When present, Wesnoth game rooms use `T<topic-id>` and replay resolution prefers that code. Without it, the exact tournament name remains the fallback; ambiguous matches require manual integration.

---

## Migration Standards

All database schema changes are managed through **SQL migration files** in `backend/migrations/`.

### Naming Convention

**Format**: `YYYYMMDD_HHMMSS_description.sql`

**Examples:**
- ✅ `20260609_214426_create_wiki_articles_table.sql`
- ✅ `20260514_220858_add_last_match_date.sql`
- ✅ `20260512_143000_fix_collation_consistency.sql`
- ❌ `migration_wiki_articles.sql` (missing timestamp)
- ❌ `2026-06-09_add_wiki.sql` (wrong date format)
- ❌ `create_wiki_articles_table.sql` (no timestamp)

**Why `YYYYMMDD_HHMMSS`?** This format allows multiple migrations to be created on the same day without filename collisions. The timestamp ensures proper execution order.

### Best Practices

1. **Always use `IF NOT EXISTS` / `IF EXISTS`** for idempotency
2. **Target only `tournament` schema** — never modify `forum.*` tables
3. **Use `utf8mb4_general_ci` collation** for user_id and other cross-table foreign keys
4. **Update `DB_SCHEMA.md`** immediately after adding a migration
5. **Keep migrations simple** — one logical change per migration file
6. **Add comments** explaining the purpose of structural changes

### Execution

Migrations run automatically on backend startup via `migrationRunner.ts`. Check `backend/migrations/migrations` table to see execution history.

---

- User identity is sourced from `forum.phpbb3_users` (username, password hash, email).
- On first successful login, a record is automatically created in `tournament.users_extension`.
- Replay processing never creates application users. Both players must have logged in previously; direct ranked replay integration additionally requires both to have enabled ranked matches in their profiles.
- `users_extension` stores only app-specific data: ELO, level, role flags, brute-force protection fields, preferences.
- Email and password management are entirely delegated to the Wesnoth forum.

---

## Forum Schema (READ-ONLY)

> ⚠️ These tables must **never** appear in any migration file. They are owned by the wesnoth.org team.

### `forum.phpbb3_users`

Primary source of truth for user accounts. Used only for authentication.

| Column | Type | Notes |
|---|---|---|
| `user_id` | int unsigned AUTO_INCREMENT | phpBB internal user ID |
| `username` | varchar(255) | Display name (used to match `users_extension.nickname`) |
| `username_clean` | varchar(255) | Lowercase/normalised username for lookups |
| `user_password` | varchar(255) | phpBB password hash — validated during login |
| `user_email` | varchar(100) | User email — returned in JWT response but not stored in the `tournament` schema |
| `user_type` | tinyint | 0=normal, 1=inactive, 2=ignore, 3=founder |
| `user_inactive_reason` | tinyint | phpBB deactivation reason |

> Key fields used by the application: `username`, `username_clean`, `user_password`, `user_email`, `user_type`, `user_inactive_reason`.

---

### `forum.wesnothd_game_info`

Game session metadata written by the Wesnoth dedicated server.

| Column | Type | Notes |
|---|---|---|
| `INSTANCE_UUID` | char(36) | Server instance identifier (part of composite PK) |
| `GAME_ID` | int unsigned | Game identifier (part of composite PK) |
| `INSTANCE_VERSION` | varchar(255) | Wesnoth version string |
| `GAME_NAME` | varchar(255) | Game room name |
| `START_TIME` | timestamp | When the game started |
| `END_TIME` | timestamp | When the game ended (NULL if still running) |
| `REPLAY_NAME` | varchar(255) | Filename of the replay on the replay server |
| `OOS` | bit | Out-of-sync flag |
| `RELOAD` | bit | Whether the game was a reload |
| `OBSERVERS` | bit | Whether observers were allowed |
| `PASSWORD` | bit | Whether the game was password-protected |
| `PUBLIC` | bit | Whether the game was public |

---

### `forum.wesnothd_game_player_info`

Players per game session.

| Column | Type | Notes |
|---|---|---|
| `INSTANCE_UUID` | char(36) | Part of composite PK + FK to `wesnothd_game_info` |
| `GAME_ID` | int unsigned | Part of composite PK + FK to `wesnothd_game_info` |
| `USER_ID` | int | phpBB user_id (-1 for guests) |
| `SIDE_NUMBER` | smallint | Side/slot number in the game |
| `IS_HOST` | bit | Whether this player was the host |
| `FACTION` | varchar(255) | Faction name as reported by the game |
| `CLIENT_VERSION` | varchar(255) | Wesnoth client version |
| `USER_NAME` | varchar(255) | Forum username at time of game |
| `LEADERS` | varchar(255) | Leader unit IDs |

---

### `forum.wesnothd_game_content_info`

Addons/modifications loaded in a game session. Used to detect the Ranked addon.

| Column | Type | Notes |
|---|---|---|
| `INSTANCE_UUID` | char(36) | Part of composite PK |
| `GAME_ID` | int unsigned | Part of composite PK |
| `TYPE` | varchar(100) | Content type (`modification`, `era`, `scenario`, etc.) |
| `ID` | varchar(100) | Content ID |
| `ADDON_ID` | varchar(100) | Add-on identifier (e.g., `Ranked`) |
| `ADDON_VERSION` | varchar(255) | Version string |
| `NAME` | varchar(255) | Display name |

> The replay sync job queries `TYPE='modification' AND ADDON_ID='Ranked'` to identify ranked games.

---

### `forum.wesnothd_extra_data`

Supplementary per-user data from the game server.

| Column | Type | Notes |
|---|---|---|
| `username` | varchar(255) PK | Forum username |
| `user_lastvisit` | int unsigned | Last visit timestamp |
| `user_is_moderator` | tinyint | Moderator flag |

---

## Tournament Schema

> Full control. Migrations in `backend/migrations/` are applied automatically on server startup by `migrationRunner.ts`.
> **Migration file format**: `YYYYMMDD_HHMMSS_description.sql` (e.g., `20260609_214426_create_wiki_articles_table.sql`). This format prevents naming collisions when creating multiple migrations on the same day. All DDL must be idempotent using `IF NOT EXISTS` / `IF EXISTS` clauses.

---

### `users_extension`

Application-level user profile. One record per forum user who has interacted with the tournament system.

> Records are created only on first successful application login. Replay processing requires existing profiles and does not register users.
> Default: `is_active=1`, `is_blocked=0`.
> Email and password management are **not** stored here — delegated entirely to the Wesnoth forum.

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | char(36) PK | | UUID |
| `nickname` | varchar(255) | | Forum username at time of creation |
| `language` | varchar(2) | `'en'` | Preferred UI language |
| `discord_id` | varchar(255) | NULL | Optional Discord user ID |
| `elo_rating` | int | 1400 | Current ELO rating |
| `level` | varchar(50) | `'novato'` | Skill level label |
| `is_active` | tinyint(1) | 0 | 1 = active in the app |
| `is_blocked` | tinyint(1) | 0 | 1 = blocked from the app (admin/moderator action; does not affect forum account) |
| `is_admin` | tinyint(1) | 0 | 1 = site administrator (independent from forum admin/moderator status) |
| `timezone` | varchar(100) | `'UTC'` | IANA timezone (e.g., `'America/New_York'`, `'Europe/Madrid'`) — for scheduling availability display |
| `availability_schedule` | longtext | NULL | JSON: `{weekday: {start: "HH:MM", end: "HH:MM"}, ...}` — player's recurring availability for scheduling |
| `availability_updated_at` | datetime | NULL | When availability was last updated |
| `enable_ranked` | tinyint(1) | 0 | 1 = player has opted in to ranked ladder matches; required for replays to be counted as ranked |
| `is_rated` | tinyint(1) | 0 | 1 = has enough games to appear in the ranked leaderboard |
| `elo_provisional` | tinyint(1) | 0 | 1 = ELO still provisional (fewer than threshold games played) |
| `matches_played` | int | 0 | Total ranked matches played |
| `total_wins` | int | 0 | Total ranked wins |
| `total_losses` | int | 0 | Total ranked losses |
| `trend` | varchar(10) | `'-'` | Recent ELO trend indicator |
| `failed_login_attempts` | int | 0 | Brute-force protection counter |
| `locked_until` | datetime | NULL | Account locked until this time (brute-force lockout) |
| `last_login_attempt` | datetime | NULL | Timestamp of last login attempt |
| `last_match_date` | datetime | NULL | Timestamp of last match participation — used to determine active status |
| `country` | varchar(2) | NULL | ISO 3166-1 alpha-2 country code |
| `avatar` | varchar(255) | NULL | Avatar identifier |
| `created_at` | datetime | now() | |
| `updated_at` | datetime | now() ON UPDATE | |

---

### `matches`

Direct (non-tournament) ranked matches between two players.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `winner_id` | char(36) FK→users_extension | Winner |
| `loser_id` | char(36) FK→users_extension | Loser |
| `map` | varchar(255) | Map name |
| `winner_faction` | varchar(255) | Winner's faction |
| `loser_faction` | varchar(255) | Loser's faction |
| `winner_comments` | text | Optional winner notes |
| `winner_rating` | int | Winner's subjective game rating (1–5) |
| `loser_comments` | text | Optional loser notes |
| `loser_rating` | int | Loser's subjective game rating (1–5) |
| `loser_confirmed` | tinyint(1) | Legacy field; use `status` |
| `replay_file_path` | varchar(1000) | Path on replay server filesystem |
| `tournament_id` | char(36) FK→tournaments | NULL for direct matches |
| `elo_change` | int | ELO delta applied |
| `status` | varchar(50) | `unconfirmed` / `confirmed` / `disputed` / `cancelled` |
| `auto_reported` | tinyint(1) | 1 = created automatically from replay processing |
| `replay_id` | char(36) FK→replays | Associated replay record |
| `admin_reviewed` | tinyint(1) | 1 = reviewed by an admin |
| `admin_reviewed_at` | datetime | When admin reviewed |
| `admin_reviewed_by` | char(36) FK→users_extension | Admin who reviewed |
| `winner_elo_before` | int | Winner ELO before the match |
| `winner_elo_after` | int | Winner ELO after the match |
| `loser_elo_before` | int | Loser ELO before the match |
| `loser_elo_after` | int | Loser ELO after the match |
| `winner_level_before` | varchar(50) | Winner level label before the match |
| `winner_level_after` | varchar(50) | Winner level label after the match |
| `loser_level_before` | varchar(50) | Loser level label before the match |
| `loser_level_after` | varchar(50) | Loser level label after the match |
| `replay_downloads` | int | Download counter |
| `winner_ranking_pos` | int | Winner global ranking position at match time |
| `winner_ranking_change` | int | Winner ranking position delta |
| `loser_ranking_pos` | int | Loser global ranking position at match time |
| `loser_ranking_change` | int | Loser ranking position delta |
| `round_id` | char(36) FK→tournament_rounds | NULL for direct matches |
| `tournament_type` | varchar(20) | Tournament type if applicable |
| `tournament_mode` | varchar(20) | Tournament mode if applicable |
| `winner_side` | tinyint(1) | 1 or 2 — which side the winner played |
| `game_id` | int | `wesnothd_game_info.GAME_ID` from forum |
| `wesnoth_version` | varchar(20) | Wesnoth version (e.g., `1.18.0`) |
| `instance_uuid` | char(36) | `wesnothd_game_info.INSTANCE_UUID` from forum |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

### `replays`

Registry of discovered replay files from the Wesnoth game server.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `replay_filename` | varchar(500) | Filename on the replay server |
| `replay_path` | varchar(1000) | Full path on replay server filesystem |
| `file_size_bytes` | bigint | File size |
| `parsed` | tinyint(1) | Legacy parsed flag |
| `parse_status` | varchar(50) | `new` / `parsing` / `parsed` / `completed` / `rejected` / `due` / `error` |
| | | • `new` — Detected but not yet parsed |
| | | • `parsing` — Currently parsing the replay file |
| | | • `parsed` — Successfully parsed, awaiting player confirmation (confidence level 1) |
| | | • `completed` — Parsed and auto-confirmed (confidence level 2 or confirmed by players) |
| | | • `rejected` — Rejected by admin or due to errors |
| | | • `due` — Confirmation period expired; replay available for download only, no actions possible |
| | | • `error` — Error occurred during parsing |
| `parse_error_message` | text | Error message if parsing failed |
| `parse_stage` | varchar(20) | Stage at which parsing stopped |
| `parse_summary` | text | Summary of parse result |
| `detected_at` | datetime | When first discovered |
| `file_write_closed_at` | datetime | When file write was closed |
| `file_mtime` | datetime | File modification time |
| `parsing_started_at` | datetime | |
| `parsing_completed_at` | datetime | |
| `wesnoth_version` | varchar(20) | Wesnoth version |
| `map_name` | varchar(255) | Map detected from replay |
| `era_id` | varchar(100) | Era addon ID |
| `tournament_addon_id` | varchar(100) | Tournament addon ID found in replay |
| `game_id` | int unsigned | `wesnothd_game_info.GAME_ID` from forum |
| `start_time` | timestamp | Game start time from forum |
| `end_time` | timestamp | Game end time from forum |
| `is_reload` | tinyint(1) | Whether game was a reload |
| `detected_from` | varchar(50) | How detected (`manual`, `sync_job`, etc.) |
| `instance_uuid` | char(36) | `wesnothd_game_info.INSTANCE_UUID` from forum |
| `game_name` | varchar(255) | Game room name |
| `oos` | tinyint(1) | Out-of-sync flag |
| `replay_url` | varchar(1000) | Public URL for replay download |
| `last_checked_at` | datetime | Last time the record was checked |
| `discard_vote_1` | char(36) | First player UUID who voted to discard |
| `discard_vote_2` | char(36) | Second player UUID who voted to discard |
| `cancel_requested_by` | varchar(36) | UUID of user who requested cancellation |
| `tournament_round_match_id` | char(36) FK→tournament_round_matches | If applicable |
| `created_at` | datetime | |
| `updated_at` | datetime | |
| `deleted_at` | datetime | Soft-delete timestamp |

---

### `replay_participants`

Players detected in a parsed replay.

| Column | Type | Notes |
|---|---|---|
| `id` | int AUTO_INCREMENT PK | |
| `replay_id` | varchar(36) FK→replays | |
| `player_id` | char(36) FK→users_extension | NULL if player not found in users_extension |
| `player_name` | varchar(255) | Username as found in the replay |
| `side` | int | Side number (1 or 2) |
| `faction_name` | varchar(255) | Faction name from replay |
| `result_side` | int | Winning side number |
| `created_at` | timestamp | |

---

### `replay_parsing_logs`

Per-stage processing log for replay parsing jobs.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `replay_id` | char(36) FK→replays | |
| `stage` | varchar(50) | Parse stage label |
| `status` | varchar(20) | `success` / `error` / `skipped` |
| `duration_ms` | int | Time taken for this stage |
| `error_message` | text | Error details if failed |
| `details` | JSON | Additional structured data |
| `created_at` | datetime | |

---

### `tournaments`

Tournament definitions.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `name` | varchar(255) | Tournament name |
| `description` | text | Description |
| `rules_template_id` | char(36) FK→tournament_rule_templates | Optional template reference used to bootstrap rules |
| `rules_content` | longtext | Markdown snapshot of tournament rules; editable per tournament and decoupled from template updates |
| `creator_id` | char(36) FK→users_extension | Organiser |
| `status` | varchar(20) | `registration_open` / `registration_closed` / `prepared` / `in_progress` / `finished` |
| `approved_at` | datetime | When admin approved the tournament |
| `scheduled_start_at` | datetime | Informational planned start, editable until the tournament starts |
| `started_at` | datetime | Actual start written by the Start lifecycle action |
| `finished_at` | datetime | When tournament finished |
| `registration_closed_at` | datetime | When registration was closed |
| `prepared_at` | datetime | When brackets/groups were generated |
| `tournament_type` | varchar(50) | `elimination` / `league` / `swiss` / `swiss_elimination` |
| `tournament_mode` | varchar(20) | `ranked` / `unranked` / `team` |
| `max_participants` | int | Maximum number of participants (NULL = unlimited) |
| `round_duration_days` | int | Days allocated per round |
| `auto_advance_round` | tinyint(1) | Whether rounds advance automatically |
| `current_round` | int | Current active round number |
| `total_rounds` | int | Total number of rounds |
| `general_rounds` | int | Number of general-phase rounds |
| `final_rounds` | int | Number of final-phase rounds |
| `general_rounds_format` | varchar(10) | Match format for general rounds (e.g., `bo3`) |
| `final_rounds_format` | varchar(10) | Match format for final rounds (e.g., `bo5`) |
| `discord_thread_id` | varchar(255) | Discord thread ID for tournament notifications |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

### `tournament_participants`

Links users to tournaments. Tracks participant status throughout tournament lifecycle including replacements.

**Constraints:**
- PRIMARY KEY: `id`
- FOREIGN KEY: `replaced_by_participant_id` → `tournament_participants(id)` ON DELETE SET NULL
- FOREIGN KEY: `requested_replacement_of_id` → `tournament_participants(id)` ON DELETE SET NULL
- CHECK: `participation_status` IN ('pending', 'accepted', 'pending_replacement', 'replaced', 'rejected', 'unconfirmed')

| Column | Type | Null | Key | Notes |
|---|---|---|---|---|
| `id` | char(36) | NO | PRI | UUID |
| `tournament_id` | char(36) | NO | MUL | FK→tournaments(id) |
| `user_id` | char(36) | NO | MUL | FK→users_extension(id) |
| `current_round` | int(11) | YES | | Round participant is in (default: 1) |
| `status` | varchar(20) | YES | | Legacy status field (default: 'active') |
| `created_at` | datetime | YES | | Timestamp (default: CURRENT_TIMESTAMP) |
| `participation_status` | varchar(30) | YES | | Status: `pending` (join request), `accepted` (active), `unconfirmed` (awaiting confirmation), `pending_replacement` (substitute waiting confirmation), `replaced` (was replaced mid-tournament), `rejected` (default: 'pending') |
| `replacement_requested_at` | datetime | YES | MUL | When replacement was initiated by organizer (default: NULL) |
| `replaced_by_participant_id` | char(36) | YES | MUL | FK→tournament_participants(id), points to substitute if this participant was replaced (default: NULL) |
| `requested_replacement_of_id` | char(36) | YES | MUL | FK→tournament_participants(id), if this is substitute, points to original participant being replaced (default: NULL) |
| `tournament_ranking` | int(11) | YES | | Final or current ranking (default: NULL) |
| `tournament_wins` | int(11) | YES | | Wins in tournament (default: 0) |
| `tournament_losses` | int(11) | YES | | Losses in tournament (default: 0) |
| `tournament_points` | int(11) | YES | | Points accumulated (default: 0) |
| `omp` | decimal(8,2) | YES | | Opponent Match-Win Percentage tiebreaker (default: 0.00) |
| `gwp` | decimal(5,2) | YES | | Game-Win Percentage tiebreaker (default: 0.00) |
| `ogp` | decimal(5,2) | YES | | Opponent Game-Win Percentage tiebreaker (default: 0.00) |
| `team_id` | char(36) | YES | MUL | FK→tournament_teams(id), for 2v2 tournaments (default: NULL) |
| `team_position` | smallint(6) | YES | | Player slot within team: 1 or 2 (default: NULL) |

**Indices:**
- `idx_tournament_id` on `tournament_id`
- `idx_user_id` on `user_id`
- `idx_team_id` on `team_id`
- `idx_tournament_participants_replacement_requested_at` on `replacement_requested_at`
- `idx_tournament_participants_replaced_by` on `replaced_by_participant_id`
- `idx_tournament_participants_replacement_of` on `requested_replacement_of_id`

---

### `tournament_organizers`

Co-organizers with full organizer permissions for a tournament.

| Column | Type | Notes |
|---|---|---|
| `tournament_id` | char(36) PK/FK→tournaments | Tournament identifier |
| `user_id` | char(36) PK/FK→users_extension | Organizer user identifier |
| `created_by` | char(36) FK→users_extension | Who granted organizer access |
| `created_at` | datetime | When organizer access was granted |

**Behavior:** On migration rollout, each existing tournament creator is backfilled into this table. Authorization remains compatible with `tournaments.creator_id`.

---

| `replay_file_path` | varchar(500) | |
| `status` | varchar(20) | `unconfirmed` / `confirmed` / `disputed` |
| `replay_downloads` | int | |
| `played_at` | datetime | |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

### `tournament_teams`

Teams for 2v2 tournaments.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `tournament_id` | char(36) FK→tournaments | |
| `name` | varchar(255) | Team name |
| `created_by` | char(36) FK→users_extension | Team creator |
| `tournament_wins` | int | |
| `tournament_losses` | int | |
| `tournament_points` | int | |
| `omp` | decimal(10,2) | Tiebreaker |
| `gwp` | decimal(5,2) | Tiebreaker |
| `ogp` | decimal(5,2) | Tiebreaker |
| `status` | varchar(20) | `active` / `eliminated` |
| `current_round` | int | |
| `tournament_ranking` | int | |
| `team_elo` | int | Combined team ELO |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

### `team_substitutes`

Substitute players for 2v2 teams.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `team_id` | char(36) FK→tournament_teams | |
| `player_id` | char(36) FK→users_extension | |
| `substitute_order` | smallint | Priority order |
| `added_at` | datetime | |

---

### `tournament_unranked_maps`

Per-tournament map allow-list. Ranked tournaments may reference only active ranked maps; other modes may reference any active map.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `tournament_id` | char(36) FK→tournaments | |
| `map_id` | char(36) FK→game_maps | |
| `created_at` | datetime | |

---

### `tournament_unranked_factions`

Per-tournament faction allow-list. Ranked tournaments may reference only active ranked factions; other modes may reference any active faction.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `tournament_id` | char(36) FK→tournaments | |
| `faction_id` | char(36) FK→factions | |
| `created_at` | datetime | |

---

### `tournament_rule_templates`

Reusable markdown templates managed by admins/moderators to speed up tournament creation.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `title` | varchar(255) | Template title shown in selector |
| `content_markdown` | longtext | Markdown template content |
| `is_active` | tinyint(1) | 1 = selectable by organizers |
| `created_by` | char(36) FK→users_extension | Creator user |
| `updated_by` | char(36) FK→users_extension | Last editor user |
| `created_at` | datetime | |
| `updated_at` | datetime | |

**Behavior:** Selecting a template copies `content_markdown` into `tournaments.rules_content`. Later edits to the tournament do not mutate the source template.

---

### `game_maps`

Map registry.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `name` | varchar(255) | Map name |
| `usage_count` | int | How many times this map has been played |
| `is_active` | tinyint(1) | Whether the map is available for selection |
| `is_ranked` | tinyint(1) | Whether the map is part of the ranked map pool |
| `created_at` | datetime | |

---

### `map_translations`

Localised names and descriptions for maps.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `map_id` | char(36) FK→game_maps | |
| `language_code` | varchar(10) | e.g., `en`, `es`, `de`, `zh` |
| `name` | varchar(255) | Translated name |
| `description` | text | Translated description |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

### `map_packs` and `map_pack_maps`

Administrative map collections used to accelerate map selection. Packs are reusable catalog records managed by administrators and moderators. The junction table allows each map to belong to multiple packs and preserves display order.

Applying a pack in tournament setup copies its currently eligible map IDs into the ordinary tournament map selection. Tournaments do not store a pack reference, so later pack changes never alter existing tournament configuration.

---

### `factions`

Faction registry.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `name` | varchar(255) | Faction name |
| `description` | text | |
| `icon_path` | varchar(500) | Icon asset path |
| `is_active` | tinyint(1) | Available for selection |
| `is_ranked` | tinyint(1) | Part of the ranked faction pool |
| `created_at` | datetime | |

---

### `faction_translations`

Localised names and descriptions for factions.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `faction_id` | char(36) FK→factions | |
| `language_code` | varchar(10) | |
| `name` | varchar(255) | Translated name |
| `description` | text | Translated description |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

### `faction_map_statistics`

Aggregated win/loss statistics per faction × map × opponent faction combination.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `map_id` | char(36) FK→game_maps | |
| `faction_id` | char(36) FK→factions | |
| `opponent_faction_id` | char(36) FK→factions | |
| `faction_side` | tinyint(1) | 0=unknown, 1=played as side 1, 2=played as side 2 |
| `total_games` | int | |
| `wins` | int | |
| `losses` | int | |
| `winrate` | decimal(5,2) | Computed win percentage |
| `created_at` | datetime | |
| `last_updated` | datetime | |

---

### `faction_map_statistics_history`

Historical snapshots of `faction_map_statistics` for balance tracking.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `snapshot_date` | date | Snapshot date |
| `snapshot_timestamp` | datetime | Exact time of snapshot |
| `map_id` | char(36) | |
| `faction_id` | char(36) | |
| `opponent_faction_id` | char(36) | |
| `total_games` | int | |
| `wins` | int | |
| `losses` | int | |
| `winrate` | decimal(5,2) | |
| `sample_size_category` | varchar(20) | e.g., `low`, `medium`, `high` |
| `confidence_level` | decimal(5,2) | Statistical confidence |
| `created_at` | datetime | |

---

### `player_match_statistics`

Per-player aggregated stats per opponent × map × faction combination.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `player_id` | char(36) FK→users_extension | |
| `opponent_id` | char(36) FK→users_extension | NULL for global aggregation |
| `map_id` | char(36) FK→game_maps | NULL for cross-map aggregation |
| `faction_id` | char(36) FK→factions | NULL for cross-faction aggregation |
| `opponent_faction_id` | char(36) FK→factions | NULL for cross-faction aggregation |
| `total_games` | int | |
| `wins` | int | |
| `losses` | int | |
| `winrate` | decimal(5,2) | |
| `avg_elo_change` | decimal(8,2) | Average ELO change per game |
| `last_elo_against_me` | decimal(8,2) | ELO of last opponent played |
| `elo_gained` | decimal(8,2) | Total ELO gained from wins |
| `elo_lost` | decimal(8,2) | Total ELO lost from losses |
| `last_match_date` | datetime | |
| `created_at` | datetime | |
| `last_updated` | datetime | |

---

### `balance_events`

Admin-created balance patch events used to segment statistics history.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `event_date` | datetime | When the event occurred |
| `patch_version` | varchar(20) | Wesnoth patch version |
| `event_type` | varchar(50) | e.g., `patch`, `hotfix`, `nerf`, `buff` |
| `faction_id` | char(36) FK→factions | Affected faction (NULL if global) |
| `map_id` | char(36) FK→game_maps | Affected map (NULL if global) |
| `description` | text | Event description |
| `notes` | text | Internal admin notes |
| `created_by` | char(36) FK→users_extension | Admin who created the event |
| `snapshot_before_date` | date | Reference snapshot date before the event |
| `snapshot_after_date` | date | Reference snapshot date after the event |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

### `countries`

Country reference data (ISO 3166-1 alpha-2).

| Column | Type | Notes |
|---|---|---|
| `code` | varchar(2) PK | ISO country code |
| `names_json` | JSON | Translated names keyed by language code |
| `flag_emoji` | varchar(10) | Flag emoji |
| `official_name` | varchar(255) | Official English name |
| `region` | varchar(100) | Geographic region |
| `is_active` | tinyint(1) | Whether selectable in the UI |
| `created_at` | datetime | |

---

### `news`

Site news articles with multi-language support.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `title` | varchar(255) | Default title |
| `content` | text | Default content |
| `translations` | JSON | Translations keyed by language code (`{"en":{}, "es":{}, "de":{}, "zh":{}}`) |
| `language_code` | varchar(10) | Primary language of the article |
| `author_id` | char(36) FK→users_extension | Author |
| `published_at` | datetime | NULL = draft |
| `created_at` | datetime | |
| `updated_at` | datetime | |

---

### `player_of_month`

Monthly player recognition records.

| Column | Type | Notes |
|---|---|---|
| `id` | int AUTO_INCREMENT PK | |
| `player_id` | char(36) FK→users_extension | |
| `nickname` | varchar(255) | Snapshot of nickname at time of award |
| `elo_rating` | int | ELO at time of award |
| `ranking_position` | int | Global ranking position |
| `elo_gained` | int | ELO gained during the month |
| `positions_gained` | int | Ranking positions gained during the month |
| `month_year` | date | First day of the awarded month |
| `calculated_at` | datetime | |

---

### `audit_logs`

System audit trail for sensitive operations.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `event_type` | varchar(50) | Action type (e.g., `login`, `block_user`, `delete_match`) |
| `user_id` | char(36) | Acting user (NULL for system actions) |
| `username` | varchar(255) | Username snapshot at time of event |
| `ip_address` | varchar(45) | Client IP |
| `user_agent` | text | Client user-agent string |
| `details` | JSON | Additional structured context |
| `created_at` | datetime | |

---

### `global_statistics`

Cached aggregated site-wide statistics for fast retrieval. Updated every 30 minutes by the scheduler.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `statistic_key` | varchar(100) UNIQUE | Metric identifier (e.g., `users_total`, `matches_month`) |
| `statistic_value` | bigint | Numeric value of the statistic |
| `last_updated` | datetime | When this row was last updated |
| `calculated_at` | datetime | When the calculation was performed |

**Keys stored:**
- `users_total`, `users_active`, `users_ranked`, `users_new_month`, `users_new_year`
- `matches_today`, `matches_week`, `matches_month`, `matches_year`, `matches_total`
- `tournament_matches_month`, `tournament_matches_year`, `tournament_matches_total`
- `tournaments_month`, `tournaments_year`, `tournaments_total`

> **Purpose**: Frontend dashboard displays these statistics on the home page. Caching here allows for efficient retrieval without expensive aggregation queries on each page load. Updated by `GlobalStatisticsCalculatorJob` every 30 minutes.

---

### `system_settings`

Key-value store for dynamic application configuration.

| Column | Type | Notes |
|---|---|---|
| `id` | int AUTO_INCREMENT PK | |
| `setting_key` | varchar(100) UNIQUE | Setting identifier |
| `setting_value` | text | Value |
| `description` | text | Human-readable description |
| `updated_by` | char(36) FK→users_extension | Who last changed this setting |
| `created_at` | datetime | |
| `updated_at` | datetime | |

> Notable key: `replay_last_check_timestamp` — used by the forum sync job to track the last processed game.

---

### `migrations`

Tracks which SQL migrations have been executed.

| Column | Type | Notes |
|---|---|---|
| `id` | int AUTO_INCREMENT PK | |
| `name` | varchar(255) UNIQUE | Migration filename |
| `executed_at` | datetime | When the migration ran |

---

### `match_schedule_proposals`

Schedule proposals for phase-engine tournament series and P2P challenges. In tournament flows, `tournament_series_id` is the canonical reference and `challenged_user_id` remains NULL. In P2P flows, `challenge_mode='p2p'` and `challenged_user_id` identifies the target player.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `tournament_series_id` | char(36) FK→tournament_series | Series scheduled by this proposal; canonical for the phase-engine tournament model |
| `proposed_by_user_id` | char(36) FK→users_extension | User who proposed this schedule |
| `proposed_at` | datetime | When proposal was created |
| `status` | varchar(20) | `pending` = awaiting confirmation, `confirmed` = at least one slot accepted, `rejected` = no slot accepted, `cancelled` = withdrawn, `expired` = no longer actionable; `superseded` is legacy-only |
| `expires_at` | datetime | Optional: automatic expiration timestamp |
| `cancelled_at` | datetime | When cancelled (NULL if active/confirmed) |
| `challenge_mode` | varchar(20) | Context discriminator: `tournament` \| `p2p` |
| `challenged_user_id` | char(36) FK→users_extension | Target user for P2P challenges (NULL for tournament schedules) |
| `discord_thread_id` | varchar(255) | Optional Discord thread/message identifier |
| `visibility` | varchar(20) | Display scope for events feed (`private` \| `public`) |
| `notes` | text | Optional notes from proposer |
| `created_at` | datetime | |
| `updated_at` | datetime | |

**Status flow**: `pending` → (`confirmed` OR `rejected` OR `cancelled` OR `expired`). New overlapping proposals are rejected before persistence rather than superseding an existing proposal.

---

### `match_schedule_slots`

Individual time slots within a proposal. Players select from these slots to confirm.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `proposal_id` | char(36) FK→match_schedule_proposals | Parent proposal |
| `slot_datetime` | datetime | UTC time of the slot (30-min duration implied) |
| `slot_duration_minutes` | int | Duration (default 30) |
| `status` | varchar(20) | `pending` = available, `confirmed` = chosen by players, `cancelled` = withdrawn |
| `created_at` | datetime | |

**Query pattern**: Get all slots for a proposal ordered by `slot_datetime ASC` to find earliest availability.

---

### `match_schedule_confirmations`

User confirmations of proposed schedules. Records agreement to the schedule proposal (proposal-level, not per-slot).

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) PK | UUID |
| `proposal_id` | char(36) FK→match_schedule_proposals | Which proposal was confirmed |
| `user_id` | char(36) FK→users_extension | Player who confirmed (NULL for team tournaments) |
| `confirmed_at` | datetime | When confirmed |
| `created_at` | datetime | |

**Unique constraint**: `(proposal_id, user_id)` — each player confirms exactly once per proposal.

**For 1v1 matches**: Both `player1_id` and `player2_id` must have confirmation rows.  
**For 2v2 matches**: All 4 players (2 teams × 2 players) must have confirmation rows.

---

### `wiki_articles`

Help system articles with multi-language support (JSON translations model). The public FAQ is the Wiki article with slug `faq`.

| Column | Type | Notes |
|---|---|---|
| `id` | char(36) UUID PK | Generated by the application |
| `slug` | varchar(255) UNIQUE | URL-friendly article identifier (e.g., `getting-started`, `ranking-elo`) |
| `translations` | longtext JSON | Multi-language content: `{"en": {"title": "...", "content_markdown": "..."}, "es": {...}, "de": {...}, "fr": {...}, "zh": {...}}` |
| `author_id` | char(36) FK→users_extension | Article author (NULL for seeded articles) |
| `is_published` | tinyint(1) | 1 = visible to all users, 0 = draft (admin only) |
| `created_at` | datetime | |
| `updated_at` | datetime | |

**Indexes**: unique `slug`, `idx_slug (slug)`, `idx_created_at (created_at)`

**Language fallback logic**: If requested language not translated, falls back to English (`en`).

**Constraint**: One row per `slug` guarantees consistent translations across all languages for an article.

---

### `wiki_images`

Uploaded images used in wiki articles.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | Auto-increment |
| `filename` | varchar(255) UNIQUE | Generated filename (e.g., `1781121281123_cxozvs.png`) used in URLs |
| `original_name` | varchar(255) | Original filename from upload |
| `uploaded_by` | char(36) FK→users_extension | User who uploaded (NULL for admin uploads) |
| `created_at` | timestamp | |

**Image storage**: Files stored in `backend/uploads/wiki/` directory. Served via API endpoint `/api/public/wiki/images/{filename}`.

---

### `wiki_article_images`

Junction table linking wiki articles to images (N:M relationship).

| Column | Type | Notes |
|---|---|---|
| `article_id` | char(36) FK→wiki_articles | Article referencing the image |
| `wiki_image_id` | bigint FK→wiki_images | Image used in the article |
| `created_at` | timestamp | When link was created |

**Primary key**: `(article_id, wiki_image_id)` — ensures each image used only once per article.

**Cascade delete**: If article or image deleted, link automatically removed.



### ID conventions
- All primary keys use `char(36)` UUIDs generated in application code.
- Exceptions: `migrations.id`, `player_of_month.id`, `replay_participants.id` use `int AUTO_INCREMENT`.

### Timestamps
- All timestamps are `datetime` in the MariaDB server's local time (UTC on the wesnoth.org server).
- `created_at` always defaults to `current_timestamp()`.
- `updated_at` uses `ON UPDATE current_timestamp()` where applicable.

### Character set
- All tables use `utf8mb4` / `utf8mb4_general_ci` unless noted otherwise.

### Multi-language content
- `news` uses a `translations` JSON column: `{"en": {"title": "...", "content": "..."}, "es": {...}, "de": {...}, "zh": {...}}`.
- Wiki articles, including the FAQ, use the `wiki_articles.translations` JSON column with `content_markdown`.
- Map and faction translations use dedicated `map_translations` / `faction_translations` tables.
- UI language preference is stored in `users_extension.language`.
