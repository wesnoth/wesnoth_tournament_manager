/** Columns of the competition game tables that can order the list. */
export type CompetitionGameSortColumn = 'phase' | 'date' | 'first' | 'second' | 'map';
export type SortDirection = 'asc' | 'desc';

export interface CompetitionGameSort {
  column: CompetitionGameSortColumn;
  direction: SortDirection;
}

/**
 * Default order: most advanced phase first, then latest round, then newest.
 * Organizers and players mostly look for what is being played now, which is
 * always at the end of the phase graph.
 */
export const DEFAULT_COMPETITION_GAME_SORT: CompetitionGameSort = { column: 'phase', direction: 'desc' };

/**
 * Direction a column takes when it is first selected. Phase and date start
 * descending (newest and most advanced on top); names and maps start
 * ascending, the natural reading order for text.
 */
export function initialSortDirection(column: CompetitionGameSortColumn): SortDirection {
  return column === 'phase' || column === 'date' ? 'desc' : 'asc';
}

/** Pending replay summaries arrive as JSON text or as an object. */
export function parsePendingReplaySummary(game: any): any {
  try {
    return typeof game.pending_replay_summary === 'string'
      ? JSON.parse(game.pending_replay_summary)
      : game.pending_replay_summary;
  } catch {
    return null;
  }
}

/** Map shown in the table: a detected replay map wins over the stored one, as in the Map column. */
export function competitionGameMap(game: any): string {
  const summary = parsePendingReplaySummary(game);
  return String(summary?.finalMap || summary?.resolvedMap || summary?.selectedMapName || summary?.forumMap || game.map || '');
}

/**
 * Names in the two player columns. Completed games show winner then loser;
 * scheduled games and games awaiting replay confirmation keep entry order.
 * Sorting must follow what the reader sees in each column.
 */
function displayedNames(game: any, completed: boolean): [string, string] {
  if (!completed || game.pending_replay_id) return [game.entry1_name || '', game.entry2_name || ''];
  const winnerIsEntry1 = game.winner_entry_id === game.entry1_id;
  return winnerIsEntry1
    ? [game.entry1_name || '', game.entry2_name || '']
    : [game.entry2_name || '', game.entry1_name || ''];
}

function timestamp(value: unknown): number {
  const time = value ? new Date(String(value)).getTime() : NaN;
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Compare two games by the selected column.
 *
 * Every column falls back to the phase order (phase, round, series, game
 * number) and then to the date, so equal keys still produce the stable,
 * meaningful order the default view shows instead of an arbitrary one.
 * `phaseOrder` maps phase ids to their position in the tournament graph,
 * because game rows carry the phase id but not its order. `isCompleted`
 * decides which names a row displays (see displayedNames).
 */
export function compareCompetitionGames(
  first: any,
  second: any,
  sort: CompetitionGameSort,
  phaseOrder: ReadonlyMap<string, number>,
  isCompleted: (game: any) => boolean,
): number {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const byPhase = (Number(phaseOrder.get(first.phase_id) || 0) - Number(phaseOrder.get(second.phase_id) || 0))
    || (Number(first.round_number || 0) - Number(second.round_number || 0))
    || (Number(first.series_position || 0) - Number(second.series_position || 0))
    || (Number(first.game_number || 0) - Number(second.game_number || 0));
  const byDate = timestamp(first.display_date) - timestamp(second.display_date);
  const text = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'base' });
  let primary = 0;
  if (sort.column === 'phase') primary = byPhase || byDate;
  else if (sort.column === 'date') primary = byDate || byPhase;
  else if (sort.column === 'map') primary = text(competitionGameMap(first), competitionGameMap(second));
  else {
    const index = sort.column === 'first' ? 0 : 1;
    primary = text(displayedNames(first, isCompleted(first))[index], displayedNames(second, isCompleted(second))[index]);
  }
  // Ties on a text column keep the default order (most advanced, newest first).
  return sign * primary || -(byPhase || byDate) || String(first.game_id).localeCompare(String(second.game_id));
}
