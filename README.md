# Wesnoth Tournament Manager

Tournament and ranked-play platform for [The Battle for Wesnoth](https://www.wesnoth.org), integrated with the Wesnoth forum and game server: players log in with their forum account, finished games are picked up from the server automatically, and their replays decide ranked matches and tournament games.

**License:** AGPL-3.0-or-later

## Features

- **Tournaments:** multi-phase competitions built from Swiss, round-robin, and single-elimination phases, with parallel groups, best-of series, advancement between phases, individual or 2v2 team entries, and ranked or unranked modes.
- **Ranked play:** ELO ratings, levels, global ranking, player statistics, player-to-player challenges with scheduling, and player of the month.
- **Automatic results:** finished games are synced from the game server and their replays parsed; explicit results (such as a surrender) are integrated automatically, and the rest are confirmed by a participant, with disputes reviewed by staff.
- **Balance statistics:** faction, map, and matchup analysis with daily history and balance-event comparisons.
- **Community and administration:** news, events calendar, FAQ, in-app wiki, Discord notifications, audit log, maintenance mode, and moderator/administrator tools.
- **Five languages:** English, Spanish, German, Russian, and Chinese.

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md):** components, rules, statistics, jobs, configuration, and the release workflow.
- **In-app wiki:** feature documentation for players and staff.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[AGENTS.md](AGENTS.md):** contribution and engineering policies.
- **[TESTING.md](TESTING.md):** the `npm run verify` gate, unit tests, and end-to-end suites.

## Requirements

- Node.js 20 or later.
- MariaDB for the tournament database.
- Read access to a Wesnoth forum database (phpBB accounts and the game server's `wesnothd_game_*` tables).

## Local development

```bash
# Backend (port from backend/.env, 7100 in the example)
cd backend
npm ci
cp .env.example .env.development   # fill in the database connections and secrets
npm run dev

# Frontend, in another terminal (http://localhost:5173)
cd frontend
npm ci
cp .env.example .env               # VITE_API_BASE_URL points to the backend
npm run dev
```

Pending database migrations run automatically when the backend starts. Before pushing, run `npm run verify` from the repository root, or enable the versioned hook once: `git config core.hooksPath .githooks`.

## License

This project is licensed under the **GNU Affero General Public License v3 (AGPL-3.0-or-later)**.

### What does AGPL mean?

- ✅ **Free use**: You can use this software freely
- ✅ **Free modification**: You can modify and adapt the code
- ✅ **Free distribution**: You can share the software

#### Main requirement:

**If you run this software as a service accessible over the network**, you must provide the source code to users who access the service.

This means:
- If you deploy this application on a server and users access it via web, you must share the source code with them
- Any modifications you make must be accessible to users of the service
- Users can view, audit, and improve the code

### Why AGPL?

This license reflects our values:
- **Transparency**: Service code is visible to users
- **Community**: Improvements benefit everyone
- **Trust**: Users can verify it works as expected
- **Security**: Code can be audited by anyone

### Dependency Licenses

Run `node scripts/check_licenses.js` after installing backend and frontend dependencies to inspect the license metadata declared by the installed packages.

All dependencies are compatible with AGPL-3.0.

### Commercial License

If you need to use this software without AGPL requirements (for example, for a private service without sharing code), you can contact the authors to negotiate a commercial license.

---

## Contact

For questions or suggestions, use github issue tracker
