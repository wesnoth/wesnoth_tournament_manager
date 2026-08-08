/**
 * Routes: Replay Management
 * File: backend/src/routes/replays.ts
 *
 * Handles:
 * - Listing replays pending player confirmation (confidence=1)
 * - Player confirmation of match result → creates match via matchCreationService
 * - Player discard of replays
 */

import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { createMatch } from '../services/matchCreationService.js';
import { validateAndCorrectFactions } from '../services/replayConfirmationService.js';
import { recordPhaseGameResult } from '../tournament-engine/competitionProgression.js';
import { globalRecalculationMiddleware } from '../services/systemPauseService.js';

const router = express.Router();

/**
 * GET /api/replays/pending-confirmation
 *
 * Returns all replays with parse_status='parsed', integration_confidence=1
 * where the authenticated player appears in parse_summary.forumPlayers.
 */
router.get('/pending-confirmation', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;

    // Get the forum username for this user so we can match against parse_summary
    const userResult = await query(
      `SELECT nickname FROM users_extension WHERE id = ?`,
      [userId]
    );
    const userRows = (userResult as any).rows || [];
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const nickname = userRows[0].nickname;

    // Find replays awaiting this player's confirmation
    const result = await query(
      `SELECT id, game_name, replay_filename, wesnoth_version,
              parse_summary, integration_confidence, tournament_game_id,
              end_time
       FROM replays
       WHERE parse_status = 'parsed'
         AND integration_confidence = 1
         AND JSON_SEARCH(LOWER(parse_summary), 'one', LOWER(?), NULL, '$.forumPlayers[*].user_name') IS NOT NULL
       ORDER BY end_time DESC
       LIMIT 50`,
      [nickname]
    );

    const rows = (result as any).rows || [];
    res.json({
      status: 'success',
      count: rows.length,
      replays: rows.map((row: any) => ({
        replay_id: row.id,
        game_name: row.game_name,
        filename: row.replay_filename,
        version: row.wesnoth_version,
        summary: typeof row.parse_summary === 'string' ? JSON.parse(row.parse_summary) : row.parse_summary,
        confidence: row.integration_confidence,
        tournament_game_id: row.tournament_game_id,
        end_time: row.end_time,
      })),
    });
  } catch (error) {
    console.error('Error fetching pending confirmations:', error);
    res.status(500).json({ error: 'Failed to fetch pending confirmations' });
  }
});

/**
 * POST /api/replays/:replayId/confirm-winner
 *
 * Authenticated player confirms match result.
 * Body: { iWon: boolean }
 *
 * Flow:
 *  1. Validate replay is parse_status='parsed' + confidence=1
 *  2. Identify confirming player via JWT → users_extension.nickname → forumPlayers
 *  3. Derive winner/loser from iWon
 *  4. Create match via matchCreationService (handles ELO + tournament round match update)
 *  5. Mark replay as parse_status='completed'
 */
router.post('/:replayId/confirm-winner', authMiddleware, globalRecalculationMiddleware, async (req: AuthRequest, res) => {
  try {
    const replayId = req.params.replayId;
    const { iWon } = req.body;
    const userId = req.userId;

    if (typeof iWon !== 'boolean') {
      return res.status(400).json({ error: 'Missing required field: iWon (boolean)' });
    }

    // Fetch the replay
    const replayResult = await query(
      `SELECT id, parse_status, integration_confidence, parse_summary,
              tournament_game_id, replay_filename, replay_url,
              game_id, wesnoth_version, instance_uuid, end_time
       FROM replays
       WHERE id = ?`,
      [replayId]
    );
    const replayRows = (replayResult as any).rows || [];
    if (replayRows.length === 0) {
      return res.status(404).json({ error: 'Replay not found' });
    }

    const replay = replayRows[0];

    if (replay.parse_status !== 'parsed' || replay.integration_confidence !== 1) {
      return res.status(400).json({
        error: 'Replay is not awaiting confirmation (wrong parse_status or confidence)',
      });
    }

    // Parse the summary JSON
    const summary = typeof replay.parse_summary === 'string'
      ? JSON.parse(replay.parse_summary)
      : replay.parse_summary;

    if (!summary?.forumPlayers || summary.forumPlayers.length < 2) {
      return res.status(400).json({ error: 'Replay parse_summary missing player data' });
    }

    // Identify the authenticating player from their DB nickname
    const userResult = await query(
      `SELECT id, nickname FROM users_extension WHERE id = ?`,
      [userId]
    );
    const userRows = (userResult as any).rows || [];
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const nickname: string = userRows[0].nickname;

    // Match against forumPlayers (case-insensitive)
    const myForumPlayer = summary.forumPlayers.find(
      (p: any) => p.user_name?.toLowerCase() === nickname.toLowerCase()
    );
    if (!myForumPlayer) {
      return res.status(403).json({ error: 'You did not participate in this replay' });
    }

    // Determine winner/loser names
    const otherForumPlayer = summary.forumPlayers.find(
      (p: any) => p.user_name?.toLowerCase() !== nickname.toLowerCase()
    );
    if (!otherForumPlayer) {
      return res.status(400).json({ error: 'Could not determine opponent from replay data' });
    }

    const winnerName: string = iWon ? nickname : otherForumPlayer.user_name;
    const loserName:  string = iWon ? otherForumPlayer.user_name : nickname;

    const winnerForumData = summary.forumPlayers.find(
      (p: any) => p.user_name?.toLowerCase() === winnerName.toLowerCase()
    );
    const loserForumData = summary.forumPlayers.find(
      (p: any) => p.user_name?.toLowerCase() === loserName.toLowerCase()
    );

    // Resolve users_extension IDs
    const [winnerDbResult, loserDbResult] = await Promise.all([
      query(`SELECT id FROM users_extension WHERE LOWER(nickname) = LOWER(?)`, [winnerName]),
      query(`SELECT id FROM users_extension WHERE LOWER(nickname) = LOWER(?)`, [loserName]),
    ]);
    const winnerDbRow = ((winnerDbResult as any).rows || [])[0];
    const loserDbRow  = ((loserDbResult  as any).rows || [])[0];

    if (!winnerDbRow || !loserDbRow) {
      return res.status(400).json({
        error: `Could not find users_extension entry: winner=${winnerName} (found=${!!winnerDbRow}), loser=${loserName} (found=${!!loserDbRow})`,
      });
    }

    // Build replay file URL
    const gameDate = new Date(replay.end_time);
    const yyyy = gameDate.getFullYear();
    const mm = String(gameDate.getMonth() + 1).padStart(2, '0');
    const dd = String(gameDate.getDate()).padStart(2, '0');
    const cleanFilename = (replay.replay_filename || '').replace(/\.bz2$/, '');
    const replayFilePath = `https://replays.wesnoth.org/${replay.wesnoth_version}/${yyyy}/${mm}/${dd}/${cleanFilename}.bz2`;

    // Determine factions and map from summary
    let resolvedFactions: Record<string, string> = summary.resolvedFactions || {};
    let winnerFaction = resolvedFactions[`side${winnerForumData?.side_number}`] || 'Unknown';
    let loserFaction  = resolvedFactions[`side${loserForumData?.side_number}`]  || 'Unknown';
    const map = summary.resolvedMap || 'Unknown';

    // Validate and correct factions for team tournaments
    const factionsResult = await validateAndCorrectFactions(
      {
        tournamentGameId: summary.linkedTournamentGameId,
        winnerName,
        parseSummary: summary,
        matchType: summary.matchType || 'ranked'
      },
      winnerFaction,
      loserFaction
    );
    winnerFaction = factionsResult.winnerFaction;
    loserFaction = factionsResult.loserFaction;

    const result = summary.matchType === 'tournament_unranked'
      ? { success: true, matchId: undefined }
      : await createMatch({
          winnerId:                     winnerDbRow.id,
          loserId:                      loserDbRow.id,
          winnerFaction,
          loserFaction,
          map,
          winnerSide:                   winnerForumData?.side_number ?? 1,
          replayRowId:                  replay.id,
          replayFilePath,
          matchType:                    summary.matchType || 'ranked',
          linkedTournamentId:           summary.linkedTournamentId || null,
          linkedTournamentGameId:       summary.linkedTournamentGameId || null,
          gameId:                       replay.game_id,
          wesnothVersion:               replay.wesnoth_version,
          instanceUuid:                 replay.instance_uuid,
        });

    if (!result.success) {
      console.error('[CONFIRM-WINNER] Match creation failed:', result.error);
      return res.status(500).json({ error: `Failed to create match: ${result.error}` });
    }

    if (summary.linkedTournamentId && summary.linkedTournamentGameId) {
      const gameResult = await query(
        `SELECT games.entry1_id, games.entry2_id,
                entry1.participant_id AS entry1_participant_id,
                entry2.participant_id AS entry2_participant_id,
                entry1.team_id AS entry1_team_id,
                entry2.team_id AS entry2_team_id
         FROM tournament_games games
         JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
         JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
         WHERE games.id = ? AND games.status = 'pending'`,
        [summary.linkedTournamentGameId]
      );
      const game = gameResult.rows?.[0];
      if (!game) return res.status(409).json({ error: 'Tournament game is no longer pending' });

      const winnerParticipant = await query(
        `SELECT id, team_id
         FROM tournament_participants
         WHERE tournament_id = ? AND user_id = ?
           AND (id IN (?, ?) OR team_id IN (?, ?))
         LIMIT 1`,
        [summary.linkedTournamentId, winnerDbRow.id,
          game.entry1_participant_id, game.entry2_participant_id,
          game.entry1_team_id, game.entry2_team_id]
      );
      const winnerParticipantRow = winnerParticipant.rows?.[0];
      const winnerEntryId = winnerParticipantRow?.id === game.entry1_participant_id
        || winnerParticipantRow?.team_id === game.entry1_team_id
        ? game.entry1_id
        : winnerParticipantRow?.id === game.entry2_participant_id
          || winnerParticipantRow?.team_id === game.entry2_team_id
          ? game.entry2_id
          : null;
      if (!winnerEntryId) return res.status(400).json({ error: 'Could not map winner to tournament entry' });
      await recordPhaseGameResult(summary.linkedTournamentId, summary.linkedTournamentGameId, winnerEntryId, result.matchId);
    }

    // Keep the replay lifecycle consistent with automatic integration. The
    // parse status records that processing finished, while match_id is the
    // association used by pending-replay lists to hide a replay that already
    // produced a global match. Tournament-unranked games intentionally have
    // no global match row, so their match_id remains NULL.
    await query(
      `UPDATE replays
       SET parse_status = 'completed', parsed = 1, need_integration = 0,
           match_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [result.matchId || null, replayId]
    );

    console.log(`✅ [CONFIRM-WINNER] Match ${result.matchId} created by player ${nickname}`);

    res.json({
      status: 'success',
      message: 'Match confirmed and created',
      replay_id: replayId,
      match_id: result.matchId,
      confirmed_as_winner: iWon,
    });
  } catch (error) {
    console.error('Error confirming winner:', error);
    res.status(500).json({ error: 'Failed to confirm winner' });
  }
});

/**
 * POST /api/replays/:replayId/discard
 *
 * Player discards a pending-confirmation replay (e.g. paused match, will replay later).
 * Sets parse_status='rejected'.
 */
router.post('/:replayId/discard', authMiddleware, globalRecalculationMiddleware, async (req: AuthRequest, res) => {
  try {
    const replayId = req.params.replayId;
    const userId = req.userId;

    const replayResult = await query(
      `SELECT id, parse_status, parse_summary FROM replays WHERE id = ?`,
      [replayId]
    );
    const replayRows = (replayResult as any).rows || [];
    if (replayRows.length === 0) {
      return res.status(404).json({ error: 'Replay not found' });
    }
    const replay = replayRows[0];

    if (replay.parse_status !== 'parsed') {
      return res.status(400).json({ error: 'Replay is not awaiting confirmation' });
    }

    // Verify the requesting user is a participant
    const userResult = await query(
      `SELECT nickname FROM users_extension WHERE id = ?`,
      [userId]
    );
    const userNickname = ((userResult as any).rows || [])[0]?.nickname;
    const summary = typeof replay.parse_summary === 'string'
      ? JSON.parse(replay.parse_summary)
      : replay.parse_summary;

    const isParticipant = summary?.forumPlayers?.some(
      (p: any) => p.user_name?.toLowerCase() === userNickname?.toLowerCase()
    );
    if (!isParticipant) {
      return res.status(403).json({ error: 'You did not participate in this replay' });
    }

    await query(
      `UPDATE replays SET parse_status = 'rejected', updated_at = NOW() WHERE id = ?`,
      [replayId]
    );

    res.json({ status: 'success', message: 'Replay discarded', replay_id: replayId });
  } catch (error) {
    console.error('Error discarding replay:', error);
    res.status(500).json({ error: 'Failed to discard replay' });
  }
});

export default router;
