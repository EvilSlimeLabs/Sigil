// @ts-check
/**
 * The War Map block: what happens when a player uses it, and what happens when
 * the thing holding it up goes away.
 *
 * ── Why a custom component rather than only a world event ──────────────────
 *
 * `world.afterEvents.playerInteractWithBlock` fires when a player *uses an item
 * on* a block. A custom block the engine does not consider interactive absorbs
 * nothing from an empty hand, so right-clicking the map did nothing at all —
 * the only interaction that ever reached the handler was the one where the
 * player was holding another War Map and trying to place it, which is exactly
 * the behaviour that was reported.
 *
 * Registering `onPlayerInteract` is what tells the engine the block is worth
 * interacting with. Beside it, `world.beforeEvents.playerInteractWithBlock`
 * cancels the interaction outright, which is a second thing entirely: the map
 * has no collision box, so without it a painting, a torch or another block
 * held at the time is placed straight through the map instead of the map being
 * used. Cancelling makes the block swallow the press the way a chest does.
 *
 * Sneaking is exempt, because that is the vanilla way to say "build here, do
 * not interact", and a wall carrying a war map should not become a dead spot
 * where nothing can ever be placed.
 *
 * Both paths can describe one press, and {@link openWarScreen} de-duplicates,
 * so a game that delivers both does not open the screen twice.
 *
 * ── Why the ceiling is refused twice ───────────────────────────────────────
 *
 * The block declares `minecraft:placement_filter` with `allowed_faces` of
 * `["up", "side"]`, which should be the whole story — but maps were still going
 * up on ceilings in a live world. Rather than guess which of the placement
 * filter, the placement trait and the block-placer item is not honouring it,
 * `beforeOnPlayerPlace` refuses a downward face outright. The filter stays as
 * the declarative statement of intent; this is what actually enforces it.
 *
 * ── Why the map checks its own support ─────────────────────────────────────
 *
 * It hangs like a painting, so it should fall like one. Bedrock raises no
 * neighbour-changed event for scripts, so the block ticks slowly and asks
 * whether the surface it was mounted on is still there. Polling rather than
 * reacting means a map also comes down when its wall is removed by a command,
 * a piston or an explosion — cases a break handler would miss.
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
  // The X axis is the reverse of what the Z axis predicts. Maps hung on an
  // east or west face came out a block off their wall, which is what looking
  // for the support in the wrong direction produces. The geometry carries the
  // same reversal and the two have to agree: a panel drawn against the right
  // wall while this watched the opposite one would be torn down a second after
  // it was placed.
  west: { x: -1, y: 0, z: 0 },
  east: { x: 1, y: 0, z: 0 },
};

/**
 * Ticks a second interaction from the same player is ignored for.
 *
 * Both the custom component and the world event can describe one press. Ten
 * ticks is long enough to swallow the duplicate and far short of the time it
 * takes a player to deliberately use the map twice.
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
 * Whether the surface a placed map was mounted on is still there.
 *
 * Anything solid counts, which is the same rule paintings and item frames use:
 * the question is whether there is something to hang on, not what it is.
 *
 * @param {import('@minecraft/server').Block} block
 * @returns {boolean}
 */
function isSupported(block) {
  const face = block.permutation.getState('minecraft:block_face');
  const offset = SUPPORT_OFFSET[String(face ?? 'up')] ?? SUPPORT_OFFSET.up;

  const support = block.offset(offset);
  // An unloaded neighbour is not an absent one. Leaving the map alone until the
  // chunk is there is the difference between a slow check and a destructive one.
  if (support === undefined) return true;
  return support.isSolid;
}

/**
 * Breaks an unsupported map, dropping it where it stood.
 *
 * @param {import('@minecraft/server').Block} block
 */
function collapse(block) {
  const dimension = block.dimension;
  const centre = { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 };

  // Drop first: if setting the block fails, the player is up an item rather
  // than down a War Map with nothing to show for it.
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
        // `face` is the face of the block being built against, so a downward
        // one means the player is hanging the map from a ceiling. There is no
        // ceiling geometry and no support direction for it, and a map that
        // cannot be held up should not go up in the first place.
        if (event.face === Direction.Down) event.cancel = true;
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
    // The block still places and still opens its screen through the world
    // event below; it just will not fall when its wall does.
    console.warn(`[sigil] could not register the war map component: ${err}`);
  }
}

/**
 * Makes a placed map absorb the interaction rather than let it through.
 *
 * This is what stops a held item being placed over the map, and it doubles as
 * the interaction path for a game whose block component registry did not take
 * the registration above.
 */
export function subscribeInteractionGuard() {
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.block.typeId !== WAR_MAP_BLOCK) return;
    // Sneak to build against the map instead of using it, as with any other
    // interactive block.
    if (event.player.isSneaking) return;

    // Cancel whatever was in hand, including nothing: the map is the thing
    // being used, not the surface behind it.
    event.cancel = true;

    // The press repeats while the button is held; only the first opens a form.
    if (!event.isFirstEvent) return;
    const player = event.player;
    system.run(() => openWarScreen(player));
  });
}
