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
const SCRIPTS = path.join(here, '..', 'sigil_bp', 'scripts');

/**
 * Every module in the scripts tree, as paths relative to it. The menus live in
 * a folder of their own, so a flat listing would miss most of the pack.
 *
 * @param {string} root
 * @param {string} [rel]
 * @returns {string[]}
 */
function scriptFiles(root, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(path.join(root, rel))) {
    const child = rel ? `${rel}/${name}` : name;
    if (fs.statSync(path.join(root, child)).isDirectory()) out.push(...scriptFiles(root, child));
    else if (name.endsWith('.js')) out.push(child);
  }
  return out;
}

/** @type {Map<string, string[]>} */
const graph = new Map();

for (const file of scriptFiles(SCRIPTS)) {
  const src = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
  // Both forms count: an `export ... from` re-export creates the same load-order
  // dependency an `import` does, and the barrel is built entirely out of them.
  const deps = [];
  for (const [, spec] of src.matchAll(/^(?:import|export)[^'"]*['"](\.[^'"]+)['"]/gm)) {
    deps.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
  }
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
