/**
 * Forum Database Connection
 * File: backend/src/config/forumDatabase.ts
 * 
 * Purpose: Connection to Wesnoth forum database containing wesnothd_game_* tables
 * These tables track all game plays on the Wesnoth server
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env';
const envPath = path.resolve(__dirname, '../../', envFile);

dotenv.config({ path: envPath });

/**
 * Connection pool to forum database
 * Contains tables:
 * - wesnothd_game_info: Basic game information
 * - wesnothd_game_player_info: Player participation data
 * - wesnothd_game_content_info: Content (maps, addons) used in games
 */
const forumPool = mysql.createPool({
  // phpBB and wesnothd_* tables share this database. PHPBB_DB_* is the
  // canonical configuration; FORUM_DB_* remains a backwards-compatible
  // fallback for older development environments.
  host: process.env.PHPBB_DB_HOST || process.env.FORUM_DB_HOST || process.env.DB_HOST || 'localhost',
  user: process.env.PHPBB_DB_USER || process.env.FORUM_DB_USER || process.env.DB_USER,
  password: process.env.PHPBB_DB_PASSWORD || process.env.FORUM_DB_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.PHPBB_DB_NAME || process.env.FORUM_DB_NAME || 'forum',
  port: parseInt(process.env.PHPBB_DB_PORT || process.env.FORUM_DB_PORT || process.env.DB_PORT || '3306'),
  // Keep SQL timestamp conversion independent of the backend host timezone.
  // wesnothd_game_info timestamps are exchanged by the integration in UTC.
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

/**
 * Execute query on forum database
 * 
 * @param sql - SQL query with ? placeholders
 * @param values - Query parameters
 * @returns Raw query result
 */
export async function queryForum(sql: string, values?: any[]): Promise<any[]> {
  const connection = await forumPool.getConnection();
  try {
    // TIMESTAMP values use the MariaDB session timezone. Force UTC so a
    // Docker database and a host running in Europe/Madrid compare the same
    // replay checkpoint.
    await connection.query("SET time_zone = '+00:00'");
    const [results] = await connection.execute(sql, values || []);
    return results as any[];
  } finally {
    connection.release();
  }
}

/**
 * Get new games from forum database since a specific timestamp
 * 
 * @param lastCheckTimestamp - Only fetch games with END_TIME > this timestamp
 * @param limit - Maximum games to fetch (default 1000)
 * @returns Array of game records
 */
export async function getNewGamesFromForum(
  lastCheckTimestamp: Date,
  limit: number = 1000,
  wesnothVersions?: string | string[]
): Promise<any[]> {
  try {
    let query_str = `SELECT 
      INSTANCE_UUID,
      GAME_ID,
      INSTANCE_VERSION as wesnoth_version,
      GAME_NAME as game_name,
      START_TIME as start_time,
      END_TIME as end_time,
      REPLAY_NAME as replay_filename,
      OOS as oos,
      RELOAD as is_reload,
      PASSWORD,
      PUBLIC
    FROM wesnothd_game_info
    WHERE END_TIME > ?`;

    // Avoid passing a JavaScript Date, which mysql2 would serialize through
    // the host's local timezone before comparing it with END_TIME.
    const checkpointUtc = lastCheckTimestamp.toISOString().slice(0, 19).replace('T', ' ');
    const params: any[] = [checkpointUtc];

    // Filter by version(s) if provided
    // Supports both single version string and array of versions
    // Uses LIKE to match base version (e.g., "1.18" matches "1.18.0", "1.18.1", etc)
    if (wesnothVersions) {
      const versions = Array.isArray(wesnothVersions)
        ? wesnothVersions
        : [wesnothVersions];

      if (versions.length > 0) {
        // Match exact versions, patch releases (1.19.x), and development
        // variants (1.19-dev) when a base version such as 1.19 is configured.
        // Also handle versions without patch part (e.g., "1.18" matches "1.18" exactly)
        const conditions = versions.map(
          version =>
            `(INSTANCE_VERSION = ? OR INSTANCE_VERSION LIKE ? OR INSTANCE_VERSION LIKE ?)`
        );
        query_str += ` AND (${conditions.join(' OR ')})`;

        // Add exact, patch-release, and development-variant patterns for each version.
        for (const version of versions) {
          params.push(version);
          params.push(`${version}.%`);
          params.push(`${version}-%`);
        }
      }
    }

    query_str += ` ORDER BY END_TIME ASC LIMIT ?`;
    params.push(limit);

    const results = await queryForum(query_str, params);

    return results;
  } catch (error) {
    console.error('Error fetching games from forum database:', error);
    throw error;
  }
}

/**
 * Get player information for a specific game
 * 
 * @param instanceUuid - Game instance UUID
 * @param gameId - Game ID
 * @returns Array of player records
 */
export async function getGamePlayers(
  instanceUuid: string,
  gameId: number
): Promise<any[]> {
  try {
    const results = await queryForum(
      `SELECT 
        INSTANCE_UUID,
        GAME_ID,
        USER_ID as user_id,
        SIDE_NUMBER as side_number,
        IS_HOST as is_host,
        FACTION,
        CLIENT_VERSION as client_version,
        USER_NAME as username,
        LEADERS
      FROM wesnothd_game_player_info
      WHERE INSTANCE_UUID = ? AND GAME_ID = ?
      ORDER BY SIDE_NUMBER`,
      [instanceUuid, gameId]
    );

    return results;
  } catch (error) {
    console.error('Error fetching game players from forum database:', error);
    throw error;
  }
}

/**
 * Get content (addons, maps) used in a specific game
 * 
 * @param instanceUuid - Game instance UUID
 * @param gameId - Game ID
 * @returns Array of content records
 */
export async function getGameContent(
  instanceUuid: string,
  gameId: number
): Promise<any[]> {
  try {
    const results = await queryForum(
      `SELECT 
        INSTANCE_UUID,
        GAME_ID,
        TYPE,
        ID,
        ADDON_ID,
        ADDON_VERSION as addon_version,
        NAME
      FROM wesnothd_game_content_info
      WHERE INSTANCE_UUID = ? AND GAME_ID = ?`,
      [instanceUuid, gameId]
    );

    return results;
  } catch (error) {
    console.error('Error fetching game content from forum database:', error);
    throw error;
  }
}

export interface CompetitiveGameData {
  game: any;
  players: any[];
  /** Whether the server retained a continuation save for this game. */
  hasSave: boolean;
}

/**
 * Read the server-authoritative competitive result when the new Wesnoth
 * schema is available.  The forum database is deployed independently from
 * this application, so an unknown column/table is an expected compatibility
 * case rather than a fatal integration error.
 */
export async function getCompetitiveGameData(
  instanceUuid: string,
  gameId: number
): Promise<CompetitiveGameData | null> {
  if (!isCompetitiveGameModelEnabled()) return null;

  let competitiveGameId: string | number | null = null;
  try {
    const gameInfo = await queryForum(
      `SELECT COMPETITIVE_GAME_ID AS competitive_game_id
       FROM wesnothd_game_info
       WHERE INSTANCE_UUID = ? AND GAME_ID = ? LIMIT 1`,
      [instanceUuid, gameId]
    );
    competitiveGameId = gameInfo[0]?.competitive_game_id ?? null;
  } catch (error: any) {
    // Old Wesnoth schemas do not have COMPETITIVE_GAME_ID.
    if (!isMissingForumObject(error)) throw error;
    console.log(`ℹ️  [FORUM] COMPETITIVE_GAME_ID is unavailable for ${instanceUuid}:${gameId} (${error.code})`);
    return null;
  }

  if (competitiveGameId === null || competitiveGameId === '') {
    console.log(`ℹ️  [FORUM] No competitive_game_id for ${instanceUuid}:${gameId}`);
    return null;
  }

  console.log(`✅ [FORUM] competitive_game_id=${competitiveGameId} for ${instanceUuid}:${gameId}`);

  let games: any[];
  try {
    games = await queryForum(
      `SELECT * FROM competitive_game WHERE ID = ? LIMIT 1`,
      [competitiveGameId]
    );
  } catch (error: any) {
    // Accommodate the explicit column name used by some schema revisions.
    if (!isMissingForumObject(error)) throw error;
    games = await queryForum(
      `SELECT * FROM competitive_game WHERE COMPETITIVE_GAME_ID = ? LIMIT 1`,
      [competitiveGameId]
    );
  }

  if (games.length === 0) {
    // The identifier is present, so silently falling back to content markers
    // could misclassify a new-model replay.
    throw new Error(`competitive_game ${competitiveGameId} was not found`);
  }

  const players = await queryForum(
    `SELECT * FROM competitive_game_player
     WHERE COMPETITIVE_GAME_ID = ?`,
    [competitiveGameId]
  );

  // An active game with a retained save can still be resumed.  Do not turn
  // that temporary replay into a provisional result.  Older deployments may
  // not have the save table yet, so absence of the optional table means that
  // no save is known rather than a fatal integration error.
  let hasSave = false;
  try {
    const saves = await queryForum(
      `SELECT SAVE_ID FROM competitive_game_save
       WHERE COMPETITIVE_GAME_ID = ? LIMIT 1`,
      [competitiveGameId]
    );
    hasSave = saves.length > 0;
  } catch (error: any) {
    if (!isMissingForumObject(error)) throw error;
    console.log(`ℹ️  [FORUM] competitive_game_save is unavailable for ${competitiveGameId} (${error.code})`);
  }

  console.log(`✅ [FORUM] competitive_game=${competitiveGameId} status=${games[0].STATUS ?? games[0].status ?? 'unknown'} players=${players.length} save=${hasSave}`);
  return { game: games[0], players, hasSave };
}

/**
 * Allow older forum deployments to disable probing the optional competitive
 * schema. The default keeps the new model enabled for migrated environments;
 * setting the flag to false makes both sync and parsing use the legacy path.
 */
function isCompetitiveGameModelEnabled(): boolean {
  const value = String(process.env.FORUM_COMPETITIVE_GAME_MODEL ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(value);
}

function isMissingForumObject(error: any): boolean {
  return error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR';
}

/**
 * Check if a game has tournament addon
 * 
 * @param instanceUuid - Game instance UUID
 * @param gameId - Game ID
 * @param tournamentAddonId - ID of tournament addon to check (e.g., "wesnoth_tournament")
 * @returns true if tournament addon is present
 */
export async function hasGameTournamentAddon(
  instanceUuid: string,
  gameId: number,
  tournamentAddonId: string
): Promise<boolean> {
  try {
    const results = await queryForum(
      `SELECT COUNT(*) as count FROM wesnothd_game_content_info
       WHERE INSTANCE_UUID = ? AND GAME_ID = ? AND ADDON_ID = ?`,
      [instanceUuid, gameId, tournamentAddonId]
    );

    return results.length > 0 && results[0].count > 0;
  } catch (error) {
    console.error('Error checking tournament addon:', error);
    return false;
  }
}

/**
 * Get tournament addon version used in a game
 * 
 * @param instanceUuid - Game instance UUID
 * @param gameId - Game ID
 * @param tournamentAddonId - ID of tournament addon
 * @returns Addon version or null if not found
 */
export async function getTournamentAddonVersion(
  instanceUuid: string,
  gameId: number,
  tournamentAddonId: string
): Promise<string | null> {
  try {
    const results = await queryForum(
      `SELECT ADDON_VERSION FROM wesnothd_game_content_info
       WHERE INSTANCE_UUID = ? AND GAME_ID = ? AND ADDON_ID = ?`,
      [instanceUuid, gameId, tournamentAddonId]
    );

    return results.length > 0 ? results[0].ADDON_VERSION : null;
  } catch (error) {
    console.error('Error getting tournament addon version:', error);
    return null;
  }
}

/**
 * Get map/scenario name for a game
 * Queries wesnothd_game_content_info for type='scenario'
 * 
 * @param instanceUuid - Game instance UUID
 * @param gameId - Game ID
 * @returns Scenario name or null if not found
 */
export async function getGameScenarioName(
  instanceUuid: string,
  gameId: number
): Promise<string | null> {
  try {
    const results = await queryForum(
      `SELECT NAME FROM wesnothd_game_content_info
       WHERE INSTANCE_UUID = ? AND GAME_ID = ? AND TYPE = 'scenario'`,
      [instanceUuid, gameId]
    );

    return results.length > 0 ? results[0].NAME : null;
  } catch (error) {
    console.error('Error getting game scenario name:', error);
    return null;
  }
}

/**
 * Close forum database connection pool
 * Should be called on application shutdown
 */
export async function closeForumPool(): Promise<void> {
  try {
    await forumPool.end();
    console.log('Forum database connection pool closed');
  } catch (error) {
    console.error('Error closing forum database pool:', error);
  }
}

export default {
  queryForum,
  getNewGamesFromForum,
  getGamePlayers,
  getGameContent,
  getCompetitiveGameData,
  hasGameTournamentAddon,
  getTournamentAddonVersion,
  closeForumPool
};
