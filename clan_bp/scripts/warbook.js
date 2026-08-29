// @ts-check
/**
 * Rendering a finished war into a signed, written book.
 *
 * The book is generated on demand and never stored — the war record is the
 * truth, and this is one rendering of it. That also means a book is a snapshot:
 * signed books are immutable, so a kill correction made afterwards will not
 * appear in a copy already handed out. Reprinting gives the corrected figures,
 * and the last page says so.
 *
 * This is entirely **stable** API. `ItemBookComponent` (`minecraft:book`) is
 * present in `@minecraft/server` 2.9.0 with no `@beta` tag; nothing here needs
 * the beta module.
 *
 * The engine imposes three limits, all handled below:
 *
 *   - **16 characters** for a signed title. "3rd Wolves vs Ravens War" does not
 *     fit, so the book is titled `War #3` and the full name goes on the item,
 *     via `ItemStack.nameTag`, which has no such cap.
 *   - **256 characters** per page. Pages are filled by measured length rather
 *     than a fixed rows-per-page guess.
 *   - **50 pages**. A 100-v-100 war needs about twenty, so this is comfortable;
 *     past it the roster tail is truncated with a stated count rather than
 *     throwing.
 */

import { ItemStack } from '@minecraft/server';
import { BOOK_ITEM, C, LIMITS, WAR_STAMP } from './config.js';
import * as wars from './wars.js';
import { TEXT } from './text.js';

/** @typedef {import('./wars.js').War} War */

/**
 * What separates the human half of a stamped lore line from the war id.
 *
 * The label beside it is translatable and lives in the catalogue, because it is
 * text a player reads. This is not: it is the token the id is found by, and a
 * translator changing it would orphan every book already printed. Keeping the
 * two apart is what lets the wording move without the parsing moving with it.
 */
const STAMP_SEPARATOR = ' · ';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * `1st`, `2nd`, `3rd`, `4th` — including the 11th-to-13th exceptions.
 *
 * @param {number} n
 * @returns {string}
 */
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * A short date. Rendered in UTC rather than local time so two players reading
 * the same book never see different dates on it.
 *
 * @param {number} seconds unix seconds
 * @returns {string}
 */
function shortDate(seconds) {
  if (!seconds) return TEXT.fragment.unknownDate;
  const d = new Date(seconds * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * When the war was fought. A war begun and finished the same day reads as one
 * date rather than the same date twice.
 *
 * @param {War} war
 * @returns {string[]}
 */
function foughtLines(war) {
  const from = shortDate(war.startedAt || war.declaredAt);
  const to = shortDate(war.endedAt);
  return from === to ? [`Fought ${from}`] : [`Fought ${from}`, `to ${to}`];
}

/**
 * The name shown on the item itself, which has no length cap.
 *
 * @param {War} war
 * @returns {string}
 */
export function bookName(war) {
  return `War #${war.ordinal}: ${war.nameA} vs ${war.nameB}`;
}

/**
 * The signed title, kept inside the engine's 16-character cap. Clan names are
 * left out; two 16-character names would leave room for nothing else.
 *
 * @param {War} war
 * @returns {string}
 */
export function bookTitle(war) {
  return `War #${war.ordinal}`.slice(0, LIMITS.bookTitleChars);
}

/**
 * How the war ended, as a line of prose.
 *
 * @param {War} war
 * @returns {string[]}
 */
function outcomeLines(war) {
  const winnerName = war.winner ? wars.nameOf(war, war.winner) : '';
  switch (war.outcome) {
    case 'surrender':
      return [`Winner: ${winnerName}`, `${wars.nameOf(war, war.loser)} surrendered.`];
    case 'forfeit':
      return [`Winner: ${winnerName}`, `${wars.nameOf(war, war.loser)} forfeited.`];
    case 'peace':
      return ['No winner.', TEXT.book.peaceWasAgreed];
    case 'annulled':
      return ['No winner.', 'Annulled by staff.'];
    default:
      return [TEXT.book.unfinishedStamp];
  }
}

/**
 * One roster line: a name on the left, a count on the right.
 *
 * @param {string} name
 * @param {number} kills
 * @returns {string}
 */
function row(name, kills) {
  // Sized against the page width rather than a fixed guess, so a 16-character
  // gamertag survives intact whenever the count leaves room for it.
  const room = LIMITS.bookLineChars - String(kills).length - 1;
  const trimmed = name.length > room ? `${name.slice(0, room - 1)}…` : name;
  return `${trimmed.padEnd(room, ' ')} ${kills}`;
}

/**
 * How many rendered lines a string will occupy once the book wraps it.
 *
 * The engine caps a page at 256 characters and says nothing about lines — the
 * line budget is a rendering concern, and a page that overflows it is simply
 * unreadable rather than refused. Long text wraps, so a 22-character clan
 * header costs two lines, which is what pushes the last row of a roster off the
 * bottom of a page.
 *
 * @param {string} text
 * @returns {number}
 */
function renderedLines(text) {
  return Math.max(1, Math.ceil(text.length / LIMITS.bookLineChars));
}

/**
 * The roster rows for one side: everyone who scored, highest first, then
 * everyone who did not, so the roster is complete even when few landed a kill.
 * An unattributed adjustment gets its own row, and only when it is non-zero.
 *
 * @param {War} war
 * @param {string} clanId
 * @returns {string[]}
 */
function sideRows(war, clanId) {
  const side = war.sides[clanId];
  const members = Object.values(side?.byPlayer ?? {}).sort(
    (a, b) => b.kills - a.kills || a.name.localeCompare(b.name),
  );

  const rows = members.map((member) => row(member.name, member.kills));
  if ((side?.adjust ?? 0) !== 0) rows.push(row('Adjustment', side.adjust));
  if (rows.length === 0) rows.push(TEXT.book.noKillsRecorded);
  return rows;
}

/**
 * Lays a titled list across as many pages as it needs, repeating the heading
 * on every continuation.
 *
 * A clan with more members than fit on one page continues onto the next, and
 * the heading is repeated there so a page of names always says whose roster it
 * is.
 *
 * @param {string} heading
 * @param {string[]} rows
 * @returns {string[]}
 */
function sectionPages(heading, rows) {
  /** @type {string[]} */
  const pages = [];
  let index = 0;

  do {
    const title = pages.length === 0 ? heading : `${heading} (cont.)`;
    const body = [title, ''];
    let used = renderedLines(title) + 1;

    while (index < rows.length) {
      const cost = renderedLines(rows[index]);
      const candidate = [...body, rows[index]].join('\n');
      const fits = used + cost <= LIMITS.bookPageLines && candidate.length <= LIMITS.bookPageChars;

      if (!fits) {
        if (body.length > 2) break; // it will fit on the next page

        // It fits nowhere, so trim it to the room left rather than push it
        // regardless and blow the page limit the caller was promised.
        const room = Math.max(0, LIMITS.bookPageChars - candidate.length + rows[index].length);
        body.push(rows[index].slice(0, Math.max(1, room)));
        index += 1;
        break;
      }

      body.push(rows[index]);
      used += cost;
      index += 1;
    }

    pages.push(body.join('\n'));
  } while (index < rows.length);

  return pages;
}

/**
 * Packs lines into pages, respecting both the character cap and a line count
 * chosen so a page reads comfortably rather than filling edge to edge.
 *
 * A line longer than a whole page would otherwise loop forever, so it is hard
 * truncated — nothing the add-on writes should reach that, but a book that
 * silently hangs the server would be a poor way to find out.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function paginate(lines) {
  /** @type {string[]} */
  const pages = [];
  /** @type {string[]} */
  let current = [];

  let used = 0;

  const flush = () => {
    if (current.length > 0) {
      pages.push(current.join('\n'));
      current = [];
      used = 0;
    }
  };

  for (const raw of lines) {
    const line = raw.length > LIMITS.bookPageChars ? raw.slice(0, LIMITS.bookPageChars) : raw;
    if (line === '\f') {
      flush();
      continue;
    }
    // Budgeted in rendered lines, not source lines: a sentence longer than the
    // book is wide wraps and costs two, and counting it as one is what pushes
    // the last line of a page off the bottom.
    const cost = renderedLines(line);
    const candidate = [...current, line].join('\n');
    if (used + cost > LIMITS.bookPageLines || candidate.length > LIMITS.bookPageChars) {
      flush();
    }
    current.push(line);
    used += cost;
  }
  flush();

  return pages;
}

/**
 * Renders a finished war as book pages.
 *
 * @param {War} war
 * @returns {string[]}
 */
export function buildPages(war) {
  const totalA = wars.sideTotal(war, war.clanA);
  const totalB = wars.sideTotal(war, war.clanB);

  const summary = paginate([
    `== ${ordinal(war.ordinal)} War ==`,
    `${war.nameA}`,
    'vs',
    `${war.nameB}`,
    '',
    ...outcomeLines(war),
    '',
    TEXT.book.totalKills,
    row(war.nameA, totalA),
    row(war.nameB, totalB),
    '',
    ...foughtLines(war),
  ]);

  const closing = paginate([
    'Figures as of',
    'printing. Later',
    TEXT.book.correctionsLineOne,
    TEXT.book.correctionsLineTwo,
  ]);

  const pages = [
    ...summary,
    ...sectionPages(`${war.nameA} — ${totalA}`, sideRows(war, war.clanA)),
    ...sectionPages(`${war.nameB} — ${totalB}`, sideRows(war, war.clanB)),
    ...closing,
  ];
  if (pages.length <= LIMITS.bookMaxPages) return pages;

  // Past the cap, say how much was left out rather than dropping it silently.
  const kept = pages.slice(0, LIMITS.bookMaxPages - 1);
  kept.push(TEXT.book.pagesOmitted(pages.length - kept.length));
  return kept;
}

/**
 * Builds the book item for a war.
 *
 * @param {War} war
 * @param {string} author
 * @returns {ItemStack}
 */
export function buildBook(war, author) {
  const book = new ItemStack(BOOK_ITEM, 1);
  const contents = book.getComponent('minecraft:book');
  if (!contents) {
    throw new Error(TEXT.book.notABook(BOOK_ITEM));
  }

  contents.setContents(buildPages(war));
  contents.signBook(bookTitle(war), author);

  book.nameTag = bookName(war);
  // Stamped so the item knows which war it documents: holding the book and
  // using it reopens that war's record, which makes a printed copy a shortcut
  // as well as a keepsake.
  //
  // The stamp is a line of lore rather than a dynamic property. Signing turns
  // the book into a written book, which stacks in Bedrock, and the engine
  // refuses dynamic properties on anything stackable — `setDynamicProperty`
  // threw and took the whole print with it. Lore has no such restriction, and
  // it is honest about itself: the line is visible under the book's name, where
  // a catalogue reference on a record belongs.
  book.setLore([`${C.darkGray}${TEXT.book.recordStamp}${STAMP_SEPARATOR}${war.id}`]);
  return book;
}

/**
 * The war a book documents, if the stack is one of ours.
 *
 * @param {import('@minecraft/server').ItemStack | undefined} item
 * @returns {War | undefined}
 */
export function warOfBook(item) {
  if (!item || item.typeId !== BOOK_ITEM) return undefined;

  for (const line of item.getLore()) {
    const at = line.lastIndexOf(STAMP_SEPARATOR);
    if (at < 0) continue;
    return wars.getWar(line.slice(at + STAMP_SEPARATOR.length).trim());
  }

  // Books printed before the stamp moved to lore carry a dynamic property
  // instead. Reading one is harmless, so old copies keep working.
  try {
    const warId = item.getDynamicProperty(WAR_STAMP);
    return typeof warId === 'string' ? wars.getWar(warId) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the book and puts it in the player's inventory.
 *
 * @param {import('@minecraft/server').Player} player
 * @param {War} war
 * @returns {import('./format.js').Result<string>} the book's name
 */
export function givePlayerBook(player, war) {
  if (war.state !== 'ended') {
    return { ok: false, error: TEXT.book.warStillFought };
  }

  const inventory = player.getComponent('minecraft:inventory');
  const container = inventory?.container;
  if (!container || container.emptySlotsCount === 0) {
    return { ok: false, error: TEXT.common.inventoryFull };
  }

  try {
    container.addItem(buildBook(war, player.name));
    return { ok: true, value: bookName(war) };
  } catch (err) {
    console.warn(`[sigil] could not print the war record: ${err}`);
    return { ok: false, error: TEXT.book.printFailed };
  }
}
