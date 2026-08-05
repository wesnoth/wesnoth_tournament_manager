import { Router } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { pool, query } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getTournamentPlacements } from '../services/tournamentResultService.js';
import discordService from '../services/discordService.js';
import { randomUUID } from 'crypto';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';
import { checkUserIsForumModerator } from '../services/phpbbAuth.js';
import { isTournamentOrganizer } from '../services/tournamentAuthorizationService.js';
import { preparePhaseCompetition, startPhaseCompetition } from '../tournament-engine/competitionCompiler.js';
import { parseForumTopicUrl } from '../tournament-engine/forumTopic.js';
import { saveTournamentFormat } from '../tournament-engine/formatService.js';
import type { TournamentFormatDefinition } from '../tournament-engine/types.js';

const router = Router();

// Reserved team ID for rejected players (special system UUID)
const REJECTED_TEAM_ID = '00000000-0000-0000-0000-000000000001';
const REJECTED_PLAYERS_TRANSLATIONS = [
  'Rejected players',      // English
  'Jugadores rechazados',  // Spanish
  'Abgelehnte Spieler',    // German
  'Отклоненные игроки',    // Russian
  '被拒绝的玩家'            // Chinese
];

const TOURNAMENT_TYPES = ['elimination', 'league', 'swiss', 'swiss_elimination'] as const;
const TOURNAMENT_MODES = ['ranked', 'unranked', 'team'] as const;
const MATCH_FORMATS = ['bo1', 'bo3', 'bo5'] as const;

interface TournamentConfiguration {
  tournament_type: string;
  tournament_mode: string;
  max_participants: number | null;
  round_duration_days: number;
  auto_advance_round: boolean | number;
  general_rounds: number;
  final_rounds: number;
  general_rounds_format: string;
  final_rounds_format: string;
}

/**
 * Validate the complete persisted tournament configuration. Update requests
 * are merged with the current row before calling this function so the same
 * invariants apply to creation and editing.
 */
function validateTournamentConfiguration(config: TournamentConfiguration): string | null {
  if (!TOURNAMENT_TYPES.includes(config.tournament_type as typeof TOURNAMENT_TYPES[number])) {
    return 'Invalid tournament_type';
  }
  if (!TOURNAMENT_MODES.includes(config.tournament_mode as typeof TOURNAMENT_MODES[number])) {
    return 'Invalid tournament_mode';
  }
  if (
    config.max_participants !== null &&
    (!Number.isInteger(config.max_participants) || config.max_participants < 0 || config.max_participants === 1 || config.max_participants > 256)
  ) {
    return 'Max participants must be 0 or an integer between 2 and 256';
  }
  if (!Number.isInteger(config.round_duration_days) || config.round_duration_days < 1 || config.round_duration_days > 365) {
    return 'Round duration must be an integer between 1 and 365 days';
  }
  if (![true, false, 0, 1].includes(config.auto_advance_round)) {
    return 'auto_advance_round must be a boolean';
  }
  if (!MATCH_FORMATS.includes(config.general_rounds_format as typeof MATCH_FORMATS[number]) ||
      !MATCH_FORMATS.includes(config.final_rounds_format as typeof MATCH_FORMATS[number])) {
    return 'Match formats must be bo1, bo3, or bo5';
  }
  if (!Number.isInteger(config.general_rounds) || !Number.isInteger(config.final_rounds) ||
      config.general_rounds < 0 || config.final_rounds < 0) {
    return 'Round counts must be non-negative integers';
  }

  if (config.tournament_type === 'league') {
    if (![1, 2].includes(config.general_rounds) || config.final_rounds !== 0) {
      return 'League tournaments require one or two waves and no final rounds';
    }
  } else if (config.tournament_type === 'swiss') {
    if (config.general_rounds < 1 || config.general_rounds > 10 || config.final_rounds !== 0) {
      return 'Swiss tournaments require between 1 and 10 rounds and no final rounds';
    }
  } else if (config.tournament_type === 'swiss_elimination') {
    if (config.general_rounds < 1 || config.general_rounds > 10 ||
        config.final_rounds < 1 || config.final_rounds > 3) {
      return 'Swiss-Elimination tournaments require 1-10 Swiss rounds and 1-3 elimination rounds';
    }
  } else if (config.general_rounds !== 0 || config.final_rounds !== 0) {
    return 'Elimination round counts are calculated from the accepted field size';
  }

  return null;
}

function toMariaDbDateTime(value: string): string {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

/** Convert persisted UTC DATETIME values and API ISO values to a comparable instant. */
function tournamentDateTimeEpoch(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const epoch = new Date(normalized).getTime();
  return Number.isNaN(epoch) ? null : epoch;
}

/**
 * Delete a phase-engine tournament aggregate while preserving global match and
 * replay history. The old tournament tables are intentionally not referenced:
 * they are removed by the compatibility migration and must not be required by
 * any v2 lifecycle operation.
 */
async function deleteTournamentRecords(connection: PoolConnection, tournamentId: string): Promise<void> {
  await connection.execute(
    `DELETE confirmations
     FROM match_schedule_confirmations confirmations
     JOIN match_schedule_proposals proposals ON proposals.id = confirmations.proposal_id
     JOIN tournament_series series ON series.id = proposals.tournament_series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     WHERE phases.tournament_id = ?`,
    [tournamentId]
  );
  await connection.execute(
    `DELETE slots
     FROM match_schedule_slots slots
     JOIN match_schedule_proposals proposals ON proposals.id = slots.proposal_id
     JOIN tournament_series series ON series.id = proposals.tournament_series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     WHERE phases.tournament_id = ?`,
    [tournamentId]
  );
  await connection.execute(
    `DELETE proposals
     FROM match_schedule_proposals proposals
     JOIN tournament_series series ON series.id = proposals.tournament_series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     WHERE phases.tournament_id = ?`,
    [tournamentId]
  );
  await connection.execute(
    `DELETE games
     FROM tournament_games games
     JOIN tournament_series series ON series.id = games.series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     WHERE phases.tournament_id = ?`,
    [tournamentId]
  );
  await connection.execute(
    `DELETE slots
     FROM tournament_series_slots slots
     JOIN tournament_series series ON series.id = slots.series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     WHERE phases.tournament_id = ?`,
    [tournamentId]
  );
  await connection.execute(
    `DELETE byes
     FROM tournament_byes byes
     JOIN tournament_phase_rounds rounds ON rounds.id = byes.round_id
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     WHERE phases.tournament_id = ?`,
    [tournamentId]
  );
  await connection.execute(
    `DELETE standings
     FROM tournament_phase_standings standings
     JOIN tournament_phase_groups groups ON groups.id = standings.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     WHERE phases.tournament_id = ?`,
    [tournamentId]
  );
  await connection.execute('DELETE FROM tournament_results WHERE tournament_id = ?', [tournamentId]);
  await connection.execute('DELETE FROM tournament_phases WHERE tournament_id = ?', [tournamentId]);
  await connection.execute('DELETE FROM user_notifications WHERE tournament_id = ?', [tournamentId]);
  await connection.execute(
    'DELETE FROM team_substitutes WHERE team_id IN (SELECT id FROM tournament_teams WHERE tournament_id = ?)',
    [tournamentId]
  );
  await connection.execute('DELETE FROM tournament_participants WHERE tournament_id = ?', [tournamentId]);
  await connection.execute('DELETE FROM tournament_teams WHERE tournament_id = ?', [tournamentId]);
  await connection.execute('DELETE FROM tournament_unranked_factions WHERE tournament_id = ?', [tournamentId]);
  await connection.execute('DELETE FROM tournament_unranked_maps WHERE tournament_id = ?', [tournamentId]);
  await connection.execute('DELETE FROM tournament_organizers WHERE tournament_id = ?', [tournamentId]);
  await connection.execute('DELETE FROM tournaments WHERE id = ?', [tournamentId]);
}

// Check if team name is reserved
function isReservedTeamName(teamName: string): boolean {
  return REJECTED_PLAYERS_TRANSLATIONS.some(translation => 
    translation.toLowerCase() === teamName.toLowerCase()
  );
}

// Generate a UUID that never matches REJECTED_TEAM_ID
async function generateSafeTeamId(): Promise<string> {
  const crypto = await import('crypto');
  let teamId: string;
  do {
    teamId = crypto.randomUUID();
  } while (teamId === REJECTED_TEAM_ID);
  return teamId;
}

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  let tournamentId: string | null = null;
  try {
    const { 
      name, 
      description, 
      tournament_type, 
      tournament_mode,
      max_participants, 
      round_duration_days,
      auto_advance_round,
      general_rounds,
      final_rounds,
      general_rounds_format,
      final_rounds_format,
      scheduled_start_at,
      rules_template_id,
      rules_content,
      organizer_ids,
      unranked_factions,
      unranked_maps,
      forum_topic_url,
      format_definition
    } = req.body;
    let forumTopicId: number | null;
    try {
      forumTopicId = parseForumTopicUrl(forum_topic_url);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    const effectiveAutoAdvanceRound = tournament_type === 'league'
      ? false
      : (auto_advance_round ?? false);

    // Validation
    if (typeof name !== 'string' || !name.trim() || typeof description !== 'string' || !description.trim() || !tournament_type) {
      return res.status(400).json({ error: 'Missing required fields: name, description, tournament_type' });
    }

    const configurationError = validateTournamentConfiguration({
      tournament_type,
      tournament_mode: tournament_mode || 'ranked',
      max_participants: max_participants ?? null,
      round_duration_days: round_duration_days ?? 7,
      auto_advance_round: effectiveAutoAdvanceRound,
      general_rounds: tournament_type === 'elimination' ? 0 : (general_rounds ?? 0),
      final_rounds: tournament_type === 'elimination' ? 0 : (final_rounds ?? 0),
      general_rounds_format: general_rounds_format || 'bo3',
      final_rounds_format: final_rounds_format || 'bo5',
    });
    if (configurationError) {
      return res.status(400).json({ error: configurationError });
    }
    if (scheduled_start_at != null && Number.isNaN(Date.parse(scheduled_start_at))) {
      return res.status(400).json({ error: 'Invalid scheduled_start_at date' });
    }

    // A tournament must declare its capacity at creation time. Zero is the
    // explicit unlimited value; null/omitted means the organizer did not
    // provide the required reference value.
    if (max_participants === null || max_participants === undefined) {
      return res.status(400).json({ error: 'Max participants is required; use 0 for unlimited' });
    }

    // Validate round configuration - only validate if max_participants is set
    // At least one round must be configured when max_participants is set (except for elimination which auto-calculates)
    const tournamentTypeLower = tournament_type.toLowerCase();
    
    if (max_participants && max_participants > 0 && tournamentTypeLower !== 'elimination') {
      if ((general_rounds || 0) < 0 || (final_rounds || 0) < 0) {
        return res.status(400).json({ error: 'Round values cannot be negative' });
      }
      if ((general_rounds || 0) + (final_rounds || 0) <= 0) {
        return res.status(400).json({ error: 'At least one round must be configured (general_rounds or final_rounds)' });
      }
    }

    // Validate match formats only if provided
    const validFormats = ['bo1', 'bo3', 'bo5'];
    if (general_rounds_format && !validFormats.includes(general_rounds_format)) {
      return res.status(400).json({ error: 'Invalid general_rounds_format. Must be: bo1, bo3, or bo5' });
    }
    if (final_rounds_format && !validFormats.includes(final_rounds_format)) {
      return res.status(400).json({ error: 'Invalid final_rounds_format. Must be: bo1, bo3, or bo5' });
    }

    let selectedTemplateId: string | null = rules_template_id || null;
    let resolvedRulesContent: string = typeof rules_content === 'string' ? rules_content.trim() : '';

    if (selectedTemplateId) {
      const templateResult = await query(
        `SELECT id, content_markdown, is_active
         FROM tournament_rule_templates
         WHERE id = ?`,
        [selectedTemplateId]
      );

      if (templateResult.rows.length === 0) {
        return res.status(400).json({ error: 'Selected rules template does not exist' });
      }

      if (templateResult.rows[0].is_active !== 1) {
        return res.status(400).json({ error: 'Selected rules template is not active' });
      }

      if (!resolvedRulesContent) {
        resolvedRulesContent = templateResult.rows[0].content_markdown || '';
      }
    }

    if (!resolvedRulesContent) {
      resolvedRulesContent = description;
    }

    if ((unranked_factions !== undefined && !Array.isArray(unranked_factions)) ||
        (unranked_maps !== undefined && !Array.isArray(unranked_maps))) {
      return res.status(400).json({ error: 'Tournament factions and maps must be arrays' });
    }

    const factionIds = [...new Set((unranked_factions || []).map((item: any) => item?.id || item))]
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const mapIds = [...new Set((unranked_maps || []).map((item: any) => item?.id || item))]
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (factionIds.length !== (unranked_factions || []).length || mapIds.length !== (unranked_maps || []).length) {
      return res.status(400).json({ error: 'Tournament assets contain invalid or duplicate identifiers' });
    }

    if (factionIds.length === 0 || mapIds.length === 0) {
      return res.status(400).json({ error: 'At least one faction and one map must be selected' });
    }

    if (factionIds.length > 0) {
      const factionPlaceholders = factionIds.map(() => '?').join(', ');
      const factionsResult = await query(
        `SELECT id, is_ranked FROM factions WHERE id IN (${factionPlaceholders}) AND is_active = 1`,
        factionIds
      );
      if (factionsResult.rows.length !== factionIds.length ||
          (tournament_mode === 'ranked' && factionsResult.rows.some((faction: any) => !faction.is_ranked))) {
        return res.status(400).json({ error: 'One or more selected factions are unavailable for this tournament mode' });
      }
    }

    if (mapIds.length > 0) {
      const mapPlaceholders = mapIds.map(() => '?').join(', ');
      const mapsResult = await query(
        `SELECT id, is_ranked FROM game_maps WHERE id IN (${mapPlaceholders}) AND is_active = 1`,
        mapIds
      );
      if (mapsResult.rows.length !== mapIds.length ||
          (tournament_mode === 'ranked' && mapsResult.rows.some((map: any) => !map.is_ranked))) {
        return res.status(400).json({ error: 'One or more selected maps are unavailable for this tournament mode' });
      }
    }

    // Validate tournament type-specific configurations
    // (already validated tournamentTypeLower is declared above)
    
    if (tournamentTypeLower === 'league') {
      // League: only general_rounds, must be 1 or 2
      if ((final_rounds || 0) > 0) {
        return res.status(400).json({ error: 'League tournaments should not have final rounds' });
      }
      if ((general_rounds || 0) < 1 || (general_rounds || 0) > 2) {
        return res.status(400).json({ error: 'League tournaments must have 1 or 2 general rounds (1=single round-robin, 2=home and away)' });
      }
    } else if (tournamentTypeLower === 'swiss') {
      // Swiss: only general_rounds, can be any number from 1 to 10
      if ((final_rounds || 0) > 0) {
        return res.status(400).json({ error: 'Swiss tournaments should not have final rounds' });
      }
      if ((general_rounds || 0) < 1 || (general_rounds || 0) > 10) {
        return res.status(400).json({ error: 'Swiss tournaments must have between 1 and 10 general rounds' });
      }
    } else if (tournamentTypeLower === 'swiss_elimination') {
      // Swiss-Elimination Mix: both general and final rounds
      // General rounds: 1-10 (Swiss phase)
      // Final rounds: 1-3 (Elimination phase: Quarterfinals, Semifinals, Final)
      if ((general_rounds || 0) < 1 || (general_rounds || 0) > 10) {
        return res.status(400).json({ error: 'Swiss-Elimination Mix must have between 1 and 10 general rounds (Swiss phase)' });
      }
      if ((final_rounds || 0) < 1 || (final_rounds || 0) > 3) {
        return res.status(400).json({ error: 'Swiss-Elimination Mix must have between 1 and 3 final rounds (Elimination phase)' });
      }
    } else if (tournamentTypeLower === 'elimination') {
      // Pure Elimination: system calculates rounds automatically based on participants
      // Only need match formats (general_rounds_format for preliminaries, final_rounds_format for final)
      if (!general_rounds_format || !final_rounds_format) {
        return res.status(400).json({ error: 'Elimination tournaments must specify match formats (general_rounds_format and final_rounds_format)' });
      }
    }

    // Calculate total rounds based on tournament type and participants
    let totalRounds = 0;
    if (tournamentTypeLower === 'elimination' && max_participants && max_participants > 0) {
      // For elimination: calculate rounds needed for all participants
      totalRounds = Math.ceil(Math.log2(max_participants));
    } else if (tournamentTypeLower !== 'elimination') {
      // For other types, use specified rounds
      totalRounds = (general_rounds || 0) + (final_rounds || 0);
    }
    // If elimination without max_participants, total_rounds will be calculated during close-registration

    // Generate UUID for tournament
    tournamentId = randomUUID();

    // Create tournament
    const tournamentResult = await query(
      `INSERT INTO tournaments (
        id, name, description, forum_topic_id, rules_template_id, rules_content, creator_id, tournament_type, tournament_mode,
        max_participants, round_duration_days, auto_advance_round, auto_progress, scheduled_start_at,
        total_rounds, general_rounds, final_rounds,
        general_rounds_format, final_rounds_format,
        status, current_round
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       `,
      [
        tournamentId,
        name.trim(),
        description.trim(),
        forumTopicId,
        selectedTemplateId,
        resolvedRulesContent,
        req.userId, 
        tournament_type,
        tournament_mode || 'ranked',
        max_participants, 
        round_duration_days || 7,
        effectiveAutoAdvanceRound,
        effectiveAutoAdvanceRound,
        scheduled_start_at ? toMariaDbDateTime(scheduled_start_at) : null,
        totalRounds,
        tournamentTypeLower === 'elimination' ? 0 : (general_rounds || 0),
        tournamentTypeLower === 'elimination' ? 0 : (final_rounds || 0),
        general_rounds_format || 'bo3',
        final_rounds_format || 'bo5',
        'registration_open',
        0
      ]
    );

    // Ensure creator is registered as organizer (for multi-organizer model)
    await query(
      `INSERT IGNORE INTO tournament_organizers (tournament_id, user_id, created_by)
       VALUES (?, ?, ?)`,
      [tournamentId, req.userId, req.userId]
    );

    // Optional co-organizers (full organizer permissions)
    if (Array.isArray(organizer_ids) && organizer_ids.length > 0) {
      const coOrganizerIds = [...new Set(organizer_ids)]
        .filter((id: any) => typeof id === 'string' && id.trim().length > 0)
        .filter((id: string) => id !== req.userId);

      if (coOrganizerIds.length > 0) {
        const placeholders = coOrganizerIds.map(() => '?').join(', ');
        const existingUsers = await query(
          `SELECT id FROM users_extension WHERE id IN (${placeholders})`,
          coOrganizerIds
        );
        const existingSet = new Set(existingUsers.rows.map((row: any) => row.id));

        for (const coOrganizerId of coOrganizerIds) {
          if (!existingSet.has(coOrganizerId)) continue;
          await query(
            `INSERT IGNORE INTO tournament_organizers (tournament_id, user_id, created_by)
             VALUES (?, ?, ?)`,
            [tournamentId, coOrganizerId, req.userId]
          );
        }
      }
    }

    // Add allowed factions and maps for all tournament modes (ranked, unranked, team)
    for (const factionId of factionIds) {
      await query(
        `INSERT INTO tournament_unranked_factions (id, tournament_id, faction_id) VALUES (?, ?, ?)`,
        [randomUUID(), tournamentId, factionId]
      );
    }
    for (const mapId of mapIds) {
      await query(
        `INSERT INTO tournament_unranked_maps (id, tournament_id, map_id) VALUES (?, ?, ?)`,
        [randomUUID(), tournamentId, mapId]
      );
    }

    if (format_definition !== undefined) {
      await saveTournamentFormat(tournamentId, format_definition as TournamentFormatDefinition);
    }

    // Get organizer list (creator + co-organizers)
    let organizersDisplay = 'Unknown';
    try {
      const organizersResult = await query(
        `SELECT ue.nickname, MIN(orgs.sort_order) AS sort_order
         FROM (
           SELECT creator_id AS user_id, 0 AS sort_order
           FROM tournaments
           WHERE id = ?
           UNION ALL
           SELECT user_id, 1 AS sort_order
           FROM tournament_organizers
           WHERE tournament_id = ?
         ) orgs
         JOIN users_extension ue ON ue.id = orgs.user_id
         GROUP BY ue.id, ue.nickname
         ORDER BY sort_order ASC, ue.nickname ASC`,
        [tournamentId, tournamentId]
      );

      if (organizersResult.rows.length > 0) {
        organizersDisplay = organizersResult.rows.map((row: any) => row.nickname).join(', ');
      }
    } catch (userError) {
      console.warn('Could not fetch organizers list:', userError);
    }

    // Create Discord forum thread for the tournament
    try {
      const threadId = await discordService.createTournamentThread(
        tournamentId.toString(),
        name,
        tournament_type,
        organizersDisplay,
        description,
        resolvedRulesContent,
        scheduled_start_at || null
      );

      // Update tournament with Discord thread ID
      if (threadId) {
        await query(
          'UPDATE tournaments SET discord_thread_id = ? WHERE id = ?',
          [threadId, tournamentId]
        );

        // Post tournament created message to Discord
        await discordService.postTournamentCreated(
          threadId,
          name,
          tournament_type,
          description,
          organizersDisplay,
          max_participants,
          resolvedRulesContent,
          scheduled_start_at || null
        );
      }
    } catch (discordError) {
      console.error('Discord integration error:', discordError);
      // Don't fail the tournament creation if Discord fails
    }

    res.status(201).json({ 
      id: tournamentId,
      status: 'registration_open',
      message: 'Tournament created successfully. Registration is now open.' 
    });
  } catch (error: any) {
    console.error('Tournament creation error:', error.message || error);
    if (tournamentId) {
      // Creation spans several association tables. Compensating cleanup keeps a
      // failed request from leaving a partially configurable tournament.
      await query('DELETE FROM tournament_unranked_factions WHERE tournament_id = ?', [tournamentId]).catch(() => undefined);
      await query('DELETE FROM tournament_unranked_maps WHERE tournament_id = ?', [tournamentId]).catch(() => undefined);
      await query('DELETE FROM tournament_organizers WHERE tournament_id = ?', [tournamentId]).catch(() => undefined);
      await query('DELETE FROM tournaments WHERE id = ?', [tournamentId]).catch(() => undefined);
    }
    if (error.code === 'ER_DUP_ENTRY' && String(error.message).includes('forum_topic')) {
      return res.status(409).json({ error: 'This forum topic is already assigned to another tournament' });
    }
    if (error.issues) return res.status(400).json({ error: error.message, issues: error.issues });
    res.status(500).json({ error: 'Failed to create tournament', details: error.message });
  }
});

// Get tournaments managed by the current user - MUST be before /:id
router.get('/my', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const result = await query(
      `SELECT t.* FROM tournaments t
       WHERE t.creator_id = ?
          OR EXISTS (
            SELECT 1 FROM tournament_organizers tor
            WHERE tor.tournament_id = t.id AND tor.user_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM tournament_participants participant
            WHERE participant.tournament_id = t.id
              AND participant.user_id = ?
              AND participant.participation_status = 'accepted'
          )
       ORDER BY created_at DESC`,
      [userId, userId, userId]
    );

    // For each tournament, if status = 'finished', fetch winner and runner-up
    const tournaments = await Promise.all(result.rows.map(async (t: any) => {
      let winner_id = null, winner_nickname = null, runner_up_id = null, runner_up_nickname = null;
      
      if (t.status === 'finished') {
        const { winner, runnerUp } = await getTournamentPlacements(t.id);
        
        if (winner) {
          winner_id = winner.id;
          winner_nickname = winner.nickname;
        }
        if (runnerUp) {
          runner_up_id = runnerUp.id;
          runner_up_nickname = runnerUp.nickname;
        }
      }

      return {
        ...t,
        winner_id,
        winner_nickname,
        runner_up_id,
        runner_up_nickname
      };
    }));

    res.json(tournaments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch my tournaments' });
  }
});

// Get tournament
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query('SELECT * FROM tournaments WHERE id = ?', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
});

// List tournament organizers
router.get('/:id/organizers', async (req, res) => {
  try {
    const { id } = req.params;

    const tournamentResult = await query(
      'SELECT id, creator_id FROM tournaments WHERE id = ?',
      [id]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const organizerRows = await query(
      `SELECT DISTINCT ue.id AS user_id, ue.nickname
       FROM users_extension ue
       JOIN (
         SELECT creator_id AS user_id FROM tournaments WHERE id = ?
         UNION
         SELECT user_id FROM tournament_organizers WHERE tournament_id = ?
       ) organizers ON organizers.user_id = ue.id
       ORDER BY ue.nickname ASC`,
      [id, id]
    );

    res.json(organizerRows.rows);
  } catch (error) {
    console.error('List organizers error:', error);
    res.status(500).json({ error: 'Failed to list tournament organizers' });
  }
});

// Add tournament organizer (existing organizers only)
router.post('/:id/organizers', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const tournamentResult = await query(
      'SELECT id FROM tournaments WHERE id = ?',
      [id]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (!(await isTournamentOrganizer(id, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can manage organizers' });
    }

    const targetUser = await query(
      'SELECT id, nickname FROM users_extension WHERE id = ?',
      [user_id]
    );
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    await query(
      `INSERT IGNORE INTO tournament_organizers (tournament_id, user_id, created_by)
       VALUES (?, ?, ?)`,
      [id, user_id, req.userId]
    );

    res.status(201).json({
      message: 'Organizer added successfully',
      organizer: { user_id: targetUser.rows[0].id, nickname: targetUser.rows[0].nickname },
    });
  } catch (error: any) {
    console.error('Add organizer error:', error);
    res.status(500).json({ error: 'Failed to add tournament organizer', details: error.message });
  }
});

// Remove tournament organizer
router.delete('/:id/organizers/:organizerUserId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id, organizerUserId } = req.params;

    const tournamentResult = await query(
      'SELECT id, creator_id FROM tournaments WHERE id = ?',
      [id]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (!(await isTournamentOrganizer(id, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can manage organizers' });
    }

    const creatorId = tournamentResult.rows[0].creator_id;
    if (organizerUserId === creatorId) {
      return res.status(400).json({ error: 'Cannot remove tournament creator from organizers' });
    }

    const deleteResult = await query(
      'DELETE FROM tournament_organizers WHERE tournament_id = ? AND user_id = ?',
      [id, organizerUserId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Organizer not found for this tournament' });
    }

    res.json({ message: 'Organizer removed successfully' });
  } catch (error: any) {
    console.error('Remove organizer error:', error);
    res.status(500).json({ error: 'Failed to remove tournament organizer', details: error.message });
  }
});

// Update tournament configuration (organizer only)
router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const {
      tournament_type,
      description,
      max_participants,
      round_duration_days,
      auto_advance_round,
      general_rounds,
      final_rounds,
      general_rounds_format,
      final_rounds_format,
      scheduled_start_at,
      rules_template_id,
      rules_content,
      forum_topic_url,
      format_definition
    } = req.body;

    if ('status' in req.body || 'started_at' in req.body || 'tournament_mode' in req.body) {
      return res.status(400).json({
        error: 'Tournament mode, lifecycle status, and lifecycle timestamps cannot be changed through configuration updates'
      });
    }

    // Verify the user is the tournament creator
    const tournamentResult = await query(
      `SELECT creator_id, status, name, discord_thread_id, tournament_type, tournament_mode, max_participants,
              round_duration_days, auto_advance_round, general_rounds, final_rounds,
              general_rounds_format, final_rounds_format, scheduled_start_at
       FROM tournaments WHERE id = ?`,
      [id]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const organizer = await isTournamentOrganizer(id, req.userId!);
    if (!organizer) {
      return res.status(403).json({ error: 'Only tournament organizers can update this tournament' });
    }

    const currentTournament = tournamentResult.rows[0];
    const currentStatus = currentTournament.status;
    const effectiveTournamentType = tournament_type ?? currentTournament.tournament_type;
    const effectiveAutoAdvanceRound = effectiveTournamentType === 'league'
      ? false
      : (auto_advance_round ?? currentTournament.auto_advance_round);

    // Validate tournament_type change is only allowed in registration_open or registration_closed states
    if (tournament_type !== undefined && tournament_type !== currentTournament.tournament_type) {
      if (currentStatus !== 'registration_open' && currentStatus !== 'registration_closed') {
        return res.status(400).json({ 
          error: `Cannot change tournament format. Tournament format can only be changed when in registration_open or registration_closed state. Current status: ${currentStatus}` 
        });
      }
    }

    if (description !== undefined && (typeof description !== 'string' || !description.trim())) {
      return res.status(400).json({ error: 'Tournament description cannot be empty' });
    }

    const configurationError = validateTournamentConfiguration({
      tournament_type: effectiveTournamentType,
      tournament_mode: currentTournament.tournament_mode,
      max_participants: max_participants !== undefined ? max_participants : currentTournament.max_participants,
      round_duration_days: round_duration_days ?? currentTournament.round_duration_days,
      auto_advance_round: effectiveAutoAdvanceRound,
      general_rounds: general_rounds ?? currentTournament.general_rounds,
      final_rounds: final_rounds ?? currentTournament.final_rounds,
      general_rounds_format: general_rounds_format ?? currentTournament.general_rounds_format,
      final_rounds_format: final_rounds_format ?? currentTournament.final_rounds_format,
    });
    if (configurationError) {
      return res.status(400).json({ error: configurationError });
    }
    if (scheduled_start_at !== undefined) {
      if (currentStatus === 'in_progress' || currentStatus === 'finished') {
        return res.status(400).json({ error: 'Scheduled start cannot be changed after the tournament starts' });
      }
      if (scheduled_start_at !== null && Number.isNaN(Date.parse(scheduled_start_at))) {
        return res.status(400).json({ error: 'Invalid scheduled_start_at date' });
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let autoCopiedRulesContent: string | null = null;

    if (forum_topic_url !== undefined) {
      try {
        updates.push(`forum_topic_id = ?`);
        values.push(parseForumTopicUrl(forum_topic_url));
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    }

    if (tournament_type !== undefined) {
      updates.push(`tournament_type = ?`);
      values.push(tournament_type);
    }

    if (description !== undefined) {
      updates.push(`description = ?`);
      values.push(description.trim());
    }

    if (rules_template_id !== undefined) {
      if (rules_template_id === null || rules_template_id === '') {
        updates.push(`rules_template_id = ?`);
        values.push(null);
      } else {
        const templateResult = await query(
          `SELECT id, content_markdown, is_active
           FROM tournament_rule_templates
           WHERE id = ?`,
          [rules_template_id]
        );

        if (templateResult.rows.length === 0) {
          return res.status(400).json({ error: 'Selected rules template does not exist' });
        }

        if (templateResult.rows[0].is_active !== 1) {
          return res.status(400).json({ error: 'Selected rules template is not active' });
        }

        updates.push(`rules_template_id = ?`);
        values.push(rules_template_id);

        if (rules_content === undefined) {
          autoCopiedRulesContent = templateResult.rows[0].content_markdown || '';
        }
      }
    }

    if (rules_content !== undefined) {
      updates.push(`rules_content = ?`);
      values.push(rules_content);
    } else if (autoCopiedRulesContent !== null) {
      updates.push(`rules_content = ?`);
      values.push(autoCopiedRulesContent);
    }

    if (max_participants !== undefined) {
      updates.push(`max_participants = ?`);
      values.push(max_participants);
    }

    if (round_duration_days !== undefined) {
      updates.push(`round_duration_days = ?`);
      values.push(round_duration_days);
    }

    if (auto_advance_round !== undefined || effectiveTournamentType === 'league') {
      updates.push(`auto_advance_round = ?`, `auto_progress = ?`);
      values.push(effectiveAutoAdvanceRound, effectiveAutoAdvanceRound);
    }

    if (scheduled_start_at !== undefined) {
      updates.push(`scheduled_start_at = ?`);
      values.push(scheduled_start_at ? toMariaDbDateTime(scheduled_start_at) : null);
    }

    if (general_rounds !== undefined) {
      updates.push(`general_rounds = ?`);
      values.push(general_rounds);
    }

    if (final_rounds !== undefined) {
      updates.push(`final_rounds = ?`);
      values.push(final_rounds);
    }

    if (general_rounds_format !== undefined) {
      updates.push(`general_rounds_format = ?`);
      values.push(general_rounds_format);
    }

    if (final_rounds_format !== undefined) {
      updates.push(`final_rounds_format = ?`);
      values.push(final_rounds_format);
    }

    if (updates.length === 0 && format_definition === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const updateQuery = `
      UPDATE tournaments 
      SET ${updates.join(', ')} 
      WHERE id = ?
    `;

    await query(updateQuery, values);
    if (format_definition !== undefined) {
      await saveTournamentFormat(id, format_definition as TournamentFormatDefinition);
    }
    const updated = await query('SELECT * FROM tournaments WHERE id = ?', [id]);

    if (scheduled_start_at !== undefined) {
      const previousTime = tournamentDateTimeEpoch(currentTournament.scheduled_start_at);
      const updatedTime = tournamentDateTimeEpoch(scheduled_start_at);

      if (previousTime !== updatedTime && currentTournament.discord_thread_id) {
        try {
          await discordService.postScheduledStartChanged(
            currentTournament.discord_thread_id,
            currentTournament.name,
            currentTournament.scheduled_start_at,
            scheduled_start_at || null
          );
        } catch (discordError) {
          console.error('Discord planned-start notification error:', discordError);
        }
      }
    }

    res.json({
      message: 'Tournament updated successfully',
      tournament: updated.rows[0]
    });
  } catch (error: any) {
    console.error('Update tournament error:', error.message || error);
    res.status(500).json({ error: 'Failed to update tournament', details: error.message });
  }
});

/**
 * Replace the allowed faction and map sets while registration is configurable.
 * Empty arrays intentionally clear a set. The replacement is atomic so readers
 * never observe a tournament with only half of the requested asset update.
 */
router.put('/:id/assets', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { faction_ids, map_ids } = req.body;

    if (!Array.isArray(faction_ids) || !Array.isArray(map_ids) ||
        faction_ids.some((assetId) => typeof assetId !== 'string') ||
        map_ids.some((assetId) => typeof assetId !== 'string')) {
      return res.status(400).json({ error: 'faction_ids and map_ids must be arrays of identifiers' });
    }

    const uniqueFactionIds = [...new Set<string>(faction_ids)];
    const uniqueMapIds = [...new Set<string>(map_ids)];
    if (uniqueFactionIds.length !== faction_ids.length || uniqueMapIds.length !== map_ids.length) {
      return res.status(400).json({ error: 'Tournament assets cannot contain duplicate identifiers' });
    }

    const tournamentResult = await query(
      'SELECT tournament_mode, status FROM tournaments WHERE id = ?',
      [id]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentResult.rows[0];
    const organizer = await isTournamentOrganizer(id, req.userId!);
    const adminResult = organizer
      ? { rows: [] }
      : await query('SELECT is_admin FROM users_extension WHERE id = ?', [req.userId]);
    if (!organizer && !adminResult.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Not authorized to modify this tournament' });
    }
    if (!['registration_open', 'registration_closed'].includes(tournament.status)) {
      return res.status(400).json({ error: 'Tournament assets are locked after preparation' });
    }

    if (uniqueFactionIds.length > 0) {
      const placeholders = uniqueFactionIds.map(() => '?').join(', ');
      const assets = await query(
        `SELECT id, is_ranked FROM factions WHERE id IN (${placeholders}) AND is_active = 1`,
        uniqueFactionIds
      );
      if (assets.rows.length !== uniqueFactionIds.length ||
          (tournament.tournament_mode === 'ranked' && assets.rows.some((asset: any) => !asset.is_ranked))) {
        return res.status(400).json({ error: 'One or more factions are unavailable for this tournament mode' });
      }
    }

    if (uniqueMapIds.length > 0) {
      const placeholders = uniqueMapIds.map(() => '?').join(', ');
      const assets = await query(
        `SELECT id, is_ranked FROM game_maps WHERE id IN (${placeholders}) AND is_active = 1`,
        uniqueMapIds
      );
      if (assets.rows.length !== uniqueMapIds.length ||
          (tournament.tournament_mode === 'ranked' && assets.rows.some((asset: any) => !asset.is_ranked))) {
        return res.status(400).json({ error: 'One or more maps are unavailable for this tournament mode' });
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM tournament_unranked_factions WHERE tournament_id = ?', [id]);
      await connection.execute('DELETE FROM tournament_unranked_maps WHERE tournament_id = ?', [id]);
      for (const factionId of uniqueFactionIds) {
        await connection.execute(
          'INSERT INTO tournament_unranked_factions (id, tournament_id, faction_id) VALUES (?, ?, ?)',
          [randomUUID(), id, factionId]
        );
      }
      for (const mapId of uniqueMapIds) {
        await connection.execute(
          'INSERT INTO tournament_unranked_maps (id, tournament_id, map_id) VALUES (?, ?, ?)',
          [randomUUID(), id, mapId]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    res.json({ message: 'Tournament assets updated successfully' });
  } catch (error) {
    console.error('Update tournament assets error:', error);
    res.status(500).json({ error: 'Failed to update tournament assets' });
  }
});

// Delete tournament before it starts. Administrators can remove any eligible
// tournament from Manage Tournaments; regular users remain limited to their
// own tournaments or tournaments where they are organizers.
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify tournament exists and user is organizer
    const tournamentCheck = await query(
      `SELECT id, creator_id, status, name, discord_thread_id, competition_model_version
       FROM tournaments WHERE id = ?`,
      [id]
    );
    if (tournamentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentCheck.rows[0];

    if (Number(tournament.competition_model_version) !== 2) {
      return res.status(400).json({ error: 'Only phase-engine tournaments can be deleted' });
    }

    const isOrganizer = await isTournamentOrganizer(id, req.userId!);
    const adminResult = await query(
      'SELECT is_admin FROM users_extension WHERE id = ?',
      [req.userId]
    );
    const isAdmin = !!adminResult.rows[0]?.is_admin;

    if (!isOrganizer && !isAdmin) {
      return res.status(403).json({ error: 'Only tournament organizers or admins can cancel tournament' });
    }

    // Verify tournament is not in progress or finished
    if (tournament.status === 'in_progress' || tournament.status === 'finished') {
      return res.status(400).json({ error: 'Cannot cancel tournament that is in progress or finished' });
    }

    let cancelledByNickname = 'Unknown';
    try {
      const userResult = await query('SELECT nickname FROM users_extension WHERE id = ?', [req.userId]);
      if (userResult.rows.length > 0) {
        cancelledByNickname = userResult.rows[0].nickname;
      }
    } catch (userError) {
      console.warn('Could not fetch canceller nickname:', userError);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await deleteTournamentRecords(connection, id);
      await connection.commit();
    } catch (innerError) {
      await connection.rollback();
      throw innerError;
    } finally {
      connection.release();
    }

    if (tournament.discord_thread_id) {
      try {
        await discordService.postTournamentCancelled(
          tournament.discord_thread_id,
          tournament.name,
          cancelledByNickname
        );
      } catch (discordError) {
        console.error('Discord tournament cancel notification error:', discordError);
      }
    }

    res.json({
      message: 'Tournament cancelled successfully',
      tournament_id: id
    });
  } catch (error: any) {
    console.error('Delete tournament error:', error.message || error);
    res.status(500).json({ error: 'Failed to cancel tournament', details: error.message });
  }
});

// Get tournament rounds
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM tournaments 
       WHERE status IN ('approved', 'in_progress', 'finished')
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
});

// Request to join tournament (creates pending participant)
router.post('/:id/request-join', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { team_name, teammate_name } = req.body;
    // Registration is authoritative in the backend; hiding the action in the
    // public page is not sufficient to protect closed or full tournaments.
    const tournamentResult = await query(
      `SELECT id, discord_thread_id, max_participants, tournament_mode, creator_id, status
       FROM tournaments WHERE id = ?`,
      [id]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentResult.rows[0];
    if (tournament.status !== 'registration_open') {
      return res.status(400).json({ error: 'Tournament registration is not open' });
    }

    if (tournament.tournament_mode === 'ranked') {
      const rankedEligibility = await query(
        'SELECT enable_ranked FROM users_extension WHERE id = ?',
        [req.userId]
      );
      if (!rankedEligibility.rows[0]?.enable_ranked) {
        return res.status(400).json({ error: 'Enable ranked matches in your profile before joining this tournament' });
      }
    }

    const isOrganizer = await isTournamentOrganizer(id, req.userId!);
    const participationStatus = isOrganizer ? 'accepted' : 'pending';
    let teamId: string | null = null;

    // If team tournament, handle team logic
    if (tournament.tournament_mode === 'team') {
      // Team name is required
      if (typeof team_name !== 'string' || !team_name.trim()) {
        return res.status(400).json({ error: 'Team name required for team tournament' });
      }

      const normalizedTeamName = team_name.trim();
      if (normalizedTeamName.length < 2 || normalizedTeamName.length > 50) {
        return res.status(400).json({ error: 'Team name must be between 2 and 50 characters' });
      }

      // Get current user's info
      const currentUserResult = await query('SELECT nickname FROM users_extension WHERE id = ?', [req.userId]);
      if (currentUserResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const currentUserNickname = currentUserResult.rows[0].nickname;

      // Check if current user is already in this tournament
      const userAlreadyInResult = await query(
        `SELECT id FROM tournament_participants 
         WHERE tournament_id = ? AND user_id = ? AND participation_status IN ('pending', 'unconfirmed', 'accepted')`,
        [id, req.userId]
      );
      if (userAlreadyInResult.rows.length > 0) {
        return res.status(400).json({ error: 'You are already registered in this tournament' });
      }

      // Check if trying to add self as teammate
      if (teammate_name && teammate_name.toLowerCase() === currentUserNickname.toLowerCase()) {
        return res.status(400).json({ error: 'You cannot select yourself as a teammate' });
      }

      // Check if trying to use reserved team name
      if (isReservedTeamName(normalizedTeamName)) {
        return res.status(400).json({ error: 'Team name is reserved and cannot be used' });
      }

      let teammateUserId: string | null = null;

      // If teammate provided, validate and get their ID
      if (teammate_name) {
        const teammateResult = await query(
          'SELECT id FROM users_extension WHERE LOWER(nickname) = LOWER(?)',
          [teammate_name]
        );
        if (teammateResult.rows.length === 0) {
          return res.status(400).json({ error: `User "${teammate_name}" not found` });
        }
        teammateUserId = teammateResult.rows[0].id;

        // Check if teammate is already in this tournament
        const existingParticipantResult = await query(
          `SELECT id FROM tournament_participants 
           WHERE tournament_id = ? AND user_id = ? AND participation_status IN ('pending', 'unconfirmed', 'accepted')`,
          [id, teammateUserId]
        );
        if (existingParticipantResult.rows.length > 0) {
          return res.status(400).json({ error: `${teammate_name} is already registered in this tournament` });
        }
      }

      // Try to find existing team with this name and exactly 1 member (excluding Rejected players team)
      const existingTeamResult = await query(
        `SELECT tt.id, COUNT(tp.id) as member_count
         FROM tournament_teams tt
         LEFT JOIN tournament_participants tp ON tt.id = tp.team_id AND tp.participation_status IN ('pending', 'unconfirmed', 'accepted')
         WHERE tt.tournament_id = ? AND LOWER(tt.name) = LOWER(?) AND tt.id != ?
         GROUP BY tt.id
         HAVING COUNT(tp.id) = 1`,
        [id, normalizedTeamName, REJECTED_TEAM_ID]
      );

      if (existingTeamResult.rows.length > 0) {
        if (teammateUserId) {
          return res.status(400).json({ error: 'An existing team has only one available slot; join it without inviting another teammate' });
        }
        // Join existing team
        teamId = existingTeamResult.rows[0].id;

        // Current user joins as Position 2
        await query(
          `INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status, team_id, team_position)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), id, req.userId, participationStatus, teamId, 2]
        );
        console.log('Player joined team at position 2');

      } else {
        // Check if team already exists with max members (excluding Rejected players team)
        const fullTeamResult = await query(
          `SELECT tt.id
           FROM tournament_teams tt
           LEFT JOIN tournament_participants tp ON tt.id = tp.team_id AND tp.participation_status IN ('pending', 'unconfirmed', 'accepted')
           WHERE tt.tournament_id = ? AND LOWER(tt.name) = LOWER(?) AND tt.id != ?
           GROUP BY tt.id
           HAVING COUNT(tp.id) >= 2`,
          [id, normalizedTeamName, REJECTED_TEAM_ID]
        );

        if (fullTeamResult.rows.length > 0) {
          return res.status(400).json({ error: `Team "${normalizedTeamName}" is already full (2/2 members)` });
        }

        if (tournament.max_participants) {
          const teamCountResult = await query(
            `SELECT COUNT(*) AS count FROM tournament_teams
             WHERE tournament_id = ? AND id != ?`,
            [id, REJECTED_TEAM_ID]
          );
          if (Number(teamCountResult.rows[0]?.count || 0) >= tournament.max_participants) {
            return res.status(400).json({ error: 'Tournament has reached its team capacity' });
          }
        }

        // Create new team with safe UUID (avoiding REJECTED_TEAM_ID collision)
        const newTeamId = await generateSafeTeamId();
        const createTeamResult = await query(
          `INSERT INTO tournament_teams (id, tournament_id, name, created_by)
           VALUES (?, ?, ?, ?)`,
          [newTeamId, id, normalizedTeamName, req.userId]
        );
        teamId = newTeamId;
        console.log('New team created:', { teamId, name: team_name });

        // Insert current user as Position 1
        await query(
          `INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status, team_id, team_position)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), id, req.userId, participationStatus, teamId, 1]
        );
        console.log('Player 1 added to new team');

        // If teammate provided, insert as Position 2 (unconfirmed - needs their confirmation)
        if (teammateUserId) {
          await query(
            `INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status, team_id, team_position)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [randomUUID(), id, teammateUserId, 'unconfirmed', teamId, 2]
          );
          console.log('Player 2 (teammate) added as unconfirmed - awaiting confirmation');
        }
      }
    }

    // Get user's ELO rating and nickname
    const userResult = await query('SELECT elo_rating, nickname FROM users_extension WHERE id = ?', [req.userId]);
    if (userResult.rows.length === 0) {
      console.log('User not found:', req.userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // For non-team tournaments, insert as pending participant (existing logic)
    if (tournament.tournament_mode !== 'team') {
      if (tournament.max_participants) {
        const participantCountResult = await query(
          `SELECT COUNT(*) AS count FROM tournament_participants
           WHERE tournament_id = ?
             AND participation_status IN ('pending', 'unconfirmed', 'accepted')`,
          [id]
        );
        if (Number(participantCountResult.rows[0]?.count || 0) >= tournament.max_participants) {
          return res.status(400).json({ error: 'Tournament has reached its participant capacity' });
        }
      }
      await query(
        `INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status)
         VALUES (?, ?, ?, ?)`,
        [randomUUID(), id, req.userId, participationStatus]
      );
    }

    // Get current participant count
    const countResult = await query(
      `SELECT COUNT(*) as count FROM tournament_participants 
       WHERE tournament_id = ? AND participation_status IN ('pending', 'unconfirmed', 'accepted')`,
      [id]
    );
    const currentCount = countResult.rows[0]?.count || 0;

    // Post to Discord if thread exists
    if (tournament.discord_thread_id) {
      try {
        let displayName = userResult.rows[0].nickname;
        
        if (tournament.tournament_mode === 'team') {
          if (teammate_name) {
            displayName = `${displayName} & ${teammate_name} (Team: ${team_name})`;
          } else {
            displayName = `${displayName} (Team: ${team_name})`;
          }
        }
        
        await discordService.postPlayerRegistered(
          tournament.discord_thread_id,
          displayName,
          currentCount,
          tournament.max_participants
        );
      } catch (discordError) {
        console.error('Discord notification error:', discordError);
        // Don't fail the request if Discord fails
      }
    }

    res.status(201).json({ 
      team_id: teamId,
      message: tournament.tournament_mode === 'team' 
        ? 'Team created! Both players are pending organizer approval.'
        : 'Join request sent. Waiting for organizer approval.'
    });
  } catch (error: any) {
    console.error('Request-join error:', error.message || error);
    console.error('Full error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Already requested to join this tournament' });
    }
    res.status(500).json({ error: 'Failed to request join tournament', details: error.message });
  }
});

// Accept participant (organizer only)
router.post('/:tournamentId/participants/:participantId/accept', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tournamentId, participantId } = req.params;

    // Verify the user is the tournament creator
    const tournamentResult = await query(
      'SELECT creator_id, discord_thread_id FROM tournaments WHERE id = ?',
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (!(await isTournamentOrganizer(tournamentId, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can accept participants' });
    }

    // Get participant info
    const participantResult = await query(
      `SELECT tp.*, u.nickname FROM tournament_participants tp
       LEFT JOIN users_extension u ON tp.user_id = u.id
       WHERE tp.id = ? AND tp.tournament_id = ?`,
      [participantId, tournamentId]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const participant = participantResult.rows[0];

    // Can only accept pending participants
    // Unconfirmed participants must first confirm (change to pending) before organizer can accept
    if (participant.participation_status !== 'pending') {
      return res.status(400).json({ 
        error: `Can only accept pending participants. This participant is ${participant.participation_status}. ` +
               (participant.participation_status === 'unconfirmed' ? 'They must confirm their participation first.' : '')
      });
    }

    // Update participant status to accepted
    await query(
      `UPDATE tournament_participants 
       SET participation_status = ? 
       WHERE id = ? AND tournament_id = ?`,
      ['accepted', participantId, tournamentId]
    );

    const acceptedCheck = await query(
      'SELECT id FROM tournament_participants WHERE id = ? AND tournament_id = ?',
      [participantId, tournamentId]
    );

    if (acceptedCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // Get total accepted participants for Discord message
    const countResult = await query(
      `SELECT COUNT(*) as count FROM tournament_participants 
       WHERE tournament_id = ? AND participation_status = 'accepted'`,
      [tournamentId]
    );
    const totalAccepted = countResult.rows[0]?.count || 0;

    // Post to Discord if thread exists
    if (tournamentResult.rows[0].discord_thread_id) {
      try {
        await discordService.postPlayerAccepted(
          tournamentResult.rows[0].discord_thread_id,
          participant.nickname,
          totalAccepted
        );
      } catch (discordError) {
        console.error('Discord notification error:', discordError);
        // Don't fail the request if Discord fails
      }
    }

    res.json({ 
      id: participantId,
      message: 'Participant accepted successfully'
    });
  } catch (error: any) {
    console.error('Accept participant error:', error.message || error);
    res.status(500).json({ error: 'Failed to accept participant', details: error.message });
  }
});

// Confirm participation (player confirms unconfirmed status - typically second team member)
router.post('/:tournamentId/participants/:participantId/confirm', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tournamentId, participantId } = req.params;

    // Get participant info
    const participantResult = await query(
      `SELECT tp.*, u.nickname FROM tournament_participants tp
       LEFT JOIN users_extension u ON tp.user_id = u.id
       WHERE tp.id = ? AND tp.tournament_id = ?`,
      [participantId, tournamentId]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const participant = participantResult.rows[0];

    // Only the participant themselves can confirm
    if (participant.user_id !== req.userId) {
      return res.status(403).json({ error: 'You can only confirm your own participation' });
    }

    // Can only confirm if status is unconfirmed
    if (participant.participation_status !== 'unconfirmed') {
      return res.status(400).json({ error: 'Can only confirm unconfirmed participants. Current status: ' + participant.participation_status });
    }

    // Check if this is a substitute (has requested_replacement_of_id)
    if (participant.requested_replacement_of_id) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [replacementRows] = await connection.execute<any[]>(
          `SELECT id, team_position FROM tournament_participants
           WHERE id = ? AND participation_status = 'pending_replacement'
           FOR UPDATE`,
          [participant.requested_replacement_of_id]
        );

        if (replacementRows.length === 0) {
          await connection.rollback();
          return res.status(400).json({ error: 'Original team member not found' });
        }

        const originalParticipant = replacementRows[0];
        await connection.execute(
          `UPDATE tournament_participants
           SET participation_status = 'accepted', team_position = ?
           WHERE id = ? AND participation_status = 'unconfirmed'`,
          [originalParticipant.team_position, participantId]
        );
        await connection.execute(
          `UPDATE tournament_participants
           SET participation_status = 'replaced', replaced_by_participant_id = ?,
               team_position = NULL, team_id = ?
           WHERE id = ? AND participation_status = 'pending_replacement'`,
          [participantId, REJECTED_TEAM_ID, originalParticipant.id]
        );
        await connection.commit();
      } catch (replacementError) {
        await connection.rollback();
        throw replacementError;
      } finally {
        connection.release();
      }

      return res.json({ 
        id: participantId,
        message: 'Replacement confirmed! You are now an active team member.'
      });
    }

    // Regular participant confirmation (not a substitute)
    // Update participant status from unconfirmed to pending
    await query(
      `UPDATE tournament_participants 
       SET participation_status = ? 
       WHERE id = ? AND tournament_id = ?`,
      ['pending', participantId, tournamentId]
    );

    const confirmedCheck = await query(
      'SELECT id FROM tournament_participants WHERE id = ? AND tournament_id = ?',
      [participantId, tournamentId]
    );

    if (confirmedCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    res.json({ 
      id: participantId,
      message: 'Participation confirmed! Waiting for organizer approval.'
    });
  } catch (error: any) {
    console.error('Confirm participant error:', error.message || error);
    res.status(500).json({ error: 'Failed to confirm participation', details: error.message });
  }
});

// Reject participant (organizer only)
router.post('/:tournamentId/participants/:participantId/reject', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tournamentId, participantId } = req.params;

    // Verify the user is the tournament creator
    const tournamentResult = await query(
      'SELECT creator_id, discord_thread_id FROM tournaments WHERE id = ?',
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (!(await isTournamentOrganizer(tournamentId, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can reject participants' });
    }

    // Get participant info including nickname
    const participantResult = await query(
      `SELECT tp.*, u.nickname FROM tournament_participants tp
       LEFT JOIN users_extension u ON tp.user_id = u.id
       WHERE tp.id = ? AND tp.tournament_id = ?`,
      [participantId, tournamentId]
    );

    if (participantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const participant = participantResult.rows[0];

    // Get or create "Rejected players" system team with special UUID
    const rejectedTeamResult = await query(
      `SELECT id FROM tournament_teams 
       WHERE id = ?`,
      [REJECTED_TEAM_ID]
    );

    let rejectedTeamId: string;
    if (rejectedTeamResult.rows.length === 0) {
      // Create the "Rejected players" system team with special UUID
      await query(
        `INSERT INTO tournament_teams (id, tournament_id, name, created_by)
         VALUES (?, ?, ?, ?)`,
        [REJECTED_TEAM_ID, tournamentId, 'Rejected players', tournamentResult.rows[0].creator_id]
      );
      rejectedTeamId = REJECTED_TEAM_ID;
    } else {
      rejectedTeamId = rejectedTeamResult.rows[0].id;
    }

    // Store the original team_id to check if it becomes empty after rejection
    const originalTeamId = participant.team_id;

    // If the rejected participant is in a team, check if there's another player and move them to position 1
    if (originalTeamId && originalTeamId !== REJECTED_TEAM_ID) {
      const otherTeamMembersResult = await query(
        `SELECT id, team_position FROM tournament_participants 
         WHERE team_id = ? AND id != ? AND participation_status IN ('pending', 'unconfirmed', 'accepted')`,
        [originalTeamId, participantId]
      );

      // If there's another active member, move them to position 1
      if (otherTeamMembersResult.rows.length > 0) {
        const otherMember = otherTeamMembersResult.rows[0];
        if (otherMember.team_position !== 1) {
          await query(
            `UPDATE tournament_participants 
             SET team_position = 1
             WHERE id = ?`,
            [otherMember.id]
          );
          console.log(`Moved teammate ${otherMember.id} to position 1 after rejection`);
        }
      }
    }

    // Update participant: change team to rejected team, update status to denied
    // For rejected players, set team_position to NULL (not a real team)
    await query(
      `UPDATE tournament_participants 
       SET participation_status = ?, team_id = ?, team_position = ?
       WHERE id = ? AND tournament_id = ?`,
      ['denied', rejectedTeamId, null, participantId, tournamentId]
    );

    const rejectedCheck = await query(
      'SELECT id FROM tournament_participants WHERE id = ? AND tournament_id = ?',
      [participantId, tournamentId]
    );

    if (rejectedCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // Check if the original team is now empty and delete it if so
    if (originalTeamId && originalTeamId !== REJECTED_TEAM_ID) {
      const remainingMembersResult = await query(
        `SELECT COUNT(*) as count FROM tournament_participants 
         WHERE team_id = ? AND participation_status IN ('pending', 'unconfirmed', 'accepted')`,
        [originalTeamId]
      );

      if (remainingMembersResult.rows[0].count === '0' || remainingMembersResult.rows[0].count === 0) {
        await query(
          `DELETE FROM tournament_teams WHERE id = ?`,
          [originalTeamId]
        );
        console.log(`Deleted empty team ${originalTeamId} after rejecting last member`);
      }
    }

    // Post to Discord if thread exists
    if (tournamentResult.rows[0].discord_thread_id) {
      try {
        // Simple notification about rejection
        const embed = {
          title: '❌ Participante Rechazado',
          description: `**${participant.nickname}** ha sido rechazado del torneo.`,
          color: 0xe74c3c,
          footer: {
            text: 'Participante rechazado',
          },
          timestamp: new Date().toISOString(),
        };
        await discordService.publishTournamentMessage(
          tournamentResult.rows[0].discord_thread_id,
          { embeds: [embed] }
        );
      } catch (discordError) {
        console.error('Discord notification error:', discordError);
        // Don't fail the request if Discord fails
      }
    }

    res.json({ 
      id: participantId,
      message: 'Participant rejected successfully'
    });
  } catch (error: any) {
    console.error('Reject participant error:', error.message || error);
    res.status(500).json({ error: 'Failed to reject participant', details: error.message });
  }
});

// Get tournament ranking
router.get('/:id/ranking', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT tp.*, u.nickname, u.elo_rating 
       FROM tournament_participants tp
       LEFT JOIN users_extension u ON tp.user_id = u.id
       WHERE tp.tournament_id = ?
       ORDER BY tp.tournament_points DESC, tp.tournament_wins DESC, u.elo_rating DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tournament ranking' });
  }
});

// Close registration and prepare tournament
router.post('/:id/close-registration', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { confirm } = req.body; // confirm = true if user confirmed deletion

    // Verify tournament creator
    const tournamentCheck = await query(
      'SELECT creator_id, status, discord_thread_id, name, tournament_type, tournament_mode, max_participants, total_rounds, scheduled_start_at FROM tournaments WHERE id = ?',
      [id]
    );
    if (tournamentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentCheck.rows[0];
    if (!(await isTournamentOrganizer(id, req.userId!))) {
      return res.status(403).json({ error: 'Only tournament organizers can close registration' });
    }

    if (tournament.status !== 'registration_open') {
      return res.status(400).json({ error: 'Tournament registration is not open' });
    }

    // Check participants based on tournament mode
    let participantCount = 0;
    let incompleteParticipants = false;
    let teamRows: any[] = [];
    let completeTeamIds: Set<string> | null = null;
    
    if (tournament.tournament_mode === 'team') {
      // For team tournaments: count complete teams (all members accepted)
      const teamsCheckResult = await query(
        `SELECT tt.id,
                COALESCE(SUM(CASE WHEN tp.participation_status IN ('accepted', 'pending_replacement') THEN 1 ELSE 0 END), 0) as competitive_count
         FROM tournament_teams tt
         LEFT JOIN tournament_participants tp ON tt.id = tp.team_id
         WHERE tt.tournament_id = ?
         GROUP BY tt.id`,
        [id]
      );
      teamRows = teamsCheckResult.rows;

      // During a pending substitution the outgoing member remains competitive
      // until the replacement is confirmed; the unconfirmed substitute does not.
      const completeTeams = teamsCheckResult.rows.filter((team: any) => {
        return Number(team.competitive_count) === 2;
      });

      participantCount = completeTeams.length;

      completeTeamIds = new Set(completeTeams.map((team: any) => team.id));

      // For team tournaments, require at least 2 complete teams
      if (participantCount < 2) {
        incompleteParticipants = true;
        // If not confirmed, ask for confirmation
        if (!confirm) {
          return res.status(200).json({ 
            action: 'confirm_delete',
            message: `Team tournaments require at least 2 complete teams. Currently have ${participantCount} complete team(s). Delete tournament?`,
            requiresConfirmation: true
          });
        }
        // If confirmed, proceed to delete tournament
      }
    } else {
      // For 1v1 tournaments: count accepted individual participants
      const participantsCheck = await query(
        'SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = ? AND participation_status = ?',
        [id, 'accepted']
      );

      participantCount = parseInt(participantsCheck.rows[0].count, 10);

      console.log(`[CLOSE_REGISTRATION] 1v1 tournament: ${participantCount} accepted participants`);

      // For 1v1 tournaments, require at least 2 participants
      if (participantCount < 2) {
        incompleteParticipants = true;
        // If not confirmed, ask for confirmation
        if (!confirm) {
          return res.status(200).json({ 
            action: 'confirm_delete',
            message: `Tournaments require at least 2 participants. Currently have ${participantCount} participant(s). Delete tournament?`,
            requiresConfirmation: true
          });
        }
        // If confirmed, proceed to delete tournament
      }
    }

    // If insufficient participants or incomplete team tournament (after confirmation)
    if (incompleteParticipants) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await deleteTournamentRecords(connection, id);
        await connection.commit();
      } catch (deleteError) {
        await connection.rollback();
        throw deleteError;
      } finally {
        connection.release();
      }

      return res.status(200).json({ 
        action: 'deleted',
        message: 'Tournament deleted successfully (insufficient participants)'
      });
    }

    if (completeTeamIds) {
      for (const team of teamRows) {
        await query(
          'UPDATE tournament_teams SET status = ? WHERE id = ? AND tournament_id = ?',
          [completeTeamIds.has(team.id) ? 'active' : 'eliminated', team.id, id]
        );
      }
    }

    // Calculate total_rounds for elimination tournaments if not already set
    let totalRounds = tournament.total_rounds || 0;
    if (tournament.tournament_type.toLowerCase() === 'elimination' && totalRounds === 0) {
      totalRounds = Math.ceil(Math.log2(participantCount));
    }

    // If has participants, close registration normally
    await query(
      `UPDATE tournaments 
       SET status = ?, registration_closed_at = NOW(), total_rounds = ?
       WHERE id = ?`,
      ['registration_closed', totalRounds, id]
    );

    // Post to Discord if thread exists
    if (tournament.discord_thread_id) {
      try {
        await discordService.postRegistrationClosed(
          tournament.discord_thread_id,
          participantCount,
          tournament.scheduled_start_at
        );
      } catch (discordError) {
        console.error('Discord notification error:', discordError);
        // Don't fail the request if Discord fails
      }
    }

    res.json({ 
      action: 'closed',
      message: 'Registration closed successfully',
      next_step: 'Prepare tournament by configuring rounds before starting'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to close registration' });
  }
});

router.put('/:tournamentId/teams/:teamId/rename', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tournamentId, teamId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Team name cannot be empty' });
    }

    // Fetch tournament and team
    const [tournResult, teamResult] = await Promise.all([
      query(`SELECT id, creator_id FROM tournaments WHERE id = ?`, [tournamentId]),
      query(`SELECT id, name FROM tournament_teams WHERE id = ? AND tournament_id = ?`, [teamId, tournamentId]),
    ]);

    if (tournResult.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });
    if (teamResult.rows.length === 0) return res.status(404).json({ error: 'Team not found' });

    const tournament = tournResult.rows[0];
    const userId = req.userId!;
    const username = req.username!;

    // Check if requester is organizer
    const isOrganizer = await isTournamentOrganizer(tournamentId, userId);

    // Check if requester is a team member
    const memberResult = await query(
      `SELECT tp.id FROM tournament_participants tp WHERE tp.user_id = ? AND tp.team_id = ? LIMIT 1`,
      [userId, teamId]
    );
    const isTeamMember = memberResult.rows.length > 0;

    // Check admin
    const adminResult = await query(`SELECT is_admin FROM users_extension WHERE id = ?`, [userId]);
    const isAdmin = adminResult.rows[0]?.is_admin;

    // Check moderator
    const isModerator = !isOrganizer && !isTeamMember && !isAdmin
      ? await checkUserIsForumModerator(username)
      : false;

    if (!isOrganizer && !isTeamMember && !isAdmin && !isModerator) {
      return res.status(403).json({ error: 'Not authorized to rename this team' });
    }

    await query(`UPDATE tournament_teams SET name = ? WHERE id = ?`, [name.trim(), teamId]);

    await logAuditEvent({
      event_type: 'TEAM_RENAMED',
      user_id: userId,
      ip_address: getUserIP(req),
      user_agent: getUserAgent(req),
      details: { tournament_id: tournamentId, team_id: teamId, old_name: teamResult.rows[0].name, new_name: name.trim() }
    });

    res.json({ message: 'Team renamed successfully', name: name.trim() });
  } catch (error) {
    console.error('Error renaming team:', error);
    res.status(500).json({ error: 'Failed to rename team' });
  }
});

// ─────────────────────────────────────────────────────────────
// Remove participant from tournament (before tournament starts)
// Allowed: the participant themselves, organizer, moderator, admin
// For team tournaments: deletes team if all members are removed
// ─────────────────────────────────────────────────────────────
router.delete('/:tournamentId/participants/:participantId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tournamentId, participantId } = req.params;
    const userId = req.userId!;
    const username = req.username!;

    // Fetch tournament
    const tournResult = await query(
      `SELECT id, creator_id, status FROM tournaments WHERE id = ?`,
      [tournamentId]
    );
    if (tournResult.rows.length === 0) return res.status(404).json({ error: 'Tournament not found' });

    const tournament = tournResult.rows[0];
    if (['in_progress', 'finished'].includes(tournament.status)) {
      return res.status(400).json({ error: 'Cannot remove participants from a tournament that has already started' });
    }

    // Fetch participant
    const participantResult = await query(
      `SELECT tp.id, tp.user_id, tp.team_id, ue.nickname
       FROM tournament_participants tp
       JOIN users_extension ue ON tp.user_id = ue.id
       WHERE tp.id = ? AND tp.tournament_id = ?`,
      [participantId, tournamentId]
    );
    if (participantResult.rows.length === 0) return res.status(404).json({ error: 'Participant not found' });

    const participant = participantResult.rows[0];
    const isSelf = participant.user_id === userId;
    const isOrganizer = await isTournamentOrganizer(tournamentId, userId);

    const adminResult = await query(`SELECT is_admin FROM users_extension WHERE id = ?`, [userId]);
    const isAdmin = adminResult.rows[0]?.is_admin;

    const isModerator = !isSelf && !isOrganizer && !isAdmin
      ? await checkUserIsForumModerator(username)
      : false;

    if (!isSelf && !isOrganizer && !isAdmin && !isModerator) {
      return res.status(403).json({ error: 'Not authorized to remove this participant' });
    }

    // Remove participant
    await query(`DELETE FROM tournament_participants WHERE id = ?`, [participantId]);

    // For team tournaments: check if team is now empty and delete if so
    if (participant.team_id) {
      const remainingMembers = await query(
        `SELECT COUNT(*) as count FROM tournament_participants WHERE team_id = ?`,
        [participant.team_id]
      );
      if (parseInt(remainingMembers.rows[0].count) === 0) {
        await query(`DELETE FROM tournament_teams WHERE id = ?`, [participant.team_id]);
      }
    }

    await logAuditEvent({
      event_type: 'PARTICIPANT_REMOVED',
      user_id: userId,
      ip_address: getUserIP(req),
      user_agent: getUserAgent(req),
      details: {
        tournament_id: tournamentId,
        participant_id: participantId,
        removed_user_id: participant.user_id,
        removed_nickname: participant.nickname,
        team_id: participant.team_id || null,
      }
    });

    res.json({ message: 'Participant removed successfully', participant_id: participantId });
  } catch (error) {
    console.error('Error removing participant:', error);
    res.status(500).json({ error: 'Failed to remove participant' });
  }
});

export default router;
