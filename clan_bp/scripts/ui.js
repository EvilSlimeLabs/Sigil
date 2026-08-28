// @ts-check
/**
 * The forms interface — the complete surface of the add-on.
 *
 * Commands are the fast path for online targets. This is where everything else
 * lives, because forms can list stored data and therefore reach players who are
 * currently offline: removing an absent member, reassigning their role, or
 * inviting someone who has not logged in today. `PlayerSelector` command
 * arguments cannot do any of that.
 *
 * All screens are `async` and re-enter their parent on close, so the menus
 * behave like a navigable stack rather than a set of dead ends.
 */

import { world } from '@minecraft/server';
import { action, showAction as show, modal } from './forms.js';
import { C, LEADER_ROLE, LIMITS, ROLE_COLOR_CHOICES } from './config.js';
import { BRACKET_STYLES, bracketIndex } from './brackets.js';
import {
  errorMsg,
  successMsg,
  msg,
  truncate,
  validateStaffRoleName,
  validateStaffSymbol,
} from './format.js';
import { TEXT } from './text.js';
import * as clans from './clans.js';
import * as staff from './staff.js';
import * as invites from './invites.js';
import * as requests from './requests.js';
import * as wars from './wars.js';
import * as warbook from './warbook.js';
import * as peaceful from './peaceful.js';
import * as settings from './settings.js';
import * as announce from './announce.js';
import * as players from './players.js';
import * as display from './display.js';
import { purge } from './purge.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('./clans.js').Clan} Clan */

/**
 * Runs a screen, reporting failures to the player rather than losing them to an
 * unhandled rejection.
 *
 * @param {Player} player
 * @param {() => Promise<void>} screen
 */
function run(player, screen) {
  screen().catch((err) => {
    console.warn(`[sigil] UI failed for ${player.name}: ${err}`);
    player.sendMessage(errorMsg(TEXT.menu.thatMenuCouldNotBe));
  });
}

/**
 * A yes/no confirmation. Built from an action form rather than a message form
 * so that button order matches reading order.
 *
 * @param {Player} player
 * @param {string} title
 * @param {string} body
 * @param {string} confirmLabel
 * @returns {Promise<boolean>}
 */
async function confirm(player, title, body, confirmLabel) {
  const form = action()
    .title(title)
    .body(body)
    .button(`${C.red}${confirmLabel}`)
    .button(TEXT.menu.cancel);
  const response = await show(form, player);
  return !response.canceled && response.selection === 0;
}

/** Above this many candidates, a picker asks for a search term first. */
const PICKER_SEARCH_THRESHOLD = 40;

/** Items shown on one page of a list. */
const PICKER_PAGE_SIZE = 40;

/**
 * Chooses one item from a list, asking for a search term when the list is long
 * and paging when it is longer still.
 *
 * Every list screen used to build one button per record. That is fine for a new
 * world and unusable for an old one — a form with four hundred buttons is not a
 * menu. Searching past a threshold and paging past a screenful keeps every list
 * usable at any size, and keeps them all behaving the same way.
 *
 * @template T
 * @param {Player} player
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.body
 * @param {T[]} options.items
 * @param {(item: T) => string} options.describe  the button label
 * @param {(item: T) => string} [options.match]   text a search term is tested against
 * @param {() => void} [options.back]  where leaving the list goes; adds a Back
 *   button and is also taken when the screen is simply closed
 * @returns {Promise<T | undefined>}
 */
async function pickFrom(player, { title, body, items, describe, match, back }) {
  let list = items;

  if (match && list.length > PICKER_SEARCH_THRESHOLD) {
    const search = await modal(title)
      .label(TEXT.menu.pickerSearchHint(list.length))
      .textField('query', TEXT.menu.pickerSearchLabel, TEXT.menu.pickerSearchPlaceholder)
      .submitButton(TEXT.menu.pickerSearchSubmit)
      .show(player);

    if (search.canceled) {
      back?.();
      return undefined;
    }
    const query = search.str('query').trim().toLowerCase();
    if (query !== '') {
      list = list.filter((item) => match(item).toLowerCase().includes(query));
      if (list.length === 0) {
        player.sendMessage(errorMsg(TEXT.menu.pickerNoMatch(query)));
        back?.();
        return undefined;
      }
    }
  }

  let page = 0;
  for (;;) {
    const pages = Math.max(1, Math.ceil(list.length / PICKER_PAGE_SIZE));
    page = Math.min(page, pages - 1);
    const slice = list.slice(page * PICKER_PAGE_SIZE, (page + 1) * PICKER_PAGE_SIZE);

    const form = action()
      .title(title)
      .body(pages > 1 ? TEXT.menu.pickerPageOf(body, page + 1, pages, list.length) : body);
    for (const item of slice) form.button(describe(item));

    // Paging and navigation buttons come last, so an item's index never shifts
    // under someone part-way through reading the page.
    const hasPrevious = pages > 1 && page > 0;
    const hasNext = pages > 1 && page < pages - 1;
    if (hasPrevious) form.button(TEXT.menu.pickerPrevious);
    if (hasNext) form.button(TEXT.menu.pickerNext);
    if (back) form.button(TEXT.menu.back);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back?.();
      return undefined;
    }

    if (response.selection < slice.length) return slice[response.selection];

    let offset = response.selection - slice.length;
    if (hasPrevious) {
      if (offset === 0) {
        page -= 1;
        continue;
      }
      offset -= 1;
    }
    if (hasNext && offset === 0) {
      page += 1;
      continue;
    }

    // Only the Back button is left.
    back?.();
    return undefined;
  }
}

/**
 * Chooses a player, listing online players first.
 *
 * @param {Player} player
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.body
 * @param {Array<{ id: string, name: string, online: boolean }>} options.candidates
 * @param {(entry: { id: string, name: string, online: boolean }) => string} options.describe
 * @param {() => void} [options.back]
 * @returns {Promise<{ id: string, name: string, online: boolean } | undefined>}
 */
async function pickPlayer(player, { title, body, candidates, describe, back }) {
  // Online players first: they are who a picker is usually reaching for.
  const list = [...candidates].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
  );
  return pickFrom(player, {
    title,
    body,
    items: list,
    describe,
    back,
    match: (/** @type {{ name: string }} */ ref) => ref.name,
  });
}

/**
 * A player's online marker for a picker row.
 *
 * @param {{ online: boolean }} entry
 * @returns {string}
 */
function onlineDot(entry) {
  return entry.online ? `${C.green}●` : `${C.darkGray}●`;
}

/**
 * Whether a player may act on a clan: its own Leader, or staff with
 * clan-management access.
 *
 * Each mutating flow asserts this for itself rather than trusting that the
 * caller hid the button. The screens are reached from several directions, and
 * a check that lives only in the menu is one refactor away from being absent.
 *
 * @param {Player} player
 * @param {Clan} clan
 * @returns {boolean}
 */
function mayManageClan(player, clan) {
  return clans.isOwner(clan, player.id) || staff.canManageAnyClan(player);
}

/**
 * Renders one member as a form button label.
 *
 * @param {Clan} clan
 * @param {{ id: string, member: import('./clans.js').ClanMember, role: string }} row
 * @returns {string}
 */
function memberLabel(clan, row) {
  const online = players.onlinePlayer(row.id) !== undefined;
  const dot = online ? `${C.green}●` : `${C.darkGray}●`;
  const crown = row.id === clan.ownerId ? `${C.yellow}★ ` : '';
  const role = row.role ? `\n${C.gray}${row.role}` : '';
  return `${dot} ${crown}${C.white}${truncate(row.member.name, 20)}${role}`;
}

// ── Main menu ─────────────────────────────────────────────────────────────

/**
 * The add-on's front door.
 *
 * @param {Player} player
 */
export function mainMenu(player) {
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    const pending = invites.pendingFor(player.id);

    const form = action().title(TEXT.menu.clans);
    form.body(
      clan
        ? TEXT.menu.youAreInAs(clan.name, clans.roleOf(clan, player.id) || 'a member')
        : TEXT.menu.youAreNotInA2,
    );

    /** @type {Array<() => void>} */
    const actions = [];

    // Every screen opened from here is told how to get back, which is what
    // puts a Back button on it. Screens reached any other way — from the War
    // Map block, from a command — are given no route and show none, because
    // there is nowhere for it to go.
    const home = () => mainMenu(player);

    if (clan) {
      form.button(TEXT.menu.myClan(clan.name));
      actions.push(() => myClanMenu(player, home));
    } else {
      form.button(TEXT.menu.createAClan);
      actions.push(() => createClanForm(player));
    }

    form.button(
      pending.length > 0
        ? TEXT.menu.invitesPending(pending.length)
        : TEXT.menu.invitesNonePending,
    );
    actions.push(() => invitesMenu(player, home));

    // No war entry here. The war screen belongs to the War Map a clan puts up
    // in its base — that block, and `/clan:war`, are the ways in. Repeating it
    // in the compass menu made the map look like decoration.

    form.button(TEXT.menu.browseClans);
    actions.push(() => browseClans(player, home));

    if (requests.canApprove(player)) {
      const queued = requests.all().length;
      form.button(
        queued > 0
          ? TEXT.menu.clanRequestsAwaitingReview(queued)
          : TEXT.menu.clanRequestsQueueIsEmpty,
      );
      actions.push(() => requestQueue(player, home));
    }

    if (staff.canManageAnyClan(player)) {
      form.button(TEXT.menu.manageClansStaff);
      actions.push(() => staffClanBrowser(player, home));

      const liveCount = wars.liveWars().length;
      form.button(
        liveCount > 0
          ? TEXT.menu.activeWarsInProgress(liveCount)
          : TEXT.menu.activeWarsNone,
      );
      actions.push(() => staffWarBrowser(player, home));
    }

    if (staff.canManageStaffRoles(player)) {
      form.button(TEXT.menu.staffRolesAdmin);
      actions.push(() => staffRoleMenu(player, home));

      form.button(TEXT.menu.settingsAdmin);
      actions.push(() => settingsMenu(player));

      form.button(TEXT.menu.displaySettingsAdmin);
      actions.push(() => displaySettingsMenu(player, home));

      form.button(TEXT.menu.createForAPlayerAdmin);
      actions.push(() => createClanForPlayer(player, home));

      form.button(TEXT.menu.purgeAPlayerAdmin);
      actions.push(() => purgePicker(player, home));

      const marked = peaceful.all().length;
      form.button(
        TEXT.menu.rosterPlayerS(settings.get().display.peaceful.color, settings.get().display.peaceful.name, marked),
      );
      actions.push(() => peacefulRoster(player));
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}

// ── Creating and viewing your own clan ────────────────────────────────────

/**
 * @param {Player} player
 */
function createClanForm(player) {
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
          TEXT.menu.requestedTheClanAnAdmin2(filed.value.name),
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
    player.sendMessage(successMsg(TEXT.menu.clanCreatedYouAreIts(result.value.name)));
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
function createClanForPlayer(player, back) {
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
      player.sendMessage(msg(TEXT.menu.noPlayersOnRecordYet));
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
      successMsg(TEXT.cmd.createdTheOutpostFor(result.value.name, target.name)),
    );
    players.notify(target.id, msg(TEXT.cmd.anAdminCreatedTheOutpost(result.value.name)));
    announce.clanCreated(result.value.name, target.name);
    back?.();
  });
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
        ? TEXT.menu.reviewNoticePromote2(request.requesterName, request.name)
        : request.kind === 'rename'
          ? TEXT.menu.reviewNoticeRename2(
              request.requesterName,
              request.name,
              request.newName ?? '',
            )
          : TEXT.menu.reviewNoticeCreate2(request.requesterName, request.name);
    reviewer.sendMessage(msg(notice));
  }
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
          ? TEXT.menu.anAdminReviewsTheNew
          : TEXT.menu.theChangeTakesEffectImmediately,
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
          ? successMsg(TEXT.menu.isNow(renamed.value.from, renamed.value.to))
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
        msg(TEXT.menu.requestedTheNameAwaitingReview(filed.value.newName)),
      );
      notifyReviewers(filed.value);
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
        TEXT.menu.membersLeaderYourRole(tierLine, clans.memberCount(clan), LIMITS.maxMembersPerClan, players.displayName(clan.ownerId), clans.roleOf(clan, player.id) || TEXT.fragment.noRole),
      );

    /** @type {Array<() => void>} */
    const actions = [];

    const home = () => myClanMenu(player, back);

    form.button(TEXT.menu.membersViewAndManage);
    actions.push(() => memberBrowser(player, clan.id, home));

    if (owner && outpost) {
      form.button(TEXT.menu.requestPromotionBecomeAFull);
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
      actions.push(() => leaveFlow(player, clan.id));
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
function clanColorForm(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.clanGone));
      return;
    }
    if (!mayManageClan(player, clan)) {
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
      .dropdown('color', TEXT.menu.clanColourPick, choices, { defaultValueIndex: current })
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
      body: TEXT.menu.memberSSelectOneTo(rows.length),
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
    if (!mayManageClan(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotChangeRolesIn));
      back();
      return;
    }

    const current = clans.roleOf(clan, memberId);
    const choices = [TEXT.fragment.pickNoRole, ...clan.roles, TEXT.fragment.pickNewRole];
    const currentIndex = current ? Math.max(0, clan.roles.indexOf(current) + 1) : 0;

    const response = await modal(TEXT.menu.roleFor(truncate(clan.members[memberId].name, 16)))
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
    // A typed name always wins: it is the more deliberate of the two inputs.
    const role = typed !== '' ? typed : index === 0 ? '' : (clan.roles[index - 1] ?? '');

    const result = clans.setMemberRole(clan.id, memberId, role);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else if (result.value === '') {
      player.sendMessage(successMsg(TEXT.menu.clearedSRole(clan.members[memberId].name)));
      players.notify(memberId, msg(TEXT.menu.yourRoleInWasCleared(clan.name)));
    } else {
      player.sendMessage(successMsg(TEXT.menu.isNow(clan.members[memberId].name, result.value)));
      players.notify(memberId, msg(TEXT.menu.youAreNowIn(result.value, clan.name)));
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
    if (!mayManageClan(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotRemoveMembersFrom));
      back();
      return;
    }

    const name = clan.members[memberId].name;
    if (!(await confirm(player, TEXT.menu.removeMember, TEXT.menu.removeFrom(name, clan.name), 'Remove'))) {
      back();
      return;
    }

    const result = clans.removeMember(clan.id, memberId);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else {
      player.sendMessage(successMsg(TEXT.menu.removedFrom(result.value, clan.name)));
      announce.memberLeft(clan.name, result.value, true);
      players.notify(memberId, msg(TEXT.menu.youWereRemovedFrom(clan.name)));
      for (const id of Object.keys(clan.members)) {
        players.notify(id, msg(TEXT.menu.wasRemovedFromTheClan(result.value)));
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
    if (!mayManageClan(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotChangeLeadershipOf));
      back();
      return;
    }

    const name = clan.members[memberId].name;
    const body =
      TEXT.menu.makeTheOf(name, clan.name) +
      TEXT.menu.becomesAnOrdinaryMember(players.displayName(clan.ownerId));
    if (!(await confirm(player, TEXT.menu.transferLeadership2, body, `Make ${LEADER_ROLE}`))) {
      back();
      return;
    }

    const result = clans.transferLeadership(clan.id, memberId);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else {
      player.sendMessage(successMsg(TEXT.menu.nowLeads(result.value.newOwnerName, clan.name)));
      for (const id of Object.keys(clan.members)) {
        players.notify(
          id,
          msg(TEXT.menu.isNowTheOf(result.value.newOwnerName, clan.name)),
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
      player.sendMessage(errorMsg(TEXT.menu.thereIsNobodyElseIn));
      myClanMenu(player);
      return;
    }

    const chosen = await pickFrom(player, {
      title: TEXT.menu.transferLeadership,
      body: TEXT.menu.chooseTheNewOf(clan.name),
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
 */
function leaveFlow(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    if (!(await confirm(player, TEXT.menu.leaveClan2, `${C.gray}Leave ${C.aqua}${clan.name}${C.gray}?`, 'Leave'))) {
      mainMenu(player);
      return;
    }

    const result = clans.removeMember(clan.id, player.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      return;
    }
    player.sendMessage(msg(TEXT.menu.youLeft(clan.name)));
    announce.memberLeft(clan.name, player.name, false);
    for (const id of Object.keys(clan.members)) {
      players.notify(id, msg(TEXT.menu.leftTheClan(player.name)));
    }
  });
}

/**
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} [back]
 */
function disbandFlow(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;
    if (!mayManageClan(player, clan)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotDisbandThatClan));
      back?.();
      return;
    }

    const body =
      TEXT.menu.permanentlyDeleteAndRemoveAll(clan.name) +
      TEXT.menu.memberSThisCannotBe(clans.memberCount(clan));
    if (!(await confirm(player, TEXT.menu.disbandClan2, body, 'Disband'))) {
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
      players.notify(id, msg(TEXT.menu.wasDisbanded(result.value.name)));
    }
    announce.clanDisbanded(result.value.name);
    player.sendMessage(successMsg(TEXT.menu.disbanded(result.value.name)));
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
    // an eligible target — filtered out rather than shown and then rejected.
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
      player.sendMessage(successMsg(TEXT.menu.invitedTo(target.name, clan.name)));
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
  const leave = back ?? (() => mainMenu(player));

  run(player, async () => {
    const pending = invites.pendingFor(player.id);
    if (pending.length === 0) {
      player.sendMessage(msg(TEXT.menu.youHaveNoPendingClan));
      leave();
      return;
    }

    const form = action()
      .title(TEXT.menu.clanInvites)
      .body(TEXT.menu.youHavePendingInviteS(pending.length));
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
 * @param {import('./invites.js').Invite} invite
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
      player.sendMessage(successMsg(TEXT.menu.youJoined(result.value.name)));
      announce.memberJoined(result.value.name, player.name);
      for (const id of Object.keys(result.value.members)) {
        if (id !== player.id) players.notify(id, msg(TEXT.menu.joinedTheClan(player.name)));
      }
      myClanMenu(player);
      return;
    }

    invites.decline(player.id, invite);
    player.sendMessage(msg(TEXT.menu.declinedTheInviteFrom(invite.clanName)));
    players.notify(
      invite.byId,
      msg(TEXT.menu.declinedYourInviteTo(player.name, invite.clanName)),
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
        TEXT.menu.rolesAreOptionalLabelsFor,
      )
      .button(TEXT.menu.addARole);
    for (const role of clan.roles) {
      const holders = Object.values(clan.members).filter((m) => m.role === role).length;
      form.button(TEXT.menu.memberS(truncate(role, 20), holders));
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
  const leave = back ?? (() => mainMenu(player));

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
      body: TEXT.menu.clanS(all.length),
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
      .button(TEXT.menu.membersRemoveSetRoleMake)
      .button(TEXT.menu.warRecordsPrintAPast)
      .button(TEXT.menu.disbandClan);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back();
      return;
    }

    if (response.selection === 0) {
      memberBrowser(player, clanId, () => staffClanDetail(player, clanId, fromBrowser));
    } else if (response.selection === 1) {
      clanWarHistory(player, clanId);
    } else {
      disbandFlow(player, clanId, back);
    }
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
    const form = action()
      .title(TEXT.menu.staffRoles)
      .body(
        TEXT.menu.staffRolesAreSeparateFrom,
      )
      .button(TEXT.menu.createARole)
      .button(TEXT.menu.assignToAPlayer)
      .button(
        TEXT.menu.assignStacksWithAnySystem(settings.get().display.peaceful.color, settings.get().display.peaceful.name),
      );
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

    const role = roles[response.selection - 3];
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
      .button(role.builtin ? TEXT.menu.deleteBuiltIn : TEXT.menu.delete);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      staffRoleMenu(player);
      return;
    }

    if (response.selection === 0) {
      staffRoleEditor(player, roleId);
      return;
    }

    const body = TEXT.menu.deleteTheStaffRoleAnd(role.color, role.name, holders.length);
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
    const colorIndex = Math.max(
      0,
      ROLE_COLOR_CHOICES.findIndex((choice) => choice.code === existing?.color),
    );

    const response = await modal(
      existing ? `${C.aqua}Edit ${truncate(existing.name, 16)}` : TEXT.menu.createStaffRole,
    )
      .textField('name', TEXT.menu.name, 'Moderator', { defaultValue: existing?.name ?? '' })
      .textField('symbol', TEXT.menu.chatTag, 'Mod', { defaultValue: existing?.symbol ?? '' })
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
      )
      .toggle('manageClans', TEXT.menu.mayManageAnyClan, {
        defaultValue: existing?.manageClans ?? false,
      })
      .slider('priority', TEXT.menu.priority, 0, 100, {
        defaultValue: existing?.priority ?? 25,
        valueStep: 5,
      })
      .submitButton(existing ? TEXT.menu.save2 : TEXT.menu.create)
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
    const symbol = validateStaffSymbol(response.str('symbol'));
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
      manageClans: response.bool('manageClans'),
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
    const known = players.allKnown();
    if (known.length === 0) {
      player.sendMessage(msg(TEXT.menu.noPlayersOnRecordYet));
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
 * @param {import('./players.js').PlayerRef} target
 */
function staffAssignForm(player, target) {
  run(player, async () => {
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
      successMsg(role ? TEXT.menu.isNow2(target.name, role.name) : TEXT.menu.clearedSStaffRole(target.name)),
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
      body: TEXT.menu.requestSAwaitingReview(queue.length),
      items: queue,
      describe: (request) => {
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
 * Approve or deny a single request.
 *
 * @param {Player} player
 * @param {string} requestId
 */
function reviewRequest(player, requestId) {
  run(player, async () => {
    const request = requests.byId(requestId);
    if (!request) {
      player.sendMessage(errorMsg(TEXT.menu.thatRequestHasAlreadyBeen));
      requestQueue(player);
      return;
    }

    if (!requests.canApproveRequest(player, request)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotReviewThatKind));
      requestQueue(player);
      return;
    }

    const requester = players.ref(request.requesterId);
    const promoting = request.kind === 'promote';
    const promoteClan = promoting && request.clanId ? clans.getClan(request.clanId) : undefined;

    const detail = promoting
      ? TEXT.menu.promotionFromOutpostToFull +
        `${C.gray}Members: ${C.white}${promoteClan ? clans.memberCount(promoteClan) : 0}` +
        `${C.gray}/${settings.promotionThreshold()}\n`
      : request.kind === 'rename'
        ? `${C.gray}Rename to ${C.aqua}${request.newName}${C.gray}\n`
        : TEXT.menu.aNewClan;

    const form = action()
      .title(`${C.aqua}${truncate(request.name, 22)}`)
      .body(
        TEXT.menu.requestedByStatus(
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
      requestQueue(player);
      return;
    }

    if (response.selection === 0) {
      const approved = requests.approve(requestId);
      if (!approved.ok) {
        player.sendMessage(errorMsg(approved.error));
      } else if (request.kind === 'rename') {
        const { clan } = approved.value;
        player.sendMessage(successMsg(TEXT.menu.isNow(request.name, clan.name)));
        for (const id of Object.keys(clan.members)) {
          players.notify(id, msg(TEXT.menu.yourClanIsNowCalled(clan.name)));
        }
      } else if (promoting) {
        const { clan } = approved.value;
        player.sendMessage(successMsg(TEXT.menu.isNowAFullClan(clan.name)));
        for (const id of Object.keys(clan.members)) {
          players.notify(
            id,
            msg(TEXT.menu.hasBeenPromotedToA(clan.name)),
          );
        }
        announce.clanPromoted(clan.name);
      } else {
        const { clan } = approved.value;
        player.sendMessage(successMsg(TEXT.menu.approvedFor(clan.name, request.requesterName)));
        players.notify(
          request.requesterId,
          msg(
            TEXT.menu.yourOutpostWasApprovedYou(clan.name),
          ),
        );
        announce.clanCreated(clan.name, request.requesterName);
      }
      requestQueue(player);
      return;
    }

    denyRequest(player, requestId);
  });
}

/**
 * Denies a request, with an optional reason passed on to the requester.
 *
 * @param {Player} player
 * @param {string} requestId
 */
function denyRequest(player, requestId) {
  run(player, async () => {
    const response = await modal(TEXT.menu.denyRequest)
      .textField('reason', TEXT.menu.reasonOptional, TEXT.menu.nameIsNotAppropriate)
      .submitButton(TEXT.menu.deny2)
      .show(player);

    if (response.canceled) {
      requestQueue(player);
      return;
    }

    const reason = response.str('reason').trim();
    const denied = requests.deny(requestId);
    if (!denied.ok) {
      player.sendMessage(errorMsg(denied.error));
    } else {
      player.sendMessage(msg(TEXT.menu.deniedTheRequestFor(denied.value.name)));
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
    requestQueue(player);
  });
}

// ── Settings ──────────────────────────────────────────────────────────────

/**
 * Admin-only settings. Editing any of these is deliberately restricted to
 * admins, including the switch that lets staff roles approve clans — otherwise
 * a clan-managing role could widen its own powers.
 *
 * @param {Player} player
 */
export function settingsMenu(player) {
  run(player, async () => {
    if (!staff.canManageStaffRoles(player)) {
      player.sendMessage(errorMsg(TEXT.common.notAdminSettings));
      return;
    }

    const current = settings.get();
    const notes = current.notifications;

    const response = await modal(TEXT.menu.sigilSettings)
      .header(TEXT.menu.clanCreation)
      .toggle('requireApproval', TEXT.menu.requireAdminApprovalToCreate, {
        defaultValue: current.requireClanApproval,
      })
      .toggle('staffApproveClans', TEXT.menu.clanManagingStaffRolesMay, {
        defaultValue: current.staffCanApproveClans,
      })
      .divider()
      .header(TEXT.menu.outposts)
      .toggle('staffApprovePromotions', TEXT.menu.staffRolesMayApprovePromotions, {
        defaultValue: current.staffCanApprovePromotions,
      })
      .slider('promotionMembers', TEXT.menu.membersNeededToRequestPromotion, 1, 25, {
        defaultValue: settings.promotionThreshold(),
        valueStep: 1,
      })
      .divider()
      .header(TEXT.menu.wars)
      .toggle('warNeedsAcceptance', TEXT.menu.declarationsMustBeAccepted, {
        defaultValue: current.warRequiresAcceptance,
      })
      .toggle('staffAdjustKills', TEXT.menu.staffRolesMayAdjustWar, {
        defaultValue: current.staffCanAdjustWarKills,
      })
      .toggle('staffWarBooks', TEXT.menu.staffRolesMayPrintAny, {
        defaultValue: current.staffCanGenerateWarBooks,
      })
      .slider('maxWars', TEXT.menu.maxActiveWarsPerClan, 0, 20, {
        defaultValue: Math.max(0, Math.round(current.maxActiveWarsPerClan)),
        valueStep: 1,
      })
      .divider()
      .header(TEXT.menu.chatNotifications)
      .toggle('notifyEnabled', TEXT.menu.enableNotifications, { defaultValue: notes.enabled })
      .toggle('notifyCreated', TEXT.menu.clanCreated, { defaultValue: notes.clanCreated })
      .toggle('notifyJoined', TEXT.menu.memberJoined, { defaultValue: notes.memberJoined })
      .toggle('notifyLeft', TEXT.menu.memberLeft, { defaultValue: notes.memberLeft })
      .toggle('notifyDisbanded', TEXT.menu.clanDisbanded, { defaultValue: notes.clanDisbanded })
      .toggle('notifyPromoted', TEXT.menu.outpostPromoted, { defaultValue: notes.clanPromoted })
      .toggle('notifyWarDeclared', TEXT.menu.warDeclared, { defaultValue: notes.warDeclared })
      .toggle('notifyWarEnded', TEXT.menu.warEnded, { defaultValue: notes.warEnded })
      .divider()
      .header(TEXT.menu.adminStatus)
      .slider('pollSeconds', TEXT.menu.reCheckOperatorStatusEvery, 5, 300, {
        defaultValue: Math.round(current.opPollSeconds),
        valueStep: 5,
      })
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) return;

    const previousPoll = current.opPollSeconds;
    const nextPoll = response.num('pollSeconds', previousPoll);

    settings.update({
      requireClanApproval: response.bool('requireApproval'),
      staffCanApproveClans: response.bool('staffApproveClans'),
      staffCanApprovePromotions: response.bool('staffApprovePromotions'),
      outpostPromotionMembers: response.num('promotionMembers', current.outpostPromotionMembers),
      warRequiresAcceptance: response.bool('warNeedsAcceptance'),
      staffCanAdjustWarKills: response.bool('staffAdjustKills'),
      staffCanGenerateWarBooks: response.bool('staffWarBooks'),
      maxActiveWarsPerClan: response.num('maxWars', current.maxActiveWarsPerClan),
      opPollSeconds: nextPoll,
      notifications: {
        enabled: response.bool('notifyEnabled'),
        clanCreated: response.bool('notifyCreated'),
        memberJoined: response.bool('notifyJoined'),
        memberLeft: response.bool('notifyLeft'),
        clanDisbanded: response.bool('notifyDisbanded'),
        clanPromoted: response.bool('notifyPromoted'),
        warDeclared: response.bool('notifyWarDeclared'),
        warEnded: response.bool('notifyWarEnded'),
      },
    });

    // The poll is a live `runInterval`, so a changed period only takes effect
    // once the old one is cancelled and a new one registered.
    if (nextPoll !== previousPoll) display.restartAdminPolling();

    player.sendMessage(successMsg(TEXT.menu.settingsSaved));
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
 * @param {import('./players.js').PlayerRef} target
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
        TEXT.menu.leadershipOfPassesToIts(clan.name),
      );
    } else if (clan) {
      consequences.push(TEXT.menu.theyWillBeRemovedFrom(clan.name));
    }
    if (staff.roleOf(target.id)) consequences.push(TEXT.menu.theirStaffRoleWillBe);
    if (requests.forPlayer(target.id)) {
      consequences.push(TEXT.menu.theirClanRequestWillBe);
    }
    consequences.push(TEXT.menu.allInvitesTheySentOr);

    const body =
      TEXT.menu.removeFromTheClanSystem(target.name) +
      `${consequences.join('\n')}\n\n` +
      TEXT.menu.thisDoesNotBanThem +
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
      players.notify(id, msg(TEXT.menu.wasRemovedFromTheClan(report.playerName)));
    }
    if (report.newLeaderName && report.clanName) {
      for (const id of report.notifyIds) {
        players.notify(
          id,
          msg(TEXT.menu.isNowTheOf(report.newLeaderName, report.clanName)),
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
      player.sendMessage(msg(TEXT.menu.noPlayersOnRecordYet));
      back?.();
      return;
    }

    const target = await pickPlayer(player, {
      back,
      title: `${C.red}Purge a Player`,
      body:
        TEXT.menu.removesAPlayerFromThe +
        TEXT.menu.useAfterBanningThemOn +
        TEXT.menu.themselvesAreInvisibleToAdd,
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

// ── Wars ──────────────────────────────────────────────────────────────────

/**
 * Renders a war as one line of standings.
 *
 * @param {import('./wars.js').War} war
 * @returns {string}
 */
function warLine(war) {
  return (
    `${C.white}${war.nameA} ${C.yellow}${wars.sideTotal(war, war.clanA)}` +
    `${C.darkGray} - ${C.yellow}${wars.sideTotal(war, war.clanB)} ${C.white}${war.nameB}`
  );
}

/**
 * The war screen. Opened by the War Map block, or by `/clan:war`.
 *
 * What it offers depends on who is looking: a Leader of a full clan can declare
 * and respond, any member can watch the standings, and staff can intervene.
 *
 * @param {Player} player
 */
export function warMenu(player) {
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.notInAClan));
      return;
    }

    const isLeader = clans.isOwner(clan, player.id);
    const outpost = clans.isOutpost(clan);
    const live = wars.warsFor(clan.id);
    const incoming = live.filter((war) => war.state === 'pending' && war.clanB === clan.id);
    const active = live.filter((war) => war.state === 'active');

    const status = outpost
      ? TEXT.menu.isAnOutpostOutpostsCannot2(clan.name)
      : TEXT.menu.activeWarSDeclarationS(active.length, incoming.length);

    const form = action()
      .title(TEXT.menu.warMap)
      .body(`${C.gray}${clan.name}\n${status}`);

    /** @type {Array<() => void>} */
    const actions = [];

    if (isLeader && !outpost) {
      form.button(TEXT.menu.declareWar);
      actions.push(() => declareWarPicker(player, clan.id));
    }

    if (isLeader && incoming.length > 0) {
      form.button(TEXT.menu.answerDeclarationsWaiting(incoming.length));
      actions.push(() => declarationInbox(player, clan.id));
    }

    // A declaration nobody has answered can be taken back; the defender can
    // refuse one, and without this the clan that made it could not.
    const outgoing = live.filter((war) => war.state === 'pending' && war.clanA === clan.id);
    if (isLeader && outgoing.length > 0) {
      form.button(TEXT.menu.withdrawDeclarationUnanswered(outgoing.length));
      actions.push(() => withdrawDeclarationPicker(player, clan.id));
    }

    form.button(TEXT.menu.warStandingsAllActiveWars);
    actions.push(() => warStandings(player));

    const fought = wars.historyFor(clan.id).length;
    form.button(
      fought > 0
        ? TEXT.menu.warRecordsFinishedWarS(fought)
        : TEXT.menu.warRecordsNoneYet,
    );
    actions.push(() => warHistoryMenu(player));

    if (live.length > 0 && (isLeader || staff.canManageAnyClan(player))) {
      form.button(TEXT.menu.ourWarsEndAWar);
      actions.push(() => ourWars(player, clan.id));
    }

    if (outpost && isLeader) {
      form.button(TEXT.menu.requestPromotionBecomeAFull);
      actions.push(() => promotionRequest(player));
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}

/**
 * Chooses a clan to declare war on. Outposts are excluded from the list, since
 * they can neither declare nor be declared upon.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function declareWarPicker(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const candidates = clans
      .allClans()
      .filter(
        (other) =>
          other.id !== clanId &&
          !clans.isOutpost(other) &&
          wars.warBetween(clanId, other.id) === undefined,
      );

    if (candidates.length === 0) {
      player.sendMessage(
        errorMsg(TEXT.menu.thereIsNoClanYou),
      );
      warMenu(player);
      return;
    }

    const form = action()
      .title(TEXT.menu.declareWar)
      .body(
        TEXT.menu.chooseAClanToDeclare(
          settings.get().warRequiresAcceptance
            ? TEXT.menu.theirLeaderMustAccept
            : TEXT.menu.theWarBeginsImmediately,
        ),
      );
    for (const other of candidates) {
      form.button(
        TEXT.menu.memberS2(truncate(other.name, 20), clans.memberCount(other)),
      );
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      warMenu(player);
      return;
    }

    const target = candidates[response.selection];
    if (!target) return;

    const body =
      TEXT.menu.declareWarOn(target.name) +
      TEXT.menu.killsBetweenYourClansWill;
    if (!(await confirm(player, TEXT.menu.declareWar2, body, 'Declare'))) {
      warMenu(player);
      return;
    }

    const declared = wars.declare(clan, target, player.id);
    if (!declared.ok) {
      player.sendMessage(errorMsg(declared.error));
      warMenu(player);
      return;
    }

    const war = declared.value;
    if (war.state === 'pending') {
      player.sendMessage(successMsg(TEXT.menu.warDeclaredOnAwaitingTheir(target.name)));
      players.notify(
        target.ownerId,
        msg(
          TEXT.menu.hasDeclaredWarOnAnswer(clan.name, target.name),
        ),
      );
    } else {
      player.sendMessage(successMsg(TEXT.menu.youAreNowAtWar(target.name)));
      for (const id of Object.keys(target.members)) {
        players.notify(id, msg(TEXT.menu.hasDeclaredWarOn(clan.name, target.name)));
      }
    }
    announce.warDeclared(clan.name, target.name, war.state === 'pending');
    warMenu(player);
  });
}

/**
 * Declarations awaiting this Leader's answer.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function declarationInbox(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const incoming = wars
      .warsFor(clanId)
      .filter((war) => war.state === 'pending' && war.clanB === clanId);
    if (incoming.length === 0) {
      player.sendMessage(msg(TEXT.menu.noDeclarationsAreAwaitingYour));
      warMenu(player);
      return;
    }

    const form = action()
      .title(TEXT.menu.declarations)
      .body(TEXT.menu.clanSHaveDeclaredWar(incoming.length, clan.name));
    for (const war of incoming) {
      const from = clans.getClan(war.clanA);
      form.button(TEXT.menu.declaredWar(truncate(from?.name ?? TEXT.fragment.lostClan, 20)));
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      warMenu(player);
      return;
    }

    const war = incoming[response.selection];
    if (war) answerDeclaration(player, war.id);
  });
}

/**
 * @param {Player} player
 * @param {string} warId
 */
function answerDeclaration(player, warId) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war || war.state !== 'pending') {
      player.sendMessage(errorMsg(TEXT.menu.thatDeclarationIsNoLonger));
      warMenu(player);
      return;
    }

    const attacker = clans.getClan(war.clanA);
    const defender = clans.getClan(war.clanB);
    const form = action()
      .title(`${C.red}${truncate(attacker?.name ?? TEXT.fragment.lostClan, 20)}`)
      .body(
        TEXT.menu.hasDeclaredWarOnAccepting(attacker?.name ?? TEXT.menu.aLostClan, defender?.name ?? TEXT.menu.yourClan),
      )
      .button(TEXT.menu.acceptTheWar)
      .button(TEXT.menu.refuse)
      .button(TEXT.menu.decideLater);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined || response.selection === 2) {
      declarationInbox(player, war.clanB);
      return;
    }

    if (response.selection === 0) {
      const accepted = wars.accept(warId);
      if (!accepted.ok) {
        player.sendMessage(errorMsg(accepted.error));
      } else {
        player.sendMessage(successMsg(TEXT.menu.theWarWithHasBegun(attacker?.name ?? 'them')));
        notifyBothClans(accepted.value, TEXT.menu.theWarHasBegun);
        announce.warBegan(attacker?.name ?? 'a clan', defender?.name ?? 'a clan');
      }
      warMenu(player);
      return;
    }

    const declined = wars.decline(warId);
    if (!declined.ok) {
      player.sendMessage(errorMsg(declined.error));
    } else {
      player.sendMessage(msg(TEXT.menu.youRefusedTheDeclaration));
      players.notify(
        war.declaredBy,
        msg(TEXT.menu.refusedYourDeclarationOfWar(defender?.name ?? 'They')),
      );
    }
    warMenu(player);
  });
}

/**
 * Messages every member of both clans in a war.
 *
 * @param {import('./wars.js').War} war
 * @param {string} text
 */
function notifyBothClans(war, text) {
  for (const clanId of [war.clanA, war.clanB]) {
    const clan = clans.getClan(clanId);
    if (!clan) continue;
    for (const id of Object.keys(clan.members)) players.notify(id, msg(text));
  }
}

/**
 * Read-only standings for every active war in the world.
 *
 * @param {Player} player
 */
export function warStandings(player) {
  run(player, async () => {
    const active = wars.liveWars().filter((war) => war.state === 'active');
    if (active.length === 0) {
      player.sendMessage(msg(TEXT.menu.noWarsAreBeingFought));
      return;
    }

    const form = action()
      .title(TEXT.menu.warStandings)
      .body(`${C.gray}${active.map(warLine).join('\n')}`)
      .button(TEXT.menu.close);
    await show(form, player);
  });
}

/**
 * The wars this clan is in, with the actions the viewer is allowed to take.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function ourWars(player, clanId) {
  run(player, async () => {
    const live = wars.warsFor(clanId);
    if (live.length === 0) {
      player.sendMessage(msg(TEXT.menu.yourClanIsNotIn));
      warMenu(player);
      return;
    }

    const form = action().title(TEXT.menu.ourWars).body(TEXT.menu.selectAWar);
    for (const war of live) {
      const state = war.state === 'pending' ? `${C.yellow}${TEXT.fragment.warPending}` : `${C.red}${TEXT.fragment.warActive}`;
      form.button(`${warLine(war)}\n${state}`);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      warMenu(player);
      return;
    }

    const war = live[response.selection];
    if (war) warDetail(player, war.id, clanId);
  });
}

/**
 * @param {Player} player
 * @param {string} warId
 * @param {string} viewingClanId
 */
function warDetail(player, warId, viewingClanId) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war || war.state === 'ended') {
      player.sendMessage(errorMsg(TEXT.menu.thatWarIsOver));
      warMenu(player);
      return;
    }

    // A neutral viewer — staff browsing every live war — passes no clan. They
    // get the staff actions and none of the belligerent ones, because they are
    // not a party to this war.
    const asParty = war.clanA === viewingClanId || war.clanB === viewingClanId;
    const clan = asParty ? clans.getClan(viewingClanId) : undefined;
    const isLeader = clan !== undefined && clans.isOwner(clan, player.id);
    const back = asParty ? () => ourWars(player, viewingClanId) : () => staffWarBrowser(player);

    const theirOffer = asParty && war.peaceOfferedBy === wars.opponentOf(war, viewingClanId);
    const ourOffer = asParty && war.peaceOfferedBy === viewingClanId;
    const standing = theirOffer
      ? TEXT.menu.theyHaveOfferedPeace
      : ourOffer
        ? TEXT.menu.yourPeaceOfferIsAwaiting
        : '';

    const form = action()
      .title(TEXT.menu.war(warbook.ordinal(war.ordinal)))
      .body(TEXT.menu.state(warLine(war), war.state, standing));

    /** @type {Array<() => void>} */
    const actions = [];

    if (wars.canAdjustKills(player)) {
      form.button(TEXT.menu.adjustKillsStaff);
      actions.push(() => adjustKillsForm(player, warId, back));
    }

    // Only a Leader may concede, and only for their own clan.
    if (isLeader && war.state === 'active') {
      form.button(
        theirOffer
          ? TEXT.menu.acceptPeaceEndsAsA
          : ourOffer
            ? TEXT.menu.withdrawPeaceOffer
            : TEXT.menu.offerPeaceTheyMustAgree,
      );
      actions.push(() =>
        ourOffer
          ? withdrawPeaceFlow(player, warId, viewingClanId, back)
          : peaceFlow(player, warId, viewingClanId, back),
      );

      form.button(TEXT.menu.surrenderTheyAreRecordedAs);
      actions.push(() => surrenderFlow(player, warId, viewingClanId, back));
    }

    if (wars.canAnnul(player)) {
      form.button(TEXT.menu.annulWarStaffNoWinner);
      actions.push(() => annulFlow(player, warId, back));
    }

    if (actions.length === 0) {
      form.button(TEXT.menu.back);
      actions.push(back);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back();
      return;
    }
    actions[response.selection]?.();
  });
}

/**
 * Staff correction of a kill total, as a signed delta.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {() => void} back
 */
function adjustKillsForm(player, warId, back) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) return;
    if (!wars.canAdjustKills(player)) {
      player.sendMessage(errorMsg(TEXT.common.notWarAdjuster));
      back();
      return;
    }

    const sides = [war.clanA, war.clanB];
    const names = sides.map((id) => wars.nameOf(war, id));

    // Everyone who could carry the correction: current members of either side,
    // plus anyone already on the record from when they were one.
    /** @type {Array<{ id: string, name: string, side: string }>} */
    const candidates = [];
    for (const clanId of sides) {
      const clan = clans.getClan(clanId);
      if (clan) {
        for (const row of clans.memberList(clan)) {
          candidates.push({ id: row.id, name: row.member.name, side: clanId });
        }
      }
      for (const [id, entry] of Object.entries(war.sides[clanId]?.byPlayer ?? {})) {
        if (!candidates.some((c) => c.id === id)) {
          candidates.push({ id, name: entry.name, side: clanId });
        }
      }
    }

    const targetOptions = [
      TEXT.fragment.pickUnattributed,
      ...candidates.map((c) => `${c.name} ${C.darkGray}(${wars.nameOf(war, c.side)})`),
    ];

    const response = await modal(TEXT.menu.adjustKills)
      .dropdown('clan', TEXT.menu.clan, names, { defaultValueIndex: 0 })
      .slider('delta', TEXT.menu.changeBy, -20, 20, { defaultValue: 0, valueStep: 1 })
      .divider()
      .label(TEXT.menu.namingAMemberPutsThe)
      .dropdown('target', TEXT.menu.creditTo, targetOptions, { defaultValueIndex: 0 })
      .submitButton(TEXT.menu.apply)
      .show(player);

    if (response.canceled) {
      back();
      return;
    }

    const index = response.num('clan');
    const delta = response.num('delta');
    const targetIndex = response.num('target');
    if (delta === 0) {
      back();
      return;
    }

    const target = targetIndex > 0 ? candidates[targetIndex - 1] : undefined;
    const result = wars.adjustKills(
      warId,
      sides[index],
      delta,
      target ? { id: target.id, name: target.name } : undefined,
    );
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else if (target) {
      player.sendMessage(
        successMsg(
          TEXT.menu.nowHasKillSTotals2(target.name, result.value.playerKills ?? 0, names[index], result.value.total),
        ),
      );
    } else {
      player.sendMessage(
        successMsg(TEXT.menu.totalsAsAnAdjustment(names[index], result.value.total)),
      );
    }
    back();
  });
}

/**
 * A clan concedes. There is no staff override for this — a forced surrender
 * would record a defeat the clan never chose, which is why annulment exists.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {string} clanId the surrendering clan
 * @param {() => void} back
 */
function surrenderFlow(player, warId, clanId, back) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) return;

    const us = wars.nameOf(war, clanId);
    const them = wars.nameOf(war, wars.opponentOf(war, clanId));
    const body =
      `${C.gray}Surrender to ${C.white}${them}${C.gray}?\n\n` +
      `${warLine(war)}\n\n` +
      TEXT.menu.willBeRecordedAsThe(them) +
      TEXT.menu.thisIsPermanentAndGoes;

    if (!(await confirm(player, `${C.red}Surrender`, body, 'Surrender'))) {
      back();
      return;
    }

    const result = wars.surrender(warId, clanId, player.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    const ended = result.value;
    player.sendMessage(msg(TEXT.menu.youSurrenderedWon(them)));
    notifyBothClans(ended, TEXT.menu.surrenderedWinsTheWar(us, them));
    announce.warEnded(ended, wars.sideTotal(ended, ended.clanA), wars.sideTotal(ended, ended.clanB));
    warMenu(player);
  });
}

/**
 * Offers peace, or accepts one already standing. Peace ends the war with no
 * winner on either side.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {string} clanId
 * @param {() => void} back
 */
function peaceFlow(player, warId, clanId, back) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) return;

    const them = wars.nameOf(war, wars.opponentOf(war, clanId));
    const theirOffer = war.peaceOfferedBy === wars.opponentOf(war, clanId);
    const body = theirOffer
      ? TEXT.menu.hasOfferedPeaceAcceptAnd(them, warLine(war))
      : TEXT.menu.offerPeaceTo(them, warLine(war)) +
        TEXT.menu.theWarEndsOnlyOnce;

    if (
      !(await confirm(
        player,
        `${C.green}${theirOffer ? TEXT.menu.acceptPeace : TEXT.menu.offerPeace}`,
        body,
        theirOffer ? 'Accept' : TEXT.menu.offerPeace,
      ))
    ) {
      back();
      return;
    }

    const result = wars.offerPeace(warId, clanId, player.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    if (!result.value.agreed) {
      player.sendMessage(successMsg(TEXT.menu.peaceOfferedTo(them)));
      players.notify(
        clans.getClan(wars.opponentOf(war, clanId))?.ownerId ?? '',
        msg(TEXT.menu.hasOfferedPeaceAnswerAt(wars.nameOf(war, clanId))),
      );
      back();
      return;
    }

    const ended = result.value.war;
    player.sendMessage(successMsg(TEXT.menu.peaceAgreedTheWarIs));
    notifyBothClans(ended, TEXT.menu.peaceHasBeenAgreedThe);
    announce.warEnded(ended, wars.sideTotal(ended, ended.clanA), wars.sideTotal(ended, ended.clanB));
    warMenu(player);
  });
}

/**
 * Closes a war with no winner. The staff escape hatch for a war both clans
 * have walked away from.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {() => void} back
 */
function annulFlow(player, warId, back) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) return;
    if (!wars.canAnnul(player)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotAnnulWars));
      back();
      return;
    }

    const body =
      TEXT.menu.annulTheWarBetweenAnd(war.nameA) +
      `${C.white}${war.nameB}${C.gray}?\n\n${warLine(war)}\n\n` +
      TEXT.menu.noWinnerIsRecordedUse +
      TEXT.menu.abandonedToRecordADefeat;

    if (!(await confirm(player, TEXT.menu.annulWar, body, 'Annul'))) {
      back();
      return;
    }

    const result = wars.annul(warId, player.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    const ended = result.value;
    player.sendMessage(successMsg(TEXT.menu.theWarWasAnnulled));
    notifyBothClans(ended, TEXT.menu.theWarHasBeenAnnulled);
    announce.warEnded(ended, wars.sideTotal(ended, ended.clanA), wars.sideTotal(ended, ended.clanB));
    warMenu(player);
  });
}

/**
 * Withdraws a peace offer this clan had standing.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {string} clanId
 * @param {() => void} back
 */
function withdrawPeaceFlow(player, warId, clanId, back) {
  run(player, async () => {
    const result = wars.withdrawPeace(warId, clanId);
    player.sendMessage(
      result.ok ? msg(TEXT.menu.peaceOfferWithdrawn) : errorMsg(result.error),
    );
    back();
  });
}

/**
 * Withdraws one of this clan's unanswered declarations.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function withdrawDeclarationPicker(player, clanId) {
  run(player, async () => {
    const outgoing = wars
      .warsFor(clanId)
      .filter((war) => war.state === 'pending' && war.clanA === clanId);
    if (outgoing.length === 0) {
      player.sendMessage(msg(TEXT.menu.youHaveNoUnansweredDeclarations));
      warMenu(player);
      return;
    }

    const form = action()
      .title(TEXT.menu.withdrawDeclaration)
      .body(TEXT.menu.theseClansHaveNotAnswered);
    for (const war of outgoing) form.button(`${C.aqua}${truncate(war.nameB, 22)}`);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      warMenu(player);
      return;
    }

    const war = outgoing[response.selection];
    if (!war) return;

    const result = wars.withdrawDeclaration(war.id, clanId);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else {
      player.sendMessage(msg(TEXT.menu.withdrewTheDeclarationAgainst(war.nameB)));
      players.notify(
        clans.getClan(war.clanB)?.ownerId ?? '',
        msg(TEXT.menu.withdrewItsDeclarationOfWar(war.nameA)),
      );
    }
    warMenu(player);
  });
}

/**
 * Every live war in the world, for staff.
 *
 * Reachable without belonging to a clan, which is the whole point: annulment
 * is the escape hatch for a war both clans have abandoned, and a neutral admin
 * is exactly who should be using it.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function staffWarBrowser(player, back) {
  run(player, async () => {
    if (!wars.canAnnul(player) && !wars.canAdjustKills(player)) {
      player.sendMessage(errorMsg(TEXT.menu.youDoNotHaveWar));
      return;
    }

    const live = wars.liveWars();
    if (live.length === 0) {
      player.sendMessage(msg(TEXT.menu.noWarsAreBeingFought));
      back?.();
      return;
    }

    const form = action()
      .title(TEXT.menu.activeWars)
      .body(TEXT.menu.warSInProgress(live.length));
    for (const war of live) {
      const state = war.state === 'pending' ? `${C.yellow}${TEXT.fragment.warPending}` : `${C.red}${TEXT.fragment.warActive}`;
      form.button(`${warLine(war)}\n${state}`);
    }
    if (back) form.button(TEXT.menu.back);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back?.();
      return;
    }

    const war = live[response.selection];
    // Viewed as a neutral party: no clan of their own is in play, so the
    // surrender and peace options correctly do not appear.
    if (war) warDetail(player, war.id, '');
    else back?.();
  });
}

/**
 * One war's record, opened from a printed book.
 *
 * @param {Player} player
 * @param {string} warId
 */
export function warRecord(player, warId, page = 0) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) {
      player.sendMessage(errorMsg(TEXT.menu.thatWarIsNoLonger));
      return;
    }

    // Read a page at a time, as the book is. Joining fifty pages into one form
    // body produced roughly twelve thousand characters in a panel meant for a
    // paragraph — technically shown, practically unreadable.
    const pages = warbook.buildPages(war);
    const index = Math.max(0, Math.min(page, pages.length - 1));

    const form = action()
      .title(`${C.gold}${warbook.bookName(war)}`)
      .body(
        pages.length > 1
          ? TEXT.menu.recordPageOf(pages[index], index + 1, pages.length)
          : pages[index],
      );

    /** @type {Array<() => void>} */
    const actions = [];
    if (index > 0) {
      form.button(TEXT.menu.pickerPrevious);
      actions.push(() => warRecord(player, warId, index - 1));
    }
    if (index < pages.length - 1) {
      form.button(TEXT.menu.pickerNext);
      actions.push(() => warRecord(player, warId, index + 1));
    }
    form.button(TEXT.menu.close);
    actions.push(() => {});

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}

// ── War history and record books ──────────────────────────────────────────

/**
 * Past wars, and the books that record them.
 *
 * A Leader sees their own clan's history without any staff standing; staff who
 * may print any clan's records get a clan picker first.
 *
 * @param {Player} player
 */
export function warHistoryMenu(player) {
  run(player, async () => {
    const own = clans.clanOf(player.id);
    const mayPrintAny = wars.canGenerateWarBooks(player);

    if (mayPrintAny) {
      const all = clans.allClans();
      if (all.length === 0) {
        player.sendMessage(msg(TEXT.menu.noClansExistYet));
        return;
      }

      // One pass over history for the whole list, rather than one per clan.
      const counts = wars.endedCountsByClan();
      const form = action()
        .title(TEXT.menu.warRecords)
        .body(TEXT.menu.chooseAClanWhoseWar);
      for (const clan of all) {
        const fought = counts.get(clan.id) ?? 0;
        form.button(
          TEXT.menu.finishedWarS(truncate(clan.name, 20), fought),
        );
      }

      const response = await show(form, player);
      if (response.canceled || response.selection === undefined) return;
      const chosen = all[response.selection];
      if (chosen) clanWarHistory(player, chosen.id);
      return;
    }

    if (!own) {
      player.sendMessage(errorMsg(TEXT.common.notInAClan));
      return;
    }
    clanWarHistory(player, own.id);
  });
}

/**
 * One clan's finished wars, addressable from a command.
 *
 * @param {Player} player
 * @param {string} clanId
 */
export function clanWarHistoryFor(player, clanId) {
  clanWarHistory(player, clanId);
}

/**
 * One clan's finished wars.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function clanWarHistory(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const history = wars.historyFor(clanId);
    if (history.length === 0) {
      player.sendMessage(msg(TEXT.menu.hasFoughtNoWarsTo(clan.name)));
      return;
    }

    const war = await pickFrom(player, {
      title: TEXT.menu.wars2(truncate(clan.name, 18)),
      body: TEXT.menu.finishedWarSSelectOne(history.length),
      items: history,
      describe: (entry) => {
        const them = wars.nameOf(entry, wars.opponentOf(entry, clanId));
        const verdict =
          entry.winner === clanId
            ? `${C.green}${TEXT.fragment.won}`
            : entry.winner
              ? `${C.red}${TEXT.fragment.lost}`
              : `${C.gray}${TEXT.fragment.drawn}`;
        return TEXT.menu.warHistoryRow(
          warbook.ordinal(entry.ordinal),
          truncate(them, 14),
          verdict,
          wars.sideTotal(entry, clanId),
          wars.sideTotal(entry, wars.opponentOf(entry, clanId)),
        );
      },
      match: (entry) => wars.nameOf(entry, wars.opponentOf(entry, clanId)),
    });

    if (war) printWarBook(player, war, clanId);
  });
}

/**
 * Prints the record for one war, after checking the viewer is entitled to it.
 *
 * @param {Player} player
 * @param {import('./wars.js').War} war
 * @param {string} clanId
 */
function printWarBook(player, war, clanId) {
  run(player, async () => {
    const own = clans.clanOf(player.id);
    const isTheirLeader = own !== undefined && own.id === clanId && clans.isOwner(own, player.id);
    if (!isTheirLeader && !wars.canGenerateWarBooks(player)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotPrintThatClan));
      return;
    }

    const printed = warbook.givePlayerBook(player, war);
    player.sendMessage(
      printed.ok ? successMsg(TEXT.menu.printed(printed.value)) : errorMsg(printed.error),
    );
    clanWarHistory(player, clanId);
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
        ? TEXT.menu.youCanRequestPromotionTo
        : TEXT.menu.youNeedMoreMemberS(needed - have));

    if (have < needed) {
      const info = action()
        .title(TEXT.menu.requestPromotion)
        .body(body)
        .button(TEXT.menu.close);
      await show(info, player);
      return;
    }

    if (!(await confirm(player, TEXT.menu.requestPromotion2, body, TEXT.menu.requestPromotion3))) {
      return;
    }

    const filed = requests.filePromotion({ id: player.id, name: player.name }, clan);
    if (!filed.ok) {
      player.sendMessage(errorMsg(filed.error));
      return;
    }

    player.sendMessage(
      msg(TEXT.menu.requestedPromotionForAwaitingReview(clan.name)),
    );
    for (const reviewer of world.getAllPlayers()) {
      if (!requests.canApprovePromotions(reviewer)) continue;
      reviewer.sendMessage(
        msg(
          TEXT.menu.hasRequestedPromotionToA(clan.name),
        ),
      );
    }
  });
}

// ── Colour picking ────────────────────────────────────────────────────────

/**
 * Dropdown labels for the shared colour palette, each shown in its own colour
 * so the choice is visible rather than described.
 *
 * @returns {string[]}
 */
function colorOptions() {
  const names = /** @type {Record<string, string>} */ (TEXT.color);
  return ROLE_COLOR_CHOICES.map((choice) => `${choice.code}${names[choice.id] ?? choice.id}`);
}

/**
 * The dropdown index of a colour code, defaulting to the first entry.
 *
 * @param {string} code
 * @returns {number}
 */
function colorIndex(code) {
  const index = ROLE_COLOR_CHOICES.findIndex((choice) => choice.code === code);
  return index < 0 ? 0 : index;
}

/**
 * The colour code behind a dropdown index.
 *
 * @param {unknown} value
 * @returns {string}
 */
function colorAt(value) {
  return ROLE_COLOR_CHOICES[Number(value ?? 0)]?.code ?? C.white;
}

/** How a title can be rendered, in dropdown order. */
const SHOW_AS_OPTIONS = [
  { id: 'symbol', label: TEXT.menu.symbolOnly },
  { id: 'name', label: TEXT.menu.nameOnly },
  { id: 'both', label: TEXT.menu.symbolAndName },
];

/**
 * @param {string | undefined} showAs
 * @returns {number}
 */
function showAsIndex(showAs) {
  const index = SHOW_AS_OPTIONS.findIndex((option) => option.id === showAs);
  return index < 0 ? 1 : index;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function showAsAt(value) {
  return SHOW_AS_OPTIONS[Number(value ?? 0)]?.id ?? 'name';
}

/** Where the Peaceful marker may appear, in dropdown order. */
const VISIBILITY_OPTIONS = [
  { id: 'both', label: TEXT.menu.nametagAndChat },
  { id: 'nametag', label: TEXT.menu.nametagOnly },
  { id: 'chat', label: TEXT.menu.chatOnly },
  { id: 'none', label: 'Hidden' },
];

// ── Display settings ──────────────────────────────────────────────────────

/**
 * The display settings hub. Split into its own screen from the behaviour
 * settings because it is a different question — how things look, not what the
 * system allows.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function displaySettingsMenu(player, back) {
  run(player, async () => {
    if (!staff.canManageStaffRoles(player)) {
      player.sendMessage(errorMsg(TEXT.common.notAdminSettings));
      return;
    }

    const form = action()
      .title(TEXT.menu.displaySettings)
      .body(TEXT.menu.howClanAndSystemIdentity)
      .button(TEXT.menu.nametagsRoleOrderBrackets)
      .button(TEXT.menu.chatRoleOrder)
      .button(TEXT.menu.adminTitleSymbolNameColour)
      .button(TEXT.menu.peacefulRoleSymbolVisibilityOrder)
      .button(TEXT.menu.coloursClanRoleOutpost);

    /** @type {Array<() => void>} */
    const actions = [
      () => nametagSettingsForm(player),
      () => chatSettingsForm(player),
      () => adminTitleForm(player),
      () => peacefulSettingsForm(player),
      () => colorSettingsForm(player),
    ];

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
 * @param {Player} player
 */
function nametagSettingsForm(player) {
  run(player, async () => {
    const { nametag } = settings.get().display;

    const response = await modal(TEXT.menu.nametagDisplay)
      .toggle('showRole', TEXT.menu.showTheClanRole, { defaultValue: nametag.showClanRole })
      .dropdown('position', TEXT.menu.rolePosition, [TEXT.menu.beforeTheClan, TEXT.menu.afterTheClan], {
        defaultValueIndex: nametag.rolePosition === 'after' ? 1 : 0,
      })
      .dropdown(
        'clanBrackets',
        TEXT.menu.clanBrackets,
        BRACKET_STYLES.map((style) => style.label),
        { defaultValueIndex: bracketIndex(nametag.clanBrackets) },
      )
      .dropdown(
        'roleBrackets',
        TEXT.menu.roleBrackets,
        BRACKET_STYLES.map((style) => style.label),
        { defaultValueIndex: bracketIndex(nametag.roleBrackets) },
      )
      .divider()
      .label(TEXT.menu.lowerNumbersAreDrawnFirst)
      .slider('systemOrder', TEXT.menu.systemTitleOrder, 0, 50, {
        defaultValue: nametag.systemOrder,
        valueStep: 5,
      })
      .slider('peacefulOrder', TEXT.menu.peacefulOrder, 0, 50, {
        defaultValue: nametag.peacefulOrder,
        valueStep: 5,
      })
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) {
      displaySettingsMenu(player);
      return;
    }

    settings.update({
      display: {
        nametag: {
          showClanRole: response.bool('showRole'),
          rolePosition: response.num('position') === 1 ? 'after' : 'before',
          clanBrackets: BRACKET_STYLES[response.num('clanBrackets')]?.id ?? 'off',
          roleBrackets: BRACKET_STYLES[response.num('roleBrackets')]?.id ?? 'square',
          systemOrder: response.num('systemOrder'),
          peacefulOrder: response.num('peacefulOrder', 10),
        },
      },
    });

    display.refreshAll();
    player.sendMessage(successMsg(TEXT.menu.nametagDisplayUpdated));
    displaySettingsMenu(player);
  });
}

/**
 * @param {Player} player
 */
function chatSettingsForm(player) {
  run(player, async () => {
    const { chat } = settings.get().display;

    const response = await modal(TEXT.menu.chatDisplay)
      .toggle('showRole', TEXT.menu.showTheClanRoleIn, {
        defaultValue: chat.showClanRole,
      })
      .divider()
      .label(TEXT.menu.lowerNumbersAreDrawnFirst2)
      .slider('systemOrder', TEXT.menu.systemTitleOrder, 0, 50, {
        defaultValue: chat.systemOrder,
        valueStep: 5,
      })
      .slider('clanOrder', TEXT.menu.clanTagOrder, 0, 50, {
        defaultValue: chat.clanOrder,
        valueStep: 5,
      })
      .slider('peacefulOrder', TEXT.menu.peacefulOrder, 0, 50, {
        defaultValue: chat.peacefulOrder,
        valueStep: 5,
      })
      // The name is a position in the same sequence, not a separate switch:
      // sliding a tag past it is what puts that tag after the name, and there
      // is no other control that could express that.
      .slider('nameOrder', TEXT.menu.playerNameOrder, 0, 50, {
        defaultValue: chat.nameOrder,
        valueStep: 5,
      })
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) {
      displaySettingsMenu(player);
      return;
    }

    settings.update({
      display: {
        chat: {
          showClanRole: response.bool('showRole'),
          systemOrder: response.num('systemOrder'),
          clanOrder: response.num('clanOrder', 10),
          peacefulOrder: response.num('peacefulOrder', 20),
          nameOrder: response.num('nameOrder', 30),
        },
      },
    });

    display.refreshAll();
    player.sendMessage(successMsg(TEXT.menu.chatDisplayUpdated));
    displaySettingsMenu(player);
  });
}

/**
 * The Admin title. Admin is not a staff role — it is derived from operator
 * status — so its symbol, name and colour live here rather than in the staff
 * role editor, even though they are edited for the same reason.
 *
 * @param {Player} player
 */
function adminTitleForm(player) {
  run(player, async () => {
    const { admin } = settings.get().display;

    const response = await modal(TEXT.menu.adminTitle)
      .label(TEXT.menu.adminIsOperatorStatusAnd)
      .textField('symbol', TEXT.menu.symbol, '✦', { defaultValue: admin.symbol })
      .textField('name', TEXT.menu.name, 'Admin', { defaultValue: admin.name })
      .dropdown('color', TEXT.menu.colour, colorOptions(), {
        defaultValueIndex: colorIndex(admin.color),
      })
      .dropdown(
        'showAs',
        TEXT.menu.showAs,
        SHOW_AS_OPTIONS.map((option) => option.label),
        { defaultValueIndex: showAsIndex(admin.showAs) },
      )
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) {
      displaySettingsMenu(player);
      return;
    }

    const cleanSymbol = validateStaffSymbol(response.str('symbol'));
    const cleanName = validateStaffRoleName(response.str('name'));
    if (!cleanSymbol.ok) {
      player.sendMessage(errorMsg(cleanSymbol.error));
      displaySettingsMenu(player);
      return;
    }
    if (!cleanName.ok) {
      player.sendMessage(errorMsg(cleanName.error));
      displaySettingsMenu(player);
      return;
    }

    settings.update({
      display: {
        admin: {
          symbol: cleanSymbol.value,
          name: cleanName.value,
          color: colorAt(response.num('color')),
          showAs: /** @type {'symbol' | 'name' | 'both'} */ (showAsAt(response.num('showAs'))),
        },
      },
    });

    display.refreshAll();
    player.sendMessage(successMsg(TEXT.menu.adminTitleUpdated));
    displaySettingsMenu(player);
  });
}

/**
 * @param {Player} player
 */
function peacefulSettingsForm(player) {
  run(player, async () => {
    const config = settings.get();
    const { peaceful: peace } = config.display;

    const response = await modal(TEXT.menu.peacefulRole)
      .textField('symbol', TEXT.menu.symbol, '☮', { defaultValue: peace.symbol })
      .textField('name', TEXT.menu.name, 'Peaceful', { defaultValue: peace.name })
      .dropdown('color', TEXT.menu.colour, colorOptions(), {
        defaultValueIndex: colorIndex(peace.color),
      })
      .dropdown(
        'showAs',
        TEXT.menu.showAs,
        SHOW_AS_OPTIONS.map((option) => option.label),
        { defaultValueIndex: showAsIndex(peace.showAs) },
      )
      .dropdown(
        'visibility',
        TEXT.menu.visibleIn,
        VISIBILITY_OPTIONS.map((option) => option.label),
        {
          defaultValueIndex: Math.max(
            0,
            VISIBILITY_OPTIONS.findIndex((option) => option.id === peace.visibility),
          ),
        },
      )
      .divider()
      .toggle('staffMayAssign', TEXT.menu.clanManagingStaffRolesMay2, {
        defaultValue: config.staffCanAssignPeaceful,
      })
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) {
      displaySettingsMenu(player);
      return;
    }

    const cleanSymbol = validateStaffSymbol(response.str('symbol'));
    const cleanName = validateStaffRoleName(response.str('name'));
    if (!cleanSymbol.ok) {
      player.sendMessage(errorMsg(cleanSymbol.error));
      displaySettingsMenu(player);
      return;
    }
    if (!cleanName.ok) {
      player.sendMessage(errorMsg(cleanName.error));
      displaySettingsMenu(player);
      return;
    }

    settings.update({
      staffCanAssignPeaceful: response.bool('staffMayAssign'),
      display: {
        peaceful: {
          symbol: cleanSymbol.value,
          name: cleanName.value,
          color: colorAt(response.num('color')),
          showAs: /** @type {'symbol' | 'name' | 'both'} */ (showAsAt(response.num('showAs'))),
          visibility: /** @type {'both' | 'nametag' | 'chat' | 'none'} */ (
            VISIBILITY_OPTIONS[response.num('visibility')]?.id ?? 'both'
          ),
        },
      },
    });

    display.refreshAll();
    player.sendMessage(successMsg(TEXT.menu.peacefulRoleUpdated));
    displaySettingsMenu(player);
  });
}

/**
 * @param {Player} player
 */
function colorSettingsForm(player) {
  run(player, async () => {
    const { colors } = settings.get().display;

    const response = await modal(`${C.aqua}Colours`)
      .label(TEXT.menu.coloursAreDefaultsBody)
      .dropdown('clan', TEXT.menu.clanName, colorOptions(), {
        defaultValueIndex: colorIndex(colors.clan),
      })
      .dropdown('role', TEXT.menu.clanRole, colorOptions(), {
        defaultValueIndex: colorIndex(colors.role),
      })
      .dropdown('outpost', TEXT.menu.outpostName, colorOptions(), {
        defaultValueIndex: colorIndex(colors.outpost),
      })
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) {
      displaySettingsMenu(player);
      return;
    }

    settings.update({
      display: {
        colors: {
          clan: colorAt(response.num('clan')),
          role: colorAt(response.num('role')),
          outpost: colorAt(response.num('outpost')),
        },
      },
    });

    display.refreshAll();
    player.sendMessage(successMsg(TEXT.menu.coloursUpdated));
    displaySettingsMenu(player);
  });
}

/**
 * Who currently holds the Peaceful marker.
 *
 * A marker that can be granted from several places is worth being able to
 * audit from one.
 *
 * @param {Player} player
 */
export function peacefulRoster(player) {
  run(player, async () => {
    if (!peaceful.canAssign(player)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotViewThePeaceful));
      return;
    }

    const config = settings.get().display.peaceful;
    const held = peaceful.all().map((id) => players.ref(id));
    if (held.length === 0) {
      player.sendMessage(msg(TEXT.menu.nobodyHoldsTheRole(config.name)));
      return;
    }

    held.sort((a, b) => a.name.localeCompare(b.name));
    const rows = held
      .map((ref) => `${C.gray} - ${ref.online ? C.green : C.darkGray}${ref.name}`)
      .join('\n');
    player.sendMessage(msg(TEXT.menu.roster(config.color, config.name, held.length, rows)));
  });
}

// ── Peaceful assignment ───────────────────────────────────────────────────

/**
 * Grants or clears the Peaceful marker. Separate from the staff-role picker
 * because Peaceful stacks with a system role rather than replacing it.
 *
 * @param {Player} player
 */
export function peacefulPicker(player) {
  run(player, async () => {
    if (!peaceful.canAssign(player)) {
      player.sendMessage(errorMsg(TEXT.common.notPeacefulAssigner));
      return;
    }

    const known = players.allKnown();
    if (known.length === 0) {
      player.sendMessage(msg(TEXT.menu.noPlayersOnRecordYet));
      return;
    }

    const config = settings.get().display.peaceful;
    const target = await pickPlayer(player, {
      title: `${config.color}${config.name}`,
      body:
        TEXT.menu.selectAPlayerToGrant +
        `${config.color}${config.name}${C.gray} role.\n` +
        TEXT.menu.itStacksWithAdminAnd,
      candidates: known,
      describe: (ref) =>
        `${onlineDot(ref)} ${C.white}${truncate(ref.name, 20)}\n` +
        (peaceful.isPeaceful(ref.id)
          ? `${config.color}${config.name}`
          : `${C.darkGray}${TEXT.fragment.notMarked}`),
    });

    if (!target) return;

    const next = !peaceful.isPeaceful(target.id);
    peaceful.set(target.id, next);
    display.refreshById(target.id);

    player.sendMessage(
      successMsg(
        next
          ? TEXT.menu.isNow2(target.name, config.name)
          : TEXT.menu.clearedFrom(config.name, target.name),
      ),
    );
    players.notify(
      target.id,
      msg(
        next
          ? TEXT.menu.youHaveBeenGivenThe(config.color, config.name)
          : TEXT.menu.yourRoleWasRemoved(config.name),
      ),
    );
    peacefulPicker(player);
  });
}
