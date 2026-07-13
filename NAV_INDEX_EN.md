# Navigation-oriented API Index

This index is organized following the app navigation (Navbar as entry point). For each screen/page it lists the frontend page, where it appears in nav, and the API endpoints the page calls (with purpose).

**Canonical locations:**
- Routes registered in `frontend/src/App.tsx` (React Router `Routes`/`Route`).
- Navbar links in `frontend/src/components/Navbar.tsx`.
- Frontend ↔ backend mapping in `frontend/src/services/api.ts` (main service) and `frontend/src/services/statisticsService.ts`, `frontend/src/services/playerStatisticsService.ts`.
- High-level player and authenticated-area responsibilities: [PLAYERS_AND_USERS_DOCUMENTATION.md](PLAYERS_AND_USERS_DOCUMENTATION.md).

---

## Navbar (global links)

| Link | Route | Page |
|------|-------|------|
| Home | `/` | `pages/Home.tsx` |
| Players | `/players` | `pages/Players.tsx` |
| Rankings | `/rankings` | `pages/Rankings.tsx` |
| Statistics | `/statistics` | `pages/Statistics.tsx` |
| Tournaments | `/tournaments` | `pages/Tournaments.tsx` |
| Matches | `/matches` | `pages/Matches.tsx` |
| FAQ | `/faq` → `/help/faq` | Wiki article with slug `faq` |
| News | `/news` | `pages/News.tsx` |
| User menu → Profile *(auth)* | `/user` | `pages/User.tsx` |
| Login *(unauth)* | `/login` | `pages/Login.tsx` |
| Register *(unauth)* | `/register` | `pages/Register.tsx` (→ wesnoth.org) |

Admin panel is accessible at `/admin` for users with `is_admin = 1` in `users_extension`.

The authenticated area is documented at [PLAYERS_AND_USERS_DOCUMENTATION.md](PLAYERS_AND_USERS_DOCUMENTATION.md). Its shared navigation includes `/profile`, `/my-tournaments`, `/notifications`, and `/help`; moderator and administrator links are added according to the authenticated user's role.

The editable profile page is documented separately in [PROFILE_DOCUMENTATION.md](PROFILE_DOCUMENTATION.md).

---

## Pages

### Home (`/`) — `pages/Home.tsx`
- `userService.getGlobalRanking()` → `GET /api/users/ranking/global` — top players widget.
- `publicService.getRecentMatches()` → `GET /api/public/matches/recent` — recent matches widget.
- `publicService.getTournaments()` → `GET /api/public/tournaments` — featured tournaments widget.
- `publicService.getPlayerOfMonth()` → `GET /api/public/player-of-month` — player of the month widget.
- `publicService.getDebug()` → `GET /api/public/debug` — debug info (shown to admins only).

### Players (`/players`) — `pages/Players.tsx`
- `publicService.getAllPlayers(page, filters)` → `GET /api/public/players` — paginated player directory.
  - Filters: `nickname`, `min_elo`, `max_elo`, `min_matches`, `rated_only`.

### Player Profile (`/player/:id`) — `pages/PlayerProfile.tsx`
- `publicService.getPlayerProfile(id)` → `GET /api/public/players/:id` — player details.
- `userService.getRecentMatches(id)` → `GET /api/users/:id/matches` — recent match history.
- `playerStatisticsService.getRecentOpponents(id)` → `GET /api/player-statistics/player/:id/recent-opponents` — recent opponents.
- Components rendered: `PlayerStatsByMap`, `PlayerStatsByFaction`, `PlayerHeadToHead`, `PlayerStatsOverview`.

### Player Stats (`/player/:playerId/stats`) — `pages/PlayerStatsPage.tsx`
- Aggregated stats for a player, calling `playerStatisticsService.*`.
- `GET /api/player-statistics/player/:id/global`
- `GET /api/player-statistics/player/:id/by-map`
- `GET /api/player-statistics/player/:id/by-faction`

### Rankings (`/rankings`) — `pages/Rankings.tsx`
- `userService.getGlobalRanking(page, filters)` → `GET /api/users/ranking/global` — global ELO ranking.
  - Filters: `page`, `nickname`, `min_elo`, `max_elo`.

### Statistics (`/statistics`) — `pages/Statistics.tsx`
Uses `statisticsService` from `services/statisticsService.ts`:
- `GET /api/statistics/config` — faction/map config (active items).
- `GET /api/statistics/faction-by-map` — faction win rates by map.
- `GET /api/statistics/matchups` — faction vs faction matchup stats.
- `GET /api/statistics/faction-global` — global faction win rates.
- `GET /api/statistics/map-balance` — map balance overview.
- `GET /api/statistics/history/events` — balance events list.
- `GET /api/statistics/history/events/:eventId/impact` — impact of a balance event.
- `GET /api/statistics/history/trend` — win rate trend over time.
- `GET /api/statistics/history/snapshot` — historical snapshot.

### Tournaments (`/tournaments`) — `pages/Tournaments.tsx`
- `publicService.getTournaments(page, filters)` → `GET /api/public/tournaments` — public tournament list.
  - Filters: `page`, `name`, `status`, `type`.

### Tournament Detail (`/tournament/:id`) — `pages/TournamentDetail.tsx`
On load:
- `publicService.getTournamentById(id)` → `GET /api/public/tournaments/:id`.
- `tournamentService.getTournamentStandings(id)` → `GET /api/tournaments/:id/standings`.
- `tournamentService.getTournamentMatches(id)` → `GET /api/tournaments/:id/matches`.
- `tournamentService.getTournamentRoundMatches(id)` → `GET /api/tournaments/:id/round-matches`.
- `tournamentService.getTournamentRounds(id)` → `GET /api/tournaments/:id/rounds`.
- `tournamentService.getTournamentOrganizers(id)` → `GET /api/tournaments/:id/organizers`.
- `fetch /api/public/tournaments/:id/pending-replays` — confidence=1 replays for open matches.

Actions:
- Request join → `POST /api/tournaments/:id/request-join`.
- Accept/Reject participant → `POST /api/tournaments/:id/participants/:participantId/accept|reject`.
- Confirm participation → `POST /api/tournaments/:id/participants/:participantId/confirm`.
- Close registration → `POST /api/tournaments/:id/close-registration`.
- Prepare → `POST /api/tournaments/:id/prepare`.
- Start → `POST /api/tournaments/:id/start`.
- Next round → `POST /api/tournaments/:id/next-round`.
- Record match result → `POST /api/tournaments/:id/matches/:matchId/result`.
- Determine winner (organizer) → `POST /api/tournaments/:id/matches/:matchId/determine-winner`.
- Dispute match → `POST /api/tournaments/:id/matches/:matchId/dispute`.
- Update tournament → `PUT /api/tournaments/:id`.
- Replace allowed assets → `PUT /api/tournaments/:id/assets`.
- Recalculate tiebreakers → `POST /api/tournaments/:id/calculate-tiebreakers`.

See [TOURNAMENTS_DOCUMENTATION.md](TOURNAMENTS_DOCUMENTATION.md) for the shared mode, format, lifecycle, and authorization model.
- Report a match in context → `POST /api/matches/report`.
- Report via confidence-1 replay → `POST /api/matches/report-confidence-1-replay`.

### My Tournaments (`/my-tournaments`) — `pages/MyTournaments.tsx`
- `tournamentService.getMyTournaments()` → `GET /api/tournaments/my`.
- `tournamentService.createTournament(data)` → `POST /api/tournaments`.
- Lists tournaments where the current user is creator or co-organizer.

### Matches (`/matches`) — `pages/Matches.tsx`
- `publicService.getAllMatches(page, filters)` → `GET /api/public/matches` — public match list.
  - Filters: `page`, `player`, `map`, `status`, `confirmed`, `faction`.
- `publicService.getFactions()` → `GET /api/public/factions` — faction filter options.

### My Matches (`/my-matches`) — `pages/MyMatches.tsx`
- `matchService.getUserMatches(userId, page, filters)` → `GET /api/users/:id/matches`.
- `matchService.getAllMatches(page, filters)` → `GET /api/matches`.

### User Profile (`/user`) — `pages/User.tsx`
- `userService.getProfile()` → `GET /api/users/profile`.
- `userService.getRecentMatches(userId)` → `GET /api/users/:id/matches`.
- `playerStatisticsService.getRecentOpponents(userId)` → `GET /api/player-statistics/player/:id/recent-opponents`.

### Edit Profile (`/profile`) — `pages/Profile.tsx`
- `userService.getProfile()` → `GET /api/users/profile`.
- `userService.updateProfile(data)` → `PUT /api/users/profile/update` — avatar, country, language.
- `userService.updateDiscordId(discordId)` → `PUT /api/users/profile/discord`.

### My Stats (`/my-stats`) — `pages/MyStats.tsx`
- `playerStatisticsService.*` — same endpoints as `/player/:id/stats` but scoped to current user.

### FAQ (`/faq` → `/help/faq`) — Wiki article
- The navbar keeps `/faq` as a stable entry point and redirects to the published Wiki article with slug `faq`.
- The article is rendered by `pages/Help.tsx` and managed from `/admin/wiki`.

### News (`/news`) — `pages/News.tsx`
- `publicService.getNews()` → `GET /api/public/news` — all publication language rows; the frontend applies language fallback.

### Login (`/login`) — `pages/Login.tsx`
- `authService.login(nickname, password)` → `POST /api/auth/login`.
- "Forgot password" link → `https://forum.wesnoth.org/ucp.php?mode=sendpassword` (external, no backend call).

### Register (`/register`) — `pages/Register.tsx`
- Static redirect page → `https://forum.wesnoth.org/ucp.php?mode=register` (no backend call).

---

## Admin Area (`/admin` and subpages)

All admin routes require `is_admin = 1` in `users_extension`.

### `/admin` — `pages/Admin.tsx` (User Management + Maintenance)
- `adminService.getAllUsers()` → `GET /api/admin/users`.
- `adminService.blockUser(id)` → `POST /api/admin/users/:id/block`.
- `adminService.unlockAccount(id)` → `POST /api/admin/users/:id/unlock` — reset failed login attempts and unblock.
- `adminService.makeAdmin(id)` → `POST /api/admin/users/:id/make-admin`.
- `adminService.removeAdmin(id)` → `POST /api/admin/users/:id/remove-admin`.
- `adminService.deleteUser(id)` → `DELETE /api/admin/users/:id`.
- `adminService.recalculateAllStats()` → `POST /api/admin/recalculate-all-stats`.
- `adminService.getMaintenanceStatus()` → `GET /api/admin/maintenance-status`.
- `adminService.toggleMaintenance(enable, reason)` → `POST /api/admin/toggle-maintenance`.

### `/admin/news` — `pages/AdminNews.tsx`
- `adminService.getNews()` → `GET /api/admin/news`.
- `adminService.createNews(data)` → `POST /api/admin/news`.
- `adminService.updateNews(id, data)` → `PUT /api/admin/news/:id`.
- `adminService.deleteNews(id)` → `DELETE /api/admin/news/:id`.

### `/admin/faq` → `/admin/wiki`
- The legacy admin URL redirects to Wiki management. FAQ content is edited as the `faq` article using the shared Markdown editor.

### `/admin/tournaments` — `pages/AdminTournaments.tsx`
- `publicService.getTournaments(page, filters)` → `GET /api/public/tournaments` — list all tournaments with name, status, type, and ownership filters.
- `tournamentService.deleteTournament(id)` → `DELETE /api/tournaments/:id`.

### `/admin/rule-templates` — `pages/AdminRuleTemplates.tsx`
- `adminService.getRuleTemplates()` → `GET /api/admin/rule-templates` — list active and inactive reusable tournament rule templates.
- `adminService.createRuleTemplate(data)` → `POST /api/admin/rule-templates`.
- `adminService.updateRuleTemplate(id, data)` → `PUT /api/admin/rule-templates/:id`.
- `adminService.deleteRuleTemplate(id)` → `DELETE /api/admin/rule-templates/:id` — only when no tournament references the template.

### `/admin/disputes` — `pages/AdminDisputes.tsx`
- `matchService.getAllDisputedMatches()` → `GET /api/matches/disputed/all`.
- `matchService.validateDispute(id)` → `POST /api/matches/admin/:id/dispute` `{action:'validate'}`.
- `matchService.rejectDispute(id)` → `POST /api/matches/admin/:id/dispute` `{action:'reject'}`.

### `/admin/audit` — `pages/AdminAudit.tsx`
- `adminService.getAuditLogs(params)` → `GET /api/admin/audit-logs`.
- `adminService.deleteAuditLogs(logIds)` → `DELETE /api/admin/audit-logs`.
- `adminService.deleteOldAuditLogs(daysBack)` → `DELETE /api/admin/audit-logs/old`.

### `/admin/maps-and-factions` — `pages/AdminMapsAndFactions.tsx`
- `GET /api/admin/maps`, `POST /api/admin/maps`, `DELETE /api/admin/maps/:mapId`.
- `GET /api/admin/factions`, `POST /api/admin/factions`, `DELETE /api/admin/factions/:factionId`.

### `/admin/balance-events` — `pages/AdminBalanceEvents.tsx`
- `statisticsService.*` from `services/statisticsService.ts`:
  - `GET /api/statistics/history/events`, `POST /api/statistics/history/events`, `PUT /api/statistics/history/events/:id`.
  - `GET /api/public/factions`, `GET /api/public/maps`.
  - `POST /api/admin/recalculate-snapshots` — recalculate all statistics snapshots.

---

## Notes

- All frontend service wrappers are in `frontend/src/services/api.ts` (main), `statisticsService.ts`, and `playerStatisticsService.ts`.
- Text and numeric list filters apply on Enter or Refresh; select and checkbox filters may apply immediately.
- Application profiles are created only on first successful login validated against `phpbb3_users`. Replay processing does not create profiles; direct ranked matches require both existing users to enable ranked matches in their profiles.
- Account management (password reset, email change) is handled entirely by the Wesnoth forum at `https://forum.wesnoth.org`.
