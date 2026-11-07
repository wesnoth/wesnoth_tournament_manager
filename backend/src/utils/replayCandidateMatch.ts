/**
 * Player matching for the replay picker of a pending tournament game (issue #6).
 *
 * Kept free of database imports so it can be unit tested in isolation. It
 * mirrors `assertSamePlayers` in manualReplayLinkService, but returns a
 * boolean instead of throwing, because the picker filters many server games
 * while the link path refuses one. The link path always re-validates with
 * `assertSamePlayers`, so a divergence here can only hide or show a
 * candidate, never link a wrong game.
 */

/** Expected participant of the tournament game, keyed by lower-case nickname. */
export interface ExpectedReplayPlayer {
  userId: string;
  /** Team of the participant in team tournaments, `null` in 1v1. */
  teamId: string | null;
}

/** Shape of the tournament game the candidates must match. */
export interface ReplayCandidateGameShape {
  isTeamGame: boolean;
  user1Id: string | null;
  user2Id: string | null;
  team1Id: string | null;
  team2Id: string | null;
}

/** A player row of `wesnothd_game_player_info`. */
export interface ForumCandidatePlayer {
  user_id: number | null;
  username: string | null;
}

/**
 * Whether the identified players of a server game are exactly the players of
 * the tournament game.
 *
 * Anonymous sides (`user_id` -1 or null, e.g. AI or empty slots) are ignored,
 * as in the link path. 1v1: exactly the two entry users. Team: every player is
 * a member of one of the two teams and both teams are represented; rosters
 * may be larger than the number of sides, so not every member must play.
 *
 * @param forumPlayers players of one server game.
 * @param expected accepted participants of the tournament game, keyed by lower-case nickname.
 */
export function matchesTournamentGamePlayers(
  forumPlayers: ForumCandidatePlayer[],
  expected: Map<string, ExpectedReplayPlayer>,
  shape: ReplayCandidateGameShape
): boolean {
  const identified = forumPlayers.filter(player => player.user_id !== -1 && player.user_id !== null);
  const nicknames = identified.map(player => String(player.username || '').toLowerCase());
  if (nicknames.length < 2 || nicknames.some(name => !name)) return false;
  if (new Set(nicknames).size !== nicknames.length) return false;

  const players = nicknames.map(name => expected.get(name));
  if (players.some(player => !player)) return false;

  if (!shape.isTeamGame) {
    const actual = players.map(player => player!.userId).sort();
    const wanted = [shape.user1Id, shape.user2Id].filter(Boolean).sort();
    return wanted.length === 2 && actual.length === 2 && actual[0] === wanted[0] && actual[1] === wanted[1];
  }

  const teams = new Set(players.map(player => player!.teamId));
  if (players.some(player => player!.teamId !== shape.team1Id && player!.teamId !== shape.team2Id)) return false;
  return teams.has(shape.team1Id) && teams.has(shape.team2Id);
}
