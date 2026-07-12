# Wesnoth Tournament Manager

A comprehensive tournament management system for **Wesnoth**, featuring automated replay processing, ELO ranking, multiple tournament formats, and deep integration with the Wesnoth forum ecosystem.

**Status**: ✅ Production Ready | **License**: ⚖️ AGPL-3.0-or-later | **Last Updated**: 2026

---

## 🎯 Core Features

### Tournament Management
- ✅ **Multiple Tournament Types**: League (round-robin), Swiss, Swiss-Hybrid, and Elimination formats
- ✅ **Automated Match Generation**: Berger algorithm for league tournaments, Swiss pairing logic
- ✅ **Tournament Variants**: Individual and Team tournaments (2v2 mode)
- ✅ **Ranked and Unranked Modes**: ELO tracking for ranked, custom assets for unranked
- ✅ **Dynamic Round Progression**: Automatic advancement or manual control
- ✅ **Automatic Match Detection**: Replays auto-sync from Wesnoth servers, matches auto-created
- ✅ **Dispute Resolution**: Admin panel for reviewing contested matches

### Player System
- ✅ **Forum Authentication**: Seamless login via Wesnoth forum (phpBB)
- ✅ **Forum Integration**: Auto-syncs with forum user database and ban lists
- ✅ **ELO Ranking System**: Chess.com-style rating with K-factor optimization
- ✅ **Player Tiers**: Automatic level assignment (Novice, Beginner, Veteran, Expert, Master)
- ✅ **Player Statistics**: Win/loss records, faction preferences, map mastery
- ✅ **Audit Logging**: Full action history with user tracking and IP logging
- ✅ **Profile Management**: Discord integration, country selection, avatar system
- ✅ **P2P Challenges**: Player-to-player challenge proposals with slot negotiation and notifications
- ✅ **Events Page**: Calendar/list view for upcoming tournament schedules and P2P challenges, with filters by type, tournament, players, and dates

### Replay & Match Processing
- ✅ **Fully Automated**: Background jobs sync and process replays without manual uploads
- ✅ **Intelligent Parsing**: Extracts winner, factions, maps, and ranked_mode from WML
- ✅ **Confidence Scoring**: Auto-confirms (confidence=2) or requires verification (confidence=1)
- ✅ **Tournament Linking**: Auto-assigns replays to tournament matches
- ✅ **Player Verification**: Optional confirmation for confidence=1 matches (when needed)
- ✅ **Addon Detection**: ranked_map_picker and ranked_era support

### Multi-Language Support
- ✅ **5 Languages**: English, Spanish, Chinese, German, Russian
- ✅ **Language Fallback**: Intelligent fallback chains for missing translations
- ✅ **Dynamic Switching**: Real-time language changes via UI selector
- ✅ **Content Localization**: News, FAQ, and error messages in all languages

### Administration
- ✅ **Comprehensive Admin Panel**: Match dispute resolution, balance events, audit logs
- ✅ **Audit Logging**: Full action history with user tracking
- ✅ **Rate Limiting**: Protection against abuse and DDoS
- ✅ **Maintenance Mode**: Graceful service maintenance
- ✅ **Player of the Month**: Automatic selection based on performance metrics
- ✅ **Global Statistics Dashboard**: Real-time aggregated site metrics (users, matches, tournaments)

---

## Prerequisites

- **Node.js** v18 or higher
- **MariaDB** 10.5+ (for tournament data and forum integration)
- **Docker & Docker Compose** (optional, for containerized deployment)
- **Wesnoth Forum** with phpBB3 database (for user authentication)

---

## Installation

### Quick Start with Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/clmates/wesnoth_tournament_manager.git
cd wesnoth_tournament_manager

# Create .env file
cp backend/.env.example backend/.env

# Edit backend/.env with your configuration
# IMPORTANT: Set FORUM_DATABASE_URL to point to your Wesnoth forum phpBB database
# This is required for user authentication to work

# Start all services
docker-compose up

# Services will be available at:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:3000
# - MariaDB: localhost:3306
```

### Local Installation (Without Docker)

#### Terminal 1: Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Configure .env with your MariaDB and forum database connections
# DATABASE_URL=mysql://root:root@localhost:3306/wesnoth_tournament
# FORUM_DATABASE_URL=mysql://root:root@localhost:3306/phpbb3

# Build TypeScript
npm run build

# Start in development mode
npm run dev

# Wait for: "Backend server running on http://0.0.0.0:3000"
```

#### Terminal 2: Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Wait for: "Local: http://localhost:5173"
```

---

## 🏗️ Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                 │
│  - Tournament Dashboard, Rankings, Standings        │
│  - Match Confirmation UI (when needed)              │
│  - Multi-language Support (5 languages)             │
│  - Real-time Updates                                │
└────────────────────┬────────────────────────────────┘
                     │ (REST API calls)
┌────────────────────▼────────────────────────────────┐
│                 Backend (Express.js)                │
│  - Tournament Management & Pairing Logic            │
│  - ELO Rating System & Statistics                   │
│  - AUTOMATIC: Replay Processing & Match Creation    │
│  - AUTOMATIC: Replay Sync (every 60s) & Parsing     │
│  - Match Validation & Dispute Resolution            │
│  - Scheduled Jobs (replay processing, notifications)│
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
┌──────────────┐ ┌──────────┐ ┌────────────────────┐
│ Tournament   │ │ Forum    │ │ Wesnoth Server     │
│ Database     │ │ phpBB DB │ │ Replay Downloads   │
│ (MariaDB)    │ │ (phpBB3) │ │ (Sync via Jobs)    │
└──────────────┘ └──────────┘ └────────────────────┘
```

### Authentication Flow

```
User Browser
    │
    └─► Login with forum username/password
            │
            ▼
    Backend authenticates against phpBB database
            │
            ├─► Check forum ban list
            │
            ├─► Verify moderator status
            │
            └─► Generate JWT token + refresh token
                    │
                    └─► Return to frontend
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript + Vite | Modern UI framework with HMR |
| **Frontend State** | Zustand | Lightweight state management |
| **Frontend i18n** | i18next | Multi-language support |
| **Backend** | Node.js + Express.js | REST API server |
| **Backend Language** | TypeScript | Type-safe backend code |
| **Database** | MariaDB 10.5+ | Tournament data storage |
| **Forum Integration** | phpBB3 | User authentication & game sync |
| **Containerization** | Docker & Docker Compose | Development & production deployment |
| **Scheduling** | node-cron | Background jobs (replay parsing, notifications) |
| **Parsing** | bz2 + Wesnoth WML | Replay file processing |
| **Auth** | JWT (stateless) | Session management |

### Replay Processing Pipeline

**No manual uploads needed. Everything is automatic:**

```
Wesnoth Game Ends
    │
    └─► Forum Database (wesnothd_game_info)
            │
            └─► SyncGamesFromForumJob (Every 60s)
                    │ Detects new games
                    │
                    └─► Queues replays for parsing
                            │
                            └─► ParseNewReplaysRefactored (Every 30s)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            Tournament Linking  Stats Update    Match Creation
            (Auto-detection)    (Ranked/Casual) (confidence 1 or 2)
                    │
                    ├─► Confidence=1: Needs player confirmation
                    │
                    └─► Confidence=2: Auto-confirmed
                            │
                            └─► ELO Updated Immediately
```

### Project Structure

```
wesnoth_tournament_manager/
├── backend/
│   ├── src/
│   │   ├── config/              # Database connections
│   │   │   ├── database.ts      # MariaDB config (tournament DB)
│   │   │   ├── forumDatabase.ts # Forum phpBB connection
│   │   │   └── supabase.ts      # Optional: file storage
│   │   ├── middleware/          # Express middleware
│   │   │   ├── auth.ts          # JWT verification
│   │   │   ├── rateLimiter.ts   # DDoS protection
│   │   │   └── audit.ts         # Action logging
│   │   ├── routes/              # API endpoints
│   │   │   ├── auth.ts          # Login via forum auth
│   │   │   ├── tournaments.ts   # Tournament CRUD & logic
│   │   │   ├── matches.ts       # Match reporting & confirmation
│   │   │   ├── public.ts        # Public endpoints
│   │   │   ├── users.ts         # User profiles & stats
│   │   │   └── admin.ts         # Admin panel endpoints
│   │   ├── services/            # Business logic
│   │   │   ├── phpbbAuth.ts     # Forum authentication
│   │   │   ├── matchCreationService.ts
│   │   │   ├── tournamentService.ts
│   │   │   ├── eloCalculation.ts
│   │   │   └── statisticsService.ts
│   │   ├── jobs/                # Scheduled background jobs
│   │   │   ├── parseNewReplaysRefactored.ts
│   │   │   ├── syncGamesFromForum.ts
│   │   │   ├── playerOfMonthJob.ts
│   │   │   └── scheduler.ts
│   │   ├── utils/               # Utilities
│   │   │   ├── replayRankedParser.ts    # WML parsing
│   │   │   ├── replayParser.ts          # Map/scenario extraction
│   │   │   ├── tournament.ts            # Tournament algorithms
│   │   │   └── bestOf.ts                # BO3 logic
│   │   ├── types/               # TypeScript interfaces
│   │   ├── migrations/          # Database schema versions
│   │   ├── app.ts               # Express app setup
│   │   └── server.ts            # Entry point
│   ├── Dockerfile
│   ├── tsconfig.json
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/          # React components
│   │   ├── pages/               # Page components
│   │   ├── services/            # API client wrappers
│   │   ├── store/               # Zustand state
│   │   ├── i18n/                # Internationalization
│   │   ├── types/               # TypeScript interfaces
│   │   ├── utils/               # Helper functions
│   │   ├── styles/              # CSS files
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── docker-compose.yml
├── Procfile                     # Railway/Heroku deployment config
├── DB_SCHEMA.md                 # Database documentation
├── API_ENDPOINTS.md             # REST API reference
├── REPLAY_PARSING.md            # Replay processing docs
├── REPLAY_ADMIN_DOCUMENTATION.md # Replay administration overview
├── MATCH_DISPUTES_DOCUMENTATION.md # Match dispute overview
├── BALANCE_EVENTS_DOCUMENTATION.md # Balance events and historical snapshots
├── STATISTICS.md                   # Statistics architecture and responsibilities
├── MariaDB_tournament_schema.sql # Tournament schema
├── MariaDB_forum_schema.sql     # Forum schema (reference)
└── README.md
```

---

## 📋 Key API Endpoints

For complete API reference, see [API_ENDPOINTS.md](API_ENDPOINTS.md)

### Authentication
- `POST /api/auth/login` — Authenticate via Wesnoth forum credentials (phpBB)
- `GET /api/auth/validate-token` — Validate JWT token

### Tournaments
- `POST /api/tournaments` — Create tournament
- `GET /api/tournaments` — List tournaments
- `GET /api/tournaments/:id` — Get tournament details
- `POST /api/tournaments/:id/join` — Join tournament
- `GET /api/tournaments/:id/ranking` — Tournament standings

### Matches & Replays (Automatic Processing)
- `GET /api/matches/pending/user` — Get pending matches needing your confirmation
- `POST /api/matches/:id/confirm` — Confirm or dispute a match result
- `GET /api/public/tournaments/:id/pending-replays` — Tournament matches needing confirmation
- `GET /api/matches/disputed/all` — View all disputed matches (admin)

### Rankings & Statistics
- `GET /api/users/ranking/global` — Global ELO rankings
- `GET /api/users/:id/stats` — Player statistics
- `GET /api/public/player-of-month` — Current POTM

### Administration
- `GET /api/matches/disputed/all` — All disputed matches (admin)
- `POST /api/admin/news` — Create news/announcements (admin)
- `GET /api/admin/balance-events` — Balance change history (admin)

---

## 🎮 How Match Reporting Works

### Automatic Replay Processing Pipeline

The system automatically processes game replays without manual reporting:

```
1. Game Ends on Wesnoth Server
        ↓
2. Forum records game in wesnothd_game_* tables
        ↓
3. SyncGamesFromForumJob (every 60s) detects new games
        ↓
4. Replay files queued for parsing
        ↓
5. ParseNewReplaysRefactored (every 30s) processes replays
        ↓
6. System extracts: winner, factions, map, ranked_mode, tournament info
        ↓
7. Match created with confidence level (1 or 2)
        ↓
8. If confidence=1: Player confirmation needed
   If confidence=2: Auto-confirmed, ELO updated immediately
```

### Confidence Levels

- **Confidence 1**: Auto-detected, needs player confirmation
  - Uses: Forum data + heuristics
  - Requires: Winner to review and confirm
  - Fallback: Player must verify result via UI

- **Confidence 2**: Automatically confirmed
  - Uses: Replay file + forum data
  - Winner and loser are certain
  - ELO updates immediately
  - No manual action needed

### User Actions (What Players DO)

1. **Play a game** on Wesnoth servers with tournament addon
2. **System auto-syncs** the replay (no upload needed)
3. **If confidence=1**: Check pending matches → Confirm or dispute
4. **If confidence=2**: Match auto-confirmed (no action needed)
5. **View results** in rankings and statistics

### API Usage Examples

#### 1. Login (Via Forum)

Users login using their **Wesnoth forum username and password**. The system authenticates directly against the phpBB database:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "YourForumUsername",
    "password": "YourForumPassword"
  }'

# Returns: { token, userId, isTournamentModerator, isAdmin }
```

**Important**: User accounts are NOT created in this system. They must exist in the Wesnoth forum first.

#### 2. Create Tournament

```bash
curl -X POST http://localhost:3000/api/tournaments \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Spring Cup 2026",
    "tournament_type": "swiss",
    "general_rounds": 5,
    "max_participants": 32
  }'
```

#### 3. View Pending Matches (Confidence=1 requiring confirmation)

```bash
curl -X GET http://localhost:3000/api/matches/pending/user \
  -H "Authorization: Bearer YOUR_TOKEN"

# Returns list of matches waiting for player confirmation
```

#### 4. Confirm/Dispute Match Result

```bash
curl -X POST http://localhost:3000/api/matches/:id/confirm \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "confirm",
    "comments": "Confirms the match result"
  }'

# Or dispute:
# "action": "dispute", with reason in comments
```

#### 5. View Tournament Pending Replays

Get replays that need confirmation for tournament matches:

```bash
curl -X GET http://localhost:3000/api/public/tournaments/:id/pending-replays \
  -H "Authorization: Bearer YOUR_TOKEN"

# Returns: List of confidence=1 replays queued for confirmation
```

#### 6. Get Global Site Statistics (Public)

Retrieve aggregated site-wide statistics (no authentication required):

```bash
curl -X GET http://localhost:3000/api/statistics/global

# Returns:
# {
#   "users_total": 150,
#   "users_active": 85,
#   "users_ranked": 42,
#   "users_new_month": 12,
#   "users_new_year": 45,
#   "matches_today": 3,
#   "matches_week": 18,
#   "matches_month": 72,
#   "matches_year": 280,
#   "matches_total": 2156,
#   "tournament_matches_month": 24,
#   "tournament_matches_year": 95,
#   "tournament_matches_total": 512,
#   "tournaments_month": 2,
#   "tournaments_year": 8,
#   "tournaments_total": 42,
#   "last_updated": "2026-04-23T21:18:47.653Z"
# }

# Force immediate recalculation:
curl -X GET "http://localhost:3000/api/statistics/global?force=true"
```

---

## 🔧 Environment Variables

### Backend Configuration

Create `backend/.env` with these settings:

```env
# Tournament Database (MariaDB)
DATABASE_URL=mysql://root:root@localhost:3306/wesnoth_tournament
DB_HOST=localhost
DB_PORT=3306
DB_NAME=wesnoth_tournament
DB_USER=root
DB_PASSWORD=root

# Forum Database (phpBB3) - REQUIRED for authentication
# This is your Wesnoth forum database
FORUM_DATABASE_URL=mysql://root:root@localhost:3306/phpbb3
FORUM_DB_HOST=localhost
FORUM_DB_PORT=3306
FORUM_DB_NAME=phpbb3
FORUM_DB_USER=root
FORUM_DB_PASSWORD=root

# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-minimum-32-characters
JWT_EXPIRATION=7d

# Server
PORT=3000
NODE_ENV=development

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:5173

# Discord routing for schedules/challenges
# Tournament schedule notifications continue using tournament forum thread/channel flow.
# P2P challenge notifications are posted in a flat channel (no thread creation).
DISCORD_P2P_CHALLENGE_CHANNEL_ID=


### Frontend Configuration

Create `frontend/.env.local`:

```env
VITE_API_URL=http://localhost:3000/api
```

---

## 📊 Database Schema

The system uses MariaDB with two main databases:

### Tournament Database (wesnoth_tournament)

**Core Tables:**
- `users_extension` — Player profiles and ELO ratings
- `tournaments` — Tournament definitions and metadata
- `tournament_rounds` — Individual rounds within tournaments
- `tournament_matches` — Pre-generated or on-demand matches
- `tournament_round_matches` — Match instances with results
- `tournament_participants` — Players enrolled in tournaments
- `tournament_teams` — Team definitions for 2v2 tournaments
- `matches` — Casual/ranked match records
- `replays` — Processed game replays
- `balance_events` — Patch/balance changes
- `audit_log` — Full audit trail of user actions

### Forum Database (phpbb3) - Read-Only Integration

The system reads from the Wesnoth forum database for:
- `phpbb3_users` — Forum user accounts (authentication source)
- `phpbb3_banlist` — User bans (enforced at login)
- `wesnothd_game_info` — Wesnoth server game records
- `wesnothd_game_player_info` — Player participation in games
- `wesnothd_game_content_info` — Addons used in games

For detailed schema, see [DB_SCHEMA.md](DB_SCHEMA.md)

---

## 🐛 Troubleshooting

### Backend Port Already in Use

```bash
# Check what's using port 3000
# Linux/macOS:
lsof -i :3000

# Windows:
netstat -ano | findstr :3000

# Kill the process (use PID from above)
kill -9 <PID>  # Linux/macOS
taskkill /PID <PID> /F  # Windows
```

### Frontend Port Already in Use

```bash
# Check what's using port 5173
lsof -i :5173

# Kill process or use different port:
npm run dev -- --port 5174
```

### Forum Database Connection Error

The system requires a phpBB forum database for authentication:

```bash
# Verify your Wesnoth forum database connection in .env:
FORUM_DATABASE_URL=mysql://root:root@forum-host:3306/phpbb3

# Check if the forum database is accessible
mysql -u root -p -h forum-host -e "USE phpbb3; SELECT COUNT(*) FROM phpbb3_users;"
```

### JWT Token Errors

- **"Invalid token"**: Token may have expired or been tampered with. Re-login.
- **"Missing JWT_SECRET"**: Set `JWT_SECRET` in `.env` (minimum 32 characters).
- **"Token expired"**: Controlled by `JWT_EXPIRATION` environment variable.

### Forum Ban Check Failed

If a user logs in but sees "You are banned from the forum":

```bash
# Check the phpBB ban list:
SELECT * FROM phpbb3_banlist WHERE ban_userid = <user_id> AND ban_end > UNIX_TIMESTAMP();
```

### Replay Processing Issues

If a replay doesn't appear in pending matches, check these conditions:

#### For Ranked Matches (ELO-tracked games)

All of these must be true for a replay to be ranked:

1. **Player has ranked enabled**: User must have `enable_ranked: true` in their profile
   - UI: User Profile → "Enable Ranked Participation" must be checked
   - Database: `users_extension.enable_ranked = 1`

2. **Game setup uses ranked addon with ranked_mode enabled**: 
   - In-game addon must have `ranked_mode` flag set to `yes`
   - Forum data: Game WML must include `[addon] ... ranked_mode: yes [/addon]`
   - This enables ELO rating calculations

3. **Era is one of**: ranked, ladder, or default (Standard Wesnoth eras)
   - Valid: "Ranked", "Ladder", "Default"
   - Invalid: Custom eras without official ranking

4. **Map is in ranked/ladder map pack**: Only official or whitelisted maps count
   - Valid: "Weldyn Channel", "Hamlets", "Den of Onis", etc.
   - Invalid: Custom maps not in the ranked map pool
   - Check: Map must exist in `game_maps` table with `is_ranked = 1`

5. **Factions used in game**: Must be valid Wesnoth factions
   - Valid: Loyalists, Undead, Northerners, Rebels, Drakes, etc.
   - Invalid: Custom factions without standard ID

**Debug checklist**:
```sql
-- Check if user has ranked enabled
SELECT nickname, enable_ranked FROM users_extension WHERE LOWER(nickname) = LOWER('PlayerName');

-- Check if map is in ranked pool
SELECT * FROM game_maps WHERE LOWER(name) LIKE '%mapname%' AND is_ranked = 1;

-- Check game addon flags in forum DB
SELECT * FROM wesnothd_game_content_info 
WHERE GAME_ID = <game_id> AND ADDON_ID LIKE '%ranked%';
```

#### For Unranked Tournament Matches

All of these must be true for replays to match a tournament:

1. **Game uses the same addon with `tournament=yes` flag**: 
   - The addon is the same (ranked addon) but must have `tournament: yes` in WML
   - If it's a ranked tournament: addon must have both `tournament: yes` AND `ranked_mode: yes`
   - If it's an unranked tournament: addon must have `tournament: yes` and `ranked_mode: no`
   - Forum data: `wesnothd_game_content_info` must contain addon with proper flags set

2. **Tournament must be registered**: The game's tournament name must exist
   - System: Tournament must be created in the system first
   - WML: Game WML must contain `[tournament] name="Tournament Name" [/tournament]`
   - Match: System must be able to link replay to a tournament round

3. **Tournament has matching rounds open**: Round must accept new matches
   - Database: `tournament_round_matches` must have available slots
   - Status: Round must be `in_progress` or `registration_open`
   - Matches: Must not have all slots filled

**Debug checklist**:
```sql
-- Check if tournament exists
SELECT id, name, tournament_type, status FROM tournaments 
WHERE LOWER(name) = LOWER('TournamentName');

-- Check if tournament has open rounds
SELECT tr.id, tr.round_status, COUNT(trm.id) as match_count
FROM tournament_rounds tr
LEFT JOIN tournament_round_matches trm ON tr.id = trm.tournament_round_id
WHERE tr.tournament_id = <tournament_id>
GROUP BY tr.id;

-- Check addon flags in forum DB (same addon, different flags)
SELECT DISTINCT ADDON_ID, ADDON_VERSION FROM wesnothd_game_content_info 
ORDER BY ADDON_ID;
```

**Common issues**:
- **"Addon not found"**: Addon must be registered in forum database first
- **"Tournament flag missing"**: Game must have `tournament: yes` in addon config
- **"Ranked flag mismatch"**: Tournament type (ranked vs unranked) must match addon flags

---

## 🔄 Background Jobs (Automatic Replay Processing)

The system runs scheduled background jobs automatically. No manual intervention needed:

| Job | Interval | Purpose |
|-----|----------|---------|
| `SyncGamesFromForumJob` | 60 seconds | Detects new games from forum DB and queues replays |
| `ParseNewReplaysRefactored` | 30 seconds | Parses queued replays, extracts data, links to tournaments |
| `PlayerOfMonthJob` | Daily (midnight UTC) | Calculates and updates monthly top player |
| `SchedulerJob` | On startup | Initializes and coordinates all scheduled tasks |

These jobs run automatically when the backend starts. Check backend logs for job execution details.

### Automatic Replay Discard Configuration

Unconfirmed replays (awaiting player confirmation) are automatically discarded if they remain unconfirmed for a specified period.

**Configuration:**
```env
REPLAY_AUTO_DISCARD_TIME=30  # Days (default: 30)
```

**Behavior:**
- Daily check at 02:00 UTC
- Targets replays with `parse_status='parsed'` and `integration_confidence=1` (unconfirmed)
- Old replays are marked as `rejected` (same effect as admin manual discard)
- Fully audited: each discard logged in `audit_logs` table with event_type `REPLAY_AUTO_DISCARDED`
- **Why?** Prevents accumulation of stale pending confirmations that will never be acted upon

**Recovery:**
- Discarded replays can be reprocessed via admin panel `/api/admin/replays/:id/reprocess`
- Audit trail preserved for compliance and troubleshooting

---

## 📦 Production Deployment

### Option 1: Docker (Recommended)

```bash
# Build production images
docker-compose -f docker-compose.yml build --no-cache

# Start services
docker-compose up -d

# View logs
docker-compose logs -f backend
```

### Option 2: Railway/Heroku

The `Procfile` defines how to deploy:

```yaml
web: cd backend && npm run build && npm start
```

Use this with Railway, Heroku, or similar platforms:

```bash
# Push to platform (example with Git)
git push railway main
```

### Option 3: Manual VPS Deployment

```bash
# Clone repository
git clone https://github.com/clmates/wesnoth_tournament_manager.git
cd wesnoth_tournament_manager

# Install Node.js v18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs

# Setup backend
cd backend
npm ci --production
npm run build
# Set environment variables, then:
npm start &

# Setup frontend
cd ../frontend
npm ci --production
npm run build
# Serve dist folder with Nginx or similar
```

---

## 🌍 Multi-Language System

### Supported Languages
- 🇬🇧 English (en)
- 🇪🇸 Spanish (es)
- 🇨🇳 Chinese (zh)
- 🇩🇪 German (de)
- 🇷🇺 Russian (ru)

### Language Fallback Strategy

The frontend implements intelligent fallback:
1. User's selected language (stored in localStorage)
2. Browser language
3. Language fallback chain (e.g., zh-Hans → zh → en)
4. Default (English)

For missing translations, see [LANGUAGE_FALLBACK_SYSTEM_EN.md](LANGUAGE_FALLBACK_SYSTEM_EN.md)

---

## ⚙️ Advanced Configuration

### ELO Rating System

Default configuration (chess.com style):
- **K-factor**: 32 (controls rating volatility)
- **Base rating**: 1400 for new players
- **Minimum rating**: 800 (floor value)

To customize, modify `backend/src/utils/eloCalculation.ts`

### Tournament Pairing Algorithms

- **League (Round-Robin)**: Berger algorithm with circular rotation
- **Swiss**: Standard Swiss system with tiebreaker scoring
- **Swiss-Hybrid**: Swiss format with playoff finals
- **Elimination**: Single-elimination with bracket advancement

### Rate Limiting

Configured in `backend/src/middleware/rateLimiter.ts`:
- Login attempts: 5 per 15 minutes
- API requests: Based on JWT scope
- Can be customized per endpoint

---

## 📖 Documentation

- **[API_ENDPOINTS.md](API_ENDPOINTS.md)** — Complete REST API reference
- **[DB_SCHEMA.md](DB_SCHEMA.md)** — Database tables and relationships
- **[REPLAY_PARSING.md](REPLAY_PARSING.md)** — How replays are processed
- **[REPLAY_ADMIN_DOCUMENTATION.md](REPLAY_ADMIN_DOCUMENTATION.md)** — Replay administration overview
- **[MATCH_DISPUTES_DOCUMENTATION.md](MATCH_DISPUTES_DOCUMENTATION.md)** — Match dispute handling overview
- **[BALANCE_EVENTS_DOCUMENTATION.md](BALANCE_EVENTS_DOCUMENTATION.md)** — Balance events and historical snapshots
- **[STATISTICS.md](STATISTICS.md)** — Statistics architecture and responsibilities
- **[LANGUAGE_FALLBACK_SYSTEM_EN.md](LANGUAGE_FALLBACK_SYSTEM_EN.md)** — i18n implementation
- **[START_HERE_EN.md](START_HERE_EN.md)** — Getting started guide
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Contribution guidelines

---

## Contributing

Contributions are welcome. Please:

1. Fork the project
2. Create a branch for your feature (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

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

See [DEPENDENCIES_AND_LICENSES.md](DEPENDENCIES_AND_LICENSES.md) for information about the licenses of all libraries used.

All dependencies are compatible with AGPL-3.0.

### Commercial License

If you need to use this software without AGPL requirements (for example, for a private service without sharing code), you can contact the authors to negotiate a commercial license.

---

## Contact

For questions or suggestions, use github issue tracker
