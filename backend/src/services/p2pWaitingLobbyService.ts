import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { validateTimezone } from '../utils/timezoneUtils.js';

// The public lobby is intentionally short-lived: players can advertise only
// the current day and never more than four hours into the future.
const MAX_WAITING_MINUTES = 4 * 60;

/** Compare calendar dates after converting both instants to one player's wall clock. */
const isSameLocalDay = (first: Date, second: Date, timezone: string): boolean => {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return format.format(first) === format.format(second);
};

/** Validate an expiry against the player's timezone and the lobby's four-hour/same-day limits. */
const validateExpiry = (expiresAt: string | undefined, timezone: string): Date => {
  if (!validateTimezone(timezone)) throw new Error('Invalid player timezone');
  const now = new Date();
  // The default is computed on the server so clients cannot extend the
  // implicit two-hour window by sending a stale browser timestamp.
  const expiry = expiresAt ? new Date(expiresAt) : new Date(now.getTime() + 2 * 60 * 60 * 1000);
  if (Number.isNaN(expiry.getTime()) || expiry <= now) throw new Error('Waiting availability must be in the future');
  if (expiry.getTime() - now.getTime() > MAX_WAITING_MINUTES * 60 * 1000) {
    throw new Error('Waiting availability cannot exceed four hours');
  }
  if (!isSameLocalDay(now, expiry, timezone)) {
    throw new Error('Waiting availability must end on the same local day');
  }
  return expiry;
};

/** Return only currently eligible players; this keeps expired rows invisible between cleanup runs. */
export const listWaitingPlayers = async () => {
  const result = await query(
    `SELECT w.id, w.user_id, u.nickname, w.available_until, u.timezone,
            GROUP_CONCAT(DISTINCT proposer.nickname ORDER BY proposer.nickname SEPARATOR ',') AS challenger_nicknames
     FROM p2p_challenge_waiting w
     INNER JOIN users_extension u ON u.id = w.user_id
     LEFT JOIN match_schedule_proposals p
       ON p.challenged_user_id COLLATE utf8mb4_general_ci = w.user_id COLLATE utf8mb4_general_ci
      AND p.challenge_mode = 'p2p'
      AND p.status = 'pending'
      AND (p.expires_at IS NULL OR p.expires_at > UTC_TIMESTAMP())
     LEFT JOIN users_extension proposer
       ON proposer.id COLLATE utf8mb4_general_ci = p.proposed_by_user_id COLLATE utf8mb4_general_ci
     WHERE w.available_until > UTC_TIMESTAMP() AND u.is_active = 1 AND u.is_blocked = 0
     GROUP BY w.id, w.user_id, u.nickname, w.available_until, u.timezone
     ORDER BY w.available_until ASC, u.nickname ASC`
  );
  const waitingPlayers = result.rows || [];
  if (waitingPlayers.length === 0) return waitingPlayers;

  // Load proposal slots separately instead of packing them into a delimited
  // string. Nicknames and timestamps can then be grouped safely in TypeScript
  // without relying on JSON aggregate functions unavailable on older MariaDB.
  const userIds = waitingPlayers.map((player: any) => player.user_id);
  const placeholders = userIds.map(() => '?').join(', ');
  const proposalSlots = await query(
    `SELECT p.challenged_user_id, proposer.nickname AS proposer_nickname, s.slot_datetime
     FROM match_schedule_proposals p
     INNER JOIN users_extension proposer
       ON proposer.id COLLATE utf8mb4_general_ci = p.proposed_by_user_id COLLATE utf8mb4_general_ci
     INNER JOIN match_schedule_slots s ON s.proposal_id = p.id AND s.status <> 'cancelled'
     WHERE p.challenged_user_id IN (${placeholders})
       AND p.challenge_mode = 'p2p'
       AND p.status = 'pending'
       AND (p.expires_at IS NULL OR p.expires_at > UTC_TIMESTAMP())
     ORDER BY proposer.nickname ASC, s.slot_datetime ASC`, userIds
  );
  const detailsByUser = new Map<string, Array<{ nickname: string; slots: string[] }>>();
  for (const row of proposalSlots.rows || []) {
    const details = detailsByUser.get(row.challenged_user_id) || [];
    let challenger = details.find((entry) => entry.nickname === row.proposer_nickname);
    if (!challenger) {
      challenger = { nickname: row.proposer_nickname, slots: [] };
      details.push(challenger);
    }
    challenger.slots.push(new Date(row.slot_datetime).toISOString());
    detailsByUser.set(row.challenged_user_id, details);
  }

  return waitingPlayers.map((player: any) => ({
    ...player,
    challenger_proposals: detailsByUser.get(player.user_id) || [],
  }));
};

/** Load a player's active announcement for profile controls. */
export const getWaitingForUser = async (userId: string) => {
  const result = await query(
    `SELECT id, user_id, available_until FROM p2p_challenge_waiting
     WHERE user_id = ? AND available_until > UTC_TIMESTAMP() LIMIT 1`, [userId]
  );
  return result.rows?.[0] || null;
};

/** Create or replace the single announcement owned by a non-banned active player. */
export const publishWaiting = async (userId: string, expiresAt?: string) => {
  const userResult = await query(
    `SELECT timezone FROM users_extension WHERE id = ? AND is_active = 1 AND is_blocked = 0 LIMIT 1`, [userId]
  );
  if (!userResult.rows?.[0]) throw new Error('Only active, non-banned players can wait for challenges');
  const expiry = validateExpiry(expiresAt, userResult.rows[0].timezone || 'UTC');
  const existing = await query('SELECT id FROM p2p_challenge_waiting WHERE user_id = ? LIMIT 1', [userId]);
  // The unique user key makes replacement deterministic and prevents one
  // player from occupying multiple public lobby entries.
  if (existing.rows?.[0]) {
    await query('UPDATE p2p_challenge_waiting SET available_until = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [expiry, userId]);
  } else {
    await query('INSERT INTO p2p_challenge_waiting (id, user_id, available_until) VALUES (?, ?, ?)', [uuidv4(), userId, expiry]);
  }
  return getWaitingForUser(userId);
};

/** Remove an announcement explicitly cancelled by its owner. */
export const cancelWaiting = async (userId: string) => {
  await query('DELETE FROM p2p_challenge_waiting WHERE user_id = ?', [userId]);
};

/** Periodically purge expired rows so the lobby table cannot grow without bound. */
export const cleanupExpiredWaiting = async () => {
  const result = await query('DELETE FROM p2p_challenge_waiting WHERE available_until <= UTC_TIMESTAMP()');
  const count = result.rowCount || 0;
  if (count) console.log(`✅ [WAITING LOBBY] Removed ${count} expired announcements`);
};
