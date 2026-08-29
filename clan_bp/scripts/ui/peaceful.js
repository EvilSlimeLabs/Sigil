// @ts-check
/**
 * The Peaceful roster, and the picker that grants or clears the marker.
 */

import { C } from '../config.js';
import { errorMsg, successMsg, msg, truncate } from '../format.js';
import { TEXT } from '../text.js';
import * as peaceful from '../peaceful.js';
import * as settings from '../settings.js';
import * as players from '../players.js';
import * as display from '../display.js';
import { onlineDot, pickPlayer, run } from './shared.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../clans.js').Clan} Clan */

/**
 * Who currently holds the Peaceful marker.
 *
 * A marker that can be granted from several places is worth being able to
 * audit from one.
 *
 * @param {Player} player
 */
export function peacefulRoster(player) {
  run(player, async () => {
    if (!peaceful.canAssign(player)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotViewThePeaceful));
      return;
    }

    const config = settings.get().display.peaceful;
    const held = peaceful.all().map((id) => players.ref(id));
    if (held.length === 0) {
      player.sendMessage(msg(TEXT.menu.nobodyHoldsTheRole(config.name)));
      return;
    }

    held.sort((a, b) => a.name.localeCompare(b.name));
    const rows = held
      .map((ref) => `${C.gray} - ${ref.online ? C.green : C.darkGray}${ref.name}`)
      .join('\n');
    player.sendMessage(msg(TEXT.menu.roster(config.color, config.name, held.length, rows)));
  });
}


// ── Peaceful assignment ───────────────────────────────────────────────────

/**
 * Grants or clears the Peaceful marker. Separate from the staff-role picker
 * because Peaceful stacks with a system role rather than replacing it.
 *
 * @param {Player} player
 */
export function peacefulPicker(player) {
  run(player, async () => {
    if (!peaceful.canAssign(player)) {
      player.sendMessage(errorMsg(TEXT.common.notPeacefulAssigner));
      return;
    }

    const known = players.allKnown();
    if (known.length === 0) {
      player.sendMessage(msg(TEXT.menu.noPlayersOnRecord));
      return;
    }

    const config = settings.get().display.peaceful;
    const target = await pickPlayer(player, {
      title: `${config.color}${config.name}`,
      body:
        TEXT.menu.selectAPlayerToGrant +
        `${config.color}${config.name}${C.gray} role.\n` +
        TEXT.menu.peacefulStacksNote,
      candidates: known,
      describe: (ref) =>
        `${onlineDot(ref)} ${C.white}${truncate(ref.name, 20)}\n` +
        (peaceful.isPeaceful(ref.id)
          ? `${config.color}${config.name}`
          : `${C.darkGray}${TEXT.fragment.notMarked}`),
    });

    if (!target) return;

    const next = !peaceful.isPeaceful(target.id);
    peaceful.set(target.id, next);
    display.refreshById(target.id);

    player.sendMessage(
      successMsg(
        next
          ? TEXT.cmd.roleSet(target.name, config.name)
          : TEXT.menu.roleClearedFrom(config.name, target.name),
      ),
    );
    players.notify(
      target.id,
      msg(
        next
          ? TEXT.menu.staffRoleGiven(config.color, config.name)
          : TEXT.menu.yourRoleWasRemoved(config.name),
      ),
    );
    peacefulPicker(player);
  });
}
