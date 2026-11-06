/**
 * Parsing of official replay-server URLs (replays.wesnoth.org).
 *
 * Kept free of database imports so it can be unit tested in isolation. The
 * parsed identifiers are only used to look a game up in the forum database;
 * the URL itself is never fetched (see manualReplayLinkService).
 */
import { DomainError } from './clientError.js';

/** Host of the official replay server; any other host is refused. */
export const REPLAY_HOST = 'replays.wesnoth.org';

/** Identifiers extracted from a replay-server URL. */
export interface ReplayServerUrlParts {
  /** Base Wesnoth version of the URL path, e.g. `1.18`. */
  baseVersion: string;
  /** UTC end date of the game as `YYYY-MM-DD` (the server files replays by end date). */
  endDate: string;
  /** Exact replay file name, URL-decoded, including `.bz2`. */
  replayName: string;
  /** Wesnothd game id, the number in parentheses before `.bz2`. */
  gameId: number;
}

/**
 * Parse a replay URL such as
 * `https://replays.wesnoth.org/1.19/2026/11/05/2p__Devious_Dockyard_Turn_20_(1089).bz2`.
 *
 * Only the path is used; query string and fragment are ignored. The date must
 * be a real calendar date because it bounds the forum lookup.
 *
 * @throws DomainError with a user-facing message when the URL is not a replay-server URL.
 */
export function parseReplayServerUrl(raw: unknown): ReplayServerUrlParts {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1000) {
    throw new DomainError('replay_url is required');
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DomainError('The replay URL is not valid');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname.toLowerCase() !== REPLAY_HOST) {
    throw new DomainError(`The replay URL must point to ${REPLAY_HOST}`);
  }
  const match = /^\/(\d+\.\d+)\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)$/.exec(url.pathname);
  if (!match) {
    throw new DomainError('The replay URL must look like https://replays.wesnoth.org/<version>/<yyyy>/<mm>/<dd>/<file>.bz2');
  }
  const [, baseVersion, year, month, day, encodedName] = match;
  let replayName: string;
  try {
    replayName = decodeURIComponent(encodedName);
  } catch {
    throw new DomainError('The replay file name in the URL is not valid');
  }
  const gameIdMatch = /\((\d+)\)\.bz2$/.exec(replayName);
  if (!gameIdMatch) {
    throw new DomainError('The replay file name must end with the game number, e.g. "(1089).bz2"');
  }
  const endDate = `${year}-${month}-${day}`;
  const parsedDate = new Date(`${endDate}T00:00:00Z`);
  // Date normalizes 2026-02-31 to March; a round trip detects that.
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== endDate) {
    throw new DomainError('The date in the replay URL is not valid');
  }
  return { baseVersion, endDate, replayName, gameId: Number(gameIdMatch[1]) };
}
