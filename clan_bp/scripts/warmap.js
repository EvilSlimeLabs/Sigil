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
 * has no collision box, so without it a torch or another block held at the time
 * is placed straight through the map instead of the map being used. Cancelling
 * makes the block swallow the press the way a chest does.
 *
 * ── Why the walls collide and the floor does not ───────────────────────────
 *
 * A painting will not expand over a block the game reads as physically present,
 * and three builds were spent finding what it reads. A one-pixel selection box
 * tracing the panel is not enough — that is what the map first shipped with, and
 * paintings sized themselves straight over it. A collision box is enough, but
 * applied to every facing it costs the map the one quality an item frame most
 * obviously has: being a thing you walk through. A full 1x1x1 selection box also
 * works and costs nothing but an outline much larger than the panel, which is
 * ugly enough to have been rejected.
 *
 * So `blocks/war_map.json` splits it by facing. Paintings only ever hang on
 * walls, so the four wall permutations carry a one-pixel collision box laid
 * exactly over the panel — flush against the wall, where that wall's own
 * collision stops the player a pixel later and this one is never what they feel.
 * The floor variant has no collision at all and is walked straight over. Every
 * selection box traces its own panel, so the outline always follows the map.
 *
 * Sneaking is exempt, because that is the vanilla way to say "build here, do
 * not interact", and a wall carrying a war map should not become a dead spot
 * where nothing can ever be placed.
 *
 * Both paths can describe one press, and {@link openWarScreen} de-duplicates,
 * so a game that delivers both does not open the screen twice.
 *
 * ── Why placement is policed here rather than declared ─────────────────────
 *
 * The block used to carry `minecraft:placement_filter` with `allowed_faces` of
 * `["up", "side"]`. That component refuses any face it does not consider a full
 * one, so a map could not be hung on a top slab or the flat side of a staircase
 * — surfaces an item frame accepts without complaint. It has been removed, and
 * both rules it was carrying are enforced below instead: `beforeOnPlayerPlace`
 * refuses a downward face, and the tick below refuses to keep a map with
 * nothing behind it.
 *
 * The filter had also been quietly doing the pop-off for us — it drops a block
 * whose conditions stop holding. Losing that costs nothing, because the support
 * check was already here and already the thing being relied on.
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
  // The X axis does not follow the Z axis, and these two offsets do not follow
  // the geometry either. A map hung on an east or west face renders against the
  // wall when its panel is authored on the *opposite* side to the wall, so the
  // model and this table disagree by design: the model says where the map is
  // drawn, this says where the block holding it up actually is. Setting them to
  // agree is what tore maps down a second after they were placed.
  west: { x: 1, y: 0, z: 0 },
  east: { x: -1, y: 0, z: 0 },
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
 * Whether a placed map still has its support.
 *
 * Deliberately looser than the test placement uses, and the asymmetry is the
 * point: this only has to notice the support being *removed*. Asking
 * `canPlace` here would be wrong twice over — the map's own cell is occupied by
 * the map, which is not a valid placement, so every map would be destroyed on
 * its first tick.
 *
 * A check that is more permissive than placement can only ever spare something
 * placement already allowed. The reverse — a tick stricter than placement —
 * would quietly delete blocks the game let you put down, which is the failure
 * worth designing against.
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
 * Anything that is not air and not liquid. That is as permissive as it sounds,
 * and it is on purpose: paintings and item frames were tested against the same
 * surfaces and turned out to accept nearly everything, so matching them means
 * being loose rather than clever. A player who wants a map on a torch can have
 * one.
 *
 * This went through two stricter answers first, recorded so they are not
 * retried. `isSolid` means a *full cube* and refuses stairs, top slabs, glass,
 * trapdoors, scaffolding and composters. Asking `Block.canPlace` about an item
 * frame is exactly right in principle and simply is not needed, now that the
 * rule being matched is "almost anything".
 *
 * Fails open on an unrecognised direction or an unreadable neighbour: a block
 * that refuses to place is a worse bug than one that places somewhere odd.
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
        if (event.face === Direction.Down) {
          event.cancel = true;
          return;
        }
        // Refuse now rather than drop a second later. The tick below is still
        // the safety net for support that disappears afterwards, but a map that
        // could never have stayed should not appear at all.
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
