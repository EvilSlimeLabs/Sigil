// @ts-check
/**
 * Rendering a player's identity: the floating nametag above their head, and
 * their name in chat.
 *
 * ── This is the only file in the add-on that touches a beta API. ───────────
 *
 * `@minecraft/server` 2.9.0 (the current stable) contains no chat API at all —
 * no `chatSend` event, no chat name properties. Formatting chat is therefore
 * impossible on stable, and the requirement cannot be met without beta.
 *
 * The beta surface used is the smallest one that does the job:
 * `Player.chatNamePrefix`, a single additive property. It is preferred over
 * `world.beforeEvents.chatSend` because that route means cancelling the real
 * chat message and re-broadcasting a replacement, which throws away native
 * chat behaviour and breaks chat outright if the handler ever fails. A missing
 * property, by contrast, just means an unprefixed name.
 *
 * Detection happens on the first player seen and degrades in three tiers:
 *
 *   1. `chatNamePrefix` present             -> use it
 *   2. else `beforeEvents.chatSend` present -> cancel and re-broadcast
 *   3. else                                 -> no chat formatting
 *
 * Under tier 3 every other feature — clans, roles, invites, wars, nametags,
 * the UI — still works. The nametag path below is entirely stable API and
 * never depends on any of this.
 *
 * ── Composition ───────────────────────────────────────────────────────────
 *
 * Both surfaces are assembled from the same four components — the system
 * title, the Peaceful marker, the clan, and the clan role — each with its own
 * configurable order. Building both from one list is what keeps "before the
 * name in the nametag, at the very start in chat" from drifting into two
 * unrelated pieces of formatting code.
 */

import { world, system } from '@minecraft/server';
import { C } from './config.js';
import { wrap } from './brackets.js';
import * as clans from './clans.js';
import * as staff from './staff.js';
import * as peaceful from './peaceful.js';
import * as settings from './settings.js';
import { onIdentityChanged } from './hooks.js';
import { TEXT } from './text.js';

/** @typedef {import('@minecraft/server').Player} Player */

/**
 * `unprobed` until a player exists to feature-detect against.
 *
 * @typedef {'unprobed' | 'property' | 'event' | 'none'} ChatMode
 */

/** @type {ChatMode} */
let chatMode = 'unprobed';

/** Last observed admin state per player id, so op changes can be detected. */
const lastAdminState = new Map();

/**
 * Renders a title according to its `showAs`: the symbol alone, the name alone,
 * or both.
 *
 * @param {{ symbol: string, name: string, color: string, showAs?: string }} title
 * @returns {string}
 */
function renderTitle(title) {
  const body =
    title.showAs === 'symbol'
      ? title.symbol
      : title.showAs === 'both'
        ? `${title.symbol} ${title.name}`
        : title.name;
  return `${title.color}${body}`;
}

/**
 * The system title for a player: Admin when they are an operator, otherwise
 * their staff role, or '' when they have neither.
 *
 * Admin wins over a staff role because a player can hold both and only one
 * title is drawn; being an operator is the stronger statement.
 *
 * @param {Player} player
 * @returns {string}
 */
export function systemTitle(player) {
  const config = settings.get().display;

  if (staff.isAdmin(player)) return renderTitle(config.admin);

  const role = staff.roleOf(player.id);
  if (!role) return '';
  return renderTitle({
    symbol: role.symbol,
    name: role.name,
    color: role.color,
    showAs: role.showAs ?? 'name',
  });
}

/**
 * The Peaceful marker, or '' when the player is not marked or it is hidden on
 * this surface.
 *
 * @param {Player} player
 * @param {'nametag' | 'chat'} surface
 * @returns {string}
 */
function peacefulMark(player, surface) {
  if (!peaceful.isPeaceful(player.id)) return '';
  if (!peaceful.visibleOn(surface)) return '';
  return renderTitle(settings.get().display.peaceful);
}

/**
 * Joins ordered components, dropping the empty ones.
 *
 * @param {Array<{ order: number, text: string }>} parts
 * @returns {string}
 */
function assemble(parts) {
  return parts
    .filter((part) => part.text !== '')
    .sort((a, b) => a.order - b.order)
    .map((part) => part.text)
    .join(' ');
}

/**
 * The clan line drawn under the player's name: the clan, and the role when it
 * is switched on, in the configured order and bracket styles.
 *
 * @param {string} playerId
 * @returns {string}
 */
function nameTagClanLine(playerId) {
  const clan = clans.clanOf(playerId);
  if (!clan) return '';

  const { nametag, colors } = settings.get().display;
  // Outposts read in the outpost colour, so the tier shows without spending a
  // whole component on it.
  const clanColor = clans.isOutpost(clan) ? colors.outpost : colors.clan;
  const clanPart = wrap(clan.name, nametag.clanBrackets, C.darkGray, clanColor);

  const role = clans.roleOf(clan, playerId);
  if (!nametag.showClanRole || role === '') return clanPart;

  const rolePart = wrap(role, nametag.roleBrackets, C.darkGray, colors.role);
  return nametag.rolePosition === 'after' ? `${clanPart} ${rolePart}` : `${rolePart} ${clanPart}`;
}

/**
 * The titles drawn before the player's name on the nametag.
 *
 * @param {Player} player
 * @returns {string}
 */
function nameTagTitles(player) {
  const { nametag } = settings.get().display;
  return assemble([
    { order: nametag.systemOrder, text: systemTitle(player) },
    { order: nametag.peacefulOrder, text: peacefulMark(player, 'nametag') },
  ]);
}

/**
 * Everything that precedes the player's name in chat.
 *
 * @param {Player} player
 * @returns {string}
 */
export function chatPrefixFor(player) {
  const { chat, colors } = settings.get().display;

  let clanPart = '';
  const clan = clans.clanOf(player.id);
  if (clan) {
    const clanColor = clans.isOutpost(clan) ? colors.outpost : colors.clan;
    const role = clans.roleOf(clan, player.id);
    const inner =
      chat.showClanRole && role !== ''
        ? `${clanColor}${clan.name}${C.darkGray}|${colors.role}${role}`
        : `${clanColor}${clan.name}`;
    clanPart = `${C.darkGray}[${inner}${C.darkGray}]`;
  }

  const assembled = assemble([
    { order: chat.systemOrder, text: systemTitle(player) },
    { order: chat.clanOrder, text: clanPart },
    { order: chat.peacefulOrder, text: peacefulMark(player, 'chat') },
  ]);

  return assembled === '' ? '' : `${assembled} ${C.reset}`;
}

/**
 * The full identity line, used in welcome messages and diagnostics.
 *
 * @param {Player} player
 * @returns {string}
 */
export function identityLine(player) {
  return `${chatPrefixFor(player)}${C.white}${player.name}`;
}

/**
 * Applies the nametag. Pure stable API.
 *
 * @param {Player} player
 */
function applyNameTag(player) {
  const titles = nameTagTitles(player);
  const firstLine = titles === '' ? player.name : `${titles} ${C.white}${player.name}`;
  const clanLine = nameTagClanLine(player.id);
  player.nameTag = clanLine === '' ? firstLine : `${firstLine}\n${clanLine}`;
}

/**
 * Chooses the chat strategy, using this player to feature-detect. Only does
 * work the first time it is called.
 *
 * @param {Player} player
 */
function ensureChatMode(player) {
  if (chatMode !== 'unprobed') return;

  if ('chatNamePrefix' in player) {
    chatMode = 'property';
  } else if (subscribeChatFallback()) {
    chatMode = 'event';
  } else {
    chatMode = 'none';
    console.warn(
      '[sigil] no chat API available; clan tags will show on nametags only. ' +
        'Enable the "Beta APIs" experiment to format chat.',
    );
  }
}

/**
 * Applies the chat prefix, if the running game supports one.
 *
 * @param {Player} player
 */
function applyChatPrefix(player) {
  ensureChatMode(player);
  if (chatMode !== 'property') return;

  const prefix = chatPrefixFor(player);
  // Clearing the prefix is an explicit `undefined`, not an empty string.
  player.chatNamePrefix = prefix === '' ? undefined : prefix;
}

/**
 * Tier 2 fallback: cancel the native message and re-broadcast it with the
 * prefix applied. Only reached when `chatNamePrefix` is unavailable.
 *
 * @returns {boolean} whether the fallback could be installed
 */
function subscribeChatFallback() {
  const beforeEvents = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (world.beforeEvents)
  );
  if (!('chatSend' in beforeEvents)) return false;

  world.beforeEvents.chatSend.subscribe((event) => {
    const prefix = chatPrefixFor(event.sender);
    if (prefix === '') return; // Nothing to add; leave the native message alone.

    event.cancel = true;
    const line = `${prefix}${C.white}${event.sender.name}${C.gray}: ${C.reset}${event.message}`;
    // A before-event handler runs in restricted-execution mode, so the
    // replacement has to be sent from the next tick rather than inline.
    system.run(() => world.sendMessage(line));
  });
  return true;
}

/**
 * Re-renders a player's identity everywhere it appears.
 *
 * @param {Player} player
 */
export function refresh(player) {
  try {
    applyNameTag(player);
    applyChatPrefix(player);
    lastAdminState.set(player.id, staff.isAdmin(player));
  } catch (err) {
    console.warn(`[sigil] could not refresh display for ${player.name}: ${err}`);
  }
}

/**
 * Re-renders a player by id, if they happen to be online. Offline players are
 * rendered on their next join, so nothing is lost.
 *
 * @param {string} playerId
 */
export function refreshById(playerId) {
  const player = world.getAllPlayers().find((p) => p.id === playerId);
  if (player) refresh(player);
}

/**
 * Re-renders every online player. Used after a settings or staff-role change,
 * which can affect many players at once.
 */
export function refreshAll() {
  for (const player of world.getAllPlayers()) refresh(player);
}

/**
 * Re-checks operator status and re-renders anyone whose admin state changed.
 *
 * Bedrock raises no event when a player is opped or de-opped, so this is
 * polled. The check is one enum comparison per online player.
 */
export function pollAdminChanges() {
  for (const player of world.getAllPlayers()) {
    if (lastAdminState.get(player.id) !== staff.isAdmin(player)) {
      refresh(player);
    }
  }
}

/**
 * The run id of the active poll, so it can be cancelled and re-registered.
 *
 * @type {number | undefined}
 */
let pollRunId;

/**
 * Starts — or restarts — the operator-status poll at the configured interval.
 *
 * `system.runInterval` has no way to change its period after registration, so
 * a settings change is applied by cancelling the existing run and registering a
 * new one. Without this, a new interval would only take effect at the next
 * world load.
 */
export function restartAdminPolling() {
  if (pollRunId !== undefined) system.clearRun(pollRunId);
  pollRunId = system.runInterval(pollAdminChanges, settings.opPollIntervalTicks());
}

/**
 * Forgets cached state for a departed player.
 *
 * @param {string} playerId
 */
export function forget(playerId) {
  lastAdminState.delete(playerId);
}

/**
 * Human-readable description of the active chat strategy, for the start-up log
 * and admin diagnostics.
 *
 * @returns {string}
 */
export function chatStatus() {
  switch (chatMode) {
    case 'property':
      return TEXT.status.chatTagsActivePlayerChatnameprefix;
    case 'event':
      return TEXT.status.chatTagsActiveChatsendFallback;
    case 'unprobed':
      return TEXT.status.chatSupportNotYetDetermined;
    default:
      return TEXT.status.chatTagsUnavailableEnableThe;
  }
}

// Any domain change to a player's clan, role or staff rank re-renders them.
onIdentityChanged(refreshById);
