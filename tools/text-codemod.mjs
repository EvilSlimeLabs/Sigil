/**
 * Maintains the wording catalogue in `sigil_bp/scripts/text.js`.
 *
 * The catalogue was first produced by a one-shot extraction that keyed entries
 * by call site rather than by meaning, so the same sentence pulled from three
 * files became three entries under three auto-slugged names. This tool is the
 * executable form of the passes that clean that up, and it stays committed so
 * the next pass does not start from a scratch directory again.
 *
 *   node tools/text-codemod.mjs check             fail if any body is duplicated
 *   node tools/text-codemod.mjs duplicates        list bodies used by 2+ keys
 *   node tools/text-codemod.mjs dedupe            keep one key per body
 *   node tools/text-codemod.mjs rename <map.json> apply {"ns.old":"ns.new"}
 *
 * `dedupe` and `rename` rewrite the catalogue and every call site in
 * `sigil_bp/scripts` and `tests`, then leave verification to `npm run verify`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const CATALOGUE = path.join(ROOT, 'sigil_bp', 'scripts', 'text.js');

/**
 * Namespaces whose keys are ids referenced from data rather than from code.
 * Renaming or merging one silently breaks a dropdown, so they are left alone.
 */
const ID_NAMESPACES = new Set(['symbol', 'color', 'board']);

/**
 * Every entry in the catalogue, with the source range of its whole property so
 * a caller can delete it exactly.
 *
 * @returns {Array<{ ns: string, key: string, body: string, start: number, end: number }>}
 */
function readEntries() {
  const source = fs.readFileSync(CATALOGUE, 'utf8');
  const sf = ts.createSourceFile(CATALOGUE, source, ts.ScriptTarget.ES2022, true);

  /** @type {ts.ObjectLiteralExpression | undefined} */
  let root;
  const visit = (node) => {
    if (
      root === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'TEXT' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      root = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!root) throw new Error('TEXT object literal not found');

  const entries = [];
  for (const nsProp of root.properties) {
    if (!ts.isPropertyAssignment(nsProp)) continue;
    const ns = nsProp.name.getText(sf);
    if (!ts.isObjectLiteralExpression(nsProp.initializer)) continue;
    for (const prop of nsProp.initializer.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      entries.push({
        ns,
        key: prop.name.getText(sf),
        body: prop.initializer.getText(sf),
        start: prop.getStart(sf),
        end: prop.end,
      });
    }
  }
  return entries;
}

/**
 * The body with parameter names flattened, so two entries that differ only in
 * how their arguments were numbered still compare equal.
 *
 * @param {string} body
 * @returns {string}
 */
function canonical(body) {
  return body
    .replace(/\/\*\*[^*]*\*\//g, '')
    .replace(/\ba\d+\b/g, 'ARG')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Keys that win their group outright, because the shorter name the scoring
 * below would otherwise pick describes the sentence where these describe the
 * role the sentence plays.
 */
const PREFER = new Set(['menu.pickerSearchLabel', 'menu.pickerSearchSubmit']);

/**
 * The key a group of duplicates collapses onto: a shared namespace over a
 * local one, a hand-written name over a numbered slug, then the shortest, then
 * alphabetical so the choice is stable across runs.
 *
 * @param {Array<{ ns: string, key: string }>} group
 * @returns {{ ns: string, key: string }}
 */
function pickWinner(group) {
  const preferred = group.find((entry) => PREFER.has(entry.ns + '.' + entry.key));
  if (preferred) return preferred;
  const score = (entry) =>
    (entry.ns === 'common' ? 0 : 100) + (/\d$/.test(entry.key) ? 50 : 0) + entry.key.length;
  return [...group].sort((a, b) => score(a) - score(b) || a.key.localeCompare(b.key))[0];
}

/**
 * Every file that reads the catalogue.
 *
 * @returns {string[]}
 */
function callSites() {
  const dirs = [path.join(ROOT, 'sigil_bp', 'scripts'), path.join(ROOT, 'tests')];
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name !== '.generated') walk(full);
        continue;
      }
      if (!/\.(js|mjs)$/.test(name)) continue;
      if (full !== CATALOGUE) files.push(full);
    }
  };
  for (const dir of dirs) walk(dir);
  return files;
}

/**
 * Repoints `TEXT.ns.key` and `txt.ns.key` at their replacements.
 *
 * @param {Map<string, string>} map from `ns.key` to `ns.key`
 * @returns {number} how many references moved
 */
function repoint(map) {
  let moved = 0;
  for (const file of callSites()) {
    const before = fs.readFileSync(file, 'utf8');
    let after = before;
    for (const [from, to] of map) {
      const pattern = new RegExp('\\b(TEXT|txt)\\.' + from.replace('.', '\\.') + '\\b', 'g');
      after = after.replace(pattern, (_match, root) => {
        moved += 1;
        return root + '.' + to;
      });
    }
    if (after !== before) fs.writeFileSync(file, after, 'utf8');
  }
  return moved;
}

/**
 * Deletes whole property assignments from the catalogue, back to front so the
 * ranges of the ones still to go stay valid.
 *
 * @param {Array<{ start: number, end: number }>} doomed
 */
function deleteEntries(doomed) {
  let source = fs.readFileSync(CATALOGUE, 'utf8');
  for (const entry of [...doomed].sort((a, b) => b.start - a.start)) {
    let end = entry.end;
    if (source[end] === ',') end += 1;
    while (source[end] === ' ') end += 1;
    if (source[end] === '\n') end += 1;
    let start = entry.start;
    while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start -= 1;
    source = source.slice(0, start) + source.slice(end);
  }
  fs.writeFileSync(CATALOGUE, source, 'utf8');
}

/**
 * Groups entries by what they say.
 *
 * @returns {Array<Array<{ ns: string, key: string, body: string, start: number, end: number }>>}
 */
function duplicateGroups() {
  const byBody = new Map();
  for (const entry of readEntries()) {
    if (ID_NAMESPACES.has(entry.ns)) continue;
    const id = canonical(entry.body);
    if (!byBody.has(id)) byBody.set(id, []);
    byBody.get(id).push(entry);
  }
  return [...byBody.values()].filter((group) => group.length > 1);
}

const [command, argument] = process.argv.slice(2);

if (command === 'check') {
  const groups = duplicateGroups();
  if (groups.length > 0) {
    for (const group of groups) {
      console.error(group.map((entry) => entry.ns + '.' + entry.key).join(' = '));
    }
    console.error(String.fromCharCode(10) + groups.length + ' duplicated bodies; run: node tools/text-codemod.mjs dedupe');
    process.exit(1);
  }
  console.log('text catalogue: no duplicated bodies');
} else if (command === 'duplicates') {
  const groups = duplicateGroups();
  for (const group of groups) {
    const winner = pickWinner(group);
    console.log(winner.ns + '.' + winner.key);
    for (const entry of group) {
      if (entry === winner) continue;
      console.log('    <- ' + entry.ns + '.' + entry.key);
    }
  }
  console.log('\n' + groups.length + ' bodies used by more than one key');
} else if (command === 'dedupe') {
  const groups = duplicateGroups();
  /** @type {Map<string, string>} */
  const map = new Map();
  const doomed = [];
  for (const group of groups) {
    const winner = pickWinner(group);
    for (const entry of group) {
      if (entry === winner) continue;
      map.set(entry.ns + '.' + entry.key, winner.ns + '.' + winner.key);
      doomed.push(entry);
    }
  }
  const moved = repoint(map);
  deleteEntries(doomed);
  console.log('dedupe: ' + doomed.length + ' entries removed, ' + moved + ' references repointed');
} else if (command === 'rename') {
  if (!argument) throw new Error('rename needs a path to a JSON map');
  const raw = JSON.parse(fs.readFileSync(path.resolve(argument), 'utf8'));
  const map = new Map(Object.entries(raw));
  const moved = repoint(map);

  let source = fs.readFileSync(CATALOGUE, 'utf8');
  const entries = readEntries();
  const ordered = [...map].sort((a, b) => {
    const find = (id) => entries.find((e) => e.ns + '.' + e.key === id);
    return (find(b[0])?.start ?? 0) - (find(a[0])?.start ?? 0);
  });
  for (const [from, to] of ordered) {
    const [ns, key] = from.split('.');
    const newKey = to.split('.')[1];
    const entry = entries.find((candidate) => candidate.ns === ns && candidate.key === key);
    if (!entry) throw new Error('no catalogue entry for ' + from);
    source = source.slice(0, entry.start) + newKey + source.slice(entry.start + key.length);
  }
  fs.writeFileSync(CATALOGUE, source, 'utf8');
  console.log('rename: ' + map.size + ' keys renamed, ' + moved + ' references repointed');
} else {
  console.log('usage: text-codemod.mjs check | duplicates | dedupe | rename <map.json>');
  process.exit(1);
}
