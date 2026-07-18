const FORUM_HOST = 'forums.wesnoth.org';
const FORUM_PATH = '/viewtopic.php';

/** Parse an optional official forum topic URL into the canonical numeric topic id. */
export function parseForumTopicUrl(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Forum topic URL must be a string');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Forum topic URL is invalid');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== FORUM_HOST || url.pathname !== FORUM_PATH) {
    throw new Error('Forum topic URL must be an official Wesnoth viewtopic URL');
  }
  const rawTopicId = url.searchParams.get('t');
  if (!rawTopicId || !/^[1-9][0-9]*$/.test(rawTopicId)) {
    throw new Error('Forum topic URL must contain a positive numeric t parameter');
  }
  const topicId = Number(rawTopicId);
  if (!Number.isSafeInteger(topicId)) throw new Error('Forum topic id is too large');
  return topicId;
}

export function forumTopicUrl(topicId: number | null | undefined): string | null {
  return topicId == null ? null : `https://${FORUM_HOST}${FORUM_PATH}?t=${topicId}`;
}

export function tournamentGameName(topicId: number | null | undefined, tournamentName: string): string {
  return topicId == null ? tournamentName : `T${topicId}`;
}

/** Extract the explicit T<topic-id> prefix used in Wesnoth game names. */
export function parseTournamentCode(gameName: string | null | undefined): number | null {
  const match = gameName?.trim().match(/^T([0-9]+)(?:$|[\s_-])/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

