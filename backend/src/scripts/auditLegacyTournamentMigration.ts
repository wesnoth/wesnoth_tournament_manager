import { pool, query } from '../config/database.js';

async function main(): Promise<void> {
  const tournamentId = process.argv.find(argument => argument.startsWith('--tournament='))?.split('=')[1];
  if (!tournamentId) {
    console.error('Usage: NODE_ENV=<test|production> node dist/scripts/auditLegacyTournamentMigration.js --tournament=<uuid>');
    process.exitCode = 2;
    return;
  }
  const tournamentResult = await query(
    `SELECT id, name, status, tournament_type, tournament_mode, competition_model_version
     FROM tournaments WHERE id = ?`,
    [tournamentId]
  );
  if (!tournamentResult.rows.length) {
    console.error('Tournament not found');
    process.exitCode = 1;
  } else {
    const [legacyRounds, legacySeries, legacyGames, legacyByes, replayLinks, schedules, embeddedSchedules, replacementHistory] = await Promise.all([
      query(`SELECT COUNT(*) AS count FROM tournament_rounds WHERE tournament_id = ?`, [tournamentId]),
      query(`SELECT COUNT(*) AS count FROM tournament_round_matches WHERE tournament_id = ?`, [tournamentId]),
      query(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(organizer_action IS NULL), 0) AS played_count,
                COALESCE(SUM(organizer_action IS NOT NULL), 0) AS administrative_count
         FROM tournament_matches WHERE tournament_id = ?`,
        [tournamentId]
      ),
      query(`SELECT COUNT(*) AS count FROM tournament_round_byes WHERE tournament_id = ?`, [tournamentId]),
      query(`SELECT COUNT(*) AS count FROM replays WHERE tournament_id = ? OR tournament_round_match_id IN (SELECT id FROM tournament_round_matches WHERE tournament_id = ?)`, [tournamentId, tournamentId]),
      // The historical scheduling table inherited utf8mb4_unicode_ci while
      // tournament UUIDs use utf8mb4_general_ci. Make the read-only comparison
      // explicit so the audit works before any optional schema normalization.
      query(
        `SELECT COUNT(DISTINCT proposals.id) AS count
         FROM match_schedule_proposals proposals
         JOIN tournament_round_matches series
           ON proposals.tournament_round_match_id COLLATE utf8mb4_general_ci = series.id
         WHERE series.tournament_id = ?`,
        [tournamentId]
      ),
      query(
        `SELECT COUNT(*) AS count FROM tournament_round_matches
         WHERE tournament_id = ? AND scheduled_datetime IS NOT NULL`,
        [tournamentId]
      ),
      query(
        `SELECT COUNT(*) AS count FROM tournament_participants
         WHERE tournament_id = ?
           AND (participation_status = 'replaced' OR requested_replacement_of_id IS NOT NULL)`,
        [tournamentId]
      ),
    ]);
    const tournament = tournamentResult.rows[0];
    const isTeamLeague = tournament.tournament_type === 'league' && tournament.tournament_mode === 'team';
    const isIndividualElimination = tournament.tournament_type === 'elimination'
      && ['ranked', 'unranked'].includes(tournament.tournament_mode);
    const report = {
      tournament,
      legacy: {
        rounds: Number(legacyRounds.rows[0].count),
        series: Number(legacySeries.rows[0].count),
        gameRows: Number(legacyGames.rows[0].count),
        playedGames: Number(legacyGames.rows[0].played_count),
        administrativeGameRows: Number(legacyGames.rows[0].administrative_count),
        byes: Number(legacyByes.rows[0].count),
        replayLinks: Number(replayLinks.rows[0].count),
        scheduleProposals: Number(schedules.rows[0].count),
        embeddedSeriesSchedules: Number(embeddedSchedules.rows[0].count),
        replacementHistoryRows: Number(replacementHistory.rows[0].count),
      },
      recommendation: isTeamLeague
        ? 'Candidate for team round-robin migration. Compare every team, round, series result, bye, replay link, and schedule before switching the model version.'
        : isIndividualElimination
          ? 'Candidate for individual single-elimination migration. Reconstruct and compare every bracket path, bye, series result, replay link, and schedule before switching the model version.'
          : 'Unsupported by the focused converter; prefer purge/recreation unless this tournament has business value.',
      safeForAutomaticMigration: false,
      reason: 'Historical result and scheduling mappings require an explicit reconciliation report; this audit never mutates data.',
    };
    console.log(JSON.stringify(report, null, 2));
  }
}

main()
  .catch(error => {
    console.error('Legacy tournament migration audit failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // CLI processes must release pooled sockets after both success and failure.
    await pool.end();
  });
