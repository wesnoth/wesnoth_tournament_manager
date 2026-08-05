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
import { getUserAgent, getUserIP, logAuditEvent } from '../middleware/audit.js';

const router = Router();

/**
 * Produce the canonical competition label for either an individual or a team.
 * Team membership is resolved at read time because entries intentionally point
 * to the stable team identity while participant replacements may change names.
 */
const competitionEntryNameSql = (userAlias: string, teamAlias: string): string => `
  CASE
    WHEN ${teamAlias}.id IS NULL THEN ${userAlias}.nickname
    ELSE CONCAT(
      ${teamAlias}.name,
      ' (',
      COALESCE((
        SELECT GROUP_CONCAT(member_user.nickname ORDER BY member.team_position, member.created_at SEPARATOR ', ')
        FROM tournament_participants member
        JOIN users_extension member_user ON member_user.id = member.user_id
        WHERE member.team_id = ${teamAlias}.id
          AND member.participation_status = 'accepted'
      ), 'No members'),
      ')'
    )
  END`;

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

/** Record the winner's report or the loser's manual confirmation/dispute for a phase game. */
router.post('/:id/games/:gameId/confirm', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { action, comments } = req.body;
    const rating = req.body.rating === undefined || req.body.rating === null ? null : Number(req.body.rating);
    if (!['report', 'confirm', 'dispute'].includes(action)) {
      return res.status(400).json({ error: 'action must be report, confirm, or dispute' });
    }
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
    }
    if (comments !== undefined && comments !== null && (typeof comments !== 'string' || comments.length > 500)) {
      return res.status(400).json({ error: 'comments must not exceed 500 characters' });
    }

    const gameResult = await query(
      `SELECT games.winner_entry_id, games.loser_entry_id, games.confirmation_status,
              (SELECT replay.integration_confidence FROM replays replay
               WHERE replay.tournament_game_id = games.id AND replay.deleted_at IS NULL
               ORDER BY replay.detected_at DESC, replay.created_at DESC LIMIT 1) AS replay_confidence,
              winner_entry.participant_id AS winner_participant_id, winner_entry.team_id AS winner_team_id,
              loser_entry.participant_id AS loser_participant_id, loser_entry.team_id AS loser_team_id
       FROM tournament_games games
       JOIN tournament_series series ON series.id = games.series_id
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       JOIN tournament_entries winner_entry ON winner_entry.id = games.winner_entry_id
       JOIN tournament_entries loser_entry ON loser_entry.id = games.loser_entry_id
       WHERE games.id = ? AND phases.tournament_id = ? AND games.status = 'completed'
       LIMIT 1`,
      [req.params.gameId, req.params.id]
    );
    if (!gameResult.rows?.length) return res.status(404).json({ error: 'Completed tournament game not found' });
    const game = gameResult.rows[0];

    const participantResult = await query(
      `SELECT 1 FROM tournament_participants
       WHERE user_id = ? AND participation_status = 'accepted'
         AND (id IN (?, ?) OR team_id IN (?, ?)) LIMIT 1`,
      [req.userId, game.winner_participant_id, game.loser_participant_id, game.winner_team_id, game.loser_team_id]
    );
    if (!participantResult.rows?.length) return res.status(403).json({ error: 'You are not a participant in this game' });

    const winnerParticipantResult = await query(
      `SELECT 1 FROM tournament_participants
       WHERE user_id = ? AND participation_status = 'accepted'
         AND (id = ? OR team_id = ?) LIMIT 1`,
      [req.userId, game.winner_participant_id, game.winner_team_id]
    );
    const loserParticipantResult = await query(
      `SELECT 1 FROM tournament_participants
       WHERE user_id = ? AND participation_status = 'accepted'
         AND (id = ? OR team_id = ?) LIMIT 1`,
      [req.userId, game.loser_participant_id, game.loser_team_id]
    );
    const isWinner = Boolean(winnerParticipantResult.rows?.length);
    const isLoser = Boolean(loserParticipantResult.rows?.length);
    if (action === 'report' && !isWinner) return res.status(403).json({ error: 'Only the winning participant can report this game' });
    if (['confirm', 'dispute'].includes(action) && !isLoser) return res.status(403).json({ error: 'Only the losing participant can confirm or dispute this game' });
    if (action === 'report' && !['unconfirmed', 'reported'].includes(game.confirmation_status)) {
      return res.status(409).json({ error: 'This game is no longer awaiting a result report' });
    }
    if (['confirm', 'dispute'].includes(action) && !['unconfirmed', 'reported'].includes(game.confirmation_status)) {
      return res.status(409).json({ error: 'This game is no longer awaiting opponent confirmation' });
    }
    if (action === 'dispute' && Number(game.replay_confidence) !== 1) {
      return res.status(409).json({ error: 'Only replay results with confidence 1 can be disputed' });
    }

    const nextStatus = action === 'report' ? 'reported' : action === 'confirm' ? 'confirmed' : 'disputed';
    const update = action === 'report'
      ? `UPDATE tournament_games SET winner_comments = ?, winner_rating = ?, confirmation_status = ? WHERE id = ?`
      : `UPDATE tournament_games SET loser_comments = ?, loser_rating = ?, confirmation_status = ? WHERE id = ?`;
    await query(update, [comments || null, rating, nextStatus, req.params.gameId]);
    return res.json({ success: true, confirmation_status: nextStatus });
  } catch (error) {
    console.error('Confirm phase game error:', error);
    return res.status(500).json({ error: 'Failed to update phase game confirmation' });
  }
});

router.post('/:id/series/:seriesId/admin-decision', authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!(await isTournamentOrganizer(req.params.id, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can record administrative decisions' });
    }
    const { winner_entry_id: winnerEntryId, action = 'admin_award' } = req.body;
    if (typeof winnerEntryId !== 'string') {
      return res.status(400).json({ error: 'winner_entry_id is required' });
    }
    if (!['admin_award', 'forfeit'].includes(action)) {
      return res.status(400).json({ error: 'action must be admin_award or forfeit' });
    }
    const gameResult = await query(
      `SELECT games.id
       FROM tournament_games games
       JOIN tournament_series series ON series.id = games.series_id
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       WHERE phases.tournament_id = ? AND series.id = ?
         AND series.status <> 'completed'
         AND games.status IN ('pending', 'in_progress')
       ORDER BY games.game_number DESC
       LIMIT 1`,
      [req.params.id, req.params.seriesId]
    );
    if (!gameResult.rows.length) {
      return res.status(409).json({ error: 'Series has no unresolved game available for an administrative decision' });
    }
    const result = await recordPhaseGameResult(
      req.params.id,
      gameResult.rows[0].id,
      winnerEntryId,
      null,
      action
    );
    await logAuditEvent({
      event_type: 'ADMIN_ACTION',
      user_id: req.userId,
      ip_address: getUserIP(req),
      user_agent: getUserAgent(req),
      details: {
        action: 'TOURNAMENT_SERIES_ADMIN_DECISION',
        tournament_id: req.params.id,
        series_id: req.params.seriesId,
        winner_entry_id: winnerEntryId,
        organizer_action: action,
      },
    });
    return res.json({ ...result, organizer_action: action });
  } catch (error: any) {
    if (error.message?.includes('not found')) return res.status(404).json({ error: error.message });
    if (error.message?.includes('already') || error.message?.includes('not part')) {
      return res.status(409).json({ error: error.message });
    }
    console.error('Record phase administrative decision error:', error);
    return res.status(500).json({ error: 'Failed to record administrative decision' });
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

/**
 * Build an overall classification from immutable phase history. Entries that
 * reached the same phase are separated by the strongest available competitive
 * evidence. Group ranks use their materialized tiebreakers; elimination ranks
 * use series records and then game margin, so a 2-1 loss outranks a 2-0 loss.
 * Truly identical records share a competition rank and the following placement
 * skips the occupied positions.
 */
router.get('/:id/overall-standings', async (req, res) => {
  try {
    const tournamentResult = await query(
      `SELECT id, status, competition_model_version FROM tournaments WHERE id = ?`,
      [req.params.id]
    );
    if (!tournamentResult.rows.length) return res.status(404).json({ error: 'Tournament not found' });
    if (Number(tournamentResult.rows[0].competition_model_version) !== 2) {
      return res.status(409).json({ error: 'Tournament does not use the phase engine' });
    }

    const [entryResult, historyResult, resultRows] = await Promise.all([
      query(
        `SELECT entries.id AS entry_id, entries.initial_seed,
                COALESCE(users.id, teams.id) AS entity_id,
                users.id AS entry_user_id,
                CASE WHEN teams.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
                  SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
                  FROM tournament_participants member
                  JOIN users_extension member_user ON member_user.id = member.user_id
                  WHERE member.team_id = teams.id
                    AND member.participation_status = 'accepted'
                ), JSON_ARRAY()) END AS entry_members,
                ${competitionEntryNameSql('users', 'teams')} AS entry_name
         FROM tournament_entries entries
         LEFT JOIN tournament_participants participants ON participants.id = entries.participant_id
         LEFT JOIN users_extension users ON users.id = participants.user_id
         LEFT JOIN tournament_teams teams ON teams.id = entries.team_id
         WHERE entries.tournament_id = ?`,
        [req.params.id]
      ),
      query(
        `SELECT phase_entries.entry_id, phases.id AS phase_id, phases.phase_order,
                phases.name AS phase_name, phases.format, phases.status AS phase_status,
                groups.id AS group_id, groups.name AS group_name,
                standings.rank_position, standings.matches_played, standings.wins,
                standings.losses, standings.points, standings.omp, standings.gwp, standings.ogp,
                (SELECT COUNT(*)
                 FROM tournament_series phase_series
                 JOIN tournament_phase_rounds phase_rounds ON phase_rounds.id = phase_series.round_id
                 WHERE phase_rounds.group_id = groups.id
                   AND phase_series.winner_entry_id = phase_entries.entry_id) AS series_wins,
                (SELECT COUNT(*)
                 FROM tournament_series phase_series
                 JOIN tournament_phase_rounds phase_rounds ON phase_rounds.id = phase_series.round_id
                 WHERE phase_rounds.group_id = groups.id
                   AND phase_series.loser_entry_id = phase_entries.entry_id) AS series_losses,
                (SELECT MAX(rounds.round_number)
                 FROM tournament_series series
                 JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
                 WHERE rounds.group_id = groups.id
                   AND phases.format = 'single_elimination'
                   AND series.loser_entry_id = phase_entries.entry_id) AS eliminated_round,
                (SELECT CASE
                          WHEN elimination_slot.slot_number = 1 THEN elimination_series.entry1_wins
                          ELSE elimination_series.entry2_wins
                        END
                 FROM tournament_series elimination_series
                 JOIN tournament_phase_rounds elimination_round ON elimination_round.id = elimination_series.round_id
                 JOIN tournament_series_slots elimination_slot
                   ON elimination_slot.series_id = elimination_series.id
                  AND elimination_slot.resolved_entry_id = phase_entries.entry_id
                 WHERE elimination_round.group_id = groups.id
                   AND phases.format = 'single_elimination'
                   AND elimination_series.loser_entry_id = phase_entries.entry_id
                 ORDER BY elimination_round.round_number DESC LIMIT 1) AS elimination_game_wins,
                (SELECT CASE
                          WHEN elimination_slot.slot_number = 1 THEN elimination_series.entry2_wins
                          ELSE elimination_series.entry1_wins
                        END
                 FROM tournament_series elimination_series
                 JOIN tournament_phase_rounds elimination_round ON elimination_round.id = elimination_series.round_id
                 JOIN tournament_series_slots elimination_slot
                   ON elimination_slot.series_id = elimination_series.id
                  AND elimination_slot.resolved_entry_id = phase_entries.entry_id
                 WHERE elimination_round.group_id = groups.id
                   AND phases.format = 'single_elimination'
                   AND elimination_series.loser_entry_id = phase_entries.entry_id
                 ORDER BY elimination_round.round_number DESC LIMIT 1) AS elimination_game_losses
         FROM tournament_phase_entries phase_entries
         JOIN tournament_phase_groups groups ON groups.id = phase_entries.group_id
         JOIN tournament_phases phases ON phases.id = groups.phase_id
         LEFT JOIN tournament_phase_standings standings
           ON standings.group_id = groups.id AND standings.entry_id = phase_entries.entry_id
         WHERE phases.tournament_id = ?
         ORDER BY phases.phase_order, groups.group_order`,
        [req.params.id]
      ),
      query(
        `SELECT entry_id, placement, placement_label, is_champion
         FROM tournament_results WHERE tournament_id = ?`,
        [req.params.id]
      ),
    ]);

    const histories = new Map<string, any[]>();
    for (const row of historyResult.rows) {
      histories.set(row.entry_id, [...(histories.get(row.entry_id) || []), {
        phase_id: row.phase_id,
        phase_order: Number(row.phase_order),
        phase_name: row.phase_name,
        format: row.format,
        phase_status: row.phase_status,
        group_id: row.group_id,
        group_name: row.group_name,
        group_position: row.rank_position == null ? null : Number(row.rank_position),
        matches_played: Number(row.matches_played || 0),
        wins: Number(row.wins || 0),
        losses: Number(row.losses || 0),
        points: Number(row.points || 0),
        omp: Number(row.omp || 0),
        gwp: Number(row.gwp || 0),
        ogp: Number(row.ogp || 0),
        series_wins: Number(row.series_wins || 0),
        series_losses: Number(row.series_losses || 0),
        eliminated_round: row.eliminated_round == null ? null : Number(row.eliminated_round),
        elimination_game_wins: Number(row.elimination_game_wins || 0),
        elimination_game_losses: Number(row.elimination_game_losses || 0),
      }]);
    }
    const materializedResults = new Map(resultRows.rows.map((row: any) => [row.entry_id, row]));
    const tournamentFinished = tournamentResult.rows[0].status === 'finished';
    const standings = entryResult.rows.map((entry: any) => {
      const history = histories.get(entry.entry_id) || [];
      const furthest = history[history.length - 1] || null;
      const result: any = materializedResults.get(entry.entry_id);
      const champion = Boolean(result?.is_champion);
      const runnerUp = tournamentFinished && Number(result?.placement) === 2;
      const eliminated = !champion && !runnerUp && Boolean(
        furthest?.eliminated_round || furthest?.phase_status === 'completed'
      );
      const status = champion ? 'champion' : runnerUp ? 'runner_up' : eliminated ? 'eliminated' : 'active';
      const outcome = champion
        ? 'Champion'
        : runnerUp
          ? 'Runner-up'
          : furthest?.eliminated_round
            ? `Eliminated in ${furthest.phase_name}, round ${furthest.eliminated_round}`
            : eliminated && furthest?.group_position
              ? `Eliminated in ${furthest.phase_name}: ${furthest.group_name}, position ${furthest.group_position}`
              : furthest
                ? `Active in ${furthest.phase_name}: ${furthest.group_name}`
                : 'Registered';
      // Descending numeric vectors make the ranking rules explicit and keep
      // display order independent from labels or UUIDs. Initial seed is only a
      // deterministic display fallback and never breaks a competitive tie.
      const rankVector = result?.placement != null
        ? [3, -Number(result.placement)]
        : furthest?.eliminated_round
          ? [
              2,
              furthest.phase_order,
              1,
              furthest.eliminated_round,
              furthest.series_wins,
              -furthest.series_losses,
              furthest.elimination_game_wins,
              -furthest.elimination_game_losses,
              furthest.points,
              furthest.wins,
              -furthest.losses,
              furthest.omp,
              furthest.gwp,
              furthest.ogp,
            ]
          : [
              2,
              furthest?.phase_order || 0,
              eliminated ? 0 : 2,
              -Number(furthest?.group_position || 999),
              furthest?.points || 0,
              furthest?.wins || 0,
              -(furthest?.losses || 0),
              furthest?.omp || 0,
              furthest?.gwp || 0,
              furthest?.ogp || 0,
            ];
      return {
        entry_id: entry.entry_id,
        entity_id: entry.entity_id,
        entry_user_id: entry.entry_user_id,
        entry_members: typeof entry.entry_members === 'string' ? JSON.parse(entry.entry_members) : (entry.entry_members || []),
        entry_name: entry.entry_name,
        initial_seed: Number(entry.initial_seed || 0),
        status,
        outcome,
        rank_vector: rankVector,
        furthest_phase_order: Number(furthest?.phase_order || 0),
        history,
      };
    });

    const compareVectors = (left: number[], right: number[]) => {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        const difference = (right[index] || 0) - (left[index] || 0);
        if (difference !== 0) return difference;
      }
      return 0;
    };
    standings.sort((left: any, right: any) =>
      compareVectors(left.rank_vector, right.rank_vector)
      || left.initial_seed - right.initial_seed
      || left.entry_name.localeCompare(right.entry_name)
    );
    let previousRankVector: string | null = null;
    let placement = 0;
    const ranked = standings.map((standing: any, index: number) => {
      const rankVectorKey = JSON.stringify(standing.rank_vector);
      if (rankVectorKey !== previousRankVector) placement = index + 1;
      previousRankVector = rankVectorKey;
      const { rank_vector, ...publicStanding } = standing;
      return { ...publicStanding, placement };
    });
    return res.json({ standings: ranked });
  } catch (error) {
    console.error('Overall tournament standings error:', error);
    return res.status(500).json({ error: 'Failed to load overall tournament standings' });
  }
});

router.get('/:id/phases/:phaseId/standings', async (req, res) => {
  const result = await query(
    `SELECT s.*, g.name AS group_name, e.entry_type,
            u.id AS entry_user_id,
            CASE WHEN tt.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
              SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
              FROM tournament_participants member
              JOIN users_extension member_user ON member_user.id = member.user_id
              WHERE member.team_id = tt.id
                AND member.participation_status = 'accepted'
            ), JSON_ARRAY()) END AS entry_members,
            ${competitionEntryNameSql('u', 'tt')} AS entry_name
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
            u.id AS resolved_entry_user_id,
            CASE WHEN tt.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
              SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
              FROM tournament_participants member
              JOIN users_extension member_user ON member_user.id = member.user_id
              WHERE member.team_id = tt.id AND member.participation_status = 'accepted'
            ), JSON_ARRAY()) END AS resolved_entry_members,
            ${competitionEntryNameSql('u', 'tt')} AS resolved_entry_name
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

/**
 * Return phase games with the presentation metadata used by tournament detail.
 * tournament_games is authoritative for phase results; ranked match metadata is
 * a fallback, while unranked replay URLs are resolved through tournament_game_id.
 */
router.get('/:id/phases/:phaseId/games', async (req, res) => {
  const result = await query(
    `SELECT games.id AS game_id, games.game_number, games.status, games.confirmation_status, games.played_at,
            games.organizer_action,
            games.winner_entry_id, series.id AS series_id, series.best_of,
            phases.id AS phase_id, phases.name AS phase_name,
            rounds.round_number, groups.id AS group_id, groups.name AS group_name,
            games.entry1_id, games.entry2_id,
            participant1.user_id AS entry1_user_id,
            participant2.user_id AS entry2_user_id,
            CASE WHEN team1.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
              SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
              FROM tournament_participants member
              JOIN users_extension member_user ON member_user.id = member.user_id
              WHERE member.team_id = team1.id AND member.participation_status = 'accepted'
            ), JSON_ARRAY()) END AS entry1_members,
            CASE WHEN team2.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
              SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
              FROM tournament_participants member
              JOIN users_extension member_user ON member_user.id = member.user_id
              WHERE member.team_id = team2.id AND member.participation_status = 'accepted'
            ), JSON_ARRAY()) END AS entry2_members,
            games.map,
            games.winner_faction,
            games.loser_faction,
            games.winner_side,
            games.winner_comments, games.winner_rating, games.loser_comments, games.loser_rating,
            (SELECT replay.integration_confidence FROM replays replay
             WHERE replay.tournament_game_id = games.id AND replay.deleted_at IS NULL
             ORDER BY replay.detected_at DESC, replay.created_at DESC LIMIT 1) AS replay_confidence,
            (SELECT replay.replay_url FROM replays replay
             WHERE replay.tournament_game_id = games.id AND replay.deleted_at IS NULL
             ORDER BY replay.detected_at DESC LIMIT 1) AS replay_url,
            games.replay_downloads,
            pending_replay.id AS pending_replay_id,
            pending_replay.parse_summary AS pending_replay_summary,
            pending_replay.integration_confidence AS pending_replay_confidence,
            pending_replay.parse_status AS pending_replay_parse_status,
            pending_replay.replay_url AS pending_replay_url,
            ${competitionEntryNameSql('user1', 'team1')} AS entry1_name,
            ${competitionEntryNameSql('user2', 'team2')} AS entry2_name,
            CASE WHEN team1.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
              SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
              FROM tournament_participants member
              JOIN users_extension member_user ON member_user.id = member.user_id
              WHERE member.team_id = team1.id AND member.participation_status = 'accepted'
            ), JSON_ARRAY()) END AS entry1_members,
            CASE WHEN team2.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
              SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
              FROM tournament_participants member
              JOIN users_extension member_user ON member_user.id = member.user_id
              WHERE member.team_id = team2.id AND member.participation_status = 'accepted'
            ), JSON_ARRAY()) END AS entry2_members,
            entry1.team_id AS entry1_team_id,
            entry2.team_id AS entry2_team_id
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
     LEFT JOIN replays pending_replay
       ON pending_replay.id = (
         SELECT replay.id FROM replays replay
         WHERE replay.tournament_game_id = games.id
           AND replay.parse_status IN ('parsed', 'due')
           AND replay.integration_confidence = 1
           AND replay.match_id IS NULL
           AND replay.deleted_at IS NULL
         ORDER BY replay.detected_at DESC, replay.created_at DESC
         LIMIT 1
       )
     WHERE phases.tournament_id = ? AND phases.id = ?
     ORDER BY groups.group_order, rounds.round_number, series.series_position, games.game_number`,
    [req.params.id, req.params.phaseId]
  );
  // Administrative resolution is detected from the authoritative series score
  // minus real completed game wins. This also recovers converted legacy series,
  // where placeholder organizer rows intentionally remained in legacy tables.
  const decisionResult = await query(
    `SELECT series.id AS series_id, series.best_of, series.entry1_wins, series.entry2_wins,
            series.winner_entry_id, series.loser_entry_id, series.completed_at,
            phases.id AS phase_id, phases.name AS phase_name,
            rounds.round_number, groups.id AS group_id, groups.name AS group_name,
            slot1.resolved_entry_id AS entry1_id, slot2.resolved_entry_id AS entry2_id,
            ${competitionEntryNameSql('user1', 'team1')} AS entry1_name,
            ${competitionEntryNameSql('user2', 'team2')} AS entry2_name,
            (SELECT COUNT(*) FROM tournament_games played1
             WHERE played1.series_id = series.id AND played1.status = 'completed'
               AND played1.organizer_action IS NULL
               AND played1.winner_entry_id = slot1.resolved_entry_id) AS entry1_played_wins,
            (SELECT COUNT(*) FROM tournament_games played2
             WHERE played2.series_id = series.id AND played2.status = 'completed'
               AND played2.organizer_action IS NULL
               AND played2.winner_entry_id = slot2.resolved_entry_id) AS entry2_played_wins,
            (SELECT administrative.organizer_action FROM tournament_games administrative
             WHERE administrative.series_id = series.id
               AND administrative.organizer_action IS NOT NULL
             ORDER BY administrative.played_at DESC, administrative.game_number DESC LIMIT 1) AS organizer_action,
            (SELECT administrative.played_at FROM tournament_games administrative
             WHERE administrative.series_id = series.id
               AND administrative.organizer_action IS NOT NULL
             ORDER BY administrative.played_at DESC, administrative.game_number DESC LIMIT 1) AS decided_at
     FROM tournament_series series
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     JOIN tournament_series_slots slot1 ON slot1.series_id = series.id AND slot1.slot_number = 1
     JOIN tournament_series_slots slot2 ON slot2.series_id = series.id AND slot2.slot_number = 2
     JOIN tournament_entries entry1 ON entry1.id = slot1.resolved_entry_id
     JOIN tournament_entries entry2 ON entry2.id = slot2.resolved_entry_id
     LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
     LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
     LEFT JOIN users_extension user1 ON user1.id = participant1.user_id
     LEFT JOIN users_extension user2 ON user2.id = participant2.user_id
     LEFT JOIN tournament_teams team1 ON team1.id = entry1.team_id
     LEFT JOIN tournament_teams team2 ON team2.id = entry2.team_id
     WHERE phases.tournament_id = ? AND phases.id = ? AND series.status = 'completed'`,
    [req.params.id, req.params.phaseId]
  );
  const administrativeDecisions = decisionResult.rows
    .filter((series: any) =>
      Number(series.entry1_wins) > Number(series.entry1_played_wins)
      || Number(series.entry2_wins) > Number(series.entry2_played_wins)
    )
    .map((series: any) => ({
      ...series,
      decision_id: `admin-${series.series_id}`,
      organizer_action: series.organizer_action || 'legacy_admin_decision',
      decided_at: series.decided_at || series.completed_at,
      entry1_awarded_wins: Math.max(0, Number(series.entry1_wins) - Number(series.entry1_played_wins)),
      entry2_awarded_wins: Math.max(0, Number(series.entry2_wins) - Number(series.entry2_played_wins)),
    }));
  return res.json({ games: result.rows, administrative_decisions: administrativeDecisions });
});

/** Return confirmed phase-engine series schedules for the Events page. */
router.get('/:id/scheduled-series', async (req, res) => {
  try {
    const result = await query(
      `SELECT proposals.tournament_series_id AS series_id,
              MIN(slots.slot_datetime) AS scheduled_datetime,
              proposals.status AS scheduled_status,
              tournaments.name AS tournament_name,
              entry1_user.id AS player1_id,
              entry2_user.id AS player2_id,
              ${competitionEntryNameSql('entry1_user', 'team1')} AS player1_name,
              ${competitionEntryNameSql('entry2_user', 'team2')} AS player2_name,
              entry1.team_id AS player1_team_id,
              entry2.team_id AS player2_team_id
       FROM match_schedule_proposals proposals
       JOIN match_schedule_slots slots ON slots.proposal_id = proposals.id
       JOIN tournament_series series ON series.id = proposals.tournament_series_id
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       JOIN tournaments ON tournaments.id = phases.tournament_id
       JOIN tournament_series_slots series_slot1
         ON series_slot1.series_id = series.id AND series_slot1.slot_number = 1
       JOIN tournament_series_slots series_slot2
         ON series_slot2.series_id = series.id AND series_slot2.slot_number = 2
       JOIN tournament_entries entry1 ON entry1.id = series_slot1.resolved_entry_id
       JOIN tournament_entries entry2 ON entry2.id = series_slot2.resolved_entry_id
       LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
       LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
       LEFT JOIN users_extension entry1_user ON entry1_user.id = participant1.user_id
       LEFT JOIN users_extension entry2_user ON entry2_user.id = participant2.user_id
       LEFT JOIN tournament_teams team1 ON team1.id = entry1.team_id
       LEFT JOIN tournament_teams team2 ON team2.id = entry2.team_id
       WHERE phases.tournament_id = ?
         AND proposals.challenge_mode = 'tournament'
         AND proposals.status = 'confirmed'
         AND slots.status = 'confirmed'
       GROUP BY proposals.tournament_series_id, proposals.status, tournaments.name,
                entry1_user.id, entry2_user.id, entry1.team_id, entry2.team_id,
                player1_name, player2_name
       ORDER BY scheduled_datetime ASC`,
      [req.params.id]
    );
    return res.json({ schedules: result.rows || [] });
  } catch (error) {
    console.error('Get scheduled phase-engine series error:', error);
    return res.status(500).json({ error: 'Failed to fetch scheduled series' });
  }
});

export default router;
