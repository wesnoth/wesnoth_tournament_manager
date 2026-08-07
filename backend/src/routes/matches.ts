import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { authMiddleware, moderatorOrAdminMiddleware, AuthRequest } from '../middleware/auth.js';
import { getUserLevel } from '../utils/auth.js';
import {
  enqueueGlobalStatsRecalculation,
  getActiveGlobalStatsRecalculationJobId,
} from '../services/globalStatsRecalculationJobService.js';
import {
  calculateNewRating,
  calculateInitialRating,
  shouldPlayerBeRated,
  calculateTrend,
  getKFactorWithReason,
  getPlayerRankingPosition,
} from '../utils/elo.js';
import {
  updateFactionMapStatistics,
  recalculatePlayerMatchStatistics,
  recalculateFactionMapStatistics,
  updatePlayerElo
} from '../services/statisticsCalculator.js';
import { validateAndCorrectFactions } from '../services/replayConfirmationService.js';
import { recordPhaseGameResult } from '../tournament-engine/competitionProgression.js';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

console.log('🔧 Registering match routes');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'replays');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`✅ Created uploads directory: ${uploadsDir}`);
}

// Validate replay uploads in memory before the route decides whether to persist them.
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 }, // 512KB max file size
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.gz' && ext !== '.bz2') {
      return cb(new Error('Only .gz and .bz2 replay files are allowed'));
    }
    cb(null, true);
  },
});

/**
 * Normalize map names for consistent comparison
 * Handles special characters, smart quotes, and whitespace
 * - Converts smart quotes (', ', ", ") to standard quotes (' and ")
 * - Trims whitespace
 * - Lowercases for comparison
 * @param mapName - The map name to normalize
 * @returns Normalized map name suitable for comparison
 */
function normalizeMapName(mapName: string | null | undefined): string {
  if (!mapName) return '';
  
  // Use Unicode escape sequences to handle all quote variants
  return mapName
    // U+2018 (') and U+2019 (') - Left and right single quotation marks
    .replace(/[\u2018\u2019]/g, "'")
    // U+201C (") and U+201D (") - Left and right double quotation marks  
    .replace(/[\u201C\u201D]/g, '"')
    // U+201E („) and U+201F (‟) - Double low-9 quotation mark
    .replace(/[\u201E\u201F]/g, '"')
    // U+2039 (‹) and U+203A (›) - Single-pointing angle quotation marks
    .replace(/[\u2039\u203A]/g, "'")
    // U+2035 (`) and U+2032 (′) - Grave accent and prime
    .replace(/[\u2035\u2032]/g, "'")
    // U+201A (‚) - Single low-9 quotation mark
    .replace(/[\u201A]/g, "'")
    .trim()
    .toLowerCase();
}

// Helper function to recalculate all stats (used by both admin and player self-cancel)
// This does a FULL replay of all non-cancelled matches to recalculate ELO correctly
async function performGlobalStatsRecalculation(
  onProgress?: (progress: { phase: string; current: number; total: number }) => Promise<void>
) {
  const logs: string[] = [];
  const isDebugEnabled = process.env.BACKEND_DEBUG_LOGS === 'true';
  let recalculationHadErrors = false;
  
  try {
    const startMsg = '🔄 Starting full stats recalculation with match replay';
    if (isDebugEnabled) {
      logs.push(startMsg);
      console.log(startMsg);
    }

    // STEP 1: Disable both triggers to prevent automatic stats updates during this process
    try {
      await query('DROP TRIGGER IF EXISTS trg_update_faction_map_stats');
      await query('DROP TRIGGER IF EXISTS trg_update_player_match_stats');
      const msg = 'Disabled triggers for stats recalculation';
      if (isDebugEnabled) {
        logs.push(msg);
        console.log(msg);
      }
    } catch (error) {
      if (isDebugEnabled) console.warn('Warning: Failed to disable triggers:', error);
    }

    const defaultElo = 1400; // FIDE standard baseline for new users

    // STEP 2: Get ALL non-cancelled matches in chronological order (including 'reported')
    const allNonCancelledMatches = await query(
      `SELECT m.id, m.winner_id, m.loser_id, m.created_at
       FROM matches m
       WHERE m.status != 'cancelled'
       ORDER BY m.created_at ASC, m.id ASC`
    );
    if (onProgress) await onProgress({ phase: 'replaying_matches', current: 0, total: allNonCancelledMatches.rows.length });

    // STEP 3: Initialize all users with baseline ELO and zero stats
    const userStates = new Map<string, {
      elo_rating: number;
      ranking_pos: number;
      is_global_ranked: boolean;
      last_match_date: Date | null;
      matches_played: number;
      total_wins: number;
      total_losses: number;
      trend: string;
      level: string;
    }>();

    const allUsersResult = await query('SELECT id, is_active, is_blocked FROM users_extension');
    for (const userRow of allUsersResult.rows) {
      userStates.set(userRow.id, {
        elo_rating: defaultElo,
        ranking_pos: 1,
        is_global_ranked: !Boolean(userRow.is_blocked),
        last_match_date: null,
        matches_played: 0,
        total_wins: 0,
        total_losses: 0,
        trend: '-',
        level: 'Novato'
      });
    }

    // STEP 4: Replay ALL non-cancelled matches chronologically to rebuild correct stats
    let matchProcessedCount = 0;
    let debugSampleLogs: string[] = [];

    for (const matchRow of allNonCancelledMatches.rows) {
      const winnerId = matchRow.winner_id;
      const loserId = matchRow.loser_id;

      // Ensure both users exist in state map
      if (!userStates.has(winnerId)) {
        userStates.set(winnerId, { elo_rating: defaultElo, ranking_pos: 1, is_global_ranked: true, last_match_date: null, matches_played: 0, total_wins: 0, total_losses: 0, trend: '-', level: 'Novato' });
      }
      if (!userStates.has(loserId)) {
        userStates.set(loserId, { elo_rating: defaultElo, ranking_pos: 1, is_global_ranked: true, last_match_date: null, matches_played: 0, total_wins: 0, total_losses: 0, trend: '-', level: 'Novato' });
      }

      const winner = userStates.get(winnerId)!;
      const loser = userStates.get(loserId)!;

      // Store before values. Global ranking includes every non-blocked player,
      // including inactive and unrated players.
      const getGlobalRankingPosition = (playerId: string, playerElo: number): number =>
        1 + Array.from(userStates.entries()).filter(([otherId, other]) =>
          other.is_global_ranked && otherId !== playerId &&
          (other.elo_rating > playerElo || (other.elo_rating === playerElo && otherId < playerId))
        ).length;

      const winnerEloBefore = winner.elo_rating;
      const loserEloBefore = loser.elo_rating;
      const winnerRankingPosBefore = getGlobalRankingPosition(winnerId, winnerEloBefore);
      const loserRankingPosBefore = getGlobalRankingPosition(loserId, loserEloBefore);
      const winnerMatchesBeforeCalc = winner.matches_played;
      const loserMatchesBeforeCalc = loser.matches_played;

      // Calculate new ratings
      const winnerNewRating = calculateNewRating(winner.elo_rating, loser.elo_rating, 'win', winner.matches_played);
      const loserNewRating = calculateNewRating(loser.elo_rating, winner.elo_rating, 'loss', loser.matches_played);
      
      // Get K-factor info for debugging (from elo.ts)
      const winnerKInfo = getKFactorWithReason(winner.elo_rating, winner.matches_played);
      const loserKInfo = getKFactorWithReason(loser.elo_rating, loser.matches_played);

      // Calculate levels based on ELO BEFORE and AFTER (not from previous state)
      const winnerLevelBefore = getUserLevel(winnerEloBefore);
      const loserLevelBefore = getUserLevel(loserEloBefore);
      const winnerLevelAfter = getUserLevel(winnerNewRating);
      const loserLevelAfter = getUserLevel(loserNewRating);

      // Update stats
      winner.elo_rating = winnerNewRating;
      loser.elo_rating = loserNewRating;
      const matchDate = new Date(matchRow.created_at);
      winner.last_match_date = matchDate;
      loser.last_match_date = matchDate;
      winner.matches_played++;
      loser.matches_played++;
      winner.total_wins++;
      loser.total_losses++;
      winner.trend = calculateTrend(winner.trend, true);
      loser.trend = calculateTrend(loser.trend, false);
      
      // Update levels in state for next iteration
      winner.level = winnerLevelAfter;
      loser.level = loserLevelAfter;

      // Calculate global ranking positions after both players have received
      // their new ratings. Equal ELO values use UUID order as a stable tie-break.
      const winnerRankingPosAfter = getGlobalRankingPosition(winnerId, winnerNewRating);
      const loserRankingPosAfter = getGlobalRankingPosition(loserId, loserNewRating);

      // Calculate ranking changes
      const winnerRankingChange = winnerRankingPosBefore - winnerRankingPosAfter;
      const loserRankingChange = loserRankingPosBefore - loserRankingPosAfter;

      // Update ranking positions in state
      winner.ranking_pos = winnerRankingPosAfter;
      loser.ranking_pos = loserRankingPosAfter;

      // Calculate ELO changes for both players
      const winnerEloChange = winnerNewRating - winnerEloBefore;
      const loserEloChange = loserNewRating - loserEloBefore;

      // DEBUG: Log sample matches (first 3, last 3, and every 10th)
      if (isDebugEnabled && (matchProcessedCount < 3 || matchProcessedCount % 10 === 0 || matchProcessedCount === allNonCancelledMatches.rows.length - 1)) {
        const debugLog = `
🎮 MATCH #${matchProcessedCount + 1}/${allNonCancelledMatches.rows.length} (${matchRow.created_at})
   WINNER: ${winnerId.substring(0, 8)}...
     - ELO: ${winnerEloBefore} | Matches played: ${winnerMatchesBeforeCalc}
     - K-factor: ${winnerKInfo.k} (${winnerKInfo.reason})
     - New ELO: ${winnerNewRating} | Change: ${winnerEloChange > 0 ? '+' : ''}${winnerEloChange}
     - Level: ${winnerLevelBefore} → ${winnerLevelAfter}
   
   LOSER: ${loserId.substring(0, 8)}...
     - ELO: ${loserEloBefore} | Matches played: ${loserMatchesBeforeCalc}
     - K-factor: ${loserKInfo.k} (${loserKInfo.reason})
     - New ELO: ${loserNewRating} | Change: ${loserEloChange > 0 ? '+' : ''}${loserEloChange}
     - Level: ${loserLevelBefore} → ${loserLevelAfter}
   
   ✅ Winner +${winnerEloChange}, Loser ${loserEloChange} (balance: ${winnerEloChange + loserEloChange})`;
        debugSampleLogs.push(debugLog);
      }

      // Update the match record with correct before/after ELO values and levels
      await query(
        `UPDATE matches 
         SET winner_elo_before = ?, winner_elo_after = ?, 
             loser_elo_before = ?, loser_elo_after = ?,
             winner_level_before = ?, winner_level_after = ?,
             loser_level_before = ?, loser_level_after = ?,
             winner_ranking_pos = ?, winner_ranking_change = ?,
             loser_ranking_pos = ?, loser_ranking_change = ?,
             elo_change = ?
         WHERE id = ?`,
        [winnerEloBefore, winnerNewRating, loserEloBefore, loserNewRating, winnerLevelBefore, winnerLevelAfter, loserLevelBefore, loserLevelAfter, winnerRankingPosAfter, winnerRankingChange, loserRankingPosAfter, loserRankingChange, winnerEloChange, matchRow.id]
      );

      matchProcessedCount++;
      if (onProgress && (matchProcessedCount === allNonCancelledMatches.rows.length || matchProcessedCount % 10 === 0)) {
        await onProgress({ phase: 'replaying_matches', current: matchProcessedCount, total: allNonCancelledMatches.rows.length });
      }
    }

    const finalMsg = `✅ Replayed ${allNonCancelledMatches.rows.length} matches with FIDE ELO recalculation`;
    if (isDebugEnabled) {
      logs.push(finalMsg);
      console.log(finalMsg);
      logs.push('📊 DEBUG SAMPLE LOGS (first 3, every 10th, and last):');
      debugSampleLogs.forEach(log => {
        logs.push(log);
        console.log(log);
      });
    }

    // STEP 5: Update all users in the database with their recalculated stats
    let usersUpdatedCount = 0;
    if (onProgress) await onProgress({ phase: 'updating_users', current: 0, total: userStates.size });
    for (const [userId, stats] of userStates.entries()) {
      // Rebuild rated status from replayed history instead of preserving a
      // stale flag. This keeps cancellations and imported test data consistent
      // with the documented eligibility rule.
      const isRated = shouldPlayerBeRated(stats.matches_played, stats.elo_rating);
      
      await query(
        `UPDATE users_extension 
         SET elo_rating = ?, 
             matches_played = ?,
             total_wins = ?,
             total_losses = ?,
             trend = ?,
             level = ?,
             is_rated = ?,
             is_active = ?,
             last_match_date = ?,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [
          stats.elo_rating,
          stats.matches_played,
          stats.total_wins,
          stats.total_losses,
          stats.trend,
          stats.level,
          isRated,
          stats.last_match_date && stats.last_match_date >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) ? 1 : 0,
          stats.last_match_date,
          userId,
        ]
      );
      usersUpdatedCount++;
      if (onProgress && (usersUpdatedCount === userStates.size || usersUpdatedCount % 10 === 0)) {
        await onProgress({ phase: 'updating_users', current: usersUpdatedCount, total: userStates.size });
      }
    }

    // STEP 6: Re-enable both triggers
    // Note: With TypeScript services, triggers are replaced by direct service calls
    try {
      // Drop old triggers if they exist
      await query('DROP TRIGGER IF EXISTS trg_update_player_match_stats');
      await query('DROP TRIGGER IF EXISTS trg_update_faction_map_stats');
      const msg = '✓ Triggers cleaned up (replaced by TypeScript services)';
      if (isDebugEnabled) {
        logs.push(msg);
        console.log(msg);
      }
    } catch (error) {
      if (isDebugEnabled) console.error('Warning: Failed to drop triggers:', error);
    }

    // STEP 7: Recalculate derived statistics in separately observable phases.
    try {
      const playerResult = await recalculatePlayerMatchStatistics(async (current, total) => {
        if (onProgress) await onProgress({ phase: 'recalculating_player_statistics', current, total });
      });
      const msg = `✓ Recalculated ${playerResult.records_updated} player match statistics`;
      logs.push(msg);
      if (isDebugEnabled) console.log(msg);
    } catch (error) {
      recalculationHadErrors = true;
      const msg = `✗ Error recalculating player match statistics: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logs.push(msg);
      console.error(msg);
    }

    try {
      const factionResult = await recalculateFactionMapStatistics(async (current, total) => {
        if (onProgress) await onProgress({ phase: 'recalculating_faction_statistics', current, total });
      });
      const msg = `✓ Recalculated ${factionResult.records_updated} faction/map statistics`;
      logs.push(msg);
      if (isDebugEnabled) console.log(msg);

      // Manage snapshots
      const snapshotResult = await query('SELECT COUNT(*) FROM faction_map_statistics_history');
      const snapshotMsg = '🟢 Snapshots managed';
      if (isDebugEnabled) {
        logs.push(snapshotMsg);
        console.log(snapshotMsg);
      }
    } catch (error) {
      recalculationHadErrors = true;
      const msg = `✗ Error recalculating faction/map statistics: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logs.push(msg);
      console.error(msg);
    }

    return { 
      success: !recalculationHadErrors,
      logs,
      matchesProcessed: matchProcessedCount,
      usersUpdated: usersUpdatedCount
    };
  } catch (error) {
    console.error('Error in performGlobalStatsRecalculation:', error);
    if (isDebugEnabled) {
      logs.push(`❌ ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { 
      success: false, 
      logs,
      matchesProcessed: 0,
      usersUpdated: 0
    };
  }
}

/**
 * Preview replay file (decompress and extract data)
 * Handles .gz and .bz2 files
 * MUST be BEFORE generic /:id routes
 */
router.options('/preview-replay', (req, res) => {
  console.log('✅ [PREVIEW] OPTIONS request received for /preview-replay');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).end();
});

// OPTIONS for base64 endpoint
router.options('/preview-replay-base64', (req, res) => {
  console.log('✅ [PREVIEW-B64] OPTIONS request received for /preview-replay-base64');
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).end();
});

// Alternative endpoint for preview-replay that accepts base64 encoded file in JSON body
// This avoids multipart/form-data issues with some Cloudflare configurations
router.post('/preview-replay-base64', authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log('✅ [PREVIEW-B64] POST /preview-replay-base64 endpoint reached');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    const { fileData, fileName } = req.body;
    
    if (!fileData || !fileName) {
      console.warn('[PREVIEW-B64] Missing fileData or fileName');
      return res.status(400).json({ error: 'Missing fileData or fileName in request body' });
    }
    
    // Decode base64 to buffer
    const fileBuffer = Buffer.from(fileData, 'base64');
    const fileExt = path.extname(fileName).toLowerCase();
    
    console.log(`📂 [PREVIEW-B64] Previewing replay file: ${fileName} (${fileBuffer.length} bytes), ext: ${fileExt}`);
    
    let decompressed: Buffer;
    
    if (fileExt === '.gz') {
      console.log('[PREVIEW-B64] Handling GZIP decompression');
      const { createGunzip } = await import('zlib');
      const { Readable } = await import('stream');

      const stream = Readable.from(fileBuffer);
      const gunzip = createGunzip();
      const chunks: Buffer[] = [];

      await new Promise((resolve, reject) => {
        stream
          .pipe(gunzip)
          .on('data', (chunk: Buffer) => chunks.push(chunk))
          .on('end', resolve)
          .on('error', reject);
      });

      decompressed = Buffer.concat(chunks);
      console.log('[PREVIEW-B64] GZIP decompression complete, decompressed size:', decompressed.length);
    } else if (fileExt === '.bz2') {
      console.log('[PREVIEW-B64] Handling BZ2 decompression');
      const bz2Module = await import('bz2');
      let decompress = bz2Module.decompress || bz2Module.default?.decompress;
      
      if (!decompress && typeof bz2Module === 'function') {
        decompress = bz2Module;
      }

      if (typeof decompress !== 'function') {
        console.error('[PREVIEW-B64] Could not find decompress function in bz2 module');
        throw new Error('bz2.decompress is not available');
      }

      const decompressedData = decompress(fileBuffer);
      decompressed = Buffer.from(decompressedData);
      console.log('[PREVIEW-B64] BZ2 decompression complete, decompressed size:', decompressed.length);
    } else {
      console.warn('[PREVIEW-B64] Unsupported file extension:', fileExt);
      return res.status(400).json({ error: 'Unsupported file format. Only .gz and .bz2 files are allowed.' });
    }

    // Convert to string and extract replay info (same as multipart endpoint)
    const xmlText = decompressed.toString('utf-8');
    const scenarioMatch = xmlText.match(/mp_scenario_name="([^"]+)"/);
    let map = scenarioMatch ? scenarioMatch[1] : null;
    if (map) {
      map = map.replace(/^2p\s*—\s*/, '');
    }

    const sideUsersGlobal = xmlText.match(/side_users="([^"]+)"/);
    const playerNames: string[] = [];
    if (sideUsersGlobal && sideUsersGlobal[1]) {
      const pairs = sideUsersGlobal[1].split(',');
      for (const pair of pairs) {
        const parts = pair.split(':');
        const name = (parts[1] || parts[0]).trim();
        if (name) playerNames.push(name);
      }
    }

    const factionsInOrder: string[] = [];
    const factionRegex = /faction_name\s*=\s*_?"([^"]+)"/g;
    let factionMatch;
    while ((factionMatch = factionRegex.exec(xmlText)) !== null) {
      const raw = factionMatch[1];
      const clean = raw.replace(/^_/, '');
      factionsInOrder.push(clean);
    }

    const factionByPlayer: Record<string, string> = {};
    const oldSideBlockRegex = /\[old_side[^\]]*\][\s\S]*?(?=\[old_side|\Z)/g;
    let sideBlockMatch;
    while ((sideBlockMatch = oldSideBlockRegex.exec(xmlText)) !== null) {
      const text = sideBlockMatch[0];
      const playerMatch = text.match(/current_player="([^"]+)"/);
      if (!playerMatch) continue;
      const player = playerMatch[1];
      const factionNameMatch = text.match(/faction_name\s*=\s*_?"([^"]+)"/);
      const factionMatchLocal = text.match(/faction="([^"]+)"/);
      const rawFaction = (factionNameMatch?.[1] || factionMatchLocal?.[1] || '').trim();
      if (!rawFaction) continue;
      const cleanFaction = rawFaction.replace(/^_/, '');
      factionByPlayer[player] = cleanFaction;
    }

    const players: Array<{ id: string; name: string; faction: string }> = [];
    const count = Math.min(playerNames.length, factionsInOrder.length);
    for (let i = 0; i < count; i++) {
      const name = playerNames[i];
      const faction = factionByPlayer[name] ?? factionsInOrder[i] ?? 'Unknown';
      players.push({ id: name, name, faction });
    }

    if (playerNames.length === 0 && Object.keys(factionByPlayer).length > 0) {
      for (const [name, faction] of Object.entries(factionByPlayer)) {
        players.push({ id: name, name, faction });
      }
    }

    console.log('[PREVIEW-B64] Extracted data:', { map, players: players.length });
    return res.json({ map, players });
  } catch (error) {
    console.error('[PREVIEW-B64] Error in preview-replay-base64 endpoint:', error);
    res.status(500).json({ error: 'Failed to parse replay file', details: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/preview-replay', authMiddleware, upload.single('replay'), async (req: AuthRequest, res) => {
  try {
    // Ensure CORS headers are present for Cloudflare
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    console.log('✅ [PREVIEW] POST /preview-replay endpoint reached');
    console.log('[PREVIEW] User ID:', req.userId);
    console.log('[PREVIEW] File info:', req.file ? { fieldname: req.file.fieldname, originalname: req.file.originalname, size: req.file.size } : 'NO FILE');
    
    if (!req.file) {
      console.warn('[PREVIEW] No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const fileExt = path.extname(fileName).toLowerCase();

    console.log(`📂 [PREVIEW] Previewing replay file: ${fileName} (${fileBuffer.length} bytes), ext: ${fileExt}`);

    let decompressed: Buffer;

    if (fileExt === '.gz') {
      console.log('[PREVIEW] Handling GZIP decompression');
      // Handle gzip decompression
      const { createGunzip } = await import('zlib');
      const { Readable } = await import('stream');

      const stream = Readable.from(fileBuffer);
      const gunzip = createGunzip();
      const chunks: Buffer[] = [];

      await new Promise((resolve, reject) => {
        stream
          .pipe(gunzip)
          .on('data', (chunk: Buffer) => chunks.push(chunk))
          .on('end', resolve)
          .on('error', reject);
      });

      decompressed = Buffer.concat(chunks);
      console.log('[PREVIEW] GZIP decompression complete, decompressed size:', decompressed.length);
    } else if (fileExt === '.bz2') {
      console.log('[PREVIEW] Handling BZ2 decompression');
      // Handle bzip2 decompression
      const bz2Module = await import('bz2');
      console.log('[PREVIEW] bz2Module:', Object.keys(bz2Module));
      console.log('[PREVIEW] bz2Module.default:', bz2Module.default);
      
      // Try different ways to access decompress function
      let decompress = bz2Module.decompress || bz2Module.default?.decompress;
      
      // If still not found, try accessing the module differently
      if (!decompress && typeof bz2Module === 'function') {
        // Sometimes the module itself is the decompress function
        decompress = bz2Module;
      }
      
      console.log('[PREVIEW] decompress type:', typeof decompress);

      if (typeof decompress !== 'function') {
        console.error('[PREVIEW] Could not find decompress function in bz2 module');
        console.error('[PREVIEW] Available keys:', Object.keys(bz2Module || {}));
        throw new Error('bz2.decompress is not available');
      }

      console.log('[PREVIEW] Calling bz2.decompress...');
      const decompressedData = decompress(fileBuffer);
      decompressed = Buffer.from(decompressedData);
      console.log('[PREVIEW] BZ2 decompression complete, decompressed size:', decompressed.length);
    } else {
      console.warn('[PREVIEW] Unsupported file extension:', fileExt);
      return res.status(400).json({ error: 'Unsupported file format. Only .gz and .bz2 files are allowed.' });
    }

    // Convert to string and extract replay info
    console.log('[PREVIEW] Converting decompressed data to string...');
    const xmlText = decompressed.toString('utf-8');

    // Extract map name
    const scenarioMatch = xmlText.match(/mp_scenario_name="([^"]+)"/);
    let map = scenarioMatch ? scenarioMatch[1] : null;
    console.log('[PREVIEW] Raw scenario match:', map);
    if (map) {
      console.log('[PREVIEW] Char codes:', Array.from(map).map((c, i) => ({ i, char: c, code: c.charCodeAt(0) })));
      // Remove "2p — " prefix if present
      map = map.replace(/^2p\s*—\s*/, '');
      console.log('[PREVIEW] After removing 2p prefix:', map);
    }
    console.log('[PREVIEW] Extracted map:', map);

    // Extract players from global side_users attribute (e.g., id1:Nick1,id2:Nick2)
    const sideUsersGlobal = xmlText.match(/side_users="([^"]+)"/);
    const playerNames: string[] = [];
    if (sideUsersGlobal && sideUsersGlobal[1]) {
      const pairs = sideUsersGlobal[1].split(',');
      for (const pair of pairs) {
        const parts = pair.split(':');
        const name = (parts[1] || parts[0]).trim();
        if (name) playerNames.push(name);
      }
    }

    // Extract factions in order of <side ...> blocks (fallback)
    const factionsInOrder: string[] = [];
    const factionRegex = /faction_name\s*=\s*_?"([^"]+)"/g;
    let factionMatch;
    while ((factionMatch = factionRegex.exec(xmlText)) !== null) {
      const raw = factionMatch[1];
      const clean = raw.replace(/^_/, '');
      factionsInOrder.push(clean);
    }

    // Extract factions from [old_side*] blocks mapping current_player -> faction_name (preferred) or faction
    const factionByPlayer: Record<string, string> = {};
    const oldSideBlockRegex = /\[old_side[^\]]*\][\s\S]*?(?=\[old_side|\Z)/g;
    let sideBlockMatch;
    while ((sideBlockMatch = oldSideBlockRegex.exec(xmlText)) !== null) {
      const text = sideBlockMatch[0];
      const playerMatch = text.match(/current_player="([^"]+)"/);
      if (!playerMatch) continue;
      const player = playerMatch[1];
      const factionNameMatch = text.match(/faction_name\s*=\s*_?"([^"]+)"/);
      const factionMatchLocal = text.match(/faction="([^"]+)"/);
      const rawFaction = (factionNameMatch?.[1] || factionMatchLocal?.[1] || '').trim();
      if (!rawFaction) continue;
      const cleanFaction = rawFaction.replace(/^_/, '');
      factionByPlayer[player] = cleanFaction;
    }

    // Build players array by index mapping
    const players: Array<{ id: string; name: string; faction: string }> = [];
    const count = Math.min(playerNames.length, factionsInOrder.length);
    for (let i = 0; i < count; i++) {
      const name = playerNames[i];
      const faction = factionByPlayer[name] ?? factionsInOrder[i] ?? 'Unknown';
      players.push({ id: name, name, faction });
    }

    // If playerNames are empty but old_side mapping exists, use it to populate players
    if (playerNames.length === 0 && Object.keys(factionByPlayer).length > 0) {
      for (const [name, faction] of Object.entries(factionByPlayer)) {
        players.push({ id: name, name, faction });
      }
    }
    console.log('[PREVIEW] Extracted players:', players);

    console.log('[PREVIEW] Sending successful response...');
    res.json({
      success: true,
      map,
      players,
      fileName,
    });
  } catch (error: any) {
    console.error('[PREVIEW] Error in preview-replay endpoint:', error);

    res.status(400).json({
      error: 'Failed to parse replay file',
      details: error.message,
    });
  }
});

// Confirm/dispute match - MUST be BEFORE generic /:id routes
router.post('/:id/confirm', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { comments, rating, action } = req.body;
    const matchResult = await query('SELECT * FROM matches WHERE id = ?', [id]);
    if (!matchResult.rows.length) return res.status(404).json({ error: 'Match not found' });
    const match = matchResult.rows[0];
    const loserId = match.loser_id || (match.winner_id === match.player1_id ? match.player2_id : match.player1_id);
    const isWinner = match.winner_id === req.userId;
    const isLoser = loserId === req.userId;
    if (!isWinner && !isLoser) return res.status(403).json({ error: 'Only match participants can confirm this match' });

    if (action === 'confirm') {
      if (rating !== undefined && rating !== null && (rating < 1 || rating > 5)) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }
      const updateColumn = isWinner ? 'winner' : 'loser';
      await query(
        'UPDATE matches SET ' + updateColumn + '_comments = ?, ' + updateColumn + '_rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [comments || null, rating || null, id]
      );
      const updatedMatch = await query('SELECT loser_rating, winner_rating FROM matches WHERE id = ?', [id]);
      if (updatedMatch.rows[0]?.loser_rating && updatedMatch.rows[0]?.winner_rating) {
        await query('UPDATE matches SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['confirmed', id]);
      }
      return res.json({ message: 'Match confirmed successfully with your comments and rating' });
    }

    if (action === 'dispute') {
      if (!isLoser) return res.status(403).json({ error: 'Only the losing player can dispute this match' });
      await query(
        "UPDATE matches SET status = 'disputed', loser_comments = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [comments || null, id]
      );
      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        user_id: req.userId,
        username: req.username,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: { action: 'MATCH_DISPUTED', match_id: id },
      });
      return res.json({ message: 'Match disputed. Awaiting admin review.' });
    }

    return res.status(400).json({ error: 'Invalid action. Use "confirm" or "dispute"' });
  } catch (error) {
    console.error('Match confirmation error:', error);
    return res.status(500).json({ error: 'Failed to update match' });
  }
});

const DISPUTES_PAGE_SIZE = 20;

/** Parse and bound the administrative dispute list page number. */
function parseDisputePage(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 1;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 100_000 ? page : null;
}

// Get disputed ranked matches (admin view) - MUST be before /:id route.
router.get('/disputed/all', moderatorOrAdminMiddleware, async (req: AuthRequest, res) => {
  try {
    const page = parseDisputePage(req.query.page);
    if (page === null) {
      return res.status(400).json({ error: 'page must be an integer between 1 and 100000' });
    }

    const offset = (page - 1) * DISPUTES_PAGE_SIZE;
    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE m.status = 'disputed'`
    );
    const total = Number(countResult.rows[0]?.total || 0);
    const result = await query(
      `SELECT m.*,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE m.status = 'disputed'
       ORDER BY m.updated_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      [DISPUTES_PAGE_SIZE, offset]
    );

    res.json({
      disputes: result.rows,
      pagination: {
        page,
        limit: DISPUTES_PAGE_SIZE,
        total,
        totalPages: Math.ceil(total / DISPUTES_PAGE_SIZE),
        showing: result.rows.length,
      },
    });
  } catch (error) {
    console.error('Failed to fetch disputed matches:', error);
    res.status(500).json({ error: 'Failed to fetch disputed matches' });
  }
});

// Get all pending matches (admin view) - MUST be before /:id route
router.get('/pending/all', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // Verify admin status
    const adminResult = await query('SELECT is_admin FROM users_extension WHERE id = ?', [req.userId]);
    if (adminResult.rows.length === 0 || !adminResult.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await query(
      `SELECT m.*,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE m.status IN ('unconfirmed', 'pending')
       ORDER BY m.created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending matches' });
  }
});

// Get pending matches for current user (as winner or loser) - MUST be before /:id route
router.get('/pending/user', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await query(
      `SELECT m.*,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname,
              CASE 
                WHEN m.winner_id = ? THEN 'winner'
                WHEN m.loser_id = ? THEN 'loser'
              END as user_role,
              CASE 
                WHEN m.winner_id = ? AND m.status = 'confirmed' THEN true
                WHEN m.loser_id = ? AND m.status IN ('unconfirmed', 'pending') THEN true
                ELSE false
              END as is_awaiting_action
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE (m.winner_id = ? OR m.loser_id = ?)
         AND m.status IN ('unconfirmed', 'pending')
       ORDER BY m.created_at DESC`,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending matches' });
  }
});

// Admin action on disputed match - MUST be BEFORE /:matchId routes
router.post('/admin/:id/dispute', moderatorOrAdminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'validate', 'reject', or 'award'

    const matchResult = await query('SELECT * FROM matches WHERE id = ?', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchResult.rows[0];

    if (match.status !== 'disputed') {
      return res.status(400).json({ error: 'Match is not disputed' });
    }

    const activeRecalculationJobId = await getActiveGlobalStatsRecalculationJobId();
    if (activeRecalculationJobId) {
      return res.status(409).json({
        error: 'A global statistics recalculation is in progress. Resolve disputes after it completes.',
        jobId: activeRecalculationJobId,
      });
    }

    if (action === 'award') {
      // Correct the result on the existing match row so replay identity and all
      // foreign-key references remain intact. The disputed player is currently
      // stored as loser_id because only that participant can open the dispute.
      const previousResult = {
        winner_id: match.winner_id,
        loser_id: match.loser_id,
        winner_faction: match.winner_faction,
        loser_faction: match.loser_faction,
        winner_comments: match.winner_comments,
        loser_comments: match.loser_comments,
        winner_rating: match.winner_rating,
        loser_rating: match.loser_rating,
        winner_side: match.winner_side,
        status: match.status,
        admin_reviewed: match.admin_reviewed,
        admin_reviewed_at: match.admin_reviewed_at,
        admin_reviewed_by: match.admin_reviewed_by,
      };

      const correctedWinnerSide = match.winner_side === 1 ? 2 : match.winner_side === 2 ? 1 : match.winner_side;
      await query(
        `UPDATE matches
         SET winner_id = ?, loser_id = ?,
             winner_faction = ?, loser_faction = ?,
             winner_comments = ?, loser_comments = ?,
             winner_rating = ?, loser_rating = ?,
             winner_side = ?, status = 'confirmed',
             admin_reviewed = true, admin_reviewed_at = CURRENT_TIMESTAMP, admin_reviewed_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'disputed'`,
        [
          previousResult.loser_id,
          previousResult.winner_id,
          previousResult.loser_faction,
          previousResult.winner_faction,
          previousResult.loser_comments,
          previousResult.winner_comments,
          previousResult.loser_rating,
          previousResult.winner_rating,
          correctedWinnerSide,
          req.userId,
          id,
        ]
      );

      let recalcJobId: string;
      try {
        recalcJobId = await enqueueGlobalStatsRecalculation({
          requestedBy: req.userId ?? null,
          reason: 'MATCH_DISPUTE_AWARDED_WIN',
          execute: async (onProgress) => {
            const recalcResult = await performGlobalStatsRecalculation(onProgress);
            if (recalcResult.success) {
              try {
                await onProgress({ phase: 'calculating_player_of_month', current: 0, total: 1 });
                const { calculatePlayerOfMonth } = await import('../jobs/playerOfMonthJob.js');
                await calculatePlayerOfMonth();
                await onProgress({ phase: 'calculating_player_of_month', current: 1, total: 1 });
              } catch (error: any) {
                console.error('⚠️  Warning: Failed to recalculate player of month after awarding dispute:', error.message);
              }
            }
            return recalcResult;
          },
        });
      } catch (error: any) {
        // Do not leave a corrected match without a scheduled recalculation.
        await query(
          `UPDATE matches
           SET winner_id = ?, loser_id = ?,
               winner_faction = ?, loser_faction = ?,
               winner_comments = ?, loser_comments = ?,
               winner_rating = ?, loser_rating = ?,
               winner_side = ?, status = ?,
               admin_reviewed = ?, admin_reviewed_at = ?, admin_reviewed_by = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            previousResult.winner_id, previousResult.loser_id,
            previousResult.winner_faction, previousResult.loser_faction,
            previousResult.winner_comments, previousResult.loser_comments,
            previousResult.winner_rating, previousResult.loser_rating,
            previousResult.winner_side, previousResult.status,
            previousResult.admin_reviewed, previousResult.admin_reviewed_at,
            previousResult.admin_reviewed_by, id,
          ]
        );
        return res.status(error.name === 'GlobalStatsRecalculationInProgressError' ? 409 : 500).json({
          error: error.message || 'Could not schedule statistics recalculation',
          jobId: error.jobId,
        });
      }

      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        user_id: req.userId,
        username: req.username,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: {
          action: 'MATCH_DISPUTE_AWARDED_WIN',
          match_id: id,
          previous_winner_id: previousResult.winner_id,
          corrected_winner_id: previousResult.loser_id,
        },
      });

      return res.json({
        message: 'Dispute resolved. The disputed player was awarded the win and global statistics recalculation was queued.',
        recalculationJobId: recalcJobId,
        recalculationStatus: 'queued',
      });
    }

    if (action === 'validate') {
      // Admin validates the dispute - the match is invalid and must be cancelled.
      // Targeted cascade: only reprocesses matches involving the directly affected players
      // and any players who played against them (or their transitive chain) afterwards.

      console.log(`Starting targeted cascade recalculation for cancelled match ${id} (winner: ${match.winner_id}, loser: ${match.loser_id})`);

      // STEP 1: Cancel the disputed match
      await query(
        `UPDATE matches SET status = 'cancelled', admin_reviewed = ?, admin_reviewed_at = NOW(), admin_reviewed_by = ? WHERE id = ?`,
        [true, req.userId, id]
      );

      const directWinnerId: string = match.winner_id;
      const directLoserId: string = match.loser_id;
      const cancelledAt = new Date(match.created_at);

      // ELO is applied for any match that is not cancelled/disputed/rejected.
      // 'reported', 'unconfirmed', and 'confirmed' all have ELO applied.
      // ELO is applied to all matches except cancelled ones.
      const ELO_STATUS_FILTER = `status != 'cancelled'`;

      // Counts ELO-applied matches for a player before a given date, excluding one match id
      const countMatchesBefore = async (userId: string, beforeDate: Date, excludeMatchId: string): Promise<number> => {
        const result = await query(
          `SELECT COUNT(*) as cnt FROM matches
           WHERE (winner_id = ? OR loser_id = ?) AND ${ELO_STATUS_FILTER}
             AND created_at < ? AND id != ?`,
          [userId, userId, beforeDate, excludeMatchId]
        );
        return Number(result.rows[0]?.cnt ?? 0);
      };

      // STEP 2: Initialize affected player set with ELO restored to their pre-cancelled-match values
      interface PlayerState { elo: number; matches_played: number; nickname: string; }
      const affectedPlayers = new Map<string, PlayerState>();

      // Resolve nicknames for logging
      const nicknameCache = new Map<string, string>();
      const getNickname = async (userId: string): Promise<string> => {
        if (nicknameCache.has(userId)) return nicknameCache.get(userId)!;
        const r = await query(`SELECT nickname FROM users_extension WHERE id = ?`, [userId]);
        const nick = r.rows[0]?.nickname ?? userId.substring(0, 8);
        nicknameCache.set(userId, nick);
        return nick;
      };

      const winnerNick = await getNickname(directWinnerId);
      const loserNick  = await getNickname(directLoserId);
      const winnerMatchesBefore = await countMatchesBefore(directWinnerId, cancelledAt, id);
      const loserMatchesBefore  = await countMatchesBefore(directLoserId,  cancelledAt, id);

      affectedPlayers.set(directWinnerId, {
        elo: Number(match.winner_elo_before) || 1400,
        matches_played: winnerMatchesBefore,
        nickname: winnerNick
      });
      affectedPlayers.set(directLoserId, {
        elo: Number(match.loser_elo_before) || 1400,
        matches_played: loserMatchesBefore,
        nickname: loserNick
      });

      console.log(`🎯 [CASCADE] Cancelled match: ${winnerNick} (ELO ${match.winner_elo_before}→restored) vs ${loserNick} (ELO ${match.loser_elo_before}→restored)`);
      console.log(`🎯 [CASCADE] Initial affected players: ${winnerNick} (ELO=${match.winner_elo_before}, matches_before=${winnerMatchesBefore}), ${loserNick} (ELO=${match.loser_elo_before}, matches_before=${loserMatchesBefore})`);

      // STEP 3: Load all ELO-applied matches that happened AFTER the cancelled one
      const subsequentMatches = await query(
        `SELECT id, winner_id, loser_id, winner_elo_before, loser_elo_before, created_at
         FROM matches
         WHERE ${ELO_STATUS_FILTER} AND created_at > ?
         ORDER BY created_at ASC, id ASC`,
        [cancelledAt]
      );

      console.log(`🎯 [CASCADE] Found ${subsequentMatches.rows.length} subsequent ELO-applied matches to scan`);

      // STEP 4: Cascade forward — skip matches where neither player is affected
      let matchesRecalculated = 0;
      for (const m of subsequentMatches.rows) {
        const mWinnerId: string = m.winner_id;
        const mLoserId:  string = m.loser_id;
        const winnerAffected = affectedPlayers.has(mWinnerId);
        const loserAffected  = affectedPlayers.has(mLoserId);

        if (!winnerAffected && !loserAffected) {
          if (process.env.BACKEND_DEBUG_LOGS === 'true') {
            const wn = await getNickname(mWinnerId);
            const ln = await getNickname(mLoserId);
            console.log(`   ⏭️  [CASCADE] Skip match ${m.id.substring(0,8)} (${wn} vs ${ln}) — neither player affected`);
          }
          continue;
        }

        const mCreatedAt = new Date(m.created_at);
        const mWinnerNick = await getNickname(mWinnerId);
        const mLoserNick  = await getNickname(mLoserId);

        // Add newcomers using their elo_before from the (still-original) match record
        if (!winnerAffected) {
          const mBefore = await countMatchesBefore(mWinnerId, mCreatedAt, m.id);
          affectedPlayers.set(mWinnerId, { elo: Number(m.winner_elo_before) || 1400, matches_played: mBefore, nickname: mWinnerNick });
          console.log(`   ➕ [CASCADE] Added ${mWinnerNick} to affected set (ELO=${m.winner_elo_before}, matches_before=${mBefore})`);
        }
        if (!loserAffected) {
          const mBefore = await countMatchesBefore(mLoserId, mCreatedAt, m.id);
          affectedPlayers.set(mLoserId, { elo: Number(m.loser_elo_before) || 1400, matches_played: mBefore, nickname: mLoserNick });
          console.log(`   ➕ [CASCADE] Added ${mLoserNick} to affected set (ELO=${m.loser_elo_before}, matches_before=${mBefore})`);
        }

        const winnerState = affectedPlayers.get(mWinnerId)!;
        const loserState  = affectedPlayers.get(mLoserId)!;

        const winnerEloBefore = winnerState.elo;
        const loserEloBefore  = loserState.elo;

        const winnerNewElo = calculateNewRating(winnerEloBefore, loserEloBefore, 'win',  winnerState.matches_played);
        const loserNewElo  = calculateNewRating(loserEloBefore,  winnerEloBefore, 'loss', loserState.matches_played);

        const eloChange = winnerNewElo - winnerEloBefore;

        console.log(`   🎮 [CASCADE] Match ${m.id.substring(0,8)}: ${mWinnerNick} ${winnerEloBefore}→${winnerNewElo} (+${eloChange}) | ${mLoserNick} ${loserEloBefore}→${loserNewElo} (${loserNewElo - loserEloBefore})`);

        await query(
          `UPDATE matches
           SET winner_elo_before = ?, winner_elo_after = ?,
               loser_elo_before  = ?, loser_elo_after  = ?,
               winner_level_before = ?, winner_level_after = ?,
               loser_level_before  = ?, loser_level_after  = ?,
               elo_change = ?
           WHERE id = ?`,
          [
            winnerEloBefore, winnerNewElo,
            loserEloBefore,  loserNewElo,
            getUserLevel(winnerEloBefore), getUserLevel(winnerNewElo),
            getUserLevel(loserEloBefore),  getUserLevel(loserNewElo),
            eloChange, m.id
          ]
        );

        winnerState.elo = winnerNewElo;
        winnerState.matches_played++;
        loserState.elo  = loserNewElo;
        loserState.matches_played++;

        matchesRecalculated++;
      }

      console.log(`🎯 [CASCADE] Cascade complete. Recalculated ${matchesRecalculated} matches. Affected players (${affectedPlayers.size}):`);
      for (const [uid, s] of affectedPlayers.entries()) {
        console.log(`   👤 ${s.nickname} → final ELO=${s.elo}`);
      }

      // STEP 5: Final stats update for all affected players
      for (const [userId, state] of affectedPlayers.entries()) {
        const winsResult = await query(
          `SELECT COUNT(*) as cnt FROM matches WHERE winner_id = ? AND ${ELO_STATUS_FILTER}`,
          [userId]
        );
        const lossesResult = await query(
          `SELECT COUNT(*) as cnt FROM matches WHERE loser_id = ? AND ${ELO_STATUS_FILTER}`,
          [userId]
        );
        // Fetch last 10 matches in chronological order (oldest→newest) to build trend
        const trendResult = await query(
          `SELECT winner_id FROM (
             SELECT winner_id, created_at FROM matches
             WHERE (winner_id = ? OR loser_id = ?) AND ${ELO_STATUS_FILTER}
             ORDER BY created_at DESC LIMIT 10
           ) sub ORDER BY created_at ASC`,
          [userId, userId]
        );

        const totalWins   = Number(winsResult.rows[0]?.cnt   ?? 0);
        const totalLosses = Number(lossesResult.rows[0]?.cnt ?? 0);
        const matchesPlayed = totalWins + totalLosses;

        let trend = '-';
        for (const row of trendResult.rows) {
          trend = calculateTrend(trend, row.winner_id === userId);
        }

        const isRated = shouldPlayerBeRated(matchesPlayed, state.elo);
        const level   = getUserLevel(state.elo);

        console.log(`   💾 [CASCADE] Updating ${state.nickname}: ELO=${state.elo}, W=${totalWins}, L=${totalLosses}, trend=${trend}, level=${level}, rated=${isRated}`);

        await query(
          `UPDATE users_extension
           SET elo_rating = ?, matches_played = ?, total_wins = ?, total_losses = ?,
               trend = ?, level = ?, is_rated = ?, updated_at = NOW()
           WHERE id = ?`,
          [state.elo, matchesPlayed, totalWins, totalLosses, trend, level, isRated, userId]
        );
      }

      // STEP 6: Recalculate faction/map balance statistics
      try {
        const factionResult = await recalculateFactionMapStatistics();
        console.log(`✓ Recalculated ${factionResult.records_updated} faction/map statistics`);
      } catch (error: any) {
        console.error('✗ Error with faction/map statistics recalculation:', error);
      }

      // STEP 7: Recalculate player of month if match is from a previous calendar month
      try {
        const now = new Date();
        const matchDate = new Date(match.created_at);
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        if (matchDate < currentMonthStart) {
          const { calculatePlayerOfMonth } = await import('../jobs/playerOfMonthJob.js');
          console.log('🎯 Recalculating player of month after dispute validation...');
          await calculatePlayerOfMonth();
          console.log('✅ Player of month recalculated after dispute validation');
        }
      } catch (error: any) {
        console.error('⚠️  Warning: Failed to recalculate player of month after dispute:', error.message);
      }

      console.log(`Match ${id} dispute validated by admin ${req.userId}: Cancelled, cascade recalculated ${matchesRecalculated} subsequent matches, updated ${affectedPlayers.size} affected players`);
      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        user_id: req.userId,
        username: req.username,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: { action: 'MATCH_DISPUTE_VALIDATED', match_id: id, matches_recalculated: matchesRecalculated, affected_players: affectedPlayers.size },
      });
      res.json({
        message: 'Dispute validated. Match cancelled, ELO recalculated for all affected players, and reopened for re-reporting.',
        reopened: false,
        affectedPlayers: affectedPlayers.size,
        matchesRecalculated
      });
    } else if (action === 'reject') {
      // Reject dispute - the dispute is not valid, match was correct
      // Simply mark as confirmed, NO stat changes, NO ELO recalculation
      await query(
        `UPDATE matches 
         SET status = ?, 
             admin_reviewed = true, 
             admin_reviewed_at = CURRENT_TIMESTAMP, 
             admin_reviewed_by = ? 
         WHERE id = ?`,
        ['confirmed', req.userId, id]
      );

      await logAuditEvent({
        event_type: 'ADMIN_ACTION',
        user_id: req.userId,
        username: req.username,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: { action: 'MATCH_DISPUTE_REJECTED', match_id: id },
      });

      console.log(`Match ${id} dispute rejected by admin ${req.userId}: Match remains confirmed`);
      res.json({ message: 'Dispute rejected. Match confirmed.' });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "validate", "reject", or "award"' });
    }
  } catch (error) {
    console.error('Admin dispute resolution error:', error);
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

// Increment replay download count - MUST be BEFORE generic /:matchId routes
router.post('/:matchId/replay/download-count', async (req: AuthRequest, res) => {
  try {
    const { matchId } = req.params;
    console.log('📊 [COUNTER] Incrementing download count for match:', matchId);

    // Increment the download count
    const updateCountResult = await query(
      'UPDATE matches SET replay_downloads = COALESCE(replay_downloads, 0) + 1 WHERE id = ?',
      [matchId]
    );
    const countResult = await query('SELECT replay_downloads FROM matches WHERE id = ?', [matchId]);

    if (updateCountResult.rowCount === 0) {
      console.warn('📊 [COUNTER] Match not found:', matchId);
      return res.status(404).json({ error: 'Match not found' });
    }

    console.log('✅ [COUNTER] Download count updated to:', countResult.rows[0].replay_downloads);
    res.json({ replay_downloads: countResult.rows[0].replay_downloads });
  } catch (error) {
    console.error('❌ [COUNTER] Error incrementing replay downloads:', error);
    res.status(500).json({ error: 'Failed to increment download count' });
  }
});

// Helper function to extract map, faction, and replay URL data from replay
function extractMatchDataFromReplay(parseSummary: any, replayUrl: string, winnerName: string, loserName: string): {
  map: string | null;
  winnerFaction: string | null;
  loserFaction: string | null;
  replayFilePathForDb: string | null;
} {
  try {
    const forumMap = parseSummary?.forumMap || null;
    let winnerFaction: string | null = null;
    let loserFaction: string | null = null;

    const detectedTeams = parseSummary?.detectedTeams;
    
    // If detectedTeams is available (team tournament), get factions from there
    if (detectedTeams && typeof detectedTeams === 'object') {
      // Find which team the winner belongs to
      let winnerTeam: any = null;
      let loserTeam: any = null;
      
      // Check each team to see if winner/loser player is in their members
      Object.values(detectedTeams).forEach((team: any) => {
        if (team.members && Array.isArray(team.members) && team.members.includes(winnerName)) {
          winnerTeam = team;
        }
        if (team.members && Array.isArray(team.members) && team.members.includes(loserName)) {
          loserTeam = team;
        }
      });
      
      if (winnerTeam && winnerTeam.factions && Array.isArray(winnerTeam.factions)) {
        winnerFaction = winnerTeam.factions.join(', ');
      }
      
      if (loserTeam && loserTeam.factions && Array.isArray(loserTeam.factions)) {
        loserFaction = loserTeam.factions.join(', ');
      }
    } else {
      // Single player tournament or non-team mode
      winnerFaction = parseSummary?.replayVictory?.winner_faction || null;
      loserFaction = parseSummary?.replayVictory?.loser_faction || null;
    }

    return {
      map: forumMap,
      winnerFaction,
      loserFaction,
      replayFilePathForDb: replayUrl || null,
    };
  } catch (error) {
    console.error('❌ Error extracting match data from replay:', error);
    return { map: null, winnerFaction: null, loserFaction: null, replayFilePathForDb: null };
  }
}

// ============================================================================
// POST endpoint to report a confidence=1 replay (unparsed match)
// User says "I won" or "I lost" to help determine the winner
// ============================================================================
// Report the winner of a confidence-one replay linked to a phase-engine game.
router.post('/report-confidence-1-replay', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { replayId, winner_choice } = req.body;
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: 'User not authenticated' });
    if (!replayId) return res.status(400).json({ error: 'Missing replayId in request body' });
    if (!['I won', 'I lost'].includes(winner_choice)) {
      return res.status(400).json({ error: 'winner_choice must be "I won" or "I lost"' });
    }

    const replayResult = await query(
      `SELECT id, parse_summary, integration_confidence, parsed, tournament_game_id, tournament_id
       FROM replays
       WHERE id = ? AND integration_confidence = 1 AND parsed = 1
         AND parse_status NOT IN ('rejected', 'due')`,
      [replayId]
    );
    const replay = replayResult.rows?.[0];
    if (!replay) return res.status(404).json({ error: 'Replay not found or not a confidence=1 replay' });
    if (!replay.tournament_game_id || !replay.tournament_id) {
      return res.status(410).json({ error: 'Only phase-engine tournament replays can be confirmed here' });
    }

    const parseSummary = typeof replay.parse_summary === 'string'
      ? JSON.parse(replay.parse_summary)
      : (replay.parse_summary || {});
    const userResult = await query('SELECT nickname FROM users_extension WHERE id = ?', [userId]);
    const nickname = userResult.rows?.[0]?.nickname?.toLowerCase();
    const forumPlayers = parseSummary.forumPlayers || [];
    if (!nickname || !forumPlayers.some((player: any) => player?.user_name?.toLowerCase() === nickname)) {
      return res.status(403).json({ error: 'You are not a participant in this replay' });
    }

    const gameResult = await query(
      `SELECT games.entry1_id, games.entry2_id,
              entry1.team_id AS entry1_team_id, entry2.team_id AS entry2_team_id,
              participant1.user_id AS entry1_user_id, participant2.user_id AS entry2_user_id
       FROM tournament_games games
       JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
       JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
       LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
       LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
       WHERE games.id = ? AND games.status = 'pending'`,
      [replay.tournament_game_id]
    );
    const game = gameResult.rows?.[0];
    if (!game) return res.status(404).json({ error: 'Pending tournament game not found' });

    const membership = await query(
      `SELECT team_id FROM tournament_participants
       WHERE tournament_id = ? AND user_id = ? AND participation_status = 'accepted'`,
      [replay.tournament_id, userId]
    );
    const teamId = membership.rows?.[0]?.team_id || null;
    const userEntryId = game.entry1_user_id === userId || game.entry1_team_id === teamId
      ? game.entry1_id
      : game.entry2_user_id === userId || game.entry2_team_id === teamId
        ? game.entry2_id
        : null;
    if (!userEntryId) return res.status(403).json({ error: 'You are not a participant in this tournament game' });

    const winnerEntryId = winner_choice === 'I won'
      ? userEntryId
      : userEntryId === game.entry1_id ? game.entry2_id : game.entry1_id;
    const progression = await recordPhaseGameResult(replay.tournament_id, replay.tournament_game_id, winnerEntryId);
    await query(
      `UPDATE replays SET parse_status = 'completed', need_integration = 0, updated_at = NOW() WHERE id = ?`,
      [replayId]
    );
    return res.json({ success: true, status: 'completed', replay_id: replayId, progression });
  } catch (error) {
    console.error('❌ Error reporting confidence-1 replay:', error);
    return res.status(500).json({ error: 'Failed to report replay', details: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/cancel-confidence-1-replay', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { replayId } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!replayId) {
      return res.status(400).json({ error: 'Missing replayId in request body' });
    }

    console.log(`🚫 [CANCEL-REPLAY] Processing cancel request for replay ${replayId} by user ${userId}`);

    // Fetch the replay
    const replayResult = await query(
      `SELECT id, parse_summary, integration_confidence, parsed, cancel_requested_by
       FROM replays WHERE id = ? AND integration_confidence = 1 AND parsed = 1 AND parse_status NOT IN ('rejected', 'due')`,
      [replayId]
    );

    if (replayResult.rows.length === 0) {
      // Row not found: already deleted (both players confirmed) or never existed
      return res.status(404).json({ error: 'Replay not found or already cancelled' });
    }

    const replay = replayResult.rows[0];

    // Parse summary to identify the players
    let parseSummary: any;
    try {
      parseSummary = typeof replay.parse_summary === 'string'
        ? JSON.parse(replay.parse_summary)
        : replay.parse_summary;
    } catch {
      return res.status(500).json({ error: 'Invalid parse_summary data in replay' });
    }

    const forumPlayers = parseSummary?.forumPlayers || [];
    if (forumPlayers.length < 2) {
      return res.status(400).json({ error: 'Replay does not have 2 identified players' });
    }

    // Get current user's nickname
    const currentUserResult = await query(
      `SELECT nickname FROM users_extension WHERE id = ?`,
      [userId]
    );
    if (currentUserResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const currentUserNickname = currentUserResult.rows[0].nickname?.toLowerCase() || '';

    // Team replays can contain more than two participants. Any participant
    // may request cancellation; a different participant must confirm it.
    const isParticipant = forumPlayers.some(
      (player: any) => player?.user_name?.toLowerCase() === currentUserNickname
    );
    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not a participant in this replay' });
    }

    // Case 1: No cancel request yet → record first request
    if (!replay.cancel_requested_by) {
      await query(
        `UPDATE replays SET cancel_requested_by = ? WHERE id = ?`,
        [userId, replayId]
      );
      console.log(`🚫 [CANCEL-REPLAY] Cancel requested by ${userId} for replay ${replayId}. Waiting for other player.`);
      return res.json({
        success: true,
        status: 'waiting_confirmation',
        message: 'Cancel request recorded. Waiting for the other player to confirm.'
      });
    }

    // Case 2: Same player is clicking cancel again → idempotent, already requested
    if (replay.cancel_requested_by === userId) {
      return res.json({
        success: true,
        status: 'waiting_confirmation',
        message: 'You have already requested cancellation. Waiting for the other player to confirm.'
      });
    }

    // Case 3: Different player is now confirming the cancel → delete the replay entirely.
    // Replays exist only to become matches; if both players agree the game was not finished,
    // there is no match to create and the record is no longer needed.
    await query(
      `DELETE FROM replays WHERE id = ?`,
      [replayId]
    );

    console.log(`✅ [CANCEL-REPLAY] Replay ${replayId} deleted. Both players agreed game was not finished.`);
    return res.json({
      success: true,
      status: 'cancelled',
      message: 'Both players confirmed. Replay has been deleted (game not finished).'
    });

  } catch (error) {
    console.error('❌ Error cancelling confidence-1 replay:', error);
    res.status(500).json({ error: 'Failed to cancel replay', details: error instanceof Error ? error.message : String(error) });
  }
});


router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // Get page from query params, default to 1
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get filter params from query
    const playerFilter = (req.query.player as string)?.trim() || '';
    const mapFilter = (req.query.map as string)?.trim() || '';
    const statusFilter = (req.query.status as string)?.trim() || '';
    const confirmedFilter = (req.query.confirmed as string)?.trim() || '';
    const factionFilter = (req.query.faction as string)?.trim() || '';

    console.log('🔍 GET /matches - Filters received:', { playerFilter, mapFilter, statusFilter, confirmedFilter, factionFilter });

    // Build WHERE clause dynamically
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramCount = 1;

    if (playerFilter) {
      whereConditions.push(`(w.nickname LIKE ? OR l.nickname LIKE ?)`);
      params.push(`%${playerFilter}%`);
      params.push(`%${playerFilter}%`);
    }

    if (mapFilter) {
      whereConditions.push(`m.map LIKE ?`);
      params.push(`%${mapFilter}%`);
    }

    if (statusFilter) {
      whereConditions.push(`m.status = ?`);
      params.push(statusFilter);
    }

    if (confirmedFilter) {
      whereConditions.push(`m.status = ?`);
      params.push(confirmedFilter);
    }

    if (factionFilter) {
      whereConditions.push(`(m.winner_faction = ? OR m.loser_faction = ?)`);
      params.push(factionFilter);
      params.push(factionFilter);
      console.log('🔍 Faction filter applied:', factionFilter);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total count of filtered matches
    const countQuery = `SELECT COUNT(*) as total FROM matches m 
                        JOIN users_extension w ON m.winner_id = w.id 
                        JOIN users_extension l ON m.loser_id = l.id 
                        ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    // Get matches for current page with filters
    params.push(limit);
    params.push(offset);
    const result = await query(
      `SELECT m.id, m.winner_id, m.loser_id, m.winner_faction, m.loser_faction, m.map, m.status,
              m.winner_elo_before, m.winner_elo_after, m.loser_elo_before, m.loser_elo_after,
              m.winner_rating, m.loser_rating, m.winner_comments, m.loser_comments,
              m.replay_file_path, m.replay_downloads, m.created_at, m.updated_at, m.played_at,
              m.admin_reviewed, m.tournament_id,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname,
              'match' as source_type
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    // Get replays with confidence=1 to show as pending reports (ONLY for involved players)
    const replayResult = await query(
      `SELECT 
        r.id, 
        r.replay_filename,
        r.game_name,
        r.parse_summary,
        r.created_at,
        r.wesnoth_version,
        r.cancel_requested_by,
        r.parse_status
       FROM replays r
       WHERE r.integration_confidence = 1
         AND r.parsed = 1
         AND r.parse_status NOT IN ('rejected')
         AND r.match_id IS NULL
         AND r.tournament_game_id IS NULL
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    console.log(`📊 [MATCHES] Found ${result.rows.length} matches and ${replayResult.rows?.length || 0} confidence=1 replays`);

    // DEBUG: log raw replay rows before filtering
    if (process.env.BACKEND_DEBUG_LOGS === 'true') {
      const debugReplays = await query(
        `SELECT r.id, r.tournament_game_id, r.integration_confidence, r.parsed, r.match_id, r.parse_status
         FROM replays r
         WHERE r.integration_confidence = 1 AND r.parsed = 1 AND r.parse_status NOT IN ('rejected') AND r.match_id IS NULL
         ORDER BY r.created_at DESC LIMIT 10`,
        []
      );
      console.log(`🔍 [MATCHES DEBUG] All confidence=1 parsed replays (before tournament filter):`, JSON.stringify(debugReplays.rows));
      console.log(`🔍 [MATCHES DEBUG] Filtered replay rows returned:`, JSON.stringify(replayResult.rows?.map((r: any) => r.id)));
    }

    // Get current user's nickname and admin status once (for security check)
    const currentUserResult = await query(
      `SELECT nickname, is_admin FROM users_extension WHERE id = ?`,
      [req.userId]
    );
    const currentUserNickname = currentUserResult.rows?.[0]?.nickname?.toLowerCase() || '';
    const currentUserIsAdmin = !!(currentUserResult.rows?.[0]?.is_admin);

    console.log(`🔍 [MATCHES DEBUG] userId=${req.userId} nickname=${currentUserNickname} isAdmin=${currentUserIsAdmin} replayRows=${replayResult.rows?.length ?? 'undefined'}`);

    // Format confidence=1 replays as match-like objects - BUT ONLY IF USER IS INVOLVED
    const formattedReplays = [];
    
    for (const r of replayResult.rows) {
      try {
        const parseSummary = typeof r.parse_summary === 'string' 
          ? JSON.parse(r.parse_summary) 
          : r.parse_summary;

        // Extract players from parse_summary
        const players = parseSummary.forumPlayers || [];
        if (players.length < 2) continue;

        const player1Name = players[0]?.user_name?.toLowerCase() || '';
        const player2Name = players[1]?.user_name?.toLowerCase() || '';

        // SECURITY: Only show this replay to involved players OR admins
        const isInvolved = currentUserNickname === player1Name || currentUserNickname === player2Name;
        if (!isInvolved && !currentUserIsAdmin) {
          continue;
        }

        // Get victory condition info
        const victory = parseSummary.replayVictory || {};
        const winnerName = victory.winner_name || players[0]?.user_name || 'Unknown';
        const loserName = victory.loser_name || players[1]?.user_name || 'Unknown';

        const winnerPlayer = players.find((p: any) => p.user_name === winnerName);
        const loserPlayer = players.find((p: any) => p.user_name === loserName);

        const resolvedFactions = parseSummary.resolvedFactions || parseSummary.finalFactions || {};
        const winner_faction = (winnerPlayer ? resolvedFactions[`side${winnerPlayer.side_number}`] : null) || 'Unknown';
        const loser_faction = (loserPlayer ? resolvedFactions[`side${loserPlayer.side_number}`] : null) || 'Unknown';
        const winner_side = winnerPlayer?.side_number || null;
        const loser_side = loserPlayer?.side_number || null;

        formattedReplays.push({
          id: r.id,
          winner_id: null,  // Unknown until reported
          loser_id: null,   // Unknown until reported
          winner_nickname: winnerName,
          loser_nickname: loserName,
          winner_faction: winner_faction,
          loser_faction: loser_faction,
          winner_side: winner_side,
          loser_side: loser_side,
          map: parseSummary.resolvedMap || parseSummary.forumMap || 'Unknown',
          status: 'pending_report',
          winner_elo_before: null,
          winner_elo_after: null,
          loser_elo_before: null,
          loser_elo_after: null,
          winner_rating: null,
          loser_rating: null,
          winner_comments: null,
          loser_comments: null,
          replay_file_path: `https://replays.wesnoth.org/${r.wesnoth_version}/${r.replay_filename}`,
          replay_downloads: 0,
          created_at: r.created_at,
          updated_at: r.created_at,
          played_at: null,
          admin_reviewed: false,
          tournament_id: null,
          parse_status: r.parse_status,
          source_type: r.parse_status === 'due' ? 'replay_confidence_1_due' : 'replay_confidence_1',
          replay_id: r.id,
          confidence_level: 1,
          parse_summary: parseSummary,
          replay_filename: r.replay_filename,
          game_name: r.game_name,
          cancel_requested_by: r.cancel_requested_by || null,
          is_admin_view: currentUserIsAdmin && !isInvolved
        });
      } catch (error) {
        console.error('Error formatting replay:', error);
        continue;
      }
    }

    // Combine matches and replays
    const allResults = [...result.rows, ...formattedReplays];
    
    // Sort by created_at DESC
    allResults.sort((a: any, b: any) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime;
    });

    // Apply pagination to combined results
    const paginatedResults = allResults.slice(0, limit);
    const combinedTotal = total + (replayResult.rows?.length || 0);
    const combinedTotalPages = Math.ceil(combinedTotal / limit);

    res.json({
      data: paginatedResults,
      pagination: {
        page,
        limit,
        total: combinedTotal,
        totalPages: combinedTotalPages,
        showing: paginatedResults.length
      }
    });
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

// Cancel own match (self-dispute auto-confirmation)
// Reporter can cancel a match they reported if it hasn't been disputed yet
router.post('/:id/cancel-own', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    
    // Fetch the match
    const matchResult = await query(
      'SELECT * FROM matches WHERE id = ?',
      [id]
    );
    
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    const match = matchResult.rows[0];
    
    // Verify user is the reporter (winner)
    if (match.winner_id !== userId) {
      return res.status(403).json({ error: 'Only the match reporter (winner) can cancel it' });
    }
    
    // Match must not be in a final state already
    if (!['pending', 'confirmed', 'unconfirmed'].includes(match.status)) {
      return res.status(400).json({ error: `Match is already ${match.status}, cannot cancel` });
    }
    
    console.log(`[SELF-CANCEL] Player ${userId} canceling their own match ${id}`);
    
    // STEP 1: Mark the match as cancelled
    await query(
      'UPDATE matches SET status = ?, admin_reviewed = true, admin_reviewed_at = CURRENT_TIMESTAMP, admin_reviewed_by = ? WHERE id = ?',
      ['cancelled', userId, id]
    );
    
    // STEP 2: Perform global stats recalculation
    const recalcResult = await performGlobalStatsRecalculation();
    
    if (recalcResult.success) {
      console.log(`Match ${id} self-cancelled by reporter ${userId}: Stats recalculated`);
      res.json({ 
        message: 'Match cancelled successfully. Stats have been recalculated.',
        matchId: id,
        debugLogs: recalcResult.logs
      });
    } else {
      console.error(`Match ${id} cancelled but stats recalculation may have failed`);
      res.json({ 
        message: 'Match cancelled successfully.',
        matchId: id,
        warning: 'Stats recalculation encountered some issues',
        debugLogs: recalcResult.logs
      });
    }
  } catch (error) {
    console.error('Error cancelling match:', error);
    res.status(500).json({ error: 'Failed to cancel match' });
  }
});

/**
 * POST /api/matches/admin-discard-replay
 * Admin-only: immediately discard a confidence=1 replay.
 * Players are NOT asked for confirmation; replay goes straight to parse_status='rejected'.
 * Body: { replayId: string }
 */
router.post('/admin-discard-replay', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { replayId } = req.body;
    if (!replayId) {
      return res.status(400).json({ error: 'Missing required field: replayId' });
    }

    // Verify admin
    const adminResult = await query(
      `SELECT is_admin FROM users_extension WHERE id = ?`,
      [req.userId]
    );
    if (!adminResult.rows?.[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Verify replay exists and is awaiting confirmation
    const replayResult = await query(
      `SELECT id, parse_status, integration_confidence, need_integration FROM replays WHERE id = ?`,
      [replayId]
    );
    const replay = replayResult.rows?.[0];
    if (!replay || replay.need_integration !== 1) {
      return res.status(400).json({ error: 'Replay is not awaiting confirmation' });
    }

    await query(
      `UPDATE replays SET parse_status = 'rejected', need_integration = 0, parsed = 1, updated_at = NOW() WHERE id = ?`,
      [replayId]
    );

    console.log(`🗑️  [ADMIN DISCARD] Replay ${replayId} discarded by admin ${req.userId}`);
    res.json({ status: 'success', message: 'Replay discarded by admin', replay_id: replayId });
  } catch (error) {
    console.error('Error in admin-discard-replay:', error);
    res.status(500).json({ error: 'Failed to discard replay' });
  }
});

export default router;
export { performGlobalStatsRecalculation };
