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
import { handlePostConfirmation } from '../services/replayConfirmationService.js';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';

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
      `SELECT id, nickname, elo_rating, enable_ranked
       FROM users_extension
       WHERE nickname LIKE ? AND is_active = 1 AND is_blocked = 0
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
    const result = await query(
      `SELECT trm.id, trm.round_id, trm.player1_id, trm.player2_id,
              trm.player1_wins, trm.player2_wins, trm.best_of, trm.wins_required,
              tr.round_number,
              CASE WHEN t.tournament_mode = 'team' THEN CONCAT(t1.name, ' (', COALESCE(t1m.members, ''), ')') ELSE u1.nickname END AS player1_name,
              CASE WHEN t.tournament_mode = 'team' THEN CONCAT(t2.name, ' (', COALESCE(t2m.members, ''), ')') ELSE u2.nickname END AS player2_name
       FROM tournament_round_matches trm
       JOIN tournament_rounds tr ON tr.id = trm.round_id
       JOIN tournaments t ON t.id = trm.tournament_id
       LEFT JOIN users_extension u1 ON t.tournament_mode <> 'team' AND u1.id = trm.player1_id
       LEFT JOIN users_extension u2 ON t.tournament_mode <> 'team' AND u2.id = trm.player2_id
       LEFT JOIN tournament_teams t1 ON t1.id = trm.player1_id
       LEFT JOIN tournament_teams t2 ON t2.id = trm.player2_id
       LEFT JOIN (SELECT team_id, GROUP_CONCAT(u.nickname ORDER BY tp.team_position SEPARATOR ', ') members
                  FROM tournament_participants tp JOIN users_extension u ON u.id = tp.user_id
                  GROUP BY team_id) t1m ON t1m.team_id = t1.id
       LEFT JOIN (SELECT team_id, GROUP_CONCAT(u.nickname ORDER BY tp.team_position SEPARATOR ', ') members
                  FROM tournament_participants tp JOIN users_extension u ON u.id = tp.user_id
                  GROUP BY team_id) t2m ON t2m.team_id = t2.id
       WHERE trm.tournament_id = ? AND trm.series_status IN ('pending', 'in_progress')
         AND trm.winner_id IS NULL
       ORDER BY tr.round_number, trm.created_at`,
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
    const { mode, tournament_id: tournamentId, round_match_id: roundMatchId, winner_id: winnerId, loser_id: requestedLoserId } = req.body as {
      mode: TestMatchMode; tournament_id?: string; round_match_id?: string; winner_id: string; loser_id?: string;
    };
    if (!TEST_MODES.includes(mode) || typeof winnerId !== 'string' || (mode === 'ranked' && typeof requestedLoserId !== 'string')) {
      return res.status(400).json({ error: 'Invalid simulation payload' });
    }

    let tournament: any = null;
    let roundMatch: any = null;
    if (mode !== 'ranked') {
      const tournamentMode = tournamentModeForMatch(mode);
      if (typeof tournamentId !== 'string' || typeof roundMatchId !== 'string') {
        return res.status(400).json({ error: 'Tournament and open match are required' });
      }
      const tournamentResult = await query(
        `SELECT id, name, tournament_mode, status FROM tournaments WHERE id = ? AND status = 'in_progress' AND tournament_mode = ?`,
        [tournamentId, tournamentMode]
      );
      tournament = tournamentResult.rows[0];
      if (!tournament) return res.status(400).json({ error: 'Tournament is not active or does not match the selected mode' });
      const matchResult = await query(
        `SELECT * FROM tournament_round_matches
         WHERE id = ? AND tournament_id = ? AND series_status IN ('pending', 'in_progress') AND winner_id IS NULL`,
        [roundMatchId, tournamentId]
      );
      roundMatch = matchResult.rows[0];
      if (!roundMatch || ![roundMatch.player1_id, roundMatch.player2_id].includes(winnerId)) {
        return res.status(400).json({ error: 'Open tournament match or winner is invalid' });
      }
    }

    const assets = await getAssets(tournamentId || null, mode === 'ranked');
    if (!assets.factions.length || !assets.maps.length) return res.status(400).json({ error: 'No usable factions and maps are configured' });
    const winnerFaction = randomItem(assets.factions).name;
    const loserFaction = randomItem(assets.factions).name;
    const map = randomItem(assets.maps).name;
    const loserId = mode === 'ranked'
      ? (await query('SELECT id FROM users_extension WHERE id = ? AND id <> ? AND enable_ranked = 1 AND is_active = 1', [requestedLoserId, winnerId])).rows[0]?.id
      : (winnerId === roundMatch.player1_id ? roundMatch.player2_id : roundMatch.player1_id);

    if (!loserId) return res.status(400).json({ error: 'The selected ranked winner has no valid opponent' });
    let matchId: string | undefined;
    if (mode === 'ranked' || mode === 'tournament_ranked') {
      const created = await createMatch({
        winnerId, loserId, winnerFaction, loserFaction, map, winnerSide: 1,
        replayRowId: null, replayFilePath: null,
        matchType: mode === 'ranked' ? 'ranked' : 'tournament_ranked',
        linkedTournamentId: tournamentId || null, linkedTournamentRoundMatchId: null,
        gameId: null, wesnothVersion: null, instanceUuid: null, autoReported: false,
      });
      if (!created.success) return res.status(500).json({ error: created.error || 'Failed to create simulated match' });
      matchId = created.matchId;
    }

    if (mode !== 'ranked') {
      const existing = await query(
        `SELECT id FROM tournament_matches WHERE tournament_round_match_id = ? AND match_status IN ('pending', 'in_progress') ORDER BY created_at LIMIT 1`,
        [roundMatchId]
      );
      const tournamentMatchId = existing.rows[0]?.id || randomUUID();
      if (existing.rows[0]) {
        await query(
          `UPDATE tournament_matches SET match_id = ?, winner_id = ?, loser_id = ?, match_status = 'completed', status = 'confirmed',
             played_at = NOW(), map = ?, winner_faction = ?, loser_faction = ?, replay_file_path = NULL WHERE id = ?`,
          [matchId || null, winnerId, loserId, map, winnerFaction, loserFaction, tournamentMatchId]
        );
      } else {
        await query(
          `INSERT INTO tournament_matches
           (id, tournament_id, round_id, player1_id, player2_id, match_id, winner_id, loser_id, match_status, status, played_at, tournament_round_match_id, map, winner_faction, loser_faction, replay_file_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'confirmed', NOW(), ?, ?, ?, ?, NULL)`,
          [tournamentMatchId, tournamentId, roundMatch.round_id, roundMatch.player1_id, roundMatch.player2_id, matchId || null, winnerId, loserId, roundMatchId, map, winnerFaction, loserFaction]
        );
      }
      await handlePostConfirmation(roundMatchId!, winnerId, {}, mode === 'tournament_team' ? 'tournament_unranked' : mode);
    }

    await logAuditEvent({
      event_type: 'ADMIN_ACTION', user_id: req.userId, ip_address: getUserIP(req), user_agent: getUserAgent(req),
      details: { action: 'simulate_match', simulated_match: true, mode, tournament_id: tournamentId || null, round_match_id: roundMatchId || null, winner_id: winnerId, loser_id: loserId, match_id: matchId || null },
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
    const tournamentResult = await query(`SELECT id, name, status, tournament_mode, max_participants FROM tournaments WHERE id = ? AND status = 'registration_open'`, [tournamentId]);
    const tournament = tournamentResult.rows[0];
    if (!tournament) return res.status(400).json({ error: 'Tournament registration is not open' });
    if (tournament.tournament_mode === 'team' && (userIds.length !== 2 || typeof teamName !== 'string' || teamName.trim().length < 2)) {
      return res.status(400).json({ error: 'Team simulations require two users and a team name' });
    }
    if (tournament.tournament_mode !== 'team' && userIds.length !== 1) return res.status(400).json({ error: 'Individual tournaments accept one user per simulation' });
    const placeholders = userIds.map(() => '?').join(',');
    const users = await query(`SELECT id, nickname, enable_ranked FROM users_extension WHERE id IN (${placeholders}) AND is_active = 1 AND is_blocked = 0`, userIds);
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
