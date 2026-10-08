# Architecture

This is the single high-level description of Wesnoth Tournament Manager: its parts, the rules that do not change from one release to the next, and how it is operated. Feature behavior for players and staff is documented in the in-app wiki. Implementation details live next to the code, in comments and JSDoc, which are the source of truth for functions, queries, and edge cases.

## Components

```
Wesnoth game server (wesnothd)         phpBB forum
  writes finished games, players,        accounts, bans, moderator group
  content and replay files               │
        │                                │  read-only
        ▼                                ▼
  forum database (wesnothd_game_* tables, phpbb3_* tables)
        │  read-only
        ▼
  Backend — Node.js, Express, TypeScript ──── Discord (best-effort notifications)
    REST API, scheduled jobs, replay parsing
        │  read-write
        ▼
  Tournament database — MariaDB
        ▲
        │  REST (JSON)
  Frontend — React, Vite, TypeScript, Zustand, i18next, Tailwind
```

- **Tournament database** holds everything the application owns: user profiles (`users_extension`), ranked matches, replays and their parse results, tournaments and their competition graph, statistics, audit log, wiki articles, and settings.
- **Forum database** is an external, read-only source. The backend reads phpBB accounts for login and the `wesnothd_game_*` tables that the game server fills for every finished game. Access is limited to the tables it needs.
- **Backend** runs as a single instance. Besides the API it runs the scheduled jobs below in the same process.
- **Frontend** is a static single-page application built with Vite and served behind the same reverse proxy as the API.

## Identity and authorization

Players log in with their forum username and password, verified against phpBB. The first successful login creates their application profile. Forum bans block login, and membership of the configured forum moderator group grants moderator rights; administrator rights are application-level. The backend issues a signed JWT, and every request resolves it into a session that re-checks the account (blocked accounts lose their sessions immediately).

Authorization is enforced by the backend. Hidden frontend controls are a convenience, never a security boundary. Staff actions on other users' data, security events, and maintenance operations are written to the audit log; players' own actions on their own data are recorded by the data itself.

## Match modes and ratings

There are four modes: ranked (1v1), tournament ranked (1v1), tournament unranked (1v1), and tournament team games (2v2, unranked). Ranked and tournament-ranked games create a row in `matches` and update both players' ELO; unranked tournament and team games record only the tournament result.

`matches` is the source of truth for ranked history. The global recalculation replays every non-cancelled match in order and rewrites ratings, levels, ranking positions, and derived statistics. This full replay is a design principle: it keeps the rewritten history faithful and allows the rating model to change (for example to Glicko-2) by replaying with a new formula. Corrections that change past results (a validated or inverted dispute) queue this recalculation instead of patching ratings locally; it always replays everything but writes only the rows that change, in one transaction. Player levels are stored as English identifiers and translated by the frontend.

## Replay pipeline

1. **Sync** (every 60 s): new finished games that carry the Ranked add-on marker are copied from the forum tables into `replays`.
2. **Parse** (every 30 s): the replay WML and the forum rows give players, sides, factions, map, the ranked and tournament flags, and the outcome. Tournament games are linked by the forum topic code (`T<topic id>`) or the exact tournament name.
3. **Integrate:** the result is written in a single transaction (match and ELO, tournament game and progression, replay status). On any failure nothing is kept and the replay stays reprocessable from the admin panel.

A replay is integrated without player confirmation (confidence 2) only when its outcome is explicit:

- 1v1: the opponent's confirmed surrender.
- Team games: every player of one alliance has a confirmed surrender while exactly one alliance still has a player, and those alliances are exactly the two tournament teams. One surrender on each side, a player leaving without surrendering, or a team mismatch leaves the result to a player.

Otherwise (confidence 1) a participant confirms the result; concurrent confirmations of one replay are serialized and the first one wins, and the other player may open a dispute. The replay WML does not record leaderkill reliably (attacks carry no combat results, and the Ranked add-on event rarely records a winner), so leaderkill games wait for confirmation until the game server records results itself. Ranked and tournament-ranked replays with other than two players are rejected.

## Tournaments

Tournament identity and registration are separate from the competition structure. A tournament owns an ordered graph of phases. Each phase is Swiss, round robin, or single elimination and may contain parallel groups or brackets; groups own rounds, rounds own best-of series, and series own games. `tournament_entries` gives a stable competitive identity to an accepted player or a complete team. Advancement rules connect a finalized rank of a source group to a preclassification (seed) in a later phase.

The format is editable until preparation compiles the accepted registrations into entries, rounds, series, bracket slots, and the first games; from then on it is immutable. Swiss rounds are paired when the previous round completes, avoiding rematches; round robin uses the Berger rotation; brackets record where every slot comes from. A game result commits first; the follow-up (Discord notifications, next-phase compilation, finishing the tournament) runs afterwards and never undoes the result. If the follow-up fails, it is audited and the organizer can retry the phase advancement from the competition view.

Discord delivery is best-effort: failures are logged and never roll back a recorded result or a phase transition. Version 1 tournament tables still exist for history; their removal is planned in `docs/tournament-v2-legacy-cleanup-plan.md`.

## Statistics

- **Site statistics:** activity totals, refreshed into a cache every 30 minutes.
- **Faction and map balance:** live aggregates by map, faction, opponent faction, and side. Every non-cancelled ranked match contributes two rows, one per faction perspective, so real match counts are half the perspective totals.
- **Balance history:** cumulative daily snapshots of those aggregates. A date's snapshot covers every match of that date and earlier, so the daily job writes the previous UTC day once it is over. Each date is published all-or-nothing, and creators of the same date are serialized. The administrator rebuild regenerates every day from the first match plus the balance-event boundaries, in the background, without ever emptying the history. `npm run check:snapshot-history` (backend) lists stored dates with duplicated or missing rows.
- **Balance events:** buffs, nerfs, reworks, and similar changes recorded by administrators. An event compares the interval since the previous event with the interval until the next one, read from the latest snapshot on or before each boundary.
- **Player statistics:** per-player aggregates (global, by map, by faction, matchups, head-to-head) rebuilt from non-cancelled matches.

Cancelled matches are excluded from every derived statistic but never deleted.

## Scheduled jobs

All times are UTC.

| When | Job |
|---|---|
| Every 30 s | Parse new replays and integrate results |
| Every 60 s | Sync finished games from the forum database |
| Every 15 min | Remove expired P2P waiting-lobby announcements |
| Every 30 min | Refresh site statistics |
| 00:30 | Balance snapshot of the previous day |
| 00:45 | Player statistics recalculation |
| 01:00 | Mark inactive players |
| 01:30 on day 1 | Player of the month |
| 02:00 | Discard old unconfirmed replays |
| 02:30 | Clean up expired schedules |
| 03:00 | Clean up old notifications |

Long administrative operations (global recalculation, balance history rebuild) run as background jobs with a persisted progress row and an audited outcome.

## Localization and help

The interface is available in English, Spanish, German, Russian, and Chinese. English is the reference locale; `npm run verify` blocks a push when another locale is missing a key or an interpolation variable. Stored values (levels, statuses) are identifiers, never translated text. The user documentation is the in-app wiki; controls carry stable `data-help-id` hooks so its articles and screenshots can be generated and kept in sync.

## Configuration

Settings come from environment files that are never committed. `backend/.env.example` and `frontend/.env.example` document every supported setting: tournament and forum database connections, the forum moderator group, JWT secret and expiry, port, trusted proxy, replay paths and Wesnoth version filter, Discord, rate limits, and `TEST_MODE` (TEST only: lets staff log in as real forum users with a shared, bcrypt-hashed password). The frontend reads `VITE_API_BASE_URL` at build time.

Maintenance mode is an administrative setting that shows a banner and restricts login to administrators; it does not stop jobs or database access.

## Deployment and release

TEST (`tournament-test.wesnoth.org`) and production (`tournament.wesnoth.org`) run on the project's own server, each from its own checkout behind an Apache reverse proxy. A release is:

1. Work and commit on `test` (or a feature branch merged into it); never commit directly on `prod`. The versioned pre-push hook runs `npm run verify`.
2. Deploy to TEST: `npm run build` in `backend` and `frontend` (`build:test` for the frontend), then restart the backend (`NODE_ENV=test`). Pending database migrations in `backend/migrations/` run automatically at startup; a failed migration stops the start.
3. Verify on TEST, then merge `test` into `prod` and deploy the same way with `NODE_ENV=production` and `build:production`.

To refresh an isolated test database from a controlled source, `scripts/clone_tournament_db.sh` replaces a target database with a full clone. Stop every backend that can write to either database first, and never use production as the target.
