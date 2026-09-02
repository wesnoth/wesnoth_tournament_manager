import { randomUUID } from 'crypto';
import { pool } from '../config/database.js';
import {
  notifyPhaseCompleted,
  notifyRoundStandings,
  notifyTournamentFinished,
} from '../services/tournamentPhaseDiscordService.js';
import { compileNextPhaseCompetition } from './competitionCompiler.js';

export interface PhaseGameResultMetadata {
  map: string | null;
  winnerFaction: string | null;
  loserFaction: string | null;
  winnerSide: number | null;
}

export interface PhaseGameConfirmation {
  /** Entry whose participant submitted the report. */
  entryId: string;
  comments: string | null;
  rating: number | null;
}

/** Extract display metadata from the normalized replay summary for v2 games. */
export function phaseGameDisplayMetadata(parseSummary: any): PhaseGameResultMetadata {
  const victory = parseSummary?.replayVictory || {};
  const winnerName = String(victory.winner_name || '').toLowerCase();
  const loserName = String(victory.loser_name || '').toLowerCase();
  const players = Array.isArray(parseSummary?.forumPlayers) ? parseSummary.forumPlayers : [];
  const winner = players.find((player: any) => String(player?.user_name || '').toLowerCase() === winnerName);
  const loser = players.find((player: any) => String(player?.user_name || '').toLowerCase() === loserName);
  const resolvedFactions = parseSummary?.resolvedFactions || {};
  const forumFactions = parseSummary?.forumFactions || {};
  const factionFor = (player: any, fallback: string | null) => {
    if (!player) return fallback;
    return resolvedFactions[`side${player.side_number}`]
      || forumFactions[`side${player.side_number}`]
      || fallback;
  };
  const detectedTeams = Object.values(parseSummary?.detectedTeams || {}) as any[];
  const winnerTeam = detectedTeams.find(team =>
    Array.isArray(team?.members)
      && team.members.some((member: string) => member.toLowerCase() === winnerName)
  );
  const loserTeam = winnerTeam
    ? detectedTeams.find(team => team.team_id !== winnerTeam.team_id)
    : null;
  return {
    map: parseSummary?.resolvedMap || parseSummary?.finalMap
      || parseSummary?.selectedMapName || parseSummary?.forumMap || null,
    winnerFaction: winnerTeam
      ? winnerTeam.factions?.join(', ') || null
      : factionFor(winner, victory.winner_faction || null),
    loserFaction: loserTeam
      ? loserTeam.factions?.join(', ') || null
      : factionFor(loser, victory.loser_faction || null),
    winnerSide: winnerTeam ? null : winner?.side_number || victory.winner_side || null,
  };
}

/**
 * Recalculate materialized percentage tiebreakers from completed series and games.
 * Percentages use 0..100 storage. A player with no relevant games has zero; this
 * prevents NaN values and keeps deterministic initial ordering by preclassification.
 */
async function recalculateTiebreakers(connection: any, groupId: string): Promise<void> {
  const [standingRows] = await connection.execute(
    `SELECT entry_id, matches_played, points FROM tournament_phase_standings WHERE group_id = ?`,
    [groupId]
  );
  const [seriesRows] = await connection.execute(
    `SELECT series.id,
            MAX(CASE WHEN slots.slot_number = 1 THEN slots.resolved_entry_id END) AS entry1_id,
            MAX(CASE WHEN slots.slot_number = 2 THEN slots.resolved_entry_id END) AS entry2_id
     FROM tournament_series series
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_series_slots slots ON slots.series_id = series.id
     WHERE rounds.group_id = ? AND series.status = 'completed' AND series.loser_entry_id IS NOT NULL
     GROUP BY series.id`,
    [groupId]
  );
  const [gameRows] = await connection.execute(
    `SELECT games.entry1_id, games.entry2_id, games.winner_entry_id
     FROM tournament_games games
     JOIN tournament_series series ON series.id = games.series_id
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     WHERE rounds.group_id = ?
       AND games.status = 'completed'
       AND games.organizer_action IS NULL`,
    [groupId]
  );
  const standings = new Map(standingRows.map((row: any) => [row.entry_id, row]));
  const opponents = new Map<string, string[]>();
  for (const series of seriesRows) {
    opponents.set(series.entry1_id, [...(opponents.get(series.entry1_id) || []), series.entry2_id]);
    opponents.set(series.entry2_id, [...(opponents.get(series.entry2_id) || []), series.entry1_id]);
  }
  const gameTotals = new Map<string, { played: number; won: number }>();
  for (const game of gameRows) {
    for (const entryId of [game.entry1_id, game.entry2_id]) {
      const totals = gameTotals.get(entryId) || { played: 0, won: 0 };
      totals.played += 1;
      if (game.winner_entry_id === entryId) totals.won += 1;
      gameTotals.set(entryId, totals);
    }
  }
  const percentage = (numerator: number, denominator: number) => denominator > 0 ? (numerator / denominator) * 100 : 0;
  const gwp = new Map<string, number>();
  for (const row of standingRows) {
    const games = gameTotals.get(row.entry_id) || { played: 0, won: 0 };
    gwp.set(row.entry_id, percentage(games.won, games.played));
  }
  for (const row of standingRows) {
    const faced = opponents.get(row.entry_id) || [];
    const omp = faced.length
      ? faced.reduce((sum, opponentId) => {
        const opponent = standings.get(opponentId) as any;
        return sum + percentage(Number(opponent?.points || 0), Number(opponent?.matches_played || 0));
      }, 0) / faced.length
      : 0;
    const ogp = faced.length ? faced.reduce((sum, opponentId) => sum + (gwp.get(opponentId) || 0), 0) / faced.length : 0;
    await connection.execute(
      `UPDATE tournament_phase_standings SET omp = ?, gwp = ?, ogp = ? WHERE group_id = ? AND entry_id = ?`,
      [omp, gwp.get(row.entry_id) || 0, ogp, groupId, row.entry_id]
    );
  }
}

async function rankGroup(connection: any, groupId: string, finalize: boolean): Promise<void> {
  const [rows] = await connection.execute(
    `SELECT standings.entry_id
     FROM tournament_phase_standings standings
     JOIN tournament_entries entries ON entries.id = standings.entry_id
     WHERE standings.group_id = ?
     ORDER BY standings.points DESC, standings.wins DESC, standings.omp DESC,
              standings.gwp DESC, standings.ogp DESC, entries.initial_seed`,
    [groupId]
  );
  for (const [index, row] of rows.entries()) {
    await connection.execute(
      `UPDATE tournament_phase_standings
       SET rank_position = ?, finalized_at = ${finalize ? 'CURRENT_TIMESTAMP' : 'NULL'}
       WHERE group_id = ? AND entry_id = ?`,
      [index + 1, groupId, row.entry_id]
    );
  }
}

async function createSwissRoundPairings(connection: any, roundId: string, bestOf: number, groupId: string): Promise<void> {
  const [standings] = await connection.execute(
    `SELECT standings.entry_id
     FROM tournament_phase_standings standings
     JOIN tournament_entries entries ON entries.id = standings.entry_id
     WHERE standings.group_id = ?
     ORDER BY standings.points DESC, standings.wins DESC, entries.initial_seed`,
    [groupId]
  );
  const [playedRows] = await connection.execute(
    `SELECT LEAST(slot1.resolved_entry_id, slot2.resolved_entry_id) AS entry1,
            GREATEST(slot1.resolved_entry_id, slot2.resolved_entry_id) AS entry2
     FROM tournament_series series
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
     JOIN tournament_series_slots slot1 ON slot1.series_id = series.id AND slot1.slot_number = 1
     JOIN tournament_series_slots slot2 ON slot2.series_id = series.id AND slot2.slot_number = 2
     WHERE rounds.group_id = ?`,
    [groupId]
  );
  const played = new Set(playedRows.map((row: any) => `${row.entry1}:${row.entry2}`));
  const waiting = standings.map((row: any) => row.entry_id as string);
  let position = 1;
  while (waiting.length > 1) {
    const first = waiting.shift()!;
    let opponentIndex = waiting.findIndex((candidate: string) => {
      const pair = [first, candidate].sort().join(':');
      return !played.has(pair);
    });
    if (opponentIndex < 0) opponentIndex = 0;
    const second = waiting.splice(opponentIndex, 1)[0];
    const seriesId = randomUUID();
    await connection.execute(
      `INSERT INTO tournament_series (id, round_id, series_position, status, best_of, wins_required)
       VALUES (?, ?, ?, 'ready', ?, ?)`,
      [seriesId, roundId, position, bestOf, Math.floor(bestOf / 2) + 1]
    );
    for (const [slotIndex, entryId] of [first, second].entries()) {
      await connection.execute(
        `INSERT INTO tournament_series_slots
           (id, series_id, slot_number, source_type, resolved_entry_id, resolved_at)
         VALUES (?, ?, ?, 'direct', ?, CURRENT_TIMESTAMP)`,
        [randomUUID(), seriesId, slotIndex + 1, entryId]
      );
    }
    await connection.execute(
      `INSERT INTO tournament_games (id, series_id, game_number, entry1_id, entry2_id, status)
       VALUES (?, ?, 1, ?, ?, 'pending')`,
      [randomUUID(), seriesId, first, second]
    );
    position += 1;
  }
  if (waiting.length === 1) {
    const byeEntry = waiting[0];
    await connection.execute(
      `INSERT INTO tournament_byes (id, round_id, entry_id, points_awarded) VALUES (?, ?, ?, 1.00)`,
      [randomUUID(), roundId, byeEntry]
    );
    await connection.execute(
      `UPDATE tournament_phase_standings SET byes = byes + 1, points = points + 1 WHERE group_id = ? AND entry_id = ?`,
      [groupId, byeEntry]
    );
  }
}

/**
 * Record one game and atomically progress its series, round, group, and phase.
 * Administrative actions award the series immediately through its required
 * winning score; the marked game remains presentation evidence, not a played
 * game for percentage tiebreakers.
 */
export async function recordPhaseGameResult(
  tournamentId: string,
  gameId: string,
  winnerEntryId: string,
  matchId?: string | null,
  organizerAction?: 'admin_award' | 'forfeit',
  metadata?: PhaseGameResultMetadata | null,
  confirmation?: PhaseGameConfirmation | null
): Promise<{ seriesCompleted: boolean; phaseCompleted: boolean; tournamentCompleted: boolean }> {
  const connection = await pool.getConnection();
  let completedPhaseId: string | null = null;
  let completedRoundId: string | null = null;
  let tournamentCompleted = false;
  let seriesCompleted = false;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<any[]>(
      `SELECT games.*, series.id AS series_id, series.wins_required, series.entry1_wins, series.entry2_wins,
              rounds.id AS round_id, rounds.round_number, groups.id AS group_id,
              phases.id AS phase_id, phases.format, phases.phase_order
       FROM tournament_games games
       JOIN tournament_series series ON series.id = games.series_id
       JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
       JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
       JOIN tournament_phases phases ON phases.id = groups.phase_id
       WHERE games.id = ? AND phases.tournament_id = ? FOR UPDATE`,
      [gameId, tournamentId]
    );
    if (!rows.length) throw new Error('Tournament game not found');
    const game = rows[0];
    if (game.status === 'completed') throw new Error('Tournament game result is already recorded');
    if (![game.entry1_id, game.entry2_id].includes(winnerEntryId)) throw new Error('Winner is not part of this game');
    if (metadata) {
      await connection.execute(
        `UPDATE tournament_games
         SET map = ?, winner_faction = ?, loser_faction = ?, winner_side = ?
         WHERE id = ?`,
        [metadata.map, metadata.winnerFaction, metadata.loserFaction, metadata.winnerSide, gameId]
      );
    }
    const loserEntryId = winnerEntryId === game.entry1_id ? game.entry2_id : game.entry1_id;
    await connection.execute(
      `UPDATE tournament_games
       SET winner_entry_id = ?, loser_entry_id = ?, match_id = ?, status = 'completed',
           organizer_action = ?, played_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [winnerEntryId, loserEntryId, matchId || null, organizerAction || null, gameId]
    );
    if (confirmation) {
      // The confidence-one form is submitted by either participant. Preserve
      // the author's feedback on that participant's side of the game rather
      // than treating every report as the winner's report.
      const confirmationColumn = confirmation.entryId === winnerEntryId
        ? 'winner'
        : confirmation.entryId === loserEntryId
          ? 'loser'
          : null;
      if (confirmationColumn) {
        await connection.execute(
          `UPDATE tournament_games
           SET ${confirmationColumn}_comments = ?, ${confirmationColumn}_rating = ?,
               confirmation_status = 'reported'
           WHERE id = ?`,
          [confirmation.comments || null, confirmation.rating, gameId]
        );
      }
    }
    const winColumn = winnerEntryId === game.entry1_id ? 'entry1_wins' : 'entry2_wins';
    if (organizerAction) {
      // An administrative award resolves the series without fabricating the
      // unplayed games required by its best-of format. The series score is the
      // authoritative competition result; this marked game is audit evidence
      // and is deliberately excluded from game-percentage tiebreakers.
      await connection.execute(
        `UPDATE tournament_series
         SET ${winColumn} = wins_required, status = 'in_progress',
             started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
         WHERE id = ?`,
        [game.series_id]
      );
    } else {
      await connection.execute(
        `UPDATE tournament_series SET ${winColumn} = ${winColumn} + 1, status = 'in_progress', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?`,
        [game.series_id]
      );
    }
    const [seriesRows] = await connection.execute<any[]>(`SELECT * FROM tournament_series WHERE id = ?`, [game.series_id]);
    const series = seriesRows[0];
    const winnerWins = winnerEntryId === game.entry1_id ? series.entry1_wins : series.entry2_wins;
    if (Number(winnerWins) >= Number(series.wins_required)) {
      seriesCompleted = true;
      await connection.execute(
        `UPDATE tournament_series SET status = 'completed', winner_entry_id = ?, loser_entry_id = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [winnerEntryId, loserEntryId, game.series_id]
      );
      const [scoringRows] = await connection.execute<any[]>(
        `SELECT scoring.win_points, scoring.loss_points FROM tournament_phase_scoring scoring WHERE scoring.phase_id = ?`,
        [game.phase_id]
      );
      const scoring = scoringRows[0] || { win_points: 1, loss_points: 0 };
      await connection.execute(
        `UPDATE tournament_phase_standings SET matches_played = matches_played + 1, wins = wins + 1, points = points + ? WHERE group_id = ? AND entry_id = ?`,
        [scoring.win_points, game.group_id, winnerEntryId]
      );
      await connection.execute(
        `UPDATE tournament_phase_standings SET matches_played = matches_played + 1, losses = losses + 1, points = points + ? WHERE group_id = ? AND entry_id = ?`,
        [scoring.loss_points, game.group_id, loserEntryId]
      );
      await connection.execute(
        `UPDATE tournament_series_slots SET resolved_entry_id = ?, resolved_at = CURRENT_TIMESTAMP WHERE source_series_id = ? AND source_outcome = 'winner'`,
        [winnerEntryId, game.series_id]
      );
      const [readyRows] = await connection.execute<any[]>(
        `SELECT target.id,
                MAX(CASE WHEN slots.slot_number = 1 THEN slots.resolved_entry_id END) AS entry1_id,
                MAX(CASE WHEN slots.slot_number = 2 THEN slots.resolved_entry_id END) AS entry2_id
         FROM tournament_series target JOIN tournament_series_slots slots ON slots.series_id = target.id
         WHERE target.status = 'pending' AND EXISTS (SELECT 1 FROM tournament_series_slots source WHERE source.series_id = target.id AND source.source_series_id = ?)
         GROUP BY target.id`,
        [game.series_id]
      );
      for (const ready of readyRows) {
        if (!ready.entry1_id || !ready.entry2_id) continue;
        await connection.execute(`UPDATE tournament_series SET status = 'ready' WHERE id = ?`, [ready.id]);
        await connection.execute(
          `INSERT IGNORE INTO tournament_games (id, series_id, game_number, entry1_id, entry2_id, status) VALUES (?, ?, 1, ?, ?, 'pending')`,
          [randomUUID(), ready.id, ready.entry1_id, ready.entry2_id]
        );
      }
    } else {
      await connection.execute(
        `INSERT INTO tournament_games (id, series_id, game_number, entry1_id, entry2_id, status)
         SELECT ?, id, ? , ?, ?, 'pending' FROM tournament_series WHERE id = ?`,
        [randomUUID(), Number(game.game_number) + 1, game.entry1_id, game.entry2_id, game.series_id]
      );
    }

    if (seriesCompleted) {
      const [remainingRows] = await connection.execute<any[]>(
        `SELECT COUNT(*) AS count FROM tournament_series WHERE round_id = ? AND status NOT IN ('completed', 'cancelled')`,
        [game.round_id]
      );
      if (Number(remainingRows[0].count) === 0) {
        completedRoundId = game.round_id;
        await connection.execute(`UPDATE tournament_phase_rounds SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [game.round_id]);
        await recalculateTiebreakers(connection, game.group_id);
        await rankGroup(connection, game.group_id, false);
        const [nextRounds] = await connection.execute<any[]>(
          `SELECT id, best_of FROM tournament_phase_rounds WHERE group_id = ? AND round_number = ?`,
          [game.group_id, Number(game.round_number) + 1]
        );
        if (nextRounds.length) {
          if (game.format === 'swiss') {
            await createSwissRoundPairings(connection, nextRounds[0].id, nextRounds[0].best_of, game.group_id);
          }
          // Elimination games are compiled in advance and Swiss games are
          // paired only after the preceding standings are final. In both cases
          // the next round must become active here; otherwise test simulation
          // and real replay matching correctly hide its pending games forever.
          await connection.execute(
            `UPDATE tournament_phase_rounds
             SET status = 'in_progress', starts_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [nextRounds[0].id]
          );
        } else {
          const [groupRemaining] = await connection.execute<any[]>(
            `SELECT COUNT(*) AS count FROM tournament_phase_rounds WHERE group_id = ? AND status NOT IN ('completed', 'cancelled')`,
            [game.group_id]
          );
          if (Number(groupRemaining[0].count) === 0) {
            await rankGroup(connection, game.group_id, true);
            await connection.execute(`UPDATE tournament_phase_groups SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [game.group_id]);
          }
        }
        const [phaseRemaining] = await connection.execute<any[]>(
          `SELECT COUNT(*) AS count FROM tournament_phase_groups WHERE phase_id = ? AND status NOT IN ('completed', 'cancelled')`,
          [game.phase_id]
        );
        if (Number(phaseRemaining[0].count) === 0) {
          completedPhaseId = game.phase_id;
          await connection.execute(`UPDATE tournament_phases SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`, [game.phase_id]);
        }
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  if (completedRoundId) await notifyRoundStandings(tournamentId, completedRoundId);
  if (completedPhaseId) {
    await notifyPhaseCompleted(tournamentId, completedPhaseId);
    const hasNext = await compileNextPhaseCompetition(tournamentId, completedPhaseId);
    if (!hasNext) {
      const finalConnection = await pool.getConnection();
      try {
        await finalConnection.beginTransaction();
        const [finalRows] = await finalConnection.execute<any[]>(
          `SELECT standings.entry_id, standings.rank_position, groups.id AS group_id
           FROM tournament_phase_standings standings
           JOIN tournament_phase_groups groups ON groups.id = standings.group_id
           JOIN tournament_phases phases ON phases.id = groups.phase_id
           WHERE phases.id = ? ORDER BY groups.group_order, standings.rank_position`,
          [completedPhaseId]
        );
        for (const row of finalRows) {
          await finalConnection.execute(
            `INSERT INTO tournament_results (tournament_id, entry_id, placement, placement_label, is_champion, determined_by_group_id)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE placement = VALUES(placement), placement_label = VALUES(placement_label), is_champion = VALUES(is_champion)`,
            [tournamentId, row.entry_id, row.rank_position, row.rank_position === 1 ? 'Champion' : null, row.rank_position === 1 ? 1 : 0, row.group_id]
          );
        }
        await finalConnection.execute(`UPDATE tournaments SET status = 'finished', finished_at = CURRENT_TIMESTAMP WHERE id = ?`, [tournamentId]);
        await finalConnection.commit();
        tournamentCompleted = true;
      } catch (error) {
        await finalConnection.rollback();
        throw error;
      } finally {
        finalConnection.release();
      }
      await notifyTournamentFinished(tournamentId);
    }
  }
  return { seriesCompleted, phaseCompleted: completedPhaseId !== null, tournamentCompleted };
}
