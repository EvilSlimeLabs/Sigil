// @ts-check
/**
 * A thin typed layer over world dynamic properties.
 *
 * Dynamic properties store only `boolean | number | string | Vector3`, so every
 * structured record is JSON encoded here. Reads are defensive: a corrupt or
 * hand-edited value yields the fallback rather than throwing into a game event
 * handler, where an exception would abort whatever else that tick was doing.
 */

import { world } from '@minecraft/server';
import { identityChanged } from './hooks.js';
import { KEY, LIMITS, SCHEMA_VERSION } from './config.js';

/**
 * Reads a raw string property.
 *
 * @param {string} key
 * @returns {string | undefined}
 */
export function getString(key) {
  const value = world.getDynamicProperty(key);
  return typeof value === 'string' ? value : undefined;
}

/**
 * Writes a string property, or clears it when `value` is undefined.
 *
 * @param {string} key
 * @param {string | undefined} value
 */
export function setString(key, value) {
  world.setDynamicProperty(key, value);
}

/**
 * Writes a player-keyed property that the renderer reads, then announces the
 * change so the nametag and chat name are rebuilt.
 *
 * Everything the renderer composes a player's identity from — their clan, their
 * staff role, their Peaceful marker — is stored one property per player. Those
 * writes go through here so that persisting a change and announcing it are one
 * step: a mutator cannot do the first and forget the second.
 *
 * Passing `undefined` removes the property.
 *
 * @param {string} playerId whose displayed identity this write affects
 * @param {string} key
 * @param {string | undefined} value
 */
export function setRendered(playerId, key, value) {
  if (value === undefined) remove(key);
  else setString(key, value);
  identityChanged(playerId);
}

/**
 * Announces that several players' displayed identities changed, for a write
 * that touches many of them at once — editing a staff role redraws every player
 * holding it, and the role itself is not stored per player.
 *
 * @param {Iterable<string>} playerIds
 */
export function refreshRendered(playerIds) {
  for (const id of playerIds) identityChanged(id);
}

/**
 * Reads a number property.
 *
 * @param {string} key
 * @returns {number | undefined}
 */
export function getNumber(key) {
  const value = world.getDynamicProperty(key);
  return typeof value === 'number' ? value : undefined;
}

/**
 * Removes a property entirely.
 *
 * @param {string} key
 */
export function remove(key) {
  world.setDynamicProperty(key, undefined);
}

/**
 * Reads and JSON-decodes a property.
 *
 * @template T
 * @param {string} key
 * @param {T} fallback returned when the property is absent or unparseable
 * @returns {T}
 */
export function getJson(key, fallback) {
  const raw = getString(key);
  if (raw === undefined) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    console.warn(`[sigil] discarding unparseable value at "${key}"`);
    return fallback;
  }
}

/**
 * JSON-encodes and writes a property.
 *
 * @param {string} key
 * @param {unknown} value
 */
export function setJson(key, value) {
  setString(key, JSON.stringify(value));
}

/**
 * JSON-encodes and writes a property, refusing anything too large to store.
 *
 * A dynamic property string has a ceiling of roughly 32KB. Nothing the add-on
 * writes should approach it — a hundred-member clan is a few KB — but a record
 * that silently failed to save, or threw from deep inside a mutation, would be
 * a miserable way to discover otherwise.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} whether it was written
 */
export function setJsonGuarded(key, value) {
  const encoded = JSON.stringify(value);
  if (encoded.length > LIMITS.maxRecordBytes) {
    console.warn(
      `[sigil] refusing to write "${key}": ${encoded.length} bytes exceeds the ` +
        `${LIMITS.maxRecordBytes}-byte limit for one record`,
    );
    return false;
  }
  setString(key, encoded);
  return true;
}

/**
 * Lists every dynamic property id beginning with `prefix`.
 *
 * @param {string} prefix
 * @returns {string[]}
 */
export function idsWithPrefix(prefix) {
  return world.getDynamicPropertyIds().filter((id) => id.startsWith(prefix));
}

/**
 * Seconds since the Unix epoch, used for `createdAt` / `joinedAt` / invite
 * expiry stamps. Wall-clock time rather than world ticks, so stamps stay
 * meaningful across sessions.
 *
 * @returns {number}
 */
export function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Ensures the schema marker exists. Future migrations branch here.
 */
export function initSchema() {
  const version = getNumber(KEY.schemaVersion);
  if (version === undefined) {
    world.setDynamicProperty(KEY.schemaVersion, SCHEMA_VERSION);
    return;
  }
  if (version > SCHEMA_VERSION) {
    console.warn(
      `[sigil] stored schema v${version} is newer than this pack (v${SCHEMA_VERSION}); ` +
        'data may not be interpreted correctly.',
    );
  }
}
