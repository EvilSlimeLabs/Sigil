/**
 * Fails if any player-visible wording is written outside the text catalogue.
 *
 * The test is on **content**, not position: any literal holding two or more
 * words is prose, wherever it appears — built into a variable first, split
 * across a `+`, or tucked inside a `${...}`. Console logging is excluded, since
 * that goes to the content log rather than to a player. It runs as part of
 * `npm run verify`.
 *
 *   node tools/audit-text.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', 'clan_bp', 'scripts');

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

/** Two or more runs of three-plus letters, separated by a space. */
const PROSE = /(^|[^A-Za-z])[A-Za-z]{3,}\s+[A-Za-z]{3,}/;

/** @type {Array<{ file: string, line: number, text: string }>} */
const findings = [];

for (const file of scriptFiles(SCRIPTS)) {
  if (file === 'text.js') continue;

  const full = path.join(SCRIPTS, file);
  const sf = ts.createSourceFile(full, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.ES2022, true);

  // Anything under console.* is for the content log, not for a player.
  /** @type {Array<[number, number]>} */
  const logRanges = [];
  (function findLogs(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console'
    ) {
      logRanges.push([node.getStart(sf), node.getEnd()]);
    }
    ts.forEachChild(node, findLogs);
  })(sf);
  const inLog = (pos) => logRanges.some(([from, to]) => pos >= from && pos < to);

  (function visit(node) {
    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      text = node.text;
    } else if (ts.isTemplateExpression(node)) {
      text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' ');
    }

    if (text !== null && PROSE.test(text) && !inLog(node.getStart(sf))) {
      findings.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        text: text.replace(/\s+/g, ' ').trim(),
      });
    }
    ts.forEachChild(node, visit);
  })(sf);
}

for (const { file, line, text } of findings) {
  console.log(`${file}:${line}  ${JSON.stringify(text).slice(0, 80)}`);
}

if (findings.length === 0) {
  console.log('text audit: every player-visible string is in the catalogue');
} else {
  console.log(`\ntext audit: ${findings.length} string(s) outside the catalogue`);
}

process.exitCode = findings.length === 0 ? 0 : 1;
