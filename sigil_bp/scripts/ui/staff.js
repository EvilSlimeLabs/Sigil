// @ts-check
/**
 * The screens behind the Admin and System Settings buttons: managing other
 * people's clans, staff roles and their assignment, the two review queues, and
 * purging a player.
 */

import { action, showAction as show, modal } from '../forms.js';
import { C, ROLE_COLOR_CHOICES } from '../config.js';
import {
  errorMsg,
  successMsg,
  msg,
  truncate,
  validateStaffRoleName,
  validateStaffSymbol,
} from '../format.js';
import { TEXT } from '../text.js';
import { purge } from '../purge.js';
import * as clans from '../clans.js';
import * as staff from '../staff.js';
import * as requests from '../requests.js';
import * as wars from '../wars.js';
import * as peaceful from '../peaceful.js';
import * as settings from '../settings.js';
import * as announce from '../announce.js';
import * as players from '../players.js';
import * as display from '../display.js';
import {
  SHOW_AS_OPTIONS,
  bracketAnswers,
  canReachAdminTools,
  colorOptions,
  confirm,
  onlineDot,
  pickFrom,
  pickPlayer,
  run,
  showAsAt,
  showAsIndex,
  symbolAt,
  symbolChoicesFor,
  symbolIndex,
  symbolOptions,
  withBracketControls,
} from './shared.js';
import { createClanForPlayer, disbandFlow, memberBrowser } from './clan.js';
import { peacefulPicker, peacefulRoster } from './peaceful.js';
import { adminTitleForm, displaySettingsMenu, settingsMenu } from './settings.js';
import { clanWarHistory, staffWarBrowser } from './war.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../clans.js').Clan} Clan */

/**
 * Acting on the world: other people's clans, the wars between them, the review
 * queue, and the two blunt instruments for a player who has to be dealt with.
 *
 * The split from {@link systemSettingsMenu} is between doing and configuring.
 * Everything here is a thing that happens to a specific clan or player right
 * now; everything there is a rule that then applies to everybody.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function adminMenu(player, back) {
  run(player, async () => {
    if (!canReachAdminTools(player)) {
      player.sendMessage(errorMsg(TEXT.common.notClanManager));
      back?.();
      return;
    }

    const form = action().title(TEXT.menu.adminToolsTitle).body(TEXT.menu.adminToolsBody);

    /** @type {Array<() => void>} */
    const actions = [];
    const home = () => adminMenu(player, back);

    if (requests.canApprove(player) || requests.canApprovePromotions(player)) {
      const queued = requests.reviewableBy(player).length;
      form.button(
        queued > 0
          ? TEXT.menu.clanRequestsAwaitingReview(queued)
          : TEXT.menu.clanRequestsQueueIsEmpty,
      );
      actions.push(() => requestQueue(player, home));
    }

    // Its own button rather than a section of the one above: a demotion is
    // raised by the system rather than asked for, and its count reads on its
    // own instead of being folded into the request total.
    if (requests.canApprovePromotions(player)) {
      const understrength = requests.demotionsReviewableBy(player).length;
      form.button(
        understrength > 0
          ? TEXT.menu.clanDemotionsAwaitingReview(understrength)
          : TEXT.menu.clanDemotionsQueueIsEmpty,
      );
      actions.push(() => demotionQueue(player, home));
    }

    if (staff.canManageAnyClan(player)) {
      form.button(TEXT.menu.manageClansStaff);
      actions.push(() => staffClanBrowser(player, home));

      if (settings.warsEnabled()) {
        const liveCount = wars.liveWars().length;
        form.button(
          liveCount > 0 ? TEXT.menu.activeWarsInProgress(liveCount) : TEXT.menu.activeWarsNone,
        );
        actions.push(() => staffWarBrowser(player, home));
      }
    }

    if (peaceful.canAssign(player)) {
      const config = settings.get().display.peaceful;
      form.button(TEXT.menu.peacefulRosterButton(config.color, config.name, peaceful.all().length));
      actions.push(() => peacefulRoster(player));
    }

    if (staff.isAdmin(player)) {
      form.button(TEXT.menu.createForAPlayerAdmin);
      actions.push(() => createClanForPlayer(player, home));

      form.button(TEXT.menu.purgeAPlayerAdmin);
      actions.push(() => purgePicker(player, home));
    }

    if (back) {
      form.button(TEXT.menu.back);
      actions.push(back);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back?.();
      return;
    }
    actions[response.selection]?.();
  });
}


/**
 * Configuring the add-on: the rules, the look, and who counts as staff.
 *
 * Admin-only in full, unlike {@link adminMenu}, which a staff role can reach a
 * corner of. A clan-managing role that could edit the settings could switch on
 * its own right to approve clans, so the whole screen stays with operators.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function systemSettingsMenu(player, back) {
  run(player, async () => {
    if (!staff.canManageStaffRoles(player)) {
      player.sendMessage(errorMsg(TEXT.common.notAdminSettings));
      back?.();
      return;
    }

    const home = () => systemSettingsMenu(player, back);
    const form = action()
      .title(TEXT.menu.systemSettingsTitle)
      .body(TEXT.menu.systemSettingsBody)
      .button(TEXT.menu.settingsAdmin)
      .button(TEXT.menu.displaySettingsAdmin)
      .button(TEXT.menu.staffRolesAdmin);

    /** @type {Array<() => void>} */
    const actions = [
      () => settingsMenu(player),
      () => displaySettingsMenu(player, home),
      () => staffRoleMenu(player, home),
    ];

    if (back) {
      form.button(TEXT.menu.back);
      actions.push(back);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back?.();
      return;
    }
    actions[response.selection]?.();
  });
}


// ── Staff: clan management ────────────────────────────────────────────────

/**
 * The staff view over every clan. Reachable by admins and by holders of a staff
 * role with clan-management access.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function staffClanBrowser(player, back) {
  run(player, async () => {
    if (!staff.canManageAnyClan(player)) {
      player.sendMessage(errorMsg(TEXT.common.notClanManager));
      return;
    }

    const all = clans.allClans();
    if (all.length === 0) {
      player.sendMessage(msg(TEXT.menu.noClansExistYet));
      back?.();
      return;
    }

    const chosen = await pickFrom(player, {
      back,
      title: TEXT.menu.manageClans,
      body: TEXT.menu.selectAClanToManage,
      items: all,
      describe: (clan) =>
        TEXT.menu.memberS4(
          truncate(clan.name, 20),
          clans.memberCount(clan),
          players.displayName(clan.ownerId),
        ),
      match: (clan) => clan.name,
    });

    if (chosen) staffClanDetail(player, chosen.id, back);
  });
}


/**
 * Promotes an outpost to a full clan on an admin's say-so.
 *
 * The request queue exists so that promotion is reviewed and so that an outpost
 * meets a membership threshold before it is granted. This skips both. When the
 * outpost is below the threshold the confirmation says so and names the
 * shortfall, so an admin waiving the rule is doing it knowingly rather than
 * without being told.
 *
 * Any promotion request the clan already has in the queue is withdrawn, since
 * there is nothing left to review.
 *
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [back]
 */
function promoteOutpostFlow(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.clanGone));
      back?.();
      return;
    }
    if (!staff.isAdmin(player)) {
      player.sendMessage(errorMsg(TEXT.common.notAdminPurge));
      back?.();
      return;
    }
    if (!clans.isOutpost(clan)) {
      player.sendMessage(errorMsg(TEXT.clan.alreadyAFullClan(clan.name)));
      back?.();
      return;
    }

    const needed = settings.promotionThreshold();
    const have = clans.memberCount(clan);
    const body =
      have < needed
        ? TEXT.menu.promoteOutpostShortBody(clan.name, have, needed)
        : TEXT.menu.promoteOutpostBody(clan.name, have, needed);

    if (!(await confirm(player, TEXT.menu.promoteOutpostTitle, body, TEXT.menu.promoteAnyway))) {
      back?.();
      return;
    }

    const promoted = clans.promote(clanId);
    if (!promoted.ok) {
      player.sendMessage(errorMsg(promoted.error));
      back?.();
      return;
    }

    for (const request of requests.all()) {
      if (request.kind === 'promote' && request.clanId === clanId) requests.withdraw(request.id);
    }

    player.sendMessage(successMsg(TEXT.menu.isNowAFullClan(promoted.value.name)));
    for (const id of Object.keys(promoted.value.members)) {
      players.notify(id, msg(TEXT.menu.promotedNotice(promoted.value.name)));
    }
    announce.clanPromoted(promoted.value.name);
    back?.();
  });
}

/**
 * Puts a player into a clan without an invite.
 *
 * The invite flow exists so that nobody joins a clan without agreeing to it,
 * and this steps around it: admin-only, and the player is told they were
 * added.
 *
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [back]
 */
function addMemberFlow(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.clanGone));
      back?.();
      return;
    }
    if (!staff.isAdmin(player)) {
      player.sendMessage(errorMsg(TEXT.common.notAdminPurge));
      back?.();
      return;
    }

    const candidates = players.allKnown().filter((ref) => !clans.clanOf(ref.id));
    if (candidates.length === 0) {
      player.sendMessage(msg(TEXT.menu.everyKnownPlayerIsInAClan));
      back?.();
      return;
    }

    const target = await pickPlayer(player, {
      back,
      title: TEXT.menu.addAMemberTitle,
      body: TEXT.menu.addAMemberBody(clan.name),
      candidates,
      describe: (ref) => `${onlineDot(ref)} ${C.white}${truncate(ref.name, 20)}`,
    });
    if (!target) return;

    const added = clans.addMember(clan.id, target.id, target.name);
    if (!added.ok) {
      player.sendMessage(errorMsg(added.error));
      back?.();
      return;
    }

    player.sendMessage(successMsg(TEXT.menu.addedToClan(target.name, clan.name)));
    players.notify(target.id, msg(TEXT.menu.adminAddedYou(clan.name)));
    announce.memberJoined(clan.name, target.name);
    for (const id of Object.keys(added.value.members)) {
      if (id !== target.id) players.notify(id, msg(TEXT.cmd.memberJoined(target.name)));
    }
    back?.();
  });
}


/**
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [fromBrowser] where the browser this was opened from goes
 */
function staffClanDetail(player, clanId, fromBrowser) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.clanGone));
      return;
    }

    const back = () => staffClanBrowser(player, fromBrowser);
    const form = action()
      .title(`${C.gold}${truncate(clan.name, 22)}`)
      .body(
        TEXT.menu.leaderMembers(players.displayName(clan.ownerId), clans.memberCount(clan)),
      )
      .button(TEXT.menu.membersRemoveSetRoleMake);

    /** @type {Array<() => void>} */
    const actions = [
      () => memberBrowser(player, clanId, () => staffClanDetail(player, clanId, fromBrowser)),
    ];

    if (settings.warsEnabled()) {
      form.button(TEXT.menu.warRecordsPrintAPast);
      actions.push(() => clanWarHistory(player, clanId));
    }

    // Adding straight to the roster skips the invite, which exists so that
    // nobody is put in a clan without agreeing. An admin overriding that is the
    // point of the button, so it is admin-only rather than a clan-management
    // power a staff role can hold.
    if (staff.isAdmin(player)) {
      form.button(TEXT.menu.addAMemberAdmin);
      actions.push(() => addMemberFlow(player, clanId, back));
    }

    // Promotion without the request queue, and without the membership rule the
    // queue enforces. The flow warns before it goes through when the outpost is
    // short, so the rule is still visible even though it does not bind.
    if (staff.isAdmin(player) && clans.isOutpost(clan)) {
      form.button(TEXT.menu.promoteToFullClanAdmin);
      actions.push(() => promoteOutpostFlow(player, clanId, back));
    }

    form.button(TEXT.menu.disbandClan);
    actions.push(() => disbandFlow(player, clanId, back));

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back();
      return;
    }
    actions[response.selection]?.();
  });
}


// ── Staff: role administration ────────────────────────────────────────────

/**
 * @param {Player} player
 * @param {() => void} [back]
 */
export function staffRoleMenu(player, back) {
  run(player, async () => {
    if (!staff.canManageStaffRoles(player)) {
      player.sendMessage(errorMsg(TEXT.common.notAdminStaffRoles));
      return;
    }

    const roles = staff.allRoles();
    const admin = settings.get().display.admin;
    const form = action()
      .title(TEXT.menu.staffRoles)
      .body(
        TEXT.menu.staffRolesBody,
      )
      .button(TEXT.menu.createARole)
      .button(TEXT.menu.assignToAPlayer)
      .button(
        TEXT.menu.assignStacksWithAnySystem(settings.get().display.peaceful.color, settings.get().display.peaceful.name),
      )
      // Admin is not a staff role and cannot be created, deleted or assigned —
      // it comes from operator status. But it is a system title with a symbol,
      // a name and a colour like the others, and those are edited here so that
      // "change how a system role looks" is one place rather than two. The form
      // it opens is narrower for the same reason it cannot be assigned.
      .button(TEXT.menu.adminTitleRow(admin.color, admin.name));
    for (const role of roles) {
      form.button(
        `${role.color}${truncate(role.name, 18)}\n` +
          `${C.gray}${role.manageClans ? TEXT.menu.managesClans : TEXT.menu.noClanAccess}`,
      );
    }
    if (back) form.button(TEXT.menu.back);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back?.();
      return;
    }

    if (response.selection === 0) {
      staffRoleEditor(player, undefined);
      return;
    }
    if (response.selection === 1) {
      staffAssignPicker(player);
      return;
    }
    if (response.selection === 2) {
      peacefulPicker(player);
      return;
    }
    if (response.selection === 3) {
      adminTitleForm(player, () => staffRoleMenu(player, back));
      return;
    }

    const role = roles[response.selection - 4];
    if (role) staffRoleDetail(player, role.id);
    else back?.();
  });
}


/**
 * @param {Player} player
 * @param {string} roleId
 */
function staffRoleDetail(player, roleId) {
  run(player, async () => {
    const role = staff.roleById(roleId);
    if (!role) {
      staffRoleMenu(player);
      return;
    }

    const holders = staff.allAssignments().filter((a) => a.role.id === roleId);
    const form = action()
      .title(`${role.color}${truncate(role.name, 22)}`)
      .body(
        TEXT.menu.staffRoleDetailBody(
          staff.roleTag(role),
          role.manageClans ? TEXT.menu.yes : TEXT.menu.no,
          role.priority,
          holders.length,
          role.builtin ? TEXT.menu.builtInRoleCannotBeDeleted : '',
        ),
      )
      .button(TEXT.menu.edit)
      .button(role.builtin ? TEXT.menu.deleteBuiltInDisabled : TEXT.menu.delete);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      staffRoleMenu(player);
      return;
    }

    if (response.selection === 0) {
      staffRoleEditor(player, roleId);
      return;
    }

    const body = TEXT.menu.deleteStaffRoleConfirm(role.color, role.name, holders.length);
    if (await confirm(player, TEXT.menu.deleteStaffRole, body, 'Delete')) {
      const result = staff.deleteRole(roleId);
      player.sendMessage(result.ok ? successMsg(TEXT.menu.deleted(result.value)) : errorMsg(result.error));
      display.refreshAll();
    }
    staffRoleMenu(player);
  });
}


/**
 * Create (when `roleId` is undefined) or edit a staff role.
 *
 * @param {Player} player
 * @param {string | undefined} roleId
 */
function staffRoleEditor(player, roleId) {
  run(player, async () => {
    const existing = roleId === undefined ? undefined : staff.roleById(roleId);
    const symbols = symbolChoicesFor(existing?.symbol ?? '');
    const colorIndex = Math.max(
      0,
      ROLE_COLOR_CHOICES.findIndex((choice) => choice.code === existing?.color),
    );

    const response = await withBracketControls(
      modal(existing ? `${C.aqua}Edit ${truncate(existing.name, 16)}` : TEXT.menu.createStaffRole)
      .textField('name', TEXT.menu.name, 'Moderator', { defaultValue: existing?.name ?? '' })
      .dropdown('symbol', TEXT.menu.chatTag, symbolOptions(symbols), {
        defaultValueIndex: symbolIndex(symbols, existing?.symbol ?? ''),
      })
      .dropdown(
        'color',
        TEXT.menu.colour,
        colorOptions(),
        { defaultValueIndex: colorIndex },
      )
      .dropdown(
        'showAs',
        TEXT.menu.showAs,
        SHOW_AS_OPTIONS.map((option) => option.label),
        { defaultValueIndex: showAsIndex(existing?.showAs) },
      ),
      existing ?? {},
    )
      .toggle('manageClans', TEXT.menu.mayManageAnyClan, {
        defaultValue: existing?.manageClans ?? false,
      })
      .divider()
      .label(TEXT.menu.rolePowersHint)
      .toggle('approveClans', TEXT.menu.mayApproveClanRequests, {
        defaultValue: existing?.approveClans ?? existing?.manageClans ?? false,
      })
      .toggle('approvePromotions', TEXT.menu.mayApprovePromotions, {
        defaultValue: existing?.approvePromotions ?? existing?.manageClans ?? false,
      })
      .toggle('adjustWarKills', TEXT.menu.mayAdjustWarKills, {
        defaultValue: existing?.adjustWarKills ?? existing?.manageClans ?? false,
      })
      .toggle('generateWarBooks', TEXT.menu.mayPrintWarRecords, {
        defaultValue: existing?.generateWarBooks ?? existing?.manageClans ?? false,
      })
      .toggle('assignPeaceful', TEXT.menu.mayAssignPeaceful, {
        defaultValue: existing?.assignPeaceful ?? existing?.manageClans ?? false,
      })
      .divider()
      .slider('priority', TEXT.menu.priority, 0, 100, {
        defaultValue: existing?.priority ?? 25,
        valueStep: 5,
      })
      .submitButton(existing ? TEXT.menu.save : TEXT.menu.create)
      .show(player);

    if (response.canceled) {
      staffRoleMenu(player);
      return;
    }

    const name = validateStaffRoleName(response.str('name'));
    if (!name.ok) {
      player.sendMessage(errorMsg(name.error));
      staffRoleMenu(player);
      return;
    }
    const symbol = validateStaffSymbol(symbolAt(symbols, response.num('symbol')));
    if (!symbol.ok) {
      player.sendMessage(errorMsg(symbol.error));
      staffRoleMenu(player);
      return;
    }

    const spec = {
      name: name.value,
      symbol: symbol.value,
      color: ROLE_COLOR_CHOICES[response.num('color')]?.code ?? C.blue,
      showAs: showAsAt(response.num('showAs')),
      ...bracketAnswers(response),
      manageClans: response.bool('manageClans'),
      approveClans: response.bool('approveClans'),
      approvePromotions: response.bool('approvePromotions'),
      adjustWarKills: response.bool('adjustWarKills'),
      generateWarBooks: response.bool('generateWarBooks'),
      assignPeaceful: response.bool('assignPeaceful'),
      priority: response.num('priority', 25),
    };

    const result = existing ? staff.updateRole(existing.id, spec) : staff.createRole(spec);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else {
      player.sendMessage(successMsg(existing ? TEXT.menu.saved(spec.name) : TEXT.menu.created(spec.name)));
      display.refreshAll();
    }
    staffRoleMenu(player);
  });
}


/**
 * @param {Player} player
 */
function staffAssignPicker(player) {
  run(player, async () => {
    // Operators are left out rather than shown and refused: Admin is the whole
    // permission, so a staff role on one could only be a weaker duplicate of
    // what they already hold, and the title would never be drawn anyway.
    // Visitors are already gone — `allKnown` drops them.
    const known = players
      .allKnown()
      .filter((ref) => {
        const online = players.onlinePlayer(ref.id);
        return online === undefined || staff.mayHoldRole(online);
      });
    if (known.length === 0) {
      player.sendMessage(msg(TEXT.menu.noPlayersOnRecord));
      staffRoleMenu(player);
      return;
    }

    const target = await pickPlayer(player, {
      title: TEXT.menu.assignStaffRole,
      body: `${C.gray}Choose a player.`,
      candidates: known,
      describe: (ref) => {
        const role = staff.roleOf(ref.id);
        return (
          `${onlineDot(ref)} ${C.white}${truncate(ref.name, 20)}\n` +
          `${C.gray}${role ? role.name : TEXT.fragment.noStaffRole}`
        );
      },
    });

    if (!target) {
      staffRoleMenu(player);
      return;
    }
    staffAssignForm(player, target);
  });
}


/**
 * @param {Player} player
 * @param {import('../players.js').PlayerRef} target
 */
function staffAssignForm(player, target) {
  run(player, async () => {
    // Re-checked here because the picker's list is a snapshot: a player can be
    // opped between it being drawn and this form being answered.
    const live = players.onlinePlayer(target.id);
    if (live && !staff.mayHoldRole(live)) {
      player.sendMessage(errorMsg(TEXT.menu.adminsHoldNoStaffRole(target.name)));
      staffRoleMenu(player);
      return;
    }

    const roles = staff.allRoles();
    const options = [TEXT.fragment.pickNoStaffRole, ...roles.map((r) => `${r.color}${r.name}`)];
    const current = staff.roleOf(target.id);
    const currentIndex = current ? roles.findIndex((r) => r.id === current.id) + 1 : 0;

    const response = await modal(`${C.aqua}${truncate(target.name, 22)}`)
      .dropdown('role', TEXT.menu.staffRole, options, {
        defaultValueIndex: Math.max(0, currentIndex),
      })
      .submitButton(TEXT.menu.apply)
      .show(player);

    if (response.canceled) {
      staffAssignPicker(player);
      return;
    }

    const index = response.num('role');
    const role = index === 0 ? undefined : roles[index - 1];
    staff.assignRole(target.id, role?.id);
    display.refreshById(target.id);

    player.sendMessage(
      successMsg(role ? TEXT.cmd.roleSet(target.name, role.name) : TEXT.menu.staffRoleCleared(target.name)),
    );
    if (role) {
      players.notify(target.id, msg(TEXT.menu.youWereGivenTheStaff(role.name)));
    } else {
      players.notify(target.id, msg(TEXT.menu.yourStaffRoleWasRemoved));
    }
    staffAssignPicker(player);
  });
}


// ── Clan-creation requests ────────────────────────────────────────────────

/**
 * The review queue. Open to admins, and to clan-managing staff roles unless an
 * admin has switched `staffCanApproveClans` off.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function requestQueue(player, back) {
  run(player, async () => {
    // The queue holds both kinds, and the two permissions are separate, so a
    // reviewer only ever sees what they are actually allowed to act on.
    const queue = requests.reviewableBy(player);
    if (queue.length === 0) {
      if (!requests.canApprove(player) && !requests.canApprovePromotions(player)) {
        player.sendMessage(errorMsg(TEXT.common.notReviewer));
      } else {
        player.sendMessage(msg(TEXT.menu.noClanRequestsAreWaiting));
      }
      back?.();
      return;
    }

    const chosen = await pickFrom(player, {
      back,
      title: TEXT.menu.clanRequests,
      body: TEXT.menu.requestQueueBody(queue.length),
      items: queue,
      describe: (request) => {
        // Demotions never reach this screen; they have their own queue.
        const kind =
          request.kind === 'promote'
            ? TEXT.menu.queueRowPromote(request.requesterName)
            : request.kind === 'rename'
              ? TEXT.menu.queueRowRename(request.newName ?? '', request.requesterName)
              : TEXT.menu.queueRowCreate(request.requesterName);
        return TEXT.menu.queueRow(truncate(request.name, 20), kind);
      },
      match: (request) => request.name,
    });

    if (chosen) reviewRequest(player, chosen.id);
  });
}


/**
 * The demotion queue: full clans that have fallen below the membership a
 * promotion needs, waiting on a person to decide.
 *
 * Deliberately a screen of its own. Every other entry in the review queue is
 * something a player asked for and is waiting on; these are reports the system
 * raised about clans, and reading them alongside the asks made both harder to
 * act on.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function demotionQueue(player, back) {
  run(player, async () => {
    if (!requests.canApprovePromotions(player)) {
      player.sendMessage(errorMsg(TEXT.common.notReviewer));
      back?.();
      return;
    }

    const queue = requests.demotionsReviewableBy(player);
    if (queue.length === 0) {
      player.sendMessage(msg(TEXT.menu.noClansAreBelowStrength));
      back?.();
      return;
    }

    const home = () => demotionQueue(player, back);
    const chosen = await pickFrom(player, {
      back,
      title: TEXT.menu.clanDemotions,
      body: TEXT.menu.demotionQueueBody(queue.length),
      items: queue,
      describe: (request) => {
        const clan = request.clanId ? clans.getClan(request.clanId) : undefined;
        const have = clan ? clans.memberCount(clan) : 0;
        return TEXT.menu.queueRow(
          truncate(request.name, 20),
          TEXT.menu.queueRowDemoteCount(have, settings.promotionThreshold()),
        );
      },
      match: (request) => request.name,
    });

    if (chosen) reviewRequest(player, chosen.id, home);
  });
}


/**
 * The "3/5 members" line under a demotion's heading, in red because the number
 * being short is the whole reason the review exists.
 *
 * @param {import('../clans.js').Clan | undefined} clan
 * @returns {string}
 */
function demotionCount(clan) {
  const have = clan ? clans.memberCount(clan) : 0;
  return TEXT.menu.membersOfThreshold(have, settings.promotionThreshold());
}


/**
 * Approve or deny a single request.
 *
 * @param {Player} player
 * @param {string} requestId
 * @param {() => void} [back] the queue to return to, defaulting to the request
 *   queue; a demotion came from its own screen and has to go back to it
 */
function reviewRequest(player, requestId, back) {
  const queue = back ?? (() => requestQueue(player));
  run(player, async () => {
    const request = requests.byId(requestId);
    if (!request) {
      player.sendMessage(errorMsg(TEXT.menu.thatRequestHasAlreadyBeen));
      queue();
      return;
    }

    if (!requests.canApproveRequest(player, request)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotReviewThatKind));
      queue();
      return;
    }

    const requester = players.ref(request.requesterId);
    const promoting = request.kind === 'promote';
    const demoting = request.kind === 'demote';
    const subject = request.clanId ? clans.getClan(request.clanId) : undefined;

    const detail = promoting
      ? TEXT.menu.promotionFromOutpostToFull +
        `${C.gray}Members: ${C.white}${subject ? clans.memberCount(subject) : 0}` +
        `${C.gray}/${settings.promotionThreshold()}\n`
      : demoting
        ? TEXT.menu.demotionFromFullToOutpost + demotionCount(subject)
        : request.kind === 'rename'
          ? `${C.gray}Rename to ${C.aqua}${request.newName}${C.gray}\n`
          : TEXT.menu.aNewClan;

    const form = action()
      .title(`${C.aqua}${truncate(request.name, 22)}`)
      .body(
        // Nobody filed a demotion, so naming a requester and saying whether
        // they are online would be a lie dressed up as detail.
        demoting
          ? TEXT.menu.raisedBySystemBody(detail)
          : TEXT.menu.requestedByStatus(
              detail,
              request.requesterName,
              requester.online
                ? `${C.green}${TEXT.fragment.online}`
                : `${C.darkGray}${TEXT.fragment.offline}`,
            ),
      )
      .button(TEXT.menu.approve)
      .button(TEXT.menu.deny)
      .button(TEXT.menu.back);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined || response.selection === 2) {
      queue();
      return;
    }

    if (response.selection === 0) {
      const approved = requests.approve(requestId);
      if (!approved.ok) {
        player.sendMessage(errorMsg(approved.error));
      } else if (request.kind === 'rename') {
        const { clan } = approved.value;
        player.sendMessage(successMsg(TEXT.cmd.roleSet(request.name, clan.name)));
        for (const id of Object.keys(clan.members)) {
          players.notify(id, msg(TEXT.menu.yourClanIsNowCalled(clan.name)));
        }
      } else if (demoting) {
        const { clan } = approved.value;
        player.sendMessage(successMsg(TEXT.menu.isNowAnOutpost(clan.name)));
        for (const id of Object.keys(clan.members)) {
          players.notify(id, msg(TEXT.menu.hasBeenReturnedToOutpost(clan.name)));
        }
      } else if (promoting) {
        const { clan } = approved.value;
        player.sendMessage(successMsg(TEXT.menu.isNowAFullClan(clan.name)));
        for (const id of Object.keys(clan.members)) {
          players.notify(
            id,
            msg(TEXT.menu.promotedNotice(clan.name)),
          );
        }
        announce.clanPromoted(clan.name);
      } else {
        const { clan } = approved.value;
        player.sendMessage(successMsg(TEXT.menu.creationApproved(clan.name, request.requesterName)));
        players.notify(
          request.requesterId,
          msg(
            TEXT.menu.outpostApproved(clan.name),
          ),
        );
        announce.clanCreated(clan.name, request.requesterName);
      }
      queue();
      return;
    }

    denyRequest(player, requestId, queue);
  });
}


/**
 * Denies a request, with an optional reason passed on to the requester.
 *
 * @param {Player} player
 * @param {string} requestId
 * @param {() => void} [back] the queue to return to
 */
function denyRequest(player, requestId, back) {
  const queue = back ?? (() => requestQueue(player));
  run(player, async () => {
    const response = await modal(TEXT.menu.denyRequest)
      .textField('reason', TEXT.menu.reasonOptional, TEXT.menu.nameIsNotAppropriate)
      .submitButton(TEXT.menu.deny2)
      .show(player);

    if (response.canceled) {
      queue();
      return;
    }

    const reason = response.str('reason').trim();
    const denied = requests.deny(requestId);
    if (!denied.ok) {
      player.sendMessage(errorMsg(denied.error));
    } else if (denied.value.kind === 'demote') {
      // Dismissed rather than denied, and there is no requester to write to. It
      // is raised again the next time the roster or the threshold moves.
      player.sendMessage(msg(TEXT.menu.keepsItsRank(denied.value.name)));
    } else {
      player.sendMessage(msg(TEXT.menu.requestDenied(denied.value.name)));
      players.notify(
        denied.value.requesterId,
        msg(
          TEXT.menu.yourRequestForTheClan(
            denied.value.name,
            reason ? TEXT.menu.reasonGiven(reason) : '',
          ),
        ),
      );
    }
    queue();
  });
}


// ── Purging a player ──────────────────────────────────────────────────────

/**
 * Confirms and performs a full removal of a player from the system.
 *
 * Bans are invisible to scripts, so this is the explicit admin action that
 * stands in for one. See `purge.js` for why it is not inferred.
 *
 * @param {Player} player
 * @param {import('../players.js').PlayerRef} target
 * @param {() => void} [back]
 */
export function purgeConfirm(player, target, back) {
  run(player, async () => {
    if (!staff.isAdmin(player)) {
      player.sendMessage(errorMsg(TEXT.common.notAdminPurge));
      return;
    }

    const clan = clans.clanOf(target.id);
    const owns = clan ? clans.isOwner(clan, target.id) : false;
    const alone = clan ? clans.memberCount(clan) === 1 : false;

    /** @type {string[]} */
    const consequences = [];
    if (clan && owns && alone) {
      consequences.push(`${C.red}${clan.name} will be disbanded.`);
    } else if (clan && owns) {
      consequences.push(
        TEXT.menu.leadershipPassesOn(clan.name),
      );
    } else if (clan) {
      consequences.push(TEXT.menu.purgeRemovesFromClan(clan.name));
    }
    if (staff.roleOf(target.id)) consequences.push(TEXT.menu.purgeClearsStaffRole);
    if (requests.forPlayer(target.id)) {
      consequences.push(TEXT.menu.purgeDropsRequest);
    }
    consequences.push(TEXT.menu.purgeWithdrawsInvites);

    const body =
      TEXT.menu.removeFromTheClanSystem(target.name) +
      `${consequences.join('\n')}\n\n` +
      TEXT.menu.purgeIsNotABan +
      TEXT.menu.ifTheyRejoinTheyStart;

    if (!(await confirm(player, TEXT.menu.purgePlayer, body, 'Purge'))) {
      back?.();
      return;
    }

    const report = purge(target.id, target.name);
    // purge() signals the refresh; this only drops the cached admin state.
    display.forget(target.id);

    if (report.clanDisbanded && report.clanName) {
      announce.clanDisbanded(report.clanName);
    } else if (report.clanName) {
      announce.memberLeft(report.clanName, report.playerName, true);
    }
    for (const id of report.notifyIds) {
      players.notify(id, msg(TEXT.cmd.memberWasRemoved(report.playerName)));
    }
    if (report.newLeaderName && report.clanName) {
      for (const id of report.notifyIds) {
        players.notify(
          id,
          msg(TEXT.cmd.memberRoleAnnounced(report.newLeaderName, report.clanName)),
        );
      }
    }

    player.sendMessage(successMsg(TEXT.menu.purgedFromTheClanSystem(report.playerName)));
    back?.();
  });
}


/**
 * Picks a player to purge, including offline ones.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function purgePicker(player, back) {
  run(player, async () => {
    if (!staff.isAdmin(player)) {
      player.sendMessage(errorMsg(TEXT.common.notAdminPurge));
      return;
    }

    const known = players.allKnown();
    if (known.length === 0) {
      player.sendMessage(msg(TEXT.menu.noPlayersOnRecord));
      back?.();
      return;
    }

    const target = await pickPlayer(player, {
      back,
      title: `${C.red}Purge a Player`,
      body:
        TEXT.menu.purgeBody +
        TEXT.menu.purgeAdviceLineOne +
        TEXT.menu.purgeAdviceLineTwo,
      candidates: known,
      describe: (ref) => {
        const clan = clans.clanOf(ref.id);
        return (
          `${onlineDot(ref)} ${C.white}${truncate(ref.name, 20)}\n` +
          `${C.gray}${clan ? clan.name : TEXT.fragment.noClan}`
        );
      },
    });

    if (!target) return;
    purgeConfirm(player, target, () => purgePicker(player));
  });
}
