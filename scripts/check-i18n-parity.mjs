#!/usr/bin/env node
/**
 * i18n parity check (audit finding 13).
 *
 * English is the reference locale. For the frontend and backend locale
 * folders, every other locale must have exactly the English keys: a missing
 * key silently falls back to English or to the inline default, and an extra
 * key is dead text nobody maintains. Interpolation variables (`{{name}}`) must
 * also match, because a translation that drops or renames one renders broken
 * text at runtime.
 *
 * Keys are compared flattened with "." between levels, so a nested key and a
 * flat key containing a dot (both styles exist in these files) compare equal,
 * matching how i18next resolves them.
 *
 * Exit code: 0 when every locale matches, 1 otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localeDirs = ['frontend/src/i18n/locales', 'backend/src/i18n/locales'];

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, fullKey, out);
    else out.set(fullKey, child);
  }
  return out;
}

const placeholders = (text) => [...String(text).matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]).sort().join(',');

let problems = 0;
for (const dir of localeDirs) {
  const absolute = path.join(root, dir);
  const reference = flatten(JSON.parse(fs.readFileSync(path.join(absolute, 'en.json'), 'utf8')));
  const locales = fs.readdirSync(absolute).filter((file) => file.endsWith('.json') && file !== 'en.json');
  for (const file of locales) {
    const locale = flatten(JSON.parse(fs.readFileSync(path.join(absolute, file), 'utf8')));
    const missing = [...reference.keys()].filter((key) => !locale.has(key));
    const extra = [...locale.keys()].filter((key) => !reference.has(key));
    const mismatched = [...reference.keys()].filter(
      (key) => locale.has(key) && placeholders(reference.get(key)) !== placeholders(locale.get(key))
    );
    const report = [
      ...missing.map((key) => `missing: ${key}`),
      ...extra.map((key) => `extra: ${key}`),
      ...mismatched.map((key) => `placeholders differ: ${key} (en: {{${placeholders(reference.get(key))}}})`),
    ];
    if (report.length) {
      problems += report.length;
      console.log(`${dir}/${file}:`);
      for (const line of report) console.log(`  ${line}`);
    }
  }
}

if (problems) {
  console.log(`\ni18n parity: ${problems} problem(s). English (en.json) is the reference.`);
  process.exit(1);
}
console.log('i18n parity: every locale matches en.json (keys and interpolation variables).');
