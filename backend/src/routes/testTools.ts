/**
 * Test-only tools for creating realistic tournament fixtures without replay files.
 * The route is mounted only by app.ts in NODE_ENV=test, and keeps a second guard
 * here so accidental reuse of the router cannot expose mutation endpoints.
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import { authMiddleware, moderatorOrAdminMiddleware, AuthRequest } from '../middleware/auth.js';
import { isTournamentOrganizer } from '../services/tournamentAuthorizationService.js';
import { createMatch } from '../services/matchCreationService.js';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';
import { recordPhaseGameResult } from '../tournament-engine/competitionProgression.js';

const router = Router();
const TEST_MODES = ['ranked', 'tournament_ranked', 'tournament_unranked', 'tournament_team'] as const;
type TestMatchMode = typeof TEST_MODES[number];

function requireTestEnvironment(res: any): boolean {
  if (process.env.NODE_ENV !== 'test') {
    res.status(404).json({ error: 'Test tools are not available in this environment' });
    return false;
  }
  return true;
}

function tournamentModeForMatch(mode: TestMatchMode): 'ranked' | 'unranked' | 'team' | null {
  if (mode === 'tournament_ranked') return 'ranked';
  if (mode === 'tournament_unranked') return 'unranked';
  if (mode === 'tournament_team') return 'team';
  return null;
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

async function getAssets(tournamentId: string | null, rankedOnly: boolean) {
  // Tournament-specific assets take precedence. Ranked assets are the safe
  // fallback for fixtures from tournaments whose allow-list is empty.
  if (tournamentId) {
    const [factions, maps] = await Promise.all([
      query(`SELECT f.id, f.name FROM factions f
             JOIN tournament_unranked_factions tuf ON tuf.faction_id = f.id
             WHERE tuf.tournament_id = ? AND f.is_active = 1 ORDER BY f.name`, [tournamentId]),
      query(`SELECT m.id, m.name FROM game_maps m
             JOIN tournament_unranked_maps tum ON tum.map_id = m.id
             WHERE tum.tournament_id = ? AND m.is_active = 1 ORDER BY m.name`, [tournamentId]),
    ]);
    if (factions.rows.length && maps.rows.length) return { factions: factions.rows, maps: maps.rows };
  }

  const [factions, maps] = await Promise.all([
    query(`SELECT id, name FROM factions WHERE is_active = 1 ${rankedOnly ? 'AND is_ranked = 1' : ''} ORDER BY name`),
    query(`SELECT id, name FROM game_maps WHERE is_active = 1 ${rankedOnly ? 'AND is_ranked = 1' : ''} ORDER BY name`),
  ]);
  return { factions: factions.rows, maps: maps.rows };
}

router.use(authMiddleware, moderatorOrAdminMiddleware, (req, res, next) => {
  if (requireTestEnvironment(res)) next();
});

router.get('/users', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const rankedOnly = req.query.ranked_only === 'true';
    if (search.length < 2) return res.json([]);
    const result = await query(
      `SELECT id, nickname, elo_rating, enable_ranked, is_active
       FROM users_extension
       WHERE nickname LIKE ? AND is_blocked = 0
         ${rankedOnly ? 'AND enable_ranked = 1' : ''}
       ORDER BY nickname LIMIT 20`,
      [`%${search}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Test tool user search failed:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/tournaments', async (req, res) => {
  try {
    const mode = String(req.query.mode || '') as TestMatchMode;
    const tournamentMode = tournamentModeForMatch(mode);
    const status = mode === 'ranked' ? null : 'in_progress';
    if (mode !== 'ranked' && !tournamentMode) return res.status(400).json({ error: 'Invalid match mode' });
    const result = await query(
      `SELECT id, name, tournament_mode, tournament_type, status
       FROM tournaments
       WHERE status = COALESCE(?, status)
         AND tournament_mode = COALESCE(?, tournament_mode)
         AND competition_model_version = 2
       ORDER BY name`,
      [status, tournamentMode]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Test tool tournament lookup failed:', error);
    res.status(500).json({ error: 'Failed to load tournaments' });
  }
});

router.get('/tournaments/:tournamentId/matches', async (req, res) => {
  try {
    const tournamentId = req.params.tournamentId;
    // A selectable item is one concrete phase-engine game. Only games in
    // active rounds are exposed, which prevents test operators from bypassing
    // manual phase or round start policies.
    const result = await query(
        `SELECT games.id, games.entry1_id AS player1_id, games.entry2_id AS player2_id,
                series.entry1_wins AS player1_wins, series.entry2_wins AS player2_wins,
                series.best_of, series.wins_required, rounds.round_number,
                phases.name AS phase_name, groups.name AS group_name,
                COALESCE(user1.nickname, team1.name) AS player1_name,
                COALESCE(user2.nickname, team2.name) AS player2_name,
                2 AS competition_model_version
         FROM tournament_games games
         JOIN tournament_series series ON series.id = games.series_id
         JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
         JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
         JOIN tournament_phases phases ON phases.id = groups.phase_id
         JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
         JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
         LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
         LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
         LEFT JOIN users_extension user1 ON user1.id = participant1.user_id
         LEFT JOIN users_extension user2 ON user2.id = participant2.user_id
         LEFT JOIN tournament_teams team1 ON team1.id = entry1.team_id
         LEFT JOIN tournament_teams team2 ON team2.id = entry2.team_id
         WHERE phases.tournament_id = ?
           AND phases.status = 'in_progress'
           AND rounds.status = 'in_progress'
           AND series.status IN ('ready', 'in_progress')
           AND games.status IN ('pending', 'in_progress')
           AND games.winner_entry_id IS NULL
         ORDER BY phases.phase_order, groups.group_order, rounds.round_number,
                  series.series_position, games.game_number`,
      [tournamentId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Test tool round match lookup failed:', error);
    res.status(500).json({ error: 'Failed to load open tournament matches' });
  }
});

router.get('/tournaments/:tournamentId/assets', async (req, res) => {
  try {
    res.json(await getAssets(req.params.tournamentId, false));
  } catch (error) {
    console.error('Test tool asset lookup failed:', error);
    res.status(500).json({ error: 'Failed to load tournament assets' });
  }
});

router.post('/simulate-match', async (req: AuthRequest, res) => {
  try {
    const {
      mode,
      tournament_id: tournamentId,
      competition_match_id: competitionMatchId,
      winner_id: winnerId,
      loser_id: requestedLoserId,
    } = req.body as {
      mode: TestMatchMode;
      tournament_id?: string;
      competition_match_id?: string;
      winner_id: string;
      loser_id?: string;
    };
    const selectedMatchId = competitionMatchId;
    if (!TEST_MODES.includes(mode) || typeof winnerId !== 'string' || (mode === 'ranked' && typeof requestedLoserId !== 'string')) {
      return res.status(400).json({ error: 'Invalid simulation payload' });
    }

    let tournament: any = null;
    let roundMatch: any = null;
    if (mode !== 'ranked') {
      const tournamentMode = tournamentModeForMatch(mode);
      if (typeof tournamentId !== 'string' || typeof selectedMatchId !== 'string') {
        return res.status(400).json({ error: 'Tournament and open match are required' });
      }
      const tournamentResult = await query(
        `SELECT id, name, tournament_mode, status, competition_model_version
         FROM tournaments
         WHERE id = ? AND status = 'in_progress' AND tournament_mode = ?
           AND competition_model_version = 2`,
        [tournamentId, tournamentMode]
      );
      tournament = tournamentResult.rows[0];
      if (!tournament) return res.status(400).json({ error: 'Tournament is not active or does not match the selected mode' });
      const matchResult = await query(
          `SELECT games.*, series.round_id,
                  participant1.user_id AS player1_user_id,
                  participant2.user_id AS player2_user_id
           FROM tournament_games games
           JOIN tournament_series series ON series.id = games.series_id
           JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
           JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
           JOIN tournament_phases phases ON phases.id = groups.phase_id
           JOIN tournament_entries entry1 ON entry1.id = games.entry1_id
           JOIN tournament_entries entry2 ON entry2.id = games.entry2_id
           LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
           LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
           WHERE games.id = ? AND phases.tournament_id = ?
             AND phases.status = 'in_progress' AND rounds.status = 'in_progress'
             AND series.status IN ('ready', 'in_progress')
             AND games.status IN ('pending', 'in_progress')
             AND games.winner_entry_id IS NULL`,
          [selectedMatchId, tournamentId]
        );
      roundMatch = matchResult.rows[0];
      const validWinnerIds = [roundMatch?.entry1_id, roundMatch?.entry2_id];
      if (!roundMatch || !validWinnerIds.includes(winnerId)) {
        return res.status(400).json({ error: 'Open tournament match or winner is invalid' });
      }
    }

    const assets = await getAssets(tournamentId || null, mode === 'ranked');
    if (!assets.factions.length || !assets.maps.length) return res.status(400).json({ error: 'No usable factions and maps are configured' });
    // Test fixtures may use inactive accounts, but blocked accounts must never
    // participate in generated matches or joins.
    const winnerFaction = randomItem(assets.factions).name;
    const loserFaction = randomItem(assets.factions).name;
    const map = randomItem(assets.maps).name;
    let loserId: string | undefined;
    if (mode === 'ranked') {
      const rankedUsers = await query(
        `SELECT id FROM users_extension
         WHERE id IN (?, ?) AND enable_ranked = 1 AND is_blocked = 0`,
        [winnerId, requestedLoserId]
      );
      if (rankedUsers.rows.length !== 2) return res.status(400).json({ error: 'Both ranked players must have ranked matches enabled and be unblocked' });
      loserId = requestedLoserId;
    } else {
      const winnerIsEntry1 = winnerId === roundMatch.entry1_id;
      loserId = winnerIsEntry1 ? roundMatch.entry2_id : roundMatch.entry1_id;
    }

    if (!loserId) return res.status(400).json({ error: 'The selected ranked winner has no valid opponent' });
    let matchId: string | undefined;
    if (mode === 'ranked' || mode === 'tournament_ranked') {
      const phaseWinnerUserId = mode === 'tournament_ranked'
        ? (winnerId === roundMatch.entry1_id ? roundMatch.player1_user_id : roundMatch.player2_user_id)
        : winnerId;
      const phaseLoserUserId = mode === 'tournament_ranked'
        ? (winnerId === roundMatch.entry1_id ? roundMatch.player2_user_id : roundMatch.player1_user_id)
        : loserId;
      if (!phaseWinnerUserId || !phaseLoserUserId) {
        return res.status(400).json({ error: 'Ranked phase entries are not linked to individual users' });
      }
      const created = await createMatch({
        winnerId: phaseWinnerUserId, loserId: phaseLoserUserId, winnerFaction, loserFaction, map, winnerSide: 1,
        replayRowId: null, replayFilePath: null,
        matchType: mode === 'ranked' ? 'ranked' : 'tournament_ranked',
        linkedTournamentId: tournamentId || null, linkedTournamentRoundMatchId: null,
        gameId: null, wesnothVersion: null, instanceUuid: null, autoReported: false,
      });
      if (!created.success) return res.status(500).json({ error: created.error || 'Failed to create simulated match' });
      matchId = created.matchId;
    }

    if (mode !== 'ranked') {
      // Persist the same fixture metadata produced by real replay parsing,
      // then let the phase engine atomically update series and progression.
      await query(
        `UPDATE tournament_games
         SET map = ?, winner_faction = ?, loser_faction = ?
         WHERE id = ? AND status IN ('pending', 'in_progress')`,
        [map, winnerFaction, loserFaction, selectedMatchId]
      );
      await recordPhaseGameResult(tournamentId!, selectedMatchId!, winnerId, matchId || null);
    }

    await logAuditEvent({
      event_type: 'ADMIN_ACTION', user_id: req.userId, ip_address: getUserIP(req), user_agent: getUserAgent(req),
      details: {
        action: 'simulate_match', simulated_match: true, mode,
        tournament_id: tournamentId || null,
        competition_match_id: selectedMatchId || null,
        competition_model_version: tournament?.competition_model_version || null,
        winner_id: winnerId, loser_id: loserId, match_id: matchId || null,
      },
    });
    res.status(201).json({ success: true, match_id: matchId || null, map, winner_faction: winnerFaction, loser_faction: loserFaction });
  } catch (error: any) {
    console.error('Simulate match failed:', error);
    res.status(500).json({ error: error?.message || 'Failed to simulate match' });
  }
});

router.post('/tournaments/:tournamentId/simulate-join', async (req: AuthRequest, res) => {
  try {
    const { tournamentId } = req.params;
    const { user_ids: userIds, team_name: teamName } = req.body as { user_ids: string[]; team_name?: string };
    if (!Array.isArray(userIds) || (userIds.length !== 1 && userIds.length !== 2) || new Set(userIds).size !== userIds.length) {
      return res.status(400).json({ error: 'Select one user for individual tournaments or two users for teams' });
    }
    if (!(await isTournamentOrganizer(tournamentId, req.userId!))) return res.status(403).json({ error: 'Only tournament organizers can simulate joins' });
    const tournamentResult = await query(
      `SELECT id, name, status, tournament_mode, max_participants
       FROM tournaments
       WHERE id = ? AND status = 'registration_open' AND competition_model_version = 2`,
      [tournamentId]
    );
    const tournament = tournamentResult.rows[0];
    if (!tournament) return res.status(400).json({ error: 'Tournament registration is not open' });
    if (tournament.tournament_mode === 'team' && (userIds.length !== 2 || typeof teamName !== 'string' || teamName.trim().length < 2)) {
      return res.status(400).json({ error: 'Team simulations require two users and a team name' });
    }
    if (tournament.tournament_mode !== 'team' && userIds.length !== 1) return res.status(400).json({ error: 'Individual tournaments accept one user per simulation' });
    const placeholders = userIds.map(() => '?').join(',');
    const users = await query(`SELECT id, nickname, enable_ranked FROM users_extension WHERE id IN (${placeholders}) AND is_blocked = 0`, userIds);
    if (users.rows.length !== userIds.length) return res.status(400).json({ error: 'One or more selected users are unavailable' });
    if (tournament.tournament_mode === 'ranked' && users.rows.some((u: any) => !u.enable_ranked)) return res.status(400).json({ error: 'All users must have ranked matches enabled' });
    const duplicate = await query(`SELECT user_id FROM tournament_participants WHERE tournament_id = ? AND user_id IN (${placeholders}) AND participation_status IN ('pending','unconfirmed','accepted')`, [tournamentId, ...userIds]);
    if (duplicate.rows.length) return res.status(400).json({ error: 'One or more users already participate in this tournament' });
    if (tournament.max_participants) {
      const count = await query(`SELECT COUNT(DISTINCT COALESCE(team_id, user_id)) count FROM tournament_participants WHERE tournament_id = ? AND participation_status IN ('pending','unconfirmed','accepted')`, [tournamentId]);
      if (Number(count.rows[0]?.count || 0) >= tournament.max_participants) return res.status(400).json({ error: 'Tournament capacity has been reached' });
    }
    let teamId: string | null = null;
    if (tournament.tournament_mode === 'team') {
      teamId = randomUUID();
      await query(`INSERT INTO tournament_teams (id, tournament_id, name, created_by) VALUES (?, ?, ?, ?)`, [teamId, tournamentId, teamName!.trim(), req.userId]);
    }
    for (let i = 0; i < userIds.length; i++) {
      await query(`INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status, team_id, team_position) VALUES (?, ?, ?, 'accepted', ?, ?)`, [randomUUID(), tournamentId, userIds[i], teamId, teamId ? i + 1 : null]);
    }
    await logAuditEvent({ event_type: 'ADMIN_ACTION', user_id: req.userId, ip_address: getUserIP(req), user_agent: getUserAgent(req), details: { action: 'simulate_join', simulated_join: true, tournament_id: tournamentId, user_ids: userIds, team_id: teamId } });
    res.status(201).json({ success: true, team_id: teamId, users: users.rows });
  } catch (error: any) {
    console.error('Simulate join failed:', error);
    res.status(500).json({ error: error?.message || 'Failed to simulate join' });
  }
});

export default router;
