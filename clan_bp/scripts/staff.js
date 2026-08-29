// @ts-check
/**
 * The staff layer: operator-derived admin status, plus a script-managed role
 * system that sits between "ordinary player" and "operator".
 *
 * Two rules hold everywhere in this file:
 *
 *  - Admin is *derived*, never stored. A player is an admin exactly when the
 *    game says they are an operator. Nothing here can grant or revoke it.
 *  - A staff role never confers admin. The most a staff role can carry is
 *    clan-management access, which is a strictly smaller power than admin
 *    because it cannot touch the staff system itself.
 */

import { PlayerPermissionLevel } from '@minecraft/server';
import { KEY, DEFAULT_STAFF_ROLES, C } from './config.js';
import {
  getString,
  getJson,
  setJson,
  idsWithPrefix,
  setRendered,
  refreshRendered,
} from './storage.js';
import { slugify } from './format.js';
import { TEXT } from './text.js';

/** @typedef {import('./config.js').StaffRole} StaffRole */
/** @typedef {import('@minecraft/server').Player} Player */

/**
 * Whether a player is an operator, and therefore an admin.
 *
 * @param {Player} player
 * @returns {boolean}
 */
export function isAdmin(player) {
  return player.playerPermissionLevel === PlayerPermissionLevel.Operator;
}

/**
 * Seeds the built-in roles the first time the add-on runs. Later runs leave
 * the stored list alone, so an admin's edits are never overwritten.
 */
export function ensureDefaults() {
  if (getString(KEY.staffRoles) === undefined) {
    setJson(KEY.staffRoles, DEFAULT_STAFF_ROLES);
  }
}

/**
 * Every staff role, highest priority first.
 *
 * @returns {StaffRole[]}
 */
export function allRoles() {
  /** @type {StaffRole[]} */
  const roles = getJson(KEY.staffRoles, /** @type {StaffRole[]} */ ([]));
  return roles.slice().sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

/**
 * @param {StaffRole[]} roles
 */
function saveRoles(roles) {
  setJson(KEY.staffRoles, roles);
}

/**
 * @param {string} roleId
 * @returns {StaffRole | undefined}
 */
export function roleById(roleId) {
  return allRoles().find((r) => r.id === roleId);
}

/**
 * The staff role held by a player id, if any. Works for offline players.
 *
 * @param {string} playerId
 * @returns {StaffRole | undefined}
 */
export function roleOf(playerId) {
  const roleId = getString(KEY.staffAssign + playerId);
  return roleId === undefined ? undefined : roleById(roleId);
}

/**
 * Assigns a staff role to a player, or clears it when `roleId` is undefined.
 *
 * @param {string} playerId
 * @param {string | undefined} roleId
 */
export function assignRole(playerId, roleId) {
  setRendered(playerId, KEY.staffAssign + playerId, roleId);
}

/**
 * Every player id currently holding a staff role, paired with that role.
 *
 * @returns {Array<{ playerId: string, role: StaffRole }>}
 */
export function allAssignments() {
  /** @type {Array<{ playerId: string, role: StaffRole }>} */
  const out = [];
  for (const key of idsWithPrefix(KEY.staffAssign)) {
    const playerId = key.slice(KEY.staffAssign.length);
    const role = roleOf(playerId);
    if (role) out.push({ playerId, role });
  }
  return out;
}

/**
 * Creates a staff role. Ids are derived from the name and de-duplicated, so an
 * admin never has to invent one.
 *
 * @param {{ name: string, symbol: string, color: string, manageClans: boolean, priority: number }} spec
 * @returns {import('./format.js').Result<StaffRole>}
 */
export function createRole(spec) {
  const roles = allRoles();
  const base = slugify(spec.name);
  let id = base;
  let n = 2;
  while (roles.some((r) => r.id === id)) id = `${base}_${n++}`;

  if (roles.some((r) => r.name.toLowerCase() === spec.name.toLowerCase())) {
    return { ok: false, error: TEXT.staffRole.nameTaken(spec.name) };
  }

  /** @type {StaffRole} */
  const role = {
    id,
    name: spec.name,
    symbol: spec.symbol,
    color: spec.color,
    manageClans: spec.manageClans,
    priority: spec.priority,
  };
  roles.push(role);
  saveRoles(roles);
  return { ok: true, value: role };
}

/**
 * Applies edits to an existing role. Built-in roles are editable — only
 * deletion is blocked for them.
 *
 * @param {string} roleId
 * @param {Partial<Pick<StaffRole, 'name' | 'symbol' | 'color' | 'manageClans' | 'priority'>>} changes
 * @returns {import('./format.js').Result<StaffRole>}
 */
export function updateRole(roleId, changes) {
  const roles = allRoles();
  const role = roles.find((r) => r.id === roleId);
  if (!role) return { ok: false, error: TEXT.staffRole.roleGone };

  if (
    changes.name !== undefined &&
    roles.some((r) => r.id !== roleId && r.name.toLowerCase() === changes.name?.toLowerCase())
  ) {
    return { ok: false, error: TEXT.staffRole.nameTaken(changes.name) };
  }

  Object.assign(role, changes);
  saveRoles(roles);
  // The role's tag is drawn from the role, not from the assignment, so a
  // rename or a recolour changes what every holder renders as.
  refreshRendered(
    allAssignments()
      .filter(({ role: held }) => held.id === roleId)
      .map(({ playerId }) => playerId),
  );
  return { ok: true, value: role };
}

/**
 * Deletes a staff role and un-assigns everyone holding it.
 *
 * @param {string} roleId
 * @returns {import('./format.js').Result<string>}
 */
export function deleteRole(roleId) {
  const roles = allRoles();
  const role = roles.find((r) => r.id === roleId);
  if (!role) return { ok: false, error: TEXT.staffRole.roleGone };
  if (role.builtin) {
    return { ok: false, error: TEXT.staffRole.builtInCannotBeDeleted(role.name) };
  }

  saveRoles(roles.filter((r) => r.id !== roleId));
  for (const { playerId, role: held } of allAssignments()) {
    if (held.id === roleId) assignRole(playerId, undefined);
  }
  return { ok: true, value: role.name };
}

/**
 * May this player act on any clan — remove members, transfer Leader, disband?
 * True for admins, and for staff roles flagged with clan-management access.
 *
 * @param {Player} player
 * @returns {boolean}
 */
export function canManageAnyClan(player) {
  return isAdmin(player) || roleOf(player.id)?.manageClans === true;
}

/**
 * Whether this player may be given a staff role at all.
 *
 * Operators may not. Admin is not one rank among several — it is the whole
 * permission, granted by the server rather than by this add-on, and a staff
 * role on top of it could only ever be a weaker duplicate of powers already
 * held. The displayed title already prefers Admin, so a role underneath it
 * would be invisible as well as pointless.
 *
 * Every other permission level may hold any role. A Visitor is never offered
 * one; the picker filters them out before this is reached.
 *
 * @param {Player} player
 * @returns {boolean}
 */
export function mayHoldRole(player) {
  return !isAdmin(player);
}

/**
 * The five powers a staff role can carry beyond plain clan management.
 *
 * @typedef {'approveClans' | 'approvePromotions' | 'adjustWarKills'
 *   | 'generateWarBooks' | 'assignPeaceful'} StaffPower
 */

/**
 * Whether a player holds one specific staff power.
 *
 * Admins hold every power by definition, and never through a role — being an
 * operator is the whole permission, so no role lookup happens for them.
 *
 * A role stored before these fields existed answers `undefined` and falls back
 * to `manageClans`, so a clan-managing role keeps all five powers until an
 * admin edits it.
 *
 * @param {Player} player
 * @param {StaffPower} power
 * @returns {boolean}
 */
export function hasPower(player, power) {
  if (isAdmin(player)) return true;
  const role = roleOf(player.id);
  if (!role) return false;
  return (role[power] ?? role.manageClans) === true;
}

/**
 * May this player edit the staff role system itself? Admins only, so that a
 * clan-managing staff role cannot escalate itself.
 *
 * @param {Player} player
 * @returns {boolean}
 */
export function canManageStaffRoles(player) {
  return isAdmin(player);
}

/**
 * The chat tag for a staff role, already coloured, e.g. `§9[Mod]§r`.
 *
 * @param {StaffRole} role
 * @returns {string}
 */
export function roleTag(role) {
  return `${C.darkGray}[${role.color}${role.symbol}${C.darkGray}]`;
}
