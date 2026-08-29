// @ts-check
/**
 * The screens a player uses on their own clan: creating one, the clan menu and
 * its roster, clan roles, invites, and browsing the clans that exist.
 */

import { world } from '@minecraft/server';
import { action, showAction as show, modal } from '../forms.js';
import { C, LEADER_ROLE, LIMITS } from '../config.js';
import { errorMsg, successMsg, msg, truncate } from '../format.js';
import { TEXT } from '../text.js';
import * as clans from '../clans.js';
import * as staff from '../staff.js';
import * as invites from '../invites.js';
import * as requests from '../requests.js';
import * as settings from '../settings.js';
import * as announce from '../announce.js';
import * as players from '../players.js';
import {
  colorAt,
  colorIndex,
  colorOptions,
  confirm,
  memberLabel,
  onlineDot,
  pickFrom,
  pickPlayer,
  run,
} from './shared.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../clans.js').Clan} Clan */

// ── Creating and viewing your own clan ────────────────────────────────────

/**
 * @param {Player} player
 */
export function createClanForm(player) {
  run(player, async () => {
    const needsApproval = requests.approvalRequiredFor(player);
    const pending = requests.forPlayer(player.id);

    const response = await modal(
      needsApproval ? `${C.green}Request a Clan` : `${C.green}Create a Clan`,
    )
      .textField(
        'name',
        TEXT.menu.clanNameCharacters(LIMITS.clanNameMin, LIMITS.clanNameMax),
        'Wolves',
        { defaultValue: pending?.name ?? '' },
      )
      .submitButton(needsApproval ? TEXT.menu.request : TEXT.menu.create)
      .show(player);

    if (response.canceled) return;
    const name = response.str('name');

    if (needsApproval) {
      const filed = requests.file({ id: player.id, name: player.name }, name);
      if (!filed.ok) {
        player.sendMessage(errorMsg(filed.error));
        return;
      }
      player.sendMessage(
        msg(
          TEXT.cmd.creationRequestFiled(filed.value.name),
        ),
      );
      requests.notifyReviewers(filed.value);
      return;
    }

    const result = clans.createClan(player.id, player.name, name);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      return;
    }
    player.sendMessage(successMsg(TEXT.cmd.clanCreated(result.value.name)));
    announce.clanCreated(result.value.name, player.name);
    myClanMenu(player);
  });
}


/**
 * Founds a clan on another player's behalf. Admin only.
 *
 * Servers end up doing this: a player cannot type the command, or wants the
 * clan set up before they log in for the first time on a new season. What an
 * admin is skipping is the creation review — which they are the reviewer for
 * anyway — and nothing else. The clan starts as an outpost and is promoted the
 * same way every other clan is, so this is not a way to hand out a full clan.
 *
 * @param {Player} player the admin doing it
 * @param {() => void} [back]
 */
export function createClanForPlayer(player, back) {
  run(player, async () => {
    if (!staff.isAdmin(player)) {
      player.sendMessage(errorMsg(TEXT.cmd.onlyAdminsCreateForOthers));
      back?.();
      return;
    }

    // Everyone on record, not only the online: the case this exists for is
    // often a player who is not here.
    const candidates = players.allKnown().filter((ref) => !clans.clanOf(ref.id));
    if (candidates.length === 0) {
      player.sendMessage(msg(TEXT.menu.noPlayersOnRecord));
      back?.();
      return;
    }

    const target = await pickPlayer(player, {
      back,
      title: TEXT.menu.createForATitle,
      body: TEXT.menu.createForABody,
      candidates,
      describe: (ref) => `${onlineDot(ref)} ${C.white}${truncate(ref.name, 20)}`,
    });
    if (!target) return;

    const response = await modal(TEXT.menu.createForATitle)
      .label(TEXT.menu.createForABody)
      .textField(
        'name',
        TEXT.menu.createForANameLabel(target.name),
        'Wolves',
      )
      .submitButton(TEXT.menu.create)
      .show(player);

    if (response.canceled) {
      createClanForPlayer(player, back);
      return;
    }

    const result = clans.createClan(target.id, target.name, response.str('name'));
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      createClanForPlayer(player, back);
      return;
    }

    player.sendMessage(
      successMsg(TEXT.cmd.outpostCreatedFor(result.value.name, target.name)),
    );
    players.notify(target.id, msg(TEXT.cmd.adminCreatedYourOutpost(result.value.name)));
    announce.clanCreated(result.value.name, target.name);
    back?.();
  });
}


/**
 * Proposes a new name for the clan. Like creation, it goes through review —
 * the same question is being asked, and a clan that could rename freely would
 * sidestep whatever review its first name went through.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function renameClanForm(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;
    if (!clans.isOwner(clan, player.id)) {
      player.sendMessage(errorMsg(TEXT.common.notClanLeaderRename));
      myClanMenu(player);
      return;
    }

    const needsApproval = requests.approvalRequiredFor(player);
    const response = await modal(`${C.aqua}Rename ${truncate(clan.name, 16)}`)
      .label(
        needsApproval
          ? TEXT.menu.renameNeedsReview
          : TEXT.menu.renameImmediate,
      )
      .textField('name', TEXT.menu.newName, clan.name, { defaultValue: clan.name })
      .submitButton(needsApproval ? TEXT.menu.request : TEXT.menu.rename)
      .show(player);

    if (response.canceled) {
      myClanMenu(player);
      return;
    }

    const wanted = response.str('name');
    if (!needsApproval) {
      const renamed = clans.rename(clanId, wanted);
      player.sendMessage(
        renamed.ok
          ? successMsg(TEXT.cmd.roleSet(renamed.value.from, renamed.value.to))
          : errorMsg(renamed.error),
      );
      myClanMenu(player);
      return;
    }

    const filed = requests.fileRename({ id: player.id, name: player.name }, clan, wanted);
    if (!filed.ok) {
      player.sendMessage(errorMsg(filed.error));
    } else {
      player.sendMessage(
        msg(TEXT.cmd.renameRequested(filed.value.newName)),
      );
      requests.notifyReviewers(filed.value);
    }
    myClanMenu(player);
  });
}


/**
 * @param {Player} player
 * @param {() => void} [back]
 */
export function myClanMenu(player, back) {
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.notInAClan));
      return;
    }

    const owner = clans.isOwner(clan, player.id);
    const outpost = clans.isOutpost(clan);
    const threshold = settings.promotionThreshold();
    const tierLine = outpost
      ? `${C.gray}Tier: ${C.gray}Outpost${C.gray} (${clans.memberCount(clan)}/${threshold} to promote)`
      : TEXT.menu.tierFullClan;

    const form = action()
      .title(`${C.aqua}${truncate(clan.name, 24)}`)
      .body(
        TEXT.menu.membersLeaderYourRole(tierLine, clans.memberCount(clan), clans.capacity(clan), players.displayName(clan.ownerId), clans.roleOf(clan, player.id) || TEXT.fragment.noRole),
      );

    /** @type {Array<() => void>} */
    const actions = [];

    const home = () => myClanMenu(player, back);

    form.button(TEXT.menu.membersViewAndManage);
    actions.push(() => memberBrowser(player, clan.id, home));

    if (owner && outpost) {
      form.button(TEXT.menu.requestPromotionButton);
      actions.push(() => promotionRequest(player));
    }

    if (owner) {
      form.button(TEXT.menu.renameClan);
      actions.push(() => renameClanForm(player, clan.id));

      const colors = settings.get().display.colors;
      form.button(
        TEXT.menu.clanColour(
          clans.colorOf(clan, colors),
          clan.color ? clan.name : TEXT.menu.clanColourUsingDefault,
        ),
      );
      actions.push(() => clanColorForm(player, clan.id, home));

      form.button(TEXT.menu.inviteAPlayer);
      actions.push(() => invitePicker(player, clan.id));

      form.button(TEXT.menu.clanRolesDefined(clan.roles.length));
      actions.push(() => clanRolesMenu(player, clan.id, home));

      form.button(TEXT.menu.transferLeadership);
      actions.push(() => transferPicker(player, clan.id));

      form.button(TEXT.menu.disbandClan);
      actions.push(() => disbandFlow(player, clan.id));
    } else {
      form.button(TEXT.menu.leaveClan);
      actions.push(() => leaveFlow(player, clan.id, home));
    }

    if (back) {
      form.button(TEXT.menu.back);
      actions.push(back);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}


/**
 * Sets the colour every member of a clan is drawn in.
 *
 * The Leader's choice, not each member's: a clan colour is a way to recognise
 * the clan across a server, which per-member overrides would take away. The
 * add-on-wide colour in the display settings is only the default this starts
 * from, and clearing the choice here returns the clan to it.
 *
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [back]
 */
export function clanColorForm(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.clanGone));
      return;
    }
    if (!clans.mayManage(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.notClanLeaderColour));
      back?.();
      return;
    }

    // The palette with an extra first entry standing for "no choice", so
    // clearing the colour is a normal selection rather than a second control.
    const choices = [TEXT.menu.clanColourDefault, ...colorOptions()];
    const current = clan.color ? colorIndex(clan.color) + 1 : 0;

    const response = await modal(TEXT.menu.clanColourTitle)
      .label(TEXT.menu.clanColourBody)
      .dropdown('color', TEXT.menu.colour, choices, { defaultValueIndex: current })
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) {
      back?.();
      return;
    }

    const picked = response.num('color');
    const result = clans.setColor(clanId, picked === 0 ? '' : colorAt(picked - 1));
    player.sendMessage(
      result.ok ? successMsg(TEXT.menu.clanColourUpdated) : errorMsg(result.error),
    );
    back?.();
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [back]
 */
export function memberBrowser(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.clanGone));
      return;
    }

    const rows = clans.memberList(clan);
    const chosen = await pickFrom(player, {
      title: TEXT.menu.members(truncate(clan.name, 20)),
      body: TEXT.menu.memberBrowserBody(rows.length),
      items: rows,
      describe: (row) => memberLabel(clan, row),
      match: (row) => row.member.name,
      back,
    });

    if (!chosen) return;
    memberActions(player, clan.id, chosen.id, back);
  });
}


/**
 * Actions available against a single member. What is offered depends on
 * whether the viewer owns this clan or holds clan-management access.
 *
 * @param {Player} player
 * @param {string} clanId
 * @param {string} memberId
 * @param {() => void} [back]
 */
function memberActions(player, clanId, memberId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan || !clan.members[memberId]) {
      player.sendMessage(errorMsg(TEXT.menu.thatMemberIsNoLonger));
      return;
    }

    const member = clan.members[memberId];
    const owner = clans.isOwner(clan, player.id);
    const manager = staff.canManageAnyClan(player);
    const isTargetOwner = clans.isOwner(clan, memberId);
    const returnHere = () => memberBrowser(player, clanId, back);

    const form = action()
      .title(`${C.white}${truncate(member.name, 24)}`)
      .body(
        TEXT.menu.clanRoleStatus(clan.name, clans.roleOf(clan, memberId) || TEXT.fragment.noRole, players.onlinePlayer(memberId) ? `${C.green}${TEXT.fragment.online}` : `${C.darkGray}${TEXT.fragment.offline}`),
      );

    /** @type {Array<() => void>} */
    const actions = [];

    if ((owner || manager) && !isTargetOwner) {
      form.button(TEXT.menu.setRole);
      actions.push(() => setRoleForm(player, clanId, memberId, returnHere));

      form.button(TEXT.menu.make);
      actions.push(() => makeLeaderFlow(player, clanId, memberId, returnHere));

      form.button(TEXT.menu.removeFromClan);
      actions.push(() => removeMemberFlow(player, clanId, memberId, returnHere));
    }

    if (actions.length === 0) {
      form.button(TEXT.menu.back);
      actions.push(returnHere);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      returnHere();
      return;
    }
    actions[response.selection]?.();
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 * @param {string} memberId
 * @param {() => void} back
 */
function setRoleForm(player, clanId, memberId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan || !clan.members[memberId]) return;
    if (!clans.mayManage(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.cannotChangeRoles));
      back();
      return;
    }

    const current = clans.roleOf(clan, memberId);
    const choices = [TEXT.fragment.pickNoRole, ...clan.roles, TEXT.fragment.pickNewRole];
    const currentIndex = current ? Math.max(0, clan.roles.indexOf(current) + 1) : 0;

    const response = await modal(TEXT.menu.roleForLabel(truncate(clan.members[memberId].name, 16)))
      .dropdown('existing', TEXT.menu.existingRoles, choices, {
        defaultValueIndex: currentIndex,
      })
      .textField('typed', TEXT.menu.orANewRoleName, 'Officer', { defaultValue: '' })
      .submitButton(TEXT.menu.apply)
      .show(player);

    if (response.canceled) {
      back();
      return;
    }

    const index = response.num('existing');
    const typed = response.str('typed').trim();
    // A typed name wins over the dropdown selection.
    const role = typed !== '' ? typed : index === 0 ? '' : (clan.roles[index - 1] ?? '');

    const result = clans.setMemberRole(clan.id, memberId, role);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else if (result.value === '') {
      player.sendMessage(successMsg(TEXT.cmd.roleCleared(clan.members[memberId].name)));
      players.notify(memberId, msg(TEXT.cmd.yourRoleCleared(clan.name)));
    } else {
      player.sendMessage(successMsg(TEXT.cmd.roleSet(clan.members[memberId].name, result.value)));
      players.notify(memberId, msg(TEXT.cmd.yourRoleIsNow(result.value, clan.name)));
    }
    back();
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 * @param {string} memberId
 * @param {() => void} back
 */
function removeMemberFlow(player, clanId, memberId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan || !clan.members[memberId]) return;
    if (!clans.mayManage(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.cannotRemoveMembers));
      back();
      return;
    }

    const name = clan.members[memberId].name;
    if (!(await confirm(player, TEXT.menu.removeMember, TEXT.menu.removeMemberConfirm(name, clan.name), 'Remove'))) {
      back();
      return;
    }

    const result = clans.removeMember(clan.id, memberId);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else {
      player.sendMessage(successMsg(TEXT.cmd.removeConfirmed(result.value, clan.name)));
      announce.memberLeft(clan.name, result.value, true);
      players.notify(memberId, msg(TEXT.cmd.youWereRemoved(clan.name)));
      for (const id of Object.keys(clan.members)) {
        players.notify(id, msg(TEXT.cmd.memberWasRemoved(result.value)));
      }
    }
    back();
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 * @param {string} memberId
 * @param {() => void} back
 */
function makeLeaderFlow(player, clanId, memberId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan || !clan.members[memberId]) return;
    if (!clans.mayManage(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.cannotChangeLeadership));
      back();
      return;
    }

    const name = clan.members[memberId].name;
    const body =
      TEXT.menu.makeLeaderConfirm(name, clan.name) +
      TEXT.menu.becomesAnOrdinaryMember(players.displayName(clan.ownerId));
    if (!(await confirm(player, TEXT.menu.transferLeadership, body, `Make ${LEADER_ROLE}`))) {
      back();
      return;
    }

    const result = clans.transferLeadership(clan.id, memberId);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else {
      player.sendMessage(successMsg(TEXT.cmd.nowLeads(result.value.newOwnerName, clan.name)));
      for (const id of Object.keys(clan.members)) {
        players.notify(
          id,
          msg(TEXT.cmd.memberRoleAnnounced(result.value.newOwnerName, clan.name)),
        );
      }
    }
    back();
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 */
function transferPicker(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const candidates = clans.memberList(clan).filter((row) => row.id !== clan.ownerId);
    if (candidates.length === 0) {
      player.sendMessage(errorMsg(TEXT.menu.noOneToLead));
      myClanMenu(player);
      return;
    }

    const chosen = await pickFrom(player, {
      title: TEXT.menu.transferLeadership,
      body: TEXT.menu.chooseNewLeader(clan.name),
      items: candidates,
      describe: (row) => memberLabel(clan, row),
      match: (row) => row.member.name,
    });

    if (!chosen) {
      myClanMenu(player);
      return;
    }
    makeLeaderFlow(player, clanId, chosen.id, () => myClanMenu(player));
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [back]
 */
function leaveFlow(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    if (!(await confirm(player, TEXT.menu.leaveClan, `${C.gray}Leave ${C.aqua}${clan.name}${C.gray}?`, 'Leave'))) {
      back?.();
      return;
    }

    const result = clans.removeMember(clan.id, player.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      return;
    }
    player.sendMessage(msg(TEXT.cmd.youLeft(clan.name)));
    announce.memberLeft(clan.name, player.name, false);
    for (const id of Object.keys(clan.members)) {
      players.notify(id, msg(TEXT.cmd.memberLeft(player.name)));
    }
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [back]
 */
export function disbandFlow(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;
    if (!clans.mayManage(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotDisbandThatClan));
      back?.();
      return;
    }

    const body =
      TEXT.menu.disbandConfirmLine(clan.name) +
      TEXT.menu.disbandConfirmWarning(clans.memberCount(clan));
    if (!(await confirm(player, TEXT.menu.disbandClan, body, 'Disband'))) {
      back ? back() : myClanMenu(player);
      return;
    }

    const memberIds = Object.keys(clan.members);
    const result = clans.disband(clan.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      return;
    }

    // Outstanding invites are held by non-members, so they need their own sweep.
    invites.revokeAllForClan(clanId);
    for (const id of memberIds) {
      players.notify(id, msg(TEXT.cmd.clanWasDisbanded(result.value.name)));
    }
    announce.clanDisbanded(result.value.name);
    player.sendMessage(successMsg(TEXT.cmd.disbandConfirmed(result.value.name)));
    back?.();
  });
}


// ── Invites ───────────────────────────────────────────────────────────────

/**
 * Picks someone to invite from every player the world has seen, so an owner can
 * invite a player who is offline right now.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function invitePicker(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    // Anyone already in a clan, or already holding this clan's invite, is not
    // an eligible target, so none is shown that would then be refused.
    const candidates = players
      .allKnown()
      .filter(
        (ref) =>
          ref.id !== player.id &&
          !clans.clanOf(ref.id) &&
          !invites.pendingFor(ref.id).some((i) => i.clanId === clanId),
      );

    if (candidates.length === 0) {
      player.sendMessage(
        errorMsg(TEXT.menu.nobodyIsAvailableToInvite),
      );
      myClanMenu(player);
      return;
    }

    const target = await pickPlayer(player, {
      title: `${C.green}Invite to ${truncate(clan.name, 16)}`,
      body: TEXT.menu.offlinePlayersCanBeInvited,
      candidates,
      describe: (ref) => `${onlineDot(ref)} ${C.white}${truncate(ref.name, 22)}`,
    });

    if (!target) {
      myClanMenu(player);
      return;
    }

    const result = invites.invite(
      clan,
      { id: player.id, name: player.name },
      { id: target.id, name: target.name },
    );
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else {
      player.sendMessage(successMsg(TEXT.cmd.inviteSent(target.name, clan.name)));
      players.notify(
        target.id,
        msg(
          TEXT.menu.invitedYouToJoinOpen(player.name, clan.name),
        ),
      );
    }
    myClanMenu(player);
  });
}


/**
 * @param {Player} player
 * @param {() => void} [back]
 */
export function invitesMenu(player, back) {
  const leave = back ?? (() => {});

  run(player, async () => {
    const pending = invites.pendingFor(player.id);
    if (pending.length === 0) {
      player.sendMessage(msg(TEXT.cmd.noPendingInvitesLine));
      leave();
      return;
    }

    const form = action()
      .title(TEXT.menu.clanInvites)
      .body(TEXT.menu.invitesBody(pending.length));
    for (const invite of pending) {
      form.button(TEXT.menu.from(truncate(invite.clanName, 20), invite.byName));
    }
    form.button(TEXT.menu.back);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      leave();
      return;
    }

    const chosen = pending[response.selection];
    if (chosen) respondToInvite(player, chosen);
    else leave();
  });
}


/**
 * @param {Player} player
 * @param {import('../invites.js').Invite} invite
 */
function respondToInvite(player, invite) {
  run(player, async () => {
    const form = action()
      .title(`${C.aqua}${truncate(invite.clanName, 24)}`)
      .body(TEXT.menu.invitedYouToJoin(invite.byName, invite.clanName))
      .button(TEXT.menu.accept)
      .button(TEXT.menu.decline)
      .button(TEXT.menu.decideLater);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined || response.selection === 2) {
      invitesMenu(player);
      return;
    }

    if (response.selection === 0) {
      const result = invites.accept({ id: player.id, name: player.name }, invite);
      if (!result.ok) {
        player.sendMessage(errorMsg(result.error));
        invitesMenu(player);
        return;
      }
      player.sendMessage(successMsg(TEXT.cmd.youJoined(result.value.name)));
      announce.memberJoined(result.value.name, player.name);
      for (const id of Object.keys(result.value.members)) {
        if (id !== player.id) players.notify(id, msg(TEXT.cmd.memberJoined(player.name)));
      }
      myClanMenu(player);
      return;
    }

    invites.decline(player.id, invite);
    player.sendMessage(msg(TEXT.cmd.declineConfirmed(invite.clanName)));
    players.notify(
      invite.byId,
      msg(TEXT.cmd.inviteDeclined(player.name, invite.clanName)),
    );
    invitesMenu(player);
  });
}


// ── Clan roles ────────────────────────────────────────────────────────────

/**
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [back]
 */
function clanRolesMenu(player, clanId, back) {
  const leave = back ?? (() => myClanMenu(player));

  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const form = action()
      .title(TEXT.menu.clanRoles)
      .body(
        TEXT.menu.clanRolesBody,
      )
      .button(TEXT.menu.addARole);
    for (const role of clan.roles) {
      const holders = Object.values(clan.members).filter((m) => m.role === role).length;
      form.button(TEXT.menu.clanRowMembers(truncate(role, 20), holders));
    }
    form.button(TEXT.menu.back);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      leave();
      return;
    }

    if (response.selection === 0) {
      addClanRoleForm(player, clanId);
      return;
    }

    const role = clan.roles[response.selection - 1];
    if (role) deleteClanRoleFlow(player, clanId, role);
    else leave();
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 */
function addClanRoleForm(player, clanId) {
  run(player, async () => {
    const response = await modal(`${C.green}Add a Role`)
      .textField('name', TEXT.menu.roleName, 'Officer')
      .submitButton(TEXT.menu.add)
      .show(player);

    if (response.canceled) {
      clanRolesMenu(player, clanId);
      return;
    }

    const clan = clans.getClan(clanId);
    if (!clan) return;

    const result = clans.addClanRole(clan.id, response.str('name'));
    player.sendMessage(
      result.ok ? successMsg(TEXT.menu.addedTheRole(result.value)) : errorMsg(result.error),
    );
    clanRolesMenu(player, clanId);
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 * @param {string} role
 */
function deleteClanRoleFlow(player, clanId, role) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const body =
      TEXT.menu.deleteTheRole(role) +
      TEXT.menu.membersHoldingItWillSimply;
    if (!(await confirm(player, TEXT.menu.deleteRole, body, 'Delete'))) {
      clanRolesMenu(player, clanId);
      return;
    }

    const result = clans.deleteClanRole(clan.id, role);
    player.sendMessage(result.ok ? successMsg(TEXT.menu.deleted(result.value)) : errorMsg(result.error));
    clanRolesMenu(player, clanId);
  });
}


// ── Browsing ──────────────────────────────────────────────────────────────

/**
 * @param {Player} player
 * @param {() => void} [back]
 */
export function browseClans(player, back) {
  const leave = back ?? (() => {});

  run(player, async () => {
    const all = clans.allClans();
    if (all.length === 0) {
      player.sendMessage(msg(TEXT.menu.noClansExistYet));
      leave();
      return;
    }

    const chosen = await pickFrom(player, {
      back: leave,
      title: TEXT.menu.clans2,
      body: TEXT.menu.clanCountBody(all.length),
      items: all,
      describe: (clan) =>
        TEXT.menu.memberS4(
          truncate(clan.name, 20),
          clans.memberCount(clan),
          players.displayName(clan.ownerId),
        ),
      match: (clan) => clan.name,
    });

    if (!chosen) return;
    memberBrowser(player, chosen.id, () => browseClans(player, back));
  });
}


// ── Outpost promotion ─────────────────────────────────────────────────────

/**
 * Files a promotion request for the player's outpost.
 *
 * @param {Player} player
 */
export function promotionRequest(player) {
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.notInAClan));
      return;
    }

    const needed = settings.promotionThreshold();
    const have = clans.memberCount(clan);
    const body =
      `${C.gray}${clan.name} is an ${C.gray}outpost${C.gray}.\n` +
      `${C.gray}Members: ${C.white}${have}${C.gray}/${needed}\n\n` +
      (have >= needed
        ? TEXT.menu.promotionAvailable
        : TEXT.menu.promotionShortBy(needed - have));

    if (have < needed) {
      const info = action()
        .title(TEXT.menu.requestPromotion)
        .body(body)
        .button(TEXT.menu.close);
      await show(info, player);
      return;
    }

    if (!(await confirm(player, TEXT.menu.requestPromotion, body, TEXT.menu.requestPromotion3))) {
      return;
    }

    const filed = requests.filePromotion({ id: player.id, name: player.name }, clan);
    if (!filed.ok) {
      player.sendMessage(errorMsg(filed.error));
      return;
    }

    player.sendMessage(
      msg(TEXT.menu.promotionRequested(clan.name)),
    );
    for (const reviewer of world.getAllPlayers()) {
      if (!requests.canApprovePromotions(reviewer)) continue;
      reviewer.sendMessage(
        msg(
          TEXT.menu.promotionReviewNotice(clan.name),
        ),
      );
    }
  });
}
