import mysql, { Pool, ResultSetHeader } from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env';
const envPath = path.resolve(__dirname, '../../', envFile);

dotenv.config({ path: envPath });

const pool: Pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'wesnoth_db',
  port: parseInt(process.env.DB_PORT || '3306'),
  // Keep timestamps written by the replay integration in UTC.
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

// Error handler (mysql2 pool doesn't use 'error' event like pg does)
// Errors will be caught in query execution
(pool as any).on?.('error', (err: any) => {
  console.error('Unexpected error on idle client', err);
});

interface QueryResult {
  rows: any[];
  rowCount?: number;
}

/**
 * Run one SQL statement on a pooled connection and return its rows.
 *
 * Statements are sent to MariaDB unchanged, with `?` placeholders. The
 * wrapper used to emulate PostgreSQL (`$N` placeholders, `RETURNING`, a
 * `public.` schema prefix) by rewriting the SQL text; that rewriting bound
 * `$N` values by textual order regardless of their number and could not
 * return rows with UUID keys, so it was removed once no query used it
 * (audit finding 11). A leftover `$N` now fails loudly in MariaDB instead of
 * binding the wrong values.
 *
 * `rows` holds the result set of a SELECT (empty for writes); `rowCount` is
 * the affected rows of a write, or the number of rows returned.
 */
const query = async (sql: string, values?: any[]): Promise<QueryResult> => {
  const [results] = await pool.execute<any>(sql, values || []);
  if (Array.isArray(results)) return { rows: results, rowCount: results.length };
  return { rows: [], rowCount: (results as ResultSetHeader).affectedRows || 0 };
};

// Create a database object that provides both pool and query methods
const db = {
  query,
  getClient: async () => pool.getConnection(),
  pool,
};

export default db;
export { query, pool };
