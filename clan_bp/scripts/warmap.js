// @ts-check
/**
 * The War Map block: its interaction, its placement rule, and the check that
 * brings it down when the surface holding it up goes away.
 *
 * ── Interaction ────────────────────────────────────────────────────────────
 *
 * Two paths open the war screen, and either alone is enough.
 *
 * The custom component's `onPlayerInteract` is what marks the block as
 * interactive, which is what lets an empty-handed press reach a handler at all.
 * Beside it, `world.beforeEvents.playerInteractWithBlock` cancels the
 * interaction, so an item held at the time is not placed through the map. A
 * sneaking player is exempt, which is the vanilla way to build against a block
 * rather than use it.
 *
 * Both paths can describe the same press. {@link openWarScreen} holds a short
 * per-player cooldown so the screen opens once.
 *
 * ── Outline and collision ──────────────────────────────────────────────────
 *
 * These live in `blocks/war_map.json` and are split by facing. A painting will
 * not expand over a block the game reads as physically present, and a collision
 * box is what it reads. Paintings hang only on walls, so the four wall
 * permutations carry a one-pixel collision box lying exactly over the panel,
 * flush against the wall; the floor variant has none and is walked over. Every
 * selection box traces its own panel.
 *
 * ── Placement ──────────────────────────────────────────────────────────────
 *
 * Two rules, both enforced here rather than declared as components.
 * `beforeOnPlayerPlace` refuses a downward face, because there is no ceiling
 * geometry and no support direction for one. It also refuses a cell with
 * nothing behind it, which {@link canHangHere} decides.
 *
 * ── Support ────────────────────────────────────────────────────────────────
 *
 * The block ticks slowly and asks whether the surface it was mounted on is
 * still there, because Bedrock raises no neighbour-changed event for scripts.
 * Polling also catches a wall removed by a command, a piston or an explosion.
 */

import { system, world, Direction, ItemStack } from '@minecraft/server';
import { WAR_MAP_BLOCK } from './config.js';
import * as ui from './ui.js';

/** The custom component name, matching `blocks/war_map.json`. */
export const WAR_MAP_COMPONENT = 'clan:war_map';

/**
 * Where the block holding a map up sits, relative to the map, for each value
 * of `minecraft:block_face`.
 *
 * The state records the face that was placed *on*, so the supporting block is
 * always in the opposite direction from the map: a map placed against a block's
 * north face is standing north of it, and is held up from the south.
 *
 * `down` is kept even though a ceiling can no longer be built on: a map put up
 * before that refusal existed should be checked against the block above it, not
 * torn down on the next tick for a rule it predates.
 *
 * @type {Record<string, import('@minecraft/server').Vector3>}
 */
const SUPPORT_OFFSET = {
  up: { x: 0, y: -1, z: 0 },
  down: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: 0, z: 1 },
  south: { x: 0, y: 0, z: -1 },
  // The X axis runs opposite to the Z axis here, and opposite to the model:
  // the geometry draws an east or west panel on the far side of its cell, while
  // the supporting block sits on the near side. The model says where the map is
  // drawn; this says where the block holding it up is.
  west: { x: 1, y: 0, z: 0 },
  east: { x: -1, y: 0, z: 0 },
};

/**
 * Ticks a second interaction from the same player is ignored for.
 *
 * Long enough to swallow the duplicate press the two interaction paths can
 * produce, and far short of the time a second intentional press takes.
 */
const INTERACT_COOLDOWN_TICKS = 10;

/** @type {Map<string, number>} */
const lastInteraction = new Map();

/**
 * Opens the war screen for a player, at most once per press.
 *
 * @param {import('@minecraft/server').Player} player
 */
export function openWarScreen(player) {
  const now = system.currentTick;
  const previous = lastInteraction.get(player.id);
  if (previous !== undefined && now - previous < INTERACT_COOLDOWN_TICKS) return;
  lastInteraction.set(player.id, now);

  system.run(() => ui.warMenu(player));
}

/**
 * Forgets a departed player's cooldown.
 *
 * @param {string} playerId
 */
export function forget(playerId) {
  lastInteraction.delete(playerId);
}

/**
 * Whether a placed map still has its support.
 *
 * Looser than the test placement uses, because this only has to notice the
 * support being removed. A check more permissive than placement can only spare
 * something placement already allowed; a stricter one would delete blocks the
 * game let the player put down.
 *
 * @param {import('@minecraft/server').Block} block
 * @returns {boolean}
 */
function isSupported(block) {
  const face = String(block.permutation.getState('minecraft:block_face') ?? 'up');
  const offset = SUPPORT_OFFSET[face.toLowerCase()];
  if (!offset) return true;

  try {
    const support = block.offset(offset);
    // An unloaded neighbour is not an absent one. Leaving the map alone until
    // the chunk is there is the difference between a slow check and a
    // destructive one.
    if (support === undefined) return true;
    return !support.isAir && !support.isLiquid;
  } catch {
    return true;
  }
}

/**
 * Whether a map may be hung here.
 *
 * Anything that is not air and not liquid, which is the same rule paintings and
 * item frames follow: stairs, top slabs, glass, trapdoors, scaffolding and
 * composters all hold a map, and so does a torch.
 *
 * Fails open on an unrecognised direction or an unreadable neighbour.
 *
 * @param {import('@minecraft/server').Block} block the cell the map would fill
 * @param {string} facing the `minecraft:block_face` the map is being hung on
 * @returns {boolean}
 */
function canHangHere(block, facing) {
  const offset = SUPPORT_OFFSET[facing.toLowerCase()];
  if (!offset) return true;

  try {
    const support = block.offset(offset);
    if (support === undefined) return true;
    return !support.isAir && !support.isLiquid;
  } catch {
    return true;
  }
}

/**
 * Breaks an unsupported map, dropping it where it stood.
 *
 * @param {import('@minecraft/server').Block} block
 */
function collapse(block) {
  const dimension = block.dimension;
  const centre = { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 };

  // Dropped before the block is cleared, so a failure to clear leaves the
  // player an extra item rather than none.
  try {
    dimension.spawnItem(new ItemStack(WAR_MAP_BLOCK, 1), centre);
  } catch (err) {
    console.warn(`[sigil] could not drop the war map at ${block.x},${block.y},${block.z}: ${err}`);
  }

  block.setType('minecraft:air');

  try {
    dimension.playSound('dig.wood', centre);
  } catch {
    // A missing sound is not worth a warning; the block still came down.
  }
}

/**
 * Registers the block's behaviour. Called during `system.beforeEvents.startup`,
 * which is the only point the registry accepts.
 *
 * @param {import('@minecraft/server').BlockComponentRegistry} registry
 */
export function register(registry) {
  try {
    registry.registerCustomComponent(WAR_MAP_COMPONENT, {
      beforeOnPlayerPlace: (event) => {
        // `face` is the face being built against, so a downward one means the
        // map is being hung from a ceiling. There is no ceiling geometry and no
        // support direction for one.
        if (event.face === Direction.Down) {
          event.cancel = true;
          return;
        }
        // Refused here rather than dropped a second later; the tick below
        // still catches support that disappears afterwards.
        if (!canHangHere(event.block, String(event.face))) event.cancel = true;
      },
      onPlayerInteract: (event) => {
        const player = event.player;
        if (player) openWarScreen(player);
      },
      onTick: (event) => {
        if (!isSupported(event.block)) collapse(event.block);
      },
    });
  } catch (err) {
    // Without the component the block still places and still opens its screen
    // through the world event below, but will not fall when its wall does.
    console.warn(`[sigil] could not register the war map component: ${err}`);
  }
}

/**
 * Makes a placed map absorb the interaction rather than let it through.
 *
 * Stops a held item being placed over the map, and doubles as the interaction
 * path when the block component registry did not take the registration above.
 */
export function subscribeInteractionGuard() {
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.block.typeId !== WAR_MAP_BLOCK) return;
    // Sneak to build against the map instead of using it, as with any other
    // interactive block.
    if (event.player.isSneaking) return;

    // Cancels whatever was in hand, including nothing.
    event.cancel = true;

    // The press repeats while the button is held; only the first opens a form.
    if (!event.isFirstEvent) return;
    const player = event.player;
    system.run(() => openWarScreen(player));
  });
}
