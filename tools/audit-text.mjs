/**
 * Fails if any player-visible wording is written outside the text catalogue.
 *
 * This exists because three hand-rolled checks in a row said "none left" while
 * a hundred strings sat in plain sight. Each looked only where it expected
 * strings to be — in the argument of a known message call — and so never saw a
 * sentence built into a variable first, split across a `+`, or tucked inside a
 * `${...}`.
 *
 * So this looks at **content**, not position: any literal holding two or more
 * words is prose, wherever it appears. Console logging is excluded, because
 * that goes to the content log rather than to a player. It runs as part of
 * `npm run verify`, so the answer cannot quietly rot again.
 *
 *   node tools/audit-text.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', 'clan_bp', 'scripts');

/** Two or more runs of three-plus letters, separated by a space. */
const PROSE = /(^|[^A-Za-z])[A-Za-z]{3,}\s+[A-Za-z]{3,}/;

/** @type {Array<{ file: string, line: number, text: string }>} */
const findings = [];

for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith('.js') || file === 'text.js') continue;

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
