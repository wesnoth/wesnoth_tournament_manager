#!/usr/bin/env node
/**
 * Missing translation key check (audit finding 39).
 *
 * The parity check (check-i18n-parity.mjs) compares the locale files with each
 * other, so a key that is missing from every locale passes it unnoticed. At
 * runtime i18next then renders the inline fallback, usually English, or the
 * raw key itself. This check closes that gap: every literal key passed to the
 * translation function in frontend/src must exist in en.json, which the parity
 * check in turn requires in every other locale.
 *
 * What counts as a literal key: the first argument of `t(...)` or `i18n.t(...)`
 * when it is a string literal, a template literal without substitutions, or a
 * conditional whose branches are such literals. Template literals with
 * substitutions (`t(`status_${value}`)`) are dynamic and cannot be resolved
 * statically; they are skipped, so code that builds keys that way must keep
 * every possible key in the locale files by other means.
 *
 * The TypeScript parser is used instead of a regular expression so that
 * comments, strings that merely contain "t(", and local variables named `t`
 * in other roles (for example `.filter(t => ...)` callbacks) are not misread.
 *
 * Exit code: 0 when every key exists, 1 otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = path.join(root, 'frontend');
// TypeScript is a frontend dev dependency; resolve it from there so this
// script needs no dependency of its own at the repository root.
const ts = createRequire(path.join(frontend, 'package.json'))('typescript');

function flatten(value, prefix = '', out = new Set()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, fullKey, out);
    else out.add(fullKey);
  }
  return out;
}

const known = flatten(JSON.parse(fs.readFileSync(path.join(frontend, 'src/i18n/locales/en.json'), 'utf8')));

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Literal keys an argument can evaluate to, or [] when it is dynamic. */
function literalKeys(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...literalKeys(node.whenTrue), ...literalKeys(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return literalKeys(node.expression);
  return [];
}

/** True for `t(...)` and `i18n.t(...)` / `i18next.t(...)` calls. */
function isTranslationCall(node) {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 't';
  return ts.isPropertyAccessExpression(callee)
    && callee.name.text === 't'
    && ts.isIdentifier(callee.expression)
    && ['i18n', 'i18next'].includes(callee.expression.text);
}

const problems = [];
for (const file of sourceFiles(path.join(frontend, 'src'))) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0 && isTranslationCall(node)) {
      for (const key of literalKeys(node.arguments[0])) {
        if (!known.has(key)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          problems.push(`${path.relative(root, file)}:${line + 1}: ${key}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length) {
  for (const problem of problems) console.log(`  missing key: ${problem}`);
  console.log(`\ni18n keys: ${problems.length} key(s) used in frontend/src are missing from en.json.`);
  process.exit(1);
}
console.log('i18n keys: every literal translation key used in frontend/src exists in en.json.');
