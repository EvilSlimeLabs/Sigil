/**
 * Test harness.
 *
 * The pack ships as plain ES modules that import `@minecraft/server`, a module
 * that only exists inside the game. To run the same files under Node, the
 * harness copies them into `tests/.generated/` with that one import specifier
 * rewritten to point at `mock-server.js`.
 *
 * The copies are byte-for-byte identical apart from the import line, so what is
 * tested is the code that actually ships — not a parallel reimplementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.join(here, '..', 'clan_bp', 'scripts');
const generatedDir = path.join(here, '.generated');

/**
 * Copies the named modules with their game imports rewritten.
 *
 * @param {string[]} moduleNames
 */
export function prepare(moduleNames) {
  fs.rmSync(generatedDir, { recursive: true, force: true });
  fs.mkdirSync(generatedDir, { recursive: true });

  for (const mock of ['mock-server.js', 'mock-server-ui.js']) {
    fs.copyFileSync(path.join(here, mock), path.join(generatedDir, mock));
  }

  for (const name of moduleNames) {
    const source = fs
      .readFileSync(path.join(scriptsDir, name), 'utf8')
      .replace(/from '@minecraft\/server'/g, "from './mock-server.js'")
      .replace(/from '@minecraft\/server-ui'/g, "from './mock-server-ui.js'");
    fs.writeFileSync(path.join(generatedDir, name), source);
  }
}

/**
 * Imports a prepared module.
 *
 * The specifier carries no cache-busting query on purpose. The modules under
 * test import each other, and a query string would give the test a *different*
 * instance from the one they share — separate property stores, separate hook
 * registrations — so assertions would silently observe the wrong world. Each
 * test file runs in its own process, so a fresh module graph is already
 * guaranteed.
 *
 * @param {string} name
 * @returns {Promise<any>}
 */
export function load(name) {
  return import(`./.generated/${name}`);
}

let failures = 0;
let total = 0;

/**
 * Asserts a condition.
 *
 * @param {string} label
 * @param {boolean} condition
 * @param {string} [detail]
 */
export function check(label, condition, detail = '') {
  total += 1;
  if (condition) {
    console.log(`PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
}

/**
 * Asserts two values are equal, showing both when they are not.
 *
 * @param {string} label
 * @param {unknown} actual
 * @param {unknown} expected
 */
export function checkEqual(label, actual, expected) {
  check(
    label,
    actual === expected,
    `expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`,
  );
}

/** Strips Minecraft formatting codes, so assertions read as plain text. */
export function plain(text) {
  return String(text).replace(/§./g, '');
}

/** Prints the summary and sets the exit code. */
export function finish() {
  console.log(
    `\n${failures === 0 ? `ALL ${total} CHECKS PASSED` : `${failures} of ${total} CHECKS FAILED`}`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}
