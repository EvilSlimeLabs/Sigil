// @ts-check
/**
 * The clan domain: creation, membership, roles, leadership and disbanding.
 *
 * Two invariants are enforced here rather than trusted to callers:
 *
 *  1. The owner is always a member, and their role is always `Leader`. The
 *     stored role on the owner's member record is ignored, so no sequence of
 *     edits can leave a clan whose owner is not the Leader.
 *  2. The three indexes (`clan:index`, `clan:nm:*`, `clan:pm:*`) are only ever
 *     written alongside the clan record they describe, by the functions below.
 *
 * Permission checks live in the command and UI layers. Functions here assume
 * the caller has already established the right to act.
 *
 * **Every mutator takes a clan id, never a clan object, and re-reads the record
 * itself.** A form can sit open for minutes, and a caller that fetched a clan
 * before showing one would write a stale copy back afterwards — silently
 * erasing anyone who joined in the meantime. Taking an id makes that mistake
 * impossible to write rather than merely easy to avoid.
 */

import { KEY, LIMITS, LEADER_ROLE, TIER } from './config.js';
import { getString, setString, remove, getJson, setJson, setJsonGuarded, now } from './storage.js';
import { normalizeKey, validateClanName, validateRoleName } from './format.js';
import { identityChanged, clanDisbanded } from './hooks.js';
import { TEXT } from './text.js';

/**
 * @typedef {object} ClanMember
 * @property {string} name     last-known display name, refreshed opportunistically
 * @property {string} role     clan role, or '' for none; ignored for the owner
 * @property {number} joinedAt unix seconds
 */

/**
 * @typedef {object} Clan
 * @property {string} id
 * @property {string} name
 * @property {string} ownerId
 * @property {number} createdAt
 * @property {Record<string, ClanMember>} members keyed by player id
 * @property {string[]} roles the clan's palette of role names
 * @property {string} tier `outpost` until promoted, then `clan`
 */

/**
 * @template T
 * @typedef {import('./format.js').Result<T>} Result
 */

/**
 * @returns {string} a short, collision-resistant clan id
 */
function generateId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `c_${Date.now().toString(36)}${rand}`;
}

/**
 * @param {string} clanId
 * @returns {Clan | undefined}
 */
export function getClan(clanId) {
  const clan = getJson(KEY.clan + clanId, /** @type {Clan | null} */ (null));
  if (!clan || typeof clan.id !== 'string' || !clan.members) return undefined;
  // Records written before tiers existed default to outpost rather than
  // reading as undefined and failing every tier comparison.
  if (clan.tier !== TIER.clan && clan.tier !== TIER.outpost) clan.tier = TIER.outpost;
  return clan;
}

/**
 * Whether a clan is still an outpost.
 *
 * @param {Clan} clan
 * @returns {boolean}
 */
export function isOutpost(clan) {
  return clan.tier !== TIER.clan;
}

/**
 * Promotes an outpost to a full clan. Callers check eligibility and permission;
 * this only enforces that a full clan cannot be promoted twice.
 *
 * @param {string} clanId
 * @returns {Result<Clan>}
 */
export function promote(clanId) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };
  if (!isOutpost(clan)) {
    return { ok: false, error: TEXT.clan.isAlreadyAFullClan(clan.name) };
  }

  clan.tier = TIER.clan;
  saveClan(clan);

  // The tag colour encodes the tier, so every member's display is now stale.
  for (const id of Object.keys(clan.members)) identityChanged(id);
  return { ok: true, value: clan };
}

/**
 * @param {Clan} clan
 */
function saveClan(clan) {
  setJsonGuarded(KEY.clan + clan.id, clan);
}

/**
 * @returns {string[]}
 */
export function clanIds() {
  return getJson(KEY.clanIndex, /** @type {string[]} */ ([]));
}

/**
 * Every clan, ordered by name.
 *
 * @returns {Clan[]}
 */
export function allClans() {
  const clans = clanIds()
    .map(getClan)
    .filter(/** @returns {c is Clan} */ (c) => c !== undefined);
  clans.sort((a, b) => a.name.localeCompare(b.name));
  return clans;
}

/**
 * The clan a player belongs to, if any.
 *
 * @param {string} playerId
 * @returns {Clan | undefined}
 */
export function clanOf(playerId) {
  const clanId = getString(KEY.playerClan + playerId);
  if (clanId === undefined) return undefined;

  const clan = getClan(clanId);
  // A disagreement between record and index reads as "no clan"; repairing it
  // is `reconcile`'s job. This runs on every chat prefix and nametag refresh,
  // and a read that writes is a poor neighbour on a path that hot.
  if (!clan || !clan.members[playerId]) return undefined;
  return clan;
}

/**
 * Repairs a player's clan index if it points at a clan that no longer holds
 * them. Called on join, where a write is expected anyway.
 *
 * @param {string} playerId
 * @returns {boolean} whether anything was repaired
 */
export function reconcile(playerId) {
  const clanId = getString(KEY.playerClan + playerId);
  if (clanId === undefined) return false;

  const clan = getClan(clanId);
  if (clan && clan.members[playerId]) return false;

  remove(KEY.playerClan + playerId);
  return true;
}

/**
 * @param {string} name
 * @returns {Clan | undefined}
 */
export function clanByName(name) {
  const clanId = getString(KEY.clanName + normalizeKey(name));
  return clanId === undefined ? undefined : getClan(clanId);
}

/**
 * @param {Clan} clan
 * @param {string} playerId
 * @returns {boolean}
 */
export function isOwner(clan, playerId) {
  return clan.ownerId === playerId;
}

/**
 * @param {Clan} clan
 * @param {string} playerId
 * @returns {boolean}
 */
export function isMember(clan, playerId) {
  return clan.members[playerId] !== undefined;
}

/**
 * The role a member holds. Always `Leader` for the owner, whatever is stored.
 *
 * @param {Clan} clan
 * @param {string} playerId
 * @returns {string} '' when the member holds no role
 */
export function roleOf(clan, playerId) {
  if (clan.ownerId === playerId) return LEADER_ROLE;
  return clan.members[playerId]?.role ?? '';
}

/**
 * Members sorted for display: owner first, then roled members, then the rest,
 * each group alphabetical.
 *
 * @param {Clan} clan
 * @returns {Array<{ id: string, member: ClanMember, role: string }>}
 */
export function memberList(clan) {
  const rows = Object.entries(clan.members).map(([id, member]) => ({
    id,
    member,
    role: roleOf(clan, id),
  }));
  rows.sort((a, b) => {
    if (a.id === clan.ownerId) return -1;
    if (b.id === clan.ownerId) return 1;
    const aRoled = a.role ? 0 : 1;
    const bRoled = b.role ? 0 : 1;
    if (aRoled !== bRoled) return aRoled - bRoled;
    return a.member.name.localeCompare(b.member.name);
  });
  return rows;
}

/**
 * @param {Clan} clan
 * @returns {number}
 */
export function memberCount(clan) {
  return Object.keys(clan.members).length;
}

/**
 * @param {Clan} clan
 * @returns {boolean}
 */
export function isFull(clan) {
  return memberCount(clan) >= LIMITS.maxMembersPerClan;
}

/**
 * Creates a clan owned by the given player.
 *
 * @param {string} ownerId
 * @param {string} ownerName
 * @param {string} rawName
 * @returns {Result<Clan>}
 */
export function createClan(ownerId, ownerName, rawName) {
  if (clanOf(ownerId)) {
    return { ok: false, error: TEXT.clan.youAreAlreadyInA };
  }

  const validated = validateClanName(rawName);
  if (!validated.ok) return validated;
  const name = validated.value;

  if (getString(KEY.clanName + normalizeKey(name)) !== undefined) {
    return { ok: false, error: TEXT.clan.aClanNamedAlreadyExists(name) };
  }

  const timestamp = now();
  /** @type {Clan} */
  const clan = {
    id: generateId(),
    name,
    ownerId,
    createdAt: timestamp,
    members: { [ownerId]: { name: ownerName, role: '', joinedAt: timestamp } },
    roles: [],
    // Every clan starts as an outpost. Promotion is the only way out of that,
    // including for clans an admin creates.
    tier: TIER.outpost,
  };

  saveClan(clan);
  setJson(KEY.clanIndex, [...clanIds(), clan.id]);
  setString(KEY.clanName + normalizeKey(name), clan.id);
  setString(KEY.playerClan + ownerId, clan.id);

  identityChanged(ownerId);
  return { ok: true, value: clan };
}

/**
 * Adds a player to a clan. Consent is the invite layer's job; by the time this
 * runs the player has already accepted.
 *
 * @param {string} clanId
 * @param {string} playerId
 * @param {string} playerName
 * @returns {Result<Clan>}
 */
export function addMember(clanId, playerId, playerName) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };
  if (isMember(clan, playerId)) {
    return { ok: false, error: TEXT.clan.isAlreadyIn(playerName, clan.name) };
  }
  if (clanOf(playerId)) {
    return { ok: false, error: TEXT.clan.isAlreadyInAnotherClan(playerName) };
  }
  if (isFull(clan)) {
    return { ok: false, error: TEXT.clan.isFullMembers(clan.name, LIMITS.maxMembersPerClan) };
  }

  clan.members[playerId] = { name: playerName, role: '', joinedAt: now() };
  saveClan(clan);
  setString(KEY.playerClan + playerId, clan.id);

  identityChanged(playerId);
  return { ok: true, value: clan };
}

/**
 * Removes a member. The owner cannot be removed — leadership must move or the
 * clan must be disbanded, which keeps invariant 1 intact.
 *
 * @param {string} clanId
 * @param {string} playerId
 * @returns {Result<string>} the removed member's name
 */
export function removeMember(clanId, playerId) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };
  const member = clan.members[playerId];
  if (!member) return { ok: false, error: TEXT.clan.thatPlayerIsNotIn };
  if (isOwner(clan, playerId)) {
    return {
      ok: false,
      error: TEXT.clan.ownsTransferLeadershipOrDisband(member.name, clan.name),
    };
  }

  delete clan.members[playerId];
  saveClan(clan);
  remove(KEY.playerClan + playerId);

  identityChanged(playerId);
  return { ok: true, value: member.name };
}

/**
 * Assigns or clears a member's clan role. Passing an empty role clears it.
 * A role name not yet in the clan's palette is added to it.
 *
 * @param {string} clanId
 * @param {string} playerId
 * @param {string} rawRole
 * @returns {Result<string>} the role now held, or '' when cleared
 */
export function setMemberRole(clanId, playerId, rawRole) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };
  const member = clan.members[playerId];
  if (!member) return { ok: false, error: TEXT.clan.thatPlayerIsNotIn };
  if (isOwner(clan, playerId)) {
    return { ok: false, error: TEXT.clan.theClanOwnerAlwaysHolds };
  }

  if (rawRole.trim() === '') {
    member.role = '';
    saveClan(clan);
    identityChanged(playerId);
    return { ok: true, value: '' };
  }

  const validated = validateRoleName(rawRole);
  if (!validated.ok) return validated;
  const role = validated.value;

  member.role = role;
  if (!clan.roles.some((r) => r.toLowerCase() === role.toLowerCase())) {
    clan.roles.push(role);
  }
  saveClan(clan);

  identityChanged(playerId);
  return { ok: true, value: role };
}

/**
 * Renames a clan, moving the name index with it.
 *
 * This is what makes the cached clan names on war records earn their keep: a
 * war fought as "Wolves" still reads as "Wolves" after the clan becomes
 * something else, which is the historically accurate answer.
 *
 * @param {string} clanId
 * @param {string} rawName
 * @returns {Result<{ from: string, to: string }>}
 */
export function rename(clanId, rawName) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };

  const validated = validateClanName(rawName);
  if (!validated.ok) return validated;
  const name = validated.value;

  if (normalizeKey(name) === normalizeKey(clan.name)) {
    // Same name in a different case: re-key so the index matches the display.
    const from = clan.name;
    remove(KEY.clanName + normalizeKey(from));
    clan.name = name;
    saveClan(clan);
    setString(KEY.clanName + normalizeKey(name), clan.id);
    for (const id of Object.keys(clan.members)) identityChanged(id);
    return { ok: true, value: { from, to: name } };
  }

  if (getString(KEY.clanName + normalizeKey(name)) !== undefined) {
    return { ok: false, error: TEXT.clan.aClanNamedAlreadyExists(name) };
  }

  const from = clan.name;
  remove(KEY.clanName + normalizeKey(from));
  clan.name = name;
  saveClan(clan);
  setString(KEY.clanName + normalizeKey(name), clan.id);

  for (const id of Object.keys(clan.members)) identityChanged(id);
  return { ok: true, value: { from, to: name } };
}

/**
 * Adds a role name to the clan's palette without assigning it to anyone.
 * Validated exactly as an assignment would be, so nothing can enter the
 * palette that could not later be assigned.
 *
 * @param {string} clanId
 * @param {string} rawRole
 * @returns {Result<string>}
 */
export function addClanRole(clanId, rawRole) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };
  const validated = validateRoleName(rawRole);
  if (!validated.ok) return validated;
  const role = validated.value;

  if (clan.roles.some((r) => r.toLowerCase() === role.toLowerCase())) {
    return { ok: false, error: TEXT.clan.isAlreadyARoleIn(role, clan.name) };
  }

  clan.roles.push(role);
  saveClan(clan);
  return { ok: true, value: role };
}

/**
 * Removes a role from the clan's palette and from anyone holding it.
 *
 * @param {string} clanId
 * @param {string} role
 * @returns {Result<string>}
 */
export function deleteClanRole(clanId, role) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };
  const key = role.toLowerCase();
  if (!clan.roles.some((r) => r.toLowerCase() === key)) {
    return { ok: false, error: TEXT.clan.isNotARoleIn(role, clan.name) };
  }

  clan.roles = clan.roles.filter((r) => r.toLowerCase() !== key);
  /** @type {string[]} */
  const affected = [];
  for (const [id, member] of Object.entries(clan.members)) {
    if (member.role.toLowerCase() === key) {
      member.role = '';
      affected.push(id);
    }
  }
  saveClan(clan);

  for (const id of affected) identityChanged(id);
  return { ok: true, value: role };
}

/**
 * Moves the Leader role to another member of the clan. The outgoing owner
 * stays on as an ordinary member with no role.
 *
 * @param {string} clanId
 * @param {string} newOwnerId
 * @returns {Result<{ previousOwnerId: string, newOwnerName: string }>}
 */
export function transferLeadership(clanId, newOwnerId) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };
  const incoming = clan.members[newOwnerId];
  if (!incoming) return { ok: false, error: TEXT.clan.thatPlayerIsNotIn };
  if (isOwner(clan, newOwnerId)) {
    return { ok: false, error: TEXT.clan.alreadyLeads(incoming.name, clan.name) };
  }

  const previousOwnerId = clan.ownerId;
  clan.ownerId = newOwnerId;
  incoming.role = '';
  const outgoing = clan.members[previousOwnerId];
  if (outgoing) outgoing.role = '';
  saveClan(clan);

  identityChanged(previousOwnerId);
  identityChanged(newOwnerId);
  return { ok: true, value: { previousOwnerId, newOwnerName: incoming.name } };
}

/**
 * Deletes a clan and every index entry pointing at it.
 *
 * @param {string} clanId
 * @returns {Result<{ name: string, memberIds: string[] }>}
 */
export function disband(clanId) {
  const clan = getClan(clanId);
  if (!clan) return { ok: false, error: TEXT.clan.thatClanNoLongerExists };
  const memberIds = Object.keys(clan.members);

  for (const id of memberIds) remove(KEY.playerClan + id);
  remove(KEY.clanName + normalizeKey(clan.name));
  remove(KEY.clan + clan.id);
  setJson(
    KEY.clanIndex,
    clanIds().filter((id) => id !== clan.id),
  );

  for (const id of memberIds) identityChanged(id);
  // Wars and pending requests refer to this clan and must not outlive it.
  clanDisbanded(clan.id);
  return { ok: true, value: { name: clan.name, memberIds } };
}

/**
 * Refreshes the cached display name on a member record, so member lists do not
 * show a gamertag the player has since changed.
 *
 * @param {string} playerId
 * @param {string} currentName
 */
export function refreshMemberName(playerId, currentName) {
  const clan = clanOf(playerId);
  if (!clan) return;
  const member = clan.members[playerId];
  if (!member || member.name === currentName) return;
  member.name = currentName;
  saveClan(clan);
}
