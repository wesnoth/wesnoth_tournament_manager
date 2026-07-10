import { Router } from 'express';
import { query } from '../config/database.js';
import { authMiddleware, moderatorOrAdminMiddleware, AuthRequest } from '../middleware/auth.js';
import { activateRound, checkAndCompleteRound, getWinnerAndRunnerUp, preGenerateLeagueMatches } from '../utils/tournament.js';
import discordService from '../services/discordService.js';
import { randomUUID } from 'crypto';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';
import { checkUserIsForumModerator } from '../services/phpbbAuth.js';

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
      rules_template_id,
      rules_content,
      unranked_factions,
      unranked_maps
    } = req.body;

    // Validation
    if (!name || !description || !tournament_type) {
      return res.status(400).json({ error: 'Missing required fields: name, description, tournament_type' });
    }

    // max_participants is now optional - can be set during tournament preparation
    // If provided, must be greater than 0
    if (max_participants !== null && max_participants !== undefined && max_participants <= 0) {
      return res.status(400).json({ error: 'Max participants must be greater than 0 if provided' });
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
    const tournamentId = randomUUID();

    // Create tournament
    const tournamentResult = await query(
      `INSERT INTO tournaments (
        id, name, description, rules_template_id, rules_content, creator_id, tournament_type, tournament_mode,
        max_participants, round_duration_days, auto_advance_round, 
        total_rounds, general_rounds, final_rounds,
        general_rounds_format, final_rounds_format,
        status, current_round
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       `,
      [
        tournamentId,
        name, 
        description,
        selectedTemplateId,
        resolvedRulesContent,
        req.userId, 
        tournament_type,
        tournament_mode || 'ranked',
        max_participants, 
        round_duration_days || 7,
        auto_advance_round || false,
        totalRounds,
        tournamentTypeLower === 'elimination' ? 0 : (general_rounds || 0),
        tournamentTypeLower === 'elimination' ? 0 : (final_rounds || 0),
        general_rounds_format || 'bo3',
        final_rounds_format || 'bo5',
        'registration_open',
        0
      ]
    );

    // Add allowed factions and maps for all tournament modes (ranked, unranked, team)
    if (unranked_factions || unranked_maps) {
      try {
        console.log(`Adding assets to tournament ${tournamentId}:`, {
          factions_count: unranked_factions?.length || 0,
          maps_count: unranked_maps?.length || 0,
          factions: unranked_factions,
          maps: unranked_maps
        });

        // Add factions
        if (unranked_factions && Array.isArray(unranked_factions)) {
          for (const faction of unranked_factions) {
            const factionId = faction.id || faction;
            console.log(`Inserting faction ${factionId} into tournament ${tournamentId}`);
            await query(
              `INSERT IGNORE INTO tournament_unranked_factions (tournament_id, faction_id)
               VALUES (?, ?)`,
              [tournamentId, factionId]
            );
          }
        }

        // Add maps
        if (unranked_maps && Array.isArray(unranked_maps)) {
          for (const map of unranked_maps) {
            const mapId = map.id || map;
            console.log(`Inserting map ${mapId} into tournament ${tournamentId}`);
            await query(
              `INSERT IGNORE INTO tournament_unranked_maps (tournament_id, map_id)
               VALUES (?, ?)`,
              [tournamentId, mapId]
            );
          }
        }
        
        console.log(`Successfully added assets to tournament ${tournamentId}`);
      } catch (assetError) {
        console.error('Error adding tournament assets:', assetError);
        // Don't fail tournament creation if adding assets fails
      }
    }

    // Get organizer nickname
    let organizerNickname = 'Unknown';
    try {
      const userResult = await query('SELECT nickname FROM users_extension WHERE id = ?', [req.userId]);
      if (userResult.rows.length > 0) {
        organizerNickname = userResult.rows[0].nickname;
      }
    } catch (userError) {
      console.warn('Could not fetch organizer nickname:', userError);
    }

    // Create Discord forum thread for the tournament
    try {
      const threadId = await discordService.createTournamentThread(
        tournamentId.toString(),
        name,
        tournament_type,
        organizerNickname,
        description,
        resolvedRulesContent
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
          organizerNickname,
          max_participants,
          resolvedRulesContent
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
    console.error('Full error:', error);
    res.status(500).json({ error: 'Failed to create tournament', details: error.message });
  }
});

// Get my tournaments (created by current user) - MUST be before /:id
router.get('/my', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.userId;
    const result = await query(
      `SELECT * FROM tournaments 
       WHERE creator_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    // For each tournament, if status = 'finished', fetch winner and runner-up
    const tournaments = await Promise.all(result.rows.map(async (t: any) => {
      let winner_id = null, winner_nickname = null, runner_up_id = null, runner_up_nickname = null;
      
      if (t.status === 'finished') {
        // Use tournament-type-aware function to get winner and runner-up
        const { winner, runnerUp } = await getWinnerAndRunnerUp(t.id);
        
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
      rules_template_id,
      rules_content,
      status,
      started_at
    } = req.body;

    // Verify the user is the tournament creator
    const tournamentResult = await query(
      'SELECT creator_id, status FROM tournaments WHERE id = ?',
      [id]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournamentResult.rows[0].creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only the tournament creator can update this tournament' });
    }

    const currentStatus = tournamentResult.rows[0].status;

    // Validate tournament_type change is only allowed in registration_open or registration_closed states
    if (tournament_type !== undefined) {
      if (currentStatus !== 'registration_open' && currentStatus !== 'registration_closed') {
        return res.status(400).json({ 
          error: `Cannot change tournament format. Tournament format can only be changed when in registration_open or registration_closed state. Current status: ${currentStatus}` 
        });
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let autoCopiedRulesContent: string | null = null;

    if (tournament_type !== undefined) {
      updates.push(`tournament_type = ?`);
      values.push(tournament_type);
    }

    if (description !== undefined) {
      updates.push(`description = ?`);
      values.push(description);
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

    if (auto_advance_round !== undefined) {
      updates.push(`auto_advance_round = ?`);
      values.push(auto_advance_round);
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

    if (status !== undefined) {
      updates.push(`status = ?`);
      values.push(status);
    }

    if (started_at !== undefined) {
      updates.push(`started_at = ?`);
      values.push(started_at);
    }

    if (updates.length === 0) {
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
    const updated = await query('SELECT * FROM tournaments WHERE id = ?', [id]);

    res.json({
      message: 'Tournament updated successfully',
      tournament: updated.rows[0]
    });
  } catch (error: any) {
    console.error('Update tournament error:', error.message || error);
    res.status(500).json({ error: 'Failed to update tournament', details: error.message });
  }
});

// Delete tournament (only creator, not in progress or finished)
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify tournament exists and user is creator
    const tournamentCheck = await query('SELECT id, creator_id, status FROM tournaments WHERE id = ?', [id]);
    if (tournamentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentCheck.rows[0];

    // Verify user is the tournament creator
    if (tournament.creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only tournament creator can cancel tournament' });
    }

    // Verify tournament is not in progress or finished
    if (tournament.status === 'in_progress' || tournament.status === 'finished') {
      return res.status(400).json({ error: 'Cannot cancel tournament that is in progress or finished' });
    }

    // Start transaction
    await query('BEGIN');

    try {
      // Delete all related data in the correct order (respecting foreign keys)
      
      // Delete tournament_round_matches
      await query('DELETE FROM tournament_round_matches WHERE round_id IN (SELECT id FROM tournament_rounds WHERE tournament_id = ?)', [id]);
      
      // Delete tournament_matches
      await query('DELETE FROM tournament_matches WHERE tournament_id = ?', [id]);
      
      // Delete tournament_rounds
      await query('DELETE FROM tournament_rounds WHERE tournament_id = ?', [id]);
      
      // Delete tournament_teams
      await query('DELETE FROM tournament_teams WHERE tournament_id = ?', [id]);
      
      // Delete tournament_assets (if table exists)
      await query('DELETE FROM tournament_assets WHERE tournament_id = ?', [id]).catch(() => {
        // Table might not exist, that's ok
      });
      
      // Delete tournament_participants
      await query('DELETE FROM tournament_participants WHERE tournament_id = ?', [id]);
      
      // Delete tournament
      await query('DELETE FROM tournaments WHERE id = ?', [id]);

      // Commit transaction
      await query('COMMIT');

      res.json({ 
        message: 'Tournament cancelled successfully',
        tournament_id: id
      });
    } catch (innerError) {
      await query('ROLLBACK');
      throw innerError;
    }
  } catch (error: any) {
    console.error('Delete tournament error:', error.message || error);
    res.status(500).json({ error: 'Failed to cancel tournament', details: error.message });
  }
});

// Get tournament rounds
router.get('/:id/rounds', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM tournament_rounds 
       WHERE tournament_id = ? 
       ORDER BY round_number ASC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tournament rounds' });
  }
});

// Get all tournaments (public view - only approved/in_progress/finished)
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

// Join tournament
router.post('/:id/join', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const userResult = await query('SELECT id FROM users_extension WHERE id = ?', [req.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate UUID for participant
    const participantId = randomUUID();

    // Insert participant with explicit UUID
    await query(
      `INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status)
       VALUES (?, ?, ?, 'accepted')`,
      [participantId, id, req.userId]
    );

    res.status(201).json({ id: participantId });
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Already joined this tournament' });
    }
    console.error('Join tournament error:', error);
    res.status(500).json({ error: 'Failed to join tournament', details: error.message });
  }
});

// Request to join tournament (creates pending participant)
router.post('/:id/request-join', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { team_name, teammate_name } = req.body;
    console.log('Request to join tournament:', { id, userId: req.userId, team_name, teammate_name });

    // Check if tournament exists and get tournament_mode
    const tournamentResult = await query(
      'SELECT id, discord_thread_id, max_participants, tournament_mode, creator_id FROM tournaments WHERE id = ?',
      [id]
    );
    if (tournamentResult.rows.length === 0) {
      console.log('Tournament not found:', id);
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentResult.rows[0];
    const isOrganizer = tournament.creator_id === req.userId;
    const participationStatus = isOrganizer ? 'accepted' : 'pending';
    let teamId: string | null = null;

    // If team tournament, handle team logic
    if (tournament.tournament_mode === 'team') {
      // Team name is required
      if (!team_name) {
        return res.status(400).json({ error: 'Team name required for team tournament' });
      }

      if (team_name.length < 2 || team_name.length > 50) {
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
      if (isReservedTeamName(team_name)) {
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
        [id, team_name, REJECTED_TEAM_ID]
      );

      if (existingTeamResult.rows.length > 0) {
        // Join existing team
        teamId = existingTeamResult.rows[0].id;
        console.log('Joining existing team:', { teamId, name: team_name });

        // Current user joins as Position 2
        await query(
          `INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status, team_id, team_position)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), id, req.userId, participationStatus, teamId, 2]
        );
        console.log('Player joined team at position 2');

        // If teammate provided, add them as Position 1 (unconfirmed - needs their confirmation)
        if (teammateUserId) {
          await query(
            `INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status, team_id, team_position)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [randomUUID(), id, teammateUserId, 'unconfirmed', teamId, 1]
          );
          console.log('Teammate added to team at position 1 (unconfirmed - awaiting confirmation)');
        }
      } else {
        // Check if team already exists with max members (excluding Rejected players team)
        const fullTeamResult = await query(
          `SELECT tt.id
           FROM tournament_teams tt
           LEFT JOIN tournament_participants tp ON tt.id = tp.team_id AND tp.participation_status IN ('pending', 'unconfirmed', 'accepted')
           WHERE tt.tournament_id = ? AND LOWER(tt.name) = LOWER(?) AND tt.id != ?
           GROUP BY tt.id
           HAVING COUNT(tp.id) >= 2`,
          [id, team_name, REJECTED_TEAM_ID]
        );

        if (fullTeamResult.rows.length > 0) {
          return res.status(400).json({ error: `Team "${team_name}" is already full (2/2 members)` });
        }

        // Create new team with safe UUID (avoiding REJECTED_TEAM_ID collision)
        const newTeamId = await generateSafeTeamId();
        const createTeamResult = await query(
          `INSERT INTO tournament_teams (id, tournament_id, name, created_by)
           VALUES (?, ?, ?, ?)`,
          [newTeamId, id, team_name, req.userId]
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
      await query(
        `INSERT INTO tournament_participants (id, tournament_id, user_id, participation_status)
         VALUES (?, ?, ?, ?)`,
        [randomUUID(), id, req.userId, 'pending']
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

    if (tournamentResult.rows[0].creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only the tournament creator can accept participants' });
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
      // This is a substitute confirmation - apply full replacement workflow
      // Get the player being replaced
      const playerToReplaceResult = await query(
        `SELECT id, team_position, user_id FROM tournament_participants 
         WHERE id = ? AND participation_status = 'pending_replacement'`,
        [participant.requested_replacement_of_id]
      );

      if (playerToReplaceResult.rows.length === 0) {
        return res.status(400).json({ error: 'Original team member not found' });
      }

      const playerToReplace = playerToReplaceResult.rows[0];
      const teamPosition = playerToReplace.team_position;
      const playerToReplaceId = playerToReplace.id;

      // Update: substitute becomes accepted with the team_position
      await query(
        `UPDATE tournament_participants 
         SET participation_status = 'accepted', team_position = ? 
         WHERE id = ?`,
        [teamPosition, participantId]
      );

      // Update: original player gets marked as replaced
      await query(
        `UPDATE tournament_participants 
         SET participation_status = 'replaced', replaced_by_participant_id = ?, team_position = NULL
         WHERE id = ?`,
        [participantId, playerToReplaceId]
      );

      // Move original member to replaced players team
      await query(
        `UPDATE tournament_participants 
         SET team_id = ?
         WHERE id = ?`,
        [REJECTED_TEAM_ID, playerToReplaceId]
      );

      console.log(`✅ Member replacement confirmed: New player ${participant.user_id} replaced ${playerToReplace.user_id}`);

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

    if (tournamentResult.rows[0].creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only the tournament creator can reject participants' });
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
      'SELECT creator_id, status, discord_thread_id, name, tournament_type, tournament_mode, max_participants, total_rounds FROM tournaments WHERE id = ?', 
      [id]
    );
    if (tournamentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentCheck.rows[0];
    if (tournament.creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only tournament creator can close registration' });
    }

    if (tournament.status !== 'registration_open') {
      return res.status(400).json({ error: 'Tournament registration is not open' });
    }

    // Check participants based on tournament mode
    let participantCount = 0;
    let incompleteParticipants = false;
    
    if (tournament.tournament_mode === 'team') {
      // For team tournaments: count complete teams (all members accepted)
      const teamsCheckResult = await query(
        `SELECT tt.id, COUNT(tp.id) as member_count, COALESCE(SUM(CASE WHEN tp.participation_status = 'accepted' THEN 1 ELSE 0 END), 0) as accepted_count
         FROM tournament_teams tt
         LEFT JOIN tournament_participants tp ON tt.id = tp.team_id
         WHERE tt.tournament_id = ?
         GROUP BY tt.id`,
        [id]
      );

      // Debug: Log raw data
      console.log(`[CLOSE_REGISTRATION] Raw teams data:`, JSON.stringify(teamsCheckResult.rows.slice(0, 2)));

      // Count complete teams (all members accepted)
      // Use explicit number conversion to handle potential string/number type issues
      const completeTeams = teamsCheckResult.rows.filter((team: any) => {
        const memberCount = parseInt(team.member_count, 10) || 0;
        const acceptedCount = parseInt(team.accepted_count, 10) || 0;
        const isComplete = memberCount === acceptedCount && memberCount > 0;
        
        // Log first few teams for debugging
        if (teamsCheckResult.rows.indexOf(team) < 2) {
          console.log(`[CLOSE_REGISTRATION] Team ${team.id}: members=${memberCount}, accepted=${acceptedCount}, complete=${isComplete}`);
        }
        
        return isComplete;
      });

      participantCount = completeTeams.length;

      console.log(`[CLOSE_REGISTRATION] Team mode tournament: ${completeTeams.length} complete teams out of ${teamsCheckResult.rows.length} total teams`);

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
      // Delete tournament and all related data
      await query('DELETE FROM tournament_rounds WHERE tournament_id = ?', [id]);
      await query('DELETE FROM tournament_matches WHERE tournament_id = ?', [id]);
      await query('DELETE FROM tournament_round_matches WHERE tournament_id = ?', [id]);
      await query('DELETE FROM matches WHERE tournament_id = ?', [id]);
      await query('DELETE FROM tournament_participants WHERE tournament_id = ?', [id]);
      await query('DELETE FROM tournament_teams WHERE tournament_id = ?', [id]);
      await query('DELETE FROM tournaments WHERE id = ?', [id]);

      return res.status(200).json({ 
        action: 'deleted',
        message: 'Tournament deleted successfully (insufficient participants)'
      });
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
          participantCount
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

// Prepare tournament (generate rounds)
router.post('/:id/prepare', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    console.log(`[PREPARE] Starting preparation for tournament ${id}`);

    // Verify tournament creator
    const tournamentCheck = await query(
      'SELECT creator_id, status, tournament_type, general_rounds, final_rounds, general_rounds_format, final_rounds_format FROM tournaments WHERE id = ?', 
      [id]
    );
    if (tournamentCheck.rows.length === 0) {
      console.log(`[PREPARE] Tournament ${id} not found`);
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentCheck.rows[0];
    console.log(`[PREPARE] Tournament data:`, tournament);
    
    const tournamentType = tournament.tournament_type?.toLowerCase() || 'elimination';
    console.log(`[PREPARE] Tournament type: ${tournamentType}, current status: ${tournament.status}, total_rounds in DB: ${tournament.total_rounds}`);
    
    if (tournament.creator_id !== req.userId) {
      console.log(`[PREPARE] Authorization failed - creator_id: ${tournament.creator_id}, userId: ${req.userId}`);
      return res.status(403).json({ error: 'Only tournament creator can prepare tournament' });
    }

    // Verify tournament is in correct status
    if (tournament.status !== 'registration_closed') {
      console.log(`[PREPARE] Invalid status: ${tournament.status}, expected: registration_closed`);
      return res.status(400).json({ error: `Tournament must have registration closed before preparing. Current status: ${tournament.status}` });
    }

    if (tournament.status !== 'registration_closed') {
      console.log(`[PREPARE] Invalid status: ${tournament.status}, expected: registration_closed`);
      return res.status(400).json({ error: 'Tournament must be registration_closed before preparation' });
    }

    // Get tournament_mode to determine if counting teams or individual participants
    const tournamentModeCheck = await query(
      'SELECT tournament_mode FROM tournaments WHERE id = ?',
      [id]
    );
    const tournamentMode = tournamentModeCheck.rows[0]?.tournament_mode || 'individual';

    // Get number of accepted participants (for team tournaments: count teams; for 1v1: count individuals)
    let participantCount = 0;
    
    if (tournamentMode === 'team') {
      // For team tournaments: count accepted teams (teams where all members are accepted)
      const teamsResult = await query(
        `SELECT COUNT(DISTINCT tt.id) as count 
         FROM tournament_teams tt
         WHERE tt.tournament_id = ?
         AND tt.status = 'active'`,
        [id]
      );
      participantCount = teamsResult.rows[0]?.count || 0;
      console.log(`[PREPARE] Team tournament: ${participantCount} active teams`);
    } else {
      // For individual tournaments: count accepted participants
      const participantsResult = await query(
        `SELECT COUNT(*) as count FROM tournament_participants 
         WHERE tournament_id = ? AND participation_status = 'accepted'`,
        [id]
      );
      participantCount = participantsResult.rows[0]?.count || 0;
      console.log(`[PREPARE] Individual tournament: ${participantCount} accepted participants`);
    }

    // Calculate maximum rounds needed based on tournament type
    // Only elimination formats have a mathematical limit
    let maxRoundsNeeded = 999; // Default: no limit (for Swiss, League)
    
    if (tournamentType === 'elimination') {
      // For pure elimination: N participants need log2(N) rounds
      maxRoundsNeeded = participantCount > 0 ? Math.ceil(Math.log2(participantCount)) : 0;
    } else if (tournamentType === 'swiss_elimination') {
      // For Swiss-Elimination Mix: only final rounds are limited
      // General (Swiss) rounds can be unlimited
      // Final (elimination) rounds need log2(N) rounds
      maxRoundsNeeded = participantCount > 0 ? Math.ceil(Math.log2(participantCount)) : 0;
    }
    // For league and swiss: no mathematical limit
    
    // Total rounds requested (or use pre-calculated total_rounds for elimination)
    let totalRoundsRequested = (tournament.general_rounds || 0) + (tournament.final_rounds || 0);
    const finalRoundsRequested = tournament.final_rounds || 0;
    
    // For elimination tournaments with no explicit round config, use total_rounds if available
    if (tournamentType === 'elimination' && totalRoundsRequested === 0) {
      totalRoundsRequested = tournament.total_rounds || maxRoundsNeeded;
    }
    
    console.log(`[PREPARE] Tournament type: ${tournamentType}, Max rounds allowed: ${maxRoundsNeeded}, Total requested: ${totalRoundsRequested}, Final rounds: ${finalRoundsRequested}`);

    // Validate based on type
    if (tournamentType === 'elimination' && totalRoundsRequested > maxRoundsNeeded) {
      console.log(`[PREPARE] Validation failed: too many rounds for elimination`);
      return res.status(400).json({ 
        error: `Tournament has ${participantCount} participants but requested ${totalRoundsRequested} rounds. Maximum allowed: ${maxRoundsNeeded} rounds for elimination format.`
      });
    } else if (tournamentType === 'swiss_elimination' && finalRoundsRequested > maxRoundsNeeded) {
      console.log(`[PREPARE] Validation failed: too many final rounds for swiss-elimination`);
      return res.status(400).json({ 
        error: `Tournament has ${participantCount} participants but requested ${finalRoundsRequested} final (elimination) rounds. Maximum allowed: ${maxRoundsNeeded} elimination rounds.`
      });
    }

    // Generate tournament rounds based on configuration and tournament type
    const roundsToCreate = [];
    let roundNumber = 1;
    let totalGeneralRounds = tournament.general_rounds || 0;
    let totalFinalRounds = tournament.final_rounds || 0;
    
    // For Elimination tournaments, generate all rounds based on calculated total_rounds
    if (tournamentType === 'elimination') {
      // Use existing total_rounds, or calculate it if not set
      let totalElimRounds = tournament.total_rounds || 0;
      if (totalElimRounds === 0) {
        totalElimRounds = participantCount > 0 ? Math.ceil(Math.log2(participantCount)) : 0;
        console.log(`[PREPARE] Calculated elimination rounds for ${participantCount} participants: ${totalElimRounds}`);
      }
      
      // All elimination rounds use the general_rounds_format except the last one (final) uses final_rounds_format
      for (let i = 0; i < totalElimRounds; i++) {
        const isLastRound = (i === totalElimRounds - 1);
        let label = '';
        let classification = '';
        
        if (totalElimRounds === 1) {
          label = `Final`;
          classification = 'final';
        } else if (totalElimRounds === 2) {
          if (i === 0) {
            label = `Semifinals`;
            classification = 'semifinals';
          } else {
            label = `Final`;
            classification = 'final';
          }
        } else if (totalElimRounds === 3) {
          if (i === 0) {
            label = `Quarterfinals`;
            classification = 'quarterfinals';
          } else if (i === 1) {
            label = `Semifinals`;
            classification = 'semifinals';
          } else {
            label = `Final`;
            classification = 'final';
          }
        } else if (totalElimRounds === 4) {
          if (i === 0) {
            label = `Round of 16`;
            classification = 'round16';
          } else if (i === 1) {
            label = `Quarterfinals`;
            classification = 'quarterfinals';
          } else if (i === 2) {
            label = `Semifinals`;
            classification = 'semifinals';
          } else {
            label = `Final`;
            classification = 'final';
          }
        } else {
          label = `Round ${i + 1}`;
          classification = isLastRound ? 'final' : 'general';
        }
        
        roundsToCreate.push({
          roundNumber: i + 1,
          roundType: isLastRound ? 'final' : 'general',
          matchFormat: isLastRound ? tournament.final_rounds_format : tournament.general_rounds_format,
          label: label,
          classification: classification,
          description: label
        });
      }
      totalGeneralRounds = totalElimRounds - (totalElimRounds > 0 ? 1 : 0); // All but last are "general"
      totalFinalRounds = totalElimRounds > 0 ? 1 : 0; // Last is "final"
    }
    // For League tournaments, calculate actual rounds based on format (1=ida, 2=ida y vuelta)
    else if (tournamentType === 'league') {
      const leagueFormat = totalGeneralRounds; // 1 or 2
      // For round-robin: each player plays each other player once per format iteration
      // Rounds needed = n * format, where n = number of participants
      // With odd players: one "bye" per round, one player rests each round
      // With even players: all players play each round
      // In both cases, need n rounds so each participant plays all others
      totalGeneralRounds = participantCount * leagueFormat;
    }

    // Determine round classification based on tournament type
    let generalRoundClassification = 'standard';
    let finalRoundClassification = 'final';
    let phaseDescription = '';

    if (tournamentType === 'league') {
      generalRoundClassification = 'standard'; // League rounds
      phaseDescription = 'League round';
    } else if (tournamentType === 'swiss') {
      generalRoundClassification = 'swiss'; // Swiss rounds
      phaseDescription = 'Swiss round';
    } else if (tournamentType === 'swiss_elimination') {
      generalRoundClassification = 'general'; // Swiss phase
      finalRoundClassification = 'elimination'; // Elimination phase
      phaseDescription = 'Swiss-Elimination Mix';
    } else if (tournamentType === 'elimination') {
      generalRoundClassification = 'general'; // Elimination can have multiple phases
      finalRoundClassification = 'final';
      phaseDescription = 'Elimination tournament';
    }

    // Add general rounds (skip for pure elimination, already added above)
    if (tournamentType !== 'elimination') {
      for (let i = 0; i < totalGeneralRounds; i++) {
        let classification = generalRoundClassification;
        let label = '';

        if (tournamentType === 'league') {
          const leagueFormat = tournament.general_rounds || 1;
          const phase = leagueFormat === 2 && i >= (totalGeneralRounds / 2) ? 'Vuelta' : 'Ida';
          label = `League Round ${i + 1} (${phase})`;
        } else if (tournamentType === 'swiss') {
          label = `Swiss Round ${i + 1}`;
        } else if (tournamentType === 'swiss_elimination') {
          label = `Swiss Round ${i + 1}`;
          classification = 'general';
        }

        roundsToCreate.push({
          roundNumber,
          roundType: 'general',
          matchFormat: tournament.general_rounds_format || 'bo3',
          classification,
          label,
          description: label,
          playersRemaining: participantCount,
          playersAdvancing: participantCount
        });
        roundNumber++;
      }
    }

    // For Swiss-Elimination Mix, determine how many players advance to elimination phase
    // based on the number of final rounds: 3 rounds = 8 players, 2 rounds = 4 players, 1 round = 2 players
    let elimiationPhaseParticipants = participantCount;
    if (tournamentType === 'swiss_elimination') {
      // Calculate players needed based on final rounds
      // 1 round (Final only): 2 players
      // 2 rounds (Semis + Final): 4 players
      // 3 rounds (Quarters + Semis + Final): 8 players
      // 4 rounds: 16 players, etc.
      elimiationPhaseParticipants = Math.pow(2, totalFinalRounds);
    }

    // Add final rounds with detailed classification (skip for pure elimination, already added above)
    if (tournamentType !== 'elimination') {
      for (let i = 0; i < totalFinalRounds; i++) {
        let classification = finalRoundClassification;
        let label = 'Final';
        let playersRemaining = elimiationPhaseParticipants;
        let playersAdvancing = 1;
        let roundType = 'final';

        if (tournamentType === 'swiss_elimination') {
          // For elimination brackets
          if (totalFinalRounds === 1) {
            classification = 'final';
            label = `Final (${elimiationPhaseParticipants}→1)`;
            playersRemaining = elimiationPhaseParticipants;
            playersAdvancing = 1;
          } else if (totalFinalRounds === 2) {
            if (i === 0) {
              classification = 'semifinals';
              label = `Semifinals (${elimiationPhaseParticipants}→${Math.round(elimiationPhaseParticipants / 2)})`;
              playersRemaining = elimiationPhaseParticipants;
              playersAdvancing = Math.round(elimiationPhaseParticipants / 2);
            } else {
              classification = 'final';
              label = `Final (${Math.round(elimiationPhaseParticipants / 2)}→1)`;
              playersRemaining = Math.round(elimiationPhaseParticipants / 2);
              playersAdvancing = 1;
            }
          } else if (totalFinalRounds === 3) {
            if (i === 0) {
              classification = 'quarterfinals';
              label = `Quarterfinals (${elimiationPhaseParticipants}→${Math.round(elimiationPhaseParticipants / 2)})`;
              playersRemaining = elimiationPhaseParticipants;
              playersAdvancing = Math.round(elimiationPhaseParticipants / 2);
            } else if (i === 1) {
              classification = 'semifinals';
              label = `Semifinals (${Math.round(elimiationPhaseParticipants / 2)}→${Math.round(elimiationPhaseParticipants / 4)})`;
              playersRemaining = Math.round(elimiationPhaseParticipants / 2);
              playersAdvancing = Math.round(elimiationPhaseParticipants / 4);
            } else {
              classification = 'final';
              label = `Final (${Math.round(elimiationPhaseParticipants / 4)}→1)`;
              playersRemaining = Math.round(elimiationPhaseParticipants / 4);
              playersAdvancing = 1;
            }
          }
        }

        roundsToCreate.push({
          roundNumber,
          roundType,
          matchFormat: tournament.final_rounds_format || 'bo5',
          classification,
          label,
          description: label,
          playersRemaining,
          playersAdvancing
        });
        roundNumber++;
      }
    }

    console.log(`[PREPARE] Tournament type: ${tournamentType}, Rounds to create:`, roundsToCreate);

    // Insert generated rounds
    for (const round of roundsToCreate) {
      console.log(`[PREPARE] Inserting round ${round.roundNumber}: ${round.label} [${round.classification}]`);
      const insertResult = await query(
        `INSERT INTO tournament_rounds (id, tournament_id, round_number, round_type, match_format, round_status, round_phase_label, round_phase_description, round_classification, players_remaining, players_advancing_to_next)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        [randomUUID(), id, round.roundNumber, round.roundType, round.matchFormat, round.label, round.description, round.classification, round.playersRemaining ?? null, round.playersAdvancing ?? null]
      );
      console.log(`[PREPARE] Round ${round.roundNumber} inserted successfully`);
    }

    // Pre-generate all league tournament matches if league type
    if (tournamentType === 'league') {
      try {
        console.log(`[PREPARE] Pre-generating all league matches...`);
        await preGenerateLeagueMatches(id);
        console.log(`[PREPARE] League matches pre-generated successfully`);
      } catch (preGenErr) {
        console.error(`[PREPARE] Warning: Could not pre-generate league matches:`, preGenErr);
        // Don't fail tournament preparation if pre-generation fails, but log it
      }
    }

    // Update tournament status
    console.log(`[PREPARE] Updating tournament status to prepared`);
    const totalCalculatedRounds = totalGeneralRounds + totalFinalRounds;
    console.log(`[PREPARE] Updating total_rounds to ${totalCalculatedRounds} (${totalGeneralRounds} general + ${totalFinalRounds} final)`);
    await query(
      `UPDATE tournaments 
       SET status = ?, prepared_at = NOW(), current_round = 1, total_rounds = ?
       WHERE id = ?`,
      ['prepared', totalCalculatedRounds, id]
    );
    console.log(`[PREPARE] Tournament status updated`);

    res.json({ 
      message: 'Tournament prepared successfully',
      rounds_created: roundsToCreate.length,
      next_step: 'Start tournament when ready'
    });
  } catch (error) {
    console.error(`[PREPARE] Error preparing tournament:`, error);
    res.status(500).json({ error: 'Failed to prepare tournament', details: String(error) });
  }
});

// Start tournament - activates first round and changes status to in_progress
router.post('/:id/start', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    console.log(`[START] Starting tournament ${id}`);

    // Verify tournament creator
    const tournamentCheck = await query(
      `SELECT creator_id, status, general_rounds, final_rounds, general_rounds_format, final_rounds_format, tournament_type, name, discord_thread_id
       FROM tournaments WHERE id = ?`, 
      [id]
    );
    if (tournamentCheck.rows.length === 0) {
      console.log(`[START] Tournament ${id} not found`);
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentCheck.rows[0];
    console.log(`[START] Tournament data:`, tournament);
    
    if (tournament.creator_id !== req.userId) {
      console.log(`[START] Authorization failed`);
      return res.status(403).json({ error: 'Only tournament creator can start tournament' });
    }

    if (tournament.status !== 'prepared') {
      console.log(`[START] Invalid status: ${tournament.status}, expected: prepared`);
      return res.status(400).json({ error: 'Tournament must be prepared before starting' });
    }

    // Verify participants before starting
    const participantsCheck = await query(
      `SELECT COUNT(*) as accepted_count FROM tournament_participants 
       WHERE tournament_id = ? AND participation_status = 'accepted'`,
      [id]
    );
    const acceptedParticipants = participantsCheck.rows[0].accepted_count;
    console.log(`[START] Tournament ${id} has ${acceptedParticipants} accepted participants`);
    
    if (acceptedParticipants === 0) {
      return res.status(400).json({ error: 'No accepted participants in tournament' });
    }

    // Check if rounds already exist
    const roundsCheck = await query(
      `SELECT COUNT(*) as round_count FROM tournament_rounds 
       WHERE tournament_id = ?`,
      [id]
    );
    let roundCount = parseInt(roundsCheck.rows[0].round_count) || 0;
    console.log(`[START] Tournament ${id} currently has ${roundCount} rounds`);
    
    // If no rounds exist, create them now
    if (roundCount === 0) {
      console.log(`[START] No rounds found, creating them now`);
      
      // Get tournament type
      const tournamentType = tournament.tournament_type?.toLowerCase() || 'elimination';
      console.log(`[START] Tournament type: ${tournamentType}`);
      
      // Calculate maximum rounds needed for elimination tournament
      const maxRoundsNeeded = acceptedParticipants > 0 ? Math.ceil(Math.log2(acceptedParticipants)) : 0;
      
      // Total rounds requested - for elimination, use total_rounds if available
      let totalRoundsRequested = (tournament.general_rounds || 0) + (tournament.final_rounds || 0);
      if (tournamentType === 'elimination' && totalRoundsRequested === 0) {
        totalRoundsRequested = tournament.total_rounds || maxRoundsNeeded;
      }
      console.log(`[START] Max rounds needed: ${maxRoundsNeeded}, Total requested: ${totalRoundsRequested}`);

      if (totalRoundsRequested > maxRoundsNeeded) {
        console.log(`[START] Validation failed: too many rounds`);
        return res.status(400).json({ 
          error: `Tournament has ${acceptedParticipants} participants but requested ${totalRoundsRequested} rounds. Maximum allowed: ${maxRoundsNeeded} rounds for elimination format.`
        });
      }

      // Generate tournament rounds based on configuration
      const roundsToCreate = [];
      let roundNumber = 1;

      // For pure elimination, generate rounds differently
      if (tournamentType === 'elimination') {
        const totalElimRounds = totalRoundsRequested || maxRoundsNeeded;
        console.log(`[START] Creating ${totalElimRounds} elimination rounds`);
        
        for (let i = 0; i < totalElimRounds; i++) {
          const isLastRound = (i === totalElimRounds - 1);
          let label = '';
          let classification = '';
          
          if (totalElimRounds === 1) {
            label = 'Final';
            classification = 'final';
          } else if (totalElimRounds === 2) {
            if (i === 0) {
              label = 'Semifinals';
              classification = 'semifinals';
            } else {
              label = 'Final';
              classification = 'final';
            }
          } else if (totalElimRounds === 3) {
            if (i === 0) {
              label = 'Quarterfinals';
              classification = 'quarterfinals';
            } else if (i === 1) {
              label = 'Semifinals';
              classification = 'semifinals';
            } else {
              label = 'Final';
              classification = 'final';
            }
          } else if (totalElimRounds === 4) {
            if (i === 0) {
              label = 'Round of 16';
              classification = 'round16';
            } else if (i === 1) {
              label = 'Quarterfinals';
              classification = 'quarterfinals';
            } else if (i === 2) {
              label = 'Semifinals';
              classification = 'semifinals';
            } else {
              label = 'Final';
              classification = 'final';
            }
          } else {
            label = `Round ${i + 1}`;
            classification = isLastRound ? 'final' : 'general';
          }
          
          roundsToCreate.push({
            roundNumber,
            roundType: isLastRound ? 'final' : 'general',
            matchFormat: isLastRound ? (tournament.final_rounds_format || 'bo5') : (tournament.general_rounds_format || 'bo3'),
            label,
            classification,
            description: label
          });
          roundNumber++;
        }
      } else {
        // For other tournament types, use general_rounds and final_rounds
        // Add general rounds
        for (let i = 0; i < (tournament.general_rounds || 0); i++) {
          roundsToCreate.push({
            roundNumber,
            roundType: 'general',
            matchFormat: tournament.general_rounds_format || 'bo3'
          });
          roundNumber++;
        }

        // Add final rounds
        for (let i = 0; i < (tournament.final_rounds || 0); i++) {
          roundsToCreate.push({
            roundNumber,
            roundType: 'final',
            matchFormat: tournament.final_rounds_format || 'bo5'
          });
          roundNumber++;
        }
      }

      console.log(`[START] Rounds to create:`, roundsToCreate);

      // Insert generated rounds
      for (const round of roundsToCreate) {
        console.log(`[START] Inserting round ${round.roundNumber} (${round.roundType}): ${round.label || 'N/A'}`);
        await query(
          `INSERT INTO tournament_rounds (id, tournament_id, round_number, round_type, match_format, round_status, round_phase_label, round_phase_description, round_classification)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          [randomUUID(), id, round.roundNumber, round.roundType, round.matchFormat, round.label || '', round.description || '', round.classification || '']
        );
        console.log(`[START] Round ${round.roundNumber} inserted successfully`);
      }

      roundCount = roundsToCreate.length;
      console.log(`[START] Created ${roundCount} rounds`);
    }

    // Update tournament status to in_progress
    console.log(`[START] Updating tournament status to in_progress`);
    await query(
      `UPDATE tournaments 
       SET status = ?, started_at = NOW()
       WHERE id = ?`,
      ['in_progress', id]
    );
    console.log(`[START] Tournament ${id} status updated to in_progress`);

    // Post tournament started notification to Discord FIRST
    if (tournament.discord_thread_id) {
      try {
        await discordService.postTournamentStarted(
          tournament.discord_thread_id,
          tournament.name,
          acceptedParticipants,
          roundCount
        );
        console.log(`[START] Posted tournament started notification to Discord`);
      } catch (discordError) {
        console.error('Discord tournament started notification error:', discordError);
        // Don't fail the request if Discord fails
      }
    }

    // Activate rounds: for league tournaments open all rounds simultaneously;
    // for other types only activate the first round
    try {
      const isLeagueTournament = tournament.tournament_type?.toLowerCase() === 'league';

      if (isLeagueTournament) {
        console.log(`[START] League tournament: activating all ${roundCount} rounds simultaneously`);

        // Open all rounds at once with a single query (more efficient than calling activateRound N times)
        await query(
          `UPDATE tournament_rounds
           SET round_status = 'in_progress', round_start_date = NOW()
           WHERE tournament_id = ? AND round_status = 'pending'`,
          [id]
        );

        // Recalculate rankings once after opening all rounds
        if (tournament.tournament_mode === 'team') {
          const { recalculateTeamRankingsForTournament } = await import('../utils/tournament.js');
          await recalculateTeamRankingsForTournament(id);
        } else {
          const { recalculateParticipantRankings } = await import('../utils/tournament.js');
          await recalculateParticipantRankings(id);
        }

        console.log(`[START] All rounds activated for league tournament ${id}`);

        // Get total match count across all rounds for Discord
        const totalMatchCountResult = await query(
          `SELECT COUNT(*) as match_count FROM tournament_matches tm
           JOIN tournament_rounds tr ON tm.round_id = tr.id
           WHERE tr.tournament_id = ?`,
          [id]
        );
        const totalMatchCount = parseInt(totalMatchCountResult.rows[0]?.match_count || '0');

        // Post a single Discord notification for all rounds being open
        if (tournament.discord_thread_id) {
          try {
            const totalRoundsResult2 = await query(
              `SELECT COUNT(*) as total FROM tournament_rounds WHERE tournament_id = ?`,
              [id]
            );
            const totalRounds = parseInt(totalRoundsResult2.rows[0]?.total || '0');
            await discordService.postLeagueStarted(
              tournament.discord_thread_id,
              totalRounds,
              totalMatchCount
            );
            console.log(`[START] Posted league all-rounds-open notification to Discord`);
          } catch (discordErr) {
            console.error('Discord league round notification error:', discordErr);
          }
        }

      } else {
        console.log(`[START] Attempting to activate round 1 for tournament ${id}`);
        await activateRound(id, 1);
        console.log(`[START] Round 1 activated successfully for tournament ${id}`);

        // Get round details for Discord notification
        const roundDetailsResult = await query(
          `SELECT COUNT(*) as match_count FROM tournament_matches tm
           JOIN tournament_rounds tr ON tm.round_id = tr.id
           WHERE tr.tournament_id = ? AND tr.round_number = 1`,
          [id]
        );
        const matchesCount = parseInt(roundDetailsResult.rows[0]?.match_count || '0');

        // Post round started notification to Discord
        if (tournament.discord_thread_id) {
          try {
            const estimatedEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await discordService.postRoundStarted(
              tournament.discord_thread_id,
              1,
              matchesCount,
              estimatedEndDate
            );
            console.log(`[START] Posted round started notification to Discord`);
          } catch (discordErr) {
            console.error('Discord round start notification error:', discordErr);
          }
        }

        // Post matchups notification to Discord
        if (tournament.discord_thread_id) {
          try {
            // Detect tournament mode to fetch correct names
            const isTeamMode = tournament.tournament_mode === 'team';
            
            let matchupsResult;
            if (isTeamMode) {
              // Team mode: JOIN with tournament_teams
              matchupsResult = await query(
                `SELECT trm.player1_id, trm.player2_id, tt1.name as player1_nickname, tt2.name as player2_nickname
                 FROM tournament_round_matches trm
                 LEFT JOIN tournament_teams tt1 ON trm.player1_id = tt1.id
                 LEFT JOIN tournament_teams tt2 ON trm.player2_id = tt2.id
                 WHERE trm.round_id IN (SELECT id FROM tournament_rounds WHERE tournament_id = ? AND round_number = 1)`,
                [id]
              );
            } else {
              // Individual mode: JOIN with users_extension
              matchupsResult = await query(
                `SELECT trm.player1_id, trm.player2_id, u1.nickname as player1_nickname, u2.nickname as player2_nickname
                 FROM tournament_round_matches trm
                 LEFT JOIN users_extension u1 ON trm.player1_id = u1.id
                 LEFT JOIN users_extension u2 ON trm.player2_id = u2.id
                 WHERE trm.round_id IN (SELECT id FROM tournament_rounds WHERE tournament_id = ? AND round_number = 1)`,
                [id]
              );
            }
            
            if (matchupsResult.rows.length > 0) {
              const matchups = matchupsResult.rows.map(m => ({
                player1: m.player1_nickname || 'Unknown',
                player2: m.player2_nickname || 'Unknown'
              }));
              
              await discordService.postMatchups(
                tournament.discord_thread_id,
                1,
                matchups
              );
              console.log(`[START] Posted matchups notification to Discord`);
            }
          } catch (discordErr) {
            console.error('Discord matchups notification error:', discordErr);
          }
        }
      }
    } catch (err) {
      console.error(`[START] Warning: Could not activate rounds for tournament ${id}:`, err);
      // Don't fail the tournament start if round activation fails
    }

    res.json({ 
      message: 'Tournament started successfully',
      rounds_count: roundCount,
      status: 'in_progress',
      first_round_activated: true
    });
  } catch (error) {
    console.error('[START] Error starting tournament:', error);
    res.status(500).json({ error: 'Failed to start tournament', details: String(error) });
  }
});

// Get tournament matches for a specific round
router.get('/:tournamentId/rounds/:roundId/matches', async (req, res) => {
  try {
    const { tournamentId, roundId } = req.params;

    // First, get tournament mode
    const tournamentModeResult = await query(
      `SELECT tournament_mode FROM tournaments WHERE id = ?`,
      [tournamentId]
    );

    if (tournamentModeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentMode = tournamentModeResult.rows[0].tournament_mode || 'ranked';

    // Build dynamic query based on tournament mode
    let selectClause, joinClause;
    
    if (tournamentMode === 'team') {
      // Team mode: get team names from tournament_teams, map from tournament_matches (no factions for team)
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        tt1.name as player1_nickname,
        tt2.name as player2_nickname,
        tt_winner.name as winner_nickname,
        (CASE WHEN tm.player1_id = tm.winner_id THEN tt2.name ELSE tt1.name END) as loser_nickname,
        tm.map,
        NULL as winner_faction,
        NULL as loser_faction,
        m.id as reported_match_id,
        m.status as reported_match_status,
        TRUE as is_team_mode
      `;
      joinClause = `
        FROM tournament_matches tm
        LEFT JOIN tournament_teams tt1 ON tm.player1_id = tt1.id
        LEFT JOIN tournament_teams tt2 ON tm.player2_id = tt2.id
        LEFT JOIN tournament_teams tt_winner ON tm.winner_id = tt_winner.id
        LEFT JOIN matches m ON tm.match_id = m.id
      `;
    } else if (tournamentMode === 'unranked') {
      // Unranked 1v1: get player names from users, match details from tournament_matches
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        u1.nickname as player1_nickname,
        u2.nickname as player2_nickname,
        uw.nickname as winner_nickname,
        (CASE WHEN tm.player1_id = tm.winner_id THEN u2.nickname ELSE u1.nickname END) as loser_nickname,
        tm.map,
        tm.winner_faction,
        tm.loser_faction,
        m.id as reported_match_id,
        m.status as reported_match_status,
        FALSE as is_team_mode
      `;
      joinClause = `
        FROM tournament_matches tm
        LEFT JOIN users_extension u1 ON tm.player1_id = u1.id
        LEFT JOIN users_extension u2 ON tm.player2_id = u2.id
        LEFT JOIN users_extension uw ON tm.winner_id = uw.id
        LEFT JOIN matches m ON tm.match_id = m.id
      `;
    } else {
      // Ranked 1v1: get player names from users, match details from matches table
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        u1.nickname as player1_nickname,
        u2.nickname as player2_nickname,
        uw.nickname as winner_nickname,
        ul.nickname as loser_nickname,
        m.map,
        m.winner_faction,
        m.loser_faction,
        m.id as reported_match_id,
        m.status as reported_match_status,
        FALSE as is_team_mode
      `;
      joinClause = `
        FROM tournament_matches tm
        LEFT JOIN users_extension u1 ON tm.player1_id = u1.id
        LEFT JOIN users_extension u2 ON tm.player2_id = u2.id
        LEFT JOIN users_extension uw ON tm.winner_id = uw.id
        LEFT JOIN matches m ON tm.match_id = m.id
        LEFT JOIN users_extension ul ON m.loser_id = ul.id
      `;
    }

    const result = await query(
      `SELECT ${selectClause}
       ${joinClause}
       WHERE tm.tournament_id = ? AND tm.round_id = ?
       ORDER BY tm.created_at ASC`,
      [tournamentId, roundId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament matches' });
  }
});

// Get tournament round matches (from tournament_round_matches table)
router.get('/:tournamentId/round-matches', async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // First, get tournament mode
    const tournamentModeResult = await query(
      `SELECT tournament_mode FROM tournaments WHERE id = ?`,
      [tournamentId]
    );

    if (tournamentModeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const isTeamMode = tournamentModeResult.rows[0].tournament_mode === 'team';

    // Build dynamic query based on tournament mode
    let selectClause, joinClause;
    
    if (isTeamMode) {
      // Team mode: get team names from tournament_teams
      selectClause = `
        trm.id,
        trm.tournament_id,
        trm.round_id,
        trm.player1_id,
        trm.player2_id,
        trm.winner_id,
        trm.player1_wins,
        trm.player2_wins,
        trm.best_of,
        trm.series_status,
        trm.scheduled_datetime,
        trm.scheduled_status,
        trm.scheduled_by_player_id,
        tr.round_number,
        tr.round_type,
        tt1.name as player1_nickname,
        tt2.name as player2_nickname,
        tt_winner.name as winner_nickname,
        TRUE as is_team_mode
      `;
      joinClause = `
        FROM tournament_round_matches trm
        JOIN tournament_rounds tr ON trm.round_id = tr.id
        LEFT JOIN tournament_teams tt1 ON trm.player1_id = tt1.id
        LEFT JOIN tournament_teams tt2 ON trm.player2_id = tt2.id
        LEFT JOIN tournament_teams tt_winner ON trm.winner_id = tt_winner.id
      `;
    } else {
      // 1v1 mode: get player names from users (original behavior)
      selectClause = `
        trm.id,
        trm.tournament_id,
        trm.round_id,
        trm.player1_id,
        trm.player2_id,
        trm.winner_id,
        trm.player1_wins,
        trm.player2_wins,
        trm.best_of,
        trm.series_status,
        trm.scheduled_datetime,
        trm.scheduled_status,
        trm.scheduled_by_player_id,
        tr.round_number,
        tr.round_type,
        u1.nickname as player1_nickname,
        u2.nickname as player2_nickname,
        uw.nickname as winner_nickname,
        FALSE as is_team_mode
      `;
      joinClause = `
        FROM tournament_round_matches trm
        JOIN tournament_rounds tr ON trm.round_id = tr.id
        LEFT JOIN users_extension u1 ON trm.player1_id = u1.id
        LEFT JOIN users_extension u2 ON trm.player2_id = u2.id
        LEFT JOIN users_extension uw ON trm.winner_id = uw.id
      `;
    }

    const result = await query(
      `SELECT ${selectClause}
       ${joinClause}
       WHERE trm.tournament_id = ?
       ORDER BY tr.round_number ASC, trm.created_at ASC`,
      [tournamentId]
    );

    console.log(`🔍 [ROUND-MATCHES] Query returned ${result.rows.length} rows for tournament ${tournamentId}`);
    
    // Log details of each row - especially replay fields
    result.rows.forEach((row: any, idx: number) => {
      console.log(`🔍 [ROUND-MATCHES] Row ${idx}:`, {
        match_id: row.id,
        player1: row.player1_nickname,
        player2: row.player2_nickname,
        has_replay: !!row.pending_replay_id,
        replay_id: row.pending_replay_id,
        replay_summary_keys: row.pending_replay_summary ? Object.keys(JSON.parse(row.pending_replay_summary)).slice(0, 5) : null,
        replay_need_integration: row.pending_replay_need_integration
      });
    });

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tournament round matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament round matches' });
  }
});

// Record match result for a tournament match
router.post('/:tournamentId/matches/:matchId/result', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tournamentId, matchId } = req.params;
    const { winner_id, reported_match_id } = req.body;

    // Verify the user is either the tournament creator or one of the players
    const matchResult = await query(
      `SELECT tm.*, t.creator_id, t.tournament_mode FROM tournament_matches tm
       JOIN tournaments t ON tm.tournament_id = t.id
       WHERE tm.id = ? AND tm.tournament_id = ?`,
      [matchId, tournamentId]
    );

    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchResult.rows[0];
    const isCreator = match.creator_id === req.userId;
    const tournamentMode = match.tournament_mode;

    let finalWinnerId = winner_id;
    let isPlayer = false;

    if (tournamentMode === 'team') {
      // For team tournaments: validate user is in one of the teams and get their team_id
      const userTeamResult = await query(
        `SELECT tp.team_id FROM tournament_participants tp
         WHERE tp.tournament_id = ? AND tp.user_id = ?`,
        [tournamentId, req.userId]
      );

      if (userTeamResult.rows.length === 0 && !isCreator) {
        return res.status(403).json({ error: 'You are not a participant in this tournament' });
      }

      if (userTeamResult.rows.length > 0) {
        const userTeamId = userTeamResult.rows[0].team_id;
        isPlayer = match.player1_id === userTeamId || match.player2_id === userTeamId;
        
        if (!isCreator && !isPlayer) {
          return res.status(403).json({ error: 'You cannot record results for this match' });
        }

        // If the user is reporting, use their team_id as the winner
        if (!isCreator && isPlayer) {
          finalWinnerId = userTeamId;
        }
      }
    } else {
      // For non-team tournaments: check if user is one of the players
      isPlayer = match.player1_id === req.userId || match.player2_id === req.userId;

      if (!isCreator && !isPlayer) {
        return res.status(403).json({ error: 'You cannot record results for this match' });
      }
    }

    // Update tournament match with result
    await query(
      `UPDATE tournament_matches 
       SET winner_id = ?, match_id = ?, match_status = 'completed', played_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [finalWinnerId, reported_match_id || null, matchId]
    );

    // NOTE: Best Of series is already updated in /api/matches/report-json
    // We just need to verify the round is complete
    const roundMatchResult = await query(
      `SELECT round_id FROM tournament_matches WHERE id = ?`,
      [matchId]
    );

    if (roundMatchResult.rows.length > 0) {
      const roundId: string = roundMatchResult.rows[0].round_id;
      
      // Get round number to check if round is complete
      const roundNumberResult = await query(
        `SELECT round_number, tournament_id FROM tournament_rounds WHERE id = ?`,
        [roundId]
      );
      if (roundNumberResult.rows.length > 0) {
        const { round_number, tournament_id } = roundNumberResult.rows[0];
        await checkAndCompleteRound(tournament_id, round_number);
      }
    }

    res.json({
      message: 'Match result recorded'
    });
  } catch (error: any) {
    console.error('Error recording match result:', error);
    res.status(500).json({ error: 'Failed to record match result', details: error.message });
  }
});

// Organizer determines match winner manually (no ELO impact, tournament result only).
// Accepts optional `eliminate` (boolean) to control whether the loser is eliminated from the tournament.
// For elimination tournaments the loser is always eliminated regardless of the flag.
// For league tournaments with eliminate=true, ALL pending matches of the loser across ALL rounds are given as losses.
// For swiss tournaments with eliminate=true, the loser is marked as eliminated from future round draws.
router.post('/:tournamentId/matches/:matchId/determine-winner', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tournamentId, matchId } = req.params;
    const { winner_id, eliminate } = req.body;

    if (!winner_id) {
      return res.status(400).json({ error: 'winner_id is required' });
    }

    // Fetch tournament info and verify organizer
    const tournamentResult = await query(
      `SELECT creator_id, tournament_type, tournament_mode, name, discord_thread_id FROM tournaments WHERE id = ?`,
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const { creator_id, tournament_type, tournament_mode, name: tournamentName, discord_thread_id } = tournamentResult.rows[0];
    const isTeamMode = tournament_mode === 'team';

    if (creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only the tournament organizer can determine match winners' });
    }

    // Try to find match in tournament_round_matches first (the series itself)
    let roundMatchResult = await query(
      `SELECT trm.*, tr.round_type
       FROM tournament_round_matches trm
       JOIN tournament_rounds tr ON trm.round_id = tr.id
       WHERE trm.id = ? AND trm.tournament_id = ?`,
      [matchId, tournamentId]
    );

    let isRoundMatch = false;
    let roundId: string;
    let match: any;

    if (roundMatchResult.rows.length > 0) {
      // Found as a tournament_round_matches (series) 
      match = roundMatchResult.rows[0];
      isRoundMatch = true;
      roundId = match.round_id;

      if (winner_id !== match.player1_id && winner_id !== match.player2_id) {
        return res.status(400).json({ error: 'Winner must be one of the series participants' });
      }

      // Idempotency guard: prevent re-processing an already completed series (avoids double stats)
      if (match.series_status === 'completed') {
        return res.status(400).json({ error: 'This series has already been completed. Cannot re-determine the winner.' });
      }

      const loser_id = winner_id === match.player1_id ? match.player2_id : match.player1_id;
      const roundType = (match.round_type || 'general').toLowerCase();

      // Determine whether to eliminate the loser:
      // - Elimination tournaments: always
      // - Swiss_elimination in final phase: always
      // - League / Swiss / Swiss_elimination in general phase: only when caller sends eliminate=true
      const isEliminationType = tournament_type === 'elimination';
      const isEliminationPhase = tournament_type === 'swiss_elimination' && roundType === 'final';
      const shouldEliminate = isEliminationType || isEliminationPhase || (eliminate === true);

      // Step 1: Mark the series as completed with the winner
      await query(
        `UPDATE tournament_round_matches 
         SET winner_id = ?, 
             player1_wins = CASE WHEN player1_id = ? THEN player1_wins + 1 ELSE player1_wins END,
             player2_wins = CASE WHEN player2_id = ? THEN player2_wins + 1 ELSE player2_wins END,
             series_status = 'completed', 
             updated_at = NOW()
         WHERE id = ?`,
        [winner_id, winner_id, winner_id, matchId]
      );

      // Step 2: Mark all individual games in this series as organizer_win for the winner
      const seriesMatches = await query(
        `SELECT id, match_status FROM tournament_matches
         WHERE tournament_round_match_id = ?
         ORDER BY created_at`,
        [matchId]
      );
      for (const m of seriesMatches.rows) {
        if (m.match_status !== 'completed') {
          await query(
            `UPDATE tournament_matches
             SET winner_id = ?, match_status = 'completed', played_at = NOW(),
                 organizer_action = 'organizer_win', updated_at = NOW()
             WHERE id = ?`,
            [winner_id, m.id]
          );
        }
      }

      // Step 3: Update stats for the CURRENT series (winner +1 win +1 point, loser +1 loss)
      const updateSeriesStats = async (seriesWinnerId: string, seriesLoserId: string) => {
        if (isTeamMode) {
          await query(
            `UPDATE tournament_teams SET tournament_wins = tournament_wins + 1, tournament_points = tournament_points + 1 WHERE id = ?`,
            [seriesWinnerId]
          );
          await query(
            `UPDATE tournament_teams SET tournament_losses = tournament_losses + 1 WHERE id = ?`,
            [seriesLoserId]
          );
        } else {
          const winnerPart = await query(
            `SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
            [tournamentId, seriesWinnerId]
          );
          if (winnerPart.rows.length > 0) {
            await query(
              `UPDATE tournament_participants
               SET tournament_wins = tournament_wins + 1, tournament_points = tournament_points + 1
               WHERE id = ?`,
              [winnerPart.rows[0].id]
            );
          }
          const loserPart = await query(
            `SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
            [tournamentId, seriesLoserId]
          );
          if (loserPart.rows.length > 0) {
            await query(
              `UPDATE tournament_participants SET tournament_losses = tournament_losses + 1 WHERE id = ?`,
              [loserPart.rows[0].id]
            );
          }
        }
      };

      // Apply stats for current series
      await updateSeriesStats(winner_id, loser_id);

      // Step 4: If eliminating, forfeit ALL remaining pending series of the loser across all rounds
      let loserExtraSeriesCount = 0;
      if (shouldEliminate) {
        // Get all other pending/in_progress series for the loser in this tournament
        const loserPendingSeries = await query(
          `SELECT id, player1_id, player2_id FROM tournament_round_matches
           WHERE tournament_id = ? AND (player1_id = ? OR player2_id = ?)
             AND series_status IN ('in_progress', 'pending') AND id != ?`,
          [tournamentId, loser_id, loser_id, matchId]
        );

        loserExtraSeriesCount = loserPendingSeries.rows.length;
        console.log(`[determine-winner] shouldEliminate=true, found ${loserExtraSeriesCount} pending series to forfeit for loser=${loser_id}`);

        // Pass 1: mark all pending individual matches across forfeited series as organizer_loss
        for (const ps of loserPendingSeries.rows) {
          await query(
            `UPDATE tournament_matches
             SET match_status = 'completed', played_at = NOW(),
                 organizer_action = 'organizer_loss', updated_at = NOW()
             WHERE tournament_round_match_id = ? AND match_status != 'completed'`,
            [ps.id]
          );
        }

        // Pass 2: mark each forfeited series as completed, give opponent the win+stats
        for (const ps of loserPendingSeries.rows) {
          const opponentId = ps.player1_id === loser_id ? ps.player2_id : ps.player1_id;

          await query(
            `UPDATE tournament_round_matches
             SET winner_id = ?,
                 player1_wins = CASE WHEN player1_id = ? THEN player1_wins + 1 ELSE player1_wins END,
                 player2_wins = CASE WHEN player2_id = ? THEN player2_wins + 1 ELSE player2_wins END,
                 series_status = 'completed', updated_at = NOW()
             WHERE id = ?`,
            [opponentId, opponentId, opponentId, ps.id]
          );

          await updateSeriesStats(opponentId, loser_id);
        }

        // Mark loser as eliminated
        if (isTeamMode) {
          await query(`UPDATE tournament_teams SET status = 'eliminated' WHERE id = ?`, [loser_id]);
        } else {
          await query(
            `UPDATE tournament_participants SET status = 'eliminated' WHERE tournament_id = ? AND user_id = ?`,
            [tournamentId, loser_id]
          );
        }

        // Discord notification: eliminated + current standings
        if (discord_thread_id) {
          try {
            // Resolve eliminated entity name
            let eliminatedName = loser_id;
            if (isTeamMode) {
              const nameResult = await query(`SELECT name FROM tournament_teams WHERE id = ?`, [loser_id]);
              if (nameResult.rows.length > 0) eliminatedName = nameResult.rows[0].name;
            } else {
              const nameResult = await query(
                `SELECT u.username as nickname FROM tournament_participants tp
                 JOIN forum.phpbb3_users u ON tp.user_id = CAST(u.user_id AS CHAR)
                 WHERE tp.tournament_id = ? AND tp.user_id = ?`,
                [tournamentId, loser_id]
              );
              if (nameResult.rows.length > 0) eliminatedName = nameResult.rows[0].nickname;
            }

            // Fetch current standings
            let standingsRows: Array<{ nickname: string; points: number; wins: number; losses: number }> = [];
            if (isTeamMode) {
              const standingsResult = await query(
                `SELECT name as nickname, tournament_points as points, tournament_wins as wins, tournament_losses as losses
                 FROM tournament_teams WHERE tournament_id = ?
                 ORDER BY tournament_points DESC, tournament_wins DESC`,
                [tournamentId]
              );
              standingsRows = standingsResult.rows;
            } else {
              const standingsResult = await query(
                `SELECT u.username as nickname, tp.tournament_points as points, tp.tournament_wins as wins, tp.tournament_losses as losses
                 FROM tournament_participants tp
                 JOIN forum.phpbb3_users u ON tp.user_id = CAST(u.user_id AS CHAR)
                 WHERE tp.tournament_id = ?
                 ORDER BY tp.tournament_points DESC, tp.tournament_wins DESC`,
                [tournamentId]
              );
              standingsRows = standingsResult.rows;
            }

            await discordService.postEliminatedFromTournament(
              discord_thread_id,
              tournamentName,
              eliminatedName,
              standingsRows
            );
            console.log(`[determine-winner] Posted elimination Discord notification for ${eliminatedName}`);
          } catch (discordErr) {
            console.error('[determine-winner] Discord elimination notification error:', discordErr);
          }
        }
      }

      // Step 5: Check if the round is now complete
      const roundNumberResult = await query(
        `SELECT round_number, tournament_id FROM tournament_rounds WHERE id = ?`,
        [roundId]
      );
      if (roundNumberResult.rows.length > 0) {
        const { round_number, tournament_id } = roundNumberResult.rows[0];
        await checkAndCompleteRound(tournament_id, round_number);
      }

      console.log(`Tournament organizer ${req.userId} determined winner for series ${matchId}: winner=${winner_id}, loser=${loser_id}, eliminate=${shouldEliminate}, extraSeries=${loserExtraSeriesCount}`);

      res.json({
        message: 'Tournament round match (series) winner determined by organizer.',
        match: { id: matchId, winner_id, series_status: 'completed' }
      });
      return;
    }

    // Branch 2: individual tournament_match
    const matchResult = await query(
      `SELECT tm.*, tr.round_type
       FROM tournament_matches tm
       JOIN tournament_rounds tr ON tm.round_id = tr.id
       WHERE tm.id = ? AND tm.tournament_id = ?`,
      [matchId, tournamentId]
    );

    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Match not found in either tournament_matches or tournament_round_matches' });
    }

    match = matchResult.rows[0];
    roundId = match.round_id;
    const roundType2 = (match.round_type || 'general').toLowerCase();

    if (winner_id !== match.player1_id && winner_id !== match.player2_id) {
      return res.status(400).json({ error: 'Winner must be one of the match players' });
    }

    const loser_id = winner_id === match.player1_id ? match.player2_id : match.player1_id;

    const isEliminationType2 = tournament_type === 'elimination';
    const isEliminationPhase2 = tournament_type === 'swiss_elimination' && roundType2 === 'final';
    const shouldEliminate2 = isEliminationType2 || isEliminationPhase2 || (eliminate === true);

    // Mark this individual game as won by the winner
    await query(
      `UPDATE tournament_matches
       SET winner_id = ?, match_status = 'completed', played_at = NOW(),
           organizer_action = 'organizer_win', updated_at = NOW()
       WHERE id = ?`,
      [winner_id, matchId]
    );

    // Update the series this game belongs to (if any)
    const seriesId = match.tournament_round_match_id;
    if (seriesId) {
      const rmResult = await query(`SELECT * FROM tournament_round_matches WHERE id = ?`, [seriesId]);
      if (rmResult.rows.length > 0) {
        const rm = rmResult.rows[0];
        const p1_wins = rm.player1_wins + (winner_id === rm.player1_id ? 1 : 0);
        const p2_wins = rm.player2_wins + (winner_id === rm.player2_id ? 1 : 0);
        const seriesComplete = p1_wins >= rm.wins_required || p2_wins >= rm.wins_required;
        const newSeriesWinnerId = seriesComplete
          ? (p1_wins >= rm.wins_required ? rm.player1_id : rm.player2_id)
          : null;
        await query(
          `UPDATE tournament_round_matches
           SET player1_wins = ?, player2_wins = ?, series_status = ?, winner_id = ?, updated_at = NOW()
           WHERE id = ?`,
          [p1_wins, p2_wins, seriesComplete ? 'completed' : 'in_progress', newSeriesWinnerId, seriesId]
        );
        if (seriesComplete) {
          const remaining = await query(
            `SELECT id FROM tournament_matches WHERE tournament_round_match_id = ? AND match_status = 'pending'`,
            [seriesId]
          );
          for (const r of remaining.rows) {
            await query(
              `UPDATE tournament_matches
               SET winner_id = ?, match_status = 'completed', played_at = NOW(),
                   organizer_action = 'organizer_win', updated_at = NOW()
               WHERE id = ?`,
              [newSeriesWinnerId, r.id]
            );
          }
        }
      }
    }

    // Handle loser's other pending matches (when eliminating)
    let loserExtraLossCount = 0;
    if (shouldEliminate2) {
      // Mark ALL pending matches of loser across ALL rounds as losses
      const loserAllPending = await query(
        `SELECT id, player1_id, player2_id FROM tournament_matches
         WHERE tournament_id = ? AND (player1_id = ? OR player2_id = ?)
           AND match_status = 'pending' AND id != ?`,
        [tournamentId, loser_id, loser_id, matchId]
      );
      for (const pm of loserAllPending.rows) {
        const opponentId = pm.player1_id === loser_id ? pm.player2_id : pm.player1_id;
        await query(
          `UPDATE tournament_matches
           SET winner_id = ?, match_status = 'completed', played_at = NOW(),
               organizer_action = 'organizer_loss', updated_at = NOW()
           WHERE id = ?`,
          [opponentId, pm.id]
        );
        loserExtraLossCount++;
      }
      // Mark any other in-progress series of the loser as completed
      const otherSeriesFilter = seriesId ? ' AND id != ?' : '';
      const otherSeriesParams = seriesId
        ? [tournamentId, loser_id, loser_id, seriesId]
        : [tournamentId, loser_id, loser_id];
      const loserOtherSeries = await query(
        `SELECT id, player1_id, player2_id FROM tournament_round_matches
         WHERE tournament_id = ? AND (player1_id = ? OR player2_id = ?)
           AND series_status = 'in_progress'${otherSeriesFilter}`,
        otherSeriesParams
      );
      for (const ps of loserOtherSeries.rows) {
        const opponentId = ps.player1_id === loser_id ? ps.player2_id : ps.player1_id;
        await query(
          `UPDATE tournament_round_matches SET winner_id = ?, series_status = 'completed', updated_at = NOW() WHERE id = ?`,
          [opponentId, ps.id]
        );
      }
    }

    // Update stats
    if (isTeamMode) {
      await query(
        `UPDATE tournament_teams SET tournament_wins = tournament_wins + 1, tournament_points = tournament_points + 1 WHERE id = ?`,
        [winner_id]
      );
      const totalLosses = 1 + loserExtraLossCount;
      await query(
        `UPDATE tournament_teams SET tournament_losses = tournament_losses + ? WHERE id = ?`,
        [totalLosses, loser_id]
      );
      if (shouldEliminate2) {
        await query(`UPDATE tournament_teams SET status = 'eliminated' WHERE id = ?`, [loser_id]);
      }
    } else {
      const winnerPart = await query(
        `SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
        [tournamentId, winner_id]
      );
      if (winnerPart.rows.length > 0) {
        const totalWins = 1 + loserExtraLossCount;
        await query(
          `UPDATE tournament_participants
           SET tournament_wins = tournament_wins + ?, tournament_points = tournament_points + ?
           WHERE id = ?`,
          [totalWins, totalWins, winnerPart.rows[0].id]
        );
      }
      const loserPart = await query(
        `SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
        [tournamentId, loser_id]
      );
      if (loserPart.rows.length > 0) {
        const totalLosses = 1 + loserExtraLossCount;
        await query(
          `UPDATE tournament_participants SET tournament_losses = tournament_losses + ? WHERE id = ?`,
          [totalLosses, loserPart.rows[0].id]
        );
        if (shouldEliminate2) {
          await query(
            `UPDATE tournament_participants SET status = 'eliminated'
             WHERE tournament_id = ? AND user_id = ?`,
            [tournamentId, loser_id]
          );
        }
      }
    }

    // Check if round is complete
    const roundNumberResult2 = await query(
      `SELECT round_number, tournament_id FROM tournament_rounds WHERE id = ?`,
      [roundId]
    );
    if (roundNumberResult2.rows.length > 0) {
      const { round_number, tournament_id } = roundNumberResult2.rows[0];
      await checkAndCompleteRound(tournament_id, round_number);
    }

    console.log(`Tournament organizer ${req.userId} determined winner for match ${matchId}: winner=${winner_id}, loser=${loser_id}, eliminate=${shouldEliminate2}, extraLosses=${loserExtraLossCount}`);

    res.json({
      message: 'Match winner determined by organizer (no ELO impact).',
      match: { id: matchId, winner_id, match_status: 'completed' }
    });
  } catch (error: any) {
    console.error('Error determining match winner:', error);
    console.error('Error stack:', error.stack);
    console.error('Error code:', error.code);
    res.status(500).json({
      error: 'Failed to determine match winner',
      details: error.message,
      code: error.code
    });
  }
});

// Get all tournament matches (individual matches from tournament_matches table)
// NOTE: This MUST be after all specific POST routes like :matchId/determine-winner and :matchId/result
// to prevent Express from matching the generic route first
router.get('/:tournamentId/matches', async (req, res) => {
  try {
    const { tournamentId } = req.params;

    // First, get tournament mode
    const tournamentModeResult = await query(
      `SELECT tournament_mode FROM tournaments WHERE id = ?`,
      [tournamentId]
    );

    if (tournamentModeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentMode = tournamentModeResult.rows[0].tournament_mode || 'ranked';

    // Build dynamic query based on tournament mode
    let selectClause, joinClause;
    
    if (tournamentMode === 'team') {
      // Team mode: get team names from tournament_teams, match details from tournament_matches (NO fallback to matches for team mode)
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        tr.round_number,
        tt1.name as player1_nickname,
        tt2.name as player2_nickname,
        tt_winner.name as winner_nickname,
        (CASE WHEN tm.player1_id = tm.winner_id THEN tt2.name ELSE tt1.name END) as loser_nickname,
        tm.status as match_status_from_matches,
        tm.map,
        tm.winner_faction,
        tm.loser_faction,
        tm.winner_comments,
        tm.loser_comments,
        tm.winner_rating,
        tm.loser_rating,
        tm.replay_file_path,
        tm.replay_downloads as replay_downloads,
        tm.tournament_round_match_id,
        TRUE as is_team_mode,
        NULL as pending_replay_id,
        NULL as pending_replay_summary,
        NULL as pending_replay_confidence,
        NULL as pending_replay_need_integration,
        NULL as pending_replay_url,
        NULL as pending_replay_filename,
        NULL as pending_replay_game_name,
        NULL as pending_replay_cancel_requested_by,
        tm.created_at,
        tm.updated_at
      `;
      joinClause = `
        FROM tournament_matches tm
        JOIN tournament_rounds tr ON tm.round_id = tr.id
        LEFT JOIN tournament_teams tt1 ON tm.player1_id = tt1.id
        LEFT JOIN tournament_teams tt2 ON tm.player2_id = tt2.id
        LEFT JOIN tournament_teams tt_winner ON tm.winner_id = tt_winner.id
      `;
    } else if (tournamentMode === 'unranked') {
      // Unranked 1v1: get player names from users, match details from tournament_matches (match_id is NULL for unranked, so NO matches table data)
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        tr.round_number,
        u1.nickname as player1_nickname,
        u2.nickname as player2_nickname,
        uw.nickname as winner_nickname,
        (CASE WHEN tm.player1_id = tm.winner_id THEN u2.nickname ELSE u1.nickname END) as loser_nickname,
        tm.status as match_status_from_matches,
        tm.map,
        tm.winner_faction,
        tm.loser_faction,
        tm.winner_comments,
        tm.loser_comments,
        tm.winner_rating,
        tm.loser_rating,
        tm.replay_file_path,
        tm.replay_downloads as replay_downloads,
        tm.tournament_round_match_id,
        FALSE as is_team_mode,
        NULL as pending_replay_id,
        NULL as pending_replay_summary,
        NULL as pending_replay_confidence,
        NULL as pending_replay_need_integration,
        NULL as pending_replay_url,
        NULL as pending_replay_filename,
        NULL as pending_replay_game_name,
        NULL as pending_replay_cancel_requested_by,
        tm.created_at,
        tm.updated_at
      `;
      joinClause = `
        FROM tournament_matches tm
        JOIN tournament_rounds tr ON tm.round_id = tr.id
        LEFT JOIN users_extension u1 ON tm.player1_id = u1.id
        LEFT JOIN users_extension u2 ON tm.player2_id = u2.id
        LEFT JOIN users_extension uw ON tm.winner_id = uw.id
      `;
    } else {
      // Ranked 1v1: get player names from users, match details from matches table (via match_id link)
      selectClause = `
        tm.id,
        tm.tournament_id,
        tm.round_id,
        tm.player1_id,
        tm.player2_id,
        tm.winner_id,
        tm.match_id,
        tm.match_status,
        tm.played_at,
        tr.round_number,
        u1.nickname as player1_nickname,
        u2.nickname as player2_nickname,
        uw.nickname as winner_nickname,
        ul.nickname as loser_nickname,
        m.status as match_status_from_matches,
        m.map,
        m.winner_faction,
        m.loser_faction,
        m.winner_comments,
        m.loser_comments,
        m.winner_rating,
        m.loser_rating,
        m.replay_file_path,
        m.replay_downloads,
        tm.tournament_round_match_id,
        FALSE as is_team_mode,
        NULL as pending_replay_id,
        NULL as pending_replay_summary,
        NULL as pending_replay_confidence,
        NULL as pending_replay_need_integration,
        NULL as pending_replay_url,
        NULL as pending_replay_filename,
        NULL as pending_replay_game_name,
        NULL as pending_replay_cancel_requested_by,
        tm.created_at,
        tm.updated_at
      `;
      joinClause = `
        FROM tournament_matches tm
        JOIN tournament_rounds tr ON tm.round_id = tr.id
        LEFT JOIN users_extension u1 ON tm.player1_id = u1.id
        LEFT JOIN users_extension u2 ON tm.player2_id = u2.id
        LEFT JOIN matches m ON tm.match_id = m.id
        LEFT JOIN users_extension uw ON m.winner_id = uw.id
        LEFT JOIN users_extension ul ON m.loser_id = ul.id
      `;
    }

    // Query 1: Get completed matches from tournament_matches
    const matchesResult = await query(
      `SELECT ${selectClause}
       ${joinClause}
       WHERE tm.tournament_id = ?
       ORDER BY tr.round_number ASC, tm.created_at ASC`,
      [tournamentId]
    );

    // Query 2: Get pending replays (confidence=1, match_id IS NULL) from this tournament
    // These are parsed replays waiting for confirmation - frontend will display in "completed matches" section
    let pendingReplaysQuery = '';
    
    if (tournamentMode === 'team') {
      // Team mode: get team names from tournament_teams and team member lists
      pendingReplaysQuery = `
        SELECT
          pr.id as id,
          pr.id as pending_replay_id,
          pr.tournament_id,
          trm.round_id,
          trm.player1_id,
          trm.player2_id,
          tr.round_number,
          tt1.name as player1_nickname,
          tt2.name as player2_nickname,
          pr.parse_summary as pending_replay_summary,
          pr.integration_confidence as pending_replay_confidence,
          pr.need_integration as pending_replay_need_integration,
          pr.replay_url as pending_replay_url,
          pr.replay_filename as pending_replay_filename,
          pr.game_name as pending_replay_game_name,
          pr.cancel_requested_by as pending_replay_cancel_requested_by,
          pr.parse_status as pending_replay_parse_status,
          pr.created_at,
          pr.updated_at,
          'unconfirmed' as match_status,
          TRUE as is_team_mode,
          JSON_ARRAYAGG(DISTINCT IF(tp.team_id = trm.player1_id, ue.nickname, NULL)) as team1_members,
          JSON_ARRAYAGG(DISTINCT IF(tp.team_id = trm.player2_id, ue.nickname, NULL)) as team2_members
        FROM replays pr
        LEFT JOIN tournament_round_matches trm ON pr.tournament_round_match_id = trm.id
        LEFT JOIN tournament_rounds tr ON trm.round_id = tr.id
        LEFT JOIN tournament_teams tt1 ON trm.player1_id = tt1.id
        LEFT JOIN tournament_teams tt2 ON trm.player2_id = tt2.id
        LEFT JOIN tournament_participants tp ON (tp.team_id = trm.player1_id OR tp.team_id = trm.player2_id) AND tp.participation_status = 'accepted'
        LEFT JOIN users_extension ue ON tp.user_id = ue.id
        WHERE pr.tournament_id = ?
          AND pr.parse_status IN ('parsed', 'due')
          AND pr.integration_confidence = 1
          AND pr.match_id IS NULL
        GROUP BY pr.id
        ORDER BY tr.round_number ASC, pr.created_at ASC
      `;
    } else {
      // Unranked and ranked modes: get player names from users_extension
      pendingReplaysQuery = `
        SELECT
          pr.id as id,
          pr.id as pending_replay_id,
          pr.tournament_id,
          trm.round_id,
          trm.player1_id,
          trm.player2_id,
          tr.round_number,
          u1.nickname as player1_nickname,
          u2.nickname as player2_nickname,
          pr.parse_summary as pending_replay_summary,
          pr.integration_confidence as pending_replay_confidence,
          pr.need_integration as pending_replay_need_integration,
          pr.replay_url as pending_replay_url,
          pr.replay_filename as pending_replay_filename,
          pr.game_name as pending_replay_game_name,
          pr.cancel_requested_by as pending_replay_cancel_requested_by,
          pr.parse_status as pending_replay_parse_status,
          pr.created_at,
          pr.updated_at,
          'unconfirmed' as match_status,
          FALSE as is_team_mode
        FROM replays pr
        LEFT JOIN tournament_round_matches trm ON pr.tournament_round_match_id = trm.id
        LEFT JOIN tournament_rounds tr ON trm.round_id = tr.id
        LEFT JOIN users_extension u1 ON trm.player1_id = u1.id
        LEFT JOIN users_extension u2 ON trm.player2_id = u2.id
        WHERE pr.tournament_id = ?
          AND pr.parse_status IN ('parsed', 'due')
          AND pr.integration_confidence = 1
          AND pr.match_id IS NULL
        ORDER BY tr.round_number ASC, pr.created_at ASC
      `;
    }
    const pendingReplaysResult = await query(pendingReplaysQuery, [tournamentId]);

    // Combine results and sort
    const allMatches = [...matchesResult.rows, ...pendingReplaysResult.rows];
    
    // Sort combined results by round number and created_at
    allMatches.sort((a, b) => {
      if (a.round_number !== b.round_number) {
        return a.round_number - b.round_number;
      }
      return new Date(a.created_at || a.updated_at || 0).getTime() - 
             new Date(b.created_at || b.updated_at || 0).getTime();
    });

    res.json(allMatches);
  } catch (error) {
    console.error('Error fetching tournament matches:', error);
    res.status(500).json({ error: 'Failed to fetch tournament matches' });
  }
});

// Activate next round - moves to the following round and generates new matches
router.post('/:id/next-round', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // Verify creator owns this tournament
    const tournamentResult = await query(
      'SELECT id, creator_id, status, tournament_type FROM tournaments WHERE id = ?',
      [id]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournament = tournamentResult.rows[0];

    // Only creator can activate next round
    if (tournament.creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only tournament creator can activate next round' });
    }

    // Tournament must be in progress
    if (tournament.status !== 'in_progress') {
      return res.status(400).json({ error: 'Tournament must be in progress to activate next round' });
    }

    // League tournaments have all rounds open simultaneously — this endpoint does not apply
    if (tournament.tournament_type === 'league') {
      return res.status(400).json({ error: 'League tournaments have all rounds open simultaneously. Manual round advancement is not applicable.' });
    }

    // Find the currently completed round (most recent completed round)
    const activeRoundResult = await query(
      `SELECT round_number FROM tournament_rounds 
       WHERE tournament_id = ? AND round_status = 'completed'
       ORDER BY round_number DESC LIMIT 1`,
      [id]
    );

    if (activeRoundResult.rows.length === 0) {
      return res.status(400).json({ error: 'No completed round found. Start tournament and complete at least one round first' });
    }

    const currentRoundNum = activeRoundResult.rows[0].round_number;
    const nextRoundNum = currentRoundNum + 1;

    // Find next round record
    const nextRoundResult = await query(
      `SELECT id FROM tournament_rounds 
       WHERE tournament_id = ? AND round_number = ?`,
      [id, nextRoundNum]
    );

    if (nextRoundResult.rows.length === 0) {
      return res.status(400).json({ error: `No round ${nextRoundNum} configured for this tournament` });
    }

    const nextRoundId = nextRoundResult.rows[0].id;

    // Activate the next round
    await activateRound(id, nextRoundNum);

    console.log(`✅ Activated next round: tournament=${id}, round_number=${nextRoundNum}`);

    // Get tournament info for Discord notification
    const tournamentInfoForNotify = await query(
      'SELECT discord_thread_id FROM tournaments WHERE id = ?',
      [id]
    );

    // Get round details for Discord notification
    const roundDetailsResult2 = await query(
      `SELECT COUNT(*) as match_count FROM tournament_matches tm
       JOIN tournament_rounds tr ON tm.round_id = tr.id
       WHERE tr.tournament_id = ? AND tr.round_number = ?`,
      [id, nextRoundNum]
    );
    const matchesCount2 = parseInt(roundDetailsResult2.rows[0]?.match_count || '0');

    // Post round started notification to Discord
    if (tournamentInfoForNotify.rows[0]?.discord_thread_id) {
      try {
        const estimatedEndDate2 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await discordService.postRoundStarted(
          tournamentInfoForNotify.rows[0].discord_thread_id,
          nextRoundNum,
          matchesCount2,
          estimatedEndDate2
        );
      } catch (discordErr) {
        console.error('Discord round start notification error:', discordErr);
      }

      // Post matchups notification to Discord
      try {
        // Detect tournament mode to fetch correct names
        const tmodeResult = await query(
          'SELECT tournament_mode FROM tournaments WHERE id = ?',
          [id]
        );
        const isTeamMode = tmodeResult.rows[0]?.tournament_mode === 'team';
        
        let matchupsResult;
        if (isTeamMode) {
          // Team mode: JOIN with tournament_teams
          matchupsResult = await query(
            `SELECT trm.player1_id, trm.player2_id, tt1.name as player1_nickname, tt2.name as player2_nickname
             FROM tournament_round_matches trm
             LEFT JOIN tournament_teams tt1 ON trm.player1_id = tt1.id
             LEFT JOIN tournament_teams tt2 ON trm.player2_id = tt2.id
             WHERE trm.round_id = ?`,
            [nextRoundId]
          );
        } else {
          // Individual mode: JOIN with users_extension
          matchupsResult = await query(
            `SELECT trm.player1_id, trm.player2_id, u1.nickname as player1_nickname, u2.nickname as player2_nickname
             FROM tournament_round_matches trm
             LEFT JOIN users_extension u1 ON trm.player1_id = u1.id
             LEFT JOIN users_extension u2 ON trm.player2_id = u2.id
             WHERE trm.round_id = ?`,
            [nextRoundId]
          );
        }
        
        if (matchupsResult.rows.length > 0) {
          const matchups = matchupsResult.rows.map(m => ({
            player1: m.player1_nickname || 'Unknown',
            player2: m.player2_nickname || 'Unknown'
          }));
          
          await discordService.postMatchups(
            tournamentInfoForNotify.rows[0].discord_thread_id,
            nextRoundNum,
            matchups
          );
        }
      } catch (discordErr) {
        console.error('Discord matchups notification error:', discordErr);
      }
    }

    res.json({ 
      message: `Round ${nextRoundNum} activated successfully`,
      round_number: nextRoundNum,
      round_id: nextRoundId
    });
  } catch (error) {
    console.error('Error activating next round:', error);
    res.status(500).json({ error: 'Failed to activate next round', details: String(error) });
  }
});

// ============================================================================
// NEW ENDPOINTS: Tournament Modes Support (Liga, Suizo, Suizo Mixto, Eliminación Mejorada)
// ============================================================================

/**
 * GET /api/tournaments/:id/config
 * Get tournament full configuration including new mode fields
 */
router.get('/:id/config', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    const rows = await query(
      `SELECT * FROM tournaments WHERE tournament_id = ?`,
      [id]
    );
    
    if (!rows || !rows.rows || rows.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    
    res.json(rows.rows[0]);
  } catch (error) {
    console.error('Error fetching tournament config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/tournaments/suggestions/by-count
 * Get tournament type suggestions based on participant count
 */
router.get('/suggestions/by-count', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { participant_count } = req.query;
    
    if (!participant_count) {
      return res.status(400).json({ error: 'participant_count query parameter is required' });
    }
    
    const count = Number(participant_count);
    const suggestions: Record<string, any> = {};
    
    // Liga suggestions
    if (count >= 4 && count <= 32) {
      suggestions.league = {
        league_type: count <= 8 ? 'double_round' : 'single_round',
        series_format: count <= 8 ? 'bo1' : 'bo1',
        estimated_matches: count <= 8 
          ? count * (count - 1)  // double round
          : Math.floor(count * (count - 1) / 2),
      };
    }
    
    // Suizo suggestions
    if (count >= 4) {
      const swissRounds = 
        count <= 8 ? 3 :
        count <= 16 ? 4 :
        count <= 32 ? 5 : 6;
      
      suggestions.swiss = {
        swiss_rounds: swissRounds,
        series_format: 'bo1',
        estimated_matches: swissRounds * Math.floor(count / 2),
      };
    }
    
    // Suizo Mixto suggestions
    if (count >= 8) {
      let swissRounds = 0;
      let finalists = 0;
      
      if (count <= 15) {
        swissRounds = 3;
        finalists = 4;
      } else if (count <= 31) {
        swissRounds = 4;
        finalists = 8;
      } else if (count <= 63) {
        swissRounds = 5;
        finalists = 16;
      } else {
        swissRounds = 5;
        finalists = 16;
      }
      
      suggestions.swiss_hybrid = {
        swiss_hybrid_rounds: swissRounds,
        finalists_count: finalists,
        estimated_matches: swissRounds * Math.floor(count / 2) + (finalists - 1),
      };
    }
    
    // Eliminación suggestions
    if (count >= 2) {
      const nearestPowerOf2 = 
        count <= 2 ? 2 :
        count <= 4 ? 4 :
        count <= 8 ? 8 :
        count <= 16 ? 16 :
        count <= 32 ? 32 :
        count <= 64 ? 64 : 128;
      
      suggestions.elimination = {
        elimination_type: 'single',
        finalists_count: nearestPowerOf2,
        series_format_eliminations: count <= 8 ? 'bo1' : 'bo1',
        series_format_final: 'bo3',
        estimated_matches: nearestPowerOf2 - 1,
      };
    }
    
    res.json({ suggestions });
  } catch (error) {
    console.error('Error generating tournament suggestions:', error);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

/**
 * GET /api/tournaments/:id/standings
 * Get tournament standings (PUBLIC - for viewing tournament info)
 * Supports both 1v1 mode (tournament_participants) and team mode (tournament_teams)
 */
router.get('/:id/standings', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get tournament mode and type first
    const tournamentModeResult = await query(
      `SELECT tournament_mode, tournament_type FROM tournaments WHERE id = ?`,
      [id]
    );

    if (tournamentModeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const isTournamentTeamMode = tournamentModeResult.rows[0].tournament_mode === 'team';
    const tournamentType = tournamentModeResult.rows[0].tournament_type;
    const isSwissElimination = tournamentType === 'swiss_elimination';

    if (isTournamentTeamMode) {
      // Team mode: return team standings with member user_ids
      let orderBy = 'tt.tournament_ranking IS NULL, tt.tournament_ranking ASC, (tt.tournament_wins - tt.tournament_losses) DESC, tt.omp DESC, tt.gwp DESC, tt.ogp DESC, team_total_elo DESC';
      
      // For Swiss-Elimination Mix: Order by current_round (how far they advanced) first
      if (isSwissElimination) {
        orderBy = `
          CASE 
            WHEN tt.status = 'active' THEN 0  -- Active team (winner) comes first
            ELSE 1                              -- Eliminated teams after
          END,
          tt.current_round DESC,  -- Furthest round first
          CASE 
            WHEN tt.status = 'active' THEN 0   -- Among same round, active first
            ELSE 1
          END,
          (tt.tournament_wins - tt.tournament_losses) DESC, 
          tt.omp DESC, 
          tt.gwp DESC, 
          tt.ogp DESC,
          team_total_elo DESC
        `;
      }
      
      const teamStandings = await query(
        `SELECT 
          tt.id,
          tt.name as nickname,
          tt.tournament_wins as tournament_wins,
          tt.tournament_losses as tournament_losses,
          tt.tournament_points as tournament_points,
          tt.tournament_ranking as tournament_ranking,
          tt.current_round as current_round,
          tt.omp,
          tt.gwp,
          tt.ogp,
          tt.status,
          COUNT(DISTINCT tp.user_id) as team_size,
          GROUP_CONCAT(DISTINCT tp.user_id) as member_user_ids,
          COALESCE(SUM(u.elo_rating), 0) as team_total_elo,
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'participant_id', tp.id,
              'user_id', tp.user_id,
              'nickname', u.nickname,
              'elo_rating', u.elo_rating,
              'team_position', tp.team_position,
              'participation_status', tp.participation_status
            )
          ) as members_with_elo
         FROM tournament_teams tt
         LEFT JOIN tournament_participants tp ON tp.team_id = tt.id AND tp.team_id != ?
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tt.tournament_id = ? AND tt.id != ?
         GROUP BY tt.id
         ORDER BY 
           CASE WHEN tt.id = ? THEN 1 ELSE 0 END ASC,
           ${orderBy}`,
        [REJECTED_TEAM_ID, id, REJECTED_TEAM_ID, REJECTED_TEAM_ID]
      );

      // Parse members_with_elo JSON and ensure it's an array
      const parsedStandings = (teamStandings && teamStandings.rows) 
        ? teamStandings.rows.map((row: any) => ({
            ...row,
            members_with_elo: row.members_with_elo 
              ? (typeof row.members_with_elo === 'string' 
                  ? JSON.parse(row.members_with_elo) 
                  : Array.isArray(row.members_with_elo) 
                    ? row.members_with_elo 
                    : [])
              : []
          }))
        : [];

      res.json({ 
        standings: parsedStandings,
        mode: 'team'
      });
    } else {
      // 1v1 mode: return player standings
      let orderBy1v1 = 'tp.tournament_points DESC, tp.omp DESC, tp.gwp DESC, tp.ogp DESC, u.elo_rating DESC';
      
      // For Swiss-Elimination Mix: Order by current_round (how far they advanced) first
      if (isSwissElimination) {
        orderBy1v1 = `
          CASE 
            WHEN tp.status = 'active' THEN 0  -- Active player (winner) comes first
            ELSE 1                              -- Eliminated players after
          END,
          tp.current_round DESC,  -- Furthest round first
          CASE 
            WHEN tp.status = 'active' THEN 0   -- Among same round, active first
            ELSE 1
          END,
          (tp.tournament_wins - tp.tournament_losses) DESC,
          tp.omp DESC, 
          tp.gwp DESC, 
          tp.ogp DESC,
          u.elo_rating DESC
        `;
      }
      
      const playerStandings = await query(
        `SELECT tp.*, u.nickname, u.elo_rating
         FROM tournament_participants tp
         LEFT JOIN users_extension u ON tp.user_id = u.id
         WHERE tp.tournament_id = ? AND (tp.team_id IS NULL OR tp.team_id != ?)
         ORDER BY ${orderBy1v1}`,
        [id, REJECTED_TEAM_ID]
      );
      
      res.json({ 
        standings: (playerStandings && playerStandings.rows) ? playerStandings.rows : [],
        mode: '1v1'
      });
    }
  } catch (error) {
    console.error('Error fetching standings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


/**
 * GET /api/tournaments/:id/swiss-pairings/:round_id
 * Get Swiss system pairings for a round
 */
router.get('/:id/swiss-pairings/:round_id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id, round_id } = req.params;
    
    const pairings = await query(
      `SELECT * FROM swiss_pairings 
       WHERE tournament_id = ? AND tournament_round_id = ? 
       ORDER BY pairing_number ASC`,
      [id, round_id]
    );
    
    res.json({ pairings: (pairings && pairings.rows) ? pairings.rows : [] });
  } catch (error) {
    console.error('Error fetching swiss pairings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/tournaments/:id/calculate-tiebreakers
 * Calculate Swiss tiebreakers (OMP, GWP, OGP) for tournament participants
 * Only admins or tournament creators can call this endpoint
 */
router.post('/:id/calculate-tiebreakers', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is admin or tournament creator
    const tournamentQuery = await query(
      'SELECT creator_id FROM tournaments WHERE tournament_id = ?',
      [id]
    );
    
    if (!tournamentQuery || !tournamentQuery.rows || tournamentQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }
    
    const tournament = tournamentQuery.rows[0];
    const userQuery = await query(
      'SELECT is_admin FROM users_extension WHERE user_id = ?',
      [req.userId]
    );
    
    const isAdmin = userQuery && userQuery.rows && userQuery.rows.length > 0 && userQuery.rows[0].is_admin;
    const isCreator = tournament.creator_id === req.userId;
    
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ error: 'Only admins or tournament creators can calculate tiebreakers' });
    }

    // Determine tournament mode to use appropriate function
    const functionName = tournament.tournament_mode === 'team' ? 'update_team_tiebreakers' : 'update_tournament_tiebreakers';
    
    // Execute the stored procedure
    const result = await query(
      `SELECT updated_count, error_message FROM ${functionName}(?)`,
      [id]
    );
    
    if (result && result.rows && result.rows.length > 0 && result.rows[0].error_message) {
      return res.status(400).json({ 
        error: 'Failed to calculate tiebreakers',
        details: result.rows[0].error_message
      });
    }
    
    const updatedCount = result && result.rows && result.rows.length > 0 ? result.rows[0].updated_count : 0;
    
    // Fetch updated participants ordered by tiebreakers
    const participants = await query(
      `SELECT * FROM tournament_participants 
       WHERE tournament_id = ? 
       ORDER BY tournament_points DESC, omp DESC, gwp DESC, ogp DESC`,
      [id]
    );
    
    res.json({
      success: true,
      message: `Tiebreakers calculated for ${updatedCount} participants`,
      updated_count: updatedCount,
      participants: (participants && participants.rows) ? participants.rows : []
    });
  } catch (error) {
    console.error('Error calculating tiebreakers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/leagues/:id/calculate-tiebreakers
 * Calculate League tiebreakers (OMP, GWP, OGP) for tournament participants (league tournaments)
 * Only admins or league creators can call this endpoint
 */
router.post('/leagues/:id/calculate-tiebreakers', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is admin or tournament creator
    const tournamentQuery = await query(
      'SELECT creator_id FROM tournaments WHERE tournament_id = ?',
      [id]
    );
    
    if (!tournamentQuery || !tournamentQuery.rows || tournamentQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament (league) not found' });
    }
    
    const tournament = tournamentQuery.rows[0];
    const userQuery = await query(
      'SELECT is_admin FROM users_extension WHERE user_id = ?',
      [req.userId]
    );
    
    const isAdmin = userQuery && userQuery.rows && userQuery.rows.length > 0 && userQuery.rows[0].is_admin;
    const isCreator = tournament.creator_id === req.userId;
    
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ error: 'Only admins or tournament creators can calculate tiebreakers' });
    }
    
    // Execute the stored procedure (using update_tournament_tiebreakers which has identical logic)
    const result = await query(
      'SELECT updated_count, error_message FROM update_tournament_tiebreakers(?)',
      [id]
    );
    
    if (result && result.rows && result.rows.length > 0 && result.rows[0].error_message) {
      return res.status(400).json({ 
        error: 'Failed to calculate tiebreakers',
        details: result.rows[0].error_message
      });
    }
    
    const updatedCount = result && result.rows && result.rows.length > 0 ? result.rows[0].updated_count : 0;
    
    // Fetch updated participants ordered by: tournament_points DESC, omp DESC, gwp DESC, ogp DESC
    const participants = await query(
      `SELECT * FROM tournament_participants 
       WHERE tournament_id = ? 
       ORDER BY tournament_points DESC, omp DESC, gwp DESC, ogp DESC`,
      [id]
    );
    
    res.json({
      success: true,
      message: `Tiebreakers calculated for ${updatedCount} participants`,
      updated_count: updatedCount,
      participants: (participants && participants.rows) ? participants.rows : []
    });
  } catch (error) {
    console.error('Error calculating league tiebreakers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST notify tournament results to Discord
router.post('/:id/notify-results', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    console.log(`\n📢 [NOTIFY RESULTS] Starting notification for tournament ${id}`);

    // Get tournament
    const tournamentResult = await query(
      'SELECT id, creator_id, name, discord_thread_id, status, tournament_mode FROM tournaments WHERE id = ?',
      [id]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tournament not found' });
    }

    const tournament = tournamentResult.rows[0];
    
    // Only tournament organizer can notify results
    if (tournament.creator_id !== req.userId) {
      return res.status(403).json({ success: false, error: 'Only tournament organizer can notify results' });
    }

    if (!tournament.discord_thread_id) {
      return res.status(400).json({ success: false, error: 'Tournament has no Discord thread configured' });
    }

    if (tournament.status === 'in_progress') {
      // Get current standings
      let standingsRows: any[] = [];
      if (tournament.tournament_mode === 'team') {
        const result = await query(
          `SELECT tt.name as nickname, tt.tournament_points as points,
                  tt.tournament_wins as wins, tt.tournament_losses as losses
           FROM tournament_teams tt
           WHERE tt.tournament_id = ?
           ORDER BY tt.tournament_points DESC, tt.tournament_wins DESC`,
          [id]
        );
        standingsRows = result.rows;
      } else {
        const result = await query(
          `SELECT u.nickname, tp.tournament_points as points,
                  tp.tournament_wins as wins, tp.tournament_losses as losses
           FROM tournament_participants tp
           JOIN users_extension u ON tp.user_id = u.id
           WHERE tp.tournament_id = ?
           ORDER BY tp.tournament_points DESC, tp.tournament_wins DESC`,
          [id]
        );
        standingsRows = result.rows;
      }

      // Get current round number
      const currentRoundResult = await query(
        `SELECT round_number FROM tournament_rounds 
         WHERE tournament_id = ? AND round_status = 'in_progress'
         LIMIT 1`,
        [id]
      );
      const currentRound = currentRoundResult.rows[0]?.round_number || 1;

      // Get total rounds
      const totalRoundsResult = await query(
        `SELECT COUNT(*) as total_rounds FROM tournament_rounds WHERE tournament_id = ?`,
        [id]
      );
      const totalRounds = parseInt(totalRoundsResult.rows[0]?.total_rounds || 0);

      // Post standings notification
      await discordService.postLeagueRoundCompleted(
        tournament.discord_thread_id,
        currentRound,
        totalRounds,
        standingsRows
      );
      console.log(`✅ [NOTIFY RESULTS] Posted standings for round ${currentRound}/${totalRounds}`);
    } else if (tournament.status === 'finished') {
      // Get final standings
      let standingsRows: any[] = [];
      if (tournament.tournament_mode === 'team') {
        const result = await query(
          `SELECT tt.name as nickname, tt.tournament_points as points,
                  tt.tournament_wins as wins, tt.tournament_losses as losses
           FROM tournament_teams tt
           WHERE tt.tournament_id = ?
           ORDER BY tt.tournament_points DESC, tt.tournament_wins DESC`,
          [id]
        );
        standingsRows = result.rows;
      } else {
        const result = await query(
          `SELECT u.nickname, tp.tournament_points as points,
                  tp.tournament_wins as wins, tp.tournament_losses as losses
           FROM tournament_participants tp
           JOIN users_extension u ON tp.user_id = u.id
           WHERE tp.tournament_id = ?
           ORDER BY tp.tournament_points DESC, tp.tournament_wins DESC`,
          [id]
        );
        standingsRows = result.rows;
      }

      // Get total rounds for context in standings notification
      const totalRoundsResult = await query(
        `SELECT COUNT(*) as total_rounds FROM tournament_rounds WHERE tournament_id = ?`,
        [id]
      );
      const totalRounds = parseInt(totalRoundsResult.rows[0]?.total_rounds || 0);

      // Post final standings notification
      await discordService.postLeagueRoundCompleted(
        tournament.discord_thread_id,
        totalRounds,
        totalRounds,
        standingsRows
      );
      console.log(`✅ [NOTIFY RESULTS] Posted final standings`);

      // Then get winner and runner-up and post tournament finished notification
      const { winner, runnerUp } = await getWinnerAndRunnerUp(id);

      if (winner) {
        await discordService.postTournamentFinished(
          tournament.discord_thread_id,
          tournament.name,
          winner.nickname || 'Unknown',
          runnerUp?.nickname || 'N/A'
        );
        console.log(`✅ [NOTIFY RESULTS] Posted tournament finished notification - Winner: ${winner.nickname}`);
      } else {
        return res.status(400).json({ success: false, error: 'Could not determine tournament winner' });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Tournament must be in progress or finished to notify results' });
    }

    res.json({ success: true, message: 'Results notified successfully' });
  } catch (error) {
    console.error('Error notifying results:', error);
    res.status(500).json({ success: false, error: 'Failed to notify results' });
  }
});

export default router;



// Handle tournament match disputes (for organizers)
router.post('/:tournamentId/matches/:matchId/dispute', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { tournamentId, matchId } = req.params;
    const { action } = req.body; // 'confirm' or 'dismiss'

    console.log(`[DISPUTE API] Request received - tournamentId: ${tournamentId}, matchId: ${matchId}, action: ${action}, userId: ${req.userId}`);

    // Verify user is tournament organizer
    const tournamentResult = await query(
      'SELECT creator_id FROM tournaments WHERE id = ?',
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournamentResult.rows[0].creator_id !== req.userId) {
      return res.status(403).json({ error: 'Only tournament organizer can manage disputes' });
    }

    // Get the tournament match
    const matchResult = await query(
      'SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?',
      [matchId, tournamentId]
    );

    if (matchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournament match not found' });
    }

    const match = matchResult.rows[0];

    if (match.status !== 'disputed') {
      return res.status(400).json({ error: 'Match is not in disputed status' });
    }

    if (action === 'confirm') {
      // Confirm the dispute: revert the match result and stats
      const winnerId = match.winner_id;
      const loserId = match.loser_id;

      // Revert winner stats: -1 win, -1 point (no draws in unranked tournaments)
      await query(
        `UPDATE tournament_participants 
         SET tournament_wins = tournament_wins - 1,
             tournament_points = tournament_points - 1
         WHERE tournament_id = ? AND user_id = ?`,
        [tournamentId, winnerId]
      );

      // Revert loser stats: -1 loss
      await query(
        `UPDATE tournament_participants 
         SET tournament_losses = tournament_losses - 1
         WHERE tournament_id = ? AND user_id = ?`,
        [tournamentId, loserId]
      );

      // Reset match to pending - clear all match result fields as if it was never played
      await query(
        `UPDATE tournament_matches 
         SET match_status = 'pending',
             status = 'unconfirmed',
             winner_id = NULL,
             loser_id = NULL,
             winner_faction = NULL,
             loser_faction = NULL,
             map = NULL,
             winner_comment = NULL,
             winner_rating = NULL,
             replay = NULL,
             played_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [matchId]
      );

      // Check if round is completed and reopen it if needed
      const roundResult = await query(
        `SELECT id FROM tournament_rounds 
         WHERE tournament_id = ? AND id = ? AND round_status = 'completed'`,
        [tournamentId, match.round_id]
      );

      if (roundResult.rows.length > 0) {
        await query(
          `UPDATE tournament_rounds 
           SET round_status = 'in_progress',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [match.round_id]
        );
      }

      console.log(`Tournament match ${matchId} dispute confirmed by organizer ${req.userId} - stats reverted, match reset to pending`);
      res.json({ message: 'Dispute confirmed. Match stats have been reverted and match reset to pending.' });
    } else if (action === 'dismiss') {
      // Dismiss the dispute: keep original result
      await query(
        'UPDATE tournament_matches SET match_status = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', 'confirmed', matchId]
      );

      console.log(`Tournament match ${matchId} dispute dismissed by organizer ${req.userId}`);
      res.json({ message: 'Dispute dismissed. Original match result confirmed.' });
    } else {
      res.status(400).json({ error: 'Invalid action. Use "confirm" or "dismiss"' });
    }
  } catch (error) {
    console.error('Error handling tournament match dispute:', error);
    res.status(500).json({ error: 'Failed to handle dispute' });
  }
});

// ─────────────────────────────────────────────────────────────
// Rename tournament team
// Allowed: organizer, any team member, tournament moderator, admin
// ─────────────────────────────────────────────────────────────
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
    const isOrganizer = tournament.creator_id === userId;

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
    if (['in_progress', 'completed'].includes(tournament.status)) {
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
    const isOrganizer = tournament.creator_id === userId;

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
