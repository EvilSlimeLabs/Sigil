// @ts-check
/**
 * The settings screens: the system switches, and the display forms behind them
 * that decide how a clan renders on a nametag, in chat, and on the roster.
 */

import { action, showAction as show, modal } from '../forms.js';
import { C, LIMITS } from '../config.js';
import { BRACKET_STYLES, bracketIndex } from '../brackets.js';
import { errorMsg, successMsg, validateStaffRoleName, validateStaffSymbol } from '../format.js';
import { TEXT } from '../text.js';
import * as staff from '../staff.js';
import * as settings from '../settings.js';
import * as display from '../display.js';
import {
  SHOW_AS_OPTIONS,
  VISIBILITY_OPTIONS,
  bracketAnswers,
  colorAt,
  colorIndex,
  colorOptions,
  run,
  showAsAt,
  showAsIndex,
  symbolAt,
  symbolChoicesFor,
  symbolIndex,
  symbolOptions,
  withBracketControls,
} from './shared.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../clans.js').Clan} Clan */

// ── Settings ──────────────────────────────────────────────────────────────

/**
 * Admin-only settings, including the switch that lets staff roles approve
 * clans, so a clan-managing role cannot widen its own powers.
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
      .toggle('requireApproval', TEXT.menu.settingRequireApproval, {
        defaultValue: current.requireClanApproval,
      })
      .divider()
      .header(TEXT.menu.membership)
      .label(TEXT.menu.memberCapsHint)
      .slider('promotionMembers', TEXT.menu.settingPromotionThreshold, 1, 25, {
        defaultValue: settings.promotionThreshold(),
        valueStep: 1,
      })
      .slider('maxOutpost', TEXT.menu.maxMembersOutpost, 1, LIMITS.maxMembersPerClan, {
        defaultValue: settings.memberLimit(true),
        valueStep: 1,
      })
      .slider('maxClan', TEXT.menu.maxMembersClan, 1, LIMITS.maxMembersPerClan, {
        defaultValue: settings.memberLimit(false),
        valueStep: 1,
      })
      .divider()
      .header(TEXT.menu.wars)
      .toggle('warNeedsAcceptance', TEXT.menu.declarationsMustBeAccepted, {
        defaultValue: current.warRequiresAcceptance,
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
      outpostPromotionMembers: response.num('promotionMembers', current.outpostPromotionMembers),
      maxOutpostMembers: response.num('maxOutpost', current.maxOutpostMembers),
      maxClanMembers: response.num('maxClan', current.maxClanMembers),
      warRequiresAcceptance: response.bool('warNeedsAcceptance'),
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
      .button(TEXT.menu.peacefulSettingsButton)
      .button(TEXT.menu.coloursClanRoleOutpost);

    /** @type {Array<() => void>} */
    const actions = [
      () => nametagSettingsForm(player),
      () => chatSettingsForm(player),
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
      .dropdown('clanBracketColor', TEXT.menu.clanBracketColour, colorOptions(), {
        defaultValueIndex: colorIndex(nametag.clanBracketColor),
      })
      .dropdown(
        'roleBrackets',
        TEXT.menu.roleBrackets,
        BRACKET_STYLES.map((style) => style.label),
        { defaultValueIndex: bracketIndex(nametag.roleBrackets) },
      )
      .dropdown('roleBracketColor', TEXT.menu.roleBracketColour, colorOptions(), {
        defaultValueIndex: colorIndex(nametag.roleBracketColor),
      })
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
          clanBracketColor: colorAt(response.num('clanBracketColor')),
          roleBrackets: BRACKET_STYLES[response.num('roleBrackets')]?.id ?? 'square',
          roleBracketColor: colorAt(response.num('roleBracketColor')),
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
      .toggle('showRole', TEXT.menu.settingShowRoleInChat, {
        defaultValue: chat.showClanRole,
      })
      .dropdown(
        'clanBrackets',
        TEXT.menu.chatClanBrackets,
        BRACKET_STYLES.map((style) => style.label),
        { defaultValueIndex: bracketIndex(chat.clanBrackets) },
      )
      .dropdown('clanBracketColor', TEXT.menu.chatClanBracketColour, colorOptions(), {
        defaultValueIndex: colorIndex(chat.clanBracketColor),
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
          clanBrackets: BRACKET_STYLES[response.num('clanBrackets')]?.id ?? 'square',
          clanBracketColor: colorAt(response.num('clanBracketColor')),
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
 * The Admin title.
 *
 * Admin is not a staff role: it comes from operator status, so it cannot be
 * created, deleted or assigned, and the form is correspondingly narrower — a
 * symbol, a name, a colour and how they are shown, with none of the powers a
 * staff role carries because an admin already holds all of them.
 *
 * It is still edited from the staff role list, beside the roles it sits above.
 * Splitting "how a system title looks" across two screens on the grounds that
 * one of them is not technically a role was a distinction that meant something
 * to the code and nothing to the person looking for it.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function adminTitleForm(player, back) {
  run(player, async () => {
    const { admin } = settings.get().display;
    const leave = back ?? (() => displaySettingsMenu(player));
    const symbols = symbolChoicesFor(admin.symbol);

    const response = await withBracketControls(
      modal(TEXT.menu.adminTitle)
      .label(TEXT.menu.adminNotAssignable)
      .dropdown('symbol', TEXT.menu.symbol, symbolOptions(symbols), {
        defaultValueIndex: symbolIndex(symbols, admin.symbol),
      })
      .textField('name', TEXT.menu.name, 'Admin', { defaultValue: admin.name })
      .dropdown('color', TEXT.menu.colour, colorOptions(), {
        defaultValueIndex: colorIndex(admin.color),
      })
      .dropdown(
        'showAs',
        TEXT.menu.showAs,
        SHOW_AS_OPTIONS.map((option) => option.label),
        { defaultValueIndex: showAsIndex(admin.showAs) },
      ),
      admin,
    )
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) {
      leave();
      return;
    }

    const cleanSymbol = validateStaffSymbol(symbolAt(symbols, response.num('symbol')));
    const cleanName = validateStaffRoleName(response.str('name'));
    if (!cleanSymbol.ok) {
      player.sendMessage(errorMsg(cleanSymbol.error));
      leave();
      return;
    }
    if (!cleanName.ok) {
      player.sendMessage(errorMsg(cleanName.error));
      leave();
      return;
    }

    settings.update({
      display: {
        admin: {
          symbol: cleanSymbol.value,
          name: cleanName.value,
          color: colorAt(response.num('color')),
          showAs: /** @type {'symbol' | 'name' | 'both'} */ (showAsAt(response.num('showAs'))),
          ...bracketAnswers(response),
        },
      },
    });

    display.refreshAll();
    player.sendMessage(successMsg(TEXT.menu.adminTitleUpdated));
    leave();
  });
}


/**
 * @param {Player} player
 */
function peacefulSettingsForm(player) {
  run(player, async () => {
    const config = settings.get();
    const { peaceful: peace } = config.display;
    const symbols = symbolChoicesFor(peace.symbol);

    const response = await modal(TEXT.menu.peacefulRole)
      .dropdown('symbol', TEXT.menu.symbol, symbolOptions(symbols), {
        defaultValueIndex: symbolIndex(symbols, peace.symbol),
      })
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
      .submitButton(TEXT.menu.save)
      .show(player);

    if (response.canceled) {
      displaySettingsMenu(player);
      return;
    }

    const cleanSymbol = validateStaffSymbol(symbolAt(symbols, response.num('symbol')));
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
        peaceful: {
          symbol: cleanSymbol.value,
          name: cleanName.value,
          color: colorAt(response.num('color')),
          showAs: /** @type {'symbol' | 'name' | 'both'} */ (showAsAt(response.num('showAs'))),
          ...bracketAnswers(response),
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
