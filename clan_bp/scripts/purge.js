// @ts-check
/**
 * Removing a player from the system entirely.
 *
 * Bans cannot be observed from a script. The `@minecraft/server` API — stable
 * and beta alike — has no ban list, no ban event and no kick surface, and
 * `playerLeave` reports only an id and a name, so a ban looks the same as a
 * dropped connection. Banning happens outside the sandbox, in a dedicated
 * server's allowlist or in platform moderation, and purging is an explicit
 * admin action rather than something inferred from a departure.
 *
 * A purge leaves nothing behind of the player as a participant: membership,
 * ownership, staff role, the Peaceful marker, invites sent and received, any
 * pending clan request, and the name registry entries the UI finds them by.
 *
 * Finished war records are exempt. A war's per-member kill counts are history,
 * and a purged player stays named in the wars they fought.
 */

import { KEY } from './config.js';
import { getString, remove } from './storage.js';
import { normalizeKey } from './format.js';
import * as clans from './clans.js';
import * as invites from './invites.js';
import * as requests from './requests.js';
import * as staff from './staff.js';
import * as peaceful from './peaceful.js';
import { identityChanged } from './hooks.js';

/**
 * What a purge did, so the caller can report it and fire the right
 * notifications.
 *
 * @typedef {object} PurgeReport
 * @property {string} playerName
 * @property {string | undefined} clanName        the clan they were in, if any
 * @property {boolean} clanDisbanded              their clan was deleted
 * @property {string | undefined} newLeaderName   leadership passed to this member
 * @property {string[]} notifyIds                 remaining members to inform
 * @property {number} invitesWithdrawn
 * @property {boolean} hadStaffRole
 * @property {boolean} hadPeaceful
 * @property {boolean} hadPendingRequest
 */

/**
 * Removes every trace of a player from the clan system.
 *
 * When the player owns a clan, leadership passes to the longest-serving
 * remaining member rather than the clan being destroyed — losing one person
 * should not cost everyone else their clan. Only a clan with no other members
 * is disbanded.
 *
 * @param {string} playerId
 * @param {string} fallbackName used when the registry has no name on record
 * @returns {PurgeReport}
 */
export function purge(playerId, fallbackName) {
  const playerName = getString(KEY.playerName + playerId) ?? fallbackName;

  /** @type {PurgeReport} */
  const report = {
    playerName,
    clanName: undefined,
    clanDisbanded: false,
    newLeaderName: undefined,
    notifyIds: [],
    invitesWithdrawn: 0,
    hadStaffRole: staff.roleOf(playerId) !== undefined,
    hadPeaceful: peaceful.isPeaceful(playerId),
    hadPendingRequest: requests.forPlayer(playerId) !== undefined,
  };

  const clan = clans.clanOf(playerId);
  if (clan) {
    report.clanName = clan.name;

    if (clans.isOwner(clan, playerId)) {
      const heirs = clans
        .memberList(clan)
        .filter((row) => row.id !== playerId)
        .sort((a, b) => a.member.joinedAt - b.member.joinedAt);

      if (heirs.length === 0) {
        report.clanDisbanded = true;
        invites.revokeAllForClan(clan.id);
        clans.disband(clan.id);
      } else {
        const heir = heirs[0];
        const moved = clans.transferLeadership(clan.id, heir.id);
        if (moved.ok) report.newLeaderName = moved.value.newOwnerName;
        const current = clans.getClan(clan.id);
        if (current) {
          clans.removeMember(current.id, playerId);
          report.notifyIds = Object.keys(current.members);
        }
      }
    } else {
      clans.removeMember(clan.id, playerId);
      report.notifyIds = Object.keys(clan.members).filter((id) => id !== playerId);
    }
  }

  // Cleared before the clan work below, because removing them from a clan
  // signals a display refresh — and a refresh that ran while these were still
  // set would redraw the player with the staff tag we are in the middle of
  // taking away, then never run again.
  staff.assignRole(playerId, undefined);
  peaceful.set(playerId, false);
  requests.dropFor(playerId);
  invites.clearAll(playerId);
  report.invitesWithdrawn = invites.revokeAllFrom(playerId);

  // The registry goes last: the steps above look names up through it.
  remove(KEY.playerClan + playerId);
  remove(KEY.playerName + playerId);
  const reverseKey = KEY.playerId + normalizeKey(playerName);
  if (getString(reverseKey) === playerId) remove(reverseKey);

  // Everything is gone now, so a final signal redraws them as the nobody they
  // have become. A purged player who is online otherwise keeps the tags of a
  // clan they are no longer in until something unrelated refreshes them.
  identityChanged(playerId);

  return report;
}
