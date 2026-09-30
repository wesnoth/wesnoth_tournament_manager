import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryTournament } from '../config/tournamentDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

/**
 * Convert PostgreSQL syntax to MariaDB syntax
 */
function convertPostgresToMariaDB(sql: string): string {
  let converted = sql;

  // Replace gen_random_uuid() with UUID()
  converted = converted.replace(/gen_random_uuid\(\)/gi, 'UUID()');

  // Replace JSONB with JSON
  converted = converted.replace(/\bJSONB\b/gi, 'JSON');

  // Fix PostgreSQL-style missing DEFAULT before ON UPDATE (only when DEFAULT is absent)
  // e.g. "TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" → "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  // Do NOT touch already-correct MariaDB syntax "DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
  converted = converted.replace(
    /(?<!DEFAULT\s)\bCURRENT_TIMESTAMP\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP\b/gi,
    'DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
  );

  // Remove public. schema references (MariaDB doesn't use this)
  converted = converted.replace(/\bpublic\./gi, '');

  // Replace NOW() with CURRENT_TIMESTAMP (both work, but CURRENT_TIMESTAMP is more consistent)
  // Keep NOW() as is - it's compatible with MariaDB

  // Replace SERIAL with INT AUTO_INCREMENT
  converted = converted.replace(/\bSERIAL\b/gi, 'INT AUTO_INCREMENT');

  // Replace TEXT with LONGTEXT where needed for JSONB columns  
  // (this is handled by JSON replacement above)

  // Replace || concatenation operator with CONCAT()
  // This is tricky, so we'll skip it for now as it might appear in WHERE clauses

  // Replace REFERENCES syntax if needed
  // (MariaDB supports standard FOREIGN KEY syntax, so this should work)

  return converted;
}

/**
 * Initialize migrations table if it doesn't exist
 */
async function initializeMigrationsTable(): Promise<void> {
  try {
    await queryTournament(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_name (name)
      )
    `);
    console.log('✅ Migrations table ready');
  } catch (error) {
    console.error('❌ Error initializing migrations table:', error);
    throw error;
  }
}

/**
 * Get list of already applied migrations.
 *
 * Failures are rethrown, never mapped to an empty list: an empty history makes
 * every migration file look pending, so a transient read error would re-apply
 * already-applied (autocommitted, possibly non-idempotent) DDL and data changes.
 * An unexpected result shape is treated the same way.
 *
 * @throws When the history cannot be read or is not a row array.
 */
async function getAppliedMigrations(): Promise<string[]> {
  let results: unknown;
  try {
    results = await queryTournament('SELECT name FROM migrations ORDER BY executed_at');
  } catch (error) {
    // Rethrow the original error so startup reports the real cause.
    console.error('❌ Cannot read the migration history; refusing to guess which migrations are applied');
    throw error;
  }
  if (!Array.isArray(results)) {
    throw new Error('Unexpected migration history result; refusing to guess which migrations are applied');
  }
  return results.map((row: any) => row.name);
}

/**
 * List every SQL migration file on disk, sorted chronologically by name.
 * The caller subtracts the applied history to obtain the pending ones.
 *
 * A read failure is rethrown: an unreadable directory must not be reported as
 * "database is up to date", which would hide a broken deployment.
 *
 * @throws When the migrations directory cannot be read.
 */
function listMigrationFiles(): string[] {
  let files: string[];
  try {
    files = fs.readdirSync(MIGRATIONS_DIR);
  } catch (error) {
    console.error(`❌ Cannot read the migrations directory ${MIGRATIONS_DIR}`);
    throw error;
  }

  // Filter SQL files that look like migrations (start with date or have .sql extension)
  const sqlFiles = files.filter(
    (file) =>
      file.endsWith('.sql') &&
      (file.match(/^\d{8}/) || file.match(/^\d{4}-\d{2}-\d{2}/))
  );

  return sqlFiles.sort(); // Sort alphabetically/chronologically
}

/**
 * Execute a single migration file
 */
async function executeMigration(filename: string): Promise<void> {
  try {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    let sql = fs.readFileSync(filePath, 'utf8');
    
    // Convert PostgreSQL syntax to MariaDB
    sql = convertPostgresToMariaDB(sql);
    
    // Remove multi-line comments /* ... */
    sql = sql.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Split by semicolon, strip single-line comments from each chunk, then filter empty
    // BUG FIX: must strip -- comments BEFORE filtering, otherwise a statement that starts
    // with a -- comment line (before the actual SQL) gets entirely dropped and the SQL
    // never executes — but the migration is still recorded as applied.
    const statements = sql
      .split(';')
      .map((stmt) => stmt.replace(/--[^\n]*/g, '').trim())
      .filter((stmt) => stmt.length > 0);
    
    console.log(`   📄 Found ${statements.length} SQL statements`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        await queryTournament(statement);
      } catch (stmtError) {
        console.error(`   Error in statement ${i + 1}/${statements.length}:`, stmtError);
        throw stmtError;
      }
    }
    
    // Record migration as applied ONLY if all statements succeeded
    await queryTournament(
      'INSERT INTO migrations (name) VALUES (?)',
      [filename]
    );
    
  } catch (error) {
    console.error(`❌ Error executing migration ${filename}:`, error);
    throw error;
  }
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  try {
    console.log('🔄 Starting database migrations...\n');

    // Step 1: Initialize migrations table
    await initializeMigrationsTable();

    // Step 2: Get applied migrations
    const appliedMigrations = await getAppliedMigrations();
    console.log(`📊 Already applied: ${appliedMigrations.length} migrations\n`);

    // Step 3: Get pending migrations
    const allMigrations = listMigrationFiles();
    const pendingMigrations = allMigrations.filter(
      (file) => !appliedMigrations.includes(file)
    );

    if (pendingMigrations.length === 0) {
      console.log('✅ Database is up to date\n');
      return;
    }

    console.log(`📝 Pending migrations: ${pendingMigrations.length}\n`);

    // Step 4: Execute pending migrations
    for (let i = 0; i < pendingMigrations.length; i++) {
      const migration = pendingMigrations[i];
      console.log(`[${i + 1}/${pendingMigrations.length}] ⏳ Executing: ${migration}`);
      await executeMigration(migration);
      console.log(`[${i + 1}/${pendingMigrations.length}] ✅ Completed: ${migration}\n`);
    }

    console.log(`\n✅ All migrations completed successfully`);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  }
}
