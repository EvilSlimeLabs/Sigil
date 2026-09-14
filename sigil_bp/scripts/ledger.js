// @ts-check
/**
 * The Clan Ledger — a one-press way into the menu.
 *
 * Typing `/clan:menu` on a controller means opening chat, driving an on-screen
 * keyboard and spelling out a namespaced command. That is the path a console
 * clan leader would take most often, so the forms UI gets a physical key.
 *
 * It began as a compass, which was the wrong object: a compass points at
 * something, and this opens a record. A ledger is the book a clan keeps, and
 * the menu behind it is membership, roles and standing — so the item now looks
 * like what it does.
 *
 * The item's icon comes from the resource pack (`clan_ledger`), which the
 * behavior pack declares as a dependency so the two are enabled together.
 */

import { ItemStack } from '@minecraft/server';
import { LEDGER_ITEM, WAR_MAP_BLOCK, KEY } from './config.js';
import { getString, setString } from './storage.js';
import * as settings from './settings.js';

/**
 * Whether a stack is the Clan Ledger.
 *
 * @param {import('@minecraft/server').ItemStack | undefined} item
 * @returns {boolean}
 */
export function isLedger(item) {
  return item?.typeId === LEDGER_ITEM;
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
    if (isLedger(container.getItem(slot))) return true;
  }
  return false;
}

/**
 * Puts a Clan Ledger in the player's inventory.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean} false when there was no room
 */
export function give(player) {
  const inventory = player.getComponent('minecraft:inventory');
  const container = inventory?.container;
  if (!container || container.emptySlotsCount === 0) return false;

  try {
    container.addItem(new ItemStack(LEDGER_ITEM, 1));
    return true;
  } catch (err) {
    // The item type is missing, which means the pack's items folder did not
    // load. The menu is still reachable by command, so this is not fatal.
    console.warn(`[sigil] could not give the clan ledger: ${err}`);
    return false;
  }
}

/**
 * Gives a ledger only to a player who does not already have one.
 *
 * @param {import('@minecraft/server').Player} player
 */
export function ensure(player) {
  // Checked before the issued flag is written, so a player who joins while the
  // Ledger is off still receives one once it is turned back on.
  if (!settings.ledgerEnabled()) return;

  // Issued once, not on every join. A player who threw theirs away meant to,
  // and `/clan:ledger` is there when they change their mind.
  if (getString(KEY.ledgerIssued + player.id) !== undefined) return;
  if (!has(player) && !give(player)) return;
  setString(KEY.ledgerIssued + player.id, '1');
}

/**
 * Whether the player is already carrying a War Map.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function hasWarMap(player) {
  const inventory = player.getComponent('minecraft:inventory');
  const container = inventory?.container;
  if (!container) return false;

  for (let slot = 0; slot < container.size; slot += 1) {
    if (container.getItem(slot)?.typeId === WAR_MAP_BLOCK) return true;
  }
  return false;
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
