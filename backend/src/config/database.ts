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
 * Execute a query with PostgreSQL-compatible interface
 * Handles RETURNING clauses by using separate SELECT queries for MariaDB
 */
const query = async (sql: string, values?: any[]): Promise<QueryResult> => {
  const connection = await pool.getConnection();
  try {
    // Convert PostgreSQL parameter syntax ($1, $2, etc.) to MySQL syntax (?)
    let mariadbSql = sql;
    const returningMatch = sql.match(/RETURNING\s+(.+?)(?:;|$)/i);
    const hasReturning = !!returningMatch;
    const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
    const isUpdate = sql.trim().toUpperCase().startsWith('UPDATE');
    const isDelete = sql.trim().toUpperCase().startsWith('DELETE');
    
    // Extract WHERE clause for UPDATE queries (for retrieving updated rows)
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+RETURNING|;|$)/i);
    const whereClause = whereMatch ? whereMatch[1].trim() : null;
    
    if (values && values.length > 0) {
      // Replace $1, $2, etc. with ?
      mariadbSql = sql.replace(/\$\d+/g, '?');
    }
    
    // Remove RETURNING clause from SQL
    mariadbSql = mariadbSql.replace(/\s+RETURNING\s+.*/gi, '');
    
    // Remove leading/trailing CURRENT_TIMESTAMP or other PostgreSQL functions
    mariadbSql = mariadbSql.replace(/CURRENT_TIMESTAMP/gi, 'CURRENT_TIMESTAMP');
    
    // Remove public. schema prefix if present
    mariadbSql = mariadbSql.replace(/\bpublic\./gi, '');
    
    // Execute the main query
    const [results, fields] = await connection.execute<any>(mariadbSql, values || []);
    
    // Handle RETURNING for INSERT queries
    if (hasReturning && isInsert && returningMatch) {
      const [idResult] = await connection.execute<any>('SELECT LAST_INSERT_ID() as id');
      if (idResult && Array.isArray(idResult) && idResult[0]) {
        const lastId = (idResult[0] as any).id;
        const returningCols = returningMatch[1].trim();
        
        // If RETURNING includes specific columns, fetch them by ID
        if (returningCols !== '*' && returningCols !== 'id') {
          // Get the table name from INSERT statement to fetch the row
          const tableMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
          if (tableMatch) {
            const tableName = tableMatch[1];
            const [insertedRow] = await connection.execute<any>(
              `SELECT ${returningCols} FROM ${tableName} WHERE id = ?`,
              [lastId]
            );
            if (insertedRow && Array.isArray(insertedRow) && insertedRow[0]) {
              return { rows: [insertedRow[0]], rowCount: 1 };
            }
          }
        }
        return { rows: [{ id: lastId }], rowCount: 1 };
      }
    }
    
    // Handle RETURNING for UPDATE queries
    if (hasReturning && isUpdate && returningMatch && whereClause) {
      const affectedRows = (results as ResultSetHeader).affectedRows || 0;
      
      if (affectedRows > 0) {
        const returningCols = returningMatch[1].trim();
        
        // For UPDATE RETURNING, we need to extract only WHERE clause parameters
        // Extract parameter indices from WHERE clause ($2, $3, etc.)
        const whereParams = [];
        const paramMatches = whereClause.match(/\$(\d+)/g) || [];
        const paramIndices: number[] = [];
        
        for (const match of paramMatches) {
          const paramIndex = parseInt(match.substring(1)) - 1; // Convert $2 to index 1
          if (paramIndex >= 0 && paramIndex < (values?.length || 0)) {
            paramIndices.push(paramIndex);
            whereParams.push(values![paramIndex]);
          }
        }
        
        // Get table name from UPDATE statement
        const tableMatch = sql.match(/UPDATE\s+(\w+)/i);
        if (tableMatch && whereParams.length > 0) {
          const tableName = tableMatch[1];
          // Replace PostgreSQL parameters in whereClause with MySQL ?
          const convertedWhereClause = whereClause.replace(/\$\d+/g, '?');
          const selectSql = `SELECT ${returningCols} FROM ${tableName} WHERE ${convertedWhereClause}`;
          const [updatedRows] = await connection.execute<any>(
            selectSql,
            whereParams
          );
          
          if (updatedRows && Array.isArray(updatedRows)) {
            return { rows: updatedRows, rowCount: affectedRows };
          }
        }
      }
      
      // Fallback: return only rowCount
      return { rows: [], rowCount: affectedRows };
    }
    
    // Handle RETURNING for DELETE queries
    if (hasReturning && isDelete) {
      const affectedRows = (results as ResultSetHeader).affectedRows || 0;
      return { rows: [], rowCount: affectedRows };
    }
    
    // For non-RETURNING queries, still extract rowCount info
    const rowCount = (results as any).affectedRows || (Array.isArray(results) ? results.length : 0);
    
    // Return in PostgreSQL-compatible format
    const resultArray = Array.isArray(results) ? results : [];
    return { rows: resultArray, rowCount };
  } finally {
    connection.release();
  }
};

// Create a database object that provides both pool and query methods
const db = {
  query,
  getClient: async () => pool.getConnection(),
  pool,
};

export default db;
export { query, pool };
