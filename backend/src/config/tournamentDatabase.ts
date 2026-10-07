import { pool } from './database.js';

/**
 * Run a statement on the tournament database and return mysql2's raw
 * result (rows for a SELECT, a ResultSetHeader for a write).
 *
 * Kept for its callers' result shape. It used to open a second pool against
 * the same database, without the main pool's UTC timezone and utf8mb4
 * charset settings; it now shares the single pool from database.ts
 * (audit finding 11).
 */
export const queryTournament = async (sql: string, values?: any[]) => {
  const [results] = await pool.execute(sql, values || []);
  return results;
};

