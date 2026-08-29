// @ts-check
/**
 * The Peaceful marker.
 *
 * It is a flag rather than a staff role slot, and deliberately so: a player can
 * be Admin *and* Peaceful, or Mod *and* Peaceful. Folding it into the
 * single-staff-role slot would have made those mutually exclusive, which is
 * exactly what the requirement rules out.
 *
 * It carries no mechanical effect of its own — it marks a player in the nametag
 * and in chat, and nothing in the codebase branches on it.
 */

import { KEY } from './config.js';
import { getString, setString, remove, idsWithPrefix } from './storage.js';
import * as settings from './settings.js';
import * as staff from './staff.js';

/**
 * Whether a player is marked Peaceful. Works for offline players.
 *
 * @param {string} playerId
 * @returns {boolean}
 */
export function isPeaceful(playerId) {
  return getString(KEY.peaceful + playerId) !== undefined;
}

/**
 * Grants or clears the Peaceful marker.
 *
 * @param {string} playerId
 * @param {boolean} value
 */
export function set(playerId, value) {
  if (value) setString(KEY.peaceful + playerId, '1');
  else remove(KEY.peaceful + playerId);
}

/**
 * Every player id currently marked Peaceful.
 *
 * @returns {string[]}
 */
export function all() {
  return idsWithPrefix(KEY.peaceful).map((key) => key.slice(KEY.peaceful.length));
}

/**
 * Whether a player may grant or clear Peaceful. Admins always may;
 * clan-managing staff roles may when the setting allows it.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function canAssign(player) {
  if (staff.isAdmin(player)) return true;
  return staff.hasPower(player, 'assignPeaceful');
}

/**
 * Whether the marker should be drawn on a given surface.
 *
 * @param {'nametag' | 'chat'} surface
 * @returns {boolean}
 */
export function visibleOn(surface) {
  const { visibility } = settings.get().display.peaceful;
  return visibility === 'both' || visibility === surface;
}
