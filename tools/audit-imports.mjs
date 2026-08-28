/**
 * Fails if the module graph contains a cycle.
 *
 * Extracting one string from `config.js` once made it import `text.js`, which
 * imports `config.js` — a cycle the type checker was perfectly happy with and
 * that only surfaced as a temporal-dead-zone crash when the game loaded the
 * pack. Cheap to check, expensive to find by hand.
 *
 *   node tools/audit-imports.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', 'clan_bp', 'scripts');

/** @type {Map<string, string[]>} */
const graph = new Map();

for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
  const deps = [...src.matchAll(/^import[^'"]*['"]\.\/([A-Za-z0-9_.-]+)['"]/gm)].map((m) => m[1]);
  graph.set(file, deps);
}

/** @type {string[][]} */
const cycles = [];
const state = new Map(); // file -> 'visiting' | 'done'

function walk(file, trail) {
  if (state.get(file) === 'done') return;
  if (state.get(file) === 'visiting') {
    cycles.push([...trail.slice(trail.indexOf(file)), file]);
    return;
  }
  state.set(file, 'visiting');
  for (const dep of graph.get(file) ?? []) walk(dep, [...trail, file]);
  state.set(file, 'done');
}

for (const file of graph.keys()) walk(file, []);

for (const cycle of cycles) console.log(`cycle: ${cycle.join(' -> ')}`);

if (cycles.length === 0) {
  console.log(`import audit: ${graph.size} modules, no cycles`);
} else {
  console.log(`\nimport audit: ${cycles.length} cycle(s)`);
}

process.exitCode = cycles.length === 0 ? 0 : 1;
