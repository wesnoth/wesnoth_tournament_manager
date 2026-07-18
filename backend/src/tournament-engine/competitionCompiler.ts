import { randomUUID } from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../config/database.js';
import { notifyPhaseStarted } from '../services/tournamentPhaseDiscordService.js';
import { buildEliminationSeedOrder } from './pairingAlgorithms.js';

interface EntryRow {
  id: string;
  source_id: string;
  initial_seed: number;
}

interface GroupRow {
  id: string;
  group_order: number;
}

interface PhaseRow {
  id: string;
  phase_order: number;
  format: 'swiss' | 'round_robin' | 'single_elimination';
  assignment_method: 'manual' | 'random' | 'seeded_snake';
  default_best_of: 1 | 3 | 5;
}

function shuffled<T>(values: T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function roundBestOf(defaultBestOf: number, roundNumber: number, roundCount: number, overrides: any[]): number {
  const override = overrides.find(value => value.round_from_start === roundNumber)
    || overrides.find(value => value.round_from_end === roundCount - roundNumber + 1);
  return override?.best_of || defaultBestOf;
}

async function createRound(
  connection: PoolConnection,
  groupId: string,
  roundNumber: number,
  roundCount: number,
  defaultBestOf: number,
  overrides: any[]
): Promise<{ id: string; bestOf: number }> {
  const id = randomUUID();
  const bestOf = roundBestOf(defaultBestOf, roundNumber, roundCount, overrides);
  await connection.execute(
    `INSERT INTO tournament_phase_rounds (id, group_id, round_number, name, status, best_of)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [id, groupId, roundNumber, `Round ${roundNumber}`, bestOf]
  );
  return { id, bestOf };
}

async function createDirectSeries(
  connection: PoolConnection,
  roundId: string,
  position: number,
  bestOf: number,
  entry1Id: string,
  entry2Id: string
): Promise<string> {
  const seriesId = randomUUID();
  await connection.execute(
    `INSERT INTO tournament_series
       (id, round_id, series_position, status, best_of, wins_required)
     VALUES (?, ?, ?, 'ready', ?, ?)`,
    [seriesId, roundId, position, bestOf, Math.floor(bestOf / 2) + 1]
  );
  for (const [index, entryId] of [entry1Id, entry2Id].entries()) {
    await connection.execute(
      `INSERT INTO tournament_series_slots
         (id, series_id, slot_number, source_type, resolved_entry_id, resolved_at)
       VALUES (?, ?, ?, 'direct', ?, CURRENT_TIMESTAMP)`,
      [randomUUID(), seriesId, index + 1, entryId]
    );
  }
  await connection.execute(
    `INSERT INTO tournament_games (id, series_id, game_number, entry1_id, entry2_id, status)
     VALUES (?, ?, 1, ?, ?, 'pending')`,
    [randomUUID(), seriesId, entry1Id, entry2Id]
  );
  return seriesId;
}

function bergerRounds(entryIds: string[]): Array<Array<[string | null, string | null]>> {
  const rotating: Array<string | null> = [...entryIds];
  if (rotating.length % 2 === 1) rotating.push(null);
  const rounds: Array<Array<[string | null, string | null]>> = [];
  for (let round = 0; round < rotating.length - 1; round += 1) {
    const pairs: Array<[string | null, string | null]> = [];
    for (let index = 0; index < rotating.length / 2; index += 1) {
      pairs.push([rotating[index], rotating[rotating.length - 1 - index]]);
    }
    rounds.push(pairs);
    rotating.splice(1, 0, rotating.pop()!);
  }
  return rounds;
}

async function compileRoundRobin(
  connection: PoolConnection,
  phase: PhaseRow,
  group: GroupRow,
  entryIds: string[],
  overrides: any[],
  cycleCount: number
): Promise<void> {
  const firstCycle = bergerRounds(entryIds);
  const rounds = cycleCount === 2
    ? [...firstCycle, ...firstCycle.map(pairs => pairs.map(([one, two]) => [two, one] as [string | null, string | null]))]
    : firstCycle;
  for (const [roundIndex, pairs] of rounds.entries()) {
    const round = await createRound(connection, group.id, roundIndex + 1, rounds.length, phase.default_best_of, overrides);
    let position = 1;
    for (const [entry1, entry2] of pairs) {
      if (!entry1 || !entry2) {
        const byeEntry = entry1 || entry2;
        if (byeEntry) {
          await connection.execute(
            `INSERT INTO tournament_byes (id, round_id, entry_id, points_awarded) VALUES (?, ?, ?, 1.00)`,
            [randomUUID(), round.id, byeEntry]
          );
          await connection.execute(
            `UPDATE tournament_phase_standings SET byes = byes + 1, points = points + 1 WHERE group_id = ? AND entry_id = ?`,
            [group.id, byeEntry]
          );
        }
        continue;
      }
      await createDirectSeries(connection, round.id, position, round.bestOf, entry1, entry2);
      position += 1;
    }
  }
}

async function compileSwiss(
  connection: PoolConnection,
  phase: PhaseRow,
  group: GroupRow,
  entryIds: string[],
  overrides: any[],
  roundCount: number
): Promise<void> {
  const rounds = [];
  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    rounds.push(await createRound(connection, group.id, roundNumber, roundCount, phase.default_best_of, overrides));
  }
  const firstRound = rounds[0];
  for (let index = 0, position = 1; index < entryIds.length; index += 2) {
    if (!entryIds[index + 1]) {
      await connection.execute(
        `INSERT INTO tournament_byes (id, round_id, entry_id, points_awarded) VALUES (?, ?, ?, 1.00)`,
        [randomUUID(), firstRound.id, entryIds[index]]
      );
      await connection.execute(
        `UPDATE tournament_phase_standings SET byes = byes + 1, points = points + 1 WHERE group_id = ? AND entry_id = ?`,
        [group.id, entryIds[index]]
      );
      continue;
    }
    await createDirectSeries(connection, firstRound.id, position, firstRound.bestOf, entryIds[index], entryIds[index + 1]);
    position += 1;
  }
}

async function compileElimination(
  connection: PoolConnection,
  phase: PhaseRow,
  group: GroupRow,
  entryIds: string[],
  overrides: any[],
  configuredSize: number | null
): Promise<void> {
  if (configuredSize && entryIds.length > configuredSize) {
    throw new Error(`Group ${group.id} has more entries than its configured bracket size`);
  }
  const minimumSize = Math.max(2, configuredSize || entryIds.length);
  const bracketSize = 2 ** Math.ceil(Math.log2(minimumSize));
  const roundCount = Math.log2(bracketSize);
  const seedOrder = buildEliminationSeedOrder(bracketSize);
  let priorSeries: string[] = [];
  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const round = await createRound(connection, group.id, roundNumber, roundCount, phase.default_best_of, overrides);
    const seriesCount = bracketSize / (2 ** roundNumber);
    const currentSeries: string[] = [];
    for (let position = 1; position <= seriesCount; position += 1) {
      const seriesId = randomUUID();
      currentSeries.push(seriesId);
      await connection.execute(
        `INSERT INTO tournament_series (id, round_id, series_position, status, best_of, wins_required)
         VALUES (?, ?, ?, 'pending', ?, ?)`,
        [seriesId, round.id, position, round.bestOf, Math.floor(round.bestOf / 2) + 1]
      );
      for (const slotIndex of [0, 1]) {
        if (roundNumber === 1) {
          const seed = seedOrder[(position - 1) * 2 + slotIndex];
          const entryId = entryIds[seed - 1] || null;
          await connection.execute(
            `INSERT INTO tournament_series_slots
               (id, series_id, slot_number, source_type, source_group_seed, resolved_entry_id, resolved_at)
             VALUES (?, ?, ?, 'group_seed', ?, ?, ${entryId ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
            [randomUUID(), seriesId, slotIndex + 1, seed, entryId]
          );
        } else {
          const sourceSeriesId = priorSeries[(position - 1) * 2 + slotIndex];
          await connection.execute(
            `INSERT INTO tournament_series_slots
               (id, series_id, slot_number, source_type, source_series_id, source_outcome)
             VALUES (?, ?, ?, 'series_result', ?, 'winner')`,
            [randomUUID(), seriesId, slotIndex + 1, sourceSeriesId]
          );
        }
      }
    }
    priorSeries = currentSeries;
  }
  await resolveEliminationByes(connection, group.id);
}

async function compileGroup(
  connection: PoolConnection,
  phase: PhaseRow,
  group: GroupRow,
  entryIds: string[]
): Promise<void> {
  const [overrides] = await connection.execute<any[]>(
    `SELECT * FROM tournament_phase_round_overrides WHERE phase_id = ?`,
    [phase.id]
  );
  if (phase.format === 'round_robin') {
    const [settings] = await connection.execute<any[]>(`SELECT cycle_count FROM tournament_round_robin_settings WHERE phase_id = ?`, [phase.id]);
    await compileRoundRobin(connection, phase, group, entryIds, overrides, settings[0].cycle_count);
  } else if (phase.format === 'swiss') {
    const [settings] = await connection.execute<any[]>(`SELECT round_count FROM tournament_swiss_settings WHERE phase_id = ?`, [phase.id]);
    await compileSwiss(connection, phase, group, entryIds, overrides, settings[0].round_count);
  } else {
    const [settings] = await connection.execute<any[]>(`SELECT bracket_size FROM tournament_elimination_settings WHERE phase_id = ?`, [phase.id]);
    await compileElimination(connection, phase, group, entryIds, overrides, settings[0]?.bracket_size ?? null);
  }
}

/** Resolve structural byes and propagate their winners until every playable series is ready. */
async function resolveEliminationByes(connection: PoolConnection, groupId: string): Promise<void> {
  for (let pass = 0; pass < 32; pass += 1) {
    const [rows] = await connection.execute<any[]>(
      `SELECT s.id, s.status,
              MAX(CASE WHEN sl.slot_number = 1 THEN sl.resolved_entry_id END) AS entry1_id,
              MAX(CASE WHEN sl.slot_number = 2 THEN sl.resolved_entry_id END) AS entry2_id,
              MAX(CASE WHEN sl.slot_number = 1 THEN sl.source_type END) AS source1_type,
              MAX(CASE WHEN sl.slot_number = 2 THEN sl.source_type END) AS source2_type,
              MAX(CASE WHEN sl.slot_number = 1 THEN source.status END) AS source1_status,
              MAX(CASE WHEN sl.slot_number = 2 THEN source.status END) AS source2_status
       FROM tournament_series s
       JOIN tournament_phase_rounds r ON r.id = s.round_id
       JOIN tournament_series_slots sl ON sl.series_id = s.id
       LEFT JOIN tournament_series source ON source.id = sl.source_series_id
       WHERE r.group_id = ? AND s.status = 'pending'
       GROUP BY s.id, s.status`,
      [groupId]
    );
    let changed = false;
    for (const row of rows) {
      if (row.entry1_id && row.entry2_id) {
        await connection.execute(`UPDATE tournament_series SET status = 'ready' WHERE id = ?`, [row.id]);
        await connection.execute(
          `INSERT IGNORE INTO tournament_games (id, series_id, game_number, entry1_id, entry2_id, status)
           VALUES (?, ?, 1, ?, ?, 'pending')`,
          [randomUUID(), row.id, row.entry1_id, row.entry2_id]
        );
        changed = true;
      } else if (row.entry1_id || row.entry2_id) {
        const missingSlotKnownEmpty = row.entry1_id
          ? row.source2_type === 'group_seed' || ['completed', 'cancelled'].includes(row.source2_status)
          : row.source1_type === 'group_seed' || ['completed', 'cancelled'].includes(row.source1_status);
        if (!missingSlotKnownEmpty) continue;
        const winnerId = row.entry1_id || row.entry2_id;
        await connection.execute(
          `UPDATE tournament_series SET status = 'completed', winner_entry_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [winnerId, row.id]
        );
        await connection.execute(
          `UPDATE tournament_series_slots SET resolved_entry_id = ?, resolved_at = CURRENT_TIMESTAMP
           WHERE source_series_id = ? AND source_outcome = 'winner'`,
          [winnerId, row.id]
        );
        changed = true;
      }
    }
    if (!changed) break;
  }
}

async function loadEntries(connection: PoolConnection, tournamentId: string, mode: string): Promise<EntryRow[]> {
  if (mode === 'team') {
    const [teams] = await connection.execute<any[]>(
      `SELECT tt.id AS source_id, COALESCE(NULLIF(tt.tournament_ranking, 0), 2147483647) AS ranking
       FROM tournament_teams tt
       JOIN tournament_participants tp ON tp.team_id = tt.id
       WHERE tt.tournament_id = ? AND tt.status = 'active'
         AND tp.participation_status IN ('accepted', 'pending_replacement')
       GROUP BY tt.id, tt.tournament_ranking
       HAVING COUNT(tp.id) = 2
       ORDER BY ranking, tt.team_elo DESC, tt.created_at`,
      [tournamentId]
    );
    return teams.map((team, index) => ({ id: randomUUID(), source_id: team.source_id, initial_seed: index + 1 }));
  }
  const [participants] = await connection.execute<any[]>(
    `SELECT tp.id AS source_id
     FROM tournament_participants tp
     JOIN users_extension u ON u.id = tp.user_id
     WHERE tp.tournament_id = ? AND tp.participation_status = 'accepted'
     ORDER BY COALESCE(NULLIF(tp.tournament_ranking, 0), 2147483647), u.elo_rating DESC, tp.created_at`,
    [tournamentId]
  );
  return participants.map((participant, index) => ({ id: randomUUID(), source_id: participant.source_id, initial_seed: index + 1 }));
}

async function assignFirstPhase(
  connection: PoolConnection,
  phase: PhaseRow,
  groups: GroupRow[],
  entries: EntryRow[],
  mode: string
): Promise<Map<string, string[]>> {
  const result = new Map(groups.map(group => [group.id, [] as string[]]));
  if (phase.assignment_method === 'manual') {
    const [assignments] = await connection.execute<any[]>(
      `SELECT group_id, COALESCE(participant_id, team_id) AS source_id, group_seed
       FROM tournament_phase_entry_assignments
       WHERE group_id IN (${groups.map(() => '?').join(',')})
       ORDER BY group_id, group_seed`,
      groups.map(group => group.id)
    );
    const entryBySource = new Map(entries.map(entry => [entry.source_id, entry.id]));
    for (const assignment of assignments) {
      const entryId = entryBySource.get(assignment.source_id);
      if (!entryId) throw new Error(`Manual assignment references an ineligible ${mode} entry`);
      result.get(assignment.group_id)!.push(entryId);
    }
    if (assignments.length !== entries.length) throw new Error('Manual assignment must place every eligible entry exactly once');
    return result;
  }
  const ordered = phase.assignment_method === 'random' ? shuffled(entries) : entries;
  ordered.forEach((entry, index) => {
    const cycle = Math.floor(index / groups.length);
    const groupIndex = phase.assignment_method === 'seeded_snake' && cycle % 2 === 1
      ? groups.length - 1 - (index % groups.length)
      : index % groups.length;
    result.get(groups[groupIndex].id)!.push(entry.id);
  });
  return result;
}

/** Compile the declarative first phase into immutable entries, rounds, series, slots, and games. */
export async function preparePhaseCompetition(tournamentId: string): Promise<{ entries: number; groups: number; series: number }> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tournaments] = await connection.execute<any[]>(
      `SELECT status, tournament_mode, competition_model_version FROM tournaments WHERE id = ? FOR UPDATE`,
      [tournamentId]
    );
    if (!tournaments.length) throw new Error('Tournament not found');
    const tournament = tournaments[0];
    if (Number(tournament.competition_model_version) !== 2) throw new Error('Tournament does not use the phase engine');
    if (tournament.status !== 'registration_closed') throw new Error('Registration must be closed before preparation');

    const [phaseRows] = await connection.execute<any[]>(
      `SELECT * FROM tournament_phases WHERE tournament_id = ? ORDER BY phase_order FOR UPDATE`,
      [tournamentId]
    );
    if (!phaseRows.length) throw new Error('Tournament has no phase format');
    const phase = phaseRows[0] as PhaseRow;
    const [groups] = await connection.execute<any[]>(
      `SELECT id, group_order FROM tournament_phase_groups WHERE phase_id = ? ORDER BY group_order`,
      [phase.id]
    );
    const entries = await loadEntries(connection, tournamentId, tournament.tournament_mode);
    if (entries.length < 2) throw new Error('Tournament requires at least two eligible entries');

    await connection.execute(`DELETE FROM tournament_entries WHERE tournament_id = ?`, [tournamentId]);
    for (const entry of entries) {
      await connection.execute(
        `INSERT INTO tournament_entries
           (id, tournament_id, entry_type, participant_id, team_id, initial_seed)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entry.id, tournamentId, tournament.tournament_mode === 'team' ? 'team' : 'player',
          tournament.tournament_mode === 'team' ? null : entry.source_id,
          tournament.tournament_mode === 'team' ? entry.source_id : null, entry.initial_seed]
      );
    }
    const assignments = await assignFirstPhase(connection, phase, groups, entries, tournament.tournament_mode);
    let seriesCount = 0;
    for (const group of groups as GroupRow[]) {
      const groupEntries = assignments.get(group.id)!;
      if (groupEntries.length < 2) throw new Error(`Group ${group.id} requires at least two entries`);
      for (const [seedIndex, entryId] of groupEntries.entries()) {
        await connection.execute(
          `INSERT INTO tournament_phase_entries (id, group_id, entry_id, group_seed, status)
           VALUES (?, ?, ?, ?, 'active')`,
          [randomUUID(), group.id, entryId, seedIndex + 1]
        );
        await connection.execute(
          `INSERT INTO tournament_phase_standings (group_id, entry_id) VALUES (?, ?)`,
          [group.id, entryId]
        );
      }
      await compileGroup(connection, phase, group, groupEntries);
      const [countRows] = await connection.execute<any[]>(
        `SELECT COUNT(*) AS count FROM tournament_series s JOIN tournament_phase_rounds r ON r.id = s.round_id WHERE r.group_id = ?`,
        [group.id]
      );
      seriesCount += Number(countRows[0].count);
      await connection.execute(`UPDATE tournament_phase_groups SET status = 'ready' WHERE id = ?`, [group.id]);
    }
    await connection.execute(`UPDATE tournament_phases SET status = 'ready' WHERE id = ?`, [phase.id]);
    await connection.execute(
      `UPDATE tournaments SET status = 'prepared', prepared_at = CURRENT_TIMESTAMP, current_round = 1 WHERE id = ?`,
      [tournamentId]
    );
    await connection.commit();
    return { entries: entries.length, groups: groups.length, series: seriesCount };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Materialize advancement mappings and compile the phase after a completed phase. */
export async function compileNextPhaseCompetition(tournamentId: string, completedPhaseId: string): Promise<boolean> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [currentRows] = await connection.execute<any[]>(
      `SELECT phase_order, status FROM tournament_phases WHERE id = ? AND tournament_id = ? FOR UPDATE`,
      [completedPhaseId, tournamentId]
    );
    if (!currentRows.length) throw new Error('Completed phase not found');
    if (currentRows[0].status !== 'completed') throw new Error('Source phase is not completed');
    const [phaseRows] = await connection.execute<any[]>(
      `SELECT * FROM tournament_phases WHERE tournament_id = ? AND phase_order = ? FOR UPDATE`,
      [tournamentId, currentRows[0].phase_order + 1]
    );
    if (!phaseRows.length) {
      await connection.commit();
      return false;
    }
    const phase = phaseRows[0] as PhaseRow;
    if ((phaseRows[0] as any).status !== 'draft') {
      await connection.commit();
      return true;
    }
    const [groups] = await connection.execute<any[]>(
      `SELECT id, group_order FROM tournament_phase_groups WHERE phase_id = ? ORDER BY group_order`,
      [phase.id]
    );
    for (const group of groups as GroupRow[]) {
      const [qualifiers] = await connection.execute<any[]>(
        `SELECT standings.entry_id, rules.target_seed
         FROM tournament_advancement_rules rules
         JOIN tournament_phase_standings standings
           ON standings.group_id = rules.source_group_id AND standings.rank_position = rules.source_rank
         WHERE rules.target_group_id = ?
         ORDER BY rules.target_seed`,
        [group.id]
      );
      if (qualifiers.length < 2) throw new Error(`Advancement did not produce enough entries for group ${group.id}`);
      for (const qualifier of qualifiers) {
        await connection.execute(
          `INSERT INTO tournament_phase_entries (id, group_id, entry_id, group_seed, status, qualified_at)
           VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)`,
          [randomUUID(), group.id, qualifier.entry_id, qualifier.target_seed]
        );
        await connection.execute(
          `INSERT INTO tournament_phase_standings (group_id, entry_id) VALUES (?, ?)`,
          [group.id, qualifier.entry_id]
        );
      }
      await compileGroup(connection, phase, group, qualifiers.map(row => row.entry_id));
      await connection.execute(`UPDATE tournament_phase_groups SET status = 'ready' WHERE id = ?`, [group.id]);
    }
    await connection.execute(`UPDATE tournament_phases SET status = 'ready' WHERE id = ?`, [phase.id]);
    const [progressRows] = await connection.execute<any[]>(
      `SELECT tournaments.auto_progress, phases.auto_start, rr.open_rounds_together
       FROM tournament_phases phases
       JOIN tournaments ON tournaments.id = phases.tournament_id
       LEFT JOIN tournament_round_robin_settings rr ON rr.phase_id = phases.id
       WHERE phases.id = ?`,
      [phase.id]
    );
    const phaseStarted = Boolean(progressRows[0]?.auto_progress) || Boolean(progressRows[0]?.auto_start);
    if (phaseStarted) {
      const openAll = phase.format === 'round_robin' && Boolean(progressRows[0]?.open_rounds_together);
      await connection.execute(
        `UPDATE tournament_phase_rounds rounds
         JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
         SET rounds.status = 'in_progress', rounds.starts_at = CURRENT_TIMESTAMP
         WHERE groups.phase_id = ? AND (? = 1 OR rounds.round_number = 1)`,
        [phase.id, openAll ? 1 : 0]
      );
      await connection.execute(`UPDATE tournament_phase_groups SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE phase_id = ?`, [phase.id]);
      await connection.execute(`UPDATE tournament_phases SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?`, [phase.id]);
    }
    await connection.commit();
    if (phaseStarted) await notifyPhaseStarted(tournamentId, phase.id);
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Start the prepared first phase and expose the rounds allowed by its format policy. */
export async function startPhaseCompetition(tournamentId: string): Promise<{ activeRounds: number }> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tournaments] = await connection.execute<any[]>(
      `SELECT status, competition_model_version FROM tournaments WHERE id = ? FOR UPDATE`,
      [tournamentId]
    );
    if (!tournaments.length) throw new Error('Tournament not found');
    if (Number(tournaments[0].competition_model_version) !== 2) throw new Error('Tournament does not use the phase engine');
    if (tournaments[0].status !== 'prepared') throw new Error('Tournament must be prepared before starting');
    const [phases] = await connection.execute<any[]>(
      `SELECT p.id, p.format, rr.open_rounds_together
       FROM tournament_phases p
       LEFT JOIN tournament_round_robin_settings rr ON rr.phase_id = p.id
       WHERE p.tournament_id = ? AND p.phase_order = 1`,
      [tournamentId]
    );
    if (!phases.length) throw new Error('Prepared tournament has no first phase');
    const phase = phases[0];
    const openAll = phase.format === 'round_robin' && Boolean(phase.open_rounds_together);
    await connection.execute(
      `UPDATE tournament_phase_rounds r
       JOIN tournament_phase_groups g ON g.id = r.group_id
       SET r.status = 'in_progress', r.starts_at = CURRENT_TIMESTAMP
       WHERE g.phase_id = ? AND (? = 1 OR r.round_number = 1)`,
      [phase.id, openAll ? 1 : 0]
    );
    await connection.execute(
      `UPDATE tournament_phase_groups SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE phase_id = ?`,
      [phase.id]
    );
    await connection.execute(
      `UPDATE tournament_phases SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [phase.id]
    );
    await connection.execute(
      `UPDATE tournaments SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [tournamentId]
    );
    const [counts] = await connection.execute<any[]>(
      `SELECT COUNT(*) AS count FROM tournament_phase_rounds r
       JOIN tournament_phase_groups g ON g.id = r.group_id
       WHERE g.phase_id = ? AND r.status = 'in_progress'`,
      [phase.id]
    );
    await connection.commit();
    await notifyPhaseStarted(tournamentId, phase.id);
    return { activeRounds: Number(counts[0].count) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Start a compiled later phase after every earlier phase has completed. */
export async function startReadyPhase(tournamentId: string, phaseId: string): Promise<{ activeRounds: number }> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [phases] = await connection.execute<any[]>(
      `SELECT p.id, p.phase_order, p.format, p.status, rr.open_rounds_together
       FROM tournament_phases p
       LEFT JOIN tournament_round_robin_settings rr ON rr.phase_id = p.id
       WHERE p.id = ? AND p.tournament_id = ? FOR UPDATE`,
      [phaseId, tournamentId]
    );
    if (!phases.length) throw new Error('Phase not found');
    const phase = phases[0];
    if (phase.status !== 'ready') throw new Error('Phase is not ready to start');
    const [earlier] = await connection.execute<any[]>(
      `SELECT COUNT(*) AS count FROM tournament_phases
       WHERE tournament_id = ? AND phase_order < ? AND status <> 'completed'`,
      [tournamentId, phase.phase_order]
    );
    if (Number(earlier[0].count) > 0) throw new Error('Earlier phases must be completed first');
    const openAll = phase.format === 'round_robin' && Boolean(phase.open_rounds_together);
    await connection.execute(
      `UPDATE tournament_phase_rounds rounds
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       SET rounds.status = 'in_progress', rounds.starts_at = CURRENT_TIMESTAMP
       WHERE groups.phase_id = ? AND (? = 1 OR rounds.round_number = 1)`,
      [phaseId, openAll ? 1 : 0]
    );
    await connection.execute(`UPDATE tournament_phase_groups SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE phase_id = ?`, [phaseId]);
    await connection.execute(`UPDATE tournament_phases SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?`, [phaseId]);
    const [counts] = await connection.execute<any[]>(
      `SELECT COUNT(*) AS count FROM tournament_phase_rounds rounds JOIN tournament_phase_groups groups ON groups.id = rounds.group_id WHERE groups.phase_id = ? AND rounds.status = 'in_progress'`,
      [phaseId]
    );
    await connection.commit();
    await notifyPhaseStarted(tournamentId, phaseId);
    return { activeRounds: Number(counts[0].count) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
