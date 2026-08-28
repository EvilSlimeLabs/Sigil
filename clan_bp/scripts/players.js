// @ts-check
/**
 * Player identity: mapping between the stable `player.id` used as a storage key
 * and the display name shown to humans.
 *
 * Gamertags can change, so names are treated as a refreshable cache and never
 * as an identity. The registry is what lets the UI list and act on members who
 * are currently offline.
 */

import { world } from '@minecraft/server';
import { KEY } from './config.js';
import { getString, setString, remove, idsWithPrefix } from './storage.js';
import { normalizeKey } from './format.js';
import { TEXT } from './text.js';

/**
 * A player reference that works whether or not they are online.
 *
 * @typedef {object} PlayerRef
 * @property {string} id
 * @property {string} name
 * @property {boolean} online
 */

/**
 * Records a player's current name, replacing any stale reverse mapping.
 * Called on every join.
 *
 * @param {import('@minecraft/server').Player} player
 */
export function register(player) {
  const previous = getString(KEY.playerName + player.id);
  if (previous === player.name) return;

  if (previous !== undefined) {
    // The gamertag changed: drop the old reverse entry so it cannot resolve to
    // this player under a name they no longer use.
    const staleKey = KEY.playerId + normalizeKey(previous);
    if (getString(staleKey) === player.id) remove(staleKey);
  }

  setString(KEY.playerName + player.id, player.name);
  setString(KEY.playerId + normalizeKey(player.name), player.id);
}

/**
 * Last-known name for a player id.
 *
 * @param {string} playerId
 * @returns {string | undefined}
 */
export function nameOf(playerId) {
  return getString(KEY.playerName + playerId);
}

/**
 * Last-known name, or a readable placeholder for a player never seen before.
 *
 * @param {string} playerId
 * @returns {string}
 */
export function displayName(playerId) {
  return nameOf(playerId) ?? TEXT.fragment.unknownPlayer;
}

/**
 * Resolves a name to a player id, preferring an online match.
 *
 * @param {string} name
 * @returns {string | undefined}
 */
export function idForName(name) {
  const key = normalizeKey(name);
  const online = world.getAllPlayers().find((p) => normalizeKey(p.name) === key);
  if (online) return online.id;
  return getString(KEY.playerId + key);
}

/**
 * The online `Player` for an id, if they are connected.
 *
 * @param {string} playerId
 * @returns {import('@minecraft/server').Player | undefined}
 */
export function onlinePlayer(playerId) {
  return world.getAllPlayers().find((p) => p.id === playerId);
}

/**
 * Builds a reference for a player id, resolving liveness and name.
 *
 * @param {string} playerId
 * @returns {PlayerRef}
 */
export function ref(playerId) {
  const online = onlinePlayer(playerId);
  return {
    id: playerId,
    name: online?.name ?? displayName(playerId),
    online: online !== undefined,
  };
}

/**
 * Every player the world has ever seen, sorted by name. Backs the "pick a
 * player" pickers in the UI, which must be able to reach offline players.
 *
 * @returns {PlayerRef[]}
 */
export function allKnown() {
  const onlineIds = new Set(world.getAllPlayers().map((p) => p.id));
  const refs = idsWithPrefix(KEY.playerName).map((key) => {
    const id = key.slice(KEY.playerName.length);
    return { id, name: getString(key) ?? TEXT.fragment.unknownPlayer, online: onlineIds.has(id) };
  });
  refs.sort((a, b) => a.name.localeCompare(b.name));
  return refs;
}

/**
 * Sends a message to a player only if they are online. Used wherever the
 * add-on notifies someone about an action taken on them elsewhere.
 *
 * @param {string} playerId
 * @param {string} text
 */
export function notify(playerId, text) {
  onlinePlayer(playerId)?.sendMessage(text);
}
