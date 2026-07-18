import { query } from '../config/database.js';

async function main(): Promise<void> {
  const tournamentId = process.argv.find(argument => argument.startsWith('--tournament='))?.split('=')[1];
  if (!tournamentId) {
    console.error('Usage: node dist/scripts/auditLegacyTournamentMigration.js --tournament=<uuid>');
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
    const [legacyRounds, legacySeries, legacyGames, replayLinks, schedules] = await Promise.all([
      query(`SELECT COUNT(*) AS count FROM tournament_rounds WHERE tournament_id = ?`, [tournamentId]),
      query(`SELECT COUNT(*) AS count FROM tournament_round_matches WHERE tournament_id = ?`, [tournamentId]),
      query(`SELECT COUNT(*) AS count FROM tournament_matches WHERE tournament_id = ?`, [tournamentId]),
      query(`SELECT COUNT(*) AS count FROM replays WHERE tournament_id = ? OR tournament_round_match_id IN (SELECT id FROM tournament_round_matches WHERE tournament_id = ?)`, [tournamentId, tournamentId]),
      query(`SELECT COUNT(*) AS count FROM match_schedule_proposals WHERE tournament_round_match_id IN (SELECT id FROM tournament_round_matches WHERE tournament_id = ?)`, [tournamentId]),
    ]);
    const tournament = tournamentResult.rows[0];
    const report = {
      tournament,
      legacy: {
        rounds: Number(legacyRounds.rows[0].count),
        series: Number(legacySeries.rows[0].count),
        games: Number(legacyGames.rows[0].count),
        replayLinks: Number(replayLinks.rows[0].count),
        scheduleProposals: Number(schedules.rows[0].count),
      },
      recommendation: tournament.tournament_type === 'league' && tournament.tournament_mode === 'team'
        ? 'Candidate for round-robin migration. Compare every team, round, series result, replay link, and schedule before switching the model version.'
        : 'Prefer purge/recreation unless this tournament has business value.',
      safeForAutomaticMigration: false,
      reason: 'Historical result and scheduling mappings require an explicit reconciliation report; this audit never mutates data.',
    };
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(error => {
  console.error('Legacy tournament migration audit failed:', error);
  process.exitCode = 1;
});
