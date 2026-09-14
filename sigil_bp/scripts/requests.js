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

import { world } from '@minecraft/server';
import { KEY, LIMITS } from './config.js';
import { getJson, setJson, remove, now } from './storage.js';
import { validateClanName, normalizeKey, msg } from './format.js';
import * as clans from './clans.js';
import { onClanUnderstrength, onSettingsChanged } from './hooks.js';
import * as settings from './settings.js';
import * as staff from './staff.js';
import { onClanDisbanded } from './hooks.js';
import { TEXT } from './text.js';

/**
 * @typedef {object} ClanRequest
 * @property {string} id
 * @property {string} kind           `create`, `promote`, `demote` or `rename`
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
 * turned that power off on their role.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function canApprove(player) {
  if (staff.isAdmin(player)) return true;
  return staff.hasPower(player, 'approveClans');
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
  return staff.hasPower(player, 'approvePromotions');
}

/**
 * Whether a player may act on a particular request.
 *
 * @param {import('@minecraft/server').Player} player
 * @param {ClanRequest} request
 * @returns {boolean}
 */
export function canApproveRequest(player, request) {
  // A demotion is the same judgement as a promotion pointed the other way, so
  // it sits behind the same permission.
  return request.kind === 'promote' || request.kind === 'demote'
    ? canApprovePromotions(player)
    : canApprove(player);
}

/**
 * Files a demotion review for a clan that has fallen below the membership a
 * promotion needs.
 *
 * Raised by the system rather than by a player, so there is no requester to
 * name and no permission to check: it is a fact about the clan, noticed the
 * moment its roster shrinks. Filing is idempotent — a clan that loses three
 * members in a row is reviewed once, not three times.
 *
 * @param {import('./clans.js').Clan} clan
 * @returns {Result<ClanRequest>}
 */
export function fileDemotion(clan) {
  if (!clans.isUnderstrength(clan)) {
    return { ok: false, error: TEXT.request.notUnderstrength(clan.name) };
  }

  const queue = all();
  if (queue.some((request) => request.kind === 'demote' && request.clanId === clan.id)) {
    return { ok: false, error: TEXT.request.demotionAlreadyQueued(clan.name) };
  }
  if (queue.length >= LIMITS.maxPendingRequests) {
    return { ok: false, error: TEXT.request.queueFull };
  }

  /** @type {ClanRequest} */
  const request = {
    id: newRequestId(),
    kind: 'demote',
    clanId: clan.id,
    name: clan.name,
    requesterId: '',
    requesterName: TEXT.fragment.systemRaised,
    at: now(),
  };
  queue.push(request);
  save(queue);
  return { ok: true, value: request };
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
    return { ok: false, error: TEXT.common.notClanLeaderRename };
  }

  const validated = validateClanName(rawName);
  if (!validated.ok) return validated;
  if (normalizeKey(validated.value) === normalizeKey(clan.name)) {
    return { ok: false, error: TEXT.request.nameUnchanged(clan.name) };
  }

  const queue = all();
  if (queue.some((request) => request.kind === 'rename' && request.clanId === clan.id)) {
    return { ok: false, error: TEXT.request.renamePending(clan.name) };
  }

  const available = checkNameAvailable(validated.value);
  if (!available.ok) return available;

  if (queue.length >= LIMITS.maxPendingRequests) {
    return { ok: false, error: TEXT.request.queueFull };
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
 * Tells every online player who can review this request that it is waiting.
 *
 * Each kind gets its own wording: a promotion and a rename are not "requesting
 * a clan", and a reviewer reading a creation notice for a rename has to open
 * the queue to find out what actually happened.
 *
 * @param {ClanRequest} request
 */
export function notifyReviewers(request) {
  for (const reviewer of world.getAllPlayers()) {
    if (!canApproveRequest(reviewer, request)) continue;
    const notice =
      request.kind === 'promote'
        ? TEXT.request.reviewNoticePromote(request.requesterName, request.name)
        : request.kind === 'rename'
          ? TEXT.request.reviewNoticeRename(
              request.requesterName,
              request.name,
              request.newName ?? '',
            )
          : TEXT.request.reviewNoticeCreate(request.requesterName, request.name);
    reviewer.sendMessage(msg(notice));
  }
}

/**
 * Every pending demotion review.
 *
 * Demotions are kept apart from the rest of the queue everywhere they are read.
 * The others are all *requests* — a player asked for something and is waiting on
 * an answer — while a demotion is the system reporting a fact about a clan that
 * nobody asked for. Mixing them made the one screen answer two different
 * questions, and buried the reports among the asks.
 *
 * @returns {ClanRequest[]}
 */
export function demotions() {
  return all().filter((request) => request.kind === 'demote');
}

/**
 * Requests this player is allowed to review, demotions excluded.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {ClanRequest[]}
 */
export function reviewableBy(player) {
  return all().filter(
    (request) => request.kind !== 'demote' && canApproveRequest(player, request),
  );
}

/**
 * Pending demotions this player is allowed to review.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {ClanRequest[]}
 */
export function demotionsReviewableBy(player) {
  return canApprovePromotions(player) ? demotions() : [];
}

/**
 * How many items of either kind are waiting on this player. Used for the badge
 * on the front door, which speaks for both queues at once.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {number}
 */
export function pendingFor(player) {
  return reviewableBy(player).length + demotionsReviewableBy(player).length;
}

/**
 * Brings the demotion queue in line with the clans that actually exist.
 *
 * Filing is otherwise driven by a single event — a member leaving — which only
 * ever fires while the world is running. Two things happen outside that: the
 * promotion threshold is a setting, so raising it can strand clans below a line
 * that moved under them, and a roster can be edited by a command or another pack
 * between sessions. So this runs at start-up and on every settings write, and
 * settles both directions at once.
 *
 * Clearing matters as much as filing. A queued demotion for a clan that has
 * recruited back up, or that now sits above a lowered threshold, is a review
 * with nothing to decide, and leaving it there teaches reviewers to ignore the
 * queue.
 *
 * @returns {{ filed: number, cleared: number }}
 */
export function sweepDemotions() {
  let filed = 0;

  const stale = new Set(
    demotions()
      .filter((request) => {
        const clan = request.clanId === undefined ? undefined : clans.getClan(request.clanId);
        return !clan || !clans.isUnderstrength(clan);
      })
      .map((request) => request.id),
  );
  if (stale.size > 0) save(all().filter((request) => !stale.has(request.id)));

  for (const clan of clans.allClans()) {
    if (!clans.isUnderstrength(clan)) continue;
    if (fileDemotion(clan).ok) filed += 1;
  }

  return { filed, cleared: stale.size };
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
    return { ok: false, error: TEXT.clan.nameTaken(name) };
  }
  const key = normalizeKey(name);
  const clash = all().find(
    (request) => request.id !== ignoreRequestId && normalizeKey(request.name) === key,
  );
  if (clash) {
    return { ok: false, error: TEXT.request.nameRequestedByAnother(name, clash.requesterName) };
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
    return { ok: false, error: TEXT.request.alreadyInAClan };
  }

  const validated = validateClanName(rawName);
  if (!validated.ok) return validated;

  const existing = forPlayer(requester.id);
  const available = checkNameAvailable(validated.value, existing?.id);
  if (!available.ok) return available;

  const queue = all().filter((request) => request.requesterId !== requester.id);
  if (queue.length >= LIMITS.maxPendingRequests) {
    return { ok: false, error: TEXT.request.creationQueueFull };
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
    return { ok: false, error: TEXT.clan.alreadyAFullClan(clan.name) };
  }
  if (!clans.isOwner(clan, requester.id)) {
    return { ok: false, error: TEXT.request.onlyLeaderMayRequestPromotion };
  }

  const needed = settings.promotionThreshold();
  const have = clans.memberCount(clan);
  if (have < needed) {
    return {
      ok: false,
      error: TEXT.request.belowPromotionThreshold(clan.name, needed, have),
    };
  }

  const queue = all();
  if (queue.some((request) => request.kind === 'promote' && request.clanId === clan.id)) {
    return { ok: false, error: TEXT.request.promotionPending(clan.name) };
  }
  if (queue.length >= LIMITS.maxPendingRequests) {
    return { ok: false, error: TEXT.request.queueFull };
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
  if (!request) return { ok: false, error: TEXT.request.requestGone };
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
  if (!request) return { ok: false, error: TEXT.request.requestGone };

  if (request.kind === 'rename') {
    const clan = request.clanId === undefined ? undefined : clans.getClan(request.clanId);
    if (!clan) {
      save(all().filter((entry) => entry.id !== requestId));
      return { ok: false, error: TEXT.request.clanGoneRequestDropped(request.name) };
    }

    const renamed = clans.rename(clan.id, request.newName ?? '');
    if (!renamed.ok) return renamed;

    save(all().filter((entry) => entry.id !== requestId));
    return { ok: true, value: { clan: clans.getClan(clan.id) ?? clan, request } };
  }

  if (request.kind === 'demote') {
    const clan = request.clanId === undefined ? undefined : clans.getClan(request.clanId);
    if (!clan) {
      save(all().filter((entry) => entry.id !== requestId));
      return { ok: false, error: TEXT.request.clanGoneRequestDropped(request.name) };
    }

    // Re-checked at approval, exactly as promotion is: a clan can recruit back
    // up to strength while the review waits, and demoting it then would punish
    // it for a gap it has already closed.
    if (!clans.isUnderstrength(clan)) {
      return { ok: false, error: TEXT.request.recoveredStrength(clan.name) };
    }

    const demoted = clans.demote(clan.id);
    if (!demoted.ok) return demoted;

    save(all().filter((entry) => entry.id !== requestId));
    return { ok: true, value: { clan: demoted.value, request } };
  }

  if (request.kind === 'promote') {
    const clan = request.clanId === undefined ? undefined : clans.getClan(request.clanId);
    if (!clan) {
      save(all().filter((entry) => entry.id !== requestId));
      return { ok: false, error: TEXT.request.clanGoneRequestDropped(request.name) };
    }

    // Re-checked at approval: members can leave while a request waits, and a
    // promotion granted below the threshold would sidestep the rule entirely.
    const needed = settings.promotionThreshold();
    if (clans.memberCount(clan) < needed) {
      return {
        ok: false,
        error: TEXT.request.fellBelowThreshold(clan.name, needed),
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
      error: TEXT.request.requesterJoinedAClan(request.requesterName),
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

// A clan that drops below strength is put in front of a reviewer rather than
// demoted on the spot. `fileDemotion` refuses a duplicate, so a clan that loses
// several members in a row is reviewed once.
onClanUnderstrength((clanId) => {
  const clan = clans.getClan(clanId);
  if (clan) fileDemotion(clan);
});

// The threshold that decides "understrength" is itself a setting, so saving the
// settings can create or resolve reviews without a single member moving.
onSettingsChanged(() => {
  sweepDemotions();
});
