/**
 * Background Job: Parse New Replays (FORUM-FIRST APPROACH)
 * File: backend/src/jobs/parseNewReplaysRefactored.ts
 * 
 * Data Flow:
 * 1. Prefer the server-authoritative competitive_game model when the game
 *    exposes competitive_game_id; otherwise use the legacy Ranked add-on and
 *    wesnothd_game_content_info markers
 * 2. Query wesnothd_game_player_info for player nicknames, sides, factions  
 * 3. Query wesnothd_game_content_info for scenario/map name
 * 4. If forum factions are "Custom" → search replay for actual factions
 * 5. Parse WML only for legacy metadata, or for the narrow new-model fields
 *    that are not available in the server records: ranked/ladder era map or
 *    factions and ranked_map_picker selected map
 * 6. Validate factions and map against assets
 * 7. Report parse_summary with all detected information
 * 8. Create match with appropriate confidence level
 */

import { query } from '../config/database.js';
import { queryForum, getCompetitiveGameData } from '../config/forumDatabase.js';
import ReplayParser from '../services/replayParser.js';
import { parseRankedReplay, ParsedRankedReplay } from '../utils/replayRankedParser.js';
import { createMatch } from '../services/matchCreationService.js';
import { checkForumBanlist } from '../services/phpbbAuth.js';
import { queryPhpbb } from '../config/phpbbDatabase.js';
import * as fs from 'fs';
import * as path from 'path';
import { parseTournamentCode } from '../tournament-engine/forumTopic.js';
import { recordPhaseGameResult } from '../tournament-engine/competitionProgression.js';
import { shouldPauseReplayProcessing } from '../services/systemPauseService.js';

/** Resolve an active tournament by explicit forum code first, then by its exact name. */
async function findTournamentForGameName(gameName: string, modes: string[]): Promise<any | null> {
  const topicId = parseTournamentCode(gameName);
  const modePlaceholders = modes.map(() => '?').join(', ');
  if (topicId !== null) {
    const result = await query(
      `SELECT id, name, tournament_mode, tournament_type, competition_model_version
       FROM tournaments
       WHERE status = 'in_progress' AND tournament_mode IN (${modePlaceholders}) AND forum_topic_id = ?`,
      [...modes, topicId]
    );
    if (result.rows.length === 1) return result.rows[0];
  }
  const result = await query(
    `SELECT id, name, tournament_mode, tournament_type, competition_model_version
     FROM tournaments
     WHERE status = 'in_progress' AND tournament_mode IN (${modePlaceholders}) AND LOWER(name) = LOWER(?)
     LIMIT 2`,
    [...modes, gameName]
  );
  // Exact-name collisions are deliberately left unlinked for manual resolution.
  return result.rows.length === 1 ? result.rows[0] : null;
}

/** Resolve a tournament from the explicit ID written by the Wesnoth server. */
async function findTournamentById(tournamentId: string, modes: string[]): Promise<any | null> {
  const modePlaceholders = modes.map(() => '?').join(', ');
  const result = await query(
    `SELECT id, name, tournament_mode, tournament_type, competition_model_version
     FROM tournaments
     WHERE id = ? AND status = 'in_progress' AND tournament_mode IN (${modePlaceholders})
     LIMIT 1`,
    [tournamentId, ...modes]
  );
  return (result as any).rows?.[0] || null;
}

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
  competitiveGameId: string | null;
  competitiveGameStatus: string | null;
  competitiveGameType: string | null;
  competitivePlayers: Array<any>;
  rejectedBecauseCompetitiveSave: boolean;
  forumAddon: any | null;
  // New server-side markers. These allow processing replays without the
  // Ranked add-on while the legacy add-on remains supported.
  forumRankedMarker: boolean;
  forumTournamentMarker: boolean;
  forumTournamentId: string | null;
  forumTournamentGameId: string | null;
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
  linkedTournamentId: string | null;
  linkedTournamentGameId: string | null;
  tournamentLinkMethod: 'tournament_game' | 'participants' | null;
  linkedWinnerEntryId: string | null;
  // Cached tournament record found during match type detection (avoid double DB lookup)
  detectedTournament: { id: string; name: string; tournament_mode: string; tournament_type: string; competition_model_version?: number } | null;
  // Team information used when displaying a team replay awaiting confirmation.
  detectedTeams?: Record<string, {
    team_id: string;
    team_name: string;
    team_wml_name: string; // 'north-east' or 'south-west' etc from WML
    members: string[]; // player nicknames
    sides: number[]; // WML side numbers
    factions: string[]; // faction names from forumPlayers
  }>;
}

/**
 * Extract display metadata for a phase-engine game from the validated replay.
 * Team games store faction lists and leave winner_side unset because their
 * WML sides are not restricted to the 1v1 S1/S2 invariant.
 */
function phaseGameDisplayMetadata(parseSummary: ParseSummary): {
  map: string | null;
  winnerFaction: string | null;
  loserFaction: string | null;
  winnerSide: number | null;
} {
  const winnerName = parseSummary.replayVictory?.winner_name?.toLowerCase();
  const winnerTeam = Object.values(parseSummary.detectedTeams || {}).find(team =>
    team.members.some(member => member.toLowerCase() === winnerName)
  );
  if (winnerTeam) {
    const loserTeam = Object.values(parseSummary.detectedTeams || {}).find(team => team.team_id !== winnerTeam.team_id);
    return {
      map: parseSummary.resolvedMap,
      winnerFaction: winnerTeam.factions.join(', ') || null,
      loserFaction: loserTeam?.factions.join(', ') || null,
      winnerSide: null,
    };
  }

  const winner = parseSummary.forumPlayers.find(player => player.user_name?.toLowerCase() === winnerName);
  const loserName = parseSummary.replayVictory?.loser_name?.toLowerCase();
  const loser = parseSummary.forumPlayers.find(player => player.user_name?.toLowerCase() === loserName);
  const winnerSide = Number(winner?.side_number);
  return {
    map: parseSummary.resolvedMap,
    winnerFaction: winner ? parseSummary.resolvedFactions[`side${winner.side_number}`] || null : null,
    loserFaction: loser ? parseSummary.resolvedFactions[`side${loser.side_number}`] || null : null,
    winnerSide: winnerSide === 1 || winnerSide === 2 ? winnerSide : null,
  };
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
    if (await shouldPauseReplayProcessing()) {
      console.log('⏸️  [PARSE] Skipping cycle during maintenance or global recalculation');
      return { parsed_count: 0, match_count: 0, errors: 0, duration_ms: 0 };
    }

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

          // For tournament matches, link to the specific tournament_game.
          if (parseSummary.matchType === 'tournament_ranked' || parseSummary.matchType === 'tournament_unranked') {
            const linked = await this.linkToTournament(parseSummary);
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

          // Check confidence level - only create match if confidence=2
          if (parseSummary.confidenceLevel === 1) {
            console.log(`⏳ [PARSE] Confidence=1 → Parsed but no match created (awaiting player confirmation)`);
            await query(
              `UPDATE replays SET parse_status = 'parsed', parsed = 1, need_integration = 1, integration_confidence = ?,
               tournament_id = ?, tournament_game_id = ?,
               tournament_link_method = ?, tournament_linked_at = CURRENT_TIMESTAMP,
               parse_error_message = NULL, parse_summary = ? WHERE id = ?`,
              [parseSummary.confidenceLevel, parseSummary.linkedTournamentId,
                parseSummary.linkedTournamentGameId, parseSummary.tournamentLinkMethod,
                JSON.stringify(parseSummary), replay.id]
            );
            parsedCount++;
            continue;
          }

          // Create match (only if confidence=2)
          let matchCreateResult;

          const isTournamentMatch = parseSummary.matchType === 'tournament_ranked' ||
            parseSummary.matchType === 'tournament_unranked';
          if (isTournamentMatch && (!parseSummary.linkedTournamentId || !parseSummary.linkedTournamentGameId)) {
            throw new Error(
              `Tournament match has incomplete linkage: tournament_id=${parseSummary.linkedTournamentId ?? 'NULL'}, ` +
              `tournament_game_id=${parseSummary.linkedTournamentGameId ?? 'NULL'}`
            );
          }

          if (parseSummary.matchType === 'tournament_unranked' && parseSummary.linkedTournamentGameId) {
            const metadata = phaseGameDisplayMetadata(parseSummary);
            await query(
              `UPDATE tournament_games
               SET map = ?, winner_faction = ?, loser_faction = ?, winner_side = ?
               WHERE id = ? AND status = 'pending'`,
              [metadata.map, metadata.winnerFaction, metadata.loserFaction, metadata.winnerSide, parseSummary.linkedTournamentGameId]
            );
            await recordPhaseGameResult(
              parseSummary.linkedTournamentId!,
              parseSummary.linkedTournamentGameId,
              parseSummary.linkedWinnerEntryId!
            );
            // Automatic replay detection records the game result, but it
            // must not impersonate the winner's Inform Match action.
            await query(
              `UPDATE tournament_games SET confirmation_status = 'unconfirmed' WHERE id = ?`,
              [parseSummary.linkedTournamentGameId]
            );
            matchCreateResult = { success: true, matchId: null };
          } else if (parseSummary.matchType === 'tournament_unranked') {
            // New-model tournament games are completed through tournament_games.
            // linkToTournament() rejects a tournament replay that cannot be linked
            // to a pending game, so reaching this branch indicates inconsistent data.
            throw new Error('Tournament replay has no linked tournament_game');
          } else {
            matchCreateResult = await this.createMatchFromParseSummary(replay, parseSummary);
            if (matchCreateResult.success && parseSummary.linkedTournamentGameId) {
              const metadata = phaseGameDisplayMetadata(parseSummary);
              await query(
                `UPDATE tournament_games
                 SET map = ?, winner_faction = ?, loser_faction = ?, winner_side = ?
                 WHERE id = ? AND status = 'pending'`,
                [metadata.map, metadata.winnerFaction, metadata.loserFaction, metadata.winnerSide, parseSummary.linkedTournamentGameId]
              );
              await recordPhaseGameResult(
                parseSummary.linkedTournamentId!,
                parseSummary.linkedTournamentGameId,
                parseSummary.linkedWinnerEntryId!,
                matchCreateResult.matchId
              );
              // Keep the completed game awaiting the winner's explicit
              // report; the loser can then confirm or dispute it.
              await query(
                `UPDATE tournament_games SET confirmation_status = 'unconfirmed' WHERE id = ?`,
                [parseSummary.linkedTournamentGameId]
              );
            }
          }

          if (matchCreateResult.success) {
            console.log(`✅ [PARSE] Match created: ID ${matchCreateResult.matchId}`);
            // For unranked tournament matches, match_id stays NULL (no entry in matches table)
            const replayMatchId = parseSummary.matchType === 'tournament_unranked' ? null : matchCreateResult.matchId;
            console.log(
              `🔗 [PARSE] Persisting replay linkage: match_id=${replayMatchId ?? 'NULL'}, ` +
              `tournament_id=${parseSummary.linkedTournamentId ?? 'NULL'}, ` +
              `tournament_game_id=${parseSummary.linkedTournamentGameId ?? 'NULL'}`
            );
            await query(
              `UPDATE replays SET parse_status = 'completed', parsed = 1, integration_confidence = ?,
               tournament_id = ?, tournament_game_id = ?,
               tournament_link_method = ?, tournament_linked_at = CURRENT_TIMESTAMP,
               match_id = ?, parse_error_message = NULL, parse_summary = ? WHERE id = ?`,
              [parseSummary.confidenceLevel, parseSummary.linkedTournamentId,
                parseSummary.linkedTournamentGameId, parseSummary.tournamentLinkMethod,
                replayMatchId, JSON.stringify(parseSummary), replay.id]
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
      competitiveGameId: null,
      competitiveGameStatus: null,
      competitiveGameType: null,
      competitivePlayers: [],
      rejectedBecauseCompetitiveSave: false,
      forumAddon: null,
      forumRankedMarker: false,
      forumTournamentMarker: false,
      forumTournamentId: null,
      forumTournamentGameId: null,
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
      linkedTournamentGameId: null,
      tournamentLinkMethod: null,
      linkedWinnerEntryId: null,
      detectedTournament: null
    };

    // The new Wesnoth tables are authoritative for completion and victory.
    // A missing result deliberately falls through to the legacy WML path.
    const competitive = await getCompetitiveGameData(replay.instance_uuid, replay.game_id);
    if (competitive) {
      const game = competitive.game;
      const value = (names: string[]): any => {
        for (const name of names) {
          const key = Object.keys(game).find(candidate => candidate.toLowerCase() === name.toLowerCase());
          if (key && game[key] !== null && game[key] !== undefined) return game[key];
        }
        return null;
      };
      parseSummary.competitiveGameId = String(value(['id', 'competitive_game_id']) ?? '');
      parseSummary.competitiveGameStatus = String(value(['status']) ?? '').toLowerCase();
      const competitiveTournamentId = value(['tournament_id', 'tournamentId']);
      const competitiveTournamentGameId = value(['tournament_game_id', 'tournamentGameId']);
      parseSummary.competitiveGameType = String(value([
        'type',
        'game_type',
        'competitive_type',
        'competitive_game_type',
        'match_type',
        'mode'
      ]) ?? '').trim().toLowerCase();
      // The tournament link is an unambiguous model discriminator even when
      // an older local schema does not expose the type column under the
      // canonical name.
      if (parseSummary.competitiveGameType !== 'ranked' && parseSummary.competitiveGameType !== 'tournament') {
        parseSummary.competitiveGameType = competitiveTournamentId || competitiveTournamentGameId ? 'tournament' : 'ranked';
      }
      parseSummary.competitivePlayers = competitive.players;
      if (parseSummary.competitiveGameType === 'ranked') {
        parseSummary.forumRankedMarker = true;
        parseSummary.replayRankedMode = true;
      } else if (parseSummary.competitiveGameType === 'tournament') {
        parseSummary.forumTournamentMarker = true;
        parseSummary.replayTournamentFlag = true;
      }

      // A tournament link is authoritative even when the competitive game
      // type is `ranked` (ranked tournament). It must not become a direct
      // ranked match merely because the mode is ranked.
      if (competitiveTournamentId || competitiveTournamentGameId) {
        parseSummary.forumTournamentMarker = true;
        parseSummary.replayTournamentFlag = true;
        parseSummary.forumTournamentId = String(competitiveTournamentId ?? '') || null;
        parseSummary.forumTournamentGameId = String(competitiveTournamentGameId ?? '') || null;
      }

      console.log(`✅ [FORUM] competitive model type=${parseSummary.competitiveGameType} tournament=${competitiveTournamentId ?? 'none'} tournament_game=${competitiveTournamentGameId ?? 'none'}`);

      if (parseSummary.competitiveGameStatus === 'active') {
        if (competitive.hasSave) {
          // A retained save is resumable, so this replay must not become a
          // match or a manual result. Reject it because the game can continue
          // from the server-side save instead of leaving it pending forever.
          parseSummary.rejectedBecauseCompetitiveSave = true;
          parseSummary.matchType = 'rejected';
          return parseSummary;
        }

        // The server still considers the game active, but no continuation
        // save exists. Continue parsing so an explicit replay victory can be
        // used; otherwise the normal unknown-victory path records confidence 1
        // for manual confirmation instead of keeping the replay pending.
        console.log(`⚠️ [FORUM] Active competitive game has no save; allowing provisional parsing`);
      }
    }

    // Some local Wesnoth builds expose the terminal state as `completed`,
    // while the protocol contract calls it `complete`.
    const competitiveGameComplete = Boolean(
      competitive && ['complete', 'completed'].includes(parseSummary.competitiveGameStatus || '')
    );

    // ======== STEP 1: Select the competitive-game model ========
    // Production's legacy model is identified only by the Ranked add-on; WML
    // then supplies ranked_mode and tournament=yes. A competitive_game_id is
    // the future model and bypasses the legacy add-on path entirely.
    if (competitive) {
      console.log(`📋 [FORUM] Step 1: Using competitive_game model; skipping legacy Ranked add-on`);
    } else {
      console.log(`📋 [FORUM] Step 1: Checking legacy Ranked add-on...`);
    }
    const addonResult = competitive ? [] : await queryForum(
      `SELECT addon_id, addon_version FROM wesnothd_game_content_info
       WHERE instance_uuid = ? AND game_id = ? AND type = 'modification' AND addon_id = 'Ranked' LIMIT 1`,
      [replay.instance_uuid, replay.game_id]
    );

    if (competitive) {
      console.log(`   ✅ Competitive game model selected; legacy markers ignored`);
    } else if (addonResult.length > 0) {
      parseSummary.forumAddon = addonResult[0];
      console.log(`   ✅ Found Ranked addon in forum`);
    } else {
      console.log(`   ⚠️  No Ranked addon or competitive_game_id found`);
      parseSummary.matchType = 'rejected';
      return parseSummary;
    }

    // ======== STEP 2: Query forum for players, sides, factions ========
    console.log(`📋 [FORUM] Step 2: Querying players...`);
    const playersResult = await queryForum(
      `SELECT user_id, user_name, faction, side_number 
       FROM wesnothd_game_player_info
       WHERE instance_uuid = ? AND game_id = ? AND user_id != -1 AND user_id IS NOT NULL
       ORDER BY side_number`,
      [replay.instance_uuid, replay.game_id]
    );

    if (playersResult.length < 2) {
      console.log(`   ❌ Less than 2 players found in forum`);
      parseSummary.matchType = 'rejected';
      return parseSummary;
    }

    parseSummary.forumPlayers = playersResult;
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
    const mapResult = await queryForum(
      `SELECT id, name FROM wesnothd_game_content_info
       WHERE instance_uuid = ? AND game_id = ? AND type = 'scenario' LIMIT 1`,
      [replay.instance_uuid, replay.game_id]
    );

    // Detect ranked_era and ranked_map_picker addons, fetch scenario ID and addon_id
    const addonCheckResult = await queryForum(
      `SELECT addon_id, id FROM wesnothd_game_content_info
       WHERE instance_uuid = ? AND game_id = ? AND type = 'scenario' LIMIT 2`,
      [replay.instance_uuid, replay.game_id]
    );
    
    let scenarioId: string | null = null;
    let eraAddonId: string | null = null;

    if (addonCheckResult.length > 0) {
      for (const addon of addonCheckResult) {
        scenarioId = addon.id;
        if (addon.addon_id === 'ranked_era' || addon.addon_id === 'ladder_era') {
          eraAddonId = addon.addon_id;
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

    if (mapResult.length > 0) {
      const forumMapFromDb = mapResult[0].name;
      const mapId = mapResult[0].id;
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

    // ======== STEPS 5-7: Parse replay only when it still provides metadata ========
    // New-model games get their victory from competitive_game_player. WML is
    // retained only for narrow metadata gaps: era map/factions and the map
    // selected by ranked_map_picker. It never supplies the result or mode.
    const shouldParseReplayWml = !competitive || parseSummary.hasRankedEra || parseSummary.hasRankedMapPicker;
    const needsLadderFactionWml = Boolean(
      competitive && eraAddonId?.toLowerCase() === 'ladder_era'
    );
    if (!shouldParseReplayWml) {
      console.log(`⏭️  [REPLAY] New competitive model without WML-required map/faction addon → skipping WML parsing`);
    } else {
      console.log(`🎬 [REPLAY] Parsing replay WML${competitive ? ' (selected map/faction metadata only)' : ' (legacy path)'}...`);
    }
    if (shouldParseReplayWml) try {
      const parsed = await this.parseReplayFromUrl(
        replay,
        parseSummary.forumPlayers,
        hasCustomFaction || needsLadderFactionWml
      );

      if (parsed) {
        // The competitive tables, not replay WML, define mode and tournament
        // identity for new-model games.
        if (competitive) {
          console.log(`   ✅ 5.1 Using competitive_game metadata for mode, tournament and victory`);
        } else if (parsed.addon) {
          // 5.1 Extract ranked_mode and tournament flag from legacy WML.
          parseSummary.replayRankedMode = Boolean(parsed.addon.ranked_mode);
          // Tournament flag indicates whether the game was marked as a tournament game in WML
          // Tournament name always comes from game_name in forum DB, never from WML
          parseSummary.replayTournamentFlag = Boolean(parsed.addon.tournament);
          console.log(`   ✅ 5.1 ranked_mode=${parseSummary.replayRankedMode}, tournament_flag=${parseSummary.replayTournamentFlag}`);
        } else {
          parseSummary.replayRankedMode = false;
          parseSummary.replayTournamentFlag = false;
          console.log(
            `   ✅ 5.1 Using forum metadata: ranked_mode=${parseSummary.replayRankedMode}, ` +
            `tournament_flag=${parseSummary.replayTournamentFlag}`
          );
        }

        // 5.1b Extract team information only for legacy games.
        if (!competitive && parsed.teams && Object.keys(parsed.teams).length > 0) {
          parseSummary.wmlTeams = parsed.teams;
          const teamInfo = Object.entries(parsed.teams).map(([side, team]) => `side${side}=${team}`).join(', ');
          console.log(`   ✅ 5.1b Teams: ${teamInfo}`);
        }

        // 5.1c Extract selected map name only for legacy ranked-map-picker games.
        if ((!competitive || parseSummary.hasRankedMapPicker) && parsed.selectedMapName) {
          parseSummary.selectedMapName = parsed.selectedMapName;
          console.log(`   ✅ 5.1c Selected map name: ${parsed.selectedMapName}`);
        }

        // 5.2 Victory (from parsed replay)
        if (!competitive && parsed.victory && !parseSummary.replayVictory) {
          parseSummary.replayVictory = parsed.victory;
          if (parsed.victory.reason === 'surrender') {
            console.log(`   ✅ 5.2 Victory: ${parsed.victory.winner_name} def ${parsed.victory.loser_name} (surrender, confidence: 2)`);
          } else {
            console.log(`   ⚠️  5.2 No clear victory: ${parsed.victory.reason} (confidence: 1)`);
          }
        }

        // Ladder-era WML is used only to recover factions. Ranked-era WML is
        // intentionally not allowed to replace forum factions.
        const shouldUseWmlFactions = !competitive
          ? hasCustomFaction
          : needsLadderFactionWml;
        if (shouldUseWmlFactions && parsed.players) {
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
    // A completed competitive_game result is authoritative and never uses
    // the legacy confidence-one/manual-confirmation state.
    if (competitiveGameComplete) {
      // Re-check the authoritative player table at the confidence boundary.
      // This path must not inherit confidence from WML, especially when WML
      // was intentionally skipped.
      parseSummary.replayVictory = this.determineCompetitiveVictory(parseSummary);
      parseSummary.confidenceLevel = 2;
    } else {
      parseSummary.confidenceLevel = parseSummary.replayVictory?.confidence_level || 1;
    }
    if (parseSummary.confidenceLevel === 2) {
      console.log(`   ✅ Clear victory (${parseSummary.replayVictory?.reason}) → confidence=2`);
    } else {
      console.log(`   ⚠️  No clear victory (${parseSummary.replayVictory?.reason}) → confidence=1`);
    }

    // ======== DETERMINE MATCH TYPE ========
    // New games use competitive_game metadata. Legacy games use the Ranked
    // add-on plus its WML flags and resolve tournament names locally.
    console.log(`📊 [PARSE] Determining match type...`);
    if (!competitive && !parseSummary.forumAddon) {
      parseSummary.matchType = 'rejected';
      console.log(`   ❌ No valid competitive marker in forum → REJECTED`);
      return parseSummary;
    }

    if (competitiveGameComplete && !parseSummary.replayVictory) {
      parseSummary.matchType = 'rejected';
      console.log(`   ❌ Complete competitive game has no valid winner in competitive_game_player → REJECTED`);
      return parseSummary;
    }

    // Determine match type based on ranked_mode and tournament flag
    // Tournament name always comes from game_name in forum DB
    if (competitive && parseSummary.forumTournamentId) {
      // Newer servers identify the tournament directly. Its local mode is
      // the authoritative distinction between ranked, unranked and team
      // tournament processing when WML does not contain the old flags.
      const competitiveTournament = await findTournamentById(
        parseSummary.forumTournamentId,
        ['ranked', 'unranked', 'team']
      );
      if (competitiveTournament) {
        parseSummary.detectedTournament = competitiveTournament;
        parseSummary.replayRankedMode = competitiveTournament.tournament_mode === 'ranked';
        parseSummary.replayTournamentFlag = true;
        parseSummary.forumTournamentMarker = true;
        parseSummary.matchType = competitiveTournament.tournament_mode === 'ranked'
          ? 'tournament_ranked'
          : 'tournament_unranked';
        console.log(`   ✅ Competitive tournament type resolved: ${parseSummary.matchType}`);
      }
    }

    if (competitive && parseSummary.detectedTournament) {
      // The new model already resolved the tournament from tournament_id.
      // Never fall back to the replay game name when an exact server link is
      // available; tournament_game_id is resolved later by linkToTournament.
      console.log(`   ✅ Using exact competitive tournament link; skipping game-name lookup`);
    } else if (!parseSummary.replayRankedMode) {
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
        
        const metadataTournament = parseSummary.forumTournamentId
          ? await findTournamentById(parseSummary.forumTournamentId, ['unranked', 'team'])
          : null;

        if (metadataTournament) {
          parseSummary.detectedTournament = metadataTournament;
          console.log(`   🏆 Detected tournament by metadata ID: "${metadataTournament.name}"`);
          parseSummary.matchType = 'tournament_unranked';
          console.log(`   ✅ New tournament metadata → TOURNAMENT_UNRANKED`);
        } else if (!searchName) {
          console.log(`   ⚠️  No game_name available, cannot link tournament → REJECTED`);
          parseSummary.matchType = 'rejected';
          return parseSummary;
        } else {
          const tournament = await findTournamentForGameName(searchName, ['unranked', 'team']);

          if (tournament) {
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
        
        const metadataTournament = parseSummary.forumTournamentId
          ? await findTournamentById(parseSummary.forumTournamentId, ['ranked'])
          : null;

        if (metadataTournament) {
          parseSummary.detectedTournament = metadataTournament;
          console.log(`   🏆 Detected ranked tournament by metadata ID: "${metadataTournament.name}"`);
          parseSummary.matchType = 'tournament_ranked';
          console.log(`   ✅ New tournament metadata → TOURNAMENT_RANKED`);
        } else if (!searchName) {
          console.log(`   ⚠️  No game_name available, treating as direct ranked`);
          parseSummary.matchType = 'ranked';
        } else {
          const tournament = await findTournamentForGameName(searchName, ['ranked']);

          if (tournament) {
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
    // Only ranked matches and ranked tournaments enforce the ranked asset catalogs.
    // Unranked and team tournament assets are informational labels for organizers.
    if (parseSummary.matchType === 'tournament_unranked') {
      console.log(`🔍 [PARSE] Skipping asset validation (unranked or team tournament)`);
      // matchType remains 'tournament_unranked', will proceed to linkToTournament
    } else {
      // Need to validate factions and map for ranked paths
      console.log(`🔍 [PARSE] Validating factions against factions table...`);
      let allRanked = true;
      for (const player of parseSummary.forumPlayers) {
        const sideKey = `side${player.side_number}`;
        const forumFaction = parseSummary.forumFactions[sideKey] || '';
        const isCustom = forumFaction.toLowerCase().includes('custom');
        const useLadderWmlFaction = Boolean(
          competitive && eraAddonId?.toLowerCase() === 'ladder_era'
        );

        const factionRaw = isCustom || useLadderWmlFaction
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
      linkedTournamentGameId:         parseSummary.linkedTournamentGameId,
      gameId:                         replay.game_id,
      wesnothVersion:                 replay.wesnoth_version,
      instanceUuid:                   replay.instance_uuid,
    });
  }

  /**
   * Link a tournament replay to the correct tournament and tournament_game.
   * Uses the tournament already detected during match type determination (parseSummary.detectedTournament).
   * For team tournaments (tournament_mode='team'), finds each player's team via tournament_participants
   * and then looks up the match by team IDs. For 1v1 tournaments, uses player IDs directly.
   * Mutates the tournament_game linkage fields in parseSummary.
   * Returns true on success, false if the replay should be rejected.
   */
  private async linkToExplicitTournamentGame(
    parseSummary: ParseSummary,
    tournament: any
  ): Promise<boolean> {
    if (!parseSummary.forumTournamentGameId) {
      return false;
    }

    // Team entries have no participant_id, therefore participant joins must be
    // optional. The entry team IDs are sufficient for team tournaments.
    const result = await query(
      `SELECT games.id, games.entry1_id, games.entry2_id,
              entry1.participant_id AS participant1_id, entry2.participant_id AS participant2_id,
              entry1.team_id AS team1_id, entry2.team_id AS team2_id,
              participant1.user_id AS user1_id, participant2.user_id AS user2_id
       FROM tournament_games games
       JOIN tournament_series series ON series.id = games.series_id
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
       JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
       LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
       LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
       WHERE games.id = ? AND phases.tournament_id = ? AND games.status = 'pending'
       LIMIT 1`,
      [parseSummary.forumTournamentGameId, tournament.id]
    );
    const game = (result as any).rows?.[0];

    if (!game) {
      console.log(`   ❌ [TOURNAMENT LINK] Explicit tournament_game not found or not pending`);
      return false;
    }

    parseSummary.linkedTournamentId = tournament.id;
    parseSummary.linkedTournamentGameId = game.id;
    parseSummary.tournamentLinkMethod = 'tournament_game';

    if (tournament.tournament_mode === 'team' || game.team1_id || game.team2_id) {
      await this.populateTeamReplayMetadata(parseSummary, tournament, [game.team1_id, game.team2_id]);
      if (parseSummary.replayVictory?.reason === 'competitive_game_status') {
        const winningPlayer = parseSummary.competitivePlayers.find((player: any) =>
          String(Object.entries(player).find(([key]) => key.toLowerCase() === 'status')?.[1] ?? '').toLowerCase() === 'victory'
        );
        const teamKey = winningPlayer
          ? Object.keys(winningPlayer).find(key => ['tournament_team_id', 'team_id'].includes(key.toLowerCase()))
          : undefined;
        const winningTeamId = teamKey ? winningPlayer[teamKey] : null;
        if (winningTeamId === game.team1_id) parseSummary.linkedWinnerEntryId = game.entry1_id;
        if (winningTeamId === game.team2_id) parseSummary.linkedWinnerEntryId = game.entry2_id;
      }
      // The new competitive tables contain the server-side team outcome. The
      // legacy path remains conservative because WML alone cannot map a side
      // to a tournament team reliably.
      if (parseSummary.replayVictory?.reason !== 'competitive_game_status') {
        parseSummary.confidenceLevel = 1;
      }
      return true;
    }

    const winnerName = parseSummary.replayVictory?.winner_name;
    const winner = winnerName ? await this.getUserDataByNickname(winnerName) : null;
    if (!winner) {
      console.log(`   ❌ [TOURNAMENT LINK] Cannot map replay winner to explicit tournament_game`);
      return false;
    }

    if (winner.id === game.user1_id) {
      parseSummary.linkedWinnerEntryId = game.entry1_id;
    } else if (winner.id === game.user2_id) {
      parseSummary.linkedWinnerEntryId = game.entry2_id;
    } else {
      console.log(`   ❌ [TOURNAMENT LINK] Replay winner is not in explicit tournament_game`);
      return false;
    }

    console.log(`   ✅ [TOURNAMENT LINK] Linked explicitly to tournament_game id=${game.id}`);
    return true;
  }

  /**
   * Build the team-level replay data shown during manual confirmation.
   * Forum player rows provide the authoritative nicknames, sides and factions;
   * WML team names provide the alliance mapping for maps with four or more sides.
   */
  private async populateTeamReplayMetadata(
    parseSummary: ParseSummary,
    tournament: any,
    teamIds: Array<string | null>
  ): Promise<void> {
    const validTeamIds = teamIds.filter((teamId): teamId is string => Boolean(teamId));
    if (validTeamIds.length !== 2) return;

    const teamResult = await query(
      `SELECT id, name FROM tournament_teams
       WHERE tournament_id = ? AND id IN (?, ?)`,
      [tournament.id, validTeamIds[0], validTeamIds[1]]
    );
    const teamNames = new Map((teamResult.rows || []).map((row: any) => [row.id, row.name]));

    const nicknames = parseSummary.forumPlayers.map(player => player.user_name);
    const usersResult = await query(
      `SELECT id, nickname FROM users_extension
       WHERE LOWER(nickname) IN (${nicknames.map(() => 'LOWER(?)').join(', ')})`,
      nicknames
    );
    const nicknameToUserId = new Map((usersResult.rows || []).map((row: any) => [row.nickname.toLowerCase(), row.id]));
    const userIds = Array.from(nicknameToUserId.values());
    if (userIds.length === 0) return;

    const participantsResult = await query(
      `SELECT user_id, team_id FROM tournament_participants
       WHERE tournament_id = ? AND user_id IN (${userIds.map(() => '?').join(', ')})
         AND status = 'active' AND participation_status = 'accepted'`,
      [tournament.id, ...userIds]
    );
    const userToTeam = new Map((participantsResult.rows || []).map((row: any) => [row.user_id, row.team_id]));

    parseSummary.detectedTeams = {};
    for (const teamId of validTeamIds) {
      const members = parseSummary.forumPlayers.filter(player => {
        const userId = nicknameToUserId.get(player.user_name.toLowerCase());
        return userId && userToTeam.get(userId) === teamId;
      });
      const sides = members.map(player => Number(player.side_number));
      const wmlNames = new Set(sides.map(side => parseSummary.wmlTeams[side]).filter(Boolean));
      parseSummary.detectedTeams[teamId] = {
        team_id: teamId,
        team_name: teamNames.get(teamId) || teamId,
        team_wml_name: Array.from(wmlNames)[0] || 'unknown',
        members: members.map(player => player.user_name),
        sides,
        factions: members.map(player => player.faction).filter(Boolean),
      };
    }

    // Team tournaments do not validate ranked assets, but their detected map
    // and faction labels are still needed by the competition confirmation UI.
    parseSummary.finalMap = parseSummary.forumMap;
    parseSummary.resolvedMap = parseSummary.forumMap;
    for (const player of parseSummary.forumPlayers) {
      const side = `side${player.side_number}`;
      parseSummary.replayFactions[side] = player.faction;
      parseSummary.resolvedFactions[side] = player.faction;
      parseSummary.finalFactions[side] = player.faction;
    }
  }

  private async linkToTournament(parseSummary: ParseSummary): Promise<boolean> {
    // Reuse tournament detected during match type determination to avoid a second DB lookup
    const tournament = parseSummary.detectedTournament;

    if (!tournament) {
      console.log(`   ❌ [TOURNAMENT LINK] No detected tournament in parseSummary`);
      return false;
    }

    console.log(`   ✅ [TOURNAMENT LINK] Using detected tournament: "${tournament.name}" (id=${tournament.id}, mode=${tournament.tournament_mode})`);

    if (parseSummary.forumTournamentGameId) {
      const linkedExplicitly = await this.linkToExplicitTournamentGame(parseSummary, tournament);
      if (linkedExplicitly) {
        return true;
      }
      console.log(`   ❌ [TOURNAMENT LINK] Explicit tournament_game is invalid or no longer pending`);
      return false;
    }

    // ========== TEAM TOURNAMENTS ==========
    // For team tournaments: cannot determine winner without knowing side-to-team mapping
    // Always mark as confidence=1 and let players confirm via UI
    // ========== 1V1 TOURNAMENTS ==========
    // For 1v1 tournaments: can determine winner from parsed replay data
    // Use confidence level from victory detection (may be 1 or 2)
    if (tournament.tournament_mode === 'team') {
      return await this.linkTeamTournamentGameByParticipants(parseSummary, tournament);
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
      `SELECT id, user_id, team_id FROM tournament_participants
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

    const phaseGames = await query(
      `SELECT games.id, games.entry1_id, games.entry2_id,
              participant1.user_id AS user1_id, participant2.user_id AS user2_id
       FROM tournament_games games
       JOIN tournament_series series ON series.id = games.series_id
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
       JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
       LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
       LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
       WHERE phases.tournament_id = ? AND rounds.status = 'in_progress' AND games.status = 'pending'
         AND ((entry1.participant_id = ? AND entry2.participant_id = ?)
           OR (entry1.participant_id = ? AND entry2.participant_id = ?))
       ORDER BY phases.phase_order, rounds.round_number, games.game_number
       LIMIT 2`,
      [tournament.id, participants.find((p: any) => p.user_id === winnerUser.id).id,
        participants.find((p: any) => p.user_id === loserUser.id).id,
        participants.find((p: any) => p.user_id === loserUser.id).id,
        participants.find((p: any) => p.user_id === winnerUser.id).id]
    );
    if (phaseGames.rows.length !== 1) {
      console.log(`   ❌ [TOURNAMENT LINK] Pending tournament_game resolution is ${phaseGames.rows.length === 0 ? 'missing' : 'ambiguous'}`);
      return false;
    }

    const game = phaseGames.rows[0];
    parseSummary.linkedTournamentId = tournament.id;
    parseSummary.linkedTournamentGameId = game.id;
    parseSummary.tournamentLinkMethod = 'participants';
    parseSummary.linkedWinnerEntryId = game.user1_id === winnerUser.id ? game.entry1_id : game.entry2_id;
    return true;
  }

  /**
   * Resolve a named team replay against a pending tournament_games row.
   * 
   * Legacy team replays cannot reliably determine which team won because they
   * do not contain a trustworthy side-to-team mapping. Example:
   * - Game has sides 1,2,3,4 - but we don't know which pairs are allied
   * - Isars Cross: sides (1,4) vs (2,3), but parser sees "side 1 won"
   * - Without knowing the alliance structure, we can't map side 1 to its team
   * 
   * Legacy solution: mark confidence=1 and let the phase-game confirmation
   * flow handle progression after manual review. New competitive_game rows
   * bypass this limitation because tournament_team_id and player status are
   * server-authoritative.
   * 
   * In contrast, 1v1 tournaments CAN determine winner reliably (two players, clear victory)
   */
  private async linkTeamTournamentGameByParticipants(parseSummary: ParseSummary, tournament: any): Promise<boolean> {
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

    if (Number(tournament.competition_model_version) !== 2) {
      console.log(`   ❌ [TEAM TOURNAMENT] Tournament is not using the competition model`);
      return false;
    }

    if (Number(tournament.competition_model_version) === 2) {
      const phaseGames = await query(
        `SELECT games.id
         FROM tournament_games games
         JOIN tournament_series series ON series.id = games.series_id
         JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
         JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
         JOIN tournament_phases phases ON phases.id = groups.phase_id
         JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
         JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
         WHERE phases.tournament_id = ? AND rounds.status = 'in_progress' AND games.status = 'pending'
           AND ((entry1.team_id = ? AND entry2.team_id = ?) OR (entry1.team_id = ? AND entry2.team_id = ?))
         ORDER BY phases.phase_order, rounds.round_number, games.game_number
         LIMIT 2`,
        [tournament.id, team1, team2, team2, team1]
      );
      if (phaseGames.rows.length !== 1) return false;
      parseSummary.linkedTournamentId = tournament.id;
      parseSummary.linkedTournamentGameId = phaseGames.rows[0].id;
      parseSummary.tournamentLinkMethod = 'participants';
      if (parseSummary.replayVictory?.reason !== 'competitive_game_status') {
        parseSummary.confidenceLevel = 1;
      }
    }

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

  /**
   * Convert the authoritative competitive-player statuses into the common
   * replay victory shape. Player identity is deliberately nickname-based:
   * competitive_game_player has no Wesnoth user ID.
   *
   * A team result is valid when one team has at least one victory status and
   * the opposing team has every member marked defeated. This also covers 1v1
   * games because each player becomes a one-member team.
   */
  private determineCompetitiveVictory(parseSummary: ParseSummary): any | null {
    if (parseSummary.competitivePlayers.length === 0) return null;

    console.log(`   ✅ Competitive players received: ${parseSummary.competitivePlayers.length}`);
    const playerByName = new Map(
      parseSummary.forumPlayers.map(player => [String(player.user_name || '').toLowerCase(), player])
    );
    const winnerNames: string[] = [];
    const loserNames: string[] = [];
    const teamStatuses = new Map<string, string[]>();

    for (const competitivePlayer of parseSummary.competitivePlayers) {
      const rowValue = (names: string[]): any => {
        const key = Object.keys(competitivePlayer).find(candidate => names.includes(candidate.toLowerCase()));
        return key ? competitivePlayer[key] : null;
      };
      const username = rowValue([
        'nickname',
        'wesnoth_nickname',
        'user_name',
        'wesnoth_username',
        'username',
        'player_name',
        'name'
      ]);
      const forumPlayer = playerByName.get(String(username || '').toLowerCase());
      if (!forumPlayer) {
        console.warn(`   ⚠️  Competitive result contains a nickname absent from wesnothd_game_player_info`);
        continue;
      }

      const status = String(rowValue(['status']) ?? '').trim().toLowerCase();
      const teamId = rowValue(['tournament_team_id', 'team_id']) ?? `player:${forumPlayer.user_name}`;
      console.log(`   Competitive player: ${forumPlayer.user_name} status=${status || 'missing'} team=${teamId}`);
      const statuses = teamStatuses.get(String(teamId)) || [];
      statuses.push(status);
      teamStatuses.set(String(teamId), statuses);
      if (status === 'victory') winnerNames.push(forumPlayer.user_name);
      if (status === 'defeated') loserNames.push(forumPlayer.user_name);
    }

    const teamOutcomeValid = Array.from(teamStatuses.values()).some(statuses => statuses.includes('victory')) &&
      Array.from(teamStatuses.values()).some(statuses => statuses.length > 0 && statuses.every(status => status === 'defeated'));
    if (!winnerNames.length || !loserNames.length || !teamOutcomeValid) return null;

    console.log(`   ✅ Server-authoritative victory: ${winnerNames.join(', ')} def ${loserNames.join(', ')}`);
    return {
      winner_name: winnerNames[0],
      loser_name: loserNames[0],
      reason: 'competitive_game_status',
      confidence_level: 2,
      winner_names: winnerNames,
      loser_names: loserNames,
    };
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

      // Production publishes replays below a dated public tree. Local
      // wesnothd writes the same files directly into replay_save_path, so
      // accept both layouts while keeping one configurable root directory.
      const replayRoot = process.env.REPLAY_SAVE_PATH || '/scratch/wesnothd-public-replays';
      const datedPath = path.join(replayRoot, urlVersion, year, month, day, filename);
      const flatPath = path.join(replayRoot, filename);
      const localPath = fs.existsSync(datedPath) ? datedPath : flatPath;

      if (!fs.existsSync(localPath)) {
        throw new Error(`Replay file not found in '${datedPath}' or '${flatPath}'`);
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
