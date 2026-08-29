// @ts-check
/**
 * Clan invites: the consent step between "an owner wants you" and "you are a
 * member".
 *
 * Invites are stored on the **invitee**, keyed by their player id, because the
 * hot read is "what am I being offered?" — one property fetch, no scanning.
 *
 * Expiry is lazy. Nothing sweeps the store on a timer; every read prunes what
 * has aged out and writes back only if something actually changed. An invite
 * that is never read simply never costs anything.
 *
 * Validity is re-checked at accept time, not at receipt: between an invite
 * being sent and accepted the clan may have been disbanded, filled up, or the
 * invitee may have joined somewhere else.
 */

import { KEY, LIMITS, INVITE_TTL_SECONDS } from './config.js';
import { getJson, setJson, remove, now, idsWithPrefix } from './storage.js';
import * as clans from './clans.js';
import * as players from './players.js';
import { TEXT } from './text.js';

/**
 * @typedef {object} Invite
 * @property {string} clanId
 * @property {string} clanName  cached so the list renders without loading clans
 * @property {string} byId      the inviting player
 * @property {string} byName
 * @property {number} at        unix seconds, when it was sent
 * @property {number} expiresAt unix seconds
 */

/**
 * @template T
 * @typedef {import('./format.js').Result<T>} Result
 */

/**
 * Reads a player's pending invites, dropping any that have expired.
 *
 * @param {string} playerId
 * @returns {Invite[]}
 */
export function pendingFor(playerId) {
  /** @type {Invite[]} */
  const stored = getJson(KEY.invites + playerId, /** @type {Invite[]} */ ([]));
  if (stored.length === 0) return [];

  const current = now();
  return stored.filter((invite) => invite.expiresAt > current);
}

/**
 * Drops expired invites from storage.
 *
 * Reading is pure: `pendingFor` filters but never writes, because it runs on
 * paths as hot as chat prefixing and a read that writes is a poor neighbour.
 * Pruning happens at the few points where something was going to be written
 * anyway — a join, an accept, a decline.
 *
 * @param {string} playerId
 */
export function prune(playerId) {
  const key = KEY.invites + playerId;
  /** @type {Invite[]} */
  const stored = getJson(key, /** @type {Invite[]} */ ([]));
  if (stored.length === 0) return;

  const current = now();
  const live = stored.filter((invite) => invite.expiresAt > current);
  if (live.length === stored.length) return;

  if (live.length === 0) remove(key);
  else setJson(key, live);
}

/**
 * @param {string} playerId
 * @param {Invite[]} invites
 */
function save(playerId, invites) {
  if (invites.length === 0) remove(KEY.invites + playerId);
  else setJson(KEY.invites + playerId, invites);
}

/**
 * Discards every pending invite for a player. Called on accept, and whenever
 * they join a clan by any route.
 *
 * @param {string} playerId
 */
export function clearAll(playerId) {
  remove(KEY.invites + playerId);
}

/**
 * Withdraws one clan's invite to one player.
 *
 * @param {string} inviteeId
 * @param {string} clanId
 */
export function revoke(inviteeId, clanId) {
  const remaining = pendingFor(inviteeId).filter((i) => i.clanId !== clanId);
  save(inviteeId, remaining);
}

/**
 * Withdraws every outstanding invite to a clan, wherever it is pending.
 *
 * Invites are indexed by invitee, so this is the one operation that has to
 * scan. It runs only on disband, and only over players who actually hold a
 * pending invite — an empty inbox stores no property at all.
 *
 * @param {string} clanId
 * @returns {number} how many invites were withdrawn
 */
export function revokeAllForClan(clanId) {
  let withdrawn = 0;
  for (const key of idsWithPrefix(KEY.invites)) {
    const inviteeId = key.slice(KEY.invites.length);
    const pending = pendingFor(inviteeId);
    const remaining = pending.filter((i) => i.clanId !== clanId);
    if (remaining.length !== pending.length) {
      withdrawn += pending.length - remaining.length;
      save(inviteeId, remaining);
    }
  }
  return withdrawn;
}

/**
 * Issues an invite from a clan to a player.
 *
 * @param {import('./clans.js').Clan} clan
 * @param {{ id: string, name: string }} from the inviting player
 * @param {{ id: string, name: string }} to   the invitee
 * @returns {Result<Invite>}
 */
export function invite(clan, from, to) {
  if (to.id === from.id) {
    return { ok: false, error: TEXT.invite.youCannotInviteYourself };
  }
  // Checked in the domain rather than in each caller: the picker filters
  // visitors out of its list, but `/clan:invite` takes a player selector and
  // would otherwise walk straight past that filter.
  if (players.isKnownVisitor(to.id)) {
    return { ok: false, error: TEXT.invite.cannotInviteAVisitor(to.name) };
  }
  if (clans.isMember(clan, to.id)) {
    return { ok: false, error: TEXT.invite.isAlreadyIn(to.name, clan.name) };
  }
  if (clans.clanOf(to.id)) {
    return { ok: false, error: TEXT.invite.isAlreadyInAnotherClan(to.name) };
  }
  if (clans.isFull(clan)) {
    return { ok: false, error: TEXT.invite.isFullMembers(clan.name, clans.capacity(clan)) };
  }

  const pending = pendingFor(to.id);
  if (pending.some((i) => i.clanId === clan.id)) {
    return { ok: false, error: TEXT.invite.alreadyHasAPendingInvite(to.name, clan.name) };
  }

  const timestamp = now();
  /** @type {Invite} */
  const created = {
    clanId: clan.id,
    clanName: clan.name,
    byId: from.id,
    byName: from.name,
    at: timestamp,
    expiresAt: timestamp + INVITE_TTL_SECONDS,
  };

  // Keep the newest invites when a player is at the cap, so a spammed inbox
  // cannot lock out a fresh offer.
  const next = [...pending, created].slice(-LIMITS.maxPendingInvites);
  save(to.id, next);

  return { ok: true, value: created };
}

/**
 * Withdraws every invite a particular player sent. Used when purging them, so
 * their offers do not outlive their presence in the system.
 *
 * @param {string} senderId
 * @returns {number} how many invites were withdrawn
 */
export function revokeAllFrom(senderId) {
  let withdrawn = 0;
  for (const key of idsWithPrefix(KEY.invites)) {
    const inviteeId = key.slice(KEY.invites.length);
    const pending = pendingFor(inviteeId);
    const remaining = pending.filter((i) => i.byId !== senderId);
    if (remaining.length !== pending.length) {
      withdrawn += pending.length - remaining.length;
      save(inviteeId, remaining);
    }
  }
  return withdrawn;
}

/**
 * Finds a pending invite by clan name, for the optional argument on
 * `/clan:accept` and `/clan:deny`.
 *
 * @param {string} playerId
 * @param {string} clanName
 * @returns {Invite | undefined}
 */
export function findByClanName(playerId, clanName) {
  const key = clanName.trim().toLowerCase();
  return pendingFor(playerId).find((i) => i.clanName.toLowerCase() === key);
}

/**
 * Accepts an invite and joins the clan.
 *
 * Every condition is re-checked here, because an invite is a snapshot of a
 * world state that may have moved on since it was sent.
 *
 * @param {{ id: string, name: string }} player
 * @param {Invite} pendingInvite
 * @returns {Result<import('./clans.js').Clan>}
 */
export function accept(player, pendingInvite) {
  prune(player.id);
  const stillPending = pendingFor(player.id).some(
    (i) => i.clanId === pendingInvite.clanId && i.at === pendingInvite.at,
  );
  if (!stillPending) {
    return { ok: false, error: TEXT.invite.thatInviteIsNoLonger };
  }

  if (clans.clanOf(player.id)) {
    return { ok: false, error: TEXT.invite.youAreAlreadyInA };
  }

  const clan = clans.getClan(pendingInvite.clanId);
  if (!clan) {
    revoke(player.id, pendingInvite.clanId);
    return { ok: false, error: TEXT.invite.noLongerExists(pendingInvite.clanName) };
  }

  const added = clans.addMember(clan.id, player.id, player.name);
  if (!added.ok) return added;

  // A player belongs to one clan, so every other offer is now moot.
  clearAll(player.id);
  return { ok: true, value: clan };
}

/**
 * Declines an invite.
 *
 * @param {string} playerId
 * @param {Invite} pendingInvite
 * @returns {Result<string>} the declined clan's name
 */
export function decline(playerId, pendingInvite) {
  prune(playerId);
  const remaining = pendingFor(playerId).filter(
    (i) => !(i.clanId === pendingInvite.clanId && i.at === pendingInvite.at),
  );
  save(playerId, remaining);
  return { ok: true, value: pendingInvite.clanName };
}
