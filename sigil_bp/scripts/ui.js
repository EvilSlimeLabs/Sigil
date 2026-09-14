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
 *
 * The screens themselves live in `ui/`, one module per menu family, and those
 * modules import in one direction only: `shared` holds what they are all built
 * from, and nothing there opens a screen. This module draws the main menu and
 * re-exports every screen a command, the War Map or the Clan Ledger opens
 * directly, so `ui.js` stays the only name the rest of the pack imports.
 */

import { action, showAction as show } from './forms.js';
import { TEXT } from './text.js';
import * as clans from './clans.js';
import * as staff from './staff.js';
import * as invites from './invites.js';
import * as requests from './requests.js';
import { canReachAdminTools, run } from './ui/shared.js';
import { browseClans, createClanForm, invitesMenu, myClanMenu } from './ui/clan.js';
import { adminMenu, systemSettingsMenu } from './ui/staff.js';

/** @typedef {import('@minecraft/server').Player} Player */

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
        ? TEXT.menu.mainMenuBody(clan.name, clans.roleOf(clan, player.id) || 'a member')
        : TEXT.cmd.notInAClan,
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
    // in the clan menu made the map look like decoration.

    form.button(TEXT.menu.browseClans);
    actions.push(() => browseClans(player, home));

    // Everything a staff role or an admin can reach sits behind these two
    // buttons, so an operator opening the menu to look at their own clan sees
    // the same short list an ordinary player does.
    if (canReachAdminTools(player)) {
      const queued = requests.pendingFor(player);
      form.button(
        queued > 0 ? TEXT.menu.adminToolsWaiting(queued) : TEXT.menu.adminTools,
      );
      actions.push(() => adminMenu(player, home));
    }

    if (staff.canManageStaffRoles(player)) {
      form.button(TEXT.menu.systemSettings);
      actions.push(() => systemSettingsMenu(player, home));
    }

    // The wordmark is a signature rather than a heading, so it is added after
    // the buttons and lands below them. `header` is the only text an action
    // form draws larger than body text; the colour sits close to the panel.
    form.divider().header(TEXT.menu.sigilBrand);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}

// ── The screens the rest of the pack opens directly ───────────────────────

export {
  browseClans,
  clanColorForm,
  createClanForPlayer,
  createClanForm,
  disbandFlow,
  invitesMenu,
  memberBrowser,
  myClanMenu,
  promotionRequest,
} from './ui/clan.js';

export {
  peacefulPicker,
  peacefulRoster,
} from './ui/peaceful.js';

export {
  adminTitleForm,
  displaySettingsMenu,
  settingsMenu,
} from './ui/settings.js';

export {
  clanWarHistory,
  clanWarHistoryFor,
  staffWarBrowser,
  warHistoryMenu,
  warMenu,
  warRecord,
  warStandings,
} from './ui/war.js';

export {
  adminMenu,
  demotionQueue,
  purgeConfirm,
  purgePicker,
  requestQueue,
  staffClanBrowser,
  staffRoleMenu,
  systemSettingsMenu,
} from './ui/staff.js';
