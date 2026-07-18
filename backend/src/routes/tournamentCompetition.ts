import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { isTournamentOrganizer } from '../services/tournamentAuthorizationService.js';
import { validateTournamentFormat } from '../tournament-engine/formatValidator.js';
import { getTournamentFormat, saveTournamentFormat } from '../tournament-engine/formatService.js';
import type { TournamentFormatDefinition } from '../tournament-engine/types.js';
import { query } from '../config/database.js';
import { recordPhaseGameResult } from '../tournament-engine/competitionProgression.js';
import { compileNextPhaseCompetition, startReadyPhase } from '../tournament-engine/competitionCompiler.js';
import { forumTopicUrl, tournamentGameName } from '../tournament-engine/forumTopic.js';

const router = Router();

router.post('/:id/phases/:phaseId/advance', authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!(await isTournamentOrganizer(req.params.id, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can compile advancement' });
    }
    const compiled = await compileNextPhaseCompetition(req.params.id, req.params.phaseId);
    return res.json({ compiled });
  } catch (error: any) {
    console.error('Compile tournament advancement error:', error);
    return res.status(409).json({ error: error.message || 'Failed to compile advancement' });
  }
});

router.get('/:id/game-identity', async (req, res) => {
  const result = await query(`SELECT name, forum_topic_id FROM tournaments WHERE id = ?`, [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Tournament not found' });
  const tournament = result.rows[0];
  return res.json({
    forum_topic_id: tournament.forum_topic_id,
    forum_topic_url: forumTopicUrl(tournament.forum_topic_id),
    wesnoth_game_name: tournamentGameName(tournament.forum_topic_id, tournament.name),
  });
});

router.post('/:id/phases/:phaseId/start', authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!(await isTournamentOrganizer(req.params.id, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can start a phase' });
    }
    return res.json(await startReadyPhase(req.params.id, req.params.phaseId));
  } catch (error: any) {
    if (error.message?.includes('not found')) return res.status(404).json({ error: error.message });
    if (error.message?.includes('ready') || error.message?.includes('Earlier')) return res.status(409).json({ error: error.message });
    console.error('Start tournament phase error:', error);
    return res.status(500).json({ error: 'Failed to start tournament phase' });
  }
});

router.post('/:id/games/:gameId/result', authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!(await isTournamentOrganizer(req.params.id, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can record a phase game result' });
    }
    if (typeof req.body.winner_entry_id !== 'string') {
      return res.status(400).json({ error: 'winner_entry_id is required' });
    }
    return res.json(await recordPhaseGameResult(
      req.params.id,
      req.params.gameId,
      req.body.winner_entry_id,
      typeof req.body.match_id === 'string' ? req.body.match_id : null
    ));
  } catch (error: any) {
    if (error.message?.includes('not found')) return res.status(404).json({ error: error.message });
    if (error.message?.includes('already') || error.message?.includes('not part')) return res.status(409).json({ error: error.message });
    console.error('Record phase game result error:', error);
    return res.status(500).json({ error: 'Failed to record phase game result' });
  }
});

router.post('/:id/format/validate', authMiddleware, async (req: AuthRequest, res) => {
  if (!(await isTournamentOrganizer(req.params.id, req.userId!))) {
    return res.status(403).json({ error: 'Only tournament organizers can validate the format' });
  }
  return res.json(validateTournamentFormat(req.body as TournamentFormatDefinition));
});

router.put('/:id/format', authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!(await isTournamentOrganizer(req.params.id, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can update the format' });
    }
    await saveTournamentFormat(req.params.id, req.body as TournamentFormatDefinition);
    return res.json({ message: 'Tournament format saved', format: await getTournamentFormat(req.params.id) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ error: error.message, issues: error.issues });
    if (error.message === 'Tournament not found') return res.status(404).json({ error: error.message });
    if (error.message?.includes('before preparation')) return res.status(409).json({ error: error.message });
    console.error('Save tournament competition format error:', error);
    return res.status(500).json({ error: 'Failed to save tournament format' });
  }
});

router.get('/:id/format', async (req, res) => {
  try {
    const tournament = await query('SELECT id FROM tournaments WHERE id = ?', [req.params.id]);
    if (tournament.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    return res.json(await getTournamentFormat(req.params.id));
  } catch (error) {
    console.error('Get tournament competition format error:', error);
    return res.status(500).json({ error: 'Failed to fetch tournament format' });
  }
});

router.get('/:id/competition', async (req, res) => {
  try {
    const result = await query(
      `SELECT p.id AS phase_id, p.phase_order, p.name AS phase_name, p.format, p.status AS phase_status,
              g.id AS group_id, g.group_order, g.name AS group_name, g.status AS group_status,
              COUNT(DISTINCT pe.entry_id) AS entry_count,
              COUNT(DISTINCT r.id) AS round_count,
              COUNT(DISTINCT s.id) AS series_count
       FROM tournament_phases p
       LEFT JOIN tournament_phase_groups g ON g.phase_id = p.id
       LEFT JOIN tournament_phase_entries pe ON pe.group_id = g.id
       LEFT JOIN tournament_phase_rounds r ON r.group_id = g.id
       LEFT JOIN tournament_series s ON s.round_id = r.id
       WHERE p.tournament_id = ?
       GROUP BY p.id, p.phase_order, p.name, p.format, p.status,
                g.id, g.group_order, g.name, g.status
       ORDER BY p.phase_order, g.group_order`,
      [req.params.id]
    );
    return res.json({ phases: result.rows });
  } catch (error) {
    console.error('Get tournament competition error:', error);
    return res.status(500).json({ error: 'Failed to fetch tournament competition' });
  }
});

router.get('/:id/phases/:phaseId/standings', async (req, res) => {
  const result = await query(
    `SELECT s.*, g.name AS group_name, e.entry_type,
            COALESCE(u.nickname, tt.name) AS entry_name
     FROM tournament_phase_standings s
     JOIN tournament_phase_groups g ON g.id = s.group_id
     JOIN tournament_phases p ON p.id = g.phase_id
     JOIN tournament_entries e ON e.id = s.entry_id
     LEFT JOIN tournament_participants tp ON tp.id = e.participant_id
     LEFT JOIN users_extension u ON u.id = tp.user_id
     LEFT JOIN tournament_teams tt ON tt.id = e.team_id
     WHERE p.tournament_id = ? AND p.id = ?
     ORDER BY g.group_order, s.rank_position IS NULL, s.rank_position, s.points DESC`,
    [req.params.id, req.params.phaseId]
  );
  return res.json({ standings: result.rows });
});

router.get('/:id/phases/:phaseId/bracket', async (req, res) => {
  const result = await query(
    `SELECT g.id AS group_id, g.name AS group_name, r.id AS round_id, r.round_number, r.name AS round_name,
            s.id AS series_id, s.series_position, s.status, s.best_of, s.entry1_wins, s.entry2_wins,
            s.winner_entry_id, sl.slot_number, sl.source_type, sl.source_group_seed,
            sl.source_series_id, sl.source_outcome, sl.resolved_entry_id,
            COALESCE(u.nickname, tt.name) AS resolved_entry_name
     FROM tournament_phase_groups g
     JOIN tournament_phases p ON p.id = g.phase_id
     JOIN tournament_phase_rounds r ON r.group_id = g.id
     JOIN tournament_series s ON s.round_id = r.id
     JOIN tournament_series_slots sl ON sl.series_id = s.id
     LEFT JOIN tournament_entries e ON e.id = sl.resolved_entry_id
     LEFT JOIN tournament_participants tp ON tp.id = e.participant_id
     LEFT JOIN users_extension u ON u.id = tp.user_id
     LEFT JOIN tournament_teams tt ON tt.id = e.team_id
     WHERE p.tournament_id = ? AND p.id = ? AND p.format = 'single_elimination'
     ORDER BY g.group_order, r.round_number, s.series_position, sl.slot_number`,
    [req.params.id, req.params.phaseId]
  );
  return res.json({ slots: result.rows });
});

router.get('/:id/phases/:phaseId/games', async (req, res) => {
  const result = await query(
    `SELECT games.id AS game_id, games.game_number, games.status, games.played_at,
            games.winner_entry_id, series.id AS series_id, series.best_of,
            rounds.round_number, groups.name AS group_name,
            games.entry1_id, games.entry2_id,
            COALESCE(user1.nickname, team1.name) AS entry1_name,
            COALESCE(user2.nickname, team2.name) AS entry2_name
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
     WHERE phases.tournament_id = ? AND phases.id = ?
     ORDER BY groups.group_order, rounds.round_number, series.series_position, games.game_number`,
    [req.params.id, req.params.phaseId]
  );
  return res.json({ games: result.rows });
});

export default router;
