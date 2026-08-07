import { query } from '../config/database.js';
import discordService from './discordService.js';

const entryNameSql = (entryAlias: string, participantAlias: string, userAlias: string, teamAlias: string): string => `
  CASE
    WHEN ${entryAlias}.team_id IS NULL THEN ${userAlias}.nickname
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

const neutralizeMentions = (value: unknown): string => String(value ?? 'Unknown')
  .replace(/@everyone\b/g, '@\u200beveryone')
  .replace(/@here\b/g, '@\u200bhere');

const truncate = (value: string, limit = 1024): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;

const formatCode = (value: string): string => value
  .split('_')
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

/**
 * Discord delivery is best-effort and always occurs after competition commits.
 * Tournament progression remains authoritative even when Discord is unavailable.
 */
async function deliver(label: string, operation: () => Promise<boolean>): Promise<void> {
  try {
    const delivered = await operation();
    if (!delivered) console.warn(`[DISCORD] ${label} was not delivered`);
  } catch (error) {
    console.error(`[DISCORD] ${label} failed:`, error);
  }
}

/** Publish the phase identity and currently playable pairings after a phase starts. */
async function publishPhaseStarted(tournamentId: string, phaseId: string): Promise<void> {
  const context = await query(
    `SELECT tournaments.name AS tournament_name, tournaments.discord_thread_id,
            phases.name AS phase_name, phases.phase_order, phases.format,
            (SELECT COUNT(*) FROM tournament_phase_groups WHERE phase_id = phases.id) AS group_count,
            (SELECT COUNT(DISTINCT phase_entries.entry_id)
             FROM tournament_phase_entries phase_entries
             JOIN tournament_phase_groups entry_groups ON entry_groups.id = phase_entries.group_id
             WHERE entry_groups.phase_id = phases.id) AS entry_count,
            (SELECT COUNT(*)
             FROM tournament_phase_rounds rounds
             JOIN tournament_phase_groups round_groups ON round_groups.id = rounds.group_id
             WHERE round_groups.phase_id = phases.id AND rounds.status = 'in_progress') AS active_round_count
     FROM tournament_phases phases
     JOIN tournaments ON tournaments.id = phases.tournament_id
     WHERE phases.id = ? AND tournaments.id = ?`,
    [phaseId, tournamentId]
  );
  const phase = context.rows[0];
  if (!phase?.discord_thread_id) return;

  const pairings = await query(
    `SELECT groups.name AS group_name, rounds.round_number,
            ${entryNameSql('entry1', 'participant1', 'user1', 'team1')} AS entry1_name,
            ${entryNameSql('entry2', 'participant2', 'user2', 'team2')} AS entry2_name
     FROM tournament_series series
     JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id AND rounds.status = 'in_progress'
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
     WHERE phases.id = ? AND series.status IN ('ready', 'in_progress')
     ORDER BY groups.group_order, rounds.round_number, series.series_position`,
    [phaseId]
  );
  const visiblePairings = pairings.rows.slice(0, 15).map((pairing: any) =>
    `**${neutralizeMentions(pairing.group_name)} · R${pairing.round_number}:** ${neutralizeMentions(pairing.entry1_name)} vs ${neutralizeMentions(pairing.entry2_name)}`
  );
  if (pairings.rows.length > visiblePairings.length) {
    visiblePairings.push(`…and ${pairings.rows.length - visiblePairings.length} more pairings.`);
  }

  await deliver(`phase ${phaseId} start`, () => discordService.publishDiscordMessage(
    phase.discord_thread_id,
    {
      embeds: [{
        title: `🚀 Phase ${phase.phase_order} Started: ${neutralizeMentions(phase.phase_name)}`,
        description: truncate(visiblePairings.join('\n') || 'The phase is active. Pairings will appear as they become available.', 4000),
        color: 0x9b59b6,
        fields: [
          { name: 'Tournament', value: neutralizeMentions(phase.tournament_name), inline: false },
          { name: 'Format', value: formatCode(phase.format), inline: true },
          { name: 'Groups / Brackets', value: String(phase.group_count), inline: true },
          { name: 'Entries', value: String(phase.entry_count), inline: true },
          { name: 'Active rounds', value: String(phase.active_round_count), inline: true },
        ],
        footer: { text: `Phase ${phase.phase_order}` },
        timestamp: new Date().toISOString(),
      }],
    }
  ));
}

/** Publish one group's standings after a phase-engine round becomes complete. */
async function publishRoundStandings(tournamentId: string, roundId: string): Promise<void> {
  const context = await query(
    `SELECT tournaments.discord_thread_id, phases.name AS phase_name, phases.phase_order,
            groups.name AS group_name, rounds.round_number
     FROM tournament_phase_rounds rounds
     JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
     JOIN tournament_phases phases ON phases.id = groups.phase_id
     JOIN tournaments ON tournaments.id = phases.tournament_id
     WHERE rounds.id = ? AND tournaments.id = ?`,
    [roundId, tournamentId]
  );
  const round = context.rows[0];
  if (!round?.discord_thread_id) return;

  const standings = await query(
    `SELECT standings.rank_position, standings.points, standings.wins, standings.losses,
            standings.omp, standings.gwp, standings.ogp,
            ${entryNameSql('entries', 'participants', 'users', 'teams')} AS entry_name
     FROM tournament_phase_standings standings
     JOIN tournament_phase_rounds rounds ON rounds.group_id = standings.group_id
     JOIN tournament_entries entries ON entries.id = standings.entry_id
     LEFT JOIN tournament_participants participants ON participants.id = entries.participant_id
     LEFT JOIN users_extension users ON users.id = participants.user_id
     LEFT JOIN tournament_teams teams ON teams.id = entries.team_id
     WHERE rounds.id = ?
     ORDER BY standings.rank_position, entries.initial_seed`,
    [roundId]
  );
  const table = standings.rows.slice(0, 15).map((standing: any) =>
    `**${standing.rank_position}.** ${neutralizeMentions(standing.entry_name)} — ${Number(standing.points)} pts (${standing.wins}W-${standing.losses}L) · OMP ${Number(standing.omp).toFixed(2)} · GWP ${Number(standing.gwp).toFixed(2)} · OGP ${Number(standing.ogp).toFixed(2)}`
  ).join('\n');

  await deliver(`round ${roundId} standings`, () => discordService.publishDiscordMessage(
    round.discord_thread_id,
    {
      embeds: [{
        title: `✅ ${neutralizeMentions(round.phase_name)} · ${neutralizeMentions(round.group_name)} · Round ${round.round_number}`,
        description: truncate(table || 'No standings available.', 4000),
        color: 0x27ae60,
        footer: { text: `Standings after round ${round.round_number}` },
        timestamp: new Date().toISOString(),
      }],
    }
  ));
}

/** Publish finalized standings for every group when a phase closes. */
async function publishPhaseCompleted(tournamentId: string, phaseId: string): Promise<void> {
  const context = await query(
    `SELECT tournaments.discord_thread_id, phases.name AS phase_name, phases.phase_order
     FROM tournament_phases phases
     JOIN tournaments ON tournaments.id = phases.tournament_id
     WHERE phases.id = ? AND tournaments.id = ?`,
    [phaseId, tournamentId]
  );
  const phase = context.rows[0];
  if (!phase?.discord_thread_id) return;

  const standings = await query(
    `SELECT groups.id AS group_id, groups.name AS group_name, groups.group_order,
            standings.rank_position, standings.points, standings.wins, standings.losses,
            standings.omp, standings.gwp, standings.ogp,
            EXISTS(
              SELECT 1 FROM tournament_advancement_rules rules
              WHERE rules.source_group_id = groups.id AND rules.source_rank = standings.rank_position
            ) AS qualified,
            ${entryNameSql('entries', 'participants', 'users', 'teams')} AS entry_name
     FROM tournament_phase_standings standings
     JOIN tournament_phase_groups groups ON groups.id = standings.group_id
     JOIN tournament_entries entries ON entries.id = standings.entry_id
     LEFT JOIN tournament_participants participants ON participants.id = entries.participant_id
     LEFT JOIN users_extension users ON users.id = participants.user_id
     LEFT JOIN tournament_teams teams ON teams.id = entries.team_id
     WHERE groups.phase_id = ?
     ORDER BY groups.group_order, standings.rank_position`,
    [phaseId]
  );
  const grouped = new Map<string, { name: string; rows: any[] }>();
  for (const standing of standings.rows) {
    const group: { name: string; rows: any[] } = grouped.get(standing.group_id)
      || { name: standing.group_name, rows: [] };
    group.rows.push(standing);
    grouped.set(standing.group_id, group);
  }
  const fields = [...grouped.values()].slice(0, 10).map(group => ({
    name: neutralizeMentions(group.name),
    value: truncate(group.rows.slice(0, 15).map(standing =>
      `**${standing.rank_position}.** ${neutralizeMentions(standing.entry_name)} — ${Number(standing.points)} pts (${standing.wins}W-${standing.losses}L)${Number(standing.qualified) === 1 ? ' ✅' : ''}`
    ).join('\n') || 'No standings available.'),
    inline: false,
  }));

  await deliver(`phase ${phaseId} completion`, () => discordService.publishDiscordMessage(
    phase.discord_thread_id,
    {
      embeds: [{
        title: `🏁 Phase ${phase.phase_order} Completed: ${neutralizeMentions(phase.phase_name)}`,
        description: 'Final group standings. ✅ marks an entry advancing through a configured qualification rule.',
        color: 0x3498db,
        fields,
        footer: { text: `Phase ${phase.phase_order} completed` },
        timestamp: new Date().toISOString(),
      }],
    }
  ));
}

/** Publish champion, runner-up, and final-phase standings after tournament completion. */
async function publishTournamentFinished(tournamentId: string): Promise<void> {
  const context = await query(
    `SELECT name, discord_thread_id FROM tournaments WHERE id = ?`,
    [tournamentId]
  );
  const tournament = context.rows[0];
  if (!tournament?.discord_thread_id) return;

  const results = await query(
    `SELECT results.placement, results.is_champion,
            ${entryNameSql('entries', 'participants', 'users', 'teams')} AS entry_name
     FROM tournament_results results
     JOIN tournament_entries entries ON entries.id = results.entry_id
     LEFT JOIN tournament_participants participants ON participants.id = entries.participant_id
     LEFT JOIN users_extension users ON users.id = participants.user_id
     LEFT JOIN tournament_teams teams ON teams.id = entries.team_id
     WHERE results.tournament_id = ?
     ORDER BY results.placement, entries.initial_seed`,
    [tournamentId]
  );
  const champion = results.rows.find((result: any) => Number(result.is_champion) === 1 || Number(result.placement) === 1);
  const runnerUp = results.rows.find((result: any) => Number(result.placement) === 2);
  const finalStandings = results.rows.slice(0, 15).map((result: any) =>
    `**${result.placement}.** ${neutralizeMentions(result.entry_name)}`
  ).join('\n');

  await deliver(`tournament ${tournamentId} completion`, () => discordService.publishDiscordMessage(
    tournament.discord_thread_id,
    {
      embeds: [{
        title: truncate(`🎉 ${neutralizeMentions(tournament.name)} Finished!`, 256),
        color: 0xf1c40f,
        fields: [
          { name: '🥇 Champion', value: neutralizeMentions(champion?.entry_name || 'Unknown'), inline: true },
          { name: '🥈 Runner-up', value: neutralizeMentions(runnerUp?.entry_name || 'N/A'), inline: true },
          { name: 'Final phase standings', value: truncate(finalStandings || 'No standings available.'), inline: false },
        ],
        footer: { text: 'Tournament finished' },
        timestamp: new Date().toISOString(),
      }],
    }
  ));
}

async function runBestEffort(label: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    // Read/format failures are isolated for the same reason as Discord API
    // failures: a notification must never invalidate committed competition data.
    console.error(`[DISCORD] Could not build ${label}:`, error);
  }
}

export async function notifyPhaseStarted(tournamentId: string, phaseId: string): Promise<void> {
  await runBestEffort(`phase ${phaseId} start notification`, () => publishPhaseStarted(tournamentId, phaseId));
}

export async function notifyRoundStandings(tournamentId: string, roundId: string): Promise<void> {
  await runBestEffort(`round ${roundId} standings notification`, () => publishRoundStandings(tournamentId, roundId));
}

export async function notifyPhaseCompleted(tournamentId: string, phaseId: string): Promise<void> {
  await runBestEffort(`phase ${phaseId} completion notification`, () => publishPhaseCompleted(tournamentId, phaseId));
}

export async function notifyTournamentFinished(tournamentId: string): Promise<void> {
  await runBestEffort(`tournament ${tournamentId} completion notification`, () => publishTournamentFinished(tournamentId));
}
