import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env';
const envPath = path.resolve(__dirname, '../../', envFile);

dotenv.config({ path: envPath });

const pool = mysql.createPool({
  host: process.env.PHPBB_DB_HOST || process.env.DB_HOST || 'localhost',
  user: process.env.PHPBB_DB_USER || process.env.DB_USER,
  password: process.env.PHPBB_DB_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.PHPBB_DB_NAME || 'forum',
  port: parseInt(process.env.PHPBB_DB_PORT || process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

export const queryPhpbb = async (sql: string, values?: any[]) => {
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.execute(sql, values || []);
    return results;
  } finally {
    connection.release();
  }
};

export default pool;
