#!/usr/bin/env node
/**
 * UI API contract check for API-driven end-to-end tests.
 *
 * The tournament lifecycle suite drives the backend through HTTP instead of
 * the browser, which is fast and deterministic but can silently drift: a test
 * may keep exercising an endpoint the interface no longer calls, leaving an
 * orphan route covered by tests while the real path goes untested. Every
 * request those tests make therefore goes through `uiRequest(session, METHOD,
 * '/path/:param', ...)`, and this check requires each such method and path to
 * be one the frontend itself calls.
 *
 * The frontend catalog is read statically with the TypeScript parser from
 * `frontend/src`: calls `api.get|post|put|patch|delete(url, ...)` on the shared
 * axios client and `fetch(url, { method })` calls. String literals and
 * template literals are resolved; each `${...}` substitution becomes a path
 * parameter, a query string is dropped, and the `/api` prefix (fetch) or the
 * API base URL substitution is removed. URLs held in variables cannot be
 * resolved and are skipped, so an endpoint the UI only reaches that way must
 * not be used by the tests until its call site passes a literal path.
 *
 * In the tests the method and path of `uiRequest` must be literals, so the
 * check needs no execution; the helper also checks the catalog at runtime.
 *
 * Usage: `node scripts/check-ui-api-contract.mjs` checks every test under
 * `e2e/` (exit 1 on a mismatch); `--catalog` prints the frontend catalog as a
 * JSON array of `METHOD /path` strings for the runtime check.
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

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function sourceFiles(dir, include) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full, include);
    return include(entry.name) ? [full] : [];
  });
}

function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * Canonical `METHOD /path` key: query string dropped, trailing slash removed,
 * and every parameter segment (`:id`, or a resolved substitution) written as
 * `:param`, so parameter names never matter.
 */
export function endpointKey(method, rawPath) {
  const pathOnly = rawPath.split('?')[0].replace(/\/+$/, '') || '/';
  const segments = pathOnly.split('/').map((segment) => (segment.startsWith(':') ? ':param' : segment));
  return `${method.toUpperCase()} ${segments.join('/')}`;
}

/**
 * Path an URL expression evaluates to, or null when it cannot be resolved.
 * A template whose first substitution comes before any text is taken to be
 * the API base URL (`${apiUrl}/public/...`) and that substitution is dropped.
 */
function literalPath(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let text = node.head.text;
  node.templateSpans.forEach((span, index) => {
    const baseUrl = index === 0 && node.head.text === '' && span.literal.text.startsWith('/');
    text += (baseUrl ? '' : ':param') + span.literal.text;
  });
  return text;
}

/**
 * True when a test endpoint is one the catalog contains. A catalog parameter
 * matches any segment, because the UI sometimes substitutes a path segment
 * chosen at runtime (`/phases/${id}/${endpoint}` for `standings` or
 * `bracket`); literal segments must be equal. The same rule is applied at
 * runtime by e2e/support/uiApi.ts.
 */
export function catalogContains(catalog, key) {
  if (catalog.has(key)) return true;
  const [method, ...segments] = key.split(/[ /]/);
  return [...catalog].some((candidate) => {
    const [candidateMethod, ...candidateSegments] = candidate.split(/[ /]/);
    return candidateMethod === method && candidateSegments.length === segments.length
      && candidateSegments.every((segment, index) => segment === ':param' || segment === segments[index]);
  });
}

/** Every endpoint the frontend calls with a resolvable literal path. */
export function frontendCatalog() {
  const keys = new Set();
  const files = sourceFiles(path.join(frontend, 'src'), (name) => /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name));
  for (const file of files) {
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          && callee.expression.text === 'api' && HTTP_METHODS.has(callee.name.text)) {
          const url = literalPath(node.arguments[0]);
          if (url) keys.add(endpointKey(callee.name.text, url));
        } else if (ts.isIdentifier(callee) && callee.text === 'fetch') {
          const url = literalPath(node.arguments[0]);
          if (url) {
            let method = 'GET';
            const options = node.arguments[1];
            if (options && ts.isObjectLiteralExpression(options)) {
              const methodProperty = options.properties.find((property) => ts.isPropertyAssignment(property)
                && ts.isIdentifier(property.name) && property.name.text === 'method');
              if (methodProperty && ts.isStringLiteral(methodProperty.initializer)) method = methodProperty.initializer.text;
            }
            keys.add(endpointKey(method, url.replace(/^\/api(?=\/)/, '')));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return keys;
}

/** `uiRequest(...)` calls in the end-to-end tests, with their literal method and path. */
function testRequests() {
  const calls = [];
  const files = sourceFiles(path.join(root, 'e2e'), (name) => name.endsWith('.ts'));
  for (const file of files) {
    const source = parse(file);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text
          : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
        if (name === 'uiRequest') {
          const [, methodNode, pathNode] = node.arguments;
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          const location = `${path.relative(root, file)}:${line + 1}`;
          const literal = (value) => value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value));
          calls.push(literal(methodNode) && literal(pathNode)
            ? { location, key: endpointKey(methodNode.text, pathNode.text) }
            : { location, key: null });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return calls;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const catalog = frontendCatalog();
  if (process.argv.includes('--catalog')) {
    process.stdout.write(JSON.stringify([...catalog].sort()));
    process.exit(0);
  }
  const problems = testRequests().flatMap(({ location, key }) => {
    if (!key) return [`${location}: uiRequest needs a literal method and path`];
    return catalogContains(catalog, key) ? [] : [`${location}: ${key} is not called by the frontend`];
  });
  if (problems.length) {
    console.error(`UI API contract: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`UI API contract: every uiRequest in e2e/ matches one of ${catalog.size} frontend endpoints.`);
}
