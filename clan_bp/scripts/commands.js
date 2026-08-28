// @ts-check
/**
 * Custom slash commands.
 *
 * Two constraints shape everything here:
 *
 *  - Commands must be registered during `system.beforeEvents.startup`, before
 *    the world exists. Registration therefore only describes commands; it never
 *    reads game state.
 *  - Command callbacks run in restricted-execution mode, where mutations and
 *    form displays are forbidden. Every handler returns `Success` immediately
 *    and does its real work inside `system.run`, reporting back with
 *    `player.sendMessage` rather than a command result.
 *
 * Every command registers at `CommandPermissionLevel.Any` with
 * `cheatsRequired: false`, and enforces permission in script. Registering the
 * staff commands at operator level would lock out non-op holders of a
 * clan-managing staff role, which is exactly the case the staff system exists
 * to support.
 */

import {
  system,
  world,
  Player,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from '@minecraft/server';
import { C } from './config.js';
import { errorMsg, successMsg, msg } from './format.js';
import { TEXT } from './text.js';
import * as clans from './clans.js';
import * as staff from './staff.js';
import * as invites from './invites.js';
import * as requests from './requests.js';
import * as announce from './announce.js';
import * as players from './players.js';
import * as display from './display.js';
import { give as giveCompass, has as hasCompass, giveWarMap } from './compass.js';
import * as wars from './wars.js';
import * as warbook from './warbook.js';
import * as peaceful from './peaceful.js';
import * as ui from './ui.js';

/** @typedef {import('@minecraft/server').CustomCommandOrigin} Origin */
/** @typedef {import('@minecraft/server').CustomCommandResult} CommandResult */

/**
 * Wraps a handler so it runs as a player, outside restricted-execution mode.
 *
 * @param {(player: Player, ...args: any[]) => void} handler
 * @returns {(origin: Origin, ...args: any[]) => CommandResult}
 */
function asPlayer(handler) {
  return (origin, ...args) => {
    const source = origin.sourceEntity;
    if (!(source instanceof Player)) {
      return {
        status: CustomCommandStatus.Failure,
        message: TEXT.cmd.thisCommandCanOnlyBe,
      };
    }

    system.run(() => {
      try {
        handler(source, ...args);
      } catch (err) {
        console.warn(`[sigil] command failed for ${source.name}: ${err}`);
        source.sendMessage(errorMsg(TEXT.cmd.somethingWentWrongRunningThat));
      }
    });
    return { status: CustomCommandStatus.Success };
  };
}

/**
 * A `PlayerSelector` argument arrives as a list. Takes the first real player.
 *
 * @param {unknown} arg
 * @returns {Player | undefined}
 */
function firstPlayer(arg) {
  if (Array.isArray(arg)) return arg.find((entry) => entry instanceof Player);
  return arg instanceof Player ? arg : undefined;
}

/**
 * Resolves the clan a player may act on, reporting why not when they cannot.
 *
 * @param {Player} player
 * @returns {import('./clans.js').Clan | undefined}
 */
function ownClanOrWarn(player) {
  const clan = clans.clanOf(player.id);
  if (!clan) {
    player.sendMessage(errorMsg(TEXT.common.notInAClanCreate));
    return undefined;
  }
  return clan;
}

/**
 * @param {Player} player
 * @param {import('./clans.js').Clan} clan
 * @returns {boolean}
 */
function mayManage(player, clan) {
  return clans.isOwner(clan, player.id) || staff.canManageAnyClan(player);
}

/**
 * Announces a message to every member of a clan who is online.
 *
 * @param {import('./clans.js').Clan} clan
 * @param {string} text
 */
function tellClan(clan, text) {
  for (const id of Object.keys(clan.members)) players.notify(id, text);
}

// ── Handlers ──────────────────────────────────────────────────────────────

/**
 * @param {Player} player
 * @param {string} name
 * @param {unknown} [targetArg] a player to create the clan for, admins only
 */
function handleCreate(player, name, targetArg) {
  const target = firstPlayer(targetArg);
  if (target && target.id !== player.id) {
    createFor(player, target, name);
    return;
  }

  // Admins bypass review entirely; everyone else files a request when the
  // approval setting is on.
  if (requests.approvalRequiredFor(player)) {
    const filed = requests.file({ id: player.id, name: player.name }, name);
    if (!filed.ok) {
      player.sendMessage(errorMsg(filed.error));
      return;
    }
    player.sendMessage(
      msg(
        TEXT.cmd.requestedTheClanAnAdmin(filed.value.name),
      ),
    );
    notifyReviewers(filed.value);
    return;
  }

  const result = clans.createClan(player.id, player.name, name);
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }
  player.sendMessage(successMsg(TEXT.cmd.clanCreatedYouAreIts(result.value.name)));
  announce.clanCreated(result.value.name, player.name);
}

/**
 * Creates a clan on someone else's behalf.
 *
 * An admin doing paperwork for a player is still founding an outpost, not
 * handing out a full clan: `clans.createClan` starts every clan at the outpost
 * tier, and promotion goes through the same request the player would have made
 * themselves. The only thing being skipped is the creation review, which an
 * admin is the reviewer for anyway.
 *
 * @param {Player} player the admin running the command
 * @param {Player} target the player who will own the clan
 * @param {string} name
 */
function createFor(player, target, name) {
  if (!staff.isAdmin(player)) {
    player.sendMessage(errorMsg(TEXT.cmd.onlyAdminsCreateForOthers));
    return;
  }

  const result = clans.createClan(target.id, target.name, name);
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  player.sendMessage(successMsg(TEXT.cmd.createdTheOutpostFor(result.value.name, target.name)));
  target.sendMessage(msg(TEXT.cmd.anAdminCreatedTheOutpost(result.value.name)));
  announce.clanCreated(result.value.name, target.name);
}

/**
 * Tells everyone able to review that a request is waiting.
 *
 * @param {import('./requests.js').ClanRequest} request
 */
function notifyReviewers(request) {
  for (const reviewer of world.getAllPlayers()) {
    if (!requests.canApproveRequest(reviewer, request)) continue;
    // A promotion and a rename are not "requesting a clan"; one notice worded
    // for creation was wrong for the other two.
    const notice =
      request.kind === 'promote'
        ? TEXT.cmd.reviewNoticePromote(request.requesterName, request.name)
        : request.kind === 'rename'
          ? TEXT.cmd.reviewNoticeRename(
              request.requesterName,
              request.name,
              request.newName ?? '',
            )
          : TEXT.cmd.reviewNoticeCreate(request.requesterName, request.name);
    reviewer.sendMessage(msg(notice));
  }
}

/**
 * @param {Player} player
 */
function handleRequests(player) {
  if (!requests.canApprove(player) && !requests.canApprovePromotions(player)) {
    player.sendMessage(errorMsg(TEXT.common.notReviewer));
    return;
  }
  ui.requestQueue(player);
}

/**
 * @param {Player} player
 */
function handleSettings(player) {
  if (!staff.canManageStaffRoles(player)) {
    player.sendMessage(errorMsg(TEXT.common.notAdminSettings));
    return;
  }
  ui.settingsMenu(player);
}

/**
 * @param {Player} player
 * @param {unknown} targetArg
 */
function handlePurge(player, targetArg) {
  if (!staff.isAdmin(player)) {
    player.sendMessage(errorMsg(TEXT.common.notAdminPurge));
    return;
  }

  const target = firstPlayer(targetArg);
  if (!target) {
    player.sendMessage(errorMsg(TEXT.common.offlineUseManage));
    return;
  }
  ui.purgeConfirm(player, { id: target.id, name: target.name, online: true });
}

/**
 * @param {Player} player
 */
function handleCompass(player) {
  // One compass per player. The menu it opens is the same menu whichever copy
  // is held, so a second is only ever clutter — and asking for one is how a
  // player who has misplaced theirs in a full inventory ends up with two.
  if (hasCompass(player)) {
    player.sendMessage(msg(TEXT.cmd.youAlreadyHaveAClanMenu));
    return;
  }

  if (giveCompass(player)) {
    player.sendMessage(successMsg(TEXT.cmd.hereIsYourClanMenu));
  } else {
    player.sendMessage(errorMsg(TEXT.common.inventoryFull));
  }
}

/**
 * @param {Player} player
 * @param {unknown} targetArg
 */
function handleInvite(player, targetArg) {
  const clan = ownClanOrWarn(player);
  if (!clan) return;
  if (!clans.isOwner(clan, player.id)) {
    player.sendMessage(errorMsg(TEXT.common.notClanLeaderInvite));
    return;
  }

  const target = firstPlayer(targetArg);
  if (!target) {
    player.sendMessage(errorMsg(TEXT.common.offlineUseMenuInvite));
    return;
  }

  const result = invites.invite(
    clan,
    { id: player.id, name: player.name },
    { id: target.id, name: target.name },
  );
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  player.sendMessage(successMsg(TEXT.cmd.invitedTo(target.name, clan.name)));
  target.sendMessage(
    msg(
      TEXT.cmd.invitedYouToJoinUse(player.name, clan.name),
    ),
  );
}

/**
 * @param {Player} player
 */
function handleInvites(player) {
  const pending = invites.pendingFor(player.id);
  if (pending.length === 0) {
    player.sendMessage(msg(TEXT.cmd.youHaveNoPendingClan));
    return;
  }

  const lines = pending.map(
    (invite) => `${C.gray} - ${C.aqua}${invite.clanName} ${C.gray}(from ${invite.byName})`,
  );
  player.sendMessage(
    msg(TEXT.cmd.pendingInvitesAcceptWithClan(lines.join('\n'))),
  );
}

/**
 * Resolves which pending invite a bare `/clan:accept` or `/clan:deny` means.
 *
 * @param {Player} player
 * @param {string} clanName '' when the argument was omitted
 * @returns {import('./invites.js').Invite | undefined}
 */
function resolveInvite(player, clanName) {
  const pending = invites.pendingFor(player.id);
  if (pending.length === 0) {
    player.sendMessage(errorMsg(TEXT.cmd.youHaveNoPendingClan2));
    return undefined;
  }

  if (clanName.trim() === '') {
    if (pending.length === 1) return pending[0];
    player.sendMessage(
      errorMsg(
        TEXT.cmd.youHavePendingInvitesName(pending.length, pending.map((i) => i.clanName).join(', ')),
      ),
    );
    return undefined;
  }

  const match = invites.findByClanName(player.id, clanName);
  if (!match) {
    player.sendMessage(errorMsg(TEXT.cmd.youHaveNoPendingInvite(clanName)));
    return undefined;
  }
  return match;
}

/**
 * @param {Player} player
 * @param {string} [clanName]
 */
function handleAccept(player, clanName) {
  const invite = resolveInvite(player, clanName ?? '');
  if (!invite) return;

  const result = invites.accept({ id: player.id, name: player.name }, invite);
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  player.sendMessage(successMsg(TEXT.cmd.youJoined(result.value.name)));
  announce.memberJoined(result.value.name, player.name);
  for (const id of Object.keys(result.value.members)) {
    if (id !== player.id) {
      players.notify(id, msg(TEXT.cmd.joinedTheClan(player.name)));
    }
  }
}

/**
 * @param {Player} player
 * @param {string} [clanName]
 */
function handleDeny(player, clanName) {
  const invite = resolveInvite(player, clanName ?? '');
  if (!invite) return;

  invites.decline(player.id, invite);
  player.sendMessage(msg(TEXT.cmd.declinedTheInviteFrom(invite.clanName)));
  players.notify(
    invite.byId,
    msg(TEXT.cmd.declinedYourInviteTo(player.name, invite.clanName)),
  );
}

/**
 * @param {Player} player
 * @param {unknown} targetArg
 */
function handleKick(player, targetArg) {
  const target = firstPlayer(targetArg);
  if (!target) {
    player.sendMessage(errorMsg(TEXT.common.offlineUseMenu));
    return;
  }

  const clan = clans.clanOf(target.id);
  if (!clan) {
    player.sendMessage(errorMsg(TEXT.cmd.isNotInAClan(target.name)));
    return;
  }
  if (!mayManage(player, clan)) {
    player.sendMessage(errorMsg(TEXT.cmd.youCannotRemoveMembersFrom(clan.name)));
    return;
  }

  const result = clans.removeMember(clan.id, target.id);
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  player.sendMessage(successMsg(TEXT.cmd.removedFrom(result.value, clan.name)));
  announce.memberLeft(clan.name, result.value, true);
  target.sendMessage(msg(TEXT.cmd.youWereRemovedFrom(clan.name)));
  tellClan(clan, msg(TEXT.cmd.wasRemovedFromTheClan(result.value)));
}

/**
 * @param {Player} player
 * @param {unknown} targetArg
 * @param {string} role
 */
function handleRole(player, targetArg, role) {
  const clan = ownClanOrWarn(player);
  if (!clan) return;
  if (!clans.isOwner(clan, player.id)) {
    player.sendMessage(errorMsg(TEXT.common.notClanLeaderRoles));
    return;
  }

  const target = firstPlayer(targetArg);
  if (!target) {
    player.sendMessage(errorMsg(TEXT.common.offlineUseMenu));
    return;
  }

  const result = clans.setMemberRole(clan.id, target.id, role);
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  if (result.value === '') {
    player.sendMessage(successMsg(TEXT.cmd.clearedSRole(target.name)));
    target.sendMessage(msg(TEXT.cmd.yourRoleInWasCleared(clan.name)));
  } else {
    player.sendMessage(successMsg(TEXT.cmd.isNow(target.name, result.value)));
    target.sendMessage(msg(TEXT.cmd.youAreNowIn(result.value, clan.name)));
  }
}

/**
 * @param {Player} player
 */
function handleLeave(player) {
  const clan = ownClanOrWarn(player);
  if (!clan) return;

  if (clans.isOwner(clan, player.id)) {
    player.sendMessage(
      errorMsg(
        TEXT.cmd.youOwnTransferLeadershipWith(clan.name),
      ),
    );
    return;
  }

  const result = clans.removeMember(clan.id, player.id);
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  player.sendMessage(msg(TEXT.cmd.youLeft(clan.name)));
  announce.memberLeft(clan.name, player.name, false);
  tellClan(clan, msg(TEXT.cmd.leftTheClan(player.name)));
}

/**
 * @param {Player} player
 */
function handleDisband(player) {
  const clan = ownClanOrWarn(player);
  if (!clan) return;
  if (!mayManage(player, clan)) {
    player.sendMessage(errorMsg(TEXT.cmd.onlyTheClanOwnerCan));
    return;
  }

  const memberIds = Object.keys(clan.members);
  const result = clans.disband(clan.id);
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  // Outstanding invites are held by non-members, so they need their own sweep.
  invites.revokeAllForClan(clan.id);
  for (const id of memberIds) {
    players.notify(id, msg(TEXT.cmd.wasDisbanded(result.value.name)));
  }
  announce.clanDisbanded(result.value.name);
  player.sendMessage(successMsg(TEXT.cmd.disbanded(result.value.name)));
}

/**
 * @param {Player} player
 * @param {unknown} targetArg
 */
function handleTransfer(player, targetArg) {
  const target = firstPlayer(targetArg);
  if (!target) {
    player.sendMessage(errorMsg(TEXT.common.offlineUseMenu));
    return;
  }

  const clan = clans.clanOf(target.id);
  if (!clan) {
    player.sendMessage(errorMsg(TEXT.cmd.isNotInAClan(target.name)));
    return;
  }
  if (!mayManage(player, clan)) {
    player.sendMessage(errorMsg(TEXT.cmd.youCannotChangeLeadershipOf(clan.name)));
    return;
  }

  const result = clans.transferLeadership(clan.id, target.id);
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  player.sendMessage(successMsg(TEXT.cmd.nowLeads(result.value.newOwnerName, clan.name)));
  tellClan(
    clan,
    msg(TEXT.cmd.isNowTheOf(result.value.newOwnerName, clan.name)),
  );
}

/**
 * @param {Player} player
 * @param {unknown} targetArg
 */
function handleInfo(player, targetArg) {
  const target = firstPlayer(targetArg) ?? player;
  const clan = clans.clanOf(target.id);

  if (!clan) {
    player.sendMessage(
      msg(target.id === player.id ? TEXT.cmd.youAreNotInA : TEXT.cmd.isNotInAClan2(target.name)),
    );
    return;
  }

  const rows = clans
    .memberList(clan)
    .map((row) => {
      const marker = row.id === clan.ownerId ? `${C.yellow}★ ` : `${C.gray}- `;
      const role = row.role ? ` ${C.darkGray}(${C.gray}${row.role}${C.darkGray})` : '';
      const online = players.onlinePlayer(row.id) ? `${C.green}` : `${C.darkGray}`;
      return `${marker}${online}${row.member.name}${role}`;
    })
    .join('\n');

  const roleLabel = target.id === player.id ? TEXT.cmd.yourRole : `${target.name}'s role`;
  player.sendMessage(
    msg(
      TEXT.cmd.memberS3(clan.name, clans.memberCount(clan), roleLabel, clans.roleOf(clan, target.id) || TEXT.fragment.noRole, rows),
    ),
  );
}

/**
 * @param {Player} player
 */
function handleList(player) {
  const all = clans.allClans();
  if (all.length === 0) {
    player.sendMessage(msg(TEXT.cmd.noClansExistYetCreate));
    return;
  }

  const rows = all
    .map(
      (clan) =>
        `${C.gray} - ${C.aqua}${clan.name} ${C.gray}(${clans.memberCount(clan)}) ` +
        `${C.darkGray}led by ${players.displayName(clan.ownerId)}`,
    )
    .join('\n');
  player.sendMessage(msg(TEXT.cmd.clans(rows)));
}

/**
 * @param {Player} player
 */
function handleManage(player) {
  if (!staff.canManageAnyClan(player)) {
    player.sendMessage(errorMsg(TEXT.common.notClanManager));
    return;
  }
  ui.staffClanBrowser(player);
}

/**
 * @param {Player} player
 */
function handleStaff(player) {
  if (!staff.canManageStaffRoles(player)) {
    player.sendMessage(errorMsg(TEXT.common.notAdminStaffRoles));
    return;
  }
  ui.staffRoleMenu(player);
}

/**
 * @param {Player} player
 */
function handleStatus(player) {
  if (!staff.isAdmin(player)) {
    player.sendMessage(errorMsg(TEXT.cmd.onlyAdminsCanViewAdd));
    return;
  }
  player.sendMessage(
    msg(
      TEXT.cmd.clansStatusChatClansStaff(display.chatStatus(), clans.clanIds().length, staff.allRoles().length),
    ),
  );
}


/**
 * @param {Player} player
 * @param {string} name
 */
function handleRename(player, name) {
  const clan = ownClanOrWarn(player);
  if (!clan) return;
  if (!clans.isOwner(clan, player.id)) {
    player.sendMessage(errorMsg(TEXT.common.notClanLeaderRename));
    return;
  }

  if (!requests.approvalRequiredFor(player)) {
    const renamed = clans.rename(clan.id, name);
    player.sendMessage(
      renamed.ok
        ? successMsg(TEXT.cmd.isNow(renamed.value.from, renamed.value.to))
        : errorMsg(renamed.error),
    );
    return;
  }

  const filed = requests.fileRename({ id: player.id, name: player.name }, clan, name);
  if (!filed.ok) {
    player.sendMessage(errorMsg(filed.error));
    return;
  }
  player.sendMessage(
    msg(TEXT.cmd.requestedTheNameAwaitingReview(filed.value.newName)),
  );
  notifyReviewers(filed.value);
}

/**
 * @param {Player} player
 */
function handleWar(player) {
  // Staff who are in no clan still need the war screen: annulment is the
  // escape hatch for an abandoned war, and a neutral admin is who uses it.
  if (!clans.clanOf(player.id) && wars.canAnnul(player)) {
    ui.staffWarBrowser(player);
    return;
  }
  ui.warMenu(player);
}

/**
 * @param {Player} player
 */
function handleWars(player) {
  const active = wars.liveWars().filter((war) => war.state === 'active');
  if (active.length === 0) {
    player.sendMessage(msg(TEXT.cmd.noWarsAreBeingFought));
    return;
  }

  const lines = active.map(
    (war) =>
      `${C.gray} - ${C.white}${war.nameA} ${C.yellow}${wars.sideTotal(war, war.clanA)}` +
      `${C.darkGray} - ${C.yellow}${wars.sideTotal(war, war.clanB)} ${C.white}${war.nameB}`,
  );
  player.sendMessage(msg(TEXT.cmd.activeWars(lines.join('\n'))));
}

/**
 * @param {Player} player
 */
function handlePromote(player) {
  ui.promotionRequest(player);
}

/**
 * @param {Player} player
 */
function handleWarMap(player) {
  const clan = ownClanOrWarn(player);
  if (!clan) return;
  if (!clans.isOwner(clan, player.id) && !staff.isAdmin(player)) {
    player.sendMessage(errorMsg(TEXT.cmd.onlyTheClanLeaderCan));
    return;
  }

  if (giveWarMap(player)) {
    player.sendMessage(
      successMsg(TEXT.cmd.hereIsYourWarMap),
    );
  } else {
    player.sendMessage(errorMsg(TEXT.common.inventoryFull));
  }
}

/**
 * Adjusts a clan's kill total in its single active war. Clans in more than one
 * war are sent to the UI, where the war can be picked explicitly.
 *
 * @param {Player} player
 * @param {string} clanName
 * @param {number} delta
 * @param {unknown} [targetArg] optional player to credit or debit
 */
function handleWarKills(player, clanName, delta, targetArg) {
  if (!wars.canAdjustKills(player)) {
    player.sendMessage(errorMsg(TEXT.common.notWarAdjuster));
    return;
  }

  const clan = clans.clanByName(clanName);
  if (!clan) {
    player.sendMessage(errorMsg(TEXT.cmd.thereIsNoClanNamed(clanName)));
    return;
  }

  const active = wars.warsFor(clan.id).filter((war) => war.state === 'active');
  if (active.length === 0) {
    player.sendMessage(errorMsg(TEXT.cmd.isNotInAnActive(clan.name)));
    return;
  }
  if (active.length > 1) {
    player.sendMessage(
      errorMsg(TEXT.cmd.isInWarsUseThe(clan.name, active.length)),
    );
    return;
  }

  // Naming a player books the correction on their own line; leaving them out
  // records it as an unattributed adjustment for the clan.
  const target = firstPlayer(targetArg);
  const result = wars.adjustKills(
    active[0].id,
    clan.id,
    delta,
    target ? { id: target.id, name: target.name } : undefined,
  );
  if (!result.ok) {
    player.sendMessage(errorMsg(result.error));
    return;
  }

  player.sendMessage(
    successMsg(
      target
        ? TEXT.cmd.nowHasKillSTotals(target.name, result.value.playerKills ?? 0, clan.name, result.value.total)
        : TEXT.cmd.nowTotalsWarKillS(clan.name, result.value.total),
    ),
  );
}

/**
 * Lists the ended wars of a clan — your own by default.
 *
 * @param {Player} player
 * @param {string} [clanName]
 */
function handleWarHistory(player, clanName) {
  const clan = clanName ? clans.clanByName(clanName) : clans.clanOf(player.id);
  if (!clan) {
    player.sendMessage(
      errorMsg(clanName ? TEXT.cmd.thereIsNoClanNamed2(clanName) : TEXT.common.notInAClan),
    );
    return;
  }

  const history = wars.historyFor(clan.id);
  if (history.length === 0) {
    player.sendMessage(msg(TEXT.cmd.hasFoughtNoWarsTo(clan.name)));
    return;
  }

  const lines = history.map((war) => {
    const them = wars.nameOf(war, wars.opponentOf(war, clan.id));
    const verdict =
      war.winner === clan.id
        ? `${C.green}${TEXT.fragment.wonLower}`
        : war.winner
          ? `${C.red}${TEXT.fragment.lostLower}`
          : `${C.gray}${TEXT.fragment.drawnLower}`;
    return (
      `${C.gray} - ${C.white}${warbook.ordinal(war.ordinal)}${C.gray} vs ${C.aqua}${them} ` +
      `${verdict}${C.darkGray} ${wars.sideTotal(war, clan.id)}-${wars.sideTotal(war, wars.opponentOf(war, clan.id))}`
    );
  });
  player.sendMessage(
    msg(TEXT.cmd.warHistoryPrintOneWith(clan.name, lines.join('\n'))),
  );
}

/**
 * Prints a war record book. With no arguments it opens the picker; with a clan
 * and an ordinal it prints that war directly.
 *
 * @param {Player} player
 * @param {string} [clanName]
 * @param {number} [ordinalArg]
 * @param {string} [opponentName] narrows an ordinal shared by two wars
 */
function handleWarBook(player, clanName, ordinalArg, opponentName) {
  // No arguments at all: the picker. A clan on its own: that clan's history.
  // An ordinal on its own: your own clan's war of that number.
  if (clanName === undefined && ordinalArg === undefined) {
    ui.warHistoryMenu(player);
    return;
  }

  const clan =
    clanName === undefined ? clans.clanOf(player.id) : clans.clanByName(clanName);
  if (!clan) {
    player.sendMessage(
      errorMsg(clanName === undefined ? TEXT.common.notInAClan : TEXT.cmd.thereIsNoClanNamed2(clanName)),
    );
    return;
  }

  if (ordinalArg === undefined) {
    ui.clanWarHistoryFor(player, clan.id);
    return;
  }

  const own = clans.clanOf(player.id);
  const isTheirLeader = own !== undefined && own.id === clan.id && clans.isOwner(own, player.id);
  if (!isTheirLeader && !wars.canGenerateWarBooks(player)) {
    player.sendMessage(errorMsg(TEXT.cmd.youCannotPrintSWar(clan.name)));
    return;
  }

  // Ordinals are numbered per *pair*, so a clan that has fought two others may
  // well have two "1st" wars. Narrow by opponent when one is given, and say so
  // rather than guess when the number alone is ambiguous.
  let candidates = wars
    .historyFor(clan.id)
    .filter((entry) => entry.ordinal === ordinalArg);

  if (opponentName !== undefined) {
    const opponent = clans.clanByName(opponentName);
    if (!opponent) {
      player.sendMessage(errorMsg(TEXT.cmd.thereIsNoClanNamed(opponentName)));
      return;
    }
    candidates = candidates.filter(
      (entry) => entry.clanA === opponent.id || entry.clanB === opponent.id,
    );
  }

  if (candidates.length === 0) {
    player.sendMessage(
      errorMsg(TEXT.cmd.hasNoFinishedWarNumbered(clan.name, ordinalArg)),
    );
    return;
  }

  if (candidates.length > 1) {
    const against = candidates
      .map((entry) => wars.nameOf(entry, wars.opponentOf(entry, clan.id)))
      .join(', ');
    player.sendMessage(
      errorMsg(
        TEXT.cmd.hasWarsNumberedAgainstName(clan.name, candidates.length, ordinalArg, against, clan.name, ordinalArg),
      ),
    );
    return;
  }

  const war = candidates[0];

  const printed = warbook.givePlayerBook(player, war);
  player.sendMessage(printed.ok ? successMsg(TEXT.cmd.printed(printed.value)) : errorMsg(printed.error));
}


/**
 * @param {Player} player
 */
function handleDisplay(player) {
  if (!staff.canManageStaffRoles(player)) {
    player.sendMessage(errorMsg(TEXT.common.notAdminDisplay));
    return;
  }
  ui.displaySettingsMenu(player);
}

/**
 * @param {Player} player
 */
function handlePeaceful(player) {
  if (!peaceful.canAssign(player)) {
    player.sendMessage(errorMsg(TEXT.common.notPeacefulAssigner));
    return;
  }
  ui.peacefulPicker(player);
}

// ── Registration ──────────────────────────────────────────────────────────

const P = CustomCommandParamType;

/**
 * Registers every command. Called from `system.beforeEvents.startup`.
 *
 * @param {import('@minecraft/server').CustomCommandRegistry} registry
 */
export function register(registry) {
  /**
   * @param {string} name
   * @param {string} description
   * @param {(player: Player, ...args: any[]) => void} handler
   * @param {{ mandatory?: import('@minecraft/server').CustomCommandParameter[],
   *           optional?: import('@minecraft/server').CustomCommandParameter[] }} [params]
   */
  const add = (name, description, handler, params = {}) => {
    // Registration failures are contained to the command that caused them: a
    // single malformed definition should cost that command, not every command.
    try {
      registry.registerCommand(
        {
          name: `clan:${name}`,
          description,
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
          mandatoryParameters: params.mandatory ?? [],
          optionalParameters: params.optional ?? [],
        },
        asPlayer(handler),
      );
    } catch (err) {
      console.warn(`[sigil] could not register /clan:${name}: ${err}`);
    }
  };

  add('menu', TEXT.cmd.openTheClanMenu, (player) => ui.mainMenu(player));

  add('compass', TEXT.cmd.getAClanMenuCompass, handleCompass);

  add('warmap', TEXT.cmd.getAWarMapBlock, handleWarMap);

  add('war', TEXT.cmd.openTheWarScreen, handleWar);

  add('wars', TEXT.cmd.listEveryActiveWar, handleWars);

  add('warhistory', TEXT.cmd.listTheEndedWarsOf, handleWarHistory, {
    optional: [{ type: P.String, name: 'clan' }],
  });

  add('warbook', TEXT.cmd.printTheRecordBookFor, handleWarBook, {
    optional: [
      { type: P.String, name: 'clan' },
      { type: P.Integer, name: 'ordinal' },
      { type: P.String, name: 'opponent' },
    ],
  });

  add('promote', TEXT.cmd.requestPromotionFromOutpostTo, handlePromote);

  add('create', TEXT.cmd.createAClanOrRequest, handleCreate, {
    mandatory: [{ type: P.String, name: 'name' }],
    optional: [{ type: P.PlayerSelector, name: 'player' }],
  });

  add('invite', TEXT.cmd.inviteAPlayerToYour, handleInvite, {
    mandatory: [{ type: P.PlayerSelector, name: 'player' }],
  });

  add('invites', TEXT.cmd.listYourPendingClanInvites, handleInvites);

  add('accept', TEXT.cmd.acceptAPendingClanInvite, handleAccept, {
    optional: [{ type: P.String, name: 'clan' }],
  });

  add('deny', TEXT.cmd.declineAPendingClanInvite, handleDeny, {
    optional: [{ type: P.String, name: 'clan' }],
  });

  add('kick', TEXT.cmd.removeAMemberFromA, handleKick, {
    mandatory: [{ type: P.PlayerSelector, name: 'player' }],
  });

  add('role', TEXT.cmd.assignAClanRoleTo, handleRole, {
    mandatory: [
      { type: P.PlayerSelector, name: 'player' },
      { type: P.String, name: 'role' },
    ],
  });

  add('rename', TEXT.cmd.renameYourClanOrRequest, handleRename, {
    mandatory: [{ type: P.String, name: 'name' }],
  });

  add('leave', TEXT.cmd.leaveYourClan, handleLeave);

  add('disband', TEXT.cmd.deleteYourClan, handleDisband);

  add('info', TEXT.cmd.showClanDetails, handleInfo, {
    optional: [{ type: P.PlayerSelector, name: 'player' }],
  });

  add('list', TEXT.cmd.listEveryClan, handleList);

  add('transfer', TEXT.cmd.transferTheLeaderRoleTo, handleTransfer, {
    mandatory: [{ type: P.PlayerSelector, name: 'player' }],
  });

  add('manage', TEXT.cmd.openTheClanManagementMenu, handleManage);

  add('requests', TEXT.cmd.reviewPendingClanCreationRequests, handleRequests);

  add('staff', TEXT.cmd.manageStaffRoles, handleStaff);

  add('settings', TEXT.cmd.changeApprovalNotificationAndPolling, handleSettings);

  add('display', TEXT.cmd.changeHowClanAndSystem, handleDisplay);

  add('peaceful', TEXT.cmd.grantOrClearThePeaceful, handlePeaceful);

  add('purge', TEXT.cmd.removeAPlayerFromThe, handlePurge, {
    mandatory: [{ type: P.PlayerSelector, name: 'player' }],
  });

  add('warkills', TEXT.cmd.adjustWarKillsOptionallyFor, handleWarKills, {
    mandatory: [
      { type: P.String, name: 'clan' },
      { type: P.Integer, name: 'delta' },
    ],
    optional: [{ type: P.PlayerSelector, name: 'player' }],
  });

  add('status', TEXT.cmd.showAddOnDiagnostics, handleStatus);
}
