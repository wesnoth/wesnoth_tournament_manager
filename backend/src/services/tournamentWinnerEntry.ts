/**
 * Mapping of a game's winner to one of the two tournament entries of a
 * `tournament_games` row (audit finding 10).
 *
 * A tournament game records its result as the winning entry. An entry is
 * either one player (`participant_id`, whose participant row has the
 * `user_id`) or one team (`team_id`). Replays and confirmations know the
 * winner by user, by participant row, or (team games) by team, so every
 * integration path needs the same translation; it lives here, without
 * database access, so it can be tested directly.
 */

/** The two entries of one tournament game and the identities behind them. */
export interface TournamentGameEntries {
  entry1Id: string;
  entry2Id: string;
  entry1UserId?: string | null;
  entry2UserId?: string | null;
  entry1ParticipantId?: string | null;
  entry2ParticipantId?: string | null;
  entry1TeamId?: string | null;
  entry2TeamId?: string | null;
}

/** What is known about the winner; any subset may be given. */
export interface WinnerIdentity {
  userId?: string | null;
  participantId?: string | null;
  teamId?: string | null;
}

/** True when a known, non-null identity of the winner equals the entry's. */
function same(known: string | null | undefined, entryValue: string | null | undefined): boolean {
  return known !== null && known !== undefined && entryValue !== null && entryValue !== undefined && known === entryValue;
}

function entryMatches(winner: WinnerIdentity, userId?: string | null, participantId?: string | null, teamId?: string | null): boolean {
  return same(winner.userId, userId) || same(winner.participantId, participantId) || same(winner.teamId, teamId);
}

/**
 * The entry id of the winner, or `null` when the winner belongs to neither
 * entry or (inconsistent data) to both. Null identities never match, so a
 * team entry without a participant cannot be matched by accident.
 */
export function resolveWinnerEntryId(game: TournamentGameEntries, winner: WinnerIdentity): string | null {
  const inEntry1 = entryMatches(winner, game.entry1UserId, game.entry1ParticipantId, game.entry1TeamId);
  const inEntry2 = entryMatches(winner, game.entry2UserId, game.entry2ParticipantId, game.entry2TeamId);
  if (inEntry1 === inEntry2) return null;
  return inEntry1 ? game.entry1Id : game.entry2Id;
}

/** The other entry of the game; `null` when `entryId` is not one of its entries. */
export function opponentEntryId(game: Pick<TournamentGameEntries, 'entry1Id' | 'entry2Id'>, entryId: string): string | null {
  if (entryId === game.entry1Id) return game.entry2Id;
  if (entryId === game.entry2Id) return game.entry1Id;
  return null;
}
