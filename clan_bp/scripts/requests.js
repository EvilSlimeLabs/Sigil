// @ts-check
/**
 * Clan-creation requests: the review step between "a player wants a clan" and
 * "a clan exists".
 *
 * Whether this step applies at all is a setting (`requireClanApproval`, on by
 * default). Admins always bypass it — their own creations are applied
 * immediately, as specified.
 *
 * The queue is one stored array rather than a property per request, because it
 * is read whole every time it is shown and is expected to hold a handful of
 * entries, not thousands.
 *
 * A requested name reserves nothing. It is checked when filed and **again** at
 * approval, because two players can file for the same name before either is
 * reviewed, and only the second check can catch that.
 */

import { KEY, LIMITS } from './config.js';
import { getJson, setJson, remove, now } from './storage.js';
import { validateClanName, normalizeKey } from './format.js';
import * as clans from './clans.js';
import * as settings from './settings.js';
import * as staff from './staff.js';
import { onClanDisbanded } from './hooks.js';
import { TEXT } from './text.js';

/**
 * @typedef {object} ClanRequest
 * @property {string} id
 * @property {string} kind           `create`, `promote` or `rename`
 * @property {string} [newName]      the proposed name, for `rename`
 * @property {string} [clanId]       the outpost being promoted, for `promote`
 * @property {string} name           the clan name, already sanitised
 * @property {string} requesterId
 * @property {string} requesterName
 * @property {number} at             unix seconds
 */

/**
 * @template T
 * @typedef {import('./format.js').Result<T>} Result
 */

/**
 * Whether a player may approve or deny clan-creation requests.
 *
 * Admins always may. A clan-managing staff role may too, unless an admin has
 * switched `staffCanApproveClans` off.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function canApprove(player) {
  if (staff.isAdmin(player)) return true;
  return settings.get().staffCanApproveClans && staff.roleOf(player.id)?.manageClans === true;
}

/**
 * Whether a player may approve outpost promotions. Tracked separately from
 * creation approval so an admin can delegate one without the other.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function canApprovePromotions(player) {
  if (staff.isAdmin(player)) return true;
  return settings.get().staffCanApprovePromotions && staff.roleOf(player.id)?.manageClans === true;
}

/**
 * Whether a player may act on a particular request.
 *
 * @param {import('@minecraft/server').Player} player
 * @param {ClanRequest} request
 * @returns {boolean}
 */
export function canApproveRequest(player, request) {
  return request.kind === 'promote' ? canApprovePromotions(player) : canApprove(player);
}

/**
 * Files a request to rename a clan.
 *
 * Renames go through the same queue as creations because they raise the same
 * question — is this name acceptable? — and a clan that could rename freely
 * would sidestep whatever review its original name went through.
 *
 * @param {{ id: string, name: string }} requester must be the clan's Leader
 * @param {import('./clans.js').Clan} clan
 * @param {string} rawName
 * @returns {Result<ClanRequest & { newName: string }>} a rename always carries
 *   the proposed name, which the shared request type can only mark optional
 */
export function fileRename(requester, clan, rawName) {
  if (!clans.isOwner(clan, requester.id)) {
    return { ok: false, error: TEXT.request.onlyTheLeaderCanRename };
  }

  const validated = validateClanName(rawName);
  if (!validated.ok) return validated;
  if (normalizeKey(validated.value) === normalizeKey(clan.name)) {
    return { ok: false, error: TEXT.request.isAlreadyCalledThat(clan.name) };
  }

  const queue = all();
  if (queue.some((request) => request.kind === 'rename' && request.clanId === clan.id)) {
    return { ok: false, error: TEXT.request.alreadyHasARenamePending(clan.name) };
  }

  const available = checkNameAvailable(validated.value);
  if (!available.ok) return available;

  if (queue.length >= LIMITS.maxPendingRequests) {
    return { ok: false, error: TEXT.request.theRequestQueueIsFull };
  }

  /** @type {ClanRequest} */
  const request = {
    id: newRequestId(),
    kind: 'rename',
    clanId: clan.id,
    name: clan.name,
    newName: validated.value,
    requesterId: requester.id,
    requesterName: requester.name,
    at: now(),
  };
  queue.push(request);
  save(queue);
  return { ok: true, value: { ...request, newName: validated.value } };
}

/**
 * Requests this player is allowed to review.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {ClanRequest[]}
 */
export function reviewableBy(player) {
  return all().filter((request) => canApproveRequest(player, request));
}

/**
 * Whether this player's clan creation needs review. Admins never do.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function approvalRequiredFor(player) {
  return settings.get().requireClanApproval && !staff.isAdmin(player);
}

/**
 * @returns {ClanRequest[]}
 */
export function all() {
  return getJson(KEY.requests, /** @type {ClanRequest[]} */ ([]));
}

/**
 * @param {ClanRequest[]} queue
 */
function save(queue) {
  if (queue.length === 0) remove(KEY.requests);
  else setJson(KEY.requests, queue);
}

/**
 * The pending request filed by a player, if any.
 *
 * @param {string} playerId
 * @returns {ClanRequest | undefined}
 */
export function forPlayer(playerId) {
  return all().find((request) => request.requesterId === playerId);
}

/**
 * @param {string} requestId
 * @returns {ClanRequest | undefined}
 */
export function byId(requestId) {
  return all().find((request) => request.id === requestId);
}

/**
 * Checks a name against both existing clans and the pending queue.
 *
 * @param {string} name
 * @param {string} [ignoreRequestId] a request allowed to hold this name
 * @returns {Result<string>}
 */
function checkNameAvailable(name, ignoreRequestId) {
  if (clans.clanByName(name)) {
    return { ok: false, error: TEXT.request.aClanNamedAlreadyExists(name) };
  }
  const key = normalizeKey(name);
  const clash = all().find(
    (request) => request.id !== ignoreRequestId && normalizeKey(request.name) === key,
  );
  if (clash) {
    return { ok: false, error: TEXT.request.isAlreadyRequestedBy(name, clash.requesterName) };
  }
  return { ok: true, value: name };
}

/**
 * Files a clan-creation request. Replaces the requester's previous request, so
 * a player who mistyped a name can simply file again.
 *
 * @param {{ id: string, name: string }} requester
 * @param {string} rawName
 * @returns {Result<ClanRequest>}
 */
export function file(requester, rawName) {
  if (clans.clanOf(requester.id)) {
    return { ok: false, error: TEXT.request.youAreAlreadyInA };
  }

  const validated = validateClanName(rawName);
  if (!validated.ok) return validated;

  const existing = forPlayer(requester.id);
  const available = checkNameAvailable(validated.value, existing?.id);
  if (!available.ok) return available;

  const queue = all().filter((request) => request.requesterId !== requester.id);
  if (queue.length >= LIMITS.maxPendingRequests) {
    return { ok: false, error: TEXT.request.theClanRequestQueueIs };
  }

  /** @type {ClanRequest} */
  const request = {
    id: newRequestId(),
    kind: 'create',
    name: validated.value,
    requesterId: requester.id,
    requesterName: requester.name,
    at: now(),
  };
  queue.push(request);
  save(queue);
  return { ok: true, value: request };
}

/**
 * @returns {string}
 */
function newRequestId() {
  return `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Files a promotion request for an outpost.
 *
 * The membership threshold is checked here rather than only in the UI, so the
 * command path and any future caller are held to the same rule.
 *
 * @param {{ id: string, name: string }} requester must be the outpost's Leader
 * @param {import('./clans.js').Clan} clan
 * @returns {Result<ClanRequest>}
 */
export function filePromotion(requester, clan) {
  if (!clans.isOutpost(clan)) {
    return { ok: false, error: TEXT.request.isAlreadyAFullClan(clan.name) };
  }
  if (!clans.isOwner(clan, requester.id)) {
    return { ok: false, error: TEXT.request.onlyTheLeaderCanRequest };
  }

  const needed = settings.promotionThreshold();
  const have = clans.memberCount(clan);
  if (have < needed) {
    return {
      ok: false,
      error: TEXT.request.needsMembersToRequestPromotion(clan.name, needed, have),
    };
  }

  const queue = all();
  if (queue.some((request) => request.kind === 'promote' && request.clanId === clan.id)) {
    return { ok: false, error: TEXT.request.alreadyHasAPromotionRequest(clan.name) };
  }
  if (queue.length >= LIMITS.maxPendingRequests) {
    return { ok: false, error: TEXT.request.theRequestQueueIsFull };
  }

  /** @type {ClanRequest} */
  const request = {
    id: newRequestId(),
    kind: 'promote',
    clanId: clan.id,
    name: clan.name,
    requesterId: requester.id,
    requesterName: requester.name,
    at: now(),
  };
  queue.push(request);
  save(queue);
  return { ok: true, value: request };
}

/**
 * Withdraws a request without creating anything.
 *
 * @param {string} requestId
 * @returns {Result<ClanRequest>}
 */
export function withdraw(requestId) {
  const request = byId(requestId);
  if (!request) return { ok: false, error: TEXT.request.thatRequestNoLongerExists };
  save(all().filter((entry) => entry.id !== requestId));
  return { ok: true, value: request };
}

/**
 * Approves a request and creates the clan, with the requester as its Leader.
 *
 * Everything is re-checked here: the requester may have joined a clan while
 * waiting, and another request for the same name may have been approved first.
 *
 * @param {string} requestId
 * @returns {Result<{ clan: import('./clans.js').Clan, request: ClanRequest }>}
 */
export function approve(requestId) {
  const request = byId(requestId);
  if (!request) return { ok: false, error: TEXT.request.thatRequestNoLongerExists };

  if (request.kind === 'rename') {
    const clan = request.clanId === undefined ? undefined : clans.getClan(request.clanId);
    if (!clan) {
      save(all().filter((entry) => entry.id !== requestId));
      return { ok: false, error: TEXT.request.noLongerExistsTheRequest(request.name) };
    }

    const renamed = clans.rename(clan.id, request.newName ?? '');
    if (!renamed.ok) return renamed;

    save(all().filter((entry) => entry.id !== requestId));
    return { ok: true, value: { clan: clans.getClan(clan.id) ?? clan, request } };
  }

  if (request.kind === 'promote') {
    const clan = request.clanId === undefined ? undefined : clans.getClan(request.clanId);
    if (!clan) {
      save(all().filter((entry) => entry.id !== requestId));
      return { ok: false, error: TEXT.request.noLongerExistsTheRequest(request.name) };
    }

    // Re-checked at approval: members can leave while a request waits, and a
    // promotion granted below the threshold would sidestep the rule entirely.
    const needed = settings.promotionThreshold();
    if (clans.memberCount(clan) < needed) {
      return {
        ok: false,
        error: TEXT.request.hasFallenBelowMembersAnd(clan.name, needed),
      };
    }

    const promoted = clans.promote(clan.id);
    if (!promoted.ok) return promoted;

    save(all().filter((entry) => entry.id !== requestId));
    return { ok: true, value: { clan: promoted.value, request } };
  }

  if (clans.clanOf(request.requesterId)) {
    save(all().filter((entry) => entry.id !== requestId));
    return {
      ok: false,
      error: TEXT.request.hasJoinedAClanSince(request.requesterName),
    };
  }

  const available = checkNameAvailable(request.name, requestId);
  if (!available.ok) return available;

  const created = clans.createClan(request.requesterId, request.requesterName, request.name);
  if (!created.ok) return created;

  save(all().filter((entry) => entry.id !== requestId));
  return { ok: true, value: { clan: created.value, request } };
}

/**
 * Denies a request.
 *
 * @param {string} requestId
 * @returns {Result<ClanRequest>}
 */
export function deny(requestId) {
  return withdraw(requestId);
}

/**
 * Drops any request filed by a player. Used when purging them from the system.
 *
 * @param {string} playerId
 */
export function dropFor(playerId) {
  const queue = all();
  const remaining = queue.filter((request) => request.requesterId !== playerId);
  if (remaining.length !== queue.length) save(remaining);
}

/**
 * Drops any request tied to a clan. Used when the clan is disbanded, so a
 * promotion request cannot outlive the outpost it refers to.
 *
 * @param {string} clanId
 */
export function dropForClan(clanId) {
  const queue = all();
  const remaining = queue.filter((request) => request.clanId !== clanId);
  if (remaining.length !== queue.length) save(remaining);
}

// A promotion request must not outlive the outpost it refers to.
onClanDisbanded((clanId) => {
  dropForClan(clanId);
});
