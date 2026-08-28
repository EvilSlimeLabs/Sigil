/**
 * Globals the Bedrock script runtime provides but that no `@minecraft/*`
 * package declares.
 *
 * The runtime exposes a `console` whose output goes to the content log, not to
 * a browser or Node process. It is deliberately declared with only the three
 * methods the add-on uses, so nothing in the codebase can start depending on a
 * `console` API the game does not actually implement.
 */

declare const console: {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
