import fs from 'node:fs';
import path from 'node:path';
import type { TournamentCreatePayload, TournamentFormatDefinition, TournamentMode } from '../../frontend/src/types/tournament';
import { summaryFieldsForFormat, type DefaultNames } from '../../frontend/src/utils/tournamentFormatTemplates';
import { localStack, runSql, sqlLiteral } from './localStack';
import { signIn, uiRequest, type UiSession } from './uiApi';

/**
 * Tournament lifecycle driven through the same HTTP calls as the interface.
 *
 * Each helper names the screen whose calls it reproduces. Payloads are built
 * with the frontend's own builders (tournamentFormatTemplates) and types, so
 * the creation request carries the same summary fields the form derives from
 * the phase format. The database is only read, for assertions and for ids the
 * interface would show on screen.
 */

const db = localStack.tournamentDb;

/** English default names of the phase builder, read from the frontend locale. */
export function englishDefaultNames(): DefaultNames {
  const en = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../frontend/src/i18n/locales/en.json'), 'utf8'));
  const builder = en.phase_builder;
  return {
    swiss: builder.default_swiss,
    league: builder.default_league,
    elimination: builder.default_elimination,
    swissGroups: builder.default_swiss_groups,
    eliminationBrackets: builder.default_elimination_brackets,
    grandFinal: builder.default_grand_final,
    group: (number) => builder.default_group.replace('{{number}}', String(number)),
    phase: (number) => builder.default_phase.replace('{{number}}', String(number)),
  };
}

/**
 * Unblocked users with an application profile, strongest ELO first, so a
 * scenario's entrants and their initial seeds are deterministic. Ties in ELO
 * would make the seed order depend on registration time, so they are skipped.
 */
export function pickPlayers(count: number, exclude: string[] = []): string[] {
  const rows = runSql(
    `SELECT nickname FROM (
       SELECT nickname, elo_rating, COUNT(*) OVER (PARTITION BY elo_rating) AS same_elo
       FROM ${db}.users_extension
       WHERE is_blocked = 0 AND nickname NOT IN (${['', ...exclude].map(sqlLiteral).join(', ')})
     ) candidates
     WHERE same_elo = 1
     ORDER BY elo_rating DESC
     LIMIT ${count};`,
  );
  if (rows.length < count) throw new Error(`Only ${rows.length} players with distinct ELO are available; ${count} needed`);
  return rows.map((row) => row.nickname!);
}

/**
 * Create a tournament as MyTournaments does: the form's initial values, the
 * summary fields derived from the phase format, and every active faction and
 * map offered by the asset selectors (ranked-only for a ranked tournament).
 */
export async function createTournament(organizer: UiSession, options: {
  name: string;
  mode: TournamentMode;
  definition: TournamentFormatDefinition;
  maxParticipants: number;
}): Promise<string> {
  const [factions, maps] = await Promise.all([
    uiRequest<{ data: Array<{ id: string; is_ranked: number | boolean }> }>(organizer, 'GET', '/admin/unranked-factions'),
    uiRequest<{ data: Array<{ id: string; is_ranked: number | boolean }> }>(organizer, 'GET', '/admin/unranked-maps'),
  ]);
  const allowed = (assets: Array<{ id: string; is_ranked: number | boolean }>) =>
    assets.filter((asset) => options.mode !== 'ranked' || Boolean(asset.is_ranked)).map((asset) => asset.id);
  const payload: TournamentCreatePayload = {
    name: options.name,
    description: `# Lifecycle scenario\n\n${options.name}`,
    tournament_type: 'elimination',
    tournament_mode: options.mode,
    max_participants: options.maxParticipants,
    round_duration_days: 7,
    auto_advance_round: false,
    scheduled_start_at: null,
    general_rounds: 0,
    final_rounds: 0,
    general_rounds_format: 'bo3',
    final_rounds_format: 'bo5',
    rules_template_id: null,
    rules_content: '',
    organizer_ids: [],
    format_definition: options.definition,
    ...summaryFieldsForFormat(options.definition),
    unranked_factions: allowed(factions.data.data),
    unranked_maps: allowed(maps.data.data),
  };
  const { data } = await uiRequest<{ id: string }>(organizer, 'POST', '/tournaments', { body: payload, expectStatus: 201 });
  return data.id;
}

interface ParticipantRow {
  id: string;
  user_id: string;
  nickname: string;
  participation_status: string;
  team_id?: string | null;
}

/** Participant list of the tournament page. */
export async function participants(tournamentId: string): Promise<ParticipantRow[]> {
  const { data } = await uiRequest<ParticipantRow[] | { data: ParticipantRow[] }>(null, 'GET', '/public/tournaments/:id/participants', { params: { id: tournamentId } });
  return Array.isArray(data) ? data : data.data;
}

/** Organizer accepts every pending participant from the participants tab. */
async function acceptPending(organizer: UiSession, tournamentId: string): Promise<void> {
  for (const participant of await participants(tournamentId)) {
    if (participant.participation_status !== 'pending') continue;
    await uiRequest(organizer, 'POST', '/tournaments/:tournamentId/participants/:participantId/accept', {
      params: { tournamentId, participantId: participant.id },
    });
  }
}

/** Each player presses Join on the tournament page; the organizer accepts them. */
export async function registerPlayers(organizer: UiSession, tournamentId: string, players: UiSession[]): Promise<void> {
  for (const player of players) {
    await uiRequest(player, 'POST', '/tournaments/:id/request-join', { params: { id: tournamentId }, body: {} });
  }
  await acceptPending(organizer, tournamentId);
}

/**
 * Teams register as in the team join modal: the captain creates the team and
 * invites the teammate, the teammate confirms from the tournament page, and
 * the organizer accepts both members.
 */
export async function registerTeams(organizer: UiSession, tournamentId: string,
  teams: Array<{ name: string; captain: UiSession; teammate: UiSession }>): Promise<void> {
  for (const team of teams) {
    await uiRequest(team.captain, 'POST', '/tournaments/:id/request-join', {
      params: { id: tournamentId }, body: { team_name: team.name, teammate_name: team.teammate.nickname },
    });
    const invited = (await participants(tournamentId)).find((row) => row.user_id === team.teammate.userId);
    if (!invited) throw new Error(`${team.teammate.nickname} was not invited to ${team.name}`);
    await uiRequest(team.teammate, 'POST', '/tournaments/:tournamentId/participants/:participantId/confirm', {
      params: { tournamentId, participantId: invited.id },
    });
  }
  await acceptPending(organizer, tournamentId);
}

/**
 * Close registration, prepare, and start, as the organizer's action bar does.
 * Closing asks for confirmation only when it would delete the tournament, which
 * a scenario never wants, so a confirmation request fails the test.
 */
export async function closePrepareStart(organizer: UiSession, tournamentId: string): Promise<void> {
  const closed = await uiRequest(organizer, 'POST', '/tournaments/:id/close-registration', { params: { id: tournamentId }, body: {} });
  if ((closed.data as any)?.action === 'confirm_delete' || (closed.data as any)?.requiresConfirmation) {
    throw new Error(`Closing registration asked for confirmation: ${JSON.stringify(closed.data)}`);
  }
  await uiRequest(organizer, 'POST', '/tournaments/:id/prepare', { params: { id: tournamentId } });
  await uiRequest(organizer, 'POST', '/tournaments/:id/start', { params: { id: tournamentId } });
}

export interface CompetitionPhaseRow {
  phase_id: string;
  phase_order: number;
  phase_name: string;
  format: string;
  phase_status: string;
  group_id: string | null;
  group_status: string | null;
}

/** Phase and group rows of the competition view. */
export async function competition(tournamentId: string): Promise<CompetitionPhaseRow[]> {
  const { data } = await uiRequest<{ phases: CompetitionPhaseRow[] }>(null, 'GET', '/tournaments/:id/competition', { params: { id: tournamentId } });
  return data.phases;
}

export interface PhaseGameRow {
  game_id: string;
  game_number: number;
  status: string;
  series_id: string;
  series_role: string | null;
  phase_id: string;
  round_number: number;
  group_id: string;
  entry1_id: string;
  entry2_id: string;
}

/** Games of every phase, as the competition view loads them. */
export async function phaseGames(tournamentId: string): Promise<PhaseGameRow[]> {
  const phaseIds = [...new Set((await competition(tournamentId)).map((row) => row.phase_id))];
  const games: PhaseGameRow[] = [];
  for (const phaseId of phaseIds) {
    const { data } = await uiRequest<PhaseGameRow[] | { games: PhaseGameRow[] }>(null, 'GET', '/tournaments/:id/phases/:phaseId/games', {
      params: { id: tournamentId, phaseId },
    });
    games.push(...(Array.isArray(data) ? data : data.games));
  }
  return games;
}

/** Organizer records a game winner ("<entry> won" in the competition view). */
export async function recordWinner(organizer: UiSession, tournamentId: string, gameId: string, winnerEntryId: string) {
  return (await uiRequest<{ seriesCompleted: boolean; phaseCompleted: boolean; tournamentCompleted: boolean }>(
    organizer, 'POST', '/tournaments/:id/games/:gameId/result', {
      params: { id: tournamentId, gameId }, body: { winner_entry_id: winnerEntryId },
    })).data;
}

/** Organizer awards a whole series ("Administrative: award to" in the competition view). */
export async function awardSeries(organizer: UiSession, tournamentId: string, seriesId: string, winnerEntryId: string) {
  return (await uiRequest(organizer, 'POST', '/tournaments/:id/series/:seriesId/admin-decision', {
    params: { id: tournamentId, seriesId }, body: { winner_entry_id: winnerEntryId, action: 'forfeit' },
  })).data;
}

/** Organizer starts a compiled later phase ("Start phase"). */
export async function startPhase(organizer: UiSession, tournamentId: string, phaseId: string) {
  return (await uiRequest(organizer, 'POST', '/tournaments/:id/phases/:phaseId/start', { params: { id: tournamentId, phaseId } })).data;
}

/** Sign in a list of players, in order. */
export async function signInAll(nicknames: string[]): Promise<UiSession[]> {
  const sessions: UiSession[] = [];
  for (const nickname of nicknames) sessions.push(await signIn(nickname));
  return sessions;
}

// ---------------------------------------------------------------------------
// Database reads for assertions. They never write.
// ---------------------------------------------------------------------------

/** Entries of a tournament keyed by initial seed, with the nickname or team name behind each. */
export function entriesBySeed(tournamentId: string): Map<number, { id: string; name: string }> {
  const rows = runSql(
    `SELECT e.id, e.initial_seed, COALESCE(u.nickname, t.name) AS name
     FROM ${db}.tournament_entries e
     LEFT JOIN ${db}.tournament_participants p ON p.id = e.participant_id
     LEFT JOIN ${db}.users_extension u ON u.id = p.user_id
     LEFT JOIN ${db}.tournament_teams t ON t.id = e.team_id
     WHERE e.tournament_id = ${sqlLiteral(tournamentId)}
     ORDER BY e.initial_seed;`,
  );
  return new Map(rows.map((row) => [Number(row.initial_seed), { id: row.id!, name: row.name! }]));
}

export interface StandingRow {
  seed: number;
  rank_position: number | null;
  matches_played: number;
  wins: number;
  losses: number;
  byes: number;
  points: number;
  omp: number;
  gwp: number;
  ogp: number;
  finalized: boolean;
}

/** Standings of one group, by entry seed. */
export function groupStandings(groupId: string): Map<number, StandingRow> {
  const rows = runSql(
    `SELECT e.initial_seed, s.rank_position, s.matches_played, s.wins, s.losses, s.byes, s.points,
            s.omp, s.gwp, s.ogp, s.finalized_at IS NOT NULL AS finalized
     FROM ${db}.tournament_phase_standings s
     JOIN ${db}.tournament_entries e ON e.id = s.entry_id
     WHERE s.group_id = ${sqlLiteral(groupId)};`,
  );
  return new Map(rows.map((row) => [Number(row.initial_seed), {
    seed: Number(row.initial_seed),
    rank_position: row.rank_position === null ? null : Number(row.rank_position),
    matches_played: Number(row.matches_played),
    wins: Number(row.wins),
    losses: Number(row.losses),
    byes: Number(row.byes),
    points: Number(row.points),
    omp: Number(row.omp),
    gwp: Number(row.gwp),
    ogp: Number(row.ogp),
    finalized: row.finalized === '1',
  }]));
}

/** Series of one group with the seeds in each slot, for pairing assertions. */
export function groupSeries(groupId: string): Array<{
  round: number; position: number; role: string | null; status: string; seeds: [number | null, number | null]; winnerSeed: number | null;
}> {
  const rows = runSql(
    `SELECT r.round_number, s.series_position, s.series_role, s.status,
            MAX(CASE WHEN sl.slot_number = 1 THEN e.initial_seed END) AS seed1,
            MAX(CASE WHEN sl.slot_number = 2 THEN e.initial_seed END) AS seed2,
            MAX(w.initial_seed) AS winner_seed
     FROM ${db}.tournament_series s
     JOIN ${db}.tournament_phase_rounds r ON r.id = s.round_id
     JOIN ${db}.tournament_series_slots sl ON sl.series_id = s.id
     LEFT JOIN ${db}.tournament_entries e ON e.id = sl.resolved_entry_id
     LEFT JOIN ${db}.tournament_entries w ON w.id = s.winner_entry_id
     WHERE r.group_id = ${sqlLiteral(groupId)}
     GROUP BY s.id, r.round_number, s.series_position, s.series_role, s.status
     ORDER BY r.round_number, s.series_position;`,
  );
  const seed = (value: string | null) => (value === null ? null : Number(value));
  return rows.map((row) => ({
    round: Number(row.round_number),
    position: Number(row.series_position),
    role: row.series_role,
    status: row.status!,
    seeds: [seed(row.seed1), seed(row.seed2)],
    winnerSeed: seed(row.winner_seed),
  }));
}

/** Seeds that received a bye in each round of a group. */
export function groupByes(groupId: string): Array<{ round: number; seed: number; points: number }> {
  return runSql(
    `SELECT r.round_number, e.initial_seed, b.points_awarded
     FROM ${db}.tournament_byes b
     JOIN ${db}.tournament_phase_rounds r ON r.id = b.round_id
     JOIN ${db}.tournament_entries e ON e.id = b.entry_id
     WHERE r.group_id = ${sqlLiteral(groupId)}
     ORDER BY r.round_number;`,
  ).map((row) => ({ round: Number(row.round_number), seed: Number(row.initial_seed), points: Number(row.points_awarded) }));
}

/** Tournament root status fields. */
export function tournamentRow(tournamentId: string): Record<string, string | null> {
  return runSql(
    `SELECT status, competition_model_version, finished_at IS NOT NULL AS finished
     FROM ${db}.tournaments WHERE id = ${sqlLiteral(tournamentId)};`,
  )[0];
}

/** Final placements by entry seed. */
export function finalResults(tournamentId: string): Array<{ seed: number; placement: number; label: string | null; champion: boolean }> {
  return runSql(
    `SELECT e.initial_seed, r.placement, r.placement_label, r.is_champion
     FROM ${db}.tournament_results r
     JOIN ${db}.tournament_entries e ON e.id = r.entry_id
     WHERE r.tournament_id = ${sqlLiteral(tournamentId)}
     ORDER BY r.placement;`,
  ).map((row) => ({ seed: Number(row.initial_seed), placement: Number(row.placement), label: row.placement_label, champion: row.is_champion === '1' }));
}

/** What `legacyFieldWrites` must return for every phase-engine tournament. */
export const noLegacyWrites = {
  participant_aggregates: 0, team_aggregates: 0, proposal_links: 0, replay_links: 0, match_round_links: 0,
};

/**
 * Values in the version 1 aggregate and relationship fields of one tournament
 * (cleanup plan step 5 and the step 4 columns). The phase engine never writes
 * them, so after a full lifecycle every count must be zero; a non-zero count
 * means a v2 path still depends on a field the cleanup intends to drop.
 *
 * A zero only proves something for the paths the scenario exercised: proposal
 * links need a scheduled series (scheduling.spec.ts), and replay and match
 * links need replay ingestion, which the replay-pipeline suite drives. The
 * static check scripts/check-legacy-columns.mjs covers every source path.
 */
export function legacyFieldWrites(tournamentId: string): Record<string, number> {
  const id = sqlLiteral(tournamentId);
  const row = runSql(
    `SELECT
       (SELECT COUNT(*) FROM ${db}.tournament_participants WHERE tournament_id = ${id}
          AND (tournament_wins <> 0 OR tournament_losses <> 0 OR tournament_points <> 0
               OR COALESCE(omp, 0) <> 0 OR COALESCE(gwp, 0) <> 0 OR COALESCE(ogp, 0) <> 0
               OR COALESCE(current_round, 0) > 1)) AS participant_aggregates,
       (SELECT COUNT(*) FROM ${db}.tournament_teams WHERE tournament_id = ${id}
          AND (tournament_wins <> 0 OR tournament_losses <> 0 OR tournament_points <> 0
               OR COALESCE(omp, 0) <> 0 OR COALESCE(gwp, 0) <> 0 OR COALESCE(ogp, 0) <> 0
               OR COALESCE(current_round, 0) > 1)) AS team_aggregates,
       (SELECT COUNT(*) FROM ${db}.match_schedule_proposals msp
          WHERE (msp.tournament_round_match_id IS NOT NULL OR msp.tournament_match_id IS NOT NULL)
            AND msp.tournament_series_id IN (
              SELECT s.id FROM ${db}.tournament_series s
              JOIN ${db}.tournament_phase_rounds r ON r.id = s.round_id
              JOIN ${db}.tournament_phase_groups g ON g.id = r.group_id
              JOIN ${db}.tournament_phases p ON p.id = g.phase_id
              WHERE p.tournament_id = ${id})) AS proposal_links,
       (SELECT COUNT(*) FROM ${db}.replays
          WHERE tournament_id = ${id}
            AND (tournament_round_match_id IS NOT NULL OR tournament_match_id IS NOT NULL)) AS replay_links,
       (SELECT COUNT(*) FROM ${db}.matches WHERE tournament_id = ${id} AND round_id IS NOT NULL) AS match_round_links;`,
  )[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}
