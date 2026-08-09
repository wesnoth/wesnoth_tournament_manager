/**
 * Ranked Addon Replay Parser
 * File: backend/src/utils/replayRankedParser.ts
 * 
 * Purpose: Parse replays from Wesnoth's "Ranked" addon to extract:
 * 1. Ranked mode detection (ranked_mode="yes")
 * 2. Tournament linkage (tournament="yes/no")
 * 3. Tournament name (if tournament="yes")
 * 4. Surrender confirmations (fire_event + input)
 * 5. Faction information (if DB fetch fails)
 * 6. Victory determination with confidence level
 * 
 * Addon Configuration:
 * - ranked_mode="yes" → Ranked match
 * - tournament="no" → Global ranked only (confidence=2, auto-confirm)
 * - tournament="yes" → Specific tournament (confidence=1, pending, game_name=tournamentName)
 * 
 * Surrender Flow:
 * [fire_event] raise="menu item surrender"
 *   → [input] value=2 → ✅ CONFIRMED (player surrendered and lost)
 *   → [input] value=1 → ❌ REJECTED (player cancelled, game continues)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { getGamePlayers } from '../config/forumDatabase.js';

export interface RankedAddonConfig {
  ranked_mode: boolean;
  tournament: boolean;
  tournament_name?: string;
  addon_found_at_forum?: boolean; // Set to true if addon was confirmed in forum DB but not found in WML
}

export interface SurrenderEvent {
  side: number; // 1 or 2
  confirmed: boolean;
}

export interface LeaderkillEvent {
  winner_side: number; // side that won by killing the leader
}

export interface ParsedRankedReplay {
  // Addon configuration
  addon: RankedAddonConfig;
  
  // Validation: Is this truly ranked based on assets?
  isValidRanked: boolean; // false if assets aren't ranked-approved
  invalidReason?: string;
  
  // Participants
  players: Array<{
    side: number;
    name: string;
    faction?: string;
  }>;

  // Team information (for team tournaments)
  teams: Record<number, string>; // side_number → team_name from WML
  
  // Map selection (from ranked_map_picker addon)
  selectedMapName?: string; // Map name from [command][input][variable] when ranked_map_picker is used
  
  // Victory info
  victory: {
    winner_side: number;
    loser_side: number;
    winner_name: string;
    loser_name: string;
    winner_faction?: string;
    loser_faction?: string;
    reason: 'victory_conditions' | 'surrender' | 'timeout' | 'unknown';
    confidence_level: 1 | 2; // 2=auto-confirm (global ranked), 1=pending (tournament or invalid assets)
  };
  
  // Surrender details if applicable
  surrenders?: SurrenderEvent[];
  
  // Raw WML (for debugging)
  rawWml?: string;
}

export interface ParseReplayOptions {
  skipExtractPlayers?: boolean;
  forumPlayers?: Array<{
    side_number: number;
    user_name: string;
    faction: string;
  }>;
}

/**
 * Main function: Parse ranked replay from .wrz file or URL
 * Returns structured data ready for match creation
 */
export async function parseRankedReplay(
  replayPath: string,
  options?: ParseReplayOptions
): Promise<ParsedRankedReplay> {
  try {
    console.log(`🎬 [RANKED PARSE] Starting: ${path.basename(replayPath)}`);

    // Decompress .wrz file
    const wmlContent = await decompressReplay(replayPath);
    
    if (!wmlContent) {
      throw new Error('Failed to decompress replay file');
    }

    console.log(`📄 [RANKED PARSE] Decompressed ${wmlContent.length} bytes`);

    // Parse WML content
    const parsed = parseWml(wmlContent);
    
    console.log(`📊 [RANKED PARSE] Parsed WML structure keys:`, Object.keys(parsed).join(', '));
    
    // Debug: Check if carryover_sides_start exists
    if ((parsed as any).carryover_sides_start) {
      const carryoverKeys = Object.keys((parsed as any).carryover_sides_start).filter((k: string) => !k.startsWith('_'));
      console.log(`   carryover_sides_start contains: ${carryoverKeys.slice(0, 10).join(', ')}${carryoverKeys.length > 10 ? '...' : ''}`);
    }

    // Extract addon configuration
    const addon = extractAddonConfig(parsed);

    // Extract players and factions (skip if forum already validated)
    let players: Array<{ side: number; name: string; faction?: string }>;
    if (options?.skipExtractPlayers && options.forumPlayers) {
      console.log(`📋 [EXTRACT PLAYERS] Skipped (using forum players)`);
      // Convert forum players format to internal format
      players = options.forumPlayers.map(p => ({
        side: p.side_number,
        name: p.user_name,
        faction: p.faction
      }));
    } else {
      players = extractPlayers(parsed);
    }

    // Extract surrenders if any
    const surrenders = extractSurrenders(parsed, options?.forumPlayers);

    // Extract teams (for team tournaments)
    const teams = extractTeams(parsed);

    // Extract selected map name (for ranked_map_picker addon)
    const selectedMapName = extractSelectedMapName(parsed);

    // Determine victory
    // Pass forumPlayers as source of truth for side mapping
    const victory = await determineVictory(
      parsed, 
      players, 
      surrenders, 
      addon,
      options?.forumPlayers
    );

    const result: ParsedRankedReplay = {
      addon,
      isValidRanked: addon.ranked_mode, // Will be validated later by asset validator
      players,
      teams,
      selectedMapName,
      victory,
      surrenders: surrenders.length > 0 ? surrenders : undefined,
      rawWml: wmlContent.substring(0, 500) // Store first 500 chars for debugging
    };

    console.log(`✅ [RANKED PARSE] Success`);
    console.log(`   Mode: ${addon.ranked_mode ? 'Ranked' : 'Unknown'}`);
    console.log(`   Tournament: ${addon.tournament ? addon.tournament_name : 'None'}`);
    if (selectedMapName) {
      console.log(`   Selected Map: ${selectedMapName}`);
    }
    if (victory.reason === 'surrender') {
      console.log(`   Victory: ${victory.winner_name} def ${victory.loser_name} by ${victory.reason} (confidence: 2)`);
    } else {
      console.log(`   Victory: No clear winner (${victory.reason}, confidence: 1)`);
    }

    return result;

  } catch (error) {
    const errorMsg = (error as any)?.message || String(error);
    console.error(`❌ [RANKED PARSE] Failed:`, errorMsg);
    throw error;
  }
}

/**
 * Decompress .wrz file (bz2 or gz compressed)
 * Returns decompressed WML content as string
 * Uses same approach as replayParser.ts
 */
async function decompressReplay(replayPath: string): Promise<string> {
  try {
    const filename = path.basename(replayPath);
    const fileBuffer = fs.readFileSync(replayPath);
    console.log(`📥 [DECOMPRESS] File: ${filename}, Size: ${fileBuffer.length} bytes`);
    
    let wmlText: string;

    // Detect format by file extension
    if (filename.endsWith('.bz2')) {
      // BZ2 decompression using bz2 module
      console.log(`🔍 [DECOMPRESS] Detected BZ2 format, attempting decompression...`);
      const bz2Module = await import('bz2');
      let decompress = bz2Module.decompress || bz2Module.default?.decompress;
      
      if (!decompress && typeof bz2Module === 'function') {
        decompress = bz2Module;
      }

      if (typeof decompress !== 'function') {
        throw new Error('bz2.decompress is not available');
      }

      const decompressedData = decompress(fileBuffer);
      wmlText = Buffer.from(decompressedData).toString('utf-8');
      console.log(`✅ [DECOMPRESS] BZ2 decompressed successfully: ${wmlText.length} bytes`);
    } else if (filename.endsWith('.gz') || filename.endsWith('.rpy.gz')) {
      // GZIP decompression
      console.log(`🔍 [DECOMPRESS] Detected GZIP format`);
      wmlText = zlib.gunzipSync(fileBuffer).toString('utf-8');
      console.log(`✅ [DECOMPRESS] GZIP decompressed successfully: ${wmlText.length} bytes`);
    } else {
      // Try direct read (uncompressed or unknown format)
      console.log(`⚠️  [DECOMPRESS] Unknown format, attempting direct read`);
      wmlText = fileBuffer.toString('utf-8');
    }

    return wmlText;
  } catch (error) {
    const errorMsg = (error as any)?.message || String(error);
    console.error(`❌ [DECOMPRESS] Failed:`, errorMsg);
    throw new Error(`Failed to decompress replay: ${errorMsg}`);
  }
}

/**
 * Simple WML parser - converts WML to nested object structure
 * WML Format:
 *   [section]
 *     key=value
 *     [subsection]
 *       ...
 *     [/subsection]
 *   [/section]
 */
interface WmlNode {
  [key: string]: string | WmlNode | WmlNode[];
}

function asNodeArray(node: string | WmlNode | WmlNode[] | undefined): WmlNode[] {
  if (!node || typeof node === 'string') {
    return [];
  }

  return Array.isArray(node) ? node : [node];
}

function getOptionValueById(
  parent: WmlNode,
  optionId: string
): string | undefined {
  const options = asNodeArray(parent.option);
  const match = options.find(option => option.id === optionId);
  return typeof match?.value === 'string' ? match.value : undefined;
}

function extractRankedModificationConfig(
  container: WmlNode | undefined,
  locationLabel: string,
  fallbackTournamentName?: string
): RankedAddonConfig | null {
  if (!container) {
    return null;
  }

  const modifications = asNodeArray(container.modification);
  const rankedModification = modifications.find(modification => modification.id === 'ranked');

  if (!rankedModification) {
    return null;
  }

  const rankedModeValue = getOptionValueById(rankedModification, 'ranked_mode');
  const tournamentValue =
    getOptionValueById(rankedModification, 'tournament_mode') ??
    getOptionValueById(rankedModification, 'tournament');
  const tournamentName =
    getOptionValueById(rankedModification, 'tournament_name') ?? fallbackTournamentName;

  if (rankedModeValue === undefined && tournamentValue === undefined && !tournamentName) {
    return null;
  }

  const rankedMode = rankedModeValue === 'yes';
  const tournament = tournamentValue === 'yes';

  console.log(`✅ [RANKED PARSE] Found addon config in ${locationLabel}`);
  console.log(`   ranked_mode: ${rankedMode}, tournament: ${tournament}`);

  if (tournament && tournamentName && tournamentName === fallbackTournamentName) {
    console.log(`   ℹ️  Using root-level scenario field as tournament_name: "${tournamentName}"`);
  }

  return {
    ranked_mode: rankedMode,
    tournament,
    tournament_name: tournament ? tournamentName : undefined
  };
}

function parseWml(content: string): WmlNode {
  const lines = content.split('\n');
  const root: WmlNode = {};
  const stack: Array<{ key: string; node: WmlNode }> = [{ key: 'root', node: root }];

  let carryoverSidesStartFound = false;
  let variablesFound = false;
  let oldSideFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed || trimmed.startsWith('#')) {
      continue; // Skip empty lines and comments
    }

    // Opening section: [name]
    if (trimmed.startsWith('[') && !trimmed.startsWith('[/')) {
      const sectionName = trimmed.slice(1, -1);
      
      // Debug tracking
      if (sectionName === 'carryover_sides_start') carryoverSidesStartFound = true;
      if (sectionName === 'variables') variablesFound = true;
      if (sectionName.startsWith('old_side')) oldSideFound = true;
      
      const newNode: WmlNode = {};
      const current = stack[stack.length - 1].node;

      if (current[sectionName]) {
        // Section already exists, make it an array
        if (Array.isArray(current[sectionName])) {
          (current[sectionName] as WmlNode[]).push(newNode);
        } else {
          current[sectionName] = [current[sectionName] as WmlNode, newNode];
        }
      } else {
        current[sectionName] = newNode;
      }

      stack.push({ key: sectionName, node: newNode });
    }
    // Closing section: [/name]
    else if (trimmed.startsWith('[/')) {
      stack.pop();
    }
    // Key-value pair: key=value
    else if (trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim().replace(/^"(.*)"$/, '$1');
      const current = stack[stack.length - 1].node;
      current[key.trim()] = value;
    }
  }

  if (carryoverSidesStartFound) console.log(`   [parseWml] Found [carryover_sides_start]`);
  if (variablesFound) console.log(`   [parseWml] Found [variables]`);
  if (oldSideFound) console.log(`   [parseWml] Found [old_side*]`);

  return root;
}

/**
 * Extract addon configuration from WML
 * Looks for ranked_mode and tournament flags in multiple locations:
 * 1. [scenario] > [scenario_data]
 * 2. [carryover_sides_start] > [variables]
 * 3. Root level
 * 4. [options] > [modification id="ranked"] > [option]
 */
function extractAddonConfig(wml: WmlNode): RankedAddonConfig {
  try {
    let rankedMode = false;
    let tournament = false;
    let tournamentName: string | undefined;
    const rootScenario = typeof wml.scenario === 'string' ? wml.scenario : undefined;

    // Strategy 1: Try [scenario] > [scenario_data]
    const scenario = wml.scenario as WmlNode | undefined;
    if (scenario) {
      const scenarioData = scenario['scenario_data'] as WmlNode | undefined;
      if (scenarioData) {
        rankedMode = scenarioData.ranked_mode === 'yes';
        tournament = scenarioData.tournament === 'yes';
        tournamentName = tournament ? (scenarioData.tournament_name as string | undefined) : undefined;

        // Fallback to root-level scenario field if tournament=yes but no tournament_name
        // (only if scenario is actually an object, not a string)
        if (tournament && !tournamentName && typeof scenario === 'object') {
          if (rootScenario) {
            tournamentName = rootScenario;
            console.log(`   ℹ️  Using root-level scenario field as tournament_name: "${tournamentName}"`);
          }
        }

        return {
          ranked_mode: rankedMode,
          tournament,
          tournament_name: tournament ? tournamentName : undefined
        };
      }
    }

    // Strategy 2: Try [replay_start] > [variables]
    const replayStart = wml.replay_start as WmlNode | undefined;
    if (replayStart) {
      const variables = replayStart.variables as WmlNode | undefined;
      if (variables) {
        rankedMode = variables.ranked_mode === 'yes';
        tournament = variables.tournament === 'yes';
        tournamentName = tournament ? (variables.tournament_name as string | undefined) : undefined;

        if (rankedMode || tournament) {
          console.log(`✅ [RANKED PARSE] Found addon config in [replay_start][variables]`);
          console.log(`   ranked_mode: ${rankedMode}, tournament: ${tournament}`);
          
          // Fallback to root-level scenario field if tournament=yes but no tournament_name
          if (tournament && !tournamentName) {
            if (rootScenario) {
              tournamentName = rootScenario;
              console.log(`   ℹ️  Using root-level scenario field as tournament_name: "${tournamentName}"`);
            }
          }
          
          return {
            ranked_mode: rankedMode,
            tournament,
            tournament_name: tournament ? tournamentName : undefined
          };
        }
      }
    }

    // Strategy 3: Try [carryover_sides_start] > [variables]
    const carryoverSidesStart = wml.carryover_sides_start as WmlNode | undefined;
    if (carryoverSidesStart) {
      const variables = carryoverSidesStart.variables as WmlNode | undefined;
      if (variables) {
        rankedMode = variables.ranked_mode === 'yes';
        tournament = variables.tournament === 'yes';
        tournamentName = tournament ? (variables.tournament_name as string | undefined) : undefined;

        if (rankedMode || tournament) {
          console.log(`✅ [RANKED PARSE] Found addon config in [carryover_sides_start][variables]`);
          console.log(`   ranked_mode: ${rankedMode}, tournament: ${tournament}`);
          
          // Fallback to root-level scenario field if tournament=yes but no tournament_name
          if (tournament && !tournamentName) {
            if (rootScenario) {
              tournamentName = rootScenario;
              console.log(`   ℹ️  Using root-level scenario field as tournament_name: "${tournamentName}"`);
            }
          }
          
          return {
            ranked_mode: rankedMode,
            tournament,
            tournament_name: tournament ? tournamentName : undefined
          };
        }
      }
    }

    // Strategy 4: Try root-level scenario_data
    const rootScenarioData = wml['scenario_data'] as WmlNode | undefined;
    if (rootScenarioData) {
      rankedMode = rootScenarioData.ranked_mode === 'yes';
      tournament = rootScenarioData.tournament === 'yes';
      tournamentName = tournament ? (rootScenarioData.tournament_name as string | undefined) : undefined;

      // Fallback to root-level scenario field if tournament=yes but no tournament_name
      if (tournament && !tournamentName) {
        if (rootScenario) {
          tournamentName = rootScenario;
          console.log(`   ℹ️  Using root-level scenario field as tournament_name: "${tournamentName}"`);
        }
      }

      return {
        ranked_mode: rankedMode,
        tournament,
        tournament_name: tournament ? tournamentName : undefined
      };
    }

    // Strategy 5: Try [options] > [modification id="ranked"] > [option]
    const optionsConfig = extractRankedModificationConfig(
      wml.options as WmlNode | undefined,
      '[options][modification]',
      rootScenario
    );
    if (optionsConfig) {
      return optionsConfig;
    }

    // Strategy 6: Try [multiplayer] > [options] > [modification id="ranked"] > [option]
    const multiplayer = wml.multiplayer as WmlNode | undefined;
    const multiplayerOptionsConfig = extractRankedModificationConfig(
      multiplayer?.options as WmlNode | undefined,
      '[multiplayer][options][modification]',
      rootScenario
    );
    if (multiplayerOptionsConfig) {
      return multiplayerOptionsConfig;
    }

    // Fallback: No addon config found in WML
    // The addon presence may have been confirmed at forum DB level
    console.warn('⚠️  [RANKED PARSE] No addon config found in WML (checked [scenario][scenario_data], [replay_start][variables], [carryover_sides_start][variables], root [scenario_data], [options][modification], [multiplayer][options][modification])');
    return {
      ranked_mode: false,
      tournament: false,
      addon_found_at_forum: true // Flag to indicate it may be at forum database
    };
  } catch (error) {
    console.warn('⚠️  [RANKED PARSE] Error extracting addon config:', (error as any)?.message);
    return {
      ranked_mode: false,
      tournament: false
    };
  }
}

/**
 * Extract player names and factions from WML
 * Looks for [old_side1], [old_side2], [old_side3], [old_side4], etc. at ROOT level (not inside [scenario])
 * Falls back to [side] sections inside [scenario] if old_side not found
 */
function extractPlayers(wml: WmlNode): Array<{ side: number; name: string; faction?: string }> {
  try {
    const players: Array<{ side: number; name: string; faction?: string }> = [];

    // Debug: Log WML structure at top level
    const topLevelKeys = Object.keys(wml).filter(key => !key.startsWith('_'));
    console.log(`🔍 [EXTRACT PLAYERS] WML top-level keys: ${topLevelKeys.join(', ')}`);

    // First attempt: Look for [old_side1], [old_side2], [old_side3], [old_side4], etc. at ROOT level
    // These are OUTSIDE [scenario], directly in the WML root
    let foundOldSides = false;
    console.log(`🔍 [EXTRACT PLAYERS] Searching for old_side at ROOT level...`);
    for (let sideNum = 1; sideNum <= 10; sideNum++) {
      const oldSideKey = `old_side${sideNum}`;
      const oldSide = wml[oldSideKey] as WmlNode | undefined; // Search at ROOT level, not in scenario

      if (!oldSide) {
        // Stop when we don't find the next side
        if (sideNum > 1) {
          break;
        }
        continue;
      }

      foundOldSides = true;
      const playerName = (oldSide['current_player'] as string) || `Player${sideNum}`;
      const faction = (oldSide['faction'] as string) || (oldSide['faction_name'] as string) || 'Unknown';

      players.push({
        side: sideNum,
        name: playerName,
        faction
      });

      console.log(`   [old_side${sideNum}] ${playerName} (${faction})`);
    }

    if (foundOldSides) {
      console.log(`✅ [EXTRACT PLAYERS] Found ${players.length} players from old_side format (root level)`);
      return players;
    }

    // Fallback attempt 2: Look for [old_side*] inside [replay_start] > [variables]
    // This is where they are stored in some replays (e.g., early turns before carryover)
    console.log(`🔍 [EXTRACT PLAYERS] Searching in replay_start > variables...`);
    const replayStart = wml.replay_start as WmlNode | undefined;
    if (replayStart) {
      const variablesInReplayStart = replayStart.variables as WmlNode | WmlNode[] | undefined;
      const variablesArray = Array.isArray(variablesInReplayStart) ? variablesInReplayStart : [variablesInReplayStart];
      
      for (const variables of variablesArray) {
        if (!variables) continue;
        
        console.log(`   Found [variables] in replay_start, checking for old_side...`);
        for (let sideNum = 1; sideNum <= 10; sideNum++) {
          const oldSideKey = `old_side${sideNum}`;
          const oldSide = variables[oldSideKey] as WmlNode | undefined;

          if (!oldSide) {
            if (sideNum > 1) {
              break;
            }
            continue;
          }

          foundOldSides = true;
          const playerName = (oldSide['current_player'] as string) || `Player${sideNum}`;
          const faction = (oldSide['faction'] as string) || (oldSide['faction_name'] as string) || 'Unknown';

          players.push({
            side: sideNum,
            name: playerName,
            faction
          });

          console.log(`   [replay_start][variables][old_side${sideNum}] ${playerName} (${faction})`);
        }

        if (foundOldSides) {
          console.log(`✅ [EXTRACT PLAYERS] Found ${players.length} players from old_side format (replay_start > variables)`);
          return players;
        }
      }
    } else {
      console.log(`   No [replay_start] found in root`);
    }

    // Fallback attempt 3: Look for [old_side*] inside [carryover_sides_start] > [variables]
    // This is where they are stored after turn 1 carryover
    console.log(`🔍 [EXTRACT PLAYERS] Searching in carryover_sides_start > variables...`);
    const carryoverSidesStart = wml.carryover_sides_start as WmlNode | WmlNode[] | undefined;
    
    // Handle if carryover_sides_start is an array (multiple [carryover_sides_start] sections)
    const carryoverArray = Array.isArray(carryoverSidesStart) ? carryoverSidesStart : [carryoverSidesStart];
    
    for (const carryoverNode of carryoverArray) {
      if (!carryoverNode) continue;
      
      console.log(`   Found [carryover_sides_start], keys: ${Object.keys(carryoverNode).filter(k => !k.startsWith('_')).slice(0, 10).join(', ')}...`);
      
      // Handle if variables is an array
      const variablesNode = carryoverNode.variables as WmlNode | WmlNode[] | undefined;
      const variablesArray = Array.isArray(variablesNode) ? variablesNode : [variablesNode];
      
      for (const variables of variablesArray) {
        if (!variables) continue;
        
        console.log(`   Found [variables] in carryover, checking for old_side...`);
        for (let sideNum = 1; sideNum <= 10; sideNum++) {
          const oldSideKey = `old_side${sideNum}`;
          const oldSide = variables[oldSideKey] as WmlNode | undefined;

          if (!oldSide) {
            if (sideNum > 1) {
              break;
            }
            continue;
          }

          foundOldSides = true;
          const playerName = (oldSide['current_player'] as string) || `Player${sideNum}`;
          const faction = (oldSide['faction'] as string) || (oldSide['faction_name'] as string) || 'Unknown';

          players.push({
            side: sideNum,
            name: playerName,
            faction
          });

          console.log(`   [carryover_sides_start][variables][old_side${sideNum}] ${playerName} (${faction})`);
        }

        if (foundOldSides) {
          console.log(`✅ [EXTRACT PLAYERS] Found ${players.length} players from old_side format (carryover_sides_start > variables)`);
          return players;
        }
      }
    }
    
    if (!carryoverSidesStart) {
      console.log(`   No [carryover_sides_start] found in root`);
    }

    // Fallback attempt 4: Look for [old_side*] inside [scenario] (alternative structure)
    console.log(`🔍 [EXTRACT PLAYERS] Searching in scenario...`);
    const scenario = wml.scenario as WmlNode | undefined;
    if (scenario) {
      console.log(`   Found [scenario], searching for old_side...`);
      for (let sideNum = 1; sideNum <= 10; sideNum++) {
        const oldSideKey = `old_side${sideNum}`;
        const oldSide = scenario[oldSideKey] as WmlNode | undefined;

        if (!oldSide) {
          if (sideNum > 1) {
            break;
          }
          continue;
        }

        foundOldSides = true;
        const playerName = (oldSide['current_player'] as string) || `Player${sideNum}`;
        const faction = (oldSide['faction'] as string) || (oldSide['faction_name'] as string) || 'Unknown';

        players.push({
          side: sideNum,
          name: playerName,
          faction
        });

        console.log(`   [scenario][old_side${sideNum}] ${playerName} (${faction})`);
      }

      if (foundOldSides) {
        console.log(`✅ [EXTRACT PLAYERS] Found ${players.length} players from old_side format (inside scenario)`);
        return players;
      }
    } else {
      console.log(`   No [scenario] found in root`);
    }

    // Fallback: Look for [side] sections inside [scenario]
    console.log(`📋 [EXTRACT PLAYERS] old_side not found, trying [side] sections...`);
    
    if (!scenario) {
      console.warn('⚠️  [EXTRACT PLAYERS] No scenario found in WML');
      return [];
    }

    const sides = scenario.side as WmlNode | WmlNode[] | undefined;

    if (!sides) {
      console.warn('⚠️  [EXTRACT PLAYERS] No sides found in scenario');
      return [];
    }

    console.log(`📋 [EXTRACT PLAYERS] Found sides structure, type: ${Array.isArray(sides) ? 'array' : 'object'}`);

    const sideArray = Array.isArray(sides) ? sides : [sides];

    for (const side of sideArray) {
      const sideNum = parseInt(side.side as string) || players.length + 1;
      const leader = side.leader as WmlNode | undefined;

      if (leader) {
        const playerName = (leader.name as string) || `Player${sideNum}`;
        const faction = leader.type as string | undefined;

        players.push({
          side: sideNum,
          name: playerName,
          faction
        });
      }
    }

    return players;
  } catch (error) {
    console.warn('⚠️  [RANKED PARSE] Could not extract players:', error);
    return [];
  }
}

/**
 * Extract team information from [side] sections
 * For team tournaments, each side has a team_name attribute
 */
function extractTeams(wml: WmlNode): Record<number, string> {
  const teams: Record<number, string> = {};
  
  try {
    const scenario = wml.scenario as WmlNode | undefined;
    if (!scenario) {
      return teams;
    }

    const sides = scenario.side as WmlNode | WmlNode[] | undefined;
    if (!sides) {
      return teams;
    }

    const sideArray = Array.isArray(sides) ? sides : [sides];

    for (const side of sideArray) {
      const sideNum = parseInt(side.side as string) || 0;
      const teamName = side.team_name as string | undefined;

      if (sideNum > 0 && teamName) {
        teams[sideNum] = teamName;
      }
    }

    return teams;
  } catch (error) {
    console.warn('⚠️  [RANKED PARSE] Could not extract teams:', error);
    return teams;
  }
}

/**
 * Extract the map selected by ranked_map_picker.
 *
 * Replay layouts changed between Wesnoth versions: older replays put the
 * variable below replay commands, while newer ones may preserve it under a
 * variables/snapshot node. Walk the parsed WML tree instead of depending on
 * one command nesting shape.
 */
function extractSelectedMapName(wml: WmlNode): string | undefined {
  try {
    const visited = new Set<object>();
    const visit = (node: unknown): string | undefined => {
      if (!node || typeof node !== 'object') return undefined;
      if (visited.has(node as object)) return undefined;
      visited.add(node as object);

      if (Array.isArray(node)) {
        for (const child of node) {
          const found = visit(child);
          if (found) return found;
        }
        return undefined;
      }

      const record = node as Record<string, unknown>;
      const name = record.name;
      const value = record.value;
      if (typeof name === 'string' && name.toLowerCase() === 'selected_map_name' && value) {
        const mapName = String(value).trim();
        if (mapName) {
          console.log(`✅ [EXTRACT MAP] Found selected_map_name: "${mapName}"`);
          return mapName;
        }
      }

      const keyedValue = Object.entries(record).find(([key, entryValue]) =>
        key.toLowerCase() === 'selected_map_name' &&
        (typeof entryValue === 'string' || typeof entryValue === 'number')
      )?.[1];
      if (keyedValue !== undefined && keyedValue !== null) {
        const mapName = String(keyedValue).trim();
        if (mapName) {
          console.log(`✅ [EXTRACT MAP] Found selected_map_name: "${mapName}"`);
          return mapName;
        }
      }

      for (const child of Object.values(record)) {
        const found = visit(child);
        if (found) return found;
      }
      return undefined;
    };

    return visit(wml);
  } catch (error) {
    console.warn('⚠️  [EXTRACT MAP] Could not extract selected_map_name:', error);
    return undefined;
  }
}

/**
 * Extract surrender events from replay commands
 * Looks for fire_event with "menu item surrender" and subsequent input
 */
function extractSurrenders(
  wml: WmlNode,
  forumPlayers?: Array<{ side_number: number; user_name: string; faction: string }>
): SurrenderEvent[] {
  try {
    const surrenders: SurrenderEvent[] = [];
    
    // Handle if replay is an array (multiple [replay] sections) or single object
    const replayNode = wml.replay as WmlNode | WmlNode[] | undefined;
    if (!replayNode) {
      console.log(`ℹ️  [EXTRACT SURRENDERS] No [replay] section found`);
      return [];
    }

    // Get the last replay if it's an array (the actual game replay is usually at the end)
    const replay = Array.isArray(replayNode) ? replayNode[replayNode.length - 1] : replayNode;

    if (!replay) {
      console.log(`ℹ️  [EXTRACT SURRENDERS] No [replay] section found`);
      return [];
    }

    const commands = replay.command as WmlNode | WmlNode[] | undefined;
    if (!commands) {
      console.log(`ℹ️  [EXTRACT SURRENDERS] No [command] sections found in replay`);
      return [];
    }

    const commandArray = Array.isArray(commands) ? commands : [commands];
    console.log(`ℹ️  [EXTRACT SURRENDERS] Checking ${commandArray.length} commands for surrenders...`);

    for (let i = 0; i < commandArray.length; i++) {
      const command = commandArray[i];
      const fireEvent = command.fire_event as WmlNode | undefined;

      if (fireEvent) {
        console.log(`   [Command ${i}] Has fire_event, raise="${fireEvent.raise}"`);
      }

      // PATTERN 1: Old surrender pattern with fire_event + input
      if (fireEvent && fireEvent.raise === 'menu item surrender') {
        const fromSide = parseInt(command.from_side as string) || 0;
        console.log(`   >>> SURRENDER DETECTED (old pattern): from_side=${fromSide}`);

        // Look for next command with input value=2 (confirmed) or value=1 (rejected)
        const nextCommand = commandArray[i + 1];
        if (nextCommand && nextCommand.input) {
          const inputValue = parseInt((nextCommand.input as any).value as string);
          const confirmed = inputValue === 2;
          console.log(`   >>> Input found: value=${inputValue}, confirmed=${confirmed}`);

          surrenders.push({
            side: fromSide,
            confirmed
          });
        } else {
          console.log(`   >>> No input confirmation found in next command`);
        }
      }

      // PATTERN 2: New surrender pattern with server speak message
      // Message: "PlayerName has surrendered."
      const speak = command.speak as WmlNode | undefined;
      if (speak && typeof speak === 'object') {
        const message = speak.message as string | undefined;
        if (message && message.includes('has surrendered.')) {
          const surrenderMatch = message.match(/^(.+)\s+has\s+surrendered\.$/);
          if (surrenderMatch && forumPlayers) {
            const surrenderingPlayerName = surrenderMatch[1].trim();
            const surrenderingPlayer = forumPlayers.find(p => p.user_name === surrenderingPlayerName);
            
            if (surrenderingPlayer) {
              console.log(`   >>> SURRENDER DETECTED (server message): ${surrenderingPlayerName} (side ${surrenderingPlayer.side_number})`);
              surrenders.push({
                side: surrenderingPlayer.side_number,
                confirmed: true  // Server message is always confirmed
              });
            }
          }
        }
      }
    }

    if (surrenders.length > 0) {
      console.log(`✅ [EXTRACT SURRENDERS] Found ${surrenders.length} surrender(s)`);
    } else {
      console.log(`ℹ️  [EXTRACT SURRENDERS] No surrenders found`);
    }

    return surrenders;
  } catch (error) {
    console.warn('⚠️  [RANKED PARSE] Could not extract surrenders:', error);
    return [];
  }
}

/**
 * Extract leaderkill victories from replay commands.
 * Pattern: [command] dependent=yes from_side=N [input][variable] name="Winner_N" value=N [/variable][/input] [/command]
 * This is emitted near the end of the replay when a player's leader is killed.
 */
function extractLeaderkills(wml: WmlNode): LeaderkillEvent[] {
  try {
    const replayNode = wml.replay as WmlNode | WmlNode[] | undefined;
    if (!replayNode) return [];

    const replay = Array.isArray(replayNode) ? replayNode[replayNode.length - 1] : replayNode;
    if (!replay) return [];

    const commands = replay.command as WmlNode | WmlNode[] | undefined;
    if (!commands) return [];

    const commandArray = Array.isArray(commands) ? commands : [commands];
    const leaderkills: LeaderkillEvent[] = [];

    // Scan from the end — leaderkill commands appear near the final turns
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

      // Pattern: Winner_N variable where value equals the winning side
      // Example: Winner_2 with value=2 means side 2 won
      if (varName && varName.startsWith('Winner_')) {
        const winnerSideFromVar = parseInt(varName.split('_')[1]);
        if (winnerSideFromVar && varValue === winnerSideFromVar && varValue > 0) {
          console.log(`✅ [EXTRACT LEADERKILLS] Leaderkill detected: side ${varValue} wins (command ${i}, from_side=${fromSide})`);
          leaderkills.push({ winner_side: varValue });
        }
      }
    }

    return leaderkills;
  } catch (error) {
    console.warn('⚠️  [RANKED PARSE] Could not extract leaderkills:', error);
    return [];
  }
}

/**
 * Determine victory from WML data
 * Checks for:
 * 1. Confirmed surrenders (clarity dictates surrender = loss)
 * 2. Leaderkill (Winner_N variable command near end of replay)
 * 3. Timeout/other conditions
 */
async function determineVictory(
  wml: WmlNode,
  players: Array<{ side: number; name: string; faction?: string }>,
  surrenders: SurrenderEvent[],
  addon: RankedAddonConfig,
  forumPlayers?: Array<{
    side_number: number;
    user_name: string;
    faction: string;
  }>
): Promise<ParsedRankedReplay['victory']> {
  try {
    // Check for confirmed surrenders first (forum is source of truth for side ↔ nickname mapping)
    for (const surrender of surrenders) {
      if (surrender.confirmed) {
        const loserSide = surrender.side;
        
        // Get information from forum if available (forum is ALWAYS source of truth)
        let loserName: string | undefined;
        let winnerName: string | undefined;
        let loserFaction: string | undefined;
        let winnerFaction: string | undefined;
        
        if (forumPlayers && forumPlayers.length > 0) {
          // Use forum as source of truth for side mapping
          const loserData = forumPlayers.find(p => p.side_number === loserSide);
          const winnerData = forumPlayers.find(p => p.side_number !== loserSide);
          
          if (loserData && winnerData) {
            loserName = loserData.user_name;
            winnerName = winnerData.user_name;
            
            // Use faction from forum first, fallback to WML if "Custom"
            const loserWml = players.find(p => p.side === loserSide);
            const winnerWml = players.find(p => p.side !== loserSide);
            
            loserFaction = (loserData.faction !== 'Custom' && loserData.faction) ? loserData.faction : loserWml?.faction;
            winnerFaction = (winnerData.faction !== 'Custom' && winnerData.faction) ? winnerData.faction : winnerWml?.faction;
            
            // Show which source we're using
            if (loserData.faction === 'Custom') {
              console.log(`   [SURRENDER] Side ${loserSide} (${loserName}): forum='Custom' → using WML: ${loserFaction}`);
            } else {
              console.log(`   [SURRENDER] Side ${loserSide} (${loserName}): ${loserFaction} (from forum)`);
            }
            
            return {
              winner_side: winnerData.side_number,
              loser_side: loserData.side_number,
              winner_name: winnerName || `Player${winnerData.side_number}`,
              loser_name: loserName || `Player${loserData.side_number}`,
              winner_faction: winnerFaction,
              loser_faction: loserFaction,
              reason: 'surrender',
              confidence_level: 2  // Clear victory by surrender
            };
          }
        }
        
        // Fallback to parsed replay data if forum lookup failed
        const loser = players.find(p => p.side === loserSide);
        const winner = players.find(p => p.side !== loserSide);
        
        if (winner && loser) {
          return {
            winner_side: winner.side,
            loser_side: loser.side,
            winner_name: winner.name || `Player${winner.side}`,
            loser_name: loser.name || `Player${loser.side}`,
            winner_faction: winner.faction,
            loser_faction: loser.faction,
            reason: 'surrender',
            confidence_level: 2  // Clear victory by surrender
          };
        }
      }
    }

    // No clear victory found (no surrenders)
    // Check for leaderkill victory pattern
    const leaderkills = extractLeaderkills(wml);
    if (leaderkills.length > 0) {
      const winnerSide = leaderkills[leaderkills.length - 1].winner_side; // use last one
      const loserSide = winnerSide === 1 ? 2 : 1;

      const winnerData = forumPlayers?.find(p => p.side_number === winnerSide);
      const loserData  = forumPlayers?.find(p => p.side_number === loserSide);
      const winnerWml  = players.find(p => p.side === winnerSide);
      const loserWml   = players.find(p => p.side === loserSide);

      const winnerName    = winnerData?.user_name || winnerWml?.name || `Player${winnerSide}`;
      const loserName     = loserData?.user_name  || loserWml?.name  || `Player${loserSide}`;
      const winnerFaction = (winnerData?.faction && winnerData.faction !== 'Custom') ? winnerData.faction : winnerWml?.faction;
      const loserFaction  = (loserData?.faction  && loserData.faction  !== 'Custom') ? loserData.faction  : loserWml?.faction;

      console.log(`✅ [VICTORY] Leaderkill: ${winnerName} (side ${winnerSide}) def ${loserName} (side ${loserSide})`);
      return {
        winner_side: winnerSide,
        loser_side: loserSide,
        winner_name: winnerName,
        loser_name: loserName,
        winner_faction: winnerFaction,
        loser_faction: loserFaction,
        reason: 'victory_conditions',
        confidence_level: 2  // Clear victory by leaderkill
      };
    }

    // Return unknown reason with confidence=1 (needs player confirmation)
    const player1 = players[0] || { side: 1, name: 'Player1' };
    const player2 = players[1] || { side: 2, name: 'Player2' };

    return {
      winner_side: player1.side,
      loser_side: player2.side,
      winner_name: player1.name || `Player${player1.side}`,
      loser_name: player2.name || `Player${player2.side}`,
      winner_faction: player1.faction,
      loser_faction: player2.faction,
      reason: 'unknown',
      confidence_level: 1  // Always confidence=1 for unclear victories
    };

  } catch (error) {
    console.warn('⚠️  [RANKED PARSE] Could not determine victory:', error);

    // Ultimate fallback - unclear victory
    return {
      winner_side: 1,
      loser_side: 2,
      winner_name: players[0]?.name || 'Player1',
      loser_name: players[1]?.name || 'Player2',
      winner_faction: players[0]?.faction,
      loser_faction: players[1]?.faction,
      reason: 'unknown',
      confidence_level: 1  // Always confidence=1 for unclear victories
    };
  }
}

export default parseRankedReplay;
