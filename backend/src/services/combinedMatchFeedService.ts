import { query } from '../config/database.js';

export const MATCH_TYPES = [
  'ranked',
  'tournament_ranked',
  'tournament_unranked',
  'tournament_team',
] as const;

export type MatchType = typeof MATCH_TYPES[number];

export interface MatchFeedFilters {
  player?: string;
  map?: string;
  status?: string;
  confirmed?: string;
  faction?: string;
  matchType?: string;
}

interface MatchFeedOptions {
  page?: number;
  limit?: number;
  filters?: MatchFeedFilters;
  playerId?: string;
  includePending?: boolean;
  viewerUserId?: string;
}

interface FeedMember {
  user_id: string | null;
  nickname: string;
}

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalizeMatchType = (value?: string): MatchType | '' =>
  MATCH_TYPES.includes(value as MatchType) ? value as MatchType : '';

/**
 * Resolve the members who actually played for a team when replay metadata is
 * available. The current accepted roster is only a fallback for games without
 * an authoritative replay lineup, such as a cancelled game.
 */
const resolveTeamMembers = (
  teamId: string | null,
  rosterValue: unknown,
  replayParticipantsValue: unknown,
  replaySummaryValue: unknown,
): FeedMember[] => {
  const roster = parseJson<FeedMember[]>(rosterValue, []);
  if (!teamId) return roster;

  const replaySummary = parseJson<any>(replaySummaryValue, {});
  const detectedTeam = replaySummary?.detectedTeams?.[teamId];
  if (!Array.isArray(detectedTeam?.members)) return roster;

  const replayParticipants = parseJson<any[]>(replayParticipantsValue, []);
  const rosterByNickname = new Map(
    roster.map((member) => [String(member.nickname || '').toLowerCase(), member.user_id || null]),
  );
  const byNickname = new Map(
    replayParticipants.map((participant) => [
      String(participant.player_name || '').toLowerCase(),
      participant.player_id || null,
    ]),
  );
  return detectedTeam.members.map((nickname: string) => ({
    user_id: byNickname.get(String(nickname).toLowerCase())
      || rosterByNickname.get(String(nickname).toLowerCase())
      || null,
    nickname,
  }));
};

const buildRankedMatchQuery = (
  filters: MatchFeedFilters,
  playerId?: string,
): { sql: string; params: unknown[] } => {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const matchType = normalizeMatchType(filters.matchType);

  if (playerId) {
    conditions.push('(m.winner_id = ? OR m.loser_id = ?)');
    params.push(playerId, playerId);
  }
  if (filters.player?.trim()) {
    const pattern = `%${filters.player.trim().toLowerCase()}%`;
    conditions.push('(LOWER(w.nickname) LIKE ? OR LOWER(l.nickname) LIKE ?)');
    params.push(pattern, pattern);
  }
  if (filters.map?.trim()) {
    conditions.push('LOWER(m.map) LIKE ?');
    params.push(`%${filters.map.trim().toLowerCase()}%`);
  }
  if (filters.status?.trim()) {
    conditions.push('m.status = ?');
    params.push(filters.status.trim());
  }
  if (filters.confirmed?.trim()) {
    const confirmed = ['true', '1', 'confirmed'].includes(filters.confirmed.trim().toLowerCase());
    conditions.push('m.loser_confirmed = ?');
    params.push(confirmed ? 1 : 0);
  }
  if (filters.faction?.trim()) {
    conditions.push('(LOWER(m.winner_faction) = ? OR LOWER(m.loser_faction) = ?)');
    params.push(filters.faction.trim().toLowerCase(), filters.faction.trim().toLowerCase());
  }
  if (matchType === 'ranked') {
    conditions.push('COALESCE(phases.tournament_id, m.tournament_id) IS NULL');
  } else if (matchType === 'tournament_ranked') {
    conditions.push('COALESCE(phases.tournament_id, m.tournament_id) IS NOT NULL');
  } else if (matchType) {
    conditions.push('1 = 0');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return {
    sql: `SELECT m.*,
                 m.id AS match_id,
                 w.nickname AS winner_nickname,
                 l.nickname AS loser_nickname,
                 game.id AS tournament_game_id,
                 game.game_number AS tournament_game_number,
                 series.id AS tournament_series_id,
                 rounds.id AS tournament_round_id,
                 rounds.round_number AS tournament_round_number,
                 rounds.name AS tournament_round_name,
                 groups.id AS tournament_group_id,
                 groups.name AS tournament_group_name,
                 phases.id AS tournament_phase_id,
                 phases.name AS tournament_phase_name,
                 tournament.id AS resolved_tournament_id,
                 tournament.name AS tournament_name,
                 tournament.tournament_mode AS resolved_tournament_mode,
                 CASE WHEN COALESCE(phases.tournament_id, m.tournament_id) IS NULL
                      THEN 'ranked' ELSE 'tournament_ranked' END AS match_type,
                 'match' AS source_type,
                 1 AS has_elo_data,
                 1 AS has_outcome,
                 COALESCE((
                   SELECT JSON_ARRAYAGG(JSON_OBJECT(
                     'id', streams.id,
                     'stream_url', streams.stream_url,
                     'streamer_user_id', streams.streamer_user_id,
                     'streamer_nickname', streamer.nickname,
                     'created_at', streams.created_at,
                     'updated_at', streams.updated_at
                   ))
                   FROM tournament_game_streams streams
                   JOIN users_extension streamer ON streamer.id = streams.streamer_user_id
                   LEFT JOIN tournament_games stream_game ON stream_game.id = streams.game_id
                   WHERE streams.match_id = m.id OR stream_game.match_id = m.id
                 ), JSON_ARRAY()) AS stream_links
          FROM matches m
          JOIN users_extension w ON w.id = m.winner_id
          JOIN users_extension l ON l.id = m.loser_id
          LEFT JOIN tournament_games game ON game.match_id = m.id
          LEFT JOIN tournament_series series ON series.id = game.series_id
          LEFT JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
          LEFT JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
          LEFT JOIN tournament_phases phases ON phases.id = groups.phase_id
          LEFT JOIN tournaments tournament ON tournament.id = COALESCE(phases.tournament_id, m.tournament_id)
          ${where}`,
    params,
  };
};

const buildTournamentGameQuery = (
  filters: MatchFeedFilters,
  playerId?: string,
): { sql: string; params: unknown[] } => {
  const conditions = [
    'game.match_id IS NULL',
    "((game.status = 'completed' AND game.organizer_action IS NULL) OR game.status = 'cancelled')",
  ];
  const params: unknown[] = [];
  const matchType = normalizeMatchType(filters.matchType);

  if (playerId) {
    conditions.push(`(
      participant1.user_id = ? OR participant2.user_id = ?
      OR EXISTS (
        SELECT 1 FROM tournament_participants membership
        WHERE membership.user_id = ?
          AND membership.participation_status = 'accepted'
          AND membership.team_id IN (entry1.team_id, entry2.team_id)
      )
      OR EXISTS (
        SELECT 1 FROM replays player_replay
        JOIN replay_participants replay_player ON replay_player.replay_id = player_replay.id
        WHERE player_replay.tournament_game_id = game.id
          AND player_replay.deleted_at IS NULL
          AND replay_player.player_id = ?
      )
    )`);
    params.push(playerId, playerId, playerId, playerId);
  }
  if (filters.player?.trim()) {
    const pattern = `%${filters.player.trim().toLowerCase()}%`;
    conditions.push(`(
      LOWER(COALESCE(user1.nickname, team1.name, '')) LIKE ?
      OR LOWER(COALESCE(user2.nickname, team2.name, '')) LIKE ?
      OR EXISTS (
        SELECT 1 FROM tournament_participants member_filter
        JOIN users_extension member_user_filter ON member_user_filter.id = member_filter.user_id
        WHERE member_filter.team_id IN (entry1.team_id, entry2.team_id)
          AND LOWER(member_user_filter.nickname) LIKE ?
      )
    )`);
    params.push(pattern, pattern, pattern);
  }
  if (filters.map?.trim()) {
    conditions.push('LOWER(game.map) LIKE ?');
    params.push(`%${filters.map.trim().toLowerCase()}%`);
  }
  if (filters.status?.trim()) {
    if (filters.status.trim() === 'cancelled') {
      conditions.push("game.status = 'cancelled'");
    } else {
      conditions.push("game.status = 'completed' AND game.confirmation_status = ?");
      params.push(filters.status.trim());
    }
  }
  if (filters.confirmed?.trim()) {
    const confirmed = ['true', '1', 'confirmed'].includes(filters.confirmed.trim().toLowerCase());
    conditions.push("game.status = 'completed' AND game.confirmation_status = ?");
    params.push(confirmed ? 'confirmed' : 'unconfirmed');
  }
  if (filters.faction?.trim()) {
    conditions.push('(LOWER(game.winner_faction) = ? OR LOWER(game.loser_faction) = ?)');
    params.push(filters.faction.trim().toLowerCase(), filters.faction.trim().toLowerCase());
  }
  if (matchType === 'ranked') {
    conditions.push('1 = 0');
  } else if (matchType === 'tournament_ranked') {
    conditions.push("tournament.tournament_mode = 'ranked'");
  } else if (matchType === 'tournament_unranked') {
    conditions.push("tournament.tournament_mode = 'unranked'");
  } else if (matchType === 'tournament_team') {
    conditions.push("tournament.tournament_mode = 'team'");
  }

  return {
    sql: `SELECT game.id,
                 game.id AS tournament_game_id,
                 NULL AS match_id,
                 game.game_number AS tournament_game_number,
                 game.status AS game_status,
                 CASE WHEN game.status = 'cancelled' THEN 'cancelled'
                      ELSE game.confirmation_status END AS status,
                 game.map,
                 game.winner_faction,
                 game.loser_faction,
                 game.winner_side,
                 game.winner_comments,
                 game.winner_rating,
                 game.loser_comments,
                 game.loser_rating,
                 game.replay_downloads,
                 game.played_at,
                 COALESCE(game.played_at, game.updated_at, game.created_at) AS created_at,
                 game.updated_at,
                 game.entry1_id,
                 game.entry2_id,
                 game.winner_entry_id,
                 game.loser_entry_id,
                 game.winner_entry_id IS NOT NULL AS has_outcome,
                 CASE WHEN game.winner_entry_id = entry1.id THEN participant1.user_id
                      WHEN game.winner_entry_id = entry2.id THEN participant2.user_id
                      ELSE participant1.user_id END AS winner_id,
                 CASE WHEN game.loser_entry_id = entry1.id THEN participant1.user_id
                      WHEN game.loser_entry_id = entry2.id THEN participant2.user_id
                      ELSE participant2.user_id END AS loser_id,
                 CASE WHEN game.winner_entry_id = entry1.id THEN entry1.team_id
                      WHEN game.winner_entry_id = entry2.id THEN entry2.team_id
                      ELSE entry1.team_id END AS winner_team_id,
                 CASE WHEN game.loser_entry_id = entry1.id THEN entry1.team_id
                      WHEN game.loser_entry_id = entry2.id THEN entry2.team_id
                      ELSE entry2.team_id END AS loser_team_id,
                 CASE WHEN game.winner_entry_id = entry1.id THEN COALESCE(user1.nickname, team1.name)
                      WHEN game.winner_entry_id = entry2.id THEN COALESCE(user2.nickname, team2.name)
                      ELSE COALESCE(user1.nickname, team1.name) END AS winner_nickname,
                 CASE WHEN game.loser_entry_id = entry1.id THEN COALESCE(user1.nickname, team1.name)
                      WHEN game.loser_entry_id = entry2.id THEN COALESCE(user2.nickname, team2.name)
                      ELSE COALESCE(user2.nickname, team2.name) END AS loser_nickname,
                 entry1.team_id AS entry1_team_id,
                 entry2.team_id AS entry2_team_id,
                 COALESCE(user1.nickname, team1.name) AS entry1_name,
                 COALESCE(user2.nickname, team2.name) AS entry2_name,
                 CASE WHEN team1.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
                   SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
                   FROM tournament_participants member
                   JOIN users_extension member_user ON member_user.id = member.user_id
                   WHERE member.team_id = team1.id AND member.participation_status = 'accepted'
                 ), JSON_ARRAY()) END AS entry1_members,
                 CASE WHEN team2.id IS NULL THEN JSON_ARRAY() ELSE COALESCE((
                   SELECT JSON_ARRAYAGG(JSON_OBJECT('user_id', member_user.id, 'nickname', member_user.nickname))
                   FROM tournament_participants member
                   JOIN users_extension member_user ON member_user.id = member.user_id
                   WHERE member.team_id = team2.id AND member.participation_status = 'accepted'
                 ), JSON_ARRAY()) END AS entry2_members,
                 series.id AS tournament_series_id,
                 rounds.id AS tournament_round_id,
                 rounds.round_number AS tournament_round_number,
                 rounds.name AS tournament_round_name,
                 groups.id AS tournament_group_id,
                 groups.name AS tournament_group_name,
                 phases.id AS tournament_phase_id,
                 phases.name AS tournament_phase_name,
                 tournament.id AS tournament_id,
                 tournament.name AS tournament_name,
                 tournament.tournament_mode,
                 CASE tournament.tournament_mode
                   WHEN 'team' THEN 'tournament_team'
                   WHEN 'unranked' THEN 'tournament_unranked'
                   ELSE 'tournament_ranked'
                 END AS match_type,
                 'tournament_game' AS source_type,
                 0 AS has_elo_data,
                 replay.id AS replay_id,
                 replay.replay_url,
                 replay.replay_url AS replay_file_path,
                 replay.parse_summary AS replay_parse_summary,
                 COALESCE((
                   SELECT JSON_ARRAYAGG(JSON_OBJECT(
                     'player_id', replay_member.player_id,
                     'player_name', replay_member.player_name,
                     'side', replay_member.side
                   ))
                   FROM replay_participants replay_member
                   WHERE replay_member.replay_id = replay.id
                 ), JSON_ARRAY()) AS replay_participants,
                 COALESCE((
                   SELECT JSON_ARRAYAGG(JSON_OBJECT(
                     'id', streams.id,
                     'stream_url', streams.stream_url,
                     'streamer_user_id', streams.streamer_user_id,
                     'streamer_nickname', streamer.nickname,
                     'created_at', streams.created_at,
                     'updated_at', streams.updated_at
                   ))
                   FROM tournament_game_streams streams
                   JOIN users_extension streamer ON streamer.id = streams.streamer_user_id
                   WHERE streams.game_id = game.id
                 ), JSON_ARRAY()) AS stream_links
          FROM tournament_games game
          JOIN tournament_series series ON series.id = game.series_id
          JOIN tournament_phase_rounds rounds ON rounds.id = series.round_id
          JOIN tournament_phase_groups groups ON groups.id = rounds.group_id
          JOIN tournament_phases phases ON phases.id = groups.phase_id
          JOIN tournaments tournament ON tournament.id = phases.tournament_id
          JOIN tournament_entries entry1 ON entry1.id = game.entry1_id
          JOIN tournament_entries entry2 ON entry2.id = game.entry2_id
          LEFT JOIN tournament_participants participant1 ON participant1.id = entry1.participant_id
          LEFT JOIN tournament_participants participant2 ON participant2.id = entry2.participant_id
          LEFT JOIN users_extension user1 ON user1.id = participant1.user_id
          LEFT JOIN users_extension user2 ON user2.id = participant2.user_id
          LEFT JOIN tournament_teams team1 ON team1.id = entry1.team_id
          LEFT JOIN tournament_teams team2 ON team2.id = entry2.team_id
          LEFT JOIN replays replay ON replay.id = (
            SELECT latest_replay.id
            FROM replays latest_replay
            WHERE latest_replay.tournament_game_id = game.id
              AND latest_replay.deleted_at IS NULL
            ORDER BY latest_replay.detected_at DESC, latest_replay.created_at DESC
            LIMIT 1
          )
          WHERE ${conditions.join(' AND ')}`,
    params,
  };
};

const normalizeTournamentGame = (row: any): any => {
  const entry1Members = resolveTeamMembers(
    row.entry1_team_id,
    row.entry1_members,
    row.replay_participants,
    row.replay_parse_summary,
  );
  const entry2Members = resolveTeamMembers(
    row.entry2_team_id,
    row.entry2_members,
    row.replay_participants,
    row.replay_parse_summary,
  );
  const winnerIsEntry2 = Boolean(row.has_outcome && row.winner_entry_id === row.entry2_id);

  const normalized = {
    ...row,
    feed_id: `tournament_game:${row.id}`,
    has_elo_data: false,
    has_outcome: Boolean(row.has_outcome),
    winner_members: winnerIsEntry2 ? entry2Members : entry1Members,
    loser_members: winnerIsEntry2 ? entry1Members : entry2Members,
    entry1_members: entry1Members,
    entry2_members: entry2Members,
    stream_links: parseJson(row.stream_links, []),
  };
  // Replay parsing internals are only needed while resolving the lineup and
  // would otherwise make every feed response much larger than its UI payload.
  delete normalized.replay_parse_summary;
  delete normalized.replay_participants;
  return normalized;
};

const formatPendingReplays = async (
  filters: MatchFeedFilters,
  playerId?: string,
  viewerUserId?: string,
): Promise<any[]> => {
  let viewerNickname = '';
  let viewerIsAdmin = false;
  if (viewerUserId) {
    const viewerResult = await query(
      'SELECT nickname, is_admin FROM users_extension WHERE id = ?',
      [viewerUserId],
    );
    viewerNickname = viewerResult.rows[0]?.nickname?.toLowerCase() || '';
    viewerIsAdmin = Boolean(viewerResult.rows[0]?.is_admin);
  }

  let profileNickname = '';
  if (playerId) {
    const profileResult = await query('SELECT nickname FROM users_extension WHERE id = ?', [playerId]);
    profileNickname = profileResult.rows[0]?.nickname?.toLowerCase() || '';
  }

  const result = await query(
    `SELECT r.id, r.replay_filename, r.game_name, r.replay_url, r.parse_summary,
            r.created_at, r.wesnoth_version, r.cancel_requested_by, r.parse_status, r.map_name
     FROM replays r
     WHERE r.integration_confidence = 1
       AND r.parsed = 1
       AND r.parse_status NOT IN ('rejected', 'error')
       AND r.match_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM matches linked_match WHERE linked_match.replay_id = r.id)
       AND r.tournament_id IS NULL
     ORDER BY r.created_at DESC, r.id DESC`,
  );

  const matchType = normalizeMatchType(filters.matchType);
  if (matchType && matchType !== 'ranked') return [];

  const formatted: any[] = [];
  for (const replay of result.rows) {
    const summary = parseJson<any>(replay.parse_summary, {});
    const players = summary.forumPlayers || [];
    if (players.length < 2) continue;

    const playerNames = players.map((player: any) => String(player.user_name || '').toLowerCase());
    if (profileNickname && !playerNames.includes(profileNickname)) continue;
    if (filters.player?.trim() && !playerNames.some((name: string) => name.includes(filters.player!.trim().toLowerCase()))) continue;

    const map = summary.finalMap || summary.forumMap || summary.resolvedMap || replay.map_name
      || summary.parsedMap || summary.map || summary.scenario || 'Unknown Map';
    if (filters.map?.trim() && !String(map).toLowerCase().includes(filters.map.trim().toLowerCase())) continue;
    if (filters.status?.trim() && !['unconfirmed', 'pending_report'].includes(filters.status.trim())) continue;
    if (filters.confirmed?.trim() && ['true', '1', 'confirmed'].includes(filters.confirmed.trim().toLowerCase())) continue;

    const winnerName = summary.replayVictory?.winner_name || players[0]?.user_name || 'Unknown';
    const loserName = summary.replayVictory?.loser_name || players[1]?.user_name || 'Unknown';
    const winnerPlayer = players.find((player: any) => player.user_name === winnerName);
    const loserPlayer = players.find((player: any) => player.user_name === loserName);
    const factions = summary.resolvedFactions || {};
    const winnerFaction = (winnerPlayer ? factions[`side${winnerPlayer.side_number}`] : null) || 'Unknown';
    const loserFaction = (loserPlayer ? factions[`side${loserPlayer.side_number}`] : null) || 'Unknown';
    if (filters.faction?.trim()
      && ![winnerFaction, loserFaction].some((value) => String(value).toLowerCase() === filters.faction!.trim().toLowerCase())) continue;

    const involved = Boolean(viewerNickname && playerNames.includes(viewerNickname));
    formatted.push({
      id: replay.id,
      feed_id: `pending_replay:${replay.id}`,
      source_type: replay.parse_status === 'due' ? 'replay_confidence_1_due' : 'replay_confidence_1',
      match_type: 'ranked',
      has_elo_data: false,
      has_outcome: false,
      winner_id: null,
      loser_id: null,
      winner_nickname: winnerName,
      loser_nickname: loserName,
      winner_faction: winnerFaction,
      loser_faction: loserFaction,
      winner_side: winnerPlayer?.side_number || null,
      loser_side: loserPlayer?.side_number || null,
      map,
      status: 'pending_report',
      replay_url: replay.replay_url,
      replay_file_path: replay.replay_url,
      replay_downloads: 0,
      created_at: replay.created_at,
      updated_at: replay.created_at,
      replay_id: replay.id,
      confidence_level: 1,
      parse_summary: summary,
      replay_filename: replay.replay_filename,
      game_name: replay.game_name,
      cancel_requested_by: replay.cancel_requested_by || null,
      is_admin_view: viewerIsAdmin && !involved,
      is_participant: involved,
      stream_links: [],
    });
  }
  return formatted;
};

/**
 * Compose the public match history without copying tournament results into the
 * ranked matches table. All filters are applied to every source before the
 * combined, deterministic pagination step.
 */
export async function getCombinedMatchFeed(options: MatchFeedOptions = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.max(1, Number(options.limit) || 20);
  const filters = options.filters || {};
  const ranked = buildRankedMatchQuery(filters, options.playerId);
  const tournament = buildTournamentGameQuery(filters, options.playerId);

  const [rankedResult, tournamentResult, pendingReplays] = await Promise.all([
    query(ranked.sql, ranked.params),
    query(tournament.sql, tournament.params),
    options.includePending
      ? formatPendingReplays(filters, options.playerId, options.viewerUserId)
      : Promise.resolve([]),
  ]);

  const rankedRows = rankedResult.rows.map((row: any) => ({
    ...row,
    feed_id: `match:${row.id}`,
    tournament_id: row.resolved_tournament_id || row.tournament_id || null,
    tournament_mode: row.resolved_tournament_mode || row.tournament_mode || null,
    has_elo_data: true,
    has_outcome: true,
    stream_links: parseJson(row.stream_links, []),
  }));
  const tournamentRows = tournamentResult.rows.map(normalizeTournamentGame);
  const allRows = [...rankedRows, ...tournamentRows, ...pendingReplays];
  allRows.sort((left, right) => {
    const dateDifference = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    if (dateDifference) return dateDifference;
    const sourceDifference = String(left.source_type).localeCompare(String(right.source_type));
    return sourceDifference || String(right.id).localeCompare(String(left.id));
  });

  const offset = (page - 1) * limit;
  const data = allRows.slice(offset, offset + limit);
  const total = allRows.length;
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      showing: data.length,
    },
  };
}
