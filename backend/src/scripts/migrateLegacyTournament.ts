import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../config/database.js';

export interface LegacySource {
  tournament: any;
  teams: any[];
  participants: any[];
  rounds: any[];
  series: any[];
  games: any[];
  byes: any[];
  replays: any[];
  schedules: any[];
  existingPhaseRows: number;
  validMatchIds: Set<string>;
}

interface StandingPlan {
  entityId: string;
  entryId: string;
  seed: number;
  placement: number;
  wins: number;
  losses: number;
  points: number;
  omp: number;
  gwp: number;
  ogp: number;
  byes: number;
}

interface EntityPlan {
  entityId: string;
  entryId: string;
  entryType: 'player' | 'team';
  participantId: string | null;
  teamId: string | null;
  name: string;
  source: any;
}

interface EmbeddedScheduleTarget {
  proposalId: string;
  slotId: string;
  legacySeriesId: string;
  seriesId: string;
  proposedByUserId: string;
  scheduledDatetime: any;
  legacyStatus: string;
  proposedAt: any;
}

export interface ConversionPlan {
  tournamentId: string;
  phaseId: string;
  groupId: string;
  format: 'round_robin' | 'single_elimination';
  cycleCount: 1 | 2 | null;
  bracketSize: number | null;
  championEntityId: string | null;
  runnerUpEntityId: string | null;
  defaultBestOf: 1 | 3 | 5;
  entities: EntityPlan[];
  entryByEntity: Map<string, string>;
  roundByLegacy: Map<string, string>;
  seriesByLegacy: Map<string, string>;
  gameByLegacy: Map<string, string>;
  gamesToMigrate: any[];
  administrativeGameCount: number;
  standings: StandingPlan[];
  derivedByes: Array<{ roundId: string; entityId: string; reason: string }>;
  replayTargets: Array<{ replayId: string; gameId: string }>;
  scheduleTargets: Array<{ proposalId: string; seriesId: string }>;
  embeddedScheduleTargets: EmbeddedScheduleTarget[];
  errors: string[];
  warnings: string[];
}

const rows = async (connection: PoolConnection, sql: string, values: any[] = []): Promise<any[]> => {
  const [result] = await connection.execute<any[]>(sql, values);
  return result;
};

const numberValue = (value: unknown): number => Number(value || 0);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizedBestOf = (value: unknown): 1 | 3 | 5 | null => {
  const parsed = Number(value);
  return parsed === 1 || parsed === 3 || parsed === 5 ? parsed : null;
};

const unorderedPair = (one: string, two: string): string => [one, two].sort().join(':');

async function loadLegacySource(
  connection: PoolConnection,
  tournamentId: string,
  lockTournament: boolean
): Promise<LegacySource> {
  const tournamentRows = await rows(
    connection,
    `SELECT id, name, status, tournament_type, tournament_mode, competition_model_version,
            started_at, finished_at, created_at
     FROM tournaments WHERE id = ?${lockTournament ? ' FOR UPDATE' : ''}`,
    [tournamentId]
  );
  if (!tournamentRows.length) throw new Error('Tournament not found');

  const teams = await rows(
    connection,
    `SELECT id, name, status, tournament_ranking, tournament_wins, tournament_losses,
            tournament_points, omp, gwp, ogp, team_elo, created_at
     FROM tournament_teams WHERE tournament_id = ? ORDER BY created_at, id`,
    [tournamentId]
  );
  const participants = await rows(
    connection,
    `SELECT participants.id AS participant_id, participants.team_id, participants.user_id,
            participants.team_position, participants.participation_status, participants.status,
            participants.current_round, participants.tournament_ranking,
            participants.tournament_wins, participants.tournament_losses,
            participants.tournament_points, participants.omp, participants.gwp,
            participants.ogp, participants.replaced_by_participant_id,
            participants.requested_replacement_of_id, participants.created_at,
            users.nickname, users.elo_rating
     FROM tournament_participants participants
     JOIN users_extension users ON users.id = participants.user_id
     WHERE participants.tournament_id = ?
     ORDER BY participants.team_id, participants.team_position, participants.created_at`,
    [tournamentId]
  );
  const legacyRounds = await rows(
    connection,
    `SELECT * FROM tournament_rounds WHERE tournament_id = ? ORDER BY round_number, created_at, id`,
    [tournamentId]
  );
  const legacySeries = await rows(
    connection,
    `SELECT series.*, rounds.round_number
     FROM tournament_round_matches series
     JOIN tournament_rounds rounds ON rounds.id = series.round_id
     WHERE series.tournament_id = ?
     ORDER BY rounds.round_number, series.created_at, series.id`,
    [tournamentId]
  );
  const legacyGames = await rows(
    connection,
    `SELECT games.*, linked_match.winner_side AS linked_winner_side
     FROM tournament_matches games
     LEFT JOIN matches linked_match ON linked_match.id = games.match_id
     WHERE games.tournament_id = ?
     ORDER BY games.round_id, games.tournament_round_match_id, games.played_at, games.created_at, games.id`,
    [tournamentId]
  );
  const legacyByes = await rows(
    connection,
    `SELECT byes.*, rounds.round_number
     FROM tournament_round_byes byes
     JOIN tournament_rounds rounds ON rounds.id = byes.round_id
     WHERE byes.tournament_id = ?
     ORDER BY rounds.round_number, byes.created_at, byes.id`,
    [tournamentId]
  );
  const replays = await rows(
    connection,
    `SELECT DISTINCT replays.id, replays.match_id, replays.tournament_match_id,
            replays.tournament_round_match_id, replays.tournament_game_id
     FROM replays
     LEFT JOIN tournament_matches replay_game ON replay_game.id = replays.tournament_match_id
     LEFT JOIN tournament_round_matches replay_series
       ON replay_series.id = replays.tournament_round_match_id
     WHERE replays.tournament_id = ?
        OR replay_game.tournament_id = ?
        OR replay_series.tournament_id = ?
        OR replays.match_id IN (
          SELECT match_id FROM tournament_matches
          WHERE tournament_id = ? AND match_id IS NOT NULL
        )`,
    [tournamentId, tournamentId, tournamentId, tournamentId]
  );
  const schedules = await rows(
    connection,
    `SELECT DISTINCT proposals.id, proposals.tournament_round_match_id,
            proposals.tournament_match_id, proposals.tournament_series_id
     FROM match_schedule_proposals proposals
     LEFT JOIN tournament_round_matches legacy_series
       ON proposals.tournament_round_match_id COLLATE utf8mb4_general_ci = legacy_series.id
     LEFT JOIN tournament_matches legacy_game
       ON proposals.tournament_match_id COLLATE utf8mb4_general_ci = legacy_game.id
     WHERE legacy_series.tournament_id = ? OR legacy_game.tournament_id = ?`,
    [tournamentId, tournamentId]
  );
  const existingRows = await rows(
    connection,
    `SELECT (SELECT COUNT(*) FROM tournament_phases WHERE tournament_id = ?) +
            (SELECT COUNT(*) FROM tournament_entries WHERE tournament_id = ?) AS count`,
    [tournamentId, tournamentId]
  );
  const matchIds = [...new Set(legacyGames.map(game => game.match_id).filter(Boolean))];
  const validMatches = matchIds.length
    ? await rows(connection, `SELECT id FROM matches WHERE id IN (${matchIds.map(() => '?').join(',')})`, matchIds)
    : [];

  return {
    tournament: tournamentRows[0],
    teams,
    participants,
    rounds: legacyRounds,
    series: legacySeries,
    games: legacyGames,
    byes: legacyByes,
    replays,
    schedules,
    existingPhaseRows: numberValue(existingRows[0]?.count),
    validMatchIds: new Set(validMatches.map(match => match.id)),
  };
}

/**
 * Builds an immutable conversion plan and rejects any history that cannot be
 * represented exactly. UUIDs are allocated before writes so replay and schedule
 * targets can be audited in dry-run mode using the same mapping apply mode uses.
 */
export function buildConversionPlan(source: LegacySource): ConversionPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tournamentId = source.tournament.id as string;
  const phaseId = randomUUID();
  const groupId = randomUUID();
  const roundByLegacy = new Map(source.rounds.map(round => [round.id as string, randomUUID()]));
  const seriesByLegacy = new Map(source.series.map(series => [series.id as string, randomUUID()]));
  // Organizer actions are administrative evidence attached to a series, not
  // played games. Their authoritative outcome is already stored on the series.
  const gamesToMigrate = source.games.filter(game => !game.organizer_action);
  const administrativeGames = source.games.filter(game => Boolean(game.organizer_action));
  const gameByLegacy = new Map(gamesToMigrate.map(game => [game.id as string, randomUUID()]));

  if (Number(source.tournament.competition_model_version) !== 1) errors.push('Tournament is not a legacy version 1 competition');
  if (source.tournament.status !== 'finished') errors.push('Only finished legacy tournaments can be converted');
  if (source.existingPhaseRows > 0) errors.push('Tournament already contains phase-engine rows');
  const isTeamLeague = source.tournament.tournament_mode === 'team'
    && source.tournament.tournament_type === 'league';
  const isIndividualElimination = ['ranked', 'unranked'].includes(source.tournament.tournament_mode)
    && source.tournament.tournament_type === 'elimination';
  if (!isTeamLeague && !isIndividualElimination) {
    errors.push('Supported conversions are limited to team league and individual elimination tournaments');
  }

  // Registration tables can retain incomplete or rejected records. Historical
  // series and byes define the actual competitive field that must be migrated.
  const participantById = new Map(source.participants.map(participant => [participant.participant_id, participant]));
  const usedEntityIds = new Set<string>();
  for (const series of source.series) {
    usedEntityIds.add(series.player1_id);
    usedEntityIds.add(series.player2_id);
  }
  for (const bye of source.byes) {
    const participant = bye.participant_id ? participantById.get(bye.participant_id) : null;
    const entityId = isTeamLeague ? bye.team_id : participant?.user_id;
    if (entityId) usedEntityIds.add(entityId);
  }
  const entitySources = isTeamLeague
    ? source.teams.filter(team => usedEntityIds.has(team.id))
    : source.participants.filter(participant => usedEntityIds.has(participant.user_id));
  const duplicateEntityIds = entitySources
    .map(entity => isTeamLeague ? entity.id : entity.user_id)
    .filter((entityId, index, values) => values.indexOf(entityId) !== index);
  if (duplicateEntityIds.length) errors.push('The competitive field contains duplicate participant registrations');
  const entities: EntityPlan[] = entitySources.map(entity => ({
    entityId: isTeamLeague ? entity.id : entity.user_id,
    entryId: randomUUID(),
    entryType: isTeamLeague ? 'team' : 'player',
    participantId: isTeamLeague ? null : entity.participant_id,
    teamId: isTeamLeague ? entity.id : null,
    name: isTeamLeague ? entity.name : entity.nickname,
    source: entity,
  }));
  const entryByEntity = new Map(entities.map(entity => [entity.entityId, entity.entryId]));
  const entityIds = new Set(entities.map(entity => entity.entityId));
  if (entities.length < 2) errors.push('At least two historical competition entries are required');
  if ([...usedEntityIds].some(entityId => !entityIds.has(entityId))) {
    errors.push('A historical series or bye cannot be mapped to an eligible registration');
  }
  if (isIndividualElimination && entitySources.some(participant => participant.participation_status !== 'accepted')) {
    errors.push('An elimination entry does not have an accepted participant registration');
  }

  const roundIds = new Set(source.rounds.map(round => round.id as string));
  if (isTeamLeague) {
    for (const entity of entities) {
      const activeMembers = source.participants.filter(participant =>
        participant.team_id === entity.entityId
        && ['accepted', 'pending_replacement'].includes(participant.participation_status)
      );
      if (activeMembers.length !== 2) {
        warnings.push(`Team ${entity.name} has ${activeMembers.length} current accepted/pending replacement members instead of 2`);
      }
    }
  }

  const roundNumbers = source.rounds.map(round => Number(round.round_number));
  if (roundNumbers.some((roundNumber, index) => roundNumber !== index + 1)) {
    errors.push('Legacy round numbers are not contiguous from 1');
  }

  const pairCounts = new Map<string, number>();
  const seriesByRound = new Map<string, any[]>();
  const gamesBySeries = new Map<string, any[]>();
  const administrativeGamesBySeries = new Map<string, any[]>();
  for (const game of source.games) {
    const target = game.organizer_action ? administrativeGamesBySeries : gamesBySeries;
    const values = target.get(game.tournament_round_match_id) || [];
    values.push(game);
    target.set(game.tournament_round_match_id, values);
  }
  for (const series of source.series) {
    const values = seriesByRound.get(series.round_id) || [];
    values.push(series);
    seriesByRound.set(series.round_id, values);
    if (!roundIds.has(series.round_id)) errors.push(`Series ${series.id} references a round outside the tournament`);
    if (!entityIds.has(series.player1_id) || !entityIds.has(series.player2_id)) {
      errors.push(`Series ${series.id} references an entry outside the competitive field`);
      continue;
    }
    if (series.player1_id === series.player2_id) errors.push(`Series ${series.id} pairs an entry with itself`);
    const bestOf = normalizedBestOf(series.best_of);
    if (!bestOf) errors.push(`Series ${series.id} has unsupported best_of=${series.best_of}`);
    if (Number(series.wins_required) !== Math.floor(Number(series.best_of) / 2) + 1) {
      errors.push(`Series ${series.id} has inconsistent wins_required`);
    }
    if (!series.winner_id || !entityIds.has(series.winner_id)) errors.push(`Completed series ${series.id} has no valid winner`);
    if (series.series_status !== 'completed') errors.push(`Series ${series.id} is not completed`);
    const loserId = series.winner_id === series.player1_id ? series.player2_id : series.player1_id;
    if (series.winner_id && ![series.player1_id, series.player2_id].includes(series.winner_id)) {
      errors.push(`Series ${series.id} winner is not one of its entries`);
    }
    if (loserId === series.winner_id) errors.push(`Series ${series.id} cannot determine a loser`);
    if (isTeamLeague) {
      const pair = unorderedPair(series.player1_id, series.player2_id);
      pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
    }

    const games = gamesBySeries.get(series.id) || [];
    const administrativeSeriesGames = administrativeGamesBySeries.get(series.id) || [];
    const player1GameWins = games.filter(game => game.winner_id === series.player1_id).length;
    const player2GameWins = games.filter(game => game.winner_id === series.player2_id).length;
    if (games.some(game => !game.winner_id || ![series.player1_id, series.player2_id].includes(game.winner_id))) {
      errors.push(`Series ${series.id} contains a game without a valid entry winner`);
    }
    if (games.some(game => game.match_status !== 'completed')) {
      errors.push(`Series ${series.id} contains a game that is not completed`);
    }
    if ([...games, ...administrativeSeriesGames].some(game =>
      unorderedPair(game.player1_id, game.player2_id) !== unorderedPair(series.player1_id, series.player2_id)
    )) {
      errors.push(`Series ${series.id} contains a game whose entries do not match the series`);
    }
    if (games.some(game => game.loser_id && game.loser_id !== (game.winner_id === series.player1_id ? series.player2_id : series.player1_id))) {
      errors.push(`Series ${series.id} contains a game with an inconsistent loser`);
    }
    if (administrativeSeriesGames.some(game =>
      !['organizer_win', 'organizer_loss'].includes(game.organizer_action)
      || game.match_status !== 'completed'
    )) {
      errors.push(`Series ${series.id} contains an unsupported administrative game row`);
    }
    const seriesPlayer1Wins = Number(series.player1_wins);
    const seriesPlayer2Wins = Number(series.player2_wins);
    if (player1GameWins > seriesPlayer1Wins || player2GameWins > seriesPlayer2Wins) {
      errors.push(`Series ${series.id} has fewer legacy counter wins than its played games`);
    }
    if (administrativeSeriesGames.length === 0
      && (player1GameWins !== seriesPlayer1Wins || player2GameWins !== seriesPlayer2Wins)) {
      errors.push(`Series ${series.id} played game wins do not match its legacy counters`);
    }
    const winnerCounter = series.winner_id === series.player1_id ? seriesPlayer1Wins : seriesPlayer2Wins;
    const loserCounter = series.winner_id === series.player1_id ? seriesPlayer2Wins : seriesPlayer1Wins;
    if (winnerCounter <= loserCounter) {
      errors.push(`Series ${series.id} counters do not support its declared winner`);
    }
  }
  if (administrativeGames.length) {
    warnings.push(`${administrativeGames.length} organizer action rows will remain in legacy history but will not be represented as played v2 games`);
  }

  let cycleCount: 1 | 2 | null = null;
  if (isTeamLeague && entities.length >= 2) {
    const expectedRoundsPerCycle = entities.length % 2 === 0 ? entities.length - 1 : entities.length;
    const expectedSeriesPerCycle = entities.length * (entities.length - 1) / 2;
    const roundCycleRatio = source.rounds.length / expectedRoundsPerCycle;
    const seriesCycleRatio = source.series.length / expectedSeriesPerCycle;
    const inferredCycle = Number.isInteger(roundCycleRatio) && roundCycleRatio === seriesCycleRatio
      ? roundCycleRatio
      : 0;
    if (inferredCycle !== 1 && inferredCycle !== 2) {
      errors.push(`Round/series totals do not describe a complete one- or two-cycle league (round ratio ${roundCycleRatio}, series ratio ${seriesCycleRatio})`);
    } else {
      cycleCount = inferredCycle;
    }
    if (cycleCount && ([...pairCounts.values()].some(count => count !== cycleCount)
      || pairCounts.size !== expectedSeriesPerCycle)) {
      errors.push('Legacy pair frequencies do not match the inferred league cycle count');
    }
  }

  const sourceByeByRound = new Map<string, Set<string>>();
  for (const bye of source.byes) {
    const participant = bye.participant_id ? participantById.get(bye.participant_id) : null;
    const entityId = isTeamLeague ? bye.team_id : participant?.user_id;
    if (!entityId || !entityIds.has(entityId)) {
      errors.push(`Stored bye ${bye.id} cannot be mapped to a competition entry`);
      continue;
    }
    const values = sourceByeByRound.get(bye.round_id) || new Set<string>();
    values.add(entityId);
    sourceByeByRound.set(bye.round_id, values);
  }

  const derivedByes: Array<{ roundId: string; entityId: string; reason: string }> = [];
  let championEntityId: string | null = null;
  let runnerUpEntityId: string | null = null;
  if (isTeamLeague) {
    for (const round of source.rounds) {
      const seen = new Set<string>();
      for (const series of seriesByRound.get(round.id) || []) {
        if (seen.has(series.player1_id) || seen.has(series.player2_id)) {
          errors.push(`Round ${round.round_number} schedules an entry more than once`);
        }
        seen.add(series.player1_id);
        seen.add(series.player2_id);
      }
      const absent = entities.filter(entity => !seen.has(entity.entityId));
      const expectedByeCount = entities.length % 2;
      if (absent.length !== expectedByeCount) {
        errors.push(`Round ${round.round_number} has ${absent.length} absent teams; expected ${expectedByeCount}`);
      }
      for (const entity of absent) {
        derivedByes.push({ roundId: round.id, entityId: entity.entityId, reason: 'legacy_league_bye' });
      }
    }
  } else if (isIndividualElimination) {
    let expectedEntries = new Set(entityIds);
    for (const round of source.rounds) {
      const seen = new Set<string>();
      const roundSeries = seriesByRound.get(round.id) || [];
      for (const series of roundSeries) {
        if (!expectedEntries.has(series.player1_id) || !expectedEntries.has(series.player2_id)) {
          errors.push(`Round ${round.round_number} contains an entry that did not advance from the previous round`);
        }
        if (seen.has(series.player1_id) || seen.has(series.player2_id)) {
          errors.push(`Round ${round.round_number} schedules an entry more than once`);
        }
        seen.add(series.player1_id);
        seen.add(series.player2_id);
      }
      const absent = [...expectedEntries].filter(entityId => !seen.has(entityId));
      const expectedByeCount = expectedEntries.size % 2;
      if (absent.length !== expectedByeCount) {
        errors.push(`Elimination round ${round.round_number} has ${absent.length} byes; expected ${expectedByeCount}`);
      }
      for (const entityId of absent) {
        derivedByes.push({ roundId: round.id, entityId, reason: 'legacy_elimination_bye' });
      }
      expectedEntries = new Set([...roundSeries.map(series => series.winner_id), ...absent].filter(Boolean));
    }
    if (expectedEntries.size !== 1) errors.push('The elimination history does not resolve to exactly one champion');
    championEntityId = [...expectedEntries][0] || null;
    const lastRound = source.rounds[source.rounds.length - 1];
    const finalSeries = lastRound ? seriesByRound.get(lastRound.id) || [] : [];
    if (finalSeries.length !== 1 || derivedByes.some(bye => bye.roundId === lastRound?.id)) {
      errors.push('The final elimination round must contain exactly one completed series and no bye');
    } else {
      runnerUpEntityId = finalSeries[0].winner_id === finalSeries[0].player1_id
        ? finalSeries[0].player2_id
        : finalSeries[0].player1_id;
      if (championEntityId !== finalSeries[0].winner_id) errors.push('The final winner does not match the derived champion');
    }
  }

  const sourceByeKeys = new Set<string>();
  for (const [roundId, byeEntities] of sourceByeByRound) {
    for (const entityId of byeEntities) sourceByeKeys.add(`${roundId}:${entityId}`);
  }
  const derivedByeKeys = new Set(derivedByes.map(bye => `${bye.roundId}:${bye.entityId}`));
  if (sourceByeKeys.size === 0 && derivedByeKeys.size > 0) {
    warnings.push(`${derivedByeKeys.size} unambiguous byes were reconstructed because the legacy bye table is empty`);
  } else if (sourceByeKeys.size !== derivedByeKeys.size || [...sourceByeKeys].some(key => !derivedByeKeys.has(key))) {
    errors.push('Stored legacy byes do not match the reconstructed competition history');
  }

  // The copied standings must agree with authoritative completed series and
  // with automatic wins awarded by the legacy elimination implementation.
  const outcomesByEntity = new Map(entities.map(entity => [entity.entityId, { wins: 0, losses: 0 }]));
  for (const series of source.series) {
    if (![series.player1_id, series.player2_id].includes(series.winner_id)) continue;
    const loserId = series.winner_id === series.player1_id ? series.player2_id : series.player1_id;
    outcomesByEntity.get(series.winner_id)!.wins += 1;
    outcomesByEntity.get(loserId)!.losses += 1;
  }
  if (isIndividualElimination) {
    for (const bye of derivedByes) outcomesByEntity.get(bye.entityId)!.wins += 1;
  }
  for (const entity of entities) {
    const outcome = outcomesByEntity.get(entity.entityId)!;
    if (numberValue(entity.source.tournament_wins) !== outcome.wins
      || numberValue(entity.source.tournament_losses) !== outcome.losses
      || numberValue(entity.source.tournament_points) !== outcome.wins) {
      errors.push(
        `${entity.name} legacy standings do not match series outcomes and byes `
        + `(stored ${entity.source.tournament_wins}W-${entity.source.tournament_losses}L/${entity.source.tournament_points}pts, `
        + `derived ${outcome.wins}W-${outcome.losses}L/${outcome.wins}pts)`
      );
    }
  }

  for (const game of source.games) {
    if (!seriesByLegacy.has(game.tournament_round_match_id)) {
      errors.push(`Game ${game.id} is not linked to a legacy series`);
    }
    if (game.match_id && !source.validMatchIds.has(game.match_id)) {
      errors.push(`Game ${game.id} references missing ranked match ${game.match_id}`);
    }
  }

  const gamesByMatchId = new Map<string, any[]>();
  for (const game of gamesToMigrate) {
    if (!game.match_id) continue;
    const values = gamesByMatchId.get(game.match_id) || [];
    values.push(game);
    gamesByMatchId.set(game.match_id, values);
  }
  const replayTargets: Array<{ replayId: string; gameId: string }> = [];
  for (const replay of source.replays) {
    const directGame = replay.tournament_match_id
      ? gamesToMigrate.find(game => game.id === replay.tournament_match_id)
      : undefined;
    const matchCandidates = replay.match_id ? gamesByMatchId.get(replay.match_id) || [] : [];
    const seriesCandidates = replay.tournament_round_match_id
      ? gamesBySeries.get(replay.tournament_round_match_id) || []
      : [];
    const target = directGame
      || (matchCandidates.length === 1 ? matchCandidates[0] : undefined)
      || (seriesCandidates.length === 1 ? seriesCandidates[0] : undefined);
    const identifiersAgree = Boolean(target)
      && (matchCandidates.length === 0 || (matchCandidates.length === 1 && matchCandidates[0].id === target.id))
      && (seriesCandidates.length === 0 || seriesCandidates.some(game => game.id === target.id));
    if (!target || !identifiersAgree) {
      errors.push(`Replay ${replay.id} cannot be mapped unambiguously to one legacy game`);
    } else {
      const gameId = gameByLegacy.get(target.id)!;
      if (replay.tournament_game_id && replay.tournament_game_id !== gameId) {
        errors.push(`Replay ${replay.id} already points to a different phase-engine game`);
      }
      replayTargets.push({ replayId: replay.id, gameId });
    }
  }

  const gameById = new Map(source.games.map(game => [game.id, game]));
  const scheduleTargets: Array<{ proposalId: string; seriesId: string }> = [];
  const legacySeriesWithProposal = new Set<string>();
  for (const proposal of source.schedules) {
    const legacySeriesIds = new Set<string>();
    if (proposal.tournament_round_match_id && seriesByLegacy.has(proposal.tournament_round_match_id)) {
      legacySeriesIds.add(proposal.tournament_round_match_id);
    }
    if (proposal.tournament_match_id) {
      const gameSeriesId = gameById.get(proposal.tournament_match_id)?.tournament_round_match_id;
      if (gameSeriesId) legacySeriesIds.add(gameSeriesId);
    }
    const legacySeriesId = legacySeriesIds.size === 1 ? [...legacySeriesIds][0] : null;
    const targetSeries = legacySeriesId ? seriesByLegacy.get(legacySeriesId) : undefined;
    if (!targetSeries || legacySeriesIds.size !== 1) {
      errors.push(`Schedule proposal ${proposal.id} cannot be mapped to a legacy series`);
    } else {
      if (proposal.tournament_series_id && proposal.tournament_series_id !== targetSeries) {
        errors.push(`Schedule proposal ${proposal.id} already points to a different phase-engine series`);
      }
      scheduleTargets.push({ proposalId: proposal.id, seriesId: targetSeries });
      legacySeriesWithProposal.add(legacySeriesId!);
    }
  }

  const participantUserIds = new Set(source.participants.map(participant => participant.user_id));
  const embeddedScheduleTargets: EmbeddedScheduleTarget[] = [];
  for (const series of source.series.filter(value => value.scheduled_datetime)) {
    if (legacySeriesWithProposal.has(series.id)) continue;
    if (!series.scheduled_by_player_id || !participantUserIds.has(series.scheduled_by_player_id)) {
      errors.push(`Embedded schedule on series ${series.id} has no valid proposing participant`);
      continue;
    }
    if (!['confirmed', 'pending_confirmation'].includes(series.scheduled_status)) {
      errors.push(`Embedded schedule on series ${series.id} has unsupported status ${series.scheduled_status}`);
      continue;
    }
    embeddedScheduleTargets.push({
      proposalId: randomUUID(),
      slotId: randomUUID(),
      legacySeriesId: series.id,
      seriesId: seriesByLegacy.get(series.id)!,
      proposedByUserId: series.scheduled_by_player_id,
      scheduledDatetime: series.scheduled_datetime,
      legacyStatus: series.scheduled_status,
      // The legacy row did not persist proposal creation time. Its last known
      // scheduling event is the narrowest non-invented timestamp available.
      proposedAt: series.scheduled_confirmed_at || series.updated_at || series.created_at,
    });
  }
  if (embeddedScheduleTargets.length) {
    warnings.push(`${embeddedScheduleTargets.length} embedded legacy schedules will be materialized as v2 proposals with one slot each`);
  }

  const legacyRanking = entities.map(entity => Number(entity.source.tournament_ranking));
  const hasCompleteRanking = legacyRanking.every(rank => Number.isInteger(rank) && rank >= 1 && rank <= entities.length)
    && new Set(legacyRanking).size === entities.length;
  if (!hasCompleteRanking) {
    errors.push('Legacy rankings are incomplete or duplicated; final placements require explicit reconciliation');
  }
  const orderedEntities = [...entities].sort((left, right) => {
    if (hasCompleteRanking) return Number(left.source.tournament_ranking) - Number(right.source.tournament_ranking);
    return numberValue(right.source.tournament_points) - numberValue(left.source.tournament_points)
      || numberValue(right.source.tournament_wins) - numberValue(left.source.tournament_wins)
      || numberValue(right.source.omp) - numberValue(left.source.omp)
      || numberValue(right.source.gwp) - numberValue(left.source.gwp)
      || numberValue(right.source.ogp) - numberValue(left.source.ogp)
      || String(left.name).localeCompare(String(right.name));
  });
  const byeCountByEntity = new Map<string, number>();
  for (const bye of derivedByes) byeCountByEntity.set(bye.entityId, (byeCountByEntity.get(bye.entityId) || 0) + 1);
  const standings = orderedEntities.map((entity, index): StandingPlan => ({
    entityId: entity.entityId,
    entryId: entity.entryId,
    seed: index + 1,
    placement: index + 1,
    // Version 2 records automatic advancement separately from competitive
    // wins, while the legacy elimination model counted a bye as both.
    wins: numberValue(entity.source.tournament_wins)
      - (isIndividualElimination ? byeCountByEntity.get(entity.entityId) || 0 : 0),
    losses: numberValue(entity.source.tournament_losses),
    points: numberValue(entity.source.tournament_points),
    omp: numberValue(entity.source.omp),
    gwp: numberValue(entity.source.gwp),
    ogp: numberValue(entity.source.ogp),
    byes: byeCountByEntity.get(entity.entityId) || 0,
  }));

  const roundBestOf = source.rounds.map(round => {
    const values = [...new Set((seriesByRound.get(round.id) || []).map(series => Number(series.best_of)))];
    if (values.length !== 1 || !normalizedBestOf(values[0])) {
      errors.push(`Round ${round.round_number} does not have one supported best-of value`);
      return 1 as 1 | 3 | 5;
    }
    return values[0] as 1 | 3 | 5;
  });
  const frequencies = new Map<1 | 3 | 5, number>();
  for (const bestOf of roundBestOf) frequencies.set(bestOf, (frequencies.get(bestOf) || 0) + 1);
  const defaultBestOf = [...frequencies.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || 1;

  return {
    tournamentId,
    phaseId,
    groupId,
    format: isIndividualElimination ? 'single_elimination' : 'round_robin',
    cycleCount,
    bracketSize: isIndividualElimination ? entities.length : null,
    championEntityId,
    runnerUpEntityId,
    defaultBestOf,
    entities,
    entryByEntity,
    roundByLegacy,
    seriesByLegacy,
    gameByLegacy,
    gamesToMigrate,
    administrativeGameCount: administrativeGames.length,
    standings,
    derivedByes,
    replayTargets,
    scheduleTargets,
    embeddedScheduleTargets,
    errors,
    warnings,
  };
}

function publicReport(source: LegacySource, plan: ConversionPlan, applied: boolean, reconciliation: string[] = []) {
  const membersByTeam = new Map<string, string[]>();
  for (const member of source.participants.filter(participant => participant.team_id)) {
    const values = membersByTeam.get(member.team_id) || [];
    values.push(`${member.nickname} [${member.participation_status}]`);
    membersByTeam.set(member.team_id, values);
  }
  return {
    mode: applied ? 'apply' : 'dry-run',
    applied,
    readyToApply: plan.errors.length === 0,
    tournament: source.tournament,
    inferredFormat: {
      format: plan.format,
      cycleCount: plan.cycleCount,
      bracketSize: plan.bracketSize,
      defaultBestOf: plan.defaultBestOf,
      champion: plan.entities.find(entity => entity.entityId === plan.championEntityId)?.name || null,
      runnerUp: plan.entities.find(entity => entity.entityId === plan.runnerUpEntityId)?.name || null,
    },
    sourceCounts: {
      competitionEntries: plan.entities.length,
      registrations: source.participants.length,
      replacementHistoryRows: source.participants.filter(participant =>
        participant.participation_status === 'replaced' || participant.requested_replacement_of_id
      ).length,
      rounds: source.rounds.length,
      series: source.series.length,
      gameRows: source.games.length,
      playedGamesToMigrate: plan.gamesToMigrate.length,
      administrativeGameRowsRetainedAsLegacyEvidence: plan.administrativeGameCount,
      byesStored: source.byes.length,
      byesDerived: plan.derivedByes.length,
      replays: source.replays.length,
      existingScheduleProposals: source.schedules.length,
      embeddedSchedulesToMaterialize: plan.embeddedScheduleTargets.length,
    },
    standings: plan.standings.map(standing => {
      const entity = plan.entities.find(value => value.entityId === standing.entityId);
      return {
        placement: standing.placement,
        name: entity?.name,
        members: entity?.teamId ? membersByTeam.get(entity.teamId) || [] : undefined,
        wins: standing.wins,
        losses: standing.losses,
        points: standing.points,
        omp: standing.omp,
        gwp: standing.gwp,
        ogp: standing.ogp,
      };
    }),
    mappedLinks: {
      replays: plan.replayTargets.length,
      existingScheduleProposals: plan.scheduleTargets.length,
      materializedScheduleProposals: plan.embeddedScheduleTargets.length,
    },
    warnings: plan.warnings,
    errors: plan.errors,
    reconciliation,
  };
}

async function insertConversion(connection: PoolConnection, source: LegacySource, plan: ConversionPlan): Promise<void> {
  const startedAt = source.tournament.started_at || source.tournament.created_at;
  const finishedAt = source.tournament.finished_at || new Date();
  const isLeague = plan.format === 'round_robin';
  await connection.execute(
    `INSERT INTO tournament_phases
       (id, tournament_id, phase_order, name, description, format, assignment_method,
        default_best_of, status, auto_start, started_at, completed_at)
     VALUES (?, ?, 1, ?, ?, ?, 'manual', ?, 'completed', 0, ?, ?)`,
    [plan.phaseId, plan.tournamentId,
      isLeague ? 'Legacy League' : 'Legacy Elimination',
      isLeague ? 'Converted from the legacy team league model.' : 'Converted from the legacy individual elimination model.',
      plan.format, plan.defaultBestOf, startedAt, finishedAt]
  );
  if (isLeague) {
    await connection.execute(
      `INSERT INTO tournament_round_robin_settings (phase_id, cycle_count, open_rounds_together)
       VALUES (?, ?, 1)`,
      [plan.phaseId, plan.cycleCount]
    );
  } else {
    await connection.execute(
      `INSERT INTO tournament_elimination_settings (phase_id, bracket_size, seeding_policy, reseed_each_round)
       VALUES (?, ?, 'manual', 0)`,
      [plan.phaseId, plan.bracketSize]
    );
  }
  await connection.execute(
    `INSERT INTO tournament_phase_scoring (phase_id, profile_code, win_points, loss_points, bye_points)
     VALUES (?, ?, 1.00, 0.00, ?)`,
    [plan.phaseId, isLeague ? 'legacy_team_league' : 'legacy_individual_elimination', isLeague ? 0 : 1]
  );
  for (const [index, metric] of ['wins', 'omp', 'gwp', 'ogp', 'initial_seed'].entries()) {
    await connection.execute(
      `INSERT INTO tournament_phase_tiebreakers (phase_id, priority, metric) VALUES (?, ?, ?)`,
      [plan.phaseId, index + 1, metric]
    );
  }
  await connection.execute(
    `INSERT INTO tournament_phase_groups
       (id, phase_id, group_order, name, status, started_at, completed_at)
     VALUES (?, ?, 1, ?, 'completed', ?, ?)`,
    [plan.groupId, plan.phaseId, isLeague ? 'League' : 'Bracket', startedAt, finishedAt]
  );

  for (const standing of plan.standings) {
    const entity = plan.entities.find(value => value.entityId === standing.entityId)!;
    await connection.execute(
      `INSERT INTO tournament_entries
         (id, tournament_id, entry_type, participant_id, team_id, initial_seed, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [standing.entryId, plan.tournamentId, entity.entryType,
        entity.participantId, entity.teamId, standing.seed]
    );
    await connection.execute(
      `INSERT INTO tournament_phase_entry_assignments
         (id, group_id, participant_id, team_id, group_seed)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), plan.groupId, entity.participantId, entity.teamId, standing.seed]
    );
    await connection.execute(
      `INSERT INTO tournament_phase_entries
         (id, group_id, entry_id, group_seed, status, qualified_at, eliminated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), plan.groupId, standing.entryId, standing.seed,
        isLeague ? 'active' : standing.entityId === plan.championEntityId ? 'qualified' : 'eliminated',
        startedAt, !isLeague && standing.entityId !== plan.championEntityId ? finishedAt : null]
    );
    await connection.execute(
      `INSERT INTO tournament_phase_standings
         (group_id, entry_id, matches_played, wins, losses, points, byes,
          omp, gwp, ogp, rank_position, is_qualified, finalized_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [plan.groupId, standing.entryId, standing.wins + standing.losses,
        standing.wins, standing.losses, standing.points, standing.byes,
        standing.omp, standing.gwp, standing.ogp, standing.placement,
        standing.entityId === plan.championEntityId ? 1 : 0, finishedAt]
    );
    if (isLeague || [plan.championEntityId, plan.runnerUpEntityId].includes(standing.entityId)) {
      const placement = isLeague ? standing.placement : standing.entityId === plan.championEntityId ? 1 : 2;
      await connection.execute(
        `INSERT INTO tournament_results
           (tournament_id, entry_id, placement, placement_label, is_champion, determined_by_group_id, determined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [plan.tournamentId, standing.entryId, placement,
          placement === 1 ? 'Champion' : placement === 2 ? 'Runner-up' : null,
          placement === 1 ? 1 : 0, plan.groupId, finishedAt]
      );
    }
  }

  const seriesByRound = new Map<string, any[]>();
  for (const series of source.series) {
    const values = seriesByRound.get(series.round_id) || [];
    values.push(series);
    seriesByRound.set(series.round_id, values);
  }
  let previousWinningSeriesByEntity = new Map<string, string>();
  let previousByeEntities = new Set<string>();
  for (const round of source.rounds) {
    const roundSeries = seriesByRound.get(round.id) || [];
    const bestOf = Number(roundSeries[0]?.best_of || plan.defaultBestOf);
    const newRoundId = plan.roundByLegacy.get(round.id)!;
    await connection.execute(
      `INSERT INTO tournament_phase_rounds
         (id, group_id, round_number, name, status, best_of, starts_at, deadline_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`,
      [newRoundId, plan.groupId, round.round_number,
        round.round_phase_label || `Round ${round.round_number}`, bestOf,
        round.round_start_date || round.created_at, round.round_end_date,
        round.round_end_date || round.updated_at, round.created_at, round.updated_at]
    );
    if (bestOf !== plan.defaultBestOf) {
      await connection.execute(
        `INSERT INTO tournament_phase_round_overrides
           (id, phase_id, round_from_start, round_from_end, best_of)
         VALUES (?, ?, ?, NULL, ?)`,
        [randomUUID(), plan.phaseId, round.round_number, bestOf]
      );
    }
    for (const [positionIndex, series] of roundSeries.entries()) {
      const newSeriesId = plan.seriesByLegacy.get(series.id)!;
      const entry1Id = plan.entryByEntity.get(series.player1_id)!;
      const entry2Id = plan.entryByEntity.get(series.player2_id)!;
      const winnerEntryId = plan.entryByEntity.get(series.winner_id)!;
      const loserEntityId = series.winner_id === series.player1_id ? series.player2_id : series.player1_id;
      const loserEntryId = plan.entryByEntity.get(loserEntityId)!;
      await connection.execute(
        `INSERT INTO tournament_series
           (id, round_id, series_position, status, best_of, wins_required,
            entry1_wins, entry2_wins, winner_entry_id, loser_entry_id,
            started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newSeriesId, newRoundId, positionIndex + 1, series.best_of, series.wins_required,
          series.player1_wins, series.player2_wins, winnerEntryId, loserEntryId,
          series.created_at, series.updated_at, series.created_at, series.updated_at]
      );
      for (const [slotIndex, entityId] of [series.player1_id, series.player2_id].entries()) {
        const entryId = plan.entryByEntity.get(entityId)!;
        const sourceSeriesId = !isLeague ? previousWinningSeriesByEntity.get(entityId) : null;
        if (sourceSeriesId) {
          await connection.execute(
            `INSERT INTO tournament_series_slots
               (id, series_id, slot_number, source_type, source_series_id,
                source_outcome, resolved_entry_id, resolved_at)
             VALUES (?, ?, ?, 'series_result', ?, 'winner', ?, ?)`,
            [randomUUID(), newSeriesId, slotIndex + 1, sourceSeriesId, entryId, series.created_at]
          );
        } else {
          // A direct slot in a later elimination round represents an entry
          // whose preceding advancement was the separately persisted bye.
          if (!isLeague && Number(round.round_number) > 1 && !previousByeEntities.has(entityId)) {
            throw new Error(`Cannot reconstruct elimination slot provenance for entry ${entityId}`);
          }
          await connection.execute(
            `INSERT INTO tournament_series_slots
               (id, series_id, slot_number, source_type, resolved_entry_id, resolved_at)
             VALUES (?, ?, ?, 'direct', ?, ?)`,
            [randomUUID(), newSeriesId, slotIndex + 1, entryId, series.created_at]
          );
        }
      }
      const legacyGames = plan.gamesToMigrate.filter(game => game.tournament_round_match_id === series.id);
      for (const [gameIndex, game] of legacyGames.entries()) {
        const winner = plan.entryByEntity.get(game.winner_id)!;
        // Derive the loser from the validated series pair. This avoids carrying
        // a nullable legacy convenience field into the authoritative v2 graph.
        const loserEntityId = game.winner_id === series.player1_id ? series.player2_id : series.player1_id;
        const loser = plan.entryByEntity.get(loserEntityId)!;
        await connection.execute(
          `INSERT INTO tournament_games
             (id, series_id, game_number, entry1_id, entry2_id, winner_entry_id, loser_entry_id,
              match_id, status, organizer_action, map, winner_faction, loser_faction, winner_side,
              winner_comments, winner_rating, loser_comments, loser_rating, replay_downloads,
              played_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [plan.gameByLegacy.get(game.id), newSeriesId, gameIndex + 1, entry1Id, entry2Id, winner, loser,
            game.match_id, game.organizer_action, game.map, game.winner_faction, game.loser_faction,
            game.linked_winner_side, game.winner_comments, game.winner_rating, game.loser_comments,
            game.loser_rating, numberValue(game.replay_downloads), game.played_at,
            game.created_at, game.updated_at]
        );
      }
    }
    previousWinningSeriesByEntity = new Map(
      roundSeries.map(series => [series.winner_id, plan.seriesByLegacy.get(series.id)!])
    );
    previousByeEntities = new Set(
      plan.derivedByes.filter(bye => bye.roundId === round.id).map(bye => bye.entityId)
    );
  }

  for (const bye of plan.derivedByes) {
    await connection.execute(
      `INSERT INTO tournament_byes (id, round_id, entry_id, reason, points_awarded)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), plan.roundByLegacy.get(bye.roundId), plan.entryByEntity.get(bye.entityId), bye.reason,
        isLeague ? 0 : 1]
    );
  }
  for (const replay of plan.replayTargets) {
    await connection.execute(
      `UPDATE replays
       SET tournament_game_id = ?, tournament_link_method = 'legacy_migration', tournament_linked_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [replay.gameId, replay.replayId]
    );
  }
  for (const schedule of plan.scheduleTargets) {
    await connection.execute(
      `UPDATE match_schedule_proposals SET tournament_series_id = ? WHERE id = ?`,
      [schedule.seriesId, schedule.proposalId]
    );
  }
  for (const schedule of plan.embeddedScheduleTargets) {
    const migratedStatus = schedule.legacyStatus === 'confirmed' ? 'confirmed' : 'pending';
    await connection.execute(
      `INSERT INTO match_schedule_proposals
         (id, tournament_series_id, proposed_by_user_id, proposed_at, status,
          user_id, challenge_mode, visibility, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'tournament', 'private', ?, ?, ?)`,
      [schedule.proposalId, schedule.seriesId, schedule.proposedByUserId,
        schedule.proposedAt, migratedStatus, schedule.proposedByUserId,
        'Migrated from an embedded legacy series schedule; individual confirmation history was not available.',
        schedule.proposedAt, schedule.proposedAt]
    );
    await connection.execute(
      `INSERT INTO match_schedule_slots
         (id, proposal_id, slot_datetime, slot_duration_minutes, status, created_at)
       VALUES (?, ?, ?, 30, ?, ?)`,
      [schedule.slotId, schedule.proposalId, schedule.scheduledDatetime,
        migratedStatus, schedule.proposedAt]
    );
  }
}

async function reconcileConversion(connection: PoolConnection, source: LegacySource, plan: ConversionPlan): Promise<string[]> {
  const checks: string[] = [];
  const expectedResultCount = plan.format === 'round_robin' ? plan.entities.length : 2;
  const countChecks: Array<[string, string, number]> = [
    ['entries', `SELECT COUNT(*) AS count FROM tournament_entries WHERE tournament_id = ?`, plan.entities.length],
    ['phases', `SELECT COUNT(*) AS count FROM tournament_phases WHERE tournament_id = ?`, 1],
    ['assignments', `SELECT COUNT(*) AS count FROM tournament_phase_entry_assignments WHERE group_id = ?`, plan.entities.length],
    ['phase entries', `SELECT COUNT(*) AS count FROM tournament_phase_entries WHERE group_id = ?`, plan.entities.length],
    ['standings', `SELECT COUNT(*) AS count FROM tournament_phase_standings WHERE group_id = ?`, plan.entities.length],
    ['results', `SELECT COUNT(*) AS count FROM tournament_results WHERE tournament_id = ?`, expectedResultCount],
    ['rounds', `SELECT COUNT(*) AS count FROM tournament_phase_rounds WHERE group_id = ?`, source.rounds.length],
    ['series', `SELECT COUNT(*) AS count FROM tournament_series series JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id WHERE rounds.group_id = ?`, source.series.length],
    ['series slots', `SELECT COUNT(*) AS count FROM tournament_series_slots slots JOIN tournament_series series ON series.id = slots.series_id JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id WHERE rounds.group_id = ?`, source.series.length * 2],
    ['games', `SELECT COUNT(*) AS count FROM tournament_games games JOIN tournament_series series ON series.id = games.series_id JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id WHERE rounds.group_id = ?`, plan.gamesToMigrate.length],
    ['byes', `SELECT COUNT(*) AS count FROM tournament_byes byes JOIN tournament_phase_rounds rounds ON rounds.id = byes.round_id WHERE rounds.group_id = ?`, plan.derivedByes.length],
  ];
  for (const [label, sql, expected] of countChecks) {
    const parameter = ['entries', 'phases', 'results'].includes(label) ? plan.tournamentId : plan.groupId;
    const result = await rows(connection, sql, [parameter]);
    const actual = numberValue(result[0]?.count);
    if (actual !== expected) throw new Error(`Reconciliation failed for ${label}: expected ${expected}, got ${actual}`);
    checks.push(`${label}: ${actual}`);
  }

  const standings = await rows(
    connection,
    `SELECT COALESCE(entries.team_id, participants.user_id) AS entity_id,
            standings.rank_position, standings.wins, standings.losses,
            standings.points, standings.omp, standings.gwp, standings.ogp
     FROM tournament_phase_standings standings
     JOIN tournament_entries entries ON entries.id = standings.entry_id
     LEFT JOIN tournament_participants participants ON participants.id = entries.participant_id
     WHERE standings.group_id = ? ORDER BY standings.rank_position`,
    [plan.groupId]
  );
  for (const expected of plan.standings) {
    const actual = standings.find(standing => standing.entity_id === expected.entityId);
    if (!actual
      || numberValue(actual.rank_position) !== expected.placement
      || numberValue(actual.wins) !== expected.wins
      || numberValue(actual.losses) !== expected.losses
      || numberValue(actual.points) !== expected.points
      || numberValue(actual.omp) !== expected.omp
      || numberValue(actual.gwp) !== expected.gwp
      || numberValue(actual.ogp) !== expected.ogp) {
      throw new Error(`Standings reconciliation failed for entry ${expected.entityId}`);
    }
  }
  checks.push(`standings: ${standings.length} exact rows`);

  const convertedByes = plan.derivedByes.length
    ? await rows(
      connection,
      `SELECT byes.round_id, byes.entry_id, byes.points_awarded
       FROM tournament_byes byes
       WHERE byes.round_id IN (${source.rounds.map(() => '?').join(',')})`,
      source.rounds.map(round => plan.roundByLegacy.get(round.id))
    )
    : [];
  for (const expected of plan.derivedByes) {
    const actual = convertedByes.find(bye =>
      bye.round_id === plan.roundByLegacy.get(expected.roundId)
      && bye.entry_id === plan.entryByEntity.get(expected.entityId)
    );
    const expectedPoints = plan.format === 'round_robin' ? 0 : 1;
    if (!actual || numberValue(actual.points_awarded) !== expectedPoints) {
      throw new Error(`Bye reconciliation failed for entry ${expected.entityId}, round ${expected.roundId}`);
    }
  }
  checks.push(`byes: ${convertedByes.length} exact rows`);

  const results = await rows(
    connection,
    `SELECT COALESCE(entries.team_id, participants.user_id) AS entity_id,
            results.placement, results.is_champion
     FROM tournament_results results
     JOIN tournament_entries entries ON entries.id = results.entry_id
     LEFT JOIN tournament_participants participants ON participants.id = entries.participant_id
     WHERE results.tournament_id = ?`,
    [plan.tournamentId]
  );
  const expectedResults = plan.format === 'round_robin'
    ? plan.standings.map(standing => ({ standing, placement: standing.placement }))
    : plan.standings
      .filter(standing => [plan.championEntityId, plan.runnerUpEntityId].includes(standing.entityId))
      .map(standing => ({ standing, placement: standing.entityId === plan.championEntityId ? 1 : 2 }));
  for (const { standing: expected, placement } of expectedResults) {
    const actual = results.find(result => result.entity_id === expected.entityId);
    if (!actual
      || numberValue(actual.placement) !== placement
      || Boolean(actual.is_champion) !== (placement === 1)) {
      throw new Error(`Final result reconciliation failed for entry ${expected.entityId}`);
    }
  }
  checks.push(`final results: ${results.length} exact rows`);

  const convertedSeries = await rows(
    connection,
    `SELECT id, best_of, wins_required, entry1_wins, entry2_wins, winner_entry_id, loser_entry_id
     FROM tournament_series WHERE id IN (${source.series.map(() => '?').join(',')})`,
    source.series.map(series => plan.seriesByLegacy.get(series.id))
  );
  for (const legacy of source.series) {
    const actual = convertedSeries.find(series => series.id === plan.seriesByLegacy.get(legacy.id));
    const loserEntityId = legacy.winner_id === legacy.player1_id ? legacy.player2_id : legacy.player1_id;
    if (!actual
      || numberValue(actual.best_of) !== numberValue(legacy.best_of)
      || numberValue(actual.wins_required) !== numberValue(legacy.wins_required)
      || numberValue(actual.entry1_wins) !== numberValue(legacy.player1_wins)
      || numberValue(actual.entry2_wins) !== numberValue(legacy.player2_wins)
      || actual.winner_entry_id !== plan.entryByEntity.get(legacy.winner_id)
      || actual.loser_entry_id !== plan.entryByEntity.get(loserEntityId)) {
      throw new Error(`Series reconciliation failed for legacy series ${legacy.id}`);
    }
  }
  checks.push(`series outcomes: ${convertedSeries.length} exact rows`);

  const convertedSlots = await rows(
    connection,
    `SELECT series_id, slot_number, source_type, source_series_id, source_outcome, resolved_entry_id
     FROM tournament_series_slots
     WHERE series_id IN (${source.series.map(() => '?').join(',')})`,
    source.series.map(series => plan.seriesByLegacy.get(series.id))
  );
  const legacySeriesByRound = new Map<string, any[]>();
  for (const series of source.series) {
    const values = legacySeriesByRound.get(series.round_id) || [];
    values.push(series);
    legacySeriesByRound.set(series.round_id, values);
  }
  let previousWinnerSources = new Map<string, string>();
  let previousByes = new Set<string>();
  for (const round of source.rounds) {
    const roundSeries = legacySeriesByRound.get(round.id) || [];
    for (const series of roundSeries) {
      for (const [slotIndex, entityId] of [series.player1_id, series.player2_id].entries()) {
        const actual = convertedSlots.find(slot =>
          slot.series_id === plan.seriesByLegacy.get(series.id) && numberValue(slot.slot_number) === slotIndex + 1
        );
        const expectedSourceSeries = plan.format === 'single_elimination'
          ? previousWinnerSources.get(entityId) || null
          : null;
        const expectedSourceType = expectedSourceSeries ? 'series_result' : 'direct';
        if (!actual
          || actual.source_type !== expectedSourceType
          || (actual.source_series_id || null) !== expectedSourceSeries
          || (actual.source_outcome || null) !== (expectedSourceSeries ? 'winner' : null)
          || actual.resolved_entry_id !== plan.entryByEntity.get(entityId)) {
          throw new Error(`Slot provenance reconciliation failed for legacy series ${series.id}, slot ${slotIndex + 1}`);
        }
        if (plan.format === 'single_elimination' && Number(round.round_number) > 1
          && !expectedSourceSeries && !previousByes.has(entityId)) {
          throw new Error(`Bye provenance reconciliation failed for entry ${entityId}`);
        }
      }
    }
    previousWinnerSources = new Map(
      roundSeries.map(series => [series.winner_id, plan.seriesByLegacy.get(series.id)!])
    );
    previousByes = new Set(
      plan.derivedByes.filter(bye => bye.roundId === round.id).map(bye => bye.entityId)
    );
  }
  checks.push(`series slot provenance: ${convertedSlots.length} exact rows`);

  const convertedGames = plan.gamesToMigrate.length
    ? await rows(
      connection,
      `SELECT id, series_id, game_number, entry1_id, entry2_id, winner_entry_id, loser_entry_id, match_id
       FROM tournament_games WHERE id IN (${plan.gamesToMigrate.map(() => '?').join(',')})`,
      plan.gamesToMigrate.map(game => plan.gameByLegacy.get(game.id))
    )
    : [];
  const legacySeriesById = new Map(source.series.map(series => [series.id, series]));
  const gameNumberBySeries = new Map<string, number>();
  for (const legacy of plan.gamesToMigrate) {
    const series = legacySeriesById.get(legacy.tournament_round_match_id)!;
    const loserEntityId = legacy.winner_id === series.player1_id ? series.player2_id : series.player1_id;
    const actual = convertedGames.find(game => game.id === plan.gameByLegacy.get(legacy.id));
    const expectedGameNumber = (gameNumberBySeries.get(legacy.tournament_round_match_id) || 0) + 1;
    gameNumberBySeries.set(legacy.tournament_round_match_id, expectedGameNumber);
    if (!actual
      || actual.series_id !== plan.seriesByLegacy.get(legacy.tournament_round_match_id)
      || numberValue(actual.game_number) !== expectedGameNumber
      || actual.entry1_id !== plan.entryByEntity.get(series.player1_id)
      || actual.entry2_id !== plan.entryByEntity.get(series.player2_id)
      || actual.winner_entry_id !== plan.entryByEntity.get(legacy.winner_id)
      || actual.loser_entry_id !== plan.entryByEntity.get(loserEntityId)
      || actual.match_id !== legacy.match_id) {
      throw new Error(`Game reconciliation failed for legacy game ${legacy.id}`);
    }
  }
  checks.push(`played game outcomes and ranked links: ${convertedGames.length} exact rows`);
  checks.push(`administrative legacy game rows intentionally not copied: ${plan.administrativeGameCount}`);

  if (plan.replayTargets.length) {
    const replayIds = plan.replayTargets.map(replay => replay.replayId);
    const linked = await rows(
      connection,
      `SELECT id, tournament_game_id FROM replays WHERE id IN (${replayIds.map(() => '?').join(',')})`,
      replayIds
    );
    for (const expected of plan.replayTargets) {
      if (linked.find(replay => replay.id === expected.replayId)?.tournament_game_id !== expected.gameId) {
        throw new Error(`Replay reconciliation failed for ${expected.replayId}`);
      }
    }
  }
  checks.push(`replays: ${plan.replayTargets.length}`);
  if (plan.scheduleTargets.length) {
    const proposalIds = plan.scheduleTargets.map(schedule => schedule.proposalId);
    const linked = await rows(
      connection,
      `SELECT id, tournament_series_id FROM match_schedule_proposals
       WHERE id IN (${proposalIds.map(() => '?').join(',')})`,
      proposalIds
    );
    for (const expected of plan.scheduleTargets) {
      if (linked.find(proposal => proposal.id === expected.proposalId)?.tournament_series_id !== expected.seriesId) {
        throw new Error(`Schedule reconciliation failed for ${expected.proposalId}`);
      }
    }
  }
  checks.push(`existing schedule proposals: ${plan.scheduleTargets.length}`);

  if (plan.embeddedScheduleTargets.length) {
    const proposalIds = plan.embeddedScheduleTargets.map(schedule => schedule.proposalId);
    const linked = await rows(
      connection,
      `SELECT proposals.id, proposals.tournament_series_id, proposals.proposed_by_user_id,
              proposals.proposed_at, proposals.status,
              slots.id AS slot_id, slots.slot_datetime, slots.status AS slot_status,
              (SELECT COUNT(*) FROM match_schedule_confirmations confirmations
               WHERE confirmations.proposal_id = proposals.id) AS confirmation_count
       FROM match_schedule_proposals proposals
       JOIN match_schedule_slots slots ON slots.proposal_id = proposals.id
       WHERE proposals.id IN (${proposalIds.map(() => '?').join(',')})`,
      proposalIds
    );
    const timestamp = (value: any): number => new Date(value).getTime();
    for (const expected of plan.embeddedScheduleTargets) {
      const actual = linked.find(proposal => proposal.id === expected.proposalId);
      const expectedStatus = expected.legacyStatus === 'confirmed' ? 'confirmed' : 'pending';
      if (!actual
        || actual.tournament_series_id !== expected.seriesId
        || actual.proposed_by_user_id !== expected.proposedByUserId
        || actual.status !== expectedStatus
        || actual.slot_id !== expected.slotId
        || actual.slot_status !== expectedStatus
        || timestamp(actual.proposed_at) !== timestamp(expected.proposedAt)
        || timestamp(actual.slot_datetime) !== timestamp(expected.scheduledDatetime)
        || numberValue(actual.confirmation_count) !== 0) {
        throw new Error(`Materialized schedule reconciliation failed for legacy series ${expected.legacySeriesId}`);
      }
    }
  }
  checks.push(`materialized embedded schedules: ${plan.embeddedScheduleTargets.length} exact proposals and slots`);
  return checks;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tournamentId = args.find(argument => argument.startsWith('--tournament='))?.split('=')[1];
  const apply = args.includes('--apply');
  const explicitDryRun = args.includes('--dry-run');
  const confirmation = args.find(argument => argument.startsWith('--confirm='))?.split('=')[1];
  if (!tournamentId || !UUID_PATTERN.test(tournamentId) || (apply && explicitDryRun)) {
    throw new Error('Usage: --tournament=<uuid> [--dry-run | --apply --confirm=<same-uuid>]');
  }
  if (apply && confirmation !== tournamentId) {
    throw new Error('Apply mode requires --confirm=<same tournament uuid>');
  }

  const connection = await pool.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const source = await loadLegacySource(connection, tournamentId, apply);
    const plan = buildConversionPlan(source);
    if (plan.errors.length) {
      await connection.rollback();
      console.log(JSON.stringify(publicReport(source, plan, false), null, 2));
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      await connection.rollback();
      console.log(JSON.stringify(publicReport(source, plan, false), null, 2));
      return;
    }

    await insertConversion(connection, source, plan);
    const reconciliation = await reconcileConversion(connection, source, plan);
    // The version flag is the commit marker: readers cannot select v2 until
    // every copied row and external link has passed exact reconciliation.
    const [versionUpdate] = await connection.execute<ResultSetHeader>(
      `UPDATE tournaments SET competition_model_version = 2, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND competition_model_version = 1`,
      [tournamentId]
    );
    if (versionUpdate.affectedRows !== 1) throw new Error('Tournament version switch did not update exactly one row');
    const versionRows = await rows(connection, `SELECT competition_model_version FROM tournaments WHERE id = ?`, [tournamentId]);
    if (Number(versionRows[0]?.competition_model_version) !== 2) throw new Error('Tournament version switch failed');
    reconciliation.push('competition_model_version: 2');
    await connection.commit();
    console.log(JSON.stringify(publicReport(source, plan, true, reconciliation), null, 2));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch(error => {
      console.error('Legacy tournament conversion failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
