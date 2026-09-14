// @ts-check
/**
 * The pieces every menu family is built from: the wrapper that runs a screen,
 * the confirm dialog, the paged pickers, and the dropdown helpers that turn a
 * stored colour, symbol or bracket style into a form control and back.
 *
 * Nothing here opens a screen of its own, which is what keeps it at the bottom
 * of the family graph: every other module under `ui/` imports this one, and
 * this one imports none of them.
 */

import { action, showAction as show, modal } from '../forms.js';
import { C, ROLE_COLOR_CHOICES, SYMBOL_CHOICES } from '../config.js';
import { BRACKET_STYLES, bracketIndex } from '../brackets.js';
import { errorMsg, truncate } from '../format.js';
import { TEXT } from '../text.js';
import * as settings from '../settings.js';
import * as staff from '../staff.js';
import * as requests from '../requests.js';
import * as peaceful from '../peaceful.js';
import * as players from '../players.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../clans.js').Clan} Clan */

/**
 * Runs a screen, reporting failures to the player rather than losing them to an
 * unhandled rejection.
 *
 * @param {Player} player
 * @param {() => Promise<void>} screen
 */
export function run(player, screen) {
  screen().catch((err) => {
    console.warn(`[sigil] UI failed for ${player.name}: ${err}`);
    player.sendMessage(errorMsg(TEXT.menu.menuFailed));
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
export async function confirm(player, title, body, confirmLabel) {
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
 * A form of four hundred buttons is not a menu, so past a threshold the screen
 * asks for a search term first, and past a screenful of matches it pages. Every
 * list screen goes through here, so they all behave the same way at any size.
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
export async function pickFrom(player, { title, body, items, describe, match, back }) {
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
export async function pickPlayer(player, { title, body, candidates, describe, back }) {
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
export function onlineDot(entry) {
  return entry.online ? `${C.green}●` : `${C.darkGray}●`;
}


/**
 * Renders one member as a form button label.
 *
 * @param {Clan} clan
 * @param {{ id: string, member: import('../clans.js').ClanMember, role: string }} row
 * @returns {string}
 */
export function memberLabel(clan, row) {
  const online = players.onlinePlayer(row.id) !== undefined;
  const dot = online ? `${C.green}●` : `${C.darkGray}●`;
  const crown = row.id === clan.ownerId ? `${C.yellow}★ ` : '';
  const role = row.role ? `\n${C.gray}${row.role}` : '';
  return `${dot} ${crown}${C.white}${truncate(row.member.name, 20)}${role}`;
}


/**
 * Whether the war system is on, telling the player when it is not.
 *
 * Every war screen and war command asks this first, so a server with wars
 * turned off answers the same way everywhere rather than showing a screen that
 * refuses at the last step.
 *
 * @param {Player} player
 * @returns {boolean}
 */
export function warsOn(player) {
  if (settings.warsEnabled()) return true;
  player.sendMessage(errorMsg(TEXT.war.warsAreDisabled));
  return false;
}


/**
 * Whether a player has any reason at all to open the Admin screen.
 *
 * Asked before the button is drawn so that holding one narrow permission — a
 * staff role that may only review promotions, say — opens a door to that one
 * thing rather than to an empty room.
 *
 * @param {Player} player
 * @returns {boolean}
 */
export function canReachAdminTools(player) {
  return (
    staff.isAdmin(player) ||
    staff.canManageAnyClan(player) ||
    requests.canApprove(player) ||
    requests.canApprovePromotions(player) ||
    peaceful.canAssign(player)
  );
}


// ── Colour picking ────────────────────────────────────────────────────────

/**
 * Dropdown labels for the shared colour palette, each shown in its own colour
 * so the choice is visible rather than described.
 *
 * @returns {string[]}
 */
export function colorOptions() {
  const names = /** @type {Record<string, string>} */ (TEXT.color);
  return ROLE_COLOR_CHOICES.map((choice) => `${choice.code}${names[choice.id] ?? choice.id}`);
}


/**
 * The dropdown index of a colour code, defaulting to the first entry.
 *
 * @param {string} code
 * @returns {number}
 */
export function colorIndex(code) {
  const index = ROLE_COLOR_CHOICES.findIndex((choice) => choice.code === code);
  return index < 0 ? 0 : index;
}


/**
 * The colour code behind a dropdown index.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function colorAt(value) {
  return ROLE_COLOR_CHOICES[Number(value ?? 0)]?.code ?? C.white;
}


/**
 * The symbol palette, with the current value kept at the front when it is not
 * one of the curated glyphs.
 *
 * A stored symbol from before the curated list can be anything. A plain lookup
 * would read a missing entry as index 0 and change the role's tag the next time
 * the form was opened, so an unrecognised value is kept and offered first.
 *
 * @param {string} current
 * @returns {Array<{ id: string, symbol: string }>}
 */
export function symbolChoicesFor(current) {
  if (current === '' || SYMBOL_CHOICES.some((choice) => choice.symbol === current)) {
    return SYMBOL_CHOICES;
  }
  return [{ id: 'current', symbol: current }, ...SYMBOL_CHOICES];
}


/**
 * Dropdown labels: the glyph itself, then its name. A column of bare glyphs is
 * unreadable at a glance, and the name is what makes the list scannable.
 *
 * @param {Array<{ id: string, symbol: string }>} choices
 * @returns {string[]}
 */
export function symbolOptions(choices) {
  const names = /** @type {Record<string, string>} */ (TEXT.symbol);
  return choices.map((choice) =>
    choice.id === 'current'
      ? TEXT.menu.symbolKeepCurrent(choice.symbol)
      : `${choice.symbol}  ${names[choice.id] ?? choice.id}`,
  );
}


/**
 * @param {Array<{ id: string, symbol: string }>} choices
 * @param {string} current
 * @returns {number}
 */
export function symbolIndex(choices, current) {
  const index = choices.findIndex((choice) => choice.symbol === current);
  return index < 0 ? 0 : index;
}


/**
 * @param {Array<{ id: string, symbol: string }>} choices
 * @param {unknown} value
 * @returns {string}
 */
export function symbolAt(choices, value) {
  return choices[Number(value ?? 0)]?.symbol ?? choices[0].symbol;
}


/**
 * Adds the bracket style and colour controls a system title carries.
 *
 * Three forms want exactly this pair — staff roles, the Admin title and the
 * Peaceful marker — and they have to agree on the keys they read back, so the
 * pair is built in one place rather than copied three times.
 *
 * @template {{ dropdown: (key: string, label: string, items: string[], options?: any) => T }} T
 * @param {T} form
 * @param {{ brackets?: string, bracketColor?: string }} current
 * @returns {T}
 */
export function withBracketControls(form, current) {
  return form
    .dropdown(
      'brackets',
      TEXT.menu.titleBrackets,
      BRACKET_STYLES.map((style) => style.label),
      { defaultValueIndex: bracketIndex(current.brackets ?? 'off') },
    )
    .dropdown('bracketColor', TEXT.menu.titleBracketColour, colorOptions(), {
      defaultValueIndex: colorIndex(current.bracketColor ?? C.darkGray),
    });
}


/**
 * Reads that pair back.
 *
 * @param {import('../forms.js').ModalResult} response
 * @returns {{ brackets: string, bracketColor: string }}
 */
export function bracketAnswers(response) {
  return {
    brackets: BRACKET_STYLES[response.num('brackets')]?.id ?? 'off',
    bracketColor: colorAt(response.num('bracketColor')),
  };
}


/** How a title can be rendered, in dropdown order. */
export const SHOW_AS_OPTIONS = [
  { id: 'symbol', label: TEXT.menu.symbolOnly },
  { id: 'name', label: TEXT.menu.nameOnly },
  { id: 'both', label: TEXT.menu.symbolAndName },
];


/**
 * @param {string | undefined} showAs
 * @returns {number}
 */
export function showAsIndex(showAs) {
  const index = SHOW_AS_OPTIONS.findIndex((option) => option.id === showAs);
  return index < 0 ? 1 : index;
}


/**
 * @param {unknown} value
 * @returns {string}
 */
export function showAsAt(value) {
  return SHOW_AS_OPTIONS[Number(value ?? 0)]?.id ?? 'name';
}


/** Where the Peaceful marker may appear, in dropdown order. */
export const VISIBILITY_OPTIONS = [
  { id: 'both', label: TEXT.menu.nametagAndChat },
  { id: 'nametag', label: TEXT.menu.nametagOnly },
  { id: 'chat', label: TEXT.menu.chatOnly },
  { id: 'none', label: 'Hidden' },
];
