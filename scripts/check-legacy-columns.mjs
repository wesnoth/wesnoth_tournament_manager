#!/usr/bin/env node
/**
 * Legacy relationship column check (audit finding 41, cleanup plan step 4).
 *
 * Step 4 of docs/tournament-v2-legacy-cleanup-plan.md dropped the version 1
 * relationship columns (migration 20261020_130000):
 * `match_schedule_proposals.tournament_round_match_id` / `tournament_match_id`,
 * `replays.tournament_round_match_id` / `tournament_match_id`, and
 * `matches.round_id`. This check refuses any reference to them in the
 * application sources, so no code path can depend on them again; such code
 * would fail only at runtime with an unknown-column error.
 *
 * Rules, applied to backend/src and frontend/src TypeScript and JavaScript
 * files (SQL files are not scanned: the migration history must keep naming
 * the columns it created and dropped):
 * - `tournament_round_match_id` and `tournament_match_id` must not appear at
 *   all; no current table uses these names for anything else.
 * - `round_id` is a live column of the phase-engine tables, so for `matches`
 *   only qualified uses are refused: `matches.round_id`, an alias of
 *   `matches` (from `FROM/JOIN matches <alias>` in the same file) followed by
 *   `.round_id`, and `round_id` inside the column list of `INSERT INTO
 *   matches (...)` or the `SET` clause of `UPDATE matches`. An unqualified
 *   `round_id` in a SELECT that joins `matches` is not detected; the phase
 *   tables' own `round_id` makes that case impossible to tell apart lexically.
 *
 * Exit code: 0 when no reference is found, 1 otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirs = ['backend/src', 'frontend/src'].map((dir) => path.join(root, dir));
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
// Words that can follow `FROM matches` without being an alias.
const sqlKeywords = new Set(['where', 'join', 'left', 'right', 'inner', 'cross', 'on', 'group', 'order', 'limit', 'set', 'as', 'for', 'union', 'having']);

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full);
    return extensions.has(path.extname(entry.name)) ? [full] : [];
  });
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const problems = [];
for (const file of sourceDirs.flatMap(sourceFiles)) {
  const text = fs.readFileSync(file, 'utf8');
  const relative = path.relative(root, file);
  const report = (index, message) => problems.push(`${relative}:${lineOf(text, index)}: ${message}`);

  for (const match of text.matchAll(/\btournament_(?:round_)?match_id\b/g)) {
    report(match.index, `references the legacy column ${match[0]}`);
  }

  const aliases = new Set(['matches']);
  for (const match of text.matchAll(/\b(?:FROM|JOIN)\s+matches\s+(?:AS\s+)?([A-Za-z_]\w*)/gi)) {
    if (!sqlKeywords.has(match[1].toLowerCase())) aliases.add(match[1]);
  }
  for (const alias of aliases) {
    for (const match of text.matchAll(new RegExp(`\\b${alias}\\.round_id\\b`, 'g'))) {
      report(match.index, `references matches.round_id through ${alias === 'matches' ? 'the table name' : `alias ${alias}`}`);
    }
  }
  for (const match of text.matchAll(/\bINSERT\s+INTO\s+matches\s*\(([^)]*)\)/gi)) {
    if (/\bround_id\b/.test(match[1])) report(match.index, 'inserts matches.round_id');
  }
  for (const match of text.matchAll(/\bUPDATE\s+matches\b[\s\S]*?\bSET\b([\s\S]*?)(?:\bWHERE\b|`|;)/gi)) {
    if (/\bround_id\b/.test(match[1])) report(match.index, 'updates matches.round_id');
  }
}

if (problems.length > 0) {
  console.error('Legacy relationship columns are still referenced (cleanup plan step 4):');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('Legacy columns: no application source references the version 1 relationship columns.');
