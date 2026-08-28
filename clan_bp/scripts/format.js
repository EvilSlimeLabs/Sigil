// @ts-check
/**
 * Text sanitising, validation and small display helpers.
 *
 * Everything a player types passes through here before it is stored. The
 * central rule: strip `§` from all user input, so nobody can inject colour
 * codes or forge the admin symbol into their own clan or role name.
 */

import { C, LIMITS, LEADER_ROLE, MSG_PREFIX } from './config.js';
import { TEXT } from './text.js';

/**
 * Removes Minecraft formatting codes and control characters from user input.
 *
 * @param {string} input
 * @returns {string}
 */
export function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/§./g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

/**
 * The outcome of validating user input.
 *
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} Result
 */

/**
 * Validates a proposed clan name. Does not check uniqueness — that needs
 * storage and lives in `clans.js`.
 *
 * @param {string} raw
 * @returns {Result<string>}
 */
export function validateClanName(raw) {
  const name = sanitize(raw);
  if (name.length < LIMITS.clanNameMin || name.length > LIMITS.clanNameMax) {
    return {
      ok: false,
      error: TEXT.validate.clanNamesMustBeCharacters(LIMITS.clanNameMin, LIMITS.clanNameMax),
    };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
    return { ok: false, error: TEXT.validate.clanNamesMayOnlyUse };
  }
  return { ok: true, value: name };
}

/**
 * Validates a proposed clan role name. `Leader` is reserved for the owner.
 *
 * @param {string} raw
 * @returns {Result<string>}
 */
export function validateRoleName(raw) {
  const name = sanitize(raw);
  if (name.length < LIMITS.roleNameMin || name.length > LIMITS.roleNameMax) {
    return {
      ok: false,
      error: TEXT.validate.roleNamesMustBeCharacters(LIMITS.roleNameMin, LIMITS.roleNameMax),
    };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
    return { ok: false, error: TEXT.validate.roleNamesMayOnlyUse };
  }
  if (name.toLowerCase() === LEADER_ROLE.toLowerCase()) {
    return { ok: false, error: TEXT.validate.isReservedForTheClan };
  }
  return { ok: true, value: name };
}

/**
 * Validates a staff role display name. Unlike clan roles, `Leader` is not
 * reserved here — the two namespaces are unrelated.
 *
 * @param {string} raw
 * @returns {Result<string>}
 */
export function validateStaffRoleName(raw) {
  const name = sanitize(raw);
  if (name.length < LIMITS.roleNameMin || name.length > LIMITS.roleNameMax) {
    return {
      ok: false,
      error: TEXT.validate.staffRoleNamesMustBe(LIMITS.roleNameMin, LIMITS.roleNameMax),
    };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
    return { ok: false, error: TEXT.validate.staffRoleNamesMayOnly };
  }
  return { ok: true, value: name };
}

/**
 * Validates the short tag body shown in chat for a staff role.
 *
 * @param {string} raw
 * @returns {Result<string>}
 */
export function validateStaffSymbol(raw) {
  const symbol = sanitize(raw);
  if (symbol.length === 0 || symbol.length > LIMITS.staffSymbolMax) {
    return { ok: false, error: TEXT.validate.staffTagsMustBeCharacters(LIMITS.staffSymbolMax) };
  }
  return { ok: true, value: symbol };
}

/**
 * Turns a display name into a stable lowercase identifier.
 *
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  return sanitize(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'role';
}

/**
 * Case-insensitive key used for name uniqueness lookups.
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeKey(name) {
  return sanitize(name).toLowerCase();
}

/**
 * Formats a message sent by the add-on to a single player or to the world.
 *
 * @param {string} text
 * @returns {string}
 */
export function msg(text) {
  return MSG_PREFIX + text;
}

/**
 * Formats an error message shown to a player.
 *
 * @param {string} text
 * @returns {string}
 */
export function errorMsg(text) {
  return MSG_PREFIX + C.red + text;
}

/**
 * Formats a success message shown to a player.
 *
 * @param {string} text
 * @returns {string}
 */
export function successMsg(text) {
  return MSG_PREFIX + C.green + text;
}

/**
 * Clamps a string for display inside a form button or list row.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
