/**
 * Service: Replay Parser (WML Analysis)
 * File: backend/src/services/replayParser.ts
 * 
 * Purpose: Parse Wesnoth replay files (.rpy.gz) and extract match data
 * 
 * Two-stage parsing strategy:
 * Stage 1 (Quick): Decompress and find tournament addon (< 1 second)
 * Stage 2 (Full): Extract all match data - players, factions, map, winner (1-10 seconds)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as pako from 'pako'; // For gzip decompression
import { query } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

interface WMLNode {
    [key: string]: any;
}

interface ReplayAnalysis {
    metadata: {
        version: string;
        scenario_id: string;
        scenario_name: string;
        map_file: string;
        era_id: string;
    };
    addons: Array<{
        id: string;
        version: string;
        required: boolean;
    }>;
    players: Array<{
        side: number;
        name: string;
        faction_id: string;
        faction_name: string;
        leader_id: string;
        leader_type: string;
        controller: string;
    }>;
    victory: {
        winner_side: number;
        winner_name: string;
        result_type: string;
        detected_from: string;
        confidence_level: 1 | 2; // 1=manual_confirm_needed, 2=auto_report
    };
    timestamp: Date;
}

interface QuickAddonCheckResult {
    has_tournament_addon: boolean;
    tournament_addon_id: string | null;
    version: string;
    era_id: string;
}

export class ReplayParser {
    private readonly tournamentAddonFilter: string;

    constructor(
        tournamentAddonFilter: string = process.env.REPLAY_ADDON_FILTER || 'tournament-addon'
    ) {
        this.tournamentAddonFilter = tournamentAddonFilter;
    }

    /**
     * Decompress replay file based on extension
     * Supports both .bz2 and .gz formats
     */
    private async decompressReplay(replayPath: string): Promise<string> {
        const filename = path.basename(replayPath);
        const fileBuffer = fs.readFileSync(replayPath);
        let wmlText: string;

        try {
            // Detect format by file extension
            if (filename.endsWith('.bz2')) {
                // BZ2 decompression
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
            } else {
                // GZIP decompression (default for .gz, .rpy.gz, etc.)
                const decompressed = pako.inflate(fileBuffer, { to: 'string' });
                wmlText = decompressed;
            }

            return wmlText;
        } catch (error) {
            const errorMsg = (error as any)?.message || String(error);
            throw new Error(
                `Failed to decompress replay file (${filename}): ${errorMsg}. ` +
                `File may be corrupted or not in a supported format (.bz2 or .gz).`
            );
        }
    }

    /**
     * Stage 1: Quick Addon Check (< 1 second)
     * 
     * Decompress and search for tournament addon UUID.
     * Returns boolean and addon ID for fast filtering.
     */
    public async quickAddonCheck(replayPath: string): Promise<QuickAddonCheckResult> {
        const startTime = Date.now();

        try {
            // Verify file exists and is readable
            if (!fs.existsSync(replayPath)) {
                throw new Error(`Replay file not found: ${replayPath}`);
            }

            // Decompress replay file (auto-detects .bz2 or .gz)
            const wmlText = await this.decompressReplay(replayPath);

            // Parse WML to find addons section
            // Use simple regex for speed (avoids full WML parsing)
            const addonsMatch = wmlText.match(/\[addon\]([\s\S]*?)\[\/addon\]/g);
            let hasTournamentAddon = false;
            let tournamentAddonId: string | null = null;
            let version = '';
            let eraId = '';

            // Extract version
            const versionMatch = wmlText.match(/version="([^"]+)"/);
            version = versionMatch ? versionMatch[1] : 'unknown';

            // Extract era_id
            const eraMatch = wmlText.match(/era\s*=\s*"([^"]+)"/);
            eraId = eraMatch ? eraMatch[1] : '';

            // Check for tournament addon
            if (addonsMatch) {
                for (const addonBlock of addonsMatch) {
                    if (addonBlock.includes(this.tournamentAddonFilter)) {
                        hasTournamentAddon = true;
                        // Extract addon ID
                        const idMatch = addonBlock.match(/id=\s*"([^"]+)"/);
                        tournamentAddonId = idMatch ? idMatch[1] : this.tournamentAddonFilter;
                        break;
                    }
                }
            }

            const duration = Date.now() - startTime;

            console.log(`Stage 1 Quick Addon Check: ${path.basename(replayPath)}`, {
                duration_ms: duration,
                has_tournament_addon: hasTournamentAddon,
                version,
                era_id: eraId
            });

            return {
                has_tournament_addon: hasTournamentAddon,
                tournament_addon_id: tournamentAddonId,
                version,
                era_id: eraId
            };

        } catch (error) {
            const errorMsg = (error as any)?.message || String(error);
            console.error(
                `Stage 1 Quick Check failed for ${path.basename(replayPath)}: ${errorMsg}`
            );
            throw error;
        }
    }

    /**
     * Stage 2: Full Replay Analysis (1-10 seconds)
     * 
     * Complete WML parsing and extraction of match data.
     */
    public async fullReplayParse(replayPath: string): Promise<ReplayAnalysis> {
        const startTime = Date.now();

        try {
            // Decompress replay file (auto-detects .bz2 or .gz)
            const wmlText = await this.decompressReplay(replayPath);

            // Parse WML structure (simplified parser for key sections)
            const wmlRoot = this.parseWML(wmlText);

            // Extract metadata (pass wmlText for direct WML search)
            const metadata = this.extractMetadata(wmlRoot, wmlText);

            // VALIDATION: Check if this is a real match (not map selection/preview)
            const validationError = this.validateReplayIsRealMatch(wmlRoot, metadata);
            if (validationError) {
                console.log(`ℹ️  [DISCARD] ${path.basename(replayPath)}: ${validationError}`);
                throw new Error(`DISCARD: ${validationError}`);
            }

            // Extract addons
            const addons = this.extractAddons(wmlRoot);

            // Extract players
            const players = this.extractPlayers(wmlRoot);

            // Determine victory
            let victory = this.determineVictory(wmlRoot, players, wmlText);

            // FALLBACK: Extract faction information from WML using proven frontend logic
            const hasUnknownFactions = players.some((p: any) => 
                p.faction_name === 'Unknown' || p.faction_name === 'Custom'
            );
            
            if (hasUnknownFactions) {
                const factionByPlayer = this.extractFactionInfoFromWML(wmlText, players);
                
                // Apply faction enrichment to players
                for (const player of players) {
                    if ((player.faction_name === 'Unknown' || player.faction_name === 'Custom') && factionByPlayer.has(player.name)) {
                        const newFaction = factionByPlayer.get(player.name)!;
                        player.faction_name = newFaction;
                        player.faction_id = newFaction.toLowerCase();
                    }
                }
                
                // Try to detect surrender victory
                const surrenderVictory = this.detectSurrenderVictory(wmlRoot, players, wmlText);
                if (surrenderVictory.detected && surrenderVictory.winner_side) {
                    const winner = players.find((p: any) => p.side === surrenderVictory.winner_side);
                    victory = {
                        winner_side: surrenderVictory.winner_side,
                        winner_name: winner?.name || `Player ${surrenderVictory.winner_side}`,
                        result_type: 'surrender',
                        detected_from: 'server_surrender_message',
                        confidence_level: 2 as const // AUTO: Clear surrender via server message
                    };
                }
            }

            const duration = Date.now() - startTime;

            console.log(`Stage 2 Full Parse completed: ${path.basename(replayPath)}`, {
                duration_ms: duration,
                players_count: players.length,
                winner_side: victory.winner_side
            });

            return {
                metadata,
                addons,
                players,
                victory,
                timestamp: new Date()
            };

        } catch (error) {
            console.error(
                `Stage 2 Full Parse failed for ${path.basename(replayPath)}`,
                error
            );
            throw error;
        }
    }

    /**
     * Parse WML structure (simplified implementation)
     * 
     * Real implementation would use a proper WML parser.
     * This is a basic extraction for demonstration.
     */
    private parseWML(wmlText: string): WMLNode {
        const result: WMLNode = {};

        // Extract version
        const versionMatch = wmlText.match(/version="([^"]+)"/);
        result.version = versionMatch ? versionMatch[1] : 'unknown';

        // Extract scenario section - IMPORTANT: Handle game reloads where [scenario] appears multiple times
        // ALWAYS take the LAST (most recent) [scenario] block for post-reload state
        let lastScenarioMatch: RegExpMatchArray | null = null;
        const scenarioRegex = /\[scenario\]([\s\S]*?)\[\/scenario\]/g;
        
        for (const match of wmlText.matchAll(scenarioRegex)) {
            lastScenarioMatch = match as RegExpMatchArray;
        }
        
        if (lastScenarioMatch) {
            const scenarioContent = lastScenarioMatch[1];
            result.scenario = this.parseSection(scenarioContent);
            
            // Extract name/scenario - can be named scenario, name, or mp_scenario_name
            // Try multiple field names as different Wesnoth versions use different conventions
            const scenarioMatch2 = scenarioContent.match(/scenario\s*=\s*"([^"]+)"/);
            const nameMatch = scenarioContent.match(/name\s*=\s*"([^"]+)"/);
            const idMatch = scenarioContent.match(/id\s*=\s*"([^"]+)"/);
            
            if (scenarioMatch2) result.scenario.scenario = scenarioMatch2[1];
            if (nameMatch) result.scenario.name = nameMatch[1];
            if (idMatch) result.scenario.id = idMatch[1];
        }

        // Extract side sections (players) - Handle reload/pause cases where [side] appears multiple times
        // IMPORTANT: After game reload/pause, [side] blocks can appear multiple times for same side#
        // We ALWAYS take the LAST occurrence of each side number (most recent state)
        result.sides = [];
        const sideRegex = /\[side\]([\s\S]*?)\[\/side\]/g;
        const sidesByNumber = new Map<number, {data: WMLNode, fileOrder: number}>();
        let sideCount = 0;
        
        // First pass: collect all [side] blocks indexed by side number
        for (const match of wmlText.matchAll(sideRegex)) {
            sideCount++;
            const sideData = this.parseSection(match[1]);
            const sideNum = parseInt(sideData.side || '0', 10);
            
            if (sideNum > 0) {
                // Always overwrite with newer occurrence (later in file = after reload)
                sidesByNumber.set(sideNum, {
                    data: sideData,
                    fileOrder: sideCount  // Track which occurrence this was
                });
            }
        }
        
        // Convert to array sorted by side number
        result.sides = Array.from(sidesByNumber.entries())
            .sort((a, b) => a[0] - b[0])  // Sort by side number
            .map(([sideNum, entry]) => ({...entry.data, side: sideNum}));
        
        // Log reload detection if found - process silently
        if (sideCount > result.sides.length) {
            // Replay has reload/pause detected, but continue processing
        }

        // Extract endlevel (victory condition)
        const endlevelMatch = wmlText.match(/\[endlevel\]([\s\S]*?)\[\/endlevel\]/);
        if (endlevelMatch) {
            result.endlevel = this.parseSection(endlevelMatch[1]);
        }

        // Extract addons
        result.addons = [];
        const addonMatches = wmlText.matchAll(/\[addon\]([\s\S]*?)\[\/addon\]/g);
        for (const match of addonMatches) {
            result.addons.push(this.parseSection(match[1]));
        }

        // Extract era
        const eraMatch = wmlText.match(/era\s*=\s*"([^"]+)"/);
        result.era_id = eraMatch ? eraMatch[1] : '';

        return result;
    }

    /**
     * Parse a WML section into key-value pairs
     * Handles various key formats: word chars, underscores, dots
     */
    private parseSection(content: string): WMLNode {
        const result: WMLNode = {};

        // Extract key="value" pairs - supports word chars, underscores, dots in keys
        const kvMatches = content.matchAll(/([\w._-]+)\s*=\s*"([^"]*)"/g);
        for (const match of kvMatches) {
            result[match[1]] = match[2];
        }

        return result;
    }

    /**
     * Extract metadata from WML
     * Captures: version, scenario ID, scenario name (map), era
     */
    /**
     * Validate if replay is a real match (not map selection/preview)
     * Returns null if valid, error message if should be discarded
     */
    private validateReplayIsRealMatch(wml: WMLNode, metadata: any): string | null {
        // Extract map name
        const mapName = metadata.scenario_name || '';
        
        // Discard if map is '$next_scenario' (placeholder, not real map)
        if (mapName === '$next_scenario' || mapName.includes('$next_scenario')) {
            return 'Map selection/scouting phase ($next_scenario placeholder)';
        }
        
        // Extract turn number
        const turn = parseInt(wml.turn || '0', 10);
        
        // Discard if turn is 0 or 1 AND map is placeholder
        if ((turn === 0 || turn === 1) && (mapName === '' || mapName === 'Unknown')) {
            return 'Map preview/selection phase (turn 0-1, no real map)';
        }
        
        return null; // Valid match
    }

    private extractMetadata(wml: WMLNode, wmlText?: string) {
        // Extract map name - PRIORITY ORDER:
        // 1. Search raw WML text for mp_scenario_name="..." (most reliable, as used in frontend)
        // 2. scenario field (Wesnoth convention)
        // 3. name field (default name)
        // 4. Empty if nothing found
        let mapName = '';
        
        // === PRIMARY: Direct search in raw WML (frontend-proven method) ===
        if (wmlText) {
            const scenarioMatch = wmlText.match(/mp_scenario_name\s*=\s*"([^"]+)"/);
            if (scenarioMatch) {
                mapName = scenarioMatch[1].trim();
                // Remove "2p — " prefix if present (exactly as frontend does)
                mapName = mapName.replace(/^2p\s*—\s*/, '');
                // Also handle em-dash variants and "Np — " pattern
                mapName = mapName.replace(/^\d+p\s*[—-]\s*/i, '');
            }
        }
        
        // === FALLBACK: Use WML structure if direct search found nothing ===
        if (!mapName && wml.scenario) {
            // Try scenario field first (primary convention in ladder maps)
            if (wml.scenario.scenario && typeof wml.scenario.scenario === 'string') {
                mapName = wml.scenario.scenario.trim();
            }
            // Try mp_scenario_name next (multiplayer maps)
            else if (wml.scenario.mp_scenario_name && typeof wml.scenario.mp_scenario_name === 'string') {
                mapName = wml.scenario.mp_scenario_name.trim();
                mapName = mapName.replace(/^2p\s*—\s*/, '');
                mapName = mapName.replace(/^\d+p\s*[—-]\s*/i, '');
            }
            // Fall back to name field
            else if (wml.scenario.name && typeof wml.scenario.name === 'string') {
                mapName = wml.scenario.name.trim();
                mapName = mapName.replace(/^2p\s*—\s*/, '');
                mapName = mapName.replace(/^\d+p\s*[—-]\s*/i, '');
            }
        }
        
        // If still empty, mark as Unknown
        if (!mapName) {
            mapName = 'Unknown';
        }
        
        return {
            version: wml.version || 'unknown',
            scenario_id: wml.scenario?.id || '',
            scenario_name: mapName,
            map_file: wml.scenario?.map_data || '',
            era_id: wml.era_id || ''
        };
    }

    /**
     * Extract addons from WML
     */
    private extractAddons(wml: WMLNode): Array<{ id: string; version: string; required: boolean }> {
        if (!wml.addons || !Array.isArray(wml.addons)) {
            return [];
        }

        return wml.addons.map((addon: any) => ({
            id: addon.id || '',
            version: addon.version || '',
            required: addon.required === 'yes'
        }));
    }

    /**
     * Extract players from WML side sections
     * Captures: side number, player name, faction (ID and display name)
     * Handles reload/pause cases: deduplicates by player name, keeps latest data
     */
    private extractPlayers(wml: WMLNode) {
        if (!wml.sides || !Array.isArray(wml.sides)) {
            return [];
        }

        // Use a Map keyed by player name to handle reload cases
        // If same player appears multiple times (from reload/pause), keep only the latest
        const playerMap = new Map<string, any>();
        
        wml.sides.forEach((side: any, index: number) => {
            const sideNum = parseInt(side.side || String(index + 1), 10);
            const playerName = (side.current_player || side.name || `Player ${sideNum}`).trim();
            
            // faction_name can be "Drakes", "Undead", etc.
            // faction_id is the internal identifier
            // Both may be prefixed with underscore (internationalization)
            let factionName = side.faction_name || side.faction || 'Unknown';
            factionName = factionName.replace(/^_/, '');  // Remove underscore prefix if present
            
            const player = {
                side: sideNum,
                name: playerName,
                faction_id: side.faction || '',
                faction_name: factionName,
                leader_id: side.leader || '',
                leader_type: side.type || '',
                controller: side.controller || 'human'
            };
            
            // Use player name as key (handles reload/pause where same player reappears)
            const mapKey = playerName;
            
            playerMap.set(mapKey, player);
        });
        
        // Convert Map to array, sorted by side number
        return Array.from(playerMap.values()).sort((a, b) => a.side - b.side);
    }

    /**
     * Extract player info from [old_sideN] blocks (fallback source of truth)
     * These blocks contain accurate faction and player names
     */
    /**
     * Extract faction information using the same proven logic as frontend ReportMatch
     * Much simpler and more reliable than complex inference
     * 
     * Strategy:
     * 1. Extract all faction_name values from [old_sideN] blocks + their current_player
     * 2. Build direct mapping: player_name -> faction_name  
     * 3. Apply to current players array
     */
    private extractFactionInfoFromWML(wmlText: string, players: Array<any>): Map<string, string> {
        const factionByPlayer = new Map<string, string>();
        
        // === Extract factions from [old_sideN] blocks (most reliable) ===
        // Pattern: [old_sideN]...current_player="..."...faction_name="..."...[/old_sideN]
        // We look for blocks that contain both current_player and faction_name
        
        const oldSideBlockRegex = /\[old_side[^\]]*\][\s\S]*?(?=\[old_side|\[|$)/g;
        const matches = wmlText.matchAll ? wmlText.matchAll(oldSideBlockRegex) : Array.from(wmlText.match(oldSideBlockRegex) || []).map(m => ({ 0: m }));
        
        for (const blockMatch of matches) {
            const text = blockMatch[0];
            
            // Extract current_player
            const playerMatch = text.match(/current_player\s*=\s*"([^"]+)"/);
            if (!playerMatch) continue;
            
            const player = playerMatch[1].trim();
            
            // Extract faction_name (prefer faction_name over faction)
            const factionNameMatch = text.match(/faction_name\s*=\s*_?"([^"]+)"/);
            const factionMatch = text.match(/faction\s*=\s*"([^"]+)"/);
            
            const rawFaction = factionNameMatch ? factionNameMatch[1] : (factionMatch ? factionMatch[1] : null);
            
            if (rawFaction) {
                const cleanFaction = rawFaction.replace(/^_/, '').trim();
                if (cleanFaction && cleanFaction !== 'Custom') {
                    factionByPlayer.set(player, cleanFaction);
                }
            }
        }
        
        // === Fallback: Extract from ALL [side] blocks (in case [old_sideN] missing) ===
        if (factionByPlayer.size === 0) {
            const sideRegex = /\[side\s*\]([\s\S]*?)\[\/side\]/g;
            let sideMatch;
            
            while ((sideMatch = sideRegex.exec(wmlText)) !== null) {
                const text = sideMatch[1];
                
                const playerMatch = text.match(/current_player\s*=\s*"([^"]+)"/);
                if (!playerMatch) continue;
                
                const player = playerMatch[1].trim();
                
                const factionNameMatch = text.match(/faction_name\s*=\s*_?"([^"]+)"/);
                const factionMatch = text.match(/faction\s*=\s*"([^"]+)"/);
                
                const rawFaction = factionNameMatch ? factionNameMatch[1] : (factionMatch ? factionMatch[1] : null);
                
                if (rawFaction) {
                    const cleanFaction = rawFaction.replace(/^_/, '').trim();
                    if (cleanFaction && cleanFaction !== 'Custom' && !factionByPlayer.has(player)) {
                        factionByPlayer.set(player, cleanFaction);
                    }
                }
            }
        }
        
        return factionByPlayer;
    }

    /**
     * Detect surrender victory from server messages in replay
     * Looks for: "PlayerName has surrendered." in [speak] blocks with id="server"
     * Searches in raw wmlText directly for robustness
     * Returns player name who surrendered (loser) and winning side
     */
    private detectSurrenderVictory(wml: WMLNode, players: Array<any>, wmlText?: string): {
        winner_side: number | null;
        loser_name: string | null;
        detected: boolean;
    } {
        // Primary: Search in raw wmlText for direct pattern matching
        if (wmlText) {
            // Search for server surrender messages
            // Format: message="PlayerName has surrendered."
            const surrenderRegex = /message\s*=\s*"([^"]+)\s+has\s+surrendered\."/gi;
            const matches = wmlText.matchAll(surrenderRegex);
            
            for (const match of matches) {
                const surrenderPlayer = match[1].trim();
                const loserSide = players.find((p: any) => p.name === surrenderPlayer)?.side;
                
                if (loserSide && players.length === 2) {
                    const winnerSide = loserSide === 1 ? 2 : 1;
                    return {
                        winner_side: winnerSide,
                        loser_name: surrenderPlayer,
                        detected: true
                    };
                }
            }
        }

        // Fallback: Look in command blocks (for structured WML)
        const commands = wml.command || [];
        const commandArray = Array.isArray(commands) ? commands : [commands];
        
        for (const command of commandArray) {
            if (command.speak && typeof command.speak === 'object') {
                const message = command.speak.message || '';
                // Match pattern: "PlayerName has surrendered."
                const surrenderMatch = message.match(/^(.+)\s+has\s+surrendered\.$/i);
                
                if (surrenderMatch) {
                    const surrenderPlayer = surrenderMatch[1].trim();
                    const loserSide = players.find((p: any) => p.name === surrenderPlayer)?.side;
                    
                    if (loserSide && players.length === 2) {
                        const winnerSide = loserSide === 1 ? 2 : 1;
                        return {
                            winner_side: winnerSide,
                            loser_name: surrenderPlayer,
                            detected: true
                        };
                    }
                }
            }
        }
        
        return {
            winner_side: null,
            loser_name: null,
            detected: false
        };
    }

    /**
     * Determine victory from WML
     * 
     * Priority detection (in order of confidence):
     * 1. Explicit endlevel result=victory (HIGHEST)
     * 2. Explicit endlevel result=resign (HIGH)
     * 3. Server surrender message (MEDIUM-HIGH)
     * 4. Surrender block presence (MEDIUM)
     * 5. Fallback: first player (LOW - needs manual confirmation)
     */
    private determineVictory(wml: WMLNode, players: Array<any>, wmlText?: string): {
        winner_side: number;
        winner_name: string;
        result_type: string;
        detected_from: string;
        confidence_level: 1 | 2;
    } {
        const totalPlayers = players.length;

        // 1. Check explicit endlevel result (highest confidence)
        if (wml.endlevel) {
            if (wml.endlevel.result === 'victory' && wml.endlevel.side) {
                const winnerSide = parseInt(wml.endlevel.side, 10);
                const winner = players.find((p: any) => p.side === winnerSide);
                return {
                    winner_side: winnerSide,
                    winner_name: winner?.name || `Player ${winnerSide}`,
                    result_type: 'explicit_victory',
                    detected_from: 'endlevel_victory',
                    confidence_level: 2 as const // AUTO: Clear explicit victory
                };
            }

            // 2. Check resignation (high confidence)
            if (wml.endlevel.result === 'resign' && wml.endlevel.side) {
                const loserSide = parseInt(wml.endlevel.side, 10);
                const winnerSide = totalPlayers === 2 ? (loserSide === 1 ? 2 : 1) : null;
                if (winnerSide) {
                    const winner = players.find((p: any) => p.side === winnerSide);
                    return {
                        winner_side: winnerSide,
                        winner_name: winner?.name || `Player ${winnerSide}`,
                        result_type: 'resignation',
                        detected_from: 'endlevel_resign',
                        confidence_level: 2 as const // AUTO: Clear resignation
                    };
                }
            }
        }

        // 3. Check for server-sent surrender message (medium-high confidence)
        // Format: "PlayerName has surrendered."
        const surrenderVictory = this.detectSurrenderVictory(wml, players, wmlText);
        if (surrenderVictory.detected && surrenderVictory.winner_side) {
            const winner = players.find((p: any) => p.side === surrenderVictory.winner_side);
            return {
                winner_side: surrenderVictory.winner_side,
                winner_name: winner?.name || `Player ${surrenderVictory.winner_side}`,
                result_type: 'surrender',
                detected_from: 'server_surrender_message',
                confidence_level: 2 as const // AUTO: Clear surrender via server message
            };
        }

        // 4. Default/Fallback: assume first player (LOW confidence - needs manual confirmation)
        const winner = players.find((p: any) => p.side === 1) || players[0];
        return {
            winner_side: winner?.side || 1,
            winner_name: winner?.name || 'Unknown',
            result_type: 'fallback',
            detected_from: 'default_assumption',
            confidence_level: 1 as const // MANUAL: Player must confirm
        };
    }

    /**
     * Update replay record with parsed data
     */
    public async updateReplayRecord(
        replayId: string,
        analysis: ReplayAnalysis,
        isTournamentMatch: boolean,
        parsingStartTime?: Date,
        parsingEndTime?: Date
    ): Promise<void> {
        try {
            const summary = this.generateSummary(analysis);
            const confidenceLevel = analysis.victory.confidence_level;
            
            // Format timestamps if provided
            let startTimeStr = parsingStartTime ? parsingStartTime.toISOString().slice(0, 19).replace('T', ' ') : null;
            let endTimeStr = parsingEndTime ? parsingEndTime.toISOString().slice(0, 19).replace('T', ' ') : null;
            
            await query(
                `UPDATE replays 
                 SET parsed = 1, 
                     need_integration = ?,
                     integration_confidence = ?,
                     wesnoth_version = ?,
                     map_name = ?,
                     era_id = ?,
                     tournament_addon_id = ?,
                     parse_status = 'completed',
                     parse_summary = ?,
                     parsing_started_at = COALESCE(?, parsing_started_at),
                     parsing_completed_at = COALESCE(?, NOW())
                 WHERE id = ?`,
                [
                    isTournamentMatch ? 1 : 0,
                    confidenceLevel, // 1=manual_confirm, 2=auto_report
                    analysis.metadata.version,
                    analysis.metadata.scenario_name,  // Use scenario_name which now contains proper map name
                    analysis.metadata.era_id,
                    analysis.addons.find(
                        (a: any) => a.id === this.tournamentAddonFilter
                    )?.id || null,
                    summary,
                    startTimeStr,
                    endTimeStr,
                    replayId
                ]
            );

            // Register participants if this is a tournament match
            if (isTournamentMatch) {
                await this.recordReplayParticipants(replayId, analysis);
            }
        } catch (error) {
            console.error(`Failed to update replay record: ${replayId}`, error);
            throw error;
        }
    }

    /**
     * Record all players who participated in this replay
     * Used for linking players to replays for confirmation queries
     */
    private async recordReplayParticipants(
        replayId: string,
        analysis: ReplayAnalysis
    ): Promise<void> {
        try {
            for (const player of analysis.players) {
                try {
                    // Check if player already exists for this replay
                    const existing = await query(
                        `SELECT id FROM replay_participants WHERE replay_id = ? AND player_name = ?`,
                        [replayId, player.name]
                    );

                    const existingRows = (existing as any).rows || (existing as unknown as any[]);
                    if (!existingRows || existingRows.length === 0) {
                        await query(
                            `INSERT INTO replay_participants 
                             (replay_id, player_id, player_name, side, faction_name, result_side, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                            [
                                replayId,
                                null, // placeholder - would need actual phpBB user_id mapping from username
                                player.name,
                                player.side,
                                player.faction_name,
                                analysis.victory.winner_side === player.side ? 1 : 0,
                            ]
                        );
                    }
                } catch (error) {
                    console.warn(`Failed to record participant ${player.name} for replay ${replayId}:`, error);
                }
            }
        } catch (error) {
            console.error(`Failed to record replay participants for ${replayId}:`, error);
            // Don't throw - this is non-critical
        }
    }

    /**
     * Generate human-readable summary of parsed replay
     * Returns concise text with key information
     */
    public generateSummary(analysis: ReplayAnalysis): string {
        const players = analysis.players.map(p => `${p.name} (${p.faction_name || 'Unknown'})`).join(' vs ');
        const addons = analysis.addons.map(a => a.id).join(', ') || 'None';
        
        return [
            `Map: ${analysis.metadata.scenario_name || 'Unknown'}`,
            `Players: ${players || 'Unknown'}`,
            `Era: ${analysis.metadata.era_id || 'Unknown'}`,
            `Victory: ${analysis.victory.result_type}`,
            `Add-ons: ${addons}`,
            `Winner: ${analysis.victory.winner_name}`
        ].join(' | ');
    }

    /**
     * Add log entry to replay_parsing_logs table
     */
    public async addParsingLog(
        replayId: string,
        stage: string,
        status: 'started' | 'success' | 'error',
        details?: any,
        errorMessage?: string
    ): Promise<void> {
        try {
            const logId = uuidv4();
            
            await query(
                `INSERT INTO replay_parsing_logs (id, replay_id, stage, status, error_message, details, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    logId,
                    replayId,
                    stage,
                    status,
                    errorMessage ? errorMessage.substring(0, 500) : null,
                    details ? JSON.stringify(details) : null
                ]
            );
        } catch (error) {
            console.error(`Failed to add parsing log for ${replayId}:`, error);
        }
    }

    /**
     * Mark parsing error in database
     */
    public async markAsDiscarded(
        replayId: string,
        discardReason: string
    ): Promise<void> {
        try {
            await query(
                `UPDATE replays 
                 SET parse_status = 'completed',
                     integration_confidence = 0,
                     parse_error_message = NULL,
                     parse_summary = ?,
                     parsing_completed_at = NOW()
                 WHERE id = ?`,
                [discardReason.substring(0, 500), replayId]
            );
        } catch (error) {
            console.error(
                `Failed to mark replay as discarded for ${replayId}`,
                error
            );
        }
    }

    public async markParsingError(
        replayId: string,
        errorMessage: string
    ): Promise<void> {
        try {
            await query(
                `UPDATE replays 
                 SET parse_status = 'error',
                     parse_error_message = ?,
                     parsing_completed_at = NOW()
                 WHERE id = ?`,
                [errorMessage.substring(0, 500), replayId]
            );
        } catch (error) {
            console.error(
                `Failed to mark parsing error for ${replayId}`,
                error
            );
        }
    }
}

export default ReplayParser;

/**
 * USAGE EXAMPLE:
 * 
 * const parser = new ReplayParser(db, logger);
 * 
 * // Stage 1: Quick check
 * const quickCheck = await parser.quickAddonCheck(replayPath);
 * console.log(quickCheck.has_tournament_addon); // true/false
 * 
 * // Stage 2: Full parse (only if tournament match)
 * if (quickCheck.has_tournament_addon) {
 *     const analysis = await parser.fullReplayParse(replayPath);
 *     console.log(analysis.victory.winner_side); // 1 or 2
 * }
 */
