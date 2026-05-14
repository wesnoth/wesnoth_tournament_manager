import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { authMiddleware, moderatorOrAdminMiddleware, AuthRequest } from '../middleware/auth.js';
import { getUserLevel } from '../utils/auth.js';
import {
  calculateNewRating,
  calculateInitialRating,
  shouldPlayerBeRated,
  calculateTrend,
  getKFactorWithReason,
} from '../utils/elo.js';
import { updateBestOfSeriesDB, createNextMatchInSeries } from '../utils/bestOf.js';
import { checkAndCompleteRound } from '../utils/tournament.js';
import {
  updateFactionMapStatistics,
  recalculatePlayerMatchStatistics,
  recalculateFactionMapStatistics,
  updatePlayerElo
} from '../services/statisticsCalculator.js';
import { updateTournamentRoundMatch } from '../services/matchCreationService.js';
import { validateAndCorrectFactions, handlePostConfirmation } from '../services/replayConfirmationService.js';
// NOTE: Supabase replay storage temporarily disabled - using /uploads/replays instead
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

// Use memory storage to avoid writing temp files before uploading to Supabase
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
async function performGlobalStatsRecalculation() {
  const logs: string[] = [];
  const isDebugEnabled = process.env.BACKEND_DEBUG_LOGS === 'true';
  
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

    // STEP 3: Initialize all users with baseline ELO and zero stats
    const userStates = new Map<string, {
      elo_rating: number;
      matches_played: number;
      total_wins: number;
      total_losses: number;
      trend: string;
      level: string;
    }>();

    const allUsersResult = await query('SELECT id FROM users_extension');
    for (const userRow of allUsersResult.rows) {
      userStates.set(userRow.id, {
        elo_rating: defaultElo,
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
        userStates.set(winnerId, { elo_rating: defaultElo, matches_played: 0, total_wins: 0, total_losses: 0, trend: '-', level: 'Novato' });
      }
      if (!userStates.has(loserId)) {
        userStates.set(loserId, { elo_rating: defaultElo, matches_played: 0, total_wins: 0, total_losses: 0, trend: '-', level: 'Novato' });
      }

      const winner = userStates.get(winnerId)!;
      const loser = userStates.get(loserId)!;

      // Store before values
      const winnerEloBefore = winner.elo_rating;
      const loserEloBefore = loser.elo_rating;
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
      winner.matches_played++;
      loser.matches_played++;
      winner.total_wins++;
      loser.total_losses++;
      winner.trend = calculateTrend(winner.trend, true);
      loser.trend = calculateTrend(loser.trend, false);
      
      // Update levels in state for next iteration
      winner.level = winnerLevelAfter;
      loser.level = loserLevelAfter;

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
             elo_change = ?
         WHERE id = ?`,
        [winnerEloBefore, winnerNewRating, loserEloBefore, loserNewRating, winnerLevelBefore, winnerLevelAfter, loserLevelBefore, loserLevelAfter, winnerEloChange, matchRow.id]
      );

      matchProcessedCount++;
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
    for (const [userId, stats] of userStates.entries()) {
      // Get current is_rated status from database
      const userCurrentResult = await query('SELECT is_rated FROM users_extension WHERE id = ?', [userId]);
      const isCurrentlyRated = userCurrentResult.rows[0]?.is_rated || false;
      
      let isRated = isCurrentlyRated;
      
      // If rated and ELO falls below 1400, unrate the player
      if (isCurrentlyRated && stats.elo_rating < 1400) {
        isRated = false;
      }
      // If unrated, has 10+ matches, and ELO >= 1400, rate the player
      else if (!isCurrentlyRated && stats.matches_played >= 10 && stats.elo_rating >= 1400) {
        isRated = true;
      }
      
      await query(
        `UPDATE users_extension 
         SET elo_rating = ?, 
             matches_played = ?,
             total_wins = ?,
             total_losses = ?,
             trend = ?,
             level = ?,
             is_rated = ?,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [stats.elo_rating, stats.matches_played, stats.total_wins, stats.total_losses, stats.trend, stats.level, isCurrentlyRated, userId]
      );
      usersUpdatedCount++;
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

    // STEP 7: Recalculate player match statistics and faction/map balance statistics
    try {
      const playerResult = await recalculatePlayerMatchStatistics();
      const msg = `✓ Recalculated ${playerResult.records_updated} player match statistics`;
      logs.push(msg);
      if (isDebugEnabled) console.log(msg);
    } catch (error) {
      const msg = `✗ Error recalculating player match statistics: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logs.push(msg);
      console.error(msg);
    }

    try {
      const factionResult = await recalculateFactionMapStatistics();
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
      const msg = `✗ Error recalculating faction/map statistics: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logs.push(msg);
      console.error(msg);
    }

    return { 
      success: true, 
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

// Helper function to check if a round is complete and update round_end_date
async function checkAndUpdateRoundCompletion(roundId: string, tournamentId: string) {
  try {
    // Get all tournament_round_matches for this round
    const matchesResult = await query(
      `SELECT COUNT(*) as total_matches, 
              COUNT(CASE WHEN winner_id IS NOT NULL THEN 1 END) as completed_matches
       FROM tournament_round_matches 
       WHERE round_id = ?`,
      [roundId]
    );

    if (matchesResult.rows.length === 0) return;

    const { total_matches, completed_matches } = matchesResult.rows[0];

    // If all matches are completed, update round_end_date
    if (total_matches > 0 && parseInt(total_matches) === parseInt(completed_matches)) {
      await query(
        `UPDATE tournament_rounds 
         SET round_end_date = CURRENT_TIMESTAMP, round_status = 'completed', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [roundId]
      );
      console.log(`✅ Round ${roundId} completed - updated round_end_date`);
    }
  } catch (error) {
    console.error('Error checking round completion:', error);
    // Don't throw - this is a background check
  }
}

// Helper function to handle series completion and check round completion
async function handleSeriesAndRoundCompletion(seriesUpdate: any, tournamentRoundMatchId: string, roundId: string, tournamentId: string, tournament_match_id: string) {
  try {
    // If series not complete and we need another match, create it
    if (seriesUpdate.shouldCreateNextMatch) {
      try {
        const nextMatchId = await createNextMatchInSeries(tournamentRoundMatchId, tournamentId, roundId);
        if (nextMatchId) {
          console.log(`Created next match in series: ${nextMatchId}`);
        }
      } catch (nextMatchError) {
        console.error('Error creating next match in series:', nextMatchError);
        // Don't fail if next match creation fails
      }
    } else {
      // Series is complete, check if round is complete
      try {
        const roundNumberResult = await query(
          `SELECT round_number FROM tournament_rounds WHERE id = ?`,
          [roundId]
        );
        const roundNumber = roundNumberResult.rows[0]?.round_number;
        
        if (roundNumber) {
          const isRoundComplete = await checkAndCompleteRound(tournamentId, roundNumber);
          if (isRoundComplete) {
            console.log(`✅ Round ${roundNumber} for tournament ${tournamentId} is now complete`);
          }
        }
      } catch (roundCompleteError) {
        console.error('Error checking round completion:', roundCompleteError);
        // Don't fail if round check fails
      }
    }
  } catch (error) {
    console.error('Error handling series and round completion:', error);
    // Don't throw - this is a background operation
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
router.post('/:id/confirm', authMiddleware, async (req: AuthRequest, res) => {
  try {
    console.log('✅ POST /:id/confirm alcanzado', req.params.id, req.body.action);
    const { id } = req.params;
    const { comments, rating, action } = req.body;

    // First check if this is a tournament_match to detect if ranked or unranked
    const tournamentMatchResult = await query(
      'SELECT * FROM tournament_matches WHERE id = ?',
      [id]
    );

    let match;
    let isUnranked = false;
    let tournamentMatchId = null;

    if (tournamentMatchResult.rows.length > 0) {
      // Found in tournament_matches
      const tm = tournamentMatchResult.rows[0];
      tournamentMatchId = tm.id;

      if (tm.match_id === null) {
        // This is an UNRANKED tournament match (match_id is NULL)
        isUnranked = true;
        match = tm;
        console.log('Found unranked tournament match in tournament_matches');
      } else {
        // This is a RANKED tournament match (match_id IS NOT NULL)
        // Get the actual match data from matches table
        const rankedMatchResult = await query(
          'SELECT * FROM matches WHERE id = ?',
          [tm.match_id]
        );
        
        if (rankedMatchResult.rows.length === 0) {
          console.log('❌ Ranked match not found:', tm.match_id);
          return res.status(404).json({ error: 'Match not found' });
        }

        match = rankedMatchResult.rows[0];
        isUnranked = false;
        console.log('Found ranked tournament match in matches table');
      }
    } else {
      // Not a tournament match, try to find in matches table (RANKED only)
      const rankedMatchResult = await query(
        'SELECT * FROM matches WHERE id = ?',
        [id]
      );

      if (rankedMatchResult.rows.length === 0) {
        console.log('❌ Match not found:', id);
        return res.status(404).json({ error: 'Match not found' });
      }

      match = rankedMatchResult.rows[0];
      isUnranked = false;
      console.log('Found ranked match (non-tournament)');
    }

    // Calculate loser_id if not present (for team tournaments where it's null)
    let loserId = match.loser_id;
    if (!loserId && match.player1_id && match.player2_id && match.winner_id) {
      loserId = match.winner_id === match.player1_id ? match.player2_id : match.player1_id;
    }

    console.log('Match loser_id:', loserId, 'Current user:', req.userId);
    console.log('Match winner_id:', match.winner_id);
    console.log('Is unranked:', isUnranked);

    // Verify that the user confirming is either the loser or winner
    let isWinner = match.winner_id === req.userId;
    let isLoser = loserId === req.userId;
    
    // For unranked tournament matches with team IDs, get the user's team_id
    if (isUnranked && tournamentMatchId && !isWinner && !isLoser) {
      // Check if this is a team tournament and get user's team_id
      const userTeamResult = await query(
        `SELECT tp.team_id 
         FROM tournament_participants tp 
         WHERE tp.user_id = ? AND tp.tournament_id = ?`,
        [req.userId, match.tournament_id]
      );
      
      if (userTeamResult.rows.length > 0) {
        const userTeamId = userTeamResult.rows[0].team_id;
        console.log('User team_id for tournament:', userTeamId);
        isWinner = match.winner_id === userTeamId;
        isLoser = loserId === userTeamId;
      }
    }
    
    if (!isWinner && !isLoser) {
      console.log('❌ User is neither winner nor loser');
      return res.status(403).json({ error: 'Only match participants can confirm this match' });
    }

    if (action === 'confirm') {
      // Validate rating if provided
      if (rating && (rating < 1 || rating > 5)) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }

      if (isUnranked) {
        // UNRANKED: update only tournament_matches based on winner/loser
        if (isWinner) {
          await query(
            `UPDATE tournament_matches 
             SET winner_comments = ?, 
                 winner_rating = ?,
                 match_status = 'completed',
                 status = 'confirmed',
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [comments || null, rating || null, id]
          );
        } else {
          await query(
            `UPDATE tournament_matches 
             SET loser_comments = ?, 
                 loser_rating = ?,
                 match_status = 'completed',
                 status = 'confirmed',
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [comments || null, rating || null, id]
          );
        }
      } else {
        // RANKED: update matches table with appropriate columns based on winner/loser
        if (isWinner) {
          // Winner confirming - update winner columns
          await query(
            `UPDATE matches 
             SET winner_comments = ?, 
                 winner_rating = ?,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [comments || null, rating || null, id]
          );
        } else {
          // Loser confirming - update loser columns
          await query(
            `UPDATE matches 
             SET loser_comments = ?, 
                 loser_rating = ?,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [comments || null, rating || null, id]
          );
        }

        // Check if both have now confirmed - update status to 'confirmed' if both ratings are present
        const updatedMatch = await query(
          'SELECT loser_rating, winner_rating FROM matches WHERE id = ?',
          [id]
        );
        
        if (updatedMatch.rows.length > 0 && updatedMatch.rows[0].loser_rating && updatedMatch.rows[0].winner_rating) {
          // Both have confirmed - update status to confirmed
          await query(
            'UPDATE matches SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['confirmed', id]
          );
          console.log(`✅ Match ${id} fully confirmed by both players`);
        } else {
          console.log(`⏳ Match ${id} partially confirmed - waiting for other player`);
        }

        // Also update tournament_matches if this is a tournament ranked match
        if (tournamentMatchId) {
          if (isWinner) {
            await query(
              `UPDATE tournament_matches 
               SET winner_comments = ?, 
                   winner_rating = ?,
                   updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [comments || null, rating || null, tournamentMatchId]
            );
          } else {
            await query(
              `UPDATE tournament_matches 
               SET loser_comments = ?, 
                   loser_rating = ?,
                   updated_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [comments || null, rating || null, tournamentMatchId]
            );
          }
        }
      }

      console.log(
        `Match ${id} confirmed: ${isWinner ? 'Winner' : 'Loser'} ${req.userId} confirmed the match result`
      );

      console.log('✅ Respondiendo con éxito - confirm');
      res.json({ message: 'Match confirmed successfully with your comments and rating' });
    } else if (action === 'dispute') {
      if (isUnranked) {
        // UNRANKED: save comment in the appropriate column and mark as disputed
        const commentColumn = isWinner ? 'winner_comments' : 'loser_comments';
        await query(
          `UPDATE tournament_matches SET match_status = 'completed', status = 'disputed',
            ${commentColumn} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [comments || null, id]
        );

        console.log(`Unranked tournament match ${id} marked as disputed by ${isWinner ? 'winner' : 'loser'} ${req.userId}`);
        res.json({ message: 'Match disputed. Awaiting organizer review.' });
      } else {
        // RANKED: save comment in winner_comments or loser_comments and mark as disputed
        if (isWinner) {
          await query(
            `UPDATE matches SET status = 'disputed', winner_comments = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [comments || null, id]
          );
        } else {
          await query(
            `UPDATE matches SET status = 'disputed', loser_comments = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [comments || null, id]
          );
        }

        // Also update tournament_matches if this is a tournament ranked match
        if (tournamentMatchId) {
          const tmCommentColumn = isWinner ? 'winner_comments' : 'loser_comments';
          await query(
            `UPDATE tournament_matches SET status = 'disputed', ${tmCommentColumn} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [comments || null, tournamentMatchId]
          );
        }

        console.log(
          `Match ${id} disputed by loser ${req.userId}: Awaiting admin review. Stats remain unchanged.`
        );

        console.log('✅ Respondiendo con éxito - dispute');
        res.json({ message: 'Match disputed. Awaiting admin review.' });
      }
    } else {
      res.status(400).json({ error: 'Invalid action. Use "confirm" or "dispute"' });
    }
  } catch (error) {
    console.error('Match confirmation error:', error);
    res.status(500).json({ error: 'Failed to update match' });
  }
});

// Get all disputed matches (admin view) - MUST be before /:id route
router.get('/disputed/all', moderatorOrAdminMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await query(
      `SELECT m.*,
              w.nickname as winner_nickname,
              l.nickname as loser_nickname
       FROM matches m
       JOIN users_extension w ON m.winner_id = w.id
       JOIN users_extension l ON m.loser_id = l.id
       WHERE m.status = 'disputed'
       ORDER BY m.updated_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
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
    const { action } = req.body; // 'validate' or 'reject'

    const matchResult = await query('SELECT * FROM matches WHERE id = ?', [id]);
    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchResult.rows[0];

    if (match.status !== 'disputed') {
      return res.status(400).json({ error: 'Match is not disputed' });
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

      // STEP 8: Reopen linked tournament match for re-reporting
      const tournamentMatchResult = await query(
        `SELECT tm.id as tm_id FROM tournament_matches tm WHERE tm.match_id = ?`,
        [id]
      );

      if (tournamentMatchResult.rows.length > 0) {
        const tournamentMatch = tournamentMatchResult.rows[0];
        await query(
          `UPDATE tournament_matches
           SET match_status = 'pending', winner_id = NULL, match_id = NULL, played_at = NULL
           WHERE id = ?`,
          [tournamentMatch.tm_id]
        );
        console.log(`Match ${id} reopened in tournament_matches ${tournamentMatch.tm_id} for re-reporting`);
      }

      console.log(`Match ${id} dispute validated by admin ${req.userId}: Cancelled, cascade recalculated ${matchesRecalculated} subsequent matches, updated ${affectedPlayers.size} affected players`);
      res.json({
        message: 'Dispute validated. Match cancelled, ELO recalculated for all affected players, and reopened for re-reporting.',
        reopened: tournamentMatchResult.rows.length > 0,
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

      console.log(`Match ${id} dispute rejected by admin ${req.userId}: Match remains confirmed`);
      res.json({ message: 'Dispute rejected. Match confirmed.' });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "validate" or "reject"' });
    }
  } catch (error) {
    console.error('Admin dispute resolution error:', error);
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

// Get signed download URL for replay file - PUBLIC endpoint with expiring URLs
// Returns a 5-minute signed URL that client can use for direct download from Supabase
router.get('/:matchId/replay/download', async (req: AuthRequest, res) => {
  try {
    const { matchId } = req.params;
    console.log('📥 [DOWNLOAD] Signed URL request for match:', matchId);

    // Get match and replay file path from database
    const result = await query(
      'SELECT replay_file_path FROM matches WHERE id = ?',
      [matchId]
    );

    if (result.rows.length === 0) {
      console.warn('📥 [DOWNLOAD] Match not found:', matchId);
      return res.status(404).json({ error: 'Match not found' });
    }

    let replayFilePath = result.rows[0].replay_file_path;
    console.log('📥 [DOWNLOAD] Retrieved replay path from DB:', replayFilePath);

    if (!replayFilePath) {
      console.warn('📥 [DOWNLOAD] No replay file stored for match:', matchId);
      return res.status(404).json({ error: 'No replay file for this match' });
    }

    // NOTE: Supabase replay download temporarily disabled - using /uploads/replays instead
    console.log('📥 [DOWNLOAD] Replay download feature will be implemented');
    
    // TODO: Implement local file download from /uploads/replays
    return res.status(501).json({ error: 'Replay download feature will be implemented' });
  } catch (error) {
    console.error('❌ [DOWNLOAD] Replay download error:', error);
    return res.status(500).json({ error: 'Failed to download replay' });
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
router.post('/report-confidence-1-replay', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { replayId, winner_choice, rating, comments, tournament_match_id } = req.body;
    const userId = req.userId;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📋 [CONFIDENCE-1] ===== STARTING REPLAY CONFIRMATION FLOW =====`);
    console.log(`📋 [CONFIDENCE-1] Request received:`);
    console.log(`   replayId: ${replayId}`);
    console.log(`   userId: ${userId}`);
    console.log(`   winner_choice: ${winner_choice}`);
    console.log(`   rating: ${rating}`);
    console.log(`   comments: ${comments ? comments.substring(0, 50) : 'null'}`);
    console.log(`   tournament_match_id: ${tournament_match_id}`);
    console.log(`${'='.repeat(80)}\n`);

    // Validate user is authenticated
    if (!userId) {
      console.error(`❌ [CONFIDENCE-1] User not authenticated`);
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Validate inputs
    if (!replayId) {
      console.error(`❌ [CONFIDENCE-1] Missing replayId`);
      return res.status(400).json({ error: 'Missing replayId in request body' });
    }

    if (!winner_choice || !['I won', 'I lost'].includes(winner_choice)) {
      console.error(`❌ [CONFIDENCE-1] Invalid winner_choice: ${winner_choice}`);
      return res.status(400).json({ error: 'winner_choice must be "I won" or "I lost"' });
    }

    console.log(`✅ [CONFIDENCE-1] Input validation passed`);

    // Get the replay from database
    console.log(`📥 [CONFIDENCE-1] Fetching replay from database...`);
    const replayResult = await query(
      `SELECT id, parse_summary, integration_confidence, parsed,
              game_id, wesnoth_version, instance_uuid, tournament_round_match_id,
              replay_url, tournament_id
       FROM replays WHERE id = ? AND integration_confidence = 1 AND parsed = 1 AND parse_status != 'rejected'`,
      [replayId]
    );

    if (replayResult.rows.length === 0) {
      console.error(`❌ [CONFIDENCE-1] Replay not found: ${replayId}`);
      return res.status(404).json({ error: 'Replay not found or not a confidence=1 replay' });
    }

    const replay = replayResult.rows[0];
    console.log(`✅ [CONFIDENCE-1] Replay loaded:`, {
      replayId: replay.id,
      tournament_id: replay.tournament_id,
      tournament_round_match_id: replay.tournament_round_match_id,
      has_tournament_round_match: !!replay.tournament_round_match_id
    });
    
    console.log(`[DEBUG] About to parse parse_summary...`);
    let parseSummary: any;

    try {
      console.log(`[DEBUG] parse_summary type: ${typeof replay.parse_summary}, length: ${replay.parse_summary?.length}`);
      parseSummary = typeof replay.parse_summary === 'string' 
        ? JSON.parse(replay.parse_summary) 
        : replay.parse_summary;
      console.log(`[DEBUG] parse_summary parsed successfully`);
    } catch (parseError) {
      console.error('❌ [CONFIDENCE-1] Failed to parse parse_summary JSON:', parseError);
      return res.status(500).json({ error: 'Invalid parse_summary data in replay' });
    }

    console.log(`📥 [CONFIDENCE-1] Parsing forumPlayers from replay...`);
    // Extract player information from parse_summary
    const forumPlayers = parseSummary?.forumPlayers || [];
    if (forumPlayers.length < 2) {
      console.error(`❌ [CONFIDENCE-1] Replay does not have at least 2 players, got ${forumPlayers.length}`);
      return res.status(400).json({ error: 'Replay does not have at least 2 players' });
    }

    console.log(`✅ [CONFIDENCE-1] Total players in replay: ${forumPlayers.length}`);
    const allPlayerNames = forumPlayers.map((p: any) => `${p?.user_name} (side ${p?.side_number})`).join(', ');
    console.log(`✅ [CONFIDENCE-1] All players from replay: ${allPlayerNames}`);

    // Get current user's nickname
    console.log(`📥 [CONFIDENCE-1] Fetching current user nickname (userId: ${userId})...`);
    const currentUserResult = await query(
      `SELECT nickname FROM users_extension WHERE id = ?`,
      [userId]
    );
    
    if (currentUserResult.rows.length === 0) {
      console.error(`❌ [CONFIDENCE-1] Current user not found in database`);
      return res.status(404).json({ error: 'User not found' });
    }

    const currentUserNickname = currentUserResult.rows[0].nickname?.toLowerCase() || '';
    console.log(`✅ [CONFIDENCE-1] Current user: "${currentUserNickname}"`);

    // Security check: user must be one of all players in the replay
    const currentUserInReplay = forumPlayers.find((p: any) => p?.user_name?.toLowerCase() === currentUserNickname);
    
    if (!currentUserInReplay) {
      const replayPlayerNames = forumPlayers.map((p: any) => p?.user_name).join(', ');
      console.error(`❌ [CONFIDENCE-1] SECURITY CHECK FAILED: User "${currentUserNickname}" is not in replay (players: ${replayPlayerNames})`);
      return res.status(403).json({ error: 'You are not a participant in this replay' });
    }

    console.log(`✅ [CONFIDENCE-1] Security check passed - user is a participant (side ${currentUserInReplay.side_number})`);

    // Determine winner/loser based on tournament_match structure
    let winnerId: string = userId;
    let loserId: string = '';

    // For team tournaments, we need to get the team IDs from detectedTeams
    const detectedTeams = parseSummary?.detectedTeams || {};
    const tournamentMode = parseSummary?.detectedTournament?.tournament_mode || 'individual';
    
    console.log(`📥 [CONFIDENCE-1] Tournament mode: ${tournamentMode}`);

    if (tournamentMode === 'team') {
      // Team tournament: find which team the current user belongs to
      let userTeamId: string | null = null;
      
      for (const [teamId, teamData] of Object.entries(detectedTeams)) {
        const teamMembers = (teamData as any)?.members || [];
        if (teamMembers.some((member: string) => member.toLowerCase() === currentUserNickname)) {
          userTeamId = teamId;
          console.log(`✅ [CONFIDENCE-1] User "${currentUserNickname}" belongs to team ${teamId} (${(teamData as any)?.team_name})`);
          break;
        }
      }

      if (!userTeamId) {
        console.error(`❌ [CONFIDENCE-1] Could not find user's team in detectedTeams`);
        return res.status(400).json({ error: 'Could not determine user\'s team from replay' });
      }

      // Get the tournament_match to see player1_id and player2_id (which are team IDs for team tournaments)
      console.log(`📥 [CONFIDENCE-1] Looking up tournament_match: ${replay.tournament_round_match_id}...`);
      const matchResult = await query(
        `SELECT player1_id, player2_id FROM tournament_matches 
         WHERE tournament_round_match_id = ? AND match_status = 'pending' LIMIT 1`,
        [replay.tournament_round_match_id]
      );

      if (matchResult.rows.length === 0) {
        console.error(`❌ [CONFIDENCE-1] No pending tournament_match found for round_match ${replay.tournament_round_match_id}`);
        return res.status(400).json({ error: 'No pending match found' });
      }

      const matchData = matchResult.rows[0];
      const matchPlayer1Id = matchData.player1_id;
      const matchPlayer2Id = matchData.player2_id;

      // Determine winner based on which team the user belongs to
      if (userTeamId === matchPlayer1Id) {
        winnerId = matchPlayer1Id;
        loserId = matchPlayer2Id;
        console.log(`✅ [CONFIDENCE-1] User's team is player1 (${matchPlayer1Id}). Setting winner=${winnerId}, loser=${loserId}`);
      } else if (userTeamId === matchPlayer2Id) {
        winnerId = matchPlayer2Id;
        loserId = matchPlayer1Id;
        console.log(`✅ [CONFIDENCE-1] User's team is player2 (${matchPlayer2Id}). Setting winner=${winnerId}, loser=${loserId}`);
      } else {
        console.error(`❌ [CONFIDENCE-1] User's team ${userTeamId} does not match either team in tournament_match (${matchPlayer1Id} vs ${matchPlayer2Id})`);
        return res.status(403).json({ error: 'Your team is not a participant in this match' });
      }

      if (winner_choice === 'I lost') {
        // Swap winner and loser
        [winnerId, loserId] = [loserId, winnerId];
        console.log(`✅ [CONFIDENCE-1] User selected "I lost", swapped winner/loser. Now winner=${winnerId}, loser=${loserId}`);
      }
    } else {
      // 1v1 tournament: player1_id and player2_id are user IDs
      console.log(`📥 [CONFIDENCE-1] 1v1 tournament - looking up opponent...`);
      
      const opponentPlayers = forumPlayers.filter((p: any) => p?.user_name?.toLowerCase() !== currentUserNickname);
      
      if (opponentPlayers.length === 0) {
        console.error(`❌ [CONFIDENCE-1] Could not identify opponent player from replay data`);
        return res.status(400).json({ error: 'Could not identify opponent player from replay data' });
      }

      const primaryOpponentNickname = opponentPlayers[0]?.user_name || '';
      
      console.log(`📥 [CONFIDENCE-1] Looking up opponent player: "${primaryOpponentNickname}"...`);
      const otherPlayerResult = await query(
        `SELECT id FROM users_extension WHERE LOWER(nickname) = LOWER(?)`,
        [primaryOpponentNickname]
      );

      let otherPlayerId: string;

      if (otherPlayerResult.rows.length === 0) {
        console.log(`⚠️  [CONFIDENCE-1] Player ${primaryOpponentNickname} not found in users_extension, creating with default elo=1400`);
        
        const newUserId = uuidv4();
        try {
          await query(
            `INSERT INTO users_extension (id, nickname, is_active, is_rated, elo_rating, matches_played)
             VALUES (?, ?, true, false, 1400, 0)`,
            [newUserId, primaryOpponentNickname]
          );
          otherPlayerId = newUserId;
          console.log(`✅ [CONFIDENCE-1] Created new player ${primaryOpponentNickname} with ID ${otherPlayerId}`);
        } catch (createErr) {
          console.error(`❌ [CONFIDENCE-1] Failed to create new player:`, createErr);
          throw createErr;
        }
      } else {
        otherPlayerId = otherPlayerResult.rows[0].id;
        console.log(`✅ [CONFIDENCE-1] Found existing opponent: "${primaryOpponentNickname}" -> ${otherPlayerId}`);
      }

      winnerId = userId;
      loserId = otherPlayerId;

      if (winner_choice === 'I lost') {
        [winnerId, loserId] = [loserId, winnerId];
        console.log(`✅ [CONFIDENCE-1] User selected "I lost", winner=${winnerId}, loser=${loserId}`);
      }
    }

    console.log(`✅ [CONFIDENCE-1] Winner/loser determined: winner=${winnerId}, loser=${loserId}`);

    // Determine winner information based on tournament mode
    let winnerUser: any = null;
    let loserUser: any = null;

    if (tournamentMode === 'team') {
      // For team tournaments: winnerId and loserId are team IDs
      // We need to get one user from the winning team to determine faction/side
      const teamInfo = Object.values(detectedTeams).find(
        (team: any) => team.team_id === winnerId
      ) as any;
      
      if (!teamInfo) {
        console.error(`❌ [CONFIDENCE-1] Could not find winning team info for team ${winnerId}`);
        return res.status(400).json({ error: 'Could not find winning team' });
      }

      // Get first team member's forum data
      const teamMemberName = teamInfo.members?.[0];
      const teamMemberForumData = forumPlayers.find(
        (p: any) => p.user_name?.toLowerCase() === teamMemberName?.toLowerCase()
      );

      console.log(`📥 [CONFIDENCE-1] Team tournament - winning team: ${teamInfo.team_name}, sample member: ${teamMemberName}, side: ${teamMemberForumData?.side_number}`);

      // Get the actual user record for ELO calculation - use the logged-in user
      const winnerUserResult = await query(
        `SELECT elo_rating, is_rated, matches_played, trend, level FROM users_extension WHERE id = ?`,
        [userId]
      );
      const loserTeamInfo = Object.values(detectedTeams).find(
        (team: any) => team.team_id === loserId
      ) as any;
      
      if (!loserTeamInfo) {
        console.error(`❌ [CONFIDENCE-1] Could not find losing team info for team ${loserId}`);
        return res.status(400).json({ error: 'Could not find losing team' });
      }

      const loserTeamMemberName = loserTeamInfo.members?.[0];
      const loserUserResult = await query(
        `SELECT id, elo_rating, is_rated, matches_played, trend, level FROM users_extension WHERE LOWER(nickname) = LOWER(?)`,
        [loserTeamMemberName]
      );

      if (winnerUserResult.rows.length === 0) {
        return res.status(404).json({ error: 'Winner player not found' });
      }
      if (loserUserResult.rows.length === 0) {
        return res.status(404).json({ error: 'Loser player not found' });
      }

      winnerUser = winnerUserResult.rows[0];
      loserUser = loserUserResult.rows[0];

    } else {
      // For 1v1 tournaments: winnerId and loserId are user IDs
      const winnerUserResult = await query(
        `SELECT elo_rating, is_rated, matches_played, trend, level FROM users_extension WHERE id = ?`,
        [winnerId]
      );
      const loserUserResult = await query(
        `SELECT elo_rating, is_rated, matches_played, trend, level FROM users_extension WHERE id = ?`,
        [loserId]
      );

      if (winnerUserResult.rows.length === 0 || loserUserResult.rows.length === 0) {
        return res.status(404).json({ error: 'One or more players not found' });
      }

      winnerUser = winnerUserResult.rows[0];
      loserUser = loserUserResult.rows[0];
    }

    // Determine winner side from forumPlayers
    // For team tournaments, find any member of the winning team
    let winnerSide: number | null = null;
    
    if (tournamentMode === 'team') {
      const teamInfo = Object.values(detectedTeams).find(
        (team: any) => team.team_id === winnerId
      ) as any;
      const teamMemberName = teamInfo?.members?.[0];
      const teamMemberForumData = forumPlayers.find(
        (p: any) => p.user_name?.toLowerCase() === teamMemberName?.toLowerCase()
      );
      winnerSide = teamMemberForumData?.side_number ?? null;
    } else {
      // For 1v1, find the winner's forum player data
      const winnerForumPlayer = forumPlayers.find(
        (p: any) => p.user_name?.toLowerCase() === currentUserNickname
      );
      winnerSide = winnerForumPlayer?.side_number ?? null;
    }

    const winner = winnerUser;
    const loser = loserUser;

    // Get map and factions from parse_summary (use resolved values - same as displayed in frontend)
    const map = parseSummary?.resolvedMap || parseSummary?.finalMap || 'Unknown Map';
    
    // Map factions based on winner's side
    const winnerFactionKey = winnerSide === 2 ? 'side2' : 'side1';
    const loserFactionKey = winnerSide === 2 ? 'side1' : 'side2';
    let winner_faction = parseSummary?.resolvedFactions?.[winnerFactionKey] || parseSummary?.finalFactions?.[winnerFactionKey] || 'Unknown';
    let loser_faction = parseSummary?.resolvedFactions?.[loserFactionKey] || parseSummary?.finalFactions?.[loserFactionKey] || 'Unknown';

    // Note: tournamentMode was already determined earlier (line 1588)
    // If we have a tournament_round_match_id and tournamentMode wasn't set from parseSummary,
    // verify it by querying the database
    if (replay.tournament_round_match_id && tournamentMode === 'individual') {
      const tournamentResult = await query(
        `SELECT t.tournament_mode FROM tournaments t 
         JOIN tournament_rounds tr ON tr.tournament_id = t.id 
         JOIN tournament_round_matches trm ON trm.round_id = tr.id
         WHERE trm.id = ?`,
        [replay.tournament_round_match_id]
      );
      if (tournamentResult.rows.length > 0) {
        const mode = tournamentResult.rows[0].tournament_mode;
        if (mode) {
          console.log(`📥 [CONFIDENCE-1] Tournament mode from DB: ${mode}`);
          // tournamentMode was set from parseSummary, this is just verification
        }
      }
    }

    // Validate and correct factions for team tournaments
    const factionsResult = await validateAndCorrectFactions(
      {
        tournamentRoundMatchId: replay.tournament_round_match_id,
        tournamentMatchId: replay.tournament_match_id,
        winnerName: winner.username || '',
        parseSummary,
        matchType: tournamentMode === 'team' ? 'tournament_unranked' : 'ranked'
      },
      winner_faction,
      loser_faction
    );
    winner_faction = factionsResult.winnerFaction;
    loser_faction = factionsResult.loserFaction;

    // Calculate FIDE ELO ratings
    const winnerNewRating = calculateNewRating(winner.elo_rating, loser.elo_rating, 'win', winner.matches_played);
    const loserNewRating = calculateNewRating(loser.elo_rating, winner.elo_rating, 'loss', loser.matches_played);
    const eloChange = winnerNewRating - winner.elo_rating;

    // Calculate levels before match
    const winnerLevelBefore = getUserLevel(winner.elo_rating);
    const loserLevelBefore = getUserLevel(loser.elo_rating);
    const winnerLevelAfter = getUserLevel(winnerNewRating);
    const loserLevelAfter = getUserLevel(loserNewRating);

    // Get replay URL (already properly formatted in replays table)
    const replayFilePath = replay.replay_url || '';

    // Generate match ID
    const matchId = uuidv4();

    // Validate and sanitize optional fields
    // Determine where comments and rating should go based on winner_choice
    let userComments: string | null = null;
    let userRating: number | null = null;
    if (comments) {
      userComments = String(comments).substring(0, 500);
    }
    if (rating) {
      userRating = parseInt(rating, 10);
    }

    // Assign comments and rating to the correct columns based on whether user won or lost
    const winnerComments = winner_choice === 'I won' ? userComments : null;
    const winnerRating = winner_choice === 'I won' ? userRating : null;
    const loserComments = winner_choice === 'I lost' ? userComments : null;
    const loserRating = winner_choice === 'I lost' ? userRating : null;

    // Determine if this is a tournament match or a normal ranked match
    const isTournamentMatch = replay.tournament_round_match_id !== null;
    
    // Only create in global matches table for:
    // 1. Normal ranked matches (not a tournament match)
    // 2. RANKED tournaments (tournament_round_match_id exists AND tournament_mode === 'ranked')
    const shouldUpdateGlobalElo = !isTournamentMatch || tournamentMode === 'ranked';
    
    if (shouldUpdateGlobalElo) {
      if (isTournamentMatch) {
        console.log(`🎯 [CONFIDENCE-1] Ranked tournament - updating global ELO updates`);
      } else {
        console.log(`🎯 [CONFIDENCE-1] Normal ranked match (not tournament) - updating global ELO`);
      }
      
      // Create match record with all necessary fields
      await query(
        `INSERT INTO matches (
          id,
          replay_id,
          winner_id,
          loser_id,
          map,
          winner_faction,
          loser_faction,
          winner_elo_before,
          loser_elo_before,
          winner_elo_after,
          loser_elo_after,
          winner_level_before,
          loser_level_before,
          winner_level_after,
          loser_level_after,
          winner_comments,
          winner_rating,
          elo_change,
          tournament_mode,
          status,
          replay_file_path,
          auto_reported,
          winner_side,
          game_id,
          wesnoth_version,
          instance_uuid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          matchId,
          replayId,
          winnerId,
          loserId,
          map,
          winner_faction,
          loser_faction,
          winner.elo_rating,
          loser.elo_rating,
          winnerNewRating,
          loserNewRating,
          winnerLevelBefore,
          loserLevelBefore,
          winnerLevelAfter,
          loserLevelAfter,
          winnerComments,
          winnerRating,
          eloChange,
          isTournamentMatch ? tournamentMode : 'ranked',
          'reported',
          replayFilePath,
          1,
          winnerSide,                  // winner_side (1 or 2)
          replay.game_id ?? null,      // game_id from forum
          replay.wesnoth_version ?? null,  // wesnoth_version
          replay.instance_uuid ?? null     // instance_uuid
        ]
      );

      console.log(`✅ [CONFIDENCE-1] Match created in global table: ${matchId}`);

      // Calculate new trends
      const winnerTrend = calculateTrend(winner.trend || '-', true);
      const loserTrend = calculateTrend(loser.trend || '-', false);

      // Update winner stats
      const newWinnerMatches = winner.matches_played + 1;
      let winnerIsNowRated = winner.is_rated;
      let finalWinnerRating = winnerNewRating;

      if (winner.is_rated && finalWinnerRating < 1400) {
        winnerIsNowRated = false;
      } else if (!winner.is_rated && newWinnerMatches >= 10 && finalWinnerRating >= 1400) {
        winnerIsNowRated = true;
      }

      await query(
        `UPDATE users_extension 
         SET elo_rating = ?, 
             is_rated = ?, 
             matches_played = ?,
             total_wins = total_wins + 1,
             trend = ?,
             level = ?,
             is_active = 1,
             last_match_date = NOW(),
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [finalWinnerRating, winnerIsNowRated, newWinnerMatches, winnerTrend, getUserLevel(finalWinnerRating), winnerId]
      );

      // Update loser stats
      const newLoserMatches = loser.matches_played + 1;
      let loserIsNowRated = loser.is_rated;
      let finalLoserRating = loserNewRating;

      if (loser.is_rated && finalLoserRating < 1400) {
        loserIsNowRated = false;
      } else if (!loser.is_rated && newLoserMatches >= 10 && finalLoserRating >= 1400) {
        loserIsNowRated = true;
      }

      await query(
        `UPDATE users_extension 
         SET elo_rating = ?, 
             is_rated = ?, 
             matches_played = ?,
             total_losses = total_losses + 1,
             trend = ?,
             level = ?,
             is_active = 1,
             last_match_date = NOW(),
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [finalLoserRating, loserIsNowRated, newLoserMatches, loserTrend, getUserLevel(finalLoserRating), loserId]
      );

      // Update faction/map statistics for this match (incremental update)
      try {
        if (map && winner_faction && loser_faction) {
          await updateFactionMapStatistics(map, winner_faction, loser_faction, winnerSide);
        }
      } catch (statsError) {
        console.error('Warning: Error updating faction/map statistics:', statsError);
      }
    } else {
      // UNRANKED tournament - don't update global ELO
      console.log(`🎯 [CONFIDENCE-1] Unranked tournament - skipping global ELO updates`);
      
      // Still need to mark the replay as having a match (but with null match_id for unranked)
    }

    // Mark the replay as having a match
    await query(
      `UPDATE replays SET match_id = ? WHERE id = ?`,
      [shouldUpdateGlobalElo ? matchId : null, replayId]
    );

    // STEP 1: If this replay is linked to a tournament_round_match, map winner ID properly
    console.log(`\n📊 [CONFIDENCE-1] ===== STEP 1: TOURNAMENT ID MAPPING =====`);
    let winnerIdForTournament = winnerId;  // Default: player ID for 1v1 tournaments
    let loserIdForTournament = loserId;    // Default: player ID for 1v1 tournaments
    
    if (replay.tournament_round_match_id) {
      console.log(`📥 [CONFIDENCE-1] Fetching tournament mode for round match ${replay.tournament_round_match_id}...`);
      const tmodeResult = await query(
        `SELECT t.tournament_mode, t.id as tournament_id 
         FROM tournaments t 
         JOIN tournament_rounds tr ON tr.tournament_id = t.id 
         JOIN tournament_round_matches trm ON trm.round_id = tr.id
         WHERE trm.id = ?`,
        [replay.tournament_round_match_id]
      );
      
      if (tmodeResult.rows.length > 0) {
        const { tournament_mode, tournament_id } = (tmodeResult as any).rows[0];
        console.log(`✅ [CONFIDENCE-1] Tournament found: mode=${tournament_mode}, id=${tournament_id}`);
        
        if (tournament_mode === 'team') {
          console.log(`📥 [CONFIDENCE-1] Team tournament detected - winner and loser are already team IDs`);
          // For team tournaments, winnerId and loserId are already team IDs (set earlier at lines 1628-1635)
          // No additional mapping needed
          winnerIdForTournament = winnerId;
          loserIdForTournament = loserId;
          console.log(`✅ [CONFIDENCE-1] Winner team: ${winnerIdForTournament}, Loser team: ${loserIdForTournament}`);
        } else {
          console.log(`✅ [CONFIDENCE-1] 1v1 tournament - no team mapping needed`);
        }
      } else {
        console.warn(`⚠️  [CONFIDENCE-1] Tournament round match ${replay.tournament_round_match_id} not found`);
      }
    } else {
      console.log(`ℹ️  [CONFIDENCE-1] No tournament_round_match - this is a direct match`);
    }
    
    // Update last_match_date for team members if this is a team tournament
    if (replay.tournament_round_match_id && winnerId !== loserId) {
      // Check if this is a team tournament
      const teamCheckResult = await query(
        `SELECT t.tournament_mode FROM tournaments t 
         JOIN tournament_rounds tr ON tr.tournament_id = t.id 
         JOIN tournament_round_matches trm ON trm.round_id = tr.id
         WHERE trm.id = ?`,
        [replay.tournament_round_match_id]
      );
      
      if (teamCheckResult.rows.length > 0 && (teamCheckResult as any).rows[0].tournament_mode === 'team') {
        console.log(`🎯 [CONFIDENCE-1] Team tournament - updating last_match_date for all 4 team members`);
        
        // Get tournament_id for querying participants
        const tourneyIdResult = await query(
          `SELECT tournament_id FROM tournament_round_matches WHERE id = ?`,
          [replay.tournament_round_match_id]
        );
        
        if (tourneyIdResult.rows.length > 0) {
          const tournamentId = (tourneyIdResult as any).rows[0].tournament_id;
          
          // Update winner team members
          try {
            await query(
              `UPDATE users_extension ue
               SET ue.last_match_date = NOW(), ue.updated_at = NOW()
               WHERE ue.id IN (
                 SELECT user_id FROM tournament_participants 
                 WHERE tournament_id = ? AND team_id = ?
               )`,
              [tournamentId, winnerIdForTournament]
            );
            console.log(`✅ [CONFIDENCE-1] Updated last_match_date for winner team members`);
          } catch (err) {
            console.error(`❌ [CONFIDENCE-1] Error updating winner team members:`, err);
          }
          
          // Update loser team members
          try {
            await query(
              `UPDATE users_extension ue
               SET ue.last_match_date = NOW(), ue.updated_at = NOW()
               WHERE ue.id IN (
                 SELECT user_id FROM tournament_participants 
                 WHERE tournament_id = ? AND team_id = ?
               )`,
              [tournamentId, loserIdForTournament]
            );
            console.log(`✅ [CONFIDENCE-1] Updated last_match_date for loser team members`);
          } catch (err) {
            console.error(`❌ [CONFIDENCE-1] Error updating loser team members:`, err);
          }
        }
      }
    }

    console.log(`${'='.repeat(80)}\n`);

    // STEP 2: Create/update tournament_matches entry (use mapped winnerIdForTournament)
    console.log(`📊 [CONFIDENCE-1] ===== STEP 2: TOURNAMENT MATCHES UPDATE =====`);
    let tournamentMatchId: string | null = null;  // Track the tournament_match ID for replay linking
    
    if (replay.tournament_round_match_id) {
      console.log(`📥 [CONFIDENCE-1] Processing tournament_matches for round match ${replay.tournament_round_match_id}`);
      
      // Get player names for faction extraction (use forum players data)
      const player1Name = forumPlayers[0]?.user_name || 'Unknown';
      const player2Name = forumPlayers.length > 1 ? forumPlayers[1]?.user_name : 'Unknown';
      
      // Extract map and faction data from replay (use pre-calculated replayFilePath)
      const { map, winnerFaction, loserFaction, replayFilePathForDb } = extractMatchDataFromReplay(
        parseSummary,
        replayFilePath,
        player1Name,
        player2Name
      );
      console.log(`✅ [CONFIDENCE-1] Extracted match data:`, { map, winnerFaction, loserFaction, replayFilePathForDb });
      
      // Get tournament_round_match details AND tournament type
      console.log(`📥 [CONFIDENCE-1] Fetching tournament_round_match details...`);
      const roundMatchResult = await query(
        `SELECT trm.tournament_id, trm.round_id, trm.player1_id, trm.player2_id, t.tournament_type
         FROM tournament_round_matches trm
         JOIN tournaments t ON trm.tournament_id = t.id
         WHERE trm.id = ?`,
        [replay.tournament_round_match_id]
      );
      
      if (roundMatchResult.rows.length > 0) {
        const roundMatch = (roundMatchResult as any).rows[0];
        const isLeagueTournament = roundMatch.tournament_type === 'league';
        console.log(`✅ [CONFIDENCE-1] Tournament round match found: type=${roundMatch.tournament_type}, player1=${roundMatch.player1_id}, player2=${roundMatch.player2_id}`);
        
        // For league tournaments: tournament_matches are PRE-GENERATED
        // For other types: tournament_matches are created on demand
        if (isLeagueTournament) {
          console.log(`🎯 [CONFIDENCE-1] League tournament - finding pending match for this series...`);
          
          // Search for pending tournament_matches linked to this round_match_id
          // (pre-generated matches already have tournament_round_match_id set)
          console.log(`📥 [CONFIDENCE-1] Querying tournament_matches with tournament_round_match_id=${replay.tournament_round_match_id} and match_status='pending'...`);
          const existingMatchResult = await query(
            `SELECT id FROM tournament_matches
             WHERE tournament_round_match_id = ?
               AND match_status = 'pending'
             LIMIT 1`,
            [replay.tournament_round_match_id]
          );
          
          console.log(`✅ [CONFIDENCE-1] Query returned ${existingMatchResult.rows.length} results`);
          
          if (existingMatchResult.rows.length > 0) {
            // UPDATE existing record (expected for league)
            const existingId = (existingMatchResult as any).rows[0].id;
            tournamentMatchId = existingId;  // Save for replay linking
            
            console.log(`📤 [CONFIDENCE-1] UPDATING tournament_match: ${existingId}`);
            console.log(`   Parameters:`);
            console.log(`   - match_id: ${tournamentMode === 'ranked' ? matchId : null}`);
            console.log(`   - winner_id: ${winnerIdForTournament}`);
            console.log(`   - map: ${map}`);
            console.log(`   - winner_faction: ${winnerFaction}`);
            console.log(`   - loser_faction: ${loserFaction}`);
            console.log(`   - replay_file_path: ${replayFilePathForDb}`);
            console.log(`   - winner_comments: ${winnerComments ? winnerComments.substring(0, 30) : 'null'}`);
            console.log(`   - winner_rating: ${winnerRating}`);
            console.log(`   - loser_comments: ${loserComments ? loserComments.substring(0, 30) : 'null'}`);
            console.log(`   - loser_rating: ${loserRating}`);
            
            try {
              await query(
                `UPDATE tournament_matches 
                 SET match_id = ?, winner_id = ?, match_status = 'completed', played_at = CURRENT_TIMESTAMP,
                     map = ?, winner_faction = ?, loser_faction = ?, replay_file_path = ?,
                     winner_comments = ?, winner_rating = ?, loser_comments = ?, loser_rating = ?
                 WHERE id = ?`,
                [tournamentMode === 'ranked' ? matchId : null, winnerIdForTournament, map, winnerFaction, loserFaction, replayFilePathForDb, winnerComments, winnerRating, loserComments, loserRating, existingId]
              );
              console.log(`✅ [CONFIDENCE-1] League tournament_matches updated successfully: ${existingId}`);
            } catch (err) {
              console.error(`❌ [CONFIDENCE-1] FAILED to update tournament_matches:`, err);
              throw err;
            }
          } else {
            console.error(`❌ [CONFIDENCE-1] League tournament but NO pending tournament_matches found for round_match ${replay.tournament_round_match_id}`);
          }
        } else {
          // Non-league tournament: check if record exists (shouldn't normally, but handle resumable matches)
          const existingMatchResult = await query(
            `SELECT id FROM tournament_matches WHERE tournament_round_match_id = ?`,
            [replay.tournament_round_match_id]
          );
          
          if (existingMatchResult.rows.length > 0) {
            // UPDATE existing record (resumable match)
            const existingId = (existingMatchResult as any).rows[0].id;
            tournamentMatchId = existingId;  // Save for replay linking
            await query(
              `UPDATE tournament_matches 
               SET match_id = ?, winner_id = ?, match_status = 'completed', played_at = CURRENT_TIMESTAMP,
                   map = ?, winner_faction = ?, loser_faction = ?, replay_file_path = ?,
                   winner_comments = ?, winner_rating = ?, loser_comments = ?, loser_rating = ?
               WHERE id = ?`,
              [tournamentMode === 'ranked' ? matchId : null, winnerIdForTournament, map, winnerFaction, loserFaction, replayFilePathForDb, winnerComments, winnerRating, loserComments, loserRating, existingId]
            );
            console.log(`✅ [CONFIDENCE-1] Non-league tournament_matches updated (resumable): ${existingId}`);
          } else {
            // INSERT new record (normal case for non-league)
            const newTournamentMatchId = uuidv4();
            tournamentMatchId = newTournamentMatchId;  // Save for replay linking
            await query(
              `INSERT INTO tournament_matches 
               (id, tournament_id, round_id, player1_id, player2_id, match_id, winner_id, match_status, played_at, tournament_round_match_id, map, winner_faction, loser_faction, replay_file_path, winner_comments, winner_rating, loser_comments, loser_rating)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                newTournamentMatchId,
                roundMatch.tournament_id,
                roundMatch.round_id,
                roundMatch.player1_id,
                roundMatch.player2_id,
                tournamentMode === 'ranked' ? matchId : null,
                winnerIdForTournament,
                replay.tournament_round_match_id,
                map,
                winnerFaction,
                loserFaction,
                replayFilePathForDb,
                winnerComments,
                winnerRating,
                loserComments,
                loserRating
              ]
            );
            console.log(`✅ [CONFIDENCE-1] Non-league tournament_matches created: ${newTournamentMatchId}`);
          }
        }
      }
    }

    // If this replay belongs to a tournament match (old flow), associate and close it
    if (tournament_match_id) {
      await query(
        `UPDATE tournament_matches
         SET match_id = ?,
             winner_id = ?,
             match_status = 'completed',
             played_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [matchId, winnerId, tournament_match_id]
      );
      console.log(`✅ [CONFIDENCE-1] Tournament match ${tournament_match_id} updated with match_id ${matchId}`);
    }

    // STEP 3: Handle post-confirmation (BO3 creation, round completion)
    console.log(`\n📊 [CONFIDENCE-1] ===== STEP 3: POST-CONFIRMATION HANDLING =====`);
    console.log(`📥 [CONFIDENCE-1] Calling handlePostConfirmation with:`, {
      roundMatchId: replay.tournament_round_match_id,
      winnerId: winnerIdForTournament,
      isMappedTeamId: winnerIdForTournament !== winnerId,
      tournamentMode: tournamentMode
    });
    
    if (replay.tournament_round_match_id) {
      try {
        await handlePostConfirmation(
          replay.tournament_round_match_id,
          winnerIdForTournament,
          parseSummary,
          tournamentMode === 'team' ? 'tournament_unranked' : tournamentMode
        );
        console.log(`✅ [CONFIDENCE-1] handlePostConfirmation completed`);
      } catch (postErr) {
        console.error(`❌ [CONFIDENCE-1] handlePostConfirmation failed:`, postErr);
        throw postErr;
      }
    }

    // Mark replay as reported with proper status
    console.log(`📤 [CONFIDENCE-1] Updating replay status to 'completed'...`);
    console.log(`   tournament_match_id: ${tournamentMatchId}`);
    await query(
      `UPDATE replays 
       SET parse_status = 'completed', 
           need_integration = 0,
           tournament_match_id = ?,
           updated_at = NOW() 
       WHERE id = ?`,
      [tournamentMatchId, replayId]
    );
    console.log(`✅ [CONFIDENCE-1] Replay marked as completed`);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ [CONFIDENCE-1] ===== REPLAY CONFIRMATION SUCCESSFUL =====`);
    console.log(`✅ Winner: ${winnerId} (mapped to ${winnerIdForTournament} for tournament)`);
    console.log(`✅ Loser: ${loserId}`);
    console.log(`✅ Tournament Mode: ${tournamentMode}`);
    console.log(`✅ ELO Change: ${tournamentMode === 'ranked' ? eloChange : 0} (unranked tournament - no ELO impact)`);
    console.log(`${'='.repeat(80)}\n`);
    
    res.status(201).json({ 
      success: true,
      matchId: tournamentMode === 'ranked' ? matchId : null,
      message: 'Replay reported successfully. Match created and ELO calculated.',
      winner_rating_change: tournamentMode === 'ranked' ? eloChange : 0
    });

  } catch (error) {
    console.error(`\n${'='.repeat(80)}`);
    console.error(`❌ [CONFIDENCE-1] ===== ERROR DURING REPLAY CONFIRMATION =====`);
    console.error(`❌ Error:`, error);
    if (error instanceof Error) {
      console.error(`❌ Message: ${error.message}`);
      console.error(`❌ Stack: ${error.stack}`);
    }
    console.error(`${'='.repeat(80)}\n`);
    res.status(500).json({ error: 'Failed to report replay', details: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/matches/cancel-confidence-1-replay
 *
 * Request or confirm cancellation of a confidence=1 replay (game saved mid-match).
 * Both players must call this endpoint to fully cancel the replay.
 *
 * Flow:
 *   - First player calls → cancel_requested_by = userId  (status: waiting_confirmation)
 *   - Second player calls → the replay row is DELETED     (status: cancelled)
 *
 * Requires: User authentication + must be a participant in the replay
 */
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
       FROM replays WHERE id = ? AND integration_confidence = 1 AND parsed = 1 AND parse_status != 'rejected'`,
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

    const player1Nickname = forumPlayers[0]?.user_name?.toLowerCase() || '';
    const player2Nickname = forumPlayers[1]?.user_name?.toLowerCase() || '';

    // Security: user must be one of the 2 players
    if (currentUserNickname !== player1Nickname && currentUserNickname !== player2Nickname) {
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
        r.cancel_requested_by
       FROM replays r
       WHERE r.integration_confidence = 1 
         AND r.parsed = 1
         AND r.parse_status != 'rejected'
         AND r.match_id IS NULL
         AND (r.tournament_round_match_id IS NULL AND (r.parse_summary IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(r.parse_summary, '$.linkedTournamentRoundMatchId')) IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(r.parse_summary, '$.linkedTournamentRoundMatchId')) = 'null'))
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    console.log(`📊 [MATCHES] Found ${result.rows.length} matches and ${replayResult.rows?.length || 0} confidence=1 replays`);

    // DEBUG: log raw replay rows before filtering
    if (process.env.BACKEND_DEBUG_LOGS === 'true') {
      const debugReplays = await query(
        `SELECT r.id, r.tournament_round_match_id, r.integration_confidence, r.parsed, r.match_id, r.parse_status,
                JSON_UNQUOTE(JSON_EXTRACT(r.parse_summary, '$.linkedTournamentRoundMatchId')) as json_linked
         FROM replays r
         WHERE r.integration_confidence = 1 AND r.parsed = 1 AND r.parse_status != 'rejected' AND r.match_id IS NULL
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

        formattedReplays.push({
          id: r.id,
          winner_id: null,  // Unknown until reported
          loser_id: null,   // Unknown until reported
          winner_nickname: winnerName,
          loser_nickname: loserName,
          winner_faction: victory.winner_faction || parseSummary.finalFactions?.side1 || 'Unknown',
          loser_faction: victory.loser_faction || parseSummary.finalFactions?.side2 || 'Unknown',
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
          source_type: 'replay_confidence_1',
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

// ============================================================================
// Pending Reporting Routes
// ============================================================================

/**
 * GET /api/matches/pending-reporting
 * 
 * Get all matches pending player confirmation (status = 'pending_report')
 * Filtered to show only matches where the current user participated
 * 
 * Requires: User authentication
 * Returns: Array of pending matches with participant and replay info
 */
router.get('/pending-reporting', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get pending matches where user participated
    const result = await query(
      `SELECT 
        m.id,
        m.replay_id,
        m.winner_id,
        m.loser_id,
        m.map_name,
        m.era_name,
        m.status,
        m.replay_file_path,
        m.created_at,
        m.updated_at,
        w.username as winner_name,
        w.rating as winner_rating,
        l.username as loser_name,
        l.rating as loser_rating,
        r.game_name,
        r.start_time,
        r.end_time,
        r.detection_confidence,
        r.detected_from
      FROM matches m
      INNER JOIN users_extension w ON m.winner_id = w.id
      INNER JOIN users_extension l ON m.loser_id = l.id
      LEFT JOIN replays r ON m.replay_id = r.id
      WHERE m.status = 'pending_report'
        AND (m.winner_id = ? OR m.loser_id = ?)
      ORDER BY m.created_at DESC`,
      [userId, userId]
    );

    const matches = (result as any).rows || [];

    res.json({
      success: true,
      count: matches.length,
      matches: matches.map((m: any) => ({
        id: m.id,
        replayId: m.replay_id,
        winners: {
          id: m.winner_id,
          name: m.winner_name,
          rating: m.winner_rating
        },
        loser: {
          id: m.loser_id,
          name: m.loser_name,
          rating: m.loser_rating
        },
        game: {
          name: m.game_name,
          map: m.map_name,
          era: m.era_name,
          startTime: m.start_time,
          endTime: m.end_time
        },
        detection: {
          confidence: m.detection_confidence,
          from: m.detected_from
        },
        replayUrl: m.replay_file_path,
        status: m.status,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
        isCurrentUserWinner: m.winner_id === userId,
        currentUserAction: m.winner_id === userId ? 'confirm_victory' : 'confirm_defeat'
      }))
    });

  } catch (error) {
    console.error('Error fetching pending reporting matches:', error);
    res.status(500).json({ error: 'Failed to fetch pending matches' });
  }
});

/**
 * POST /api/matches/:matchId/confirm-report
 * 
 * Player confirms the auto-reported match results
 * Changes status from 'pending_report' to 'confirmed'
 * Applies ELO ratings after confirmation
 * 
 * Requires: User authentication + must be a participant in the match
 */
router.post('/:matchId/confirm-report', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get match details
    const matchResult = await query(
      `SELECT id, winner_id, loser_id, status, replay_id 
       FROM matches WHERE id = ?`,
      [matchId]
    );

    if (!matchResult || !(matchResult as any).rows || (matchResult as any).rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = (matchResult as any).rows[0];

    // Verify user is a participant
    if (match.winner_id !== userId && match.loser_id !== userId) {
      return res.status(403).json({ error: 'You are not a participant in this match' });
    }

    // Verify match is in pending_report status
    if (match.status !== 'pending_report') {
      return res.status(400).json({ error: 'Match is not pending confirmation' });
    }

    // Update match status to confirmed
    await query(
      `UPDATE matches 
       SET status = 'confirmed', updated_at = NOW()
       WHERE id = ?`,
      [matchId]
    );

    // Apply ELO ratings
    const winnerId = match.winner_id;
    const loserId = match.loser_id;

    // Get current ratings
    const ratingsResult = await query(
      `SELECT id, rating FROM users_extension WHERE id IN (?, ?)`,
      [winnerId, loserId]
    );

    if (ratingsResult && (ratingsResult as any).rows) {
      const ratings = (ratingsResult as any).rows;
      const winnerRating = ratings.find((r: any) => r.id === winnerId)?.rating || 1200;
      const loserRating = ratings.find((r: any) => r.id === loserId)?.rating || 1200;

      // Calculate new ratings
      const K = 32;
      const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
      const expectedLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

      const newWinnerRating = Math.round(winnerRating + K * (1 - expectedWinner));
      const newLoserRating = Math.round(loserRating + K * (0 - expectedLoser));

      // Update ratings
      await query(
        `UPDATE users_extension SET rating = ?, total_games = total_games + 1, wins = wins + 1 WHERE id = ?`,
        [newWinnerRating, winnerId]
      );

      await query(
        `UPDATE users_extension SET rating = ?, total_games = total_games + 1, losses = losses + 1 WHERE id = ?`,
        [newLoserRating, loserId]
      );
    }

    res.json({
      success: true,
      message: 'Match confirmed. ELO ratings have been applied.',
      matchId,
      newStatus: 'confirmed'
    });

  } catch (error) {
    console.error('Error confirming match:', error);
    res.status(500).json({ error: 'Failed to confirm match' });
  }
});

/**
 * POST /api/matches/:matchId/reject-report
 * 
 * Player rejects the auto-reported match results
 * Changes status from 'pending_report' to 'rejected'
 * Match is not applied to ratings
 * 
 * Requires: User authentication + must be a participant in the match
 */
router.post('/:matchId/reject-report', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { matchId } = req.params;
    const userId = req.userId;
    const { reason } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get match details
    const matchResult = await query(
      `SELECT id, winner_id, loser_id, status FROM matches WHERE id = ?`,
      [matchId]
    );

    if (!matchResult || !(matchResult as any).rows || (matchResult as any).rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = (matchResult as any).rows[0];

    // Verify user is a participant
    if (match.winner_id !== userId && match.loser_id !== userId) {
      return res.status(403).json({ error: 'You are not a participant in this match' });
    }

    // Verify match is in pending_report status
    if (match.status !== 'pending_report') {
      return res.status(400).json({ error: 'Match is not pending confirmation' });
    }

    // Update match status to rejected
    await query(
      `UPDATE matches 
       SET status = 'rejected', updated_at = NOW()
       WHERE id = ?`,
      [matchId]
    );

    res.json({
      success: true,
      message: 'Match rejected. Ratings have not been applied.',
      matchId,
      newStatus: 'rejected',
      rejectionReason: reason || 'No reason provided'
    });

  } catch (error) {
    console.error('Error rejecting match:', error);
    res.status(500).json({ error: 'Failed to reject match' });
  }
});

// Routes are now properly ordered with specific paths first

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

