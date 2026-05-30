/**
 * Background Job: Parse New Replays (FORUM-FIRST APPROACH)
 * File: backend/src/jobs/parseNewReplaysRefactorized.ts
 * 
 * Data Flow:
 * 1. Query wesnothd_game_content_info for addon confirmation (Ranked addon)
 * 2. Query wesnothd_game_player_info for player nicknames, sides, factions  
 * 3. Query wesnothd_game_content_info for scenario/map name
 * 4. If forum factions are "Custom" → search replay for actual factions
 * 5. Parse replay file for: ranked_mode, tournament, victory condition
 * 6. Validate factions and map against assets
 * 7. Report parse_summary with all detected information
 * 8. Create match with appropriate confidence level
 */

import { query } from '../config/database.js';
import ReplayParser from '../services/replayParser.js';
import { parseRankedReplay, ParsedRankedReplay } from '../utils/replayRankedParser.js';
import { createMatch, createTournamentUnrankedMatch, updateTournamentRoundMatch } from '../services/matchCreationService.js';
import { checkForumBanlist } from '../services/phpbbAuth.js';
import { queryPhpbb } from '../config/phpbbDatabase.js';
import * as fs from 'fs';
import * as path from 'path';

interface UnparsedReplay {
  id: string;
  instance_uuid: string;
  game_id: number;
  replay_filename: string;
  replay_url: string;
  wesnoth_version: string;
  game_name: string;
  start_time: string;
  end_time: string;
  created_at: string;
  oos: number;
}

interface ParseSummary {
  forumAddon: any | null;
  forumPlayers: Array<any>;
  forumMap: string | null;
  forumMapId: string | null;
  forumFactions: Record<string, string>;
  // Addon detection: ladder_era/ranked_era or ranked_map_picker
  hasRankedEra: boolean;
  hasRankedMapPicker: boolean;
  selectedMapName: string | null; // Map name from selected_map_name in replay when ranked_map_picker is used
  replayRankedMode: boolean;
  replayTournamentFlag: boolean; // tournament flag from WML
  replayTournament: string | null;
  replayVictory: any | null;
  replayFactions: Record<string, string | null>;
  wmlPlayerFactions: Record<string, string>; // player_name → faction from WML (used when forum has Custom)
  wmlTeams: Record<number, string>; // side_number → team_name from WML (for team tournaments)
  
  // Resolved (validated against assets)
  resolvedFactions: Record<string, string | null>; // Canonical names from factions table
  resolvedMap: string | null; // Canonical name from game_maps table
  
  // Asset validation
  factionsAreRanked: boolean;
  mapIsRanked: boolean;
  
  // Final factions (for UI/reporting)
  finalFactions: Record<string, string>;
  finalMap: string | null;
  confidenceLevel: 1 | 2;
  matchType: 'ranked' | 'tournament_ranked' | 'tournament_unranked' | 'rejected';
  // Set when matchType is tournament_* and a matching tournament_round_match is found
  linkedTournamentId: string | null;
  linkedTournamentRoundMatchId: string | null;
  // Cached tournament record found during match type detection (avoid double DB lookup)
  detectedTournament: { id: string; name: string; tournament_mode: string; tournament_type: string } | null;
  // Team information for team tournaments (populated during linkToTeamTournament)
  detectedTeams?: Record<string, {
    team_id: string;
    team_name: string;
    team_wml_name: string; // 'north-east' or 'south-west' etc from WML
    members: string[]; // player nicknames
    sides: number[]; // WML side numbers
    factions: string[]; // faction names from forumPlayers
  }>;
}

export class ParseNewReplaysRefactorized {
  private readonly parser: ReplayParser;
  private isRunning: boolean = false;
  private lastRunAt: Date | null = null;

  constructor() {
    this.parser = new ReplayParser();
  }

  private normalizeNickname(nickname: string | null | undefined): string {
    return (nickname || '').trim().toLowerCase();
  }

  private getWmlFactionForPlayer(
    wmlPlayerFactions: Record<string, string>,
    forumNickname: string
  ): string | null {
    if (!forumNickname) return null;

    const directMatch = wmlPlayerFactions[forumNickname];
    if (directMatch) return directMatch;

    const normalizedTarget = this.normalizeNickname(forumNickname);
    if (!normalizedTarget) return null;

    for (const [wmlNickname, faction] of Object.entries(wmlPlayerFactions)) {
      if (this.normalizeNickname(wmlNickname) === normalizedTarget) {
        return faction;
      }
    }

    return null;
  }

  /**
   * Execute one cycle of the parse job - Forum-First Approach
   */
  async execute(): Promise<{
    parsed_count: number;
    match_count: number;
    errors: number;
    duration_ms: number;
  }> {
    if (this.isRunning) {
      console.log('⚠️  [PARSE] Job already running, skipping');
      return { parsed_count: 0, match_count: 0, errors: 0, duration_ms: 0 };
    }

    const startTime = Date.now();
    this.isRunning = true;
    this.lastRunAt = new Date();

    let parsedCount = 0;
    let matchCount = 0;
    let errorCount = 0;

    try {
      console.log('🎬 [PARSE] Starting forum-first replay parsing...');

      const unparsedReplays = await this.getUnparsedReplays();
      console.log(`📊 [PARSE] Found ${unparsedReplays.length} unparsed replays`);

      for (const replay of unparsedReplays) {
        try {
          console.log(`\n🎬 [PARSE] Processing: ${replay.game_name} (Replay ${replay.game_id})`);

          // Early exit: OOS replays are unreliable (game had sync errors)
          if (replay.oos === 1) {
            if (replay.replay_filename.includes('Turn_1_')) {
              console.log(`🗑️  [PARSE] OOS Turn_1 replay → Deleting`);
              await query(`DELETE FROM replays WHERE id = ?`, [replay.id]);
            } else {
              console.log(`❌ [PARSE] OOS replay → Rejecting`);
              await query(
                `UPDATE replays SET parse_status = 'rejected', need_integration = 0, parsed = 1, parse_summary = ? WHERE id = ?`,
                [JSON.stringify({ matchType: 'rejected', reason: 'oos' }), replay.id]
              );
            }
            errorCount++;
            continue;
          }

          // Early exit: Turn_1 replays are too short to be valid — always delete
          if (replay.replay_filename.includes('Turn_1_')) {
            console.log(`🗑️  [PARSE] Turn_1 replay → Deleting (game too short)`);
            await query(`DELETE FROM replays WHERE id = ?`, [replay.id]);
            errorCount++;
            continue;
          }

          const parseSummary = await this.parseReplayForumFirst(replay);

          if (parseSummary.matchType === 'rejected') {
            console.log(`❌ [PARSE] Match rejected → Update replay as rejected`);
            await query(
              `UPDATE replays SET parse_status = 'rejected', need_integration = 0, parsed = 1, integration_confidence = ?, parse_summary = ? WHERE id = ?`,
              [parseSummary.confidenceLevel, JSON.stringify(parseSummary), replay.id]
            );
            errorCount++;
            continue;
          }

          // For tournament matches, link to the specific tournament_round_match
          if (parseSummary.matchType === 'tournament_ranked' || parseSummary.matchType === 'tournament_unranked') {
            const linked = await this.linkToTournament(replay, parseSummary);
            if (!linked) {
              console.log(`❌ [PARSE] Tournament link failed → REJECTED`);
              await query(
                `UPDATE replays SET parse_status = 'rejected', need_integration = 0, parsed = 1, integration_confidence = ?, parse_summary = ? WHERE id = ?`,
                [parseSummary.confidenceLevel, JSON.stringify(parseSummary), replay.id]
              );
              errorCount++;
              continue;
            }
          }

          // Ensure both players exist in users_extension (auto-register if needed)
          await this.ensurePlayersExist(parseSummary.forumPlayers);

          // Check confidence level - only create match if confidence=2
          if (parseSummary.confidenceLevel === 1) {
            console.log(`⏳ [PARSE] Confidence=1 → Parsed but no match created (awaiting player confirmation)`);
            await query(
              `UPDATE replays SET parse_status = 'parsed', parsed = 1, need_integration = 1, integration_confidence = ?,
               tournament_id = ?, tournament_round_match_id = ?, parse_error_message = NULL, parse_summary = ? WHERE id = ?`,
              [parseSummary.confidenceLevel, parseSummary.linkedTournamentId, parseSummary.linkedTournamentRoundMatchId, JSON.stringify(parseSummary), replay.id]
            );
            parsedCount++;
            continue;
          }

          // Create match (only if confidence=2)
          let matchCreateResult;

          if (parseSummary.matchType === 'tournament_unranked') {
            // Unranked tournament: insert into tournament_matches only, no ELO/stats update
            const winnerUser = await this.getUserDataByNickname(parseSummary.replayVictory!.winner_name);
            if (!winnerUser) {
              console.error(`❌ [PARSE] Winner user not found for unranked match`);
              await query(
                `UPDATE replays SET parse_status = 'error', parsed = 1, parse_error_message = ?, parse_summary = ? WHERE id = ?`,
                ['Winner user not found', JSON.stringify(parseSummary), replay.id]
              );
              errorCount++;
              continue;
            }

            // Get loser user for tournament_matches record
            const loserUser = await this.getUserDataByNickname(parseSummary.replayVictory!.loser_name);
            const loserId = loserUser?.id || '';

            matchCreateResult = await createTournamentUnrankedMatch({
              winnerId: winnerUser.id,
              loserId: loserId,
              linkedTournamentId: parseSummary.linkedTournamentId!,
              linkedTournamentRoundMatchId: parseSummary.linkedTournamentRoundMatchId!,
            });
          } else {
            matchCreateResult = await this.createMatchFromParseSummary(replay, parseSummary);
          }

          if (matchCreateResult.success) {
            console.log(`✅ [PARSE] Match created: ID ${matchCreateResult.matchId}`);
            // For unranked tournament matches, match_id stays NULL (no entry in matches table)
            const replayMatchId = parseSummary.matchType === 'tournament_unranked' ? null : matchCreateResult.matchId;
            await query(
              `UPDATE replays SET parse_status = 'completed', parsed = 1, integration_confidence = ?,
               tournament_id = ?, tournament_round_match_id = ?, match_id = ?, parse_error_message = NULL, parse_summary = ? WHERE id = ?`,
              [parseSummary.confidenceLevel, parseSummary.linkedTournamentId, parseSummary.linkedTournamentRoundMatchId, replayMatchId, JSON.stringify(parseSummary), replay.id]
            );
            
            // Update last integration timestamp
            await query(
              `UPDATE system_settings SET setting_value = ?, updated_at = NOW() 
               WHERE setting_key = 'replay_last_integration_timestamp'`,
              [new Date().toISOString()]
            );
            
            parsedCount++;
            matchCount++;
          } else {
            console.error(`❌ [PARSE] Failed to create match:`, matchCreateResult.error);
            await query(
              `UPDATE replays SET parse_status = 'error', parsed = 1, parse_error_message = ?, parse_summary = ? WHERE id = ?`,
              [matchCreateResult.error, JSON.stringify(parseSummary), replay.id]
            );
            errorCount++;
          }

        } catch (replayError) {
          const errorMsg = (replayError as any)?.message || String(replayError);
          console.error(`❌ [PARSE] Error processing replay:`, errorMsg);

          // Handle file not found with retry logic
          if (errorMsg.includes('Replay file not found')) {
            const replayAge = Date.now() - new Date(replay.created_at).getTime();
            const ageHours = replayAge / (1000 * 60 * 60);

            if (ageHours < 12) {
              // Leave as 'new' so the next parse cycle will retry automatically
              console.log(`   ⏳ File not found but < 12h old → Leave as 'new' for retry (age: ${ageHours.toFixed(1)}h)`);
              await query(
                `UPDATE replays SET parse_error_message = ? WHERE id = ?`,
                [`File not found, waiting (${ageHours.toFixed(1)}h elapsed)`, replay.id]
              );
            } else {
              // 12h elapsed, discard
              console.log(`   🗑️  File not found and >= 12h old → Discarding (age: ${ageHours.toFixed(1)}h)`);
              await query(
                `UPDATE replays SET parse_status = 'rejected', parsed = 1, parse_error_message = ? WHERE id = ?`,
                [`File never appeared after ${ageHours.toFixed(1)}h — discarded`, replay.id]
              );
            }
          } else {
            // Other errors
            await query(
              `UPDATE replays SET parse_status = 'error', parsed = 1, parse_error_message = ? WHERE id = ?`,
              [errorMsg, replay.id]
            );
          }

          errorCount++;
        }
      }

      const duration = Date.now() - startTime;
      console.log(`\n✅ [PARSE] Job completed in ${duration}ms`);
      console.log(`   Parsed: ${parsedCount}, Matches: ${matchCount}, Errors: ${errorCount}`);

      return {
        parsed_count: parsedCount,
        match_count: matchCount,
        errors: errorCount,
        duration_ms: duration
      };

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * STEP 1-3: Query forum database for addon, players, map
   * STEP 5-7: Parse replay for complementary info
   * Returns complete ParseSummary
   */
  private async parseReplayForumFirst(replay: UnparsedReplay): Promise<ParseSummary> {
    const parseSummary: ParseSummary = {
      forumAddon: null,
      forumPlayers: [],
      forumMap: null,
      forumMapId: null,
      forumFactions: {},
      hasRankedEra: false,
      hasRankedMapPicker: false,
      selectedMapName: null,
      replayRankedMode: false,
      replayTournamentFlag: false,
      replayTournament: null,
      replayVictory: null,
      replayFactions: {},
      wmlPlayerFactions: {},
      wmlTeams: {},
      resolvedFactions: {},
      resolvedMap: null,
      factionsAreRanked: false,
      mapIsRanked: false,
      finalFactions: {},
      finalMap: null,
      confidenceLevel: 1,
      matchType: 'rejected',
      linkedTournamentId: null,
      linkedTournamentRoundMatchId: null,
      detectedTournament: null
    };

    // ======== STEP 1: Query forum for addon ========
    console.log(`📋 [FORUM] Step 1: Checking for Ranked addon...`);
    const addonResult = await query(
      `SELECT addon_id, addon_version FROM forum.wesnothd_game_content_info 
       WHERE instance_uuid = ? AND game_id = ? AND type = 'modification' AND addon_id = 'Ranked' LIMIT 1`,
      [replay.instance_uuid, replay.game_id]
    );

    if ((addonResult as any).rows?.length > 0) {
      parseSummary.forumAddon = (addonResult as any).rows[0];
      console.log(`   ✅ Found Ranked addon in forum`);
    } else {
      console.log(`   ⚠️  No Ranked addon found in forum`);
      parseSummary.matchType = 'rejected';
      return parseSummary;
    }

    // ======== STEP 2: Query forum for players, sides, factions ========
    console.log(`📋 [FORUM] Step 2: Querying players...`);
    const playersResult = await query(
      `SELECT user_id, user_name, faction, side_number 
       FROM forum.wesnothd_game_player_info 
       WHERE instance_uuid = ? AND game_id = ? AND user_id != -1 AND user_id IS NOT NULL
       ORDER BY side_number`,
      [replay.instance_uuid, replay.game_id]
    );

    if ((playersResult as any).rows?.length < 2) {
      console.log(`   ❌ Less than 2 players found in forum`);
      parseSummary.matchType = 'rejected';
      return parseSummary;
    }

    parseSummary.forumPlayers = (playersResult as any).rows;
    for (const player of parseSummary.forumPlayers) {
      let faction = player.faction;
      // Normalize "Ranked " prefix when ranked_era is detected (will be detected in Step 3)
      // For now, store original; normalization happens after addon detection
      parseSummary.forumFactions[`side${player.side_number}`] = faction;
      console.log(`   Player: ${player.user_name} (Side ${player.side_number}, Faction: ${player.faction})`);
    }

    // ======== STEP 2b: Enrich players with ranked eligibility info ========
    for (const player of parseSummary.forumPlayers) {
      if (!player.user_name) continue;
      // enable_ranked flag
      const userResult = await query(
        `SELECT enable_ranked FROM users_extension WHERE LOWER(nickname) = LOWER(?) LIMIT 1`,
        [player.user_name]
      );
      player.enable_ranked = userResult.rows[0]?.enable_ranked ? true : false;

      // active ban
      const phpbbRow = await queryPhpbb(
        `SELECT user_id FROM phpbb3_users WHERE LOWER(username_clean) = LOWER(?) LIMIT 1`,
        [player.user_name]
      ) as any[];
      if (Array.isArray(phpbbRow) && phpbbRow.length > 0) {
        const banCheck = await checkForumBanlist(phpbbRow[0].user_id);
        player.is_banned = banCheck.banned;
        if (banCheck.banned) player.ban_reason = banCheck.reason || null;
      } else {
        player.is_banned = false;
      }
      console.log(`   Eligibility: ${player.user_name} — ranked_enabled=${player.enable_ranked}, banned=${player.is_banned}`);
    }

    // ======== STEP 3: Query forum for map/scenario & detect special addons ========
    console.log(`📋 [FORUM] Step 3: Querying map and detecting special addons...`);
    const mapResult = await query(
      `SELECT id, name FROM forum.wesnothd_game_content_info 
       WHERE instance_uuid = ? AND game_id = ? AND type = 'scenario' LIMIT 1`,
      [replay.instance_uuid, replay.game_id]
    );

    // Detect ranked_era and ranked_map_picker addons, fetch scenario ID and addon_id
    const addonCheckResult = await query(
      `SELECT addon_id, id FROM forum.wesnothd_game_content_info 
       WHERE instance_uuid = ? AND game_id = ? AND type = 'scenario' LIMIT 2`,
      [replay.instance_uuid, replay.game_id]
    );
    
    let scenarioId: string | null = null;
    let eraAddonId: string | null = null;

    if ((addonCheckResult as any).rows?.length > 0) {
      for (const addon of (addonCheckResult as any).rows) {
        scenarioId = addon.id;
        eraAddonId = addon.addon_id;
        if (addon.addon_id === 'ranked_era' || addon.addon_id === 'ladder_era') {
          parseSummary.hasRankedEra = true;
          console.log(`   ✅ Detected ${addon.addon_id} addon (factions will be from forum)`);
          // Normalize "Ranked " prefix from forum factions only for ranked_era
          if (addon.addon_id === 'ranked_era') {
            for (const sideKey of Object.keys(parseSummary.forumFactions)) {
              const faction = parseSummary.forumFactions[sideKey];
              if (faction.startsWith('Ranked ')) {
                parseSummary.forumFactions[sideKey] = faction.substring(7); // Remove "Ranked " prefix
                console.log(`      Normalized faction: "${faction}" → "${parseSummary.forumFactions[sideKey]}"`);
              }
            }
          }
        } else if (addon.addon_id === 'ranked_map_picker') {
          parseSummary.hasRankedMapPicker = true;
          console.log(`   ✅ Detected ranked_map_picker addon (map will be from selected_map_name)`);
        }
      }
    }

    if ((mapResult as any).rows?.length > 0) {
      const forumMapFromDb = (mapResult as any).rows[0].name;
      const mapId = (mapResult as any).rows[0].id;
      const mapIdWithoutPrefix = mapId.startsWith('multiplayer_') ? mapId.substring(12) : mapId;
      parseSummary.forumMapId = mapIdWithoutPrefix;

      // PRIORITY 1: For ladder_era/ranked_era, extract from scenario_id FIRST (most reliable)
      if (scenarioId && (eraAddonId?.toLowerCase() === 'ladder_era' || eraAddonId?.toLowerCase() === 'ranked_era')) {
        const extractedName = this.extractMapNameFromScenarioId(scenarioId, eraAddonId);
        if (extractedName) {
          parseSummary.forumMap = extractedName;
          console.log(`   ✅ Extracted from scenario_id (ladder/ranked): "${extractedName}"`);
          console.log(`      (forum DB had: "${forumMapFromDb}")`);
        } else {
          // Extraction failed, fall back to forum name
          parseSummary.forumMap = forumMapFromDb;
          console.log(`   ⚠️  Extraction from scenario_id failed, using forum name: "${forumMapFromDb}"`);
        }
      } else {
        // Not ladder/ranked era, use forum name directly
        parseSummary.forumMap = forumMapFromDb;
        console.log(`   ✅ Map: ${forumMapFromDb} (ID: ${mapIdWithoutPrefix})`);
      }
    } else {
      parseSummary.forumMap = replay.game_name;
      console.log(`   ⚠️  No map in forum, using game_name: ${parseSummary.forumMap}`);
    }

    // ======== STEP 4: Check if forum factions are "Custom" =========
    const hasCustomFaction = Object.values(parseSummary.forumFactions)
      .some(f => f.toLowerCase().includes('custom'));

    // ======== STEPS 5-7: ALWAYS parse replay (selectively) ========
    console.log(`🎬 [REPLAY] Step 5-7: Parsing replay file (selective)...`);
    try {
      const parsed = await this.parseReplayFromUrl(replay, parseSummary.forumPlayers, hasCustomFaction);

      if (parsed) {
        // 5.1 Extract ranked_mode and tournament flag
        if (parsed.addon) {
          parseSummary.replayRankedMode = parsed.addon.ranked_mode || false;
          // Tournament flag indicates whether the game was marked as a tournament game in WML
          // Tournament name always comes from game_name in forum DB, never from WML
          parseSummary.replayTournamentFlag = parsed.addon.tournament || false;
          console.log(`   ✅ 5.1 ranked_mode=${parseSummary.replayRankedMode}, tournament_flag=${parseSummary.replayTournamentFlag}`);
        }

        // 5.1b Extract team information (for team tournaments)
        if (parsed.teams && Object.keys(parsed.teams).length > 0) {
          parseSummary.wmlTeams = parsed.teams;
          const teamInfo = Object.entries(parsed.teams).map(([side, team]) => `side${side}=${team}`).join(', ');
          console.log(`   ✅ 5.1b Teams: ${teamInfo}`);
        }

        // 5.1c Extract selected map name (for ranked_map_picker addon)
        if (parsed.selectedMapName) {
          parseSummary.selectedMapName = parsed.selectedMapName;
          console.log(`   ✅ 5.1c Selected map name: ${parsed.selectedMapName}`);
        }

        // 5.2 Victory (from parsed replay)
        if (parsed.victory) {
          parseSummary.replayVictory = parsed.victory;
          if (parsed.victory.reason === 'surrender') {
            console.log(`   ✅ 5.2 Victory: ${parsed.victory.winner_name} def ${parsed.victory.loser_name} (surrender, confidence: 2)`);
          } else {
            console.log(`   ⚠️  5.2 No clear victory: ${parsed.victory.reason} (confidence: 1)`);
          }
        }

        // 5.3 (Optional) Build player_name → faction map from WML ONLY if forum had "Custom"
        if (hasCustomFaction && parsed.players) {
          for (const p of parsed.players) {
            if (p.name && p.faction) {
              parseSummary.wmlPlayerFactions[p.name] = p.faction;
            }
          }
          console.log(`   ✅ 5.3 WML player factions: ${JSON.stringify(parseSummary.wmlPlayerFactions)}`);
        } else {
          console.log(`   ✅ Using forum factions (not Custom): ${Object.values(parseSummary.forumFactions).join(' vs ')}`);
        }
      }
    } catch (err) {
      const errMsg = (err as any)?.message || String(err);
      // Re-throw file-not-found so the outer catch can handle retry logic
      if (errMsg.includes('Replay file not found')) {
        throw err;
      }
      console.warn(`⚠️  Could not parse replay file:`, err);
    }

    // ======== CONFIDENCE LEVEL (from replayVictory) ========
    console.log(`🎯 [PARSE] Determining confidence level...`);
    parseSummary.confidenceLevel = parseSummary.replayVictory?.confidence_level || 1;
    if (parseSummary.confidenceLevel === 2) {
      console.log(`   ✅ Clear victory (${parseSummary.replayVictory?.reason}) → confidence=2`);
    } else {
      console.log(`   ⚠️  No clear victory (${parseSummary.replayVictory?.reason}) → confidence=1`);
    }

    // ======== DETERMINE MATCH TYPE ========
    // Logic based on ranked_mode from addon WML + tournament_mode from DB (if tournament)
    console.log(`📊 [PARSE] Determining match type...`);
    if (!parseSummary.forumAddon) {
      parseSummary.matchType = 'rejected';
      console.log(`   ❌ No Ranked addon in forum → REJECTED`);
      return parseSummary;
    }

    // Determine match type based on ranked_mode and tournament flag
    // Tournament name always comes from game_name in forum DB
    if (!parseSummary.replayRankedMode) {
      // ranked_mode=false → unranked game
      console.log(`   ℹ️  ranked_mode=false (unranked)`);
      
      if (!parseSummary.replayTournamentFlag) {
        // No tournament flag → unranked without tournament is not accepted
        console.log(`   ❌ tournament_flag=false → Unranked replays must be part of a tournament → REJECTED`);
        parseSummary.matchType = 'rejected';
        return parseSummary;
      } else {
        // tournament_flag=true → search for unranked/team tournament
        console.log(`   ℹ️  tournament_flag=true → Searching for unranked/team tournament...`);
        
        const searchName = (replay.game_name || '').trim();
        console.log(`   [TOURNAMENT] Searching by game_name: "${searchName}"`);
        
        if (!searchName) {
          console.log(`   ⚠️  No game_name available, cannot link tournament → REJECTED`);
          parseSummary.matchType = 'rejected';
          return parseSummary;
        } else {
          const tournResult = await query(
            `SELECT id, name, tournament_mode, tournament_type FROM tournaments
             WHERE status = 'in_progress' AND tournament_mode IN ('unranked', 'team') AND LOWER(name) = LOWER(?)
             LIMIT 1`,
            [searchName]
          );
          const tournaments = (tournResult as any).rows || [];

          if (tournaments.length > 0) {
            const tournament = tournaments[0];
            parseSummary.detectedTournament = tournament;
            console.log(`   🏆 Detected tournament: "${tournament.name}" (mode=${tournament.tournament_mode})`);
            parseSummary.matchType = 'tournament_unranked';
            console.log(`   ✅ Found ${tournament.tournament_mode} tournament → TOURNAMENT_UNRANKED`);
          } else {
            console.log(`   ❌ No tournament found by game_name → REJECTED`);
            parseSummary.matchType = 'rejected';
            return parseSummary;
          }
        }
      }
    } else {
      // ranked_mode=true → ranked game
      console.log(`   ℹ️  ranked_mode=true (ranked)`);
      
      if (!parseSummary.replayTournamentFlag) {
        // No tournament flag → direct ranked match
        console.log(`   ℹ️  tournament_flag=false → Direct ranked match`);
        parseSummary.matchType = 'ranked';
      } else {
        // tournament_flag=true → search for ranked tournament
        console.log(`   ℹ️  tournament_flag=true → Searching for ranked tournament...`);
        
        const searchName = (replay.game_name || '').trim();
        console.log(`   [TOURNAMENT] Searching by game_name: "${searchName}"`);
        
        if (!searchName) {
          console.log(`   ⚠️  No game_name available, treating as direct ranked`);
          parseSummary.matchType = 'ranked';
        } else {
          const tournResult = await query(
            `SELECT id, name, tournament_mode, tournament_type FROM tournaments
             WHERE status = 'in_progress' AND tournament_mode = 'ranked' AND LOWER(name) = LOWER(?)
             LIMIT 1`,
            [searchName]
          );
          const tournaments = (tournResult as any).rows || [];

          if (tournaments.length > 0) {
            const tournament = tournaments[0];
            parseSummary.detectedTournament = tournament;
            console.log(`   🏆 Detected ranked tournament: "${tournament.name}"`);
            parseSummary.matchType = 'tournament_ranked';
            console.log(`   ✅ Found ranked tournament → TOURNAMENT_RANKED`);
          } else {
            console.log(`   ⚠️  No ranked tournament found, treating as direct ranked`);
            parseSummary.matchType = 'ranked';
          }
        }
      }
    }

    // ======== VALIDATE AND RESOLVE FACTIONS AND MAP ========
    // Only needed for ranked matches and ranked tournaments
    // Team tournaments skip asset validation (only users, teams, rounds, matches)
    if (parseSummary.matchType === 'tournament_unranked') {
      // Team tournament - skip asset validation
      console.log(`🔍 [PARSE] Skipping asset validation (team tournament)`);
      // matchType remains 'tournament_unranked', will proceed to linkToTournament
    } else {
      // Need to validate factions and map for ranked paths
      console.log(`🔍 [PARSE] Validating factions against factions table...`);
      let allRanked = true;
      for (const player of parseSummary.forumPlayers) {
        const sideKey = `side${player.side_number}`;
        const forumFaction = parseSummary.forumFactions[sideKey] || '';
        const isCustom = forumFaction.toLowerCase().includes('custom');

        const factionRaw = isCustom
          ? (this.getWmlFactionForPlayer(parseSummary.wmlPlayerFactions, player.user_name) || 'Unknown')
          : forumFaction;

        const resolved = await this.resolveFaction(factionRaw);

        parseSummary.resolvedFactions[sideKey] = resolved.name;
        parseSummary.finalFactions[sideKey] = resolved.name || 'Unknown';
        if (!resolved.isRanked) allRanked = false;

        if (resolved.name !== factionRaw) {
          console.log(`   ✅ ${player.user_name} (side ${player.side_number}): "${factionRaw}" → "${resolved.name}" (ranked: ${resolved.isRanked})`);
        } else {
          console.log(`   ✅ ${player.user_name} (side ${player.side_number}): "${resolved.name}" (ranked: ${resolved.isRanked})`);
        }
      }
      parseSummary.factionsAreRanked = allRanked;

      // ======== VALIDATE AND RESOLVE MAP ========
      console.log(`🔍 [PARSE] Validating map against game_maps table...`);
      // Use selectedMapName if ranked_map_picker is detected, otherwise use forumMap
      const mapSource = parseSummary.hasRankedMapPicker && parseSummary.selectedMapName
        ? parseSummary.selectedMapName
        : (parseSummary.forumMap || 'Unknown');
      const mapRaw = mapSource;
      const mapId = parseSummary.forumMapId || null;
      const shouldIgnoreLadderSuffix = eraAddonId?.toLowerCase() === 'ladder_era';
      const mapResolved = await this.resolveMap(mapRaw, mapId, shouldIgnoreLadderSuffix);
      parseSummary.finalMap = mapResolved.name;
      parseSummary.resolvedMap = mapResolved.name;
      parseSummary.mapIsRanked = mapResolved.isRanked;

      if (parseSummary.hasRankedMapPicker && parseSummary.selectedMapName) {
        console.log(`   ℹ️  Using selected_map_name (ranked_map_picker detected): "${parseSummary.selectedMapName}"`);
      }
      if (mapResolved.name !== mapRaw) {
        console.log(`   ✅ Map: "${mapRaw}" → "${mapResolved.name}" (ranked: ${mapResolved.isRanked})`);
      } else {
        console.log(`   ✅ Map: "${mapResolved.name}" (ranked: ${mapResolved.isRanked})`);
      }

      // ======== FINALIZE MATCH TYPE for ranked paths ========
      if (parseSummary.matchType === 'tournament_ranked') {
        // ranked_mode=true + ranked tournament: validate assets
        if (parseSummary.factionsAreRanked && parseSummary.mapIsRanked) {
          console.log(`   ✅ ranked tournament + ranked assets → TOURNAMENT_RANKED`);
        } else {
          parseSummary.matchType = 'rejected';
          console.log(`   ❌ ranked tournament but assets are not ranked → REJECTED`);
        }
      } else if (parseSummary.matchType === 'ranked') {
        // Direct ranked match - validate assets and eligibility
        const eligibilityRejection = await this.checkRankedEligibility(parseSummary.forumPlayers);
        if (eligibilityRejection) {
          parseSummary.matchType = 'rejected';
          console.log(`   ❌ ${eligibilityRejection} → REJECTED`);
        } else if (parseSummary.factionsAreRanked && parseSummary.mapIsRanked) {
          console.log(`   ✅ Direct ranked match + ranked assets → RANKED`);
        } else {
          parseSummary.matchType = 'rejected';
          console.log(`   ❌ ranked mode but assets not ranked and no tournament → REJECTED`);
        }
      }
    }

    return parseSummary;
  }

  /**
   * Check that all players in a ranked (non-tournament) match are eligible:
   * - enable_ranked = 1 (pre-fetched in forumPlayers[].enable_ranked)
   * - No active ban   (pre-fetched in forumPlayers[].is_banned)
   * Returns a rejection reason string, or null if all players are eligible.
   */
  private async checkRankedEligibility(
    forumPlayers: Array<{ user_name: string; enable_ranked?: boolean; is_banned?: boolean }>
  ): Promise<string | null> {
    for (const player of forumPlayers) {
      if (!player.user_name) continue;
      if (!player.enable_ranked) {
        return `Player ${player.user_name} has not enabled ranked matches (enable_ranked=0)`;
      }
      if (player.is_banned) {
        return `Player ${player.user_name} has an active forum ban`;
      }
    }
    return null;
  }

  /**
   * Ensure all forum players exist in users_extension.
   * If a player is missing, auto-register them with default ELO 1400.
   * Uses forum user_id as the source of truth for identity lookup (by nickname).
   */
  private async ensurePlayersExist(forumPlayers: Array<{ user_name: string; user_id?: number }>): Promise<void> {
    for (const player of forumPlayers) {
      if (!player.user_name) continue;
      try {
        const existing = await query(
          `SELECT id FROM users_extension WHERE LOWER(nickname) = LOWER(?) LIMIT 1`,
          [player.user_name]
        );
        if (((existing as any).rows || []).length > 0) continue;

        const { v4: uuidv4 } = await import('uuid');
        const newId = uuidv4();
        await query(
          `INSERT INTO users_extension
             (id, nickname, is_active, is_rated, elo_rating, matches_played, total_wins, total_losses, created_at, updated_at)
           VALUES (?, ?, 1, 0, 1400, 0, 0, 0, NOW(), NOW())`,
          [newId, player.user_name]
        );
        console.log(`👤 [PARSE] Auto-registered player: ${player.user_name} (id=${newId})`);
      } catch (err) {
        console.warn(`⚠️  [PARSE] Failed to ensure player ${player.user_name}:`, (err as any)?.message);
      }
    }
  }

  /**
   * Fetch user data from users_extension by nickname (case-insensitive)
   */
  private async getUserDataByNickname(nickname: string): Promise<any | null> {
    if (!nickname) return null;
    
    try {
      const result = await query(
        `SELECT id, elo_rating, level FROM users_extension 
         WHERE LOWER(nickname) = LOWER(?)`,
        [nickname]
      );
      
      return (result as any).rows?.[0] || null;
    } catch (err) {
      console.warn(`⚠️  Failed to lookup user ${nickname}:`, (err as any)?.message);
      return null;
    }
  }

  /**
   * Create match in database from ParseSummary.
   * Resolves player identities then delegates to the shared matchCreationService.
   */
  private async createMatchFromParseSummary(
    replay: UnparsedReplay,
    parseSummary: ParseSummary
  ): Promise<{ success: boolean; matchId?: string; error?: string }> {
    if (parseSummary.forumPlayers.length < 2 || !parseSummary.replayVictory) {
      return { success: false, error: 'Insufficient data: missing forum players or replay victory' };
    }

    const winnerName = parseSummary.replayVictory.winner_name;
    const loserName  = parseSummary.replayVictory.loser_name;

    const winnerForumData = parseSummary.forumPlayers.find(
      p => this.normalizeNickname(p.user_name) === this.normalizeNickname(winnerName)
    );
    const loserForumData  = parseSummary.forumPlayers.find(
      p => this.normalizeNickname(p.user_name) === this.normalizeNickname(loserName)
    );

    if (!winnerForumData || !loserForumData) {
      return {
        success: false,
        error: `Players not found in forum data: winner=${winnerName} (found=${!!winnerForumData}), loser=${loserName} (found=${!!loserForumData})`
      };
    }

    const winnerUserData = await this.getUserDataByNickname(winnerName);
    const loserUserData  = await this.getUserDataByNickname(loserName);

    if (!winnerUserData || !loserUserData) {
      return {
        success: false,
        error: `User not found in users_extension: winner=${winnerName} (found=${!!winnerUserData}), loser=${loserName} (found=${!!loserUserData})`
      };
    }

    const winnerFaction = parseSummary.resolvedFactions[`side${winnerForumData.side_number}`] || 'Unknown';
    const loserFaction  = parseSummary.resolvedFactions[`side${loserForumData.side_number}`]  || 'Unknown';
    const map = parseSummary.resolvedMap || 'Unknown';

    // Build replay file URL
    const gameDate = new Date(replay.end_time);
    const yyyy = gameDate.getFullYear();
    const mm = String(gameDate.getMonth() + 1).padStart(2, '0');
    const dd = String(gameDate.getDate()).padStart(2, '0');
    const cleanFilename = replay.replay_filename.replace(/\.bz2$/, '');
    const replayFilePath = `https://replays.wesnoth.org/${replay.wesnoth_version}/${yyyy}/${mm}/${dd}/${cleanFilename}.bz2`;

    console.log(`\n📝 Creating match: ${winnerName} beat ${loserName} | Map: ${map} | Confidence: ${parseSummary.confidenceLevel}`);

    return createMatch({
      winnerId:                       winnerUserData.id,
      loserId:                        loserUserData.id,
      winnerFaction,
      loserFaction,
      map,
      winnerSide:                     winnerForumData.side_number,
      replayRowId:                    replay.id,
      replayFilePath,
      matchType:                      parseSummary.matchType,
      linkedTournamentId:             parseSummary.linkedTournamentId,
      linkedTournamentRoundMatchId:   parseSummary.linkedTournamentRoundMatchId,
      gameId:                         replay.game_id,
      wesnothVersion:                 replay.wesnoth_version,
      instanceUuid:                   replay.instance_uuid,
    });
  }

  /**
   * Link a tournament replay to the correct tournament and tournament_round_match.
   * Uses the tournament already detected during match type determination (parseSummary.detectedTournament).
   * For team tournaments (tournament_mode='team'), finds each player's team via tournament_participants
   * and then looks up the match by team IDs. For 1v1 tournaments, uses player IDs directly.
   * Mutates parseSummary.linkedTournamentId and parseSummary.linkedTournamentRoundMatchId.
   * Returns true on success, false if the replay should be rejected.
   */
  private async linkToTournament(replay: UnparsedReplay, parseSummary: ParseSummary): Promise<boolean> {
    // Reuse tournament detected during match type determination to avoid a second DB lookup
    const tournament = parseSummary.detectedTournament;

    if (!tournament) {
      console.log(`   ❌ [TOURNAMENT LINK] No detected tournament in parseSummary`);
      return false;
    }

    console.log(`   ✅ [TOURNAMENT LINK] Using detected tournament: "${tournament.name}" (id=${tournament.id}, mode=${tournament.tournament_mode})`);

    // ========== TEAM TOURNAMENTS ==========
    // For team tournaments: cannot determine winner without knowing side-to-team mapping
    // Always mark as confidence=1 and let players confirm via UI
    // ========== 1V1 TOURNAMENTS ==========
    // For 1v1 tournaments: can determine winner from parsed replay data
    // Use confidence level from victory detection (may be 1 or 2)
    if (tournament.tournament_mode === 'team') {
      return await this.linkToTeamTournament(replay, parseSummary, tournament);
    }

    // For 1v1 tournaments, use winner/loser detection
    // Resolve winner and loser user IDs from parseSummary
    const winnerName = parseSummary.replayVictory?.winner_name;
    const loserName  = parseSummary.replayVictory?.loser_name;

    if (!winnerName || !loserName) {
      console.log(`   ❌ [TOURNAMENT LINK] Missing winner/loser names in parseSummary`);
      return false;
    }

    const winnerUser = await this.getUserDataByNickname(winnerName);
    const loserUser  = await this.getUserDataByNickname(loserName);

    if (!winnerUser || !loserUser) {
      console.log(`   ❌ [TOURNAMENT LINK] Users not found: winner=${winnerName}, loser=${loserName}`);
      return false;
    }

    // Verify both players are active approved participants in this tournament
    const participantsResult = await query(
      `SELECT user_id, team_id FROM tournament_participants
       WHERE tournament_id = ?
         AND user_id IN (?, ?)
         AND status = 'active'
         AND participation_status = 'accepted'`,
      [tournament.id, winnerUser.id, loserUser.id]
    );

    const participants = (participantsResult as any).rows || [];
    if (participants.length < 2) {
      console.log(`   ❌ [TOURNAMENT LINK] Not all players are active approved participants (found ${participants.length}/2)`);
      return false;
    }

    // 1v1 tournament: search by player IDs directly
    // For league tournaments all rounds are open simultaneously, so we search across all rounds
    // and use ORDER BY round_number ASC to resolve double round-robin ambiguity (earliest pending first)
    const isLeague = tournament.tournament_type === 'league';
    const roundMatchResult = await query(
      isLeague
        ? `SELECT trm.id, trm.player1_id, trm.player2_id
           FROM tournament_round_matches trm
           JOIN tournament_rounds tr ON trm.round_id = tr.id
           WHERE trm.tournament_id = ?
             AND trm.series_status = 'in_progress'
             AND (
               (trm.player1_id = ? AND trm.player2_id = ?)
               OR
               (trm.player1_id = ? AND trm.player2_id = ?)
             )
           ORDER BY tr.round_number ASC
           LIMIT 1`
        : `SELECT trm.id, trm.player1_id, trm.player2_id
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

    const roundMatches = (roundMatchResult as any).rows || [];
    if (roundMatches.length === 0) {
      console.log(`   ❌ [TOURNAMENT LINK] No open tournament_round_match found for ${winnerName} vs ${loserName}`);
      return false;
    }

    const roundMatch = roundMatches[0];
    console.log(`   ✅ [TOURNAMENT LINK] Linked to round_match id=${roundMatch.id}`);

    parseSummary.linkedTournamentId           = tournament.id;
    parseSummary.linkedTournamentRoundMatchId = roundMatch.id;
    return true;
  }

  /**
   * Link team tournament replays without determining winner/loser
   * 
   * CRITICAL: For team tournaments, we CANNOT reliably determine which team won
   * because we don't know the side-to-team mapping. Example:
   * - Game has sides 1,2,3,4 - but we don't know which pairs are allied
   * - Isars Cross: sides (1,4) vs (2,3), but parser sees "side 1 won"
   * - Without knowing the alliance structure, we can't map side 1 to its team
   * 
   * Solution: ALWAYS mark as confidence=1 (requires manual confirmation)
   * Players will confirm the result via UI, then updateTournamentRoundMatch() handles progression
   * 
   * In contrast, 1v1 tournaments CAN determine winner reliably (two players, clear victory)
   */
  private async linkToTeamTournament(replay: UnparsedReplay, parseSummary: ParseSummary, tournament: any): Promise<boolean> {
    console.log(`   [TEAM TOURNAMENT] Extracting all players and their teams...`);

    // Get ALL players in the replay
    const forumPlayers = parseSummary.forumPlayers;
    if (forumPlayers.length < 2) {
      console.log(`   ❌ [TEAM TOURNAMENT] Not enough players in replay (${forumPlayers.length})`);
      return false;
    }

    // Map each player to their UUID
    const playerPromises = forumPlayers.map((p: any) => this.getUserDataByNickname(p.user_name));
    const users = await Promise.all(playerPromises);

    // Verify all players were found
    const notFound = forumPlayers.filter((p: any, i: number) => !users[i]);
    if (notFound.length > 0) {
      console.log(`   ❌ [TEAM TOURNAMENT] Players not found in users_extension: ${notFound.map((p: any) => p.user_name).join(', ')}`);
      return false;
    }

    const userIds = users.map((u: any) => u.id);

    // Get participants with their teams
    console.log(`   [TEAM TOURNAMENT] Querying tournament_participants for ${userIds.length} players...`);
    const participantsResult = await query(
      `SELECT user_id, team_id FROM tournament_participants
       WHERE tournament_id = ?
         AND user_id IN (${userIds.map(() => '?').join(',')})
         AND status = 'active'
         AND participation_status = 'accepted'`,
      [tournament.id, ...userIds]
    );

    const participants = (participantsResult as any).rows || [];
    if (participants.length < 2) {
      console.log(`   ❌ [TEAM TOURNAMENT] Not enough active participants (found ${participants.length}/${userIds.length})`);
      return false;
    }

    // Extract unique teams from participants
    const teamIds = new Set(participants.map((p: any) => p.team_id));
    console.log(`   [TEAM TOURNAMENT] Found ${teamIds.size} unique team(s): ${Array.from(teamIds).join(', ')}`);
    console.log(`   [TEAM TOURNAMENT] Participant breakdown:`, participants.map((p: any) => ({ user_id: p.user_id, team_id: p.team_id })));

    if (teamIds.size !== 2) {
      console.log(`   ❌ [TEAM TOURNAMENT] Expected exactly 2 teams, found ${teamIds.size}`);
      return false;
    }

    const teams = Array.from(teamIds) as string[];
    const team1 = teams[0];
    const team2 = teams[1];

    console.log(`   ✅ [TEAM TOURNAMENT] Teams identified: ${team1} vs ${team2}`);

    // Verify both teams have players
    const team1Players = participants.filter((p: any) => p.team_id === team1);
    const team2Players = participants.filter((p: any) => p.team_id === team2);
    console.log(`   [TEAM TOURNAMENT] Team 1 has ${team1Players.length} players, Team 2 has ${team2Players.length} players`);

    if (team1Players.length === 0 || team2Players.length === 0) {
      console.log(`   ❌ [TEAM TOURNAMENT] One or both teams have no players`);
      return false;
    }

    // Find active round (for non-league) or search across all rounds (for league)
    // League tournaments have all rounds open simultaneously
    const isLeagueTournament = tournament.tournament_type === 'league';

    let roundMatchResult;
    if (isLeagueTournament) {
      // League: search across all rounds, earliest pending round first (resolves double round-robin ambiguity)
      console.log(`   [TEAM TOURNAMENT] League tournament — searching across all rounds...`);
      roundMatchResult = await query(
        `SELECT trm.id, trm.player1_id, trm.player2_id FROM tournament_round_matches trm
         JOIN tournament_rounds tr ON trm.round_id = tr.id
         WHERE trm.tournament_id = ?
           AND trm.series_status = 'in_progress'
           AND (
             (trm.player1_id = ? AND trm.player2_id = ?)
             OR
             (trm.player1_id = ? AND trm.player2_id = ?)
           )
         ORDER BY tr.round_number ASC
         LIMIT 1`,
        [tournament.id, team1, team2, team2, team1]
      );
    } else {
      // Non-league: search only in the currently active round
      console.log(`   [TEAM TOURNAMENT] Searching for active round...`);
      const roundResult = await query(
        `SELECT id FROM tournament_rounds
         WHERE tournament_id = ?
           AND round_status = 'in_progress'
         LIMIT 1`,
        [tournament.id]
      );

      const rounds = (roundResult as any).rows || [];
      if (rounds.length === 0) {
        console.log(`   ❌ [TEAM TOURNAMENT] No active round found`);
        return false;
      }

      const roundId = rounds[0].id;
      console.log(`   ✅ [TEAM TOURNAMENT] Active round: ${roundId}`);

      // Search for tournament_round_match with these 2 teams in the active round
      console.log(`   [TEAM TOURNAMENT] Searching for tournament_round_match between teams...`);
      roundMatchResult = await query(
        `SELECT id, player1_id, player2_id FROM tournament_round_matches
         WHERE tournament_id = ?
           AND round_id = ?
           AND series_status = 'in_progress'
           AND (
             (player1_id = ? AND player2_id = ?)
             OR
             (player1_id = ? AND player2_id = ?)
           )
         LIMIT 1`,
        [tournament.id, roundId, team1, team2, team2, team1]
      );
    }

    const roundMatches = (roundMatchResult as any).rows || [];
    if (roundMatches.length === 0) {
      console.log(`   ❌ [TEAM TOURNAMENT] No pending tournament_round_match found for:`);
      console.log(`      Tournament ID: ${tournament.id}`);
      console.log(`      Team 1: ${team1}`);
      console.log(`      Team 2: ${team2}`);
      console.log(`   [TEAM TOURNAMENT] Showing all in-progress matches in tournament...`);
      
      // Debug: show all in-progress matches in tournament
      const allMatchesResult = await query(
        `SELECT trm.id, trm.player1_id, trm.player2_id, trm.series_status, tr.round_number
         FROM tournament_round_matches trm
         JOIN tournament_rounds tr ON trm.round_id = tr.id
         WHERE trm.tournament_id = ? AND trm.series_status = 'in_progress'
         ORDER BY tr.round_number ASC`,
        [tournament.id]
      );
      const allMatches = (allMatchesResult as any).rows || [];
      console.log(`   [TEAM TOURNAMENT] Available in-progress matches:`, allMatches.map((m: any) => ({ 
        id: m.id, 
        round: m.round_number,
        player1_id: m.player1_id, 
        player2_id: m.player2_id, 
        series_status: m.series_status 
      })));
      
      return false;
    }

    const roundMatch = roundMatches[0];
    console.log(`   ✅ [TEAM TOURNAMENT] Linked to round_match id=${roundMatch.id}`);

    parseSummary.linkedTournamentId           = tournament.id;
    parseSummary.linkedTournamentRoundMatchId = roundMatch.id;
    parseSummary.confidenceLevel              = 1;  // Requires manual confirmation
    console.log(`   ℹ️  [TEAM TOURNAMENT] Marked as confidence=1 (requires manual confirmation)`);

    // Enrich parseSummary with detected team information
    console.log(`   [TEAM TOURNAMENT] Building detectedTeams structure...`);
    parseSummary.detectedTeams = {};
    
    // Get team names from database
    const teamNamesResult = await query(
      `SELECT id, name FROM tournament_teams
       WHERE tournament_id = ?
         AND id IN (${[team1, team2].map(() => '?').join(',')})`,
      [tournament.id, team1, team2]
    );
    
    const teamNamesRows = (teamNamesResult as any).rows || [];
    const teamNamesMap: Record<string, string> = {};
    teamNamesRows.forEach((row: any) => {
      teamNamesMap[row.id] = row.name;
    });
    
    // Get user nicknames to UUID mapping from users_extension
    const nicknames = forumPlayers.map((fp: any) => fp.user_name);
    const usersExtResult = await query(
      `SELECT id, nickname FROM users_extension
       WHERE LOWER(nickname) IN (${nicknames.map(() => 'LOWER(?)').join(',')})`,
      nicknames
    );
    
    const usersExtRows = (usersExtResult as any).rows || [];
    const nicknameToUUID: Record<string, string> = {};
    usersExtRows.forEach((row: any) => {
      nicknameToUUID[row.nickname.toLowerCase()] = row.id;
    });
    
    console.log(`   [TEAM TOURNAMENT] Debug: nicknameToUUID = ${JSON.stringify(nicknameToUUID)}`);
    
    // Create a map of UUID to team_id
    const uuidToTeamId: Record<string, string> = {};
    participants.forEach((p: any) => {
      uuidToTeamId[p.user_id] = p.team_id;
    });
    
    console.log(`   [TEAM TOURNAMENT] Debug: uuidToTeamId = ${JSON.stringify(uuidToTeamId)}`);
    
    // Build detectedTeams for both teams
    for (const currentTeamId of [team1, team2]) {
      const teamName = teamNamesMap[currentTeamId] || 'Unknown Team';
      
      // Get player names and sides from forumPlayers that belong to this team
      const playerNicknames: string[] = [];
      const playerSides: number[] = [];
      const playerFactions: string[] = [];
      
      for (const forumPlayer of forumPlayers) {
        const uuid = nicknameToUUID[forumPlayer.user_name.toLowerCase()];
        const teamId = uuid ? uuidToTeamId[uuid] : null;
        
        if (teamId === currentTeamId) {
          console.log(`      [TEAM TOURNAMENT] Found ${forumPlayer.user_name} in team ${currentTeamId}`);
          playerNicknames.push(forumPlayer.user_name);
          playerSides.push(forumPlayer.side_number);
          playerFactions.push(forumPlayer.faction);
        }
      }
      
      // Determine team WML name by checking sides in wmlTeams
      const teamWmlNames = new Set<string>();
      playerSides.forEach(side => {
        if (parseSummary.wmlTeams && parseSummary.wmlTeams[side as any]) {
          teamWmlNames.add(parseSummary.wmlTeams[side as any]);
        }
      });
      const teamWmlName = Array.from(teamWmlNames)[0] || 'unknown';
      
      parseSummary.detectedTeams![currentTeamId as string] = {
        team_id: currentTeamId,
        team_name: teamName,
        team_wml_name: teamWmlName,
        members: playerNicknames,
        sides: playerSides,
        factions: playerFactions
      };
      
      console.log(`   [TEAM TOURNAMENT] Team "${teamName}" (${teamWmlName}): members=${playerNicknames.join(', ')}, sides=${playerSides.join(',')}, factions=${playerFactions.join(',')}`);
    }

    return true;
  }

  /**
   * Get unparsed replays from database
   */
  private async getUnparsedReplays(): Promise<UnparsedReplay[]> {
    const result = await query(
      `SELECT id, instance_uuid, game_id, replay_filename, replay_url, 
              wesnoth_version, game_name, start_time, end_time, created_at, oos
       FROM replays
       WHERE parse_status = 'new' AND parsed = 0
       ORDER BY created_at ASC
       LIMIT 50`,
      []
    );

    return ((result as any).rows || []) as UnparsedReplay[];
  }

  private async parseReplayFromUrl(
    replay: UnparsedReplay,
    forumPlayers?: any[],
    hasCustomFaction?: boolean
  ): Promise<ParsedRankedReplay | null> {
    try {
      const localPath = await this.downloadReplayFile(replay.replay_url, replay.wesnoth_version);
      // If forum has Custom factions, MUST extract from replay (don't skip)
      // Otherwise, can skip if we have valid forum players
      const skipPlayers = !hasCustomFaction && !!forumPlayers;
      
      const parsed = await parseRankedReplay(localPath, {
        skipExtractPlayers: skipPlayers,
        forumPlayers: forumPlayers || []
      });

      // Clean up
      try {
        fs.unlinkSync(localPath);
      } catch {}

      return parsed;
    } catch (err) {
      const errorMsg = (err as any)?.message || String(err);
      console.warn(`⚠️  [PARSE] Failed to parse replay:`, errorMsg);
      throw err;
    }
  }

  /**
   * Download replay file from local Wesnoth directory
   */
  private async downloadReplayFile(url: string, version: string): Promise<string> {
    try {
      const tmpDir = path.join(process.cwd(), '.tmp', 'replays');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      // Extract path components from URL
      // Format: https://replays.wesnoth.org/1.18/2026/02/21/filename.bz2
      const urlParts = url.split('/');
      const filename = urlParts[urlParts.length - 1];
      const day = urlParts[urlParts.length - 2];
      const month = urlParts[urlParts.length - 3];
      const year = urlParts[urlParts.length - 4];
      const urlVersion = urlParts[urlParts.length - 5];

      const localPath = `/scratch/wesnothd-public-replays/${urlVersion}/${year}/${month}/${day}/${filename}`;

      if (!fs.existsSync(localPath)) {
        throw new Error(`Replay file not found: ${localPath}`);
      }

      const tmpPath = path.join(tmpDir, `${Date.now()}_${filename}`);
      fs.copyFileSync(localPath, tmpPath);

      console.log(`   ✅ Downloaded: ${tmpPath}`);
      return tmpPath;

    } catch (err) {
      throw err;
    }
  }

  /**
   * Resolve faction name against factions table
   * Searches with: exact match → without prefix → canonical match
   */
  private async resolveFaction(factionName: string | null): Promise<{ name: string | null; isRanked: boolean }> {
    if (!factionName) {
      return { name: null, isRanked: false };
    }

    try {
      // Try exact match first
      let result = await query(
        `SELECT name, is_ranked FROM factions WHERE LOWER(name) = LOWER(?) LIMIT 1`,
        [factionName]
      );

      if ((result as any).rows?.length > 0) {
        const faction = (result as any).rows[0];
        return { name: faction.name, isRanked: faction.is_ranked === 1 };
      }

      // Try without prefix (e.g., "Ladder Rebels" -> "Rebels")
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

      // Try LIKE match (partial)
      result = await query(
        `SELECT name, is_ranked FROM factions WHERE LOWER(name) LIKE LOWER(?) LIMIT 1`,
        [`%${factionName}%`]
      );

      if ((result as any).rows?.length > 0) {
        const faction = (result as any).rows[0];
        return { name: faction.name, isRanked: faction.is_ranked === 1 };
      }

      return { name: factionName, isRanked: false };
    } catch (err) {
      console.warn(`⚠️  Could not resolve faction "${factionName}":`, err);
      return { name: factionName, isRanked: false };
    }
  }

  /**
   * Resolve map name against game_maps table.
   * Tries multiple strategies (exact, prefix-stripped, LIKE, fuzzy with \ufffd→%).
   * Prefers ranked results: never stops early on an unranked match — saves it as
   * fallback and keeps searching for a ranked entry.
   */
  private async resolveMap(
    mapName: string | null,
    mapId: string | null = null,
    ignoreLadderSuffix: boolean = false
  ): Promise<{ name: string | null; isRanked: boolean }> {
    if (!mapName) {
      return { name: null, isRanked: false };
    }

    // Normalize typographic/smart quotes to plain ASCII equivalents so forum
    // strings like "Sulla\u2019s Ruins" match DB entries stored as "Sulla's Ruins".
    const normalizeQuotes = (s: string) =>
      s.replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'")
       .replace(/[\u201c\u201d]/g, '"');

    // Remove all apostrophes for comparison (handles "Sullas Ruins" vs "Sulla's Ruins")
    const removeApostrophes = (s: string) => s.replace(/'/g, '');
    // Ignore Ladder suffixes from forum/replay naming only when ladder_era is detected
    const stripLadderSuffix = (s: string) =>
      s
        .replace(/\s*\(ladder\)\s*$/i, '')
        .replace(/[_\s-]+ladder\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const mapNameNorm = normalizeQuotes(mapName);
    const mapNameNoApos = removeApostrophes(mapName);  // Apply to ORIGINAL, not to normalized

    console.log(`   [MAP DEBUG] Input mapName: "${mapName}"`);
    console.log(`   [MAP DEBUG] After normalizeQuotes: "${mapNameNorm}"`);
    console.log(`   [MAP DEBUG] After removeApostrophes: "${mapNameNoApos}"`);
    console.log(`   [MAP DEBUG] mapNameNorm === mapName? ${mapNameNorm === mapName}`);
    console.log(`   [MAP DEBUG] mapNameNoApos === mapNameNorm? ${mapNameNoApos === mapNameNorm}`);

    // Helper: run a query and return ranked result (is_ranked = 1)
    // IMPORTANT: Only search for ranked maps - do NOT fallback to unranked maps.
    // A map must be explicitly marked as ranked to be eligible for ranked matches.
    const tryQuery = async (sql: string, params: any[], description: string): Promise<{ name: string; isRanked: boolean } | null> => {
      console.log(`   [MAP DEBUG] Trying: ${description}`);
      console.log(`   [MAP DEBUG]   SQL: ${sql}`);
      console.log(`   [MAP DEBUG]   Params: [${params.map(p => `"${p}"`).join(', ')}]`);
      
      const result = await query(sql, params);
      const rows = (result as any).rows || [];
      
      console.log(`   [MAP DEBUG]   Result rows: ${rows.length}`);
      if (rows.length > 0) {
        rows.forEach((row: any, idx: number) => {
          console.log(`   [MAP DEBUG]     Row ${idx}: name="${row.name}", is_ranked=${row.is_ranked}`);
        });
      }
      
      if (rows.length === 0) return null;
      const map = rows[0];
      // Return only if this is a ranked map (is_ranked = 1)
      if (map.is_ranked === 1) {
        console.log(`   [MAP DEBUG]   ✅ MATCH FOUND (ranked)`);
        return { name: map.name as string, isRanked: true };
      }
      // Unranked maps are not eligible for ranked match validation
      console.log(`   [MAP DEBUG]   ❌ Found but not ranked (is_ranked=${map.is_ranked})`);
      return null;
    };

    try {
      // 0. Try exact match by map ID (from forum wesnothd_game_content_info) - highest priority
      if (mapId) {
        const mapIdWithoutPrefix = mapId.replace(/^multiplayer_/, '').replace(/_/g, ' ');
        console.log(`   [MAP DEBUG] Step 0: Trying by map ID: "${mapId}" → "${mapIdWithoutPrefix}"`);
        const mapIdCandidates = ignoreLadderSuffix
          ? [mapIdWithoutPrefix, stripLadderSuffix(mapIdWithoutPrefix)].filter((candidate, index, arr) => candidate && arr.indexOf(candidate) === index)
          : [mapIdWithoutPrefix];

        for (const mapIdCandidate of mapIdCandidates) {
          const hit = await tryQuery(
            `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
            [mapIdCandidate],
            mapIdCandidate === mapIdWithoutPrefix ? `Map ID exact match` : `Map ID exact match without Ladder suffix`
          );
          if (hit) {
            console.log(`   📌 Matched by map ID: ${mapId} → ${hit.name}`);
            return hit;
          }
        }
      }

      // 1. Exact match on original name (ORDER BY is_ranked DESC so ranked rows come first)
      console.log(`   [MAP DEBUG] Step 1: Trying exact match on original`);
      let hit = await tryQuery(
        `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
        [mapName],
        `Exact match on original "${mapName}"`
      );
      if (hit) return hit;

      // 1d. Exact match ignoring Ladder suffix in source map naming
      const mapNameNoLadder = ignoreLadderSuffix ? stripLadderSuffix(mapNameNorm) : mapNameNorm;
      if (ignoreLadderSuffix && mapNameNoLadder && mapNameNoLadder !== mapNameNorm) {
        console.log(`   [MAP DEBUG] Step 1d: Trying without Ladder suffix: "${mapNameNorm}" → "${mapNameNoLadder}"`);
        hit = await tryQuery(
          `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
          [mapNameNoLadder],
          `Exact match without Ladder suffix "${mapNameNoLadder}"`
        );
        if (hit) return hit;
      }

      // 1b. Exact match with normalized quotes (handles forum U+2019 vs DB U+0027)
      console.log(`   [MAP DEBUG] Step 1b: mapNameNorm !== mapName? ${mapNameNorm !== mapName}`);
      if (mapNameNorm !== mapName) {
        hit = await tryQuery(
          `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
          [mapNameNorm],
          `Exact match on normalized "${mapNameNorm}"`
        );
        if (hit) return hit;
      }

      // 1c. Exact match ignoring apostrophes (handles "Sullas Ruins" vs "Sulla's Ruins")
      console.log(`   [MAP DEBUG] Step 1c: mapNameNoApos !== mapNameNorm? ${mapNameNoApos !== mapNameNorm}`);
      if (mapNameNoApos !== mapNameNorm) {
        console.log(`   [MAP DEBUG]   Will try REPLACE query with: "${mapNameNoApos}"`);
        hit = await tryQuery(
          `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = LOWER(?) ORDER BY is_ranked DESC LIMIT 1`,
          [mapNameNoApos],
          `Exact match ignoring apostrophes (REPLACE) for "${mapNameNoApos}"`
        );
        if (hit) {
          console.log(`   📌 Matched ignoring apostrophes: "${mapName}" → "${hit.name}"`);
          return hit;
        }
      } else {
        console.log(`   [MAP DEBUG]   SKIPPING 1c: mapNameNoApos === mapNameNorm`);
      }

      // 2. Strip "Np —" / "Np \ufffd" prefix, then exact match
      const cleaned = mapName.replace(/^\d+[a-z]?\s*[—\-–\ufffd]\s*/i, '').trim();
      const cleanedNorm = normalizeQuotes(cleaned);
      const cleanedNoApos = removeApostrophes(cleaned);  // Apply to ORIGINAL cleaned, not normalized
      if (cleaned !== mapName) {
        console.log(`   [MAP DEBUG] Step 2: Prefix stripping: "${mapName}" → "${cleaned}"`);
        // 2a. Exact match on normalized stripped name
        hit = await tryQuery(
          `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
          [cleanedNorm],
          `Exact match on cleaned normalized "${cleanedNorm}"`
        );
        if (hit) return hit;

        // 2b. Exact match on raw stripped name (if different from normalized)
        if (cleanedNorm !== cleaned) {
          hit = await tryQuery(
            `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
            [cleaned],
            `Exact match on cleaned raw "${cleaned}"`
          );
          if (hit) return hit;
        }

        // 2c. Exact match ignoring apostrophes on stripped name
        if (cleanedNoApos !== cleanedNorm) {
          hit = await tryQuery(
            `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = LOWER(?) ORDER BY is_ranked DESC LIMIT 1`,
            [cleanedNoApos],
            `Exact match ignoring apostrophes (REPLACE) on cleaned "${cleanedNoApos}"`
          );
          if (hit) return hit;
        }

        // 2d. Exact match on cleaned name without Ladder suffix
        const cleanedNoLadder = ignoreLadderSuffix ? stripLadderSuffix(cleanedNorm) : cleanedNorm;
        if (ignoreLadderSuffix && cleanedNoLadder && cleanedNoLadder !== cleanedNorm) {
          hit = await tryQuery(
            `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") = REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
            [cleanedNoLadder],
            `Exact match on cleaned normalized without Ladder suffix "${cleanedNoLadder}"`
          );
          if (hit) return hit;
        }
      }

      // 3. LIKE on normalized map name
      console.log(`   [MAP DEBUG] Step 3: LIKE match`);
      hit = await tryQuery(
        `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") LIKE REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
        [`%${mapNameNorm}%`],
        `LIKE match on normalized "${mapNameNorm}"`
      );
      if (hit) return hit;

      // 4. Fuzzy on prefix-stripped name (replace \ufffd with % wildcard)
      const fuzzyClean = cleanedNorm.replace(/\s*\ufffd\s*/g, '%').replace(/%+/g, '%');
      if (fuzzyClean !== cleanedNorm && cleaned !== mapName) {
        hit = await tryQuery(
          `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") LIKE REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
          [fuzzyClean],
          `LIKE fuzzy on cleaned "${fuzzyClean}"`
        );
        if (hit) return hit;
      }

      // 5. Fuzzy on raw map name (replace \ufffd with %)
      const fuzzyRaw = mapNameNorm.replace(/\s*\ufffd\s*/g, '%').replace(/%+/g, '%');
      if (fuzzyRaw !== mapNameNorm) {
        hit = await tryQuery(
          `SELECT name, is_ranked FROM game_maps WHERE REPLACE(LOWER(name), "'", "") LIKE REPLACE(LOWER(?), "'", "") ORDER BY is_ranked DESC LIMIT 1`,
          [fuzzyRaw],
          `LIKE fuzzy on raw "${fuzzyRaw}"`
        );
        if (hit) return hit;
      }

      // No ranked map found — return false (map not eligible for ranked matches)
      console.log(`   [MAP DEBUG] ❌ NO RANKED MAP FOUND - returning isRanked: false`);
      return { name: mapName, isRanked: false };
    } catch (err) {
      console.warn(`⚠️  Could not resolve map "${mapName}":`, err);
      return { name: mapName, isRanked: false };
    }
  }

  /**
   * Extract map name from scenario_id when forum name is corrupted.
   * For ladder_era: "multiplayer_Swamp_of_Dread_Ladder_Random" → "Swamp of Dread"
   * For ranked_era: "multiplayer_Map_Name_Ranked_Random" → "Map Name"
   */
  private extractMapNameFromScenarioId(scenarioId: string, addonId: string): string | null {
    if (!scenarioId) return null;
    
    try {
      let name = scenarioId;
      
      // Remove "multiplayer_" prefix
      name = name.replace(/^multiplayer_/i, '');
      
      // Remove suffix based on addon
      if (addonId?.toLowerCase() === 'ladder_era') {
        name = name.replace(/_Ladder_Random$/i, '');
        name = name.replace(/_Ladder$/i, '');
      } else if (addonId?.toLowerCase() === 'ranked_era') {
        name = name.replace(/_Ranked_Random$/i, '');
      }
      
      // Replace underscores with spaces
      name = name.replace(/_/g, ' ');
      
      // Clean up multiple spaces
      name = name.replace(/\s+/g, ' ').trim();
      
      return name && name.length > 2 ? name : null;
    } catch (err) {
      console.warn(`⚠️  Could not extract map name from scenario_id "${scenarioId}":`, err);
      return null;
    }
  }

  /**
   * Get job status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt
    };
  }
}

export default ParseNewReplaysRefactorized;
