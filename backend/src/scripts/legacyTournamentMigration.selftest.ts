import assert from 'node:assert/strict';
import { buildConversionPlan, type LegacySource } from './migrateLegacyTournament.js';

const baseSource = (): LegacySource => ({
  tournament: {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Legacy fixture',
    status: 'finished',
    competition_model_version: 1,
  },
  teams: [],
  participants: [],
  rounds: [{
    id: 'round-1',
    round_number: 1,
    round_phase_label: 'Final',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
  }],
  series: [],
  games: [],
  byes: [],
  replays: [],
  schedules: [],
  existingPhaseRows: 0,
  validMatchIds: new Set<string>(),
});

const completedSeries = (player1Id: string, player2Id: string, winnerId: string) => ({
  id: 'series-1',
  round_id: 'round-1',
  player1_id: player1Id,
  player2_id: player2Id,
  winner_id: winnerId,
  best_of: 1,
  wins_required: 1,
  player1_wins: winnerId === player1Id ? 1 : 0,
  player2_wins: winnerId === player2Id ? 1 : 0,
  series_status: 'completed',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
});

const completedGame = (player1Id: string, player2Id: string, winnerId: string) => ({
  id: 'game-1',
  round_id: 'round-1',
  tournament_round_match_id: 'series-1',
  player1_id: player1Id,
  player2_id: player2Id,
  winner_id: winnerId,
  loser_id: winnerId === player1Id ? player2Id : player1Id,
  match_id: null,
  match_status: 'completed',
  replay_downloads: 0,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
});

const teamLeague = baseSource();
teamLeague.tournament.tournament_type = 'league';
teamLeague.tournament.tournament_mode = 'team';
teamLeague.teams = [
  { id: 'team-1', name: 'One', tournament_ranking: 1, tournament_wins: 1, tournament_losses: 0, tournament_points: 1, omp: 0, gwp: 100, ogp: 0 },
  { id: 'team-2', name: 'Two', tournament_ranking: 2, tournament_wins: 0, tournament_losses: 1, tournament_points: 0, omp: 100, gwp: 0, ogp: 100 },
];
teamLeague.participants = [
  { participant_id: 'tp-1', team_id: 'team-1', user_id: 'user-1', nickname: 'One A', participation_status: 'accepted' },
  { participant_id: 'tp-2', team_id: 'team-1', user_id: 'user-2', nickname: 'One B', participation_status: 'accepted' },
  { participant_id: 'tp-3', team_id: 'team-2', user_id: 'user-3', nickname: 'Two A', participation_status: 'accepted' },
  { participant_id: 'tp-4', team_id: 'team-2', user_id: 'user-4', nickname: 'Two B', participation_status: 'accepted' },
];
teamLeague.series = [completedSeries('team-1', 'team-2', 'team-1')];
teamLeague.games = [completedGame('team-1', 'team-2', 'team-1')];

const leaguePlan = buildConversionPlan(teamLeague);
assert.deepEqual(leaguePlan.errors, []);
assert.equal(leaguePlan.format, 'round_robin');
assert.equal(leaguePlan.cycleCount, 1);
assert.equal(leaguePlan.entities.length, 2);

const individualElimination = baseSource();
individualElimination.tournament.tournament_type = 'elimination';
individualElimination.tournament.tournament_mode = 'unranked';
individualElimination.participants = [
  {
    participant_id: 'participant-1', team_id: null, user_id: 'user-1', nickname: 'Winner',
    participation_status: 'accepted', tournament_ranking: 1, tournament_wins: 1,
    tournament_losses: 0, tournament_points: 1, omp: 0, gwp: 100, ogp: 0,
  },
  {
    participant_id: 'participant-2', team_id: null, user_id: 'user-2', nickname: 'Runner-up',
    participation_status: 'accepted', tournament_ranking: 2, tournament_wins: 0,
    tournament_losses: 1, tournament_points: 0, omp: 100, gwp: 0, ogp: 100,
  },
];
individualElimination.series = [completedSeries('user-1', 'user-2', 'user-1')];
individualElimination.games = [completedGame('user-1', 'user-2', 'user-1')];

const eliminationPlan = buildConversionPlan(individualElimination);
assert.deepEqual(eliminationPlan.errors, []);
assert.equal(eliminationPlan.format, 'single_elimination');
assert.equal(eliminationPlan.bracketSize, 2);
assert.equal(eliminationPlan.championEntityId, 'user-1');
assert.equal(eliminationPlan.runnerUpEntityId, 'user-2');

const unsupported = baseSource();
unsupported.tournament.tournament_type = 'league';
unsupported.tournament.tournament_mode = 'ranked';
assert.match(buildConversionPlan(unsupported).errors.join('\n'), /Supported conversions/);

console.log('Legacy tournament migration self-tests passed');
