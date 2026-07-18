import type { PoolConnection } from 'mysql2/promise';
import { pool, query } from '../config/database.js';
import { validateTournamentFormat } from './formatValidator.js';
import type { PhaseDefinition, TournamentFormatDefinition } from './types.js';

async function insertSettings(connection: PoolConnection, phase: PhaseDefinition): Promise<void> {
  if (phase.format === 'swiss' && phase.swiss) {
    await connection.execute(
      `INSERT INTO tournament_swiss_settings (phase_id, round_count, pairing_policy, avoid_rematches)
       VALUES (?, ?, ?, ?)`,
      [phase.id, phase.swiss.round_count, phase.swiss.pairing_policy || 'score_then_tiebreak', phase.swiss.avoid_rematches === false ? 0 : 1]
    );
  } else if (phase.format === 'round_robin' && phase.round_robin) {
    await connection.execute(
      `INSERT INTO tournament_round_robin_settings (phase_id, cycle_count, open_rounds_together)
       VALUES (?, ?, ?)`,
      [phase.id, phase.round_robin.cycle_count, phase.round_robin.open_rounds_together === false ? 0 : 1]
    );
  } else if (phase.format === 'single_elimination') {
    await connection.execute(
      `INSERT INTO tournament_elimination_settings (phase_id, bracket_size, seeding_policy, reseed_each_round)
       VALUES (?, ?, ?, ?)`,
      [phase.id, phase.elimination?.bracket_size ?? null, phase.elimination?.seeding_policy || 'seeded', phase.elimination?.reseed_each_round ? 1 : 0]
    );
  }

  const profileCode = phase.format === 'round_robin' ? 'standard_league' : 'standard_swiss';
  await connection.execute(
    `INSERT INTO tournament_phase_scoring (phase_id, profile_code, win_points, loss_points, bye_points)
     VALUES (?, ?, 1.00, 0.00, 1.00)`,
    [phase.id, profileCode]
  );
  for (const [index, metric] of ['wins', 'omp', 'gwp', 'ogp', 'elo'].entries()) {
    await connection.execute(
      `INSERT INTO tournament_phase_tiebreakers (phase_id, priority, metric) VALUES (?, ?, ?)`,
      [phase.id, index + 1, metric]
    );
  }
  for (const override of phase.round_overrides || []) {
    await connection.execute(
      `INSERT INTO tournament_phase_round_overrides
         (id, phase_id, round_from_start, round_from_end, best_of)
       VALUES (?, ?, ?, ?, ?)`,
      [override.id, phase.id, override.round_from_start ?? null, override.round_from_end ?? null, override.best_of]
    );
  }
}

/** Atomically replace a configurable tournament's declarative phase graph. */
export async function saveTournamentFormat(tournamentId: string, definition: TournamentFormatDefinition): Promise<void> {
  const validation = validateTournamentFormat(definition);
  if (!validation.valid) {
    const error = new Error('Tournament format is invalid') as Error & { issues?: unknown };
    error.issues = validation.issues;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tournaments] = await connection.execute<any[]>(
      `SELECT status, tournament_mode FROM tournaments WHERE id = ? FOR UPDATE`,
      [tournamentId]
    );
    if (tournaments.length === 0) throw new Error('Tournament not found');
    if (!['registration_open', 'registration_closed'].includes(tournaments[0].status)) {
      throw new Error('Tournament format can only be edited before preparation');
    }

    await connection.execute(`DELETE FROM tournament_phases WHERE tournament_id = ?`, [tournamentId]);
    for (const phase of [...definition.phases].sort((a, b) => a.order - b.order)) {
      await connection.execute(
        `INSERT INTO tournament_phases
           (id, tournament_id, phase_order, name, description, format, assignment_method,
            default_best_of, status, auto_start)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [phase.id, tournamentId, phase.order, phase.name.trim(), phase.description?.trim() || null,
          phase.format, phase.assignment_method, phase.default_best_of, phase.auto_start ? 1 : 0]
      );
      await insertSettings(connection, phase);
      for (const group of [...phase.groups].sort((a, b) => a.order - b.order)) {
        await connection.execute(
          `INSERT INTO tournament_phase_groups (id, phase_id, group_order, name, status)
           VALUES (?, ?, ?, ?, 'pending')`,
          [group.id, phase.id, group.order, group.name.trim()]
        );
        for (const [seedIndex, sourceId] of (group.entry_ids || []).entries()) {
          const entityColumn = phase.assignment_method === 'manual'
            ? (tournaments[0].tournament_mode === 'team' ? 'team_id' : 'participant_id')
            : null;
          if (!entityColumn) continue;
          await connection.execute(
            `INSERT INTO tournament_phase_entry_assignments
               (id, group_id, ${entityColumn}, group_seed)
             VALUES (UUID(), ?, ?, ?)`,
            [group.id, sourceId, seedIndex + 1]
          );
        }
      }
    }
    for (const rule of definition.advancement_rules || []) {
      await connection.execute(
        `INSERT INTO tournament_advancement_rules
           (id, source_group_id, source_rank, target_group_id, target_seed)
         VALUES (?, ?, ?, ?, ?)`,
        [rule.id, rule.source_group_id, rule.source_rank, rule.target_group_id, rule.target_seed]
      );
    }
    await connection.execute(
      `UPDATE tournaments SET competition_model_version = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [tournamentId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Return the declarative graph in the same shape accepted by the write endpoint. */
export async function getTournamentFormat(tournamentId: string): Promise<TournamentFormatDefinition> {
  const [phasesResult, groupsResult, assignmentsResult, swissResult, leagueResult, eliminationResult, overridesResult, rulesResult] = await Promise.all([
    query(`SELECT * FROM tournament_phases WHERE tournament_id = ? ORDER BY phase_order`, [tournamentId]),
    query(`SELECT g.* FROM tournament_phase_groups g JOIN tournament_phases p ON p.id = g.phase_id WHERE p.tournament_id = ? ORDER BY p.phase_order, g.group_order`, [tournamentId]),
    query(`SELECT a.group_id, COALESCE(a.participant_id, a.team_id) AS source_id FROM tournament_phase_entry_assignments a JOIN tournament_phase_groups g ON g.id = a.group_id JOIN tournament_phases p ON p.id = g.phase_id WHERE p.tournament_id = ? ORDER BY a.group_id, a.group_seed`, [tournamentId]),
    query(`SELECT s.* FROM tournament_swiss_settings s JOIN tournament_phases p ON p.id = s.phase_id WHERE p.tournament_id = ?`, [tournamentId]),
    query(`SELECT s.* FROM tournament_round_robin_settings s JOIN tournament_phases p ON p.id = s.phase_id WHERE p.tournament_id = ?`, [tournamentId]),
    query(`SELECT s.* FROM tournament_elimination_settings s JOIN tournament_phases p ON p.id = s.phase_id WHERE p.tournament_id = ?`, [tournamentId]),
    query(`SELECT o.* FROM tournament_phase_round_overrides o JOIN tournament_phases p ON p.id = o.phase_id WHERE p.tournament_id = ?`, [tournamentId]),
    query(`SELECT r.* FROM tournament_advancement_rules r JOIN tournament_phase_groups g ON g.id = r.source_group_id JOIN tournament_phases p ON p.id = g.phase_id WHERE p.tournament_id = ? ORDER BY p.phase_order, r.source_rank`, [tournamentId]),
  ]);
  const assignmentsByGroup = new Map<string, string[]>();
  for (const assignment of assignmentsResult.rows) {
    const assignments = assignmentsByGroup.get(assignment.group_id) || [];
    assignments.push(assignment.source_id);
    assignmentsByGroup.set(assignment.group_id, assignments);
  }
  const groupsByPhase = new Map<string, any[]>();
  for (const group of groupsResult.rows) {
    const groups = groupsByPhase.get(group.phase_id) || [];
    groups.push({ id: group.id, name: group.name, order: group.group_order, entry_ids: assignmentsByGroup.get(group.id) || [] });
    groupsByPhase.set(group.phase_id, groups);
  }
  const byPhase = (rows: any[]) => new Map(rows.map(row => [row.phase_id, row]));
  const swiss = byPhase(swissResult.rows);
  const league = byPhase(leagueResult.rows);
  const elimination = byPhase(eliminationResult.rows);
  const overrides = new Map<string, any[]>();
  for (const row of overridesResult.rows) {
    const values = overrides.get(row.phase_id) || [];
    values.push({ id: row.id, round_from_start: row.round_from_start, round_from_end: row.round_from_end, best_of: row.best_of });
    overrides.set(row.phase_id, values);
  }

  return {
    phases: phasesResult.rows.map((phase: any) => ({
      id: phase.id,
      name: phase.name,
      description: phase.description,
      order: phase.phase_order,
      format: phase.format,
      assignment_method: phase.assignment_method,
      default_best_of: phase.default_best_of,
      auto_start: Boolean(phase.auto_start),
      groups: groupsByPhase.get(phase.id) || [],
      swiss: swiss.has(phase.id) ? {
        round_count: swiss.get(phase.id).round_count,
        pairing_policy: swiss.get(phase.id).pairing_policy,
        avoid_rematches: Boolean(swiss.get(phase.id).avoid_rematches),
      } : undefined,
      round_robin: league.has(phase.id) ? {
        cycle_count: league.get(phase.id).cycle_count,
        open_rounds_together: Boolean(league.get(phase.id).open_rounds_together),
      } : undefined,
      elimination: elimination.has(phase.id) ? {
        bracket_size: elimination.get(phase.id).bracket_size,
        seeding_policy: elimination.get(phase.id).seeding_policy,
        reseed_each_round: Boolean(elimination.get(phase.id).reseed_each_round),
      } : undefined,
      round_overrides: overrides.get(phase.id) || [],
    })),
    advancement_rules: rulesResult.rows.map((rule: any) => ({
      id: rule.id,
      source_group_id: rule.source_group_id,
      source_rank: rule.source_rank,
      target_group_id: rule.target_group_id,
      target_seed: rule.target_seed,
    })),
  } as TournamentFormatDefinition;
}
