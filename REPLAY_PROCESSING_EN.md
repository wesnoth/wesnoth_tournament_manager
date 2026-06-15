# Replay Processing Pipeline

Technical reference for the automatic replay detection and match creation system.
Each section includes the exact source file, line numbers, and the relevant code block.

---

## Overview

The system automatically discovers, parses, and integrates Wesnoth game replays
into the tournament database. Two background jobs run in parallel:

| Job | Interval | Purpose |
|-----|----------|---------|
| `SyncGamesFromForumJob` | Every 60 s | Detects new games in the forum DB and queues them |
| `ParseNewReplaysRefactorized` | Every 30 s | Parses queued replays and creates match records |

---

## Source Files

| File | Role |
|------|------|
| `backend/src/jobs/syncGamesFromForum.ts` | Step 1 — Ranked addon detection, replay queue insertion |
| `backend/src/config/forumDatabase.ts` | SQL helpers against `wesnothd_game_*` tables |
| `backend/src/jobs/parseNewReplaysRefactored.ts` | Orchestrator — Steps 2–8, match creation |
| `backend/src/utils/replayRankedParser.ts` | WML parser — ranked_mode, players/factions, surrender, leaderkill |
| `backend/src/services/replayParser.ts` | Map/scenario extraction from WML |
| `backend/src/utils/assetValidator.ts` | Faction and map validation against `factions`/`game_maps` tables |

---

## Configuration

### WESNOTH_VERSION Environment Variable

The `WESNOTH_VERSION` environment variable controls which Wesnoth version branch(es) to monitor for replays. The system queries `wesnothd_game_info` for games matching the configured version(s).

**Syntax:**
- Single version: `WESNOTH_VERSION="1.18"` — Process games from the 1.18.x branch
- Multiple versions: `WESNOTH_VERSION="1.18|1.19"` — Process games from both 1.18.x and 1.19.x branches

**Examples:**
```env
# Monitor only Wesnoth 1.18 series (1.18.0, 1.18.1, 1.18.2, etc)
WESNOTH_VERSION="1.18"

# Monitor both 1.18 and 1.19 series
WESNOTH_VERSION="1.18|1.19"

# Monitor 1.18, 1.19, and 1.20 series
WESNOTH_VERSION="1.18|1.19|1.20"
```

**Storage:**
The base version (e.g., `"1.18"`) is extracted from the detailed INSTANCE_VERSION (e.g., `"1.18.0"`) and stored in `replays.wesnoth_version`. This allows filtering and grouping matches by version branch in the application.

---

## Step 1 — Ranked Addon Detection

**File:** `backend/src/jobs/syncGamesFromForum.ts`, lines 96–221  
**SQL helper:** `backend/src/config/forumDatabase.ts`, lines 180–205

Runs every 60 seconds. Queries `wesnothd_game_info` for games newer than
`replay_last_check_timestamp`, then processes each game:

```typescript
// syncGamesFromForum.ts:104–221

// The "Ranked" addon is used to mark games for auto-reporting.
// This includes both ranked global matches and tournament-specific matches.
const rankedAddonName = 'Ranked';

for (const game of gamesResult) {
  const instanceUuid = game.INSTANCE_UUID;
  const gameId = game.GAME_ID;

  // Track the latest game timestamp for updating sync checkpoint.
  // Do this for EVERY game, regardless of whether it has addon or is processed.
  const gameEndTime = new Date(game.end_time);
  if (gameEndTime > latestGameTimestamp) {
    latestGameTimestamp = gameEndTime;
  }

  // Check if game already exists in replays table
  const existsResult = await query(
    `SELECT id FROM replays WHERE instance_uuid = ? AND game_id = ?`,
    [instanceUuid, gameId]
  );
  if (existsResult && (existsResult as any).rows && (existsResult as any).rows.length > 0) {
    continue; // Skip silently if already processed
  }

  // Check if the "Ranked" addon is present in wesnothd_game_content_info
  const hasRankedAddon = await hasGameTournamentAddon(instanceUuid, gameId, rankedAddonName);
  if (!hasRankedAddon) {
    skippedWithoutAddon++;
    continue; // Skip silently if no addon (don't log to reduce noise)
  }

  // Get game players and check for duplicate nicknames
  const playersResult = await getGamePlayers(instanceUuid, gameId);
  const playerNicknames = playersResult.map((p: any) => p.username || p.name);
  const uniqueNicknames = new Set(playerNicknames);

  // If duplicate nicknames detected, skip this game (bot games, test games)
  if (uniqueNicknames.size !== playerNicknames.length) {
    console.log(`[FORUM SYNC] Skipped (duplicate nicknames): ${game.game_name}`);
    skippedDuplicateNicknames++;
    continue;
  }

  // Insert replay record with parse_status='new' for the parse job to pick up
  const replayId = uuidv4();
  const replayUrl = `https://replays.wesnoth.org/${game.wesnoth_version}/.../${game.replay_filename}`;

  await query(
    `INSERT INTO replays (id, instance_uuid, game_id, replay_filename, replay_url,
       wesnoth_version, game_name, start_time, end_time, oos, is_reload,
       integration_confidence, detected_from, replay_url,
       parse_status, parsed, need_integration, created_at, updated_at, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'forum', ?, 'new', 0, 1, NOW(), NOW(), NOW())`,
    [replayId, instanceUuid, gameId, game.replay_filename, replayUrl,
     game.wesnoth_version, game.game_name, game.start_time, game.end_time,
     oos, is_reload]
  );
}

// Update last check timestamp with the latest game's end_time
await this.updateLastCheckTimestamp(latestGameTimestamp);
```

SQL helper used to detect the addon (`forumDatabase.ts:180–205`):

```typescript
// forumDatabase.ts:180–205
export async function hasGameTournamentAddon(
  instanceUuid: string, gameId: number, addonId: string
): Promise<boolean> {
  const result = await forumQuery(
    `SELECT COUNT(*) as count FROM wesnothd_game_content_info
     WHERE INSTANCE_UUID = ? AND GAME_ID = ? AND ADDON_ID = ?`,
    [instanceUuid, gameId, addonId]
  );
  return (result as any).rows?.[0]?.count > 0;
}
```

**Conditions for skipping (no row inserted):**

| Condition | Action |
|-----------|--------|
| Already in `replays` (same `instance_uuid + game_id`) | Skip silently |
| No "Ranked" entry in `wesnothd_game_content_info` | Skip silently |
| Duplicate player nicknames in the same game | Skip with warning |

---

## Step 1b — Early Rejection During Parse

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 102–128

Before any forum queries, each dequeued replay is checked:

```typescript
// parseNewReplaysRefactored.ts:102–128

// Early exit: OOS replays are unreliable (game had sync errors)
if (replay.oos === 1) {
  if (replay.replay_filename.includes('Turn_1_')) {
    console.log(`[PARSE] OOS Turn_1 replay → Deleting`);
    await query(`DELETE FROM replays WHERE id = ?`, [replay.id]);
  } else {
    console.log(`[PARSE] OOS replay → Rejecting`);
    await query(
      `UPDATE replays SET parse_status = 'rejected', need_integration = 0, parsed = 1,
       parse_summary = ? WHERE id = ?`,
      [JSON.stringify({ matchType: 'rejected', reason: 'oos' }), replay.id]
    );
  }
  errorCount++;
  continue;
}

// Early exit: Turn_1 replays are too short to be valid — always delete
if (replay.replay_filename.includes('Turn_1_')) {
  console.log(`[PARSE] Turn_1 replay → Deleting (game too short)`);
  await query(`DELETE FROM replays WHERE id = ?`, [replay.id]);
  errorCount++;
  continue;
}
```

| Condition | Action |
|-----------|--------|
| `oos=1` + `Turn_1_` in filename | DELETE row |
| `oos=1` (not turn 1) | Set `parse_status='rejected'` |
| `Turn_1_` in filename (any OOS value) | DELETE row |

---

## Step 2 — Forum Player Query

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 299–319

```typescript
// parseNewReplaysRefactored.ts:299–319

// ======== STEP 2: Query forum for players, sides, factions ========
console.log(`[FORUM] Step 2: Querying players...`);
const playersResult = await query(
  `SELECT user_id, user_name, faction, side_number 
   FROM forum.wesnothd_game_player_info 
   WHERE instance_uuid = ? AND game_id = ?
     AND user_id != -1 AND user_id IS NOT NULL  -- exclude AI/bot slots
   ORDER BY side_number`,
  [replay.instance_uuid, replay.game_id]
);

if ((playersResult as any).rows?.length < 2) {
  console.log(`   Less than 2 players found in forum`);
  parseSummary.matchType = 'rejected';
  return parseSummary;
}

parseSummary.forumPlayers = (playersResult as any).rows;
for (const player of parseSummary.forumPlayers) {
  parseSummary.forumFactions[`side${player.side_number}`] = player.faction;
  console.log(`   Player: ${player.user_name} (Side ${player.side_number}, Faction: ${player.faction})`);
}
```

`user_id = -1` and `NULL` rows are AI/bot slots — excluded.  
The forum faction may be `"Custom"` when the player chose a custom faction; the actual name must then be extracted from WML in Step 5.3.

---

## Step 3 — Forum Map Query

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 321–335

```typescript
// parseNewReplaysRefactored.ts:321–335

// ======== STEP 3: Query forum for map/scenario ========
console.log(`[FORUM] Step 3: Querying map...`);
const mapResult = await query(
  `SELECT name FROM forum.wesnothd_game_content_info 
   WHERE instance_uuid = ? AND game_id = ? AND type = 'scenario' LIMIT 1`,
  [replay.instance_uuid, replay.game_id]
);

if ((mapResult as any).rows?.length > 0) {
  const forumMapFromDb = (mapResult as any).rows[0].name;
  const mapId = (mapResult as any).rows[0].id;
  const mapIdWithoutPrefix = mapId.startsWith('multiplayer_') ? mapId.substring(12) : mapId;
  
  // PRIORITY 1: For ladder_era/ranked_era, extract from scenario_id FIRST (most reliable)
  // The scenario_id (e.g., "multiplayer_Swamp_of_Dread_Ladder_Random") is more reliable
  // than the map name from the forum DB, which can suffer from encoding issues.
  if (scenarioId && (eraAddonId?.toLowerCase() === 'ladder_era' || eraAddonId?.toLowerCase() === 'ranked_era')) {
    const extractedName = extractMapNameFromScenarioId(scenarioId, eraAddonId);
    if (extractedName) {
      parseSummary.forumMap = extractedName;
      console.log(`   ✅ Extracted from scenario_id (ladder/ranked): "${extractedName}"`);
      console.log(`      (forum DB had: "${forumMapFromDb}")`);
    } else {
      parseSummary.forumMap = forumMapFromDb;
      console.log(`   ⚠️  Extraction from scenario_id failed, using forum name: "${forumMapFromDb}"`);
    }
  } else {
    // Not ladder/ranked era, use forum name directly
    parseSummary.forumMap = forumMapFromDb;
    console.log(`   ✅ Map: ${forumMapFromDb}`);
  }
  parseSummary.forumMapId = mapIdWithoutPrefix;
} else {
  // Fallback: use game_name when no scenario row exists in the forum
  parseSummary.forumMap = replay.game_name;
  console.log(`   ⚠️  No map in forum, using game_name: ${parseSummary.forumMap}`);
}
```

### 3.1 — Map Name Extraction from Scenario ID (Priority Strategy)

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 444–468

For replays using `ladder_era` or `ranked_era` addons, the map name is extracted directly from the scenario_id **as the primary strategy**, before using the map name from the forum DB. This is because:

1. **Structural reliability**: scenario_id is generated from WML structure and is not subject to encoding corruption
2. **Encoding issues**: Forum DB map names can suffer from Unicode/encoding corruption (e.g., Chinese characters, garbled text)
3. **Extraction reliability**: The scenario_id follows a predictable pattern that can be reliably parsed

**Extraction Rules:**

```typescript
// parseNewReplaysRefactored.ts:1484–1517

private extractMapNameFromScenarioId(scenarioId: string, addonId: string): string | null {
  if (!scenarioId) return null;
  
  let name = scenarioId;
  
  // Remove "multiplayer_" prefix
  name = name.replace(/^multiplayer_/i, '');
  
  // Remove suffix based on addon
  if (addonId?.toLowerCase() === 'ladder_era') {
    name = name.replace(/_Ladder_Random$/i, '');
  } else if (addonId?.toLowerCase() === 'ranked_era') {
    name = name.replace(/_Ranked_Random$/i, '');
  }
  
  // Replace underscores with spaces
  name = name.replace(/_/g, ' ');
  
  // Clean up multiple spaces
  name = name.replace(/\s+/g, ' ').trim();
  
  return name && name.length > 2 ? name : null;
}
```

**Example transformation:**
- `ladder_era` + `multiplayer_Swamp_of_Dread_Ladder_Random` → `Swamp of Dread`
- `ranked_era` + `multiplayer_4p_Isar_s_Cross_Ranked_Random` → `4p Isar's Cross`

This strategy recovers map names when forum DB entries are corrupted (e.g., due to Unicode/encoding issues).

---

## Step 4 — Custom Faction Flag

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 337–339

```typescript
// parseNewReplaysRefactored.ts:337–339

// ======== STEP 4: Check if forum factions are "Custom" =========
// When "Custom", the actual faction name must be extracted from the WML replay file
const hasCustomFaction = Object.values(parseSummary.forumFactions)
  .some(f => f.toLowerCase().includes('custom'));
```

When `hasCustomFaction = true`, WML extraction of factions is mandatory (see Step 5.3).

---

## Step 5 — WML Replay Parse

**File:** `backend/src/utils/replayRankedParser.ts`, entry point lines 92–174

The replay `.bz2` file is read from the local filesystem at:
```
/scratch/wesnothd-public-replays/{version}/{YYYY}/{MM}/{DD}/{filename}.bz2
```
A temporary copy is made in `.tmp/replays/`, parsed, then deleted.

### 5.0 — Decompression

**File:** `backend/src/utils/replayRankedParser.ts`, lines 181–224

```typescript
// replayRankedParser.ts:181–224
async function decompressReplay(replayPath: string): Promise<string> {
  const filename = path.basename(replayPath);
  const fileBuffer = fs.readFileSync(replayPath);
  let wmlText: string;

  // Detect format by file extension
  if (filename.endsWith('.bz2')) {
    // BZ2 decompression using bz2 module
    const bz2Module = await import('bz2');
    let decompress = bz2Module.decompress || bz2Module.default?.decompress;
    if (typeof decompress !== 'function') {
      throw new Error('bz2.decompress is not available');
    }
    const decompressedData = decompress(fileBuffer);
    wmlText = Buffer.from(decompressedData).toString('utf-8');
  } else if (filename.endsWith('.gz') || filename.endsWith('.rpy.gz')) {
    // GZIP decompression
    wmlText = zlib.gunzipSync(fileBuffer).toString('utf-8');
  } else {
    // Try direct read (uncompressed or unknown format)
    wmlText = fileBuffer.toString('utf-8');
  }

  return wmlText;
}
```

### 5.1 — `ranked_mode` and `tournament` Detection

**File:** `backend/src/utils/replayRankedParser.ts`, lines 308–381  
**Function:** `extractAddonConfig(wml)`

Searches three WML locations in priority order:

```typescript
// replayRankedParser.ts:308–381
function extractAddonConfig(wml: WmlNode): RankedAddonConfig {
  let rankedMode = false;
  let tournament = false;
  let tournamentName: string | undefined;

  // Strategy 1: Try [scenario] > [scenario_data]
  const scenario = wml.scenario as WmlNode | undefined;
  if (scenario) {
    const scenarioData = scenario['scenario_data'] as WmlNode | undefined;
    if (scenarioData) {
      rankedMode = scenarioData.ranked_mode === 'yes';
      tournament = scenarioData.tournament === 'yes';
      tournamentName = tournament
        ? (scenarioData.tournament_name as string | undefined)
        : undefined;
      return { ranked_mode: rankedMode, tournament, tournament_name: tournamentName };
    }
  }

  // Strategy 2: Try [carryover_sides_start] > [variables]  ← MOST COMMON
  // This is where addon state persists after turn 1 carryover
  const carryoverSidesStart = wml.carryover_sides_start as WmlNode | undefined;
  if (carryoverSidesStart) {
    const variables = carryoverSidesStart.variables as WmlNode | undefined;
    if (variables) {
      rankedMode = variables.ranked_mode === 'yes';
      tournament = variables.tournament === 'yes';
      tournamentName = tournament
        ? (variables.tournament_name as string | undefined)
        : undefined;
      if (rankedMode || tournament) {
        console.log(`[RANKED PARSE] Found addon config in [carryover_sides_start][variables]`);
        return { ranked_mode: rankedMode, tournament, tournament_name: tournamentName };
      }
    }
  }

  // Strategy 3: Try root-level scenario_data
  const rootScenarioData = wml['scenario_data'] as WmlNode | undefined;
  if (rootScenarioData) {
    rankedMode = rootScenarioData.ranked_mode === 'yes';
    tournament = rootScenarioData.tournament === 'yes';
    tournamentName = tournament
      ? (rootScenarioData.tournament_name as string | undefined)
      : undefined;
    return { ranked_mode: rankedMode, tournament, tournament_name: tournamentName };
  }

  // Fallback: No addon config found in WML.
  // The addon presence may have been confirmed at forum DB level but the
  // WML block is missing (e.g., game ended before addon state was written).
  console.warn('[RANKED PARSE] No addon config found in WML');
  return { ranked_mode: false, tournament: false, addon_found_at_forum: true };
}
```

| Strategy | WML path | When found |
|----------|----------|------------|
| 1 | `[scenario][scenario_data]` | Some older replay formats |
| 2 | `[carryover_sides_start][variables]` | **Most common** — persists after turn 1 |
| 3 | Root `[scenario_data]` | Edge cases |
| Fallback | — | Returns `ranked_mode=false`, sets `addon_found_at_forum=true` |

---

### 5.2 — Player / Faction Extraction from WML

**File:** `backend/src/utils/replayRankedParser.ts`, lines 388–562  
**Function:** `extractPlayers(wml)`

Only used when the forum reported `"Custom"` factions, or as a fallback if forum data is missing.
Tries four locations in priority order:

```typescript
// replayRankedParser.ts:396–428 — Attempt 1: [old_sideN] at WML root level
// These blocks are written directly in the root by the Ranked addon
let foundOldSides = false;
for (let sideNum = 1; sideNum <= 10; sideNum++) {
  const oldSideKey = `old_side${sideNum}`;
  const oldSide = wml[oldSideKey] as WmlNode | undefined; // ROOT level, not inside [scenario]
  if (!oldSide) { if (sideNum > 1) break; continue; }
  foundOldSides = true;
  const playerName = (oldSide['current_player'] as string) || `Player${sideNum}`;
  const faction = (oldSide['faction'] as string) || (oldSide['faction_name'] as string) || 'Unknown';
  players.push({ side: sideNum, name: playerName, faction });
  console.log(`   [old_side${sideNum}] ${playerName} (${faction})`);
}
if (foundOldSides) return players;
```

```typescript
// replayRankedParser.ts:430–480 — Attempt 2: [carryover_sides_start][variables][old_sideN]
// This is where they are stored after turn 1 carryover
const carryoverSidesStart = wml.carryover_sides_start as WmlNode | WmlNode[] | undefined;
const carryoverArray = Array.isArray(carryoverSidesStart)
  ? carryoverSidesStart
  : [carryoverSidesStart];

for (const carryoverNode of carryoverArray) {
  if (!carryoverNode) continue;
  const variablesNode = carryoverNode.variables as WmlNode | WmlNode[] | undefined;
  const variablesArray = Array.isArray(variablesNode) ? variablesNode : [variablesNode];
  for (const variables of variablesArray) {
    if (!variables) continue;
    for (let sideNum = 1; sideNum <= 10; sideNum++) {
      const oldSide = variables[`old_side${sideNum}`] as WmlNode | undefined;
      if (!oldSide) { if (sideNum > 1) break; continue; }
      foundOldSides = true;
      players.push({ side: sideNum,
        name: (oldSide['current_player'] as string) || `Player${sideNum}`,
        faction: (oldSide['faction'] as string) || (oldSide['faction_name'] as string) || 'Unknown'
      });
    }
    if (foundOldSides) return players;
  }
}
```

```typescript
// replayRankedParser.ts:486–521 — Attempt 3: [old_sideN] inside [scenario]
const scenario = wml.scenario as WmlNode | undefined;
if (scenario) {
  for (let sideNum = 1; sideNum <= 10; sideNum++) {
    const oldSide = scenario[`old_side${sideNum}`] as WmlNode | undefined;
    if (!oldSide) { if (sideNum > 1) break; continue; }
    foundOldSides = true;
    players.push({ side: sideNum,
      name: (oldSide['current_player'] as string) || `Player${sideNum}`,
      faction: (oldSide['faction'] as string) || (oldSide['faction_name'] as string) || 'Unknown'
    });
  }
  if (foundOldSides) return players;
}
```

```typescript
// replayRankedParser.ts:523–558 — Attempt 4 (last resort): [side] sections inside [scenario]
const sides = scenario?.side as WmlNode | WmlNode[] | undefined;
if (!sides) return [];
const sideArray = Array.isArray(sides) ? sides : [sides];
for (const side of sideArray) {
  const sideNum = parseInt(side.side as string) || players.length + 1;
  const leader = side.leader as WmlNode | undefined;
  if (leader) {
    players.push({ side: sideNum,
      name: (leader.name as string) || `Player${sideNum}`,
      faction: leader.type as string | undefined
    });
  }
}
return players;
```

| Attempt | WML path | Notes |
|---------|----------|-------|
| 1 | `[old_sideN]` at WML root | Primary path |
| 2 | `[carryover_sides_start][variables][old_sideN]` | After turn 1 carryover |
| 3 | `[scenario][old_sideN]` | Alternative structure |
| 4 | `[scenario][side][leader]` | Last resort |

---

### 5.3 — Surrender Detection

**File:** `backend/src/utils/replayRankedParser.ts`, lines 569–663  
**Function:** `extractSurrenders(wml, forumPlayers?)`

```typescript
// replayRankedParser.ts:577–650

// Get the last replay section if it's an array
// (the actual game replay is usually at the end when there are multiple sections)
const replayNode = wml.replay as WmlNode | WmlNode[] | undefined;
if (!replayNode) return [];
const replay = Array.isArray(replayNode) ? replayNode[replayNode.length - 1] : replayNode;

const commands = replay.command as WmlNode | WmlNode[] | undefined;
if (!commands) return [];
const commandArray = Array.isArray(commands) ? commands : [commands];

for (let i = 0; i < commandArray.length; i++) {
  const command = commandArray[i];
  const fireEvent = command.fire_event as WmlNode | undefined;

  // PATTERN 1: Old surrender pattern with fire_event + input
  if (fireEvent && fireEvent.raise === 'menu item surrender') {
    const fromSide = parseInt(command.from_side as string) || 0;

    // Look for next command: value=2 = confirmed surrender, value=1 = cancelled
    const nextCommand = commandArray[i + 1];
    if (nextCommand && nextCommand.input) {
      const inputValue = parseInt((nextCommand.input as any).value as string);
      const confirmed = inputValue === 2;
      surrenders.push({ side: fromSide, confirmed });
    }
  }

  // PATTERN 2: New surrender pattern with server speak message
  // Message format: "PlayerName has surrendered."
  const speak = command.speak as WmlNode | undefined;
  if (speak && typeof speak === 'object') {
    const message = speak.message as string | undefined;
    if (message && message.includes('has surrendered.')) {
      const surrenderMatch = message.match(/^(.+)\s+has\s+surrendered\.$/);
      if (surrenderMatch && forumPlayers) {
        const surrenderingPlayerName = surrenderMatch[1].trim();
        // Use forum players list to resolve the surrendering player's side number
        const surrenderingPlayer = forumPlayers.find(p => p.user_name === surrenderingPlayerName);
        if (surrenderingPlayer) {
          // Server message is always confirmed — no input confirmation needed
          surrenders.push({ side: surrenderingPlayer.side_number, confirmed: true });
        }
      }
    }
  }
}
```

| Pattern | WML structure | Confirmation logic |
|---------|---------------|-------------------|
| Classic | `[fire_event] raise="menu item surrender"` + next `[input]` | `value=2` = confirmed loss; `value=1` = cancelled |
| Server message | `[speak] message="PlayerName has surrendered."` | Always confirmed |

---

### 5.4 — Leaderkill Detection

**File:** `backend/src/utils/replayRankedParser.ts`, lines 670–717  
**Function:** `extractLeaderkills(wml)`

```typescript
// replayRankedParser.ts:670–717
function extractLeaderkills(wml: WmlNode): LeaderkillEvent[] {
  const replayNode = wml.replay as WmlNode | WmlNode[] | undefined;
  if (!replayNode) return [];
  const replay = Array.isArray(replayNode) ? replayNode[replayNode.length - 1] : replayNode;
  const commands = replay?.command as WmlNode | WmlNode[] | undefined;
  if (!commands) return [];
  const commandArray = Array.isArray(commands) ? commands : [commands];
  const leaderkills: LeaderkillEvent[] = [];

  // Scan from the end — leaderkill commands appear near the final turns.
  // Limit to last 50 commands to avoid scanning the entire replay.
  for (let i = commandArray.length - 1; i >= Math.max(0, commandArray.length - 50); i--) {
    const command = commandArray[i];
    if (command.dependent !== 'yes') continue;

    const fromSide = parseInt(command.from_side as string);
    if (!fromSide || fromSide < 1) continue;

    const inputNode = command.input as WmlNode | undefined;
    if (!inputNode) continue;
    const varNode = inputNode.variable as WmlNode | undefined;
    if (!varNode) continue;

    const varName = varNode.name as string | undefined;
    const varValue = parseInt(varNode.value as string);

    // Pattern: Winner_N variable where value equals the winning side number.
    // Example: name="Winner_2" value=2  →  side 2 won by leaderkill
    if (varName && varName.startsWith('Winner_')) {
      const winnerSideFromVar = parseInt(varName.split('_')[1]);
      if (winnerSideFromVar && varValue === winnerSideFromVar && varValue > 0) {
        console.log(`[EXTRACT LEADERKILLS] Leaderkill: side ${varValue} wins`);
        leaderkills.push({ winner_side: varValue });
      }
    }
  }

  return leaderkills;
}
```

WML pattern being matched:
```
[command] dependent=yes from_side=2
  [input]
    [variable] name="Winner_2" value=2 [/variable]
  [/input]
[/command]
```

The scan covers only the **last 50 commands** of the replay.
The **last** leaderkill event found is used as the definitive result.

---

## Step 5.5 — Victory Determination

**File:** `backend/src/utils/replayRankedParser.ts`, lines 726–864  
**Function:** `determineVictory(wml, players, surrenders, addon, forumPlayers?)`

```typescript
// replayRankedParser.ts:726–864
async function determineVictory(
  wml: WmlNode,
  players: Array<{ side: number; name: string; faction?: string }>,
  surrenders: SurrenderEvent[],
  addon: RankedAddonConfig,
  forumPlayers?: Array<{ side_number: number; user_name: string; faction: string }>
): Promise<ParsedRankedReplay['victory']> {

  // Check for confirmed surrenders first.
  // Forum data is the source of truth for side ↔ nickname mapping.
  for (const surrender of surrenders) {
    if (surrender.confirmed) {
      const loserSide = surrender.side;

      if (forumPlayers && forumPlayers.length > 0) {
        const loserData  = forumPlayers.find(p => p.side_number === loserSide);
        const winnerData = forumPlayers.find(p => p.side_number !== loserSide);

        if (loserData && winnerData) {
          const loserWml  = players.find(p => p.side === loserSide);
          const winnerWml = players.find(p => p.side !== loserSide);

          // Use faction from forum; fall back to WML if forum reported "Custom"
          const loserFaction  = (loserData.faction  !== 'Custom' && loserData.faction)
            ? loserData.faction  : loserWml?.faction;
          const winnerFaction = (winnerData.faction !== 'Custom' && winnerData.faction)
            ? winnerData.faction : winnerWml?.faction;

          return {
            winner_side: winnerData.side_number, loser_side: loserData.side_number,
            winner_name: winnerData.user_name,   loser_name:  loserData.user_name,
            winner_faction: winnerFaction,        loser_faction: loserFaction,
            reason: 'surrender',
            confidence_level: 2  // Clear victory by surrender
          };
        }
      }
    }
  }

  // No surrenders found — check for leaderkill victory pattern
  const leaderkills = extractLeaderkills(wml);
  if (leaderkills.length > 0) {
    const winnerSide = leaderkills[leaderkills.length - 1].winner_side; // use last event
    const loserSide  = winnerSide === 1 ? 2 : 1;

    const winnerData = forumPlayers?.find(p => p.side_number === winnerSide);
    const loserData  = forumPlayers?.find(p => p.side_number === loserSide);
    const winnerWml  = players.find(p => p.side === winnerSide);
    const loserWml   = players.find(p => p.side === loserSide);

    const winnerName    = winnerData?.user_name || winnerWml?.name || `Player${winnerSide}`;
    const loserName     = loserData?.user_name  || loserWml?.name  || `Player${loserSide}`;
    const winnerFaction = (winnerData?.faction && winnerData.faction !== 'Custom')
      ? winnerData.faction : winnerWml?.faction;
    const loserFaction  = (loserData?.faction  && loserData.faction  !== 'Custom')
      ? loserData.faction  : loserWml?.faction;

    console.log(`[VICTORY] Leaderkill: ${winnerName} (side ${winnerSide}) def ${loserName}`);
    return {
      winner_side: winnerSide, loser_side: loserSide,
      winner_name: winnerName,  loser_name: loserName,
      winner_faction: winnerFaction, loser_faction: loserFaction,
      reason: 'victory_conditions',
      confidence_level: 2  // Clear victory by leaderkill
    };
  }

  // No clear victory — needs player confirmation
  const player1 = players[0] || { side: 1, name: 'Player1' };
  const player2 = players[1] || { side: 2, name: 'Player2' };
  return {
    winner_side: player1.side, loser_side: player2.side,
    winner_name: player1.name, loser_name: player2.name,
    winner_faction: player1.faction, loser_faction: player2.faction,
    reason: 'unknown',
    confidence_level: 1  // Always confidence=1 for unclear victories
  };
}
```

| `victory.reason` | Source | `confidence_level` | Outcome |
|-----------------|--------|-------------------|---------|
| `surrender` | `extractSurrenders` | 2 | Match auto-created |
| `victory_conditions` | `extractLeaderkills` | 2 | Match auto-created |
| `unknown` | No clear event | 1 | Queued for player confirmation |

---

## Step 6 — Asset Validation (Factions and Map)

### Faction Resolution

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 793–842  
**Function:** `resolveFaction(factionName)`

```typescript
// parseNewReplaysRefactored.ts:793–842
private async resolveFaction(
  factionName: string | null
): Promise<{ name: string | null; isRanked: boolean }> {
  if (!factionName) return { name: null, isRanked: false };

  // Strategy 1: Exact case-insensitive match
  let result = await query(
    `SELECT name, is_ranked FROM factions WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [factionName]
  );
  if ((result as any).rows?.length > 0) {
    const faction = (result as any).rows[0];
    return { name: faction.name, isRanked: faction.is_ranked === 1 };
  }

  // Strategy 2: Strip first word (handles "Ladder Rebels" → "Rebels")
  const parts = factionName.split(' ').slice(1);
  if (parts.length > 0) {
    const searchName = parts.join(' ');
    result = await query(
      `SELECT name, is_ranked FROM factions WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [searchName]
    );
    if ((result as any).rows?.length > 0) {
      const faction = (result as any).rows[0];
      return { name: faction.name, isRanked: faction.is_ranked === 1 };
    }
  }

  // Strategy 3: LIKE partial match
  result = await query(
    `SELECT name, is_ranked FROM factions WHERE LOWER(name) LIKE LOWER(?) LIMIT 1`,
    [`%${factionName}%`]
  );
  if ((result as any).rows?.length > 0) {
    const faction = (result as any).rows[0];
    return { name: faction.name, isRanked: faction.is_ranked === 1 };
  }

  // Not found — return original name as-is, marked as unranked
  return { name: factionName, isRanked: false };
}
```

| Strategy | Query | Example |
|----------|-------|---------|
| 1 Exact | `LOWER(name) = LOWER(?)` | `"Rebels"` → `"Rebels"` |
| 2 Strip prefix | first word removed, exact | `"Ladder Rebels"` → `"Rebels"` |
| 3 LIKE | `LOWER(name) LIKE '%?%'` | partial match fallback |

### Map Resolution

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 844–946  
**Function:** `resolveMap(mapName)`

```typescript
// parseNewReplaysRefactored.ts:844–946
private async resolveMap(
  mapName: string | null
): Promise<{ name: string | null; isRanked: boolean }> {
  if (!mapName) return { name: null, isRanked: false };

  // Normalize typographic/smart quotes to plain ASCII equivalents.
  // This ensures forum strings like "Sulla\u2019s Ruins" match DB entries
  // stored as "Sulla's Ruins" (U+0027).
  const normalizeQuotes = (s: string) =>
    s.replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'")
     .replace(/[\u201c\u201d]/g, '"');
  const mapNameNorm = normalizeQuotes(mapName);

  // Helper: run a query and return ranked result immediately, or save as fallback.
  // Always prefers ranked entries — never stops early on an unranked match.
  let unrankedFallback: { name: string; isRanked: boolean } | null = null;
  const tryQuery = async (sql: string, params: any[]) => {
    const result = await query(sql, params);
    const rows = (result as any).rows || [];
    if (rows.length === 0) return null;
    const entry = { name: rows[0].name as string, isRanked: rows[0].is_ranked === 1 };
    if (entry.isRanked) return entry;           // ranked hit — use immediately
    if (!unrankedFallback) unrankedFallback = entry; // save first unranked as fallback
    return null;
  };

  // 1. Exact match on original name (ORDER BY is_ranked DESC — ranked rows first)
  let hit = await tryQuery(
    `SELECT name, is_ranked FROM game_maps WHERE LOWER(name) = LOWER(?) ORDER BY is_ranked DESC LIMIT 1`,
    [mapName]
  );
  if (hit) return hit;

  // 1b. Exact match with normalized quotes (handles U+2019 → U+0027 mismatch)
  if (mapNameNorm !== mapName) {
    hit = await tryQuery(
      `SELECT name, is_ranked FROM game_maps WHERE LOWER(name) = LOWER(?) ORDER BY is_ranked DESC LIMIT 1`,
      [mapNameNorm]
    );
    if (hit) return hit;
  }

  // 2. Strip numeric player-count prefix: "2p — Tombs of Kesorak" → "Tombs of Kesorak"
  const cleaned = mapName.replace(/^\d+[a-z]?\s*[—\-–\ufffd]\s*/i, '').trim();
  const cleanedNorm = normalizeQuotes(cleaned);
  if (cleaned !== mapName) {
    hit = await tryQuery(
      `SELECT name, is_ranked FROM game_maps WHERE LOWER(name) = LOWER(?) ORDER BY is_ranked DESC LIMIT 1`,
      [cleanedNorm]
    );
    if (hit) return hit;
  }

  // 3. LIKE on normalized map name
  hit = await tryQuery(
    `SELECT name, is_ranked FROM game_maps WHERE LOWER(name) LIKE LOWER(?) ORDER BY is_ranked DESC LIMIT 1`,
    [`%${mapNameNorm}%`]
  );
  if (hit) return hit;

  // 4. Fuzzy on prefix-stripped name: replace \uFFFD with % wildcard.
  // \uFFFD appears in forum strings with broken encoding mid-name.
  const fuzzyClean = cleanedNorm.replace(/\s*\ufffd\s*/g, '%').replace(/%+/g, '%');
  if (fuzzyClean !== cleanedNorm && cleaned !== mapName) {
    hit = await tryQuery(
      `SELECT name, is_ranked FROM game_maps WHERE LOWER(name) LIKE LOWER(?) ORDER BY is_ranked DESC LIMIT 1`,
      [fuzzyClean]
    );
    if (hit) return hit;
  }

  // 5. Fuzzy on raw map name (replace \uFFFD with %)
  const fuzzyRaw = mapNameNorm.replace(/\s*\ufffd\s*/g, '%').replace(/%+/g, '%');
  if (fuzzyRaw !== mapNameNorm) {
    hit = await tryQuery(
      `SELECT name, is_ranked FROM game_maps WHERE LOWER(name) LIKE LOWER(?) ORDER BY is_ranked DESC LIMIT 1`,
      [fuzzyRaw]
    );
    if (hit) return hit;
  }

  // No ranked result — return best unranked match or the raw input unchanged
  return unrankedFallback || { name: mapName, isRanked: false };
}
```

| Strategy | Example input | Example match |
|----------|--------------|---------------|
| 1 Exact | `"Rebels Camping"` | `"Rebels Camping"` |
| 1b Normalize quotes | `"Sulla\u2019s Ruins"` | `"Sulla's Ruins"` |
| 2 Strip prefix | `"2p — Tombs of Kesorak"` | `"Tombs of Kesorak"` |
| 3 LIKE | `"%camping%"` | `"Rebels Camping"` |
| 4/5 Fuzzy | `"Tombs\uFFFDKesorak"` → `"Tombs%Kesorak"` | `"Tombs of Kesorak"` |

---

## Step 7 — Match Type Classification

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 441–480

```typescript
// parseNewReplaysRefactored.ts:441–480

// ======== TOURNAMENT DETECTION VIA GAME_NAME ========
// If the WML addon block has no tournament field, check whether game_name
// matches the name of any currently in-progress tournament.
let gameNameMatchesTournament = false;
if (!parseSummary.replayTournament && replay.game_name) {
  const tournResult = await query(
    `SELECT id FROM tournaments
     WHERE status = 'in_progress'
       AND LOCATE(LOWER(name), LOWER(?)) > 0
     LIMIT 1`,
    [replay.game_name]
  );
  gameNameMatchesTournament = ((tournResult as any).rows || []).length > 0;
  if (gameNameMatchesTournament) {
    console.log(`   Game name "${replay.game_name}" matches an in-progress tournament`);
  }
}

// ======== DETERMINE MATCH TYPE ========
if (!parseSummary.forumAddon) {
  parseSummary.matchType = 'rejected';
  console.log(`   No Ranked addon in forum → REJECTED`);

} else if (parseSummary.replayTournament || gameNameMatchesTournament) {
  // Tournament check takes priority over generic ranked — check BEFORE ranked branch
  if (parseSummary.factionsAreRanked && parseSummary.mapIsRanked) {
    parseSummary.matchType = 'tournament_ranked';
    console.log(`   Tournament with ranked assets → TOURNAMENT_RANKED`);
  } else {
    parseSummary.matchType = 'tournament_unranked';
    console.log(`   Tournament with non-ranked assets → TOURNAMENT_UNRANKED`);
  }

} else if (parseSummary.replayRankedMode && parseSummary.factionsAreRanked && parseSummary.mapIsRanked) {
  // Generic ranked match (no tournament detected)
  parseSummary.matchType = 'ranked';
  console.log(`   ranked_mode=true, factions ranked, map ranked → RANKED`);

} else if (parseSummary.replayRankedMode && !parseSummary.factionsAreRanked && !parseSummary.mapIsRanked) {
  // Non-ranked assets with ranked addon and no tournament
  parseSummary.matchType = 'rejected';
  console.log(`   Assets not ranked and no tournament → REJECTED`);

} else {
  parseSummary.matchType = 'rejected';
  console.log(`   Cannot determine match type → REJECTED`);
}
```

| Condition | `matchType` |
|-----------|-------------|
| No Ranked addon in forum | `rejected` |
| `replayTournament` set OR `game_name` matches tournament + ranked assets | `tournament_ranked` |
| Same tournament condition + non-ranked assets | `tournament_unranked` |
| `ranked_mode=yes` + factions ranked + map ranked | `ranked` |
| `ranked_mode=yes` + assets not ranked + no tournament | `rejected` |
| Anything else | `rejected` |

Confidence level + outcome:

| `matchType` | `confidence_level` | `victory.reason` | Outcome |
|-------------|-------------------|-----------------|---------|
| `ranked` | 2 | `surrender` / `victory_conditions` | Match auto-created |
| `ranked` | 1 | `unknown` | `parse_status='parsed'`, waiting for player confirmation |
| `tournament_*` | any | any | `parse_status='parsed'`, waiting for player/organizer confirmation |
| `rejected` | — | — | `parse_status='rejected'`, no match |

---

## Step 8 — Tournament Linking

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 609–705  
**Function:** `linkToTournament(replay, parseSummary)`

Only called when `matchType = 'tournament_ranked'` or `'tournament_unranked'`.

```typescript
// parseNewReplaysRefactored.ts:609–705

// Find all in-progress tournaments whose name is a substring of the game_name.
// ORDER BY LENGTH(name) DESC → most specific (longest) match wins.
const tournamentResult = await query(
  `SELECT id, name, tournament_mode FROM tournaments
   WHERE status = 'in_progress'
     AND LOCATE(LOWER(name), ?) > 0
   ORDER BY LENGTH(name) DESC
   LIMIT 5`,
  [gameName]
);
const tournament = tournaments[0]; // Use the most specific match

// Ranked tournament requires ranked replay assets
if (tournament.tournament_mode === 'ranked' && parseSummary.matchType !== 'tournament_ranked') {
  console.log(`   Tournament is ranked but replay assets are not → reject`);
  return false;
}

// Verify both players are active approved participants in this tournament
const participantsResult = await query(
  `SELECT user_id FROM tournament_participants
   WHERE tournament_id = ?
     AND user_id IN (?, ?)
     AND status = 'active'
     AND participation_status = 'accepted'`,
  [tournament.id, winnerUser.id, loserUser.id]
);
if (participants.length < 2) {
  console.log(`   Not all players are active approved participants → reject`);
  return false;
}

// Find open tournament_round_match for this player pair in the current round
const roundMatchResult = await query(
  `SELECT trm.id, trm.player1_id, trm.player2_id
   FROM tournament_round_matches trm
   JOIN tournament_rounds tr ON trm.round_id = tr.id
   WHERE trm.tournament_id = ?
     AND trm.series_status = 'in_progress'
     AND tr.round_status = 'in_progress'
     AND (
       (trm.player1_id = ? AND trm.player2_id = ?)
       OR
       (trm.player1_id = ? AND trm.player2_id = ?)
     )
   LIMIT 1`,
  [tournament.id, winnerUser.id, loserUser.id, loserUser.id, winnerUser.id]
);
if (roundMatches.length === 0) {
  console.log(`   No open tournament_round_match for ${winnerName} vs ${loserName} → reject`);
  return false;
}

// Store links so createMatch() knows which tournament and series to update
parseSummary.linkedTournamentId           = tournament.id;
parseSummary.linkedTournamentRoundMatchId = roundMatch.id;
return true;
```

Failure conditions (any causes `REJECTED`):

| Check | Failure reason |
|-------|---------------|
| No in-progress tournament name matches `game_name` | Name mismatch |
| Tournament is `ranked` but replay assets are not | Asset mismatch |
| `winner` or `loser` not found in `users_extension` | Unknown players |
| Not both players `active` + `accepted` in tournament | Participation check failed |
| No open `tournament_round_match` for this player pair | No active series |

---

## Step 9 — Auto-registration

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 490–513  
**Function:** `ensurePlayersExist(forumPlayers)`

```typescript
// parseNewReplaysRefactored.ts:490–513
private async ensurePlayersExist(
  forumPlayers: Array<{ user_name: string; user_id?: number }>
): Promise<void> {
  for (const player of forumPlayers) {
    if (!player.user_name) continue;

    // Check if player already exists (case-insensitive nickname lookup)
    const existing = await query(
      `SELECT id FROM users_extension WHERE LOWER(nickname) = LOWER(?) LIMIT 1`,
      [player.user_name]
    );
    if (((existing as any).rows || []).length > 0) continue; // already registered

    // Auto-register new player with default ELO and unrated status
    const newId = uuidv4();
    await query(
      `INSERT INTO users_extension
         (id, nickname, is_active, is_rated, elo_rating, matches_played, total_wins, total_losses, created_at, updated_at)
       VALUES (?, ?, 1, 0, 1400, 0, 0, 0, NOW(), NOW())`,
      [newId, player.user_name]
    );
    console.log(`[PARSE] Auto-registered player: ${player.user_name} (id=${newId})`);
  }
}
```

New players are inserted with `elo_rating=1400` (default starting ELO) and `is_rated=0` (not yet rated).

---

## Step 10 — Match Creation

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 535–599  
**Delegates to:** `backend/src/services/matchCreationService.ts`

Only executed when `confidence_level = 2`.

```typescript
// parseNewReplaysRefactored.ts:570–599

const winnerFaction = parseSummary.resolvedFactions[`side${winnerForumData.side_number}`] || 'Unknown';
const loserFaction  = parseSummary.resolvedFactions[`side${loserForumData.side_number}`]  || 'Unknown';
const map = parseSummary.resolvedMap || 'Unknown';

// Build canonical replay URL from game metadata
const gameDate = new Date(replay.end_time);
const yyyy = gameDate.getFullYear();
const mm = String(gameDate.getMonth() + 1).padStart(2, '0');
const dd = String(gameDate.getDate()).padStart(2, '0');
const cleanFilename = replay.replay_filename.replace(/\.bz2$/, '');
const replayFilePath =
  `https://replays.wesnoth.org/${replay.wesnoth_version}/${yyyy}/${mm}/${dd}/${cleanFilename}.bz2`;

return createMatch({
  winnerId,  loserId,
  winnerFaction, loserFaction,
  map,
  winnerSide:                   winnerForumData.side_number,  // side_number from wesnothd_game_player_info
  replayRowId:                  replay.id,
  replayFilePath,
  matchType:                    parseSummary.matchType,
  linkedTournamentId:           parseSummary.linkedTournamentId,
  linkedTournamentRoundMatchId: parseSummary.linkedTournamentRoundMatchId,
  gameId:                       replay.game_id,
  wesnothVersion:               replay.wesnoth_version,
  instanceUuid:                 replay.instance_uuid,
});
```

After success, updates the `replays` row:
```sql
UPDATE replays
SET parse_status = 'completed', parsed = 1,
    integration_confidence = ?,
    tournament_id = ?, tournament_round_match_id = ?,
    match_id = ?, parse_summary = ?
WHERE id = ?
```

---

## File-not-found Retry Logic

**File:** `backend/src/jobs/parseNewReplaysRefactored.ts`, lines 208–233

```typescript
// parseNewReplaysRefactored.ts:208–233
if (errorMsg.includes('Replay file not found')) {
  const replayAge = Date.now() - new Date(replay.created_at).getTime();
  const ageHours = replayAge / (1000 * 60 * 60);

  if (ageHours < 12) {
    // Leave as 'new' so the next parse cycle will retry automatically
    await query(
      `UPDATE replays SET parse_error_message = ? WHERE id = ?`,
      [`File not found, waiting (${ageHours.toFixed(1)}h elapsed)`, replay.id]
    );
  } else {
    // 12 hours elapsed with no file — discard permanently
    await query(
      `UPDATE replays SET parse_status = 'rejected', parsed = 1, parse_error_message = ? WHERE id = ?`,
      [`File never appeared after ${ageHours.toFixed(1)}h — discarded`, replay.id]
    );
  }
}
```

---

## `parse_status` State Machine

```
new  ──► [syncGamesFromForum inserts row]
         [parseNewReplaysRefactorized picks it up]
             │
             ├── oos=1 + Turn_1_          → DELETE row
             ├── Turn_1_ in filename      → DELETE row
             ├── matchType = rejected     → rejected
             ├── tournament link fails    → rejected
             ├── confidence = 1           → parsed      (awaiting player/organizer confirmation)
             ├── confidence = 2           → completed   (match auto-created)
             └── unexpected exception     → error

CONFIRMATION TIMEOUT (via scheduler):
             
parsed  ──► (after REPLAY_AUTO_DISCARD_TIME days) ──► due   (confirmation period expired; download only, no actions)
              [scheduler.autoDiscardUnconfirmedReplays() runs daily]
```

**State Transitions:**
- `new` → stays `new` if file not found (retried every 30s for 12 hours)
- `parsed` → `due` after confirmation period expires (typically 30 days, configurable via `REPLAY_AUTO_DISCARD_TIME`)
- `due` replays: Players can download the replay file for offline review, but cannot confirm match or take other actions
- Admins can delete `due` replays through the admin replay management UI

---

## Key Database Columns

### `replays` table

| Column | Values | Description |
|--------|--------|-------------|
| `parse_status` | `new` / `parsed` / `completed` / `rejected` / `due` / `error` | Current processing state |
| `integration_confidence` | `0` / `1` / `2` | 0=unconfirmed, 1=needs player confirmation, 2=auto-confirmed |
| `parse_summary` | JSON | Full `ParseSummary` blob for debugging and confidence=1 display |
| `match_id` | UUID / NULL | Set when a match record is successfully created (confidence=2 only) |
| `tournament_id` | UUID / NULL | Set when linked to a tournament |
| `tournament_round_match_id` | UUID / NULL | Set when linked to a specific round series |

### `system_settings` table

| Key | Description |
|-----|-------------|
| `replay_last_check_timestamp` | Cursor for `syncGamesFromForum` — updated to the latest game `end_time` after each run |
| `replay_last_integration_timestamp` | Timestamp of the last successful auto-created match |
