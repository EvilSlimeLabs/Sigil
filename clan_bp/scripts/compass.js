// @ts-check
/**
 * The Clan Compass — a one-press way into the menu.
 *
 * Typing `/clan:menu` on a controller means opening chat, driving an on-screen
 * keyboard and spelling out a namespaced command. That is the path a console
 * clan leader would take most often, so the forms UI gets a physical key.
 *
 * The item's icon comes from the resource pack (`clan_compass`), which the
 * behavior pack declares as a dependency so the two are enabled together.
 */

import { ItemStack } from '@minecraft/server';
import { COMPASS_ITEM, WAR_MAP_BLOCK, KEY } from './config.js';
import { getString, setString } from './storage.js';

/**
 * Whether a stack is the Clan Compass.
 *
 * @param {import('@minecraft/server').ItemStack | undefined} item
 * @returns {boolean}
 */
export function isCompass(item) {
  return item?.typeId === COMPASS_ITEM;
}

/**
 * Whether the player is already carrying one, so joins do not hand out a second.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function has(player) {
  const inventory = player.getComponent('minecraft:inventory');
  const container = inventory?.container;
  if (!container) return false;

  for (let slot = 0; slot < container.size; slot += 1) {
    if (isCompass(container.getItem(slot))) return true;
  }
  return false;
}

/**
 * Puts a Clan Compass in the player's inventory.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean} false when there was no room
 */
export function give(player) {
  const inventory = player.getComponent('minecraft:inventory');
  const container = inventory?.container;
  if (!container || container.emptySlotsCount === 0) return false;

  try {
    container.addItem(new ItemStack(COMPASS_ITEM, 1));
    return true;
  } catch (err) {
    // The item type is missing, which means the pack's items folder did not
    // load. The menu is still reachable by command, so this is not fatal.
    console.warn(`[sigil] could not give the clan compass: ${err}`);
    return false;
  }
}

/**
 * Gives a compass only to a player who does not already have one.
 *
 * @param {import('@minecraft/server').Player} player
 */
export function ensure(player) {
  // Issued once, not on every join. A player who threw theirs away meant to,
  // and `/clan:compass` is there when they change their mind.
  if (getString(KEY.compassIssued + player.id) !== undefined) return;
  if (!has(player) && !give(player)) return;
  setString(KEY.compassIssued + player.id, '1');
}

/**
 * Puts a War Map in the player's inventory. It is a block, so what they receive
 * is its item form, ready to place.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean} false when there was no room
 */
export function giveWarMap(player) {
  const inventory = player.getComponent('minecraft:inventory');
  const container = inventory?.container;
  if (!container || container.emptySlotsCount === 0) return false;

  try {
    container.addItem(new ItemStack(WAR_MAP_BLOCK, 1));
    return true;
  } catch (err) {
    console.warn(`[sigil] could not give the war map: ${err}`);
    return false;
  }
}
