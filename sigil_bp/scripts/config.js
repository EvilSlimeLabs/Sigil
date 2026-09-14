// @ts-check
/**
 * Constants shared across the add-on: colour codes, dynamic-property key
 * prefixes, validation bounds and the built-in staff roles.
 *
 * Nothing in here touches the game APIs, so it is safe to import from any
 * module including ones that run during early execution.
 */

/**
 * Minecraft formatting codes, named so call sites read as prose.
 *
 * The first sixteen are the original colours every edition has had. The
 * `material*` entries below them are Bedrock's later additions, named after the
 * ore or block whose colour they take; they are only valid on Bedrock, which is
 * the only place this pack runs.
 */
export const C = {
  black: '§0',
  darkBlue: '§1',
  darkGreen: '§2',
  darkAqua: '§3',
  darkRed: '§4',
  purple: '§5',
  gold: '§6',
  gray: '§7',
  darkGray: '§8',
  blue: '§9',
  green: '§a',
  aqua: '§b',
  red: '§c',
  pink: '§d',
  yellow: '§e',
  white: '§f',
  minecoin: '§g',
  materialQuartz: '§h',
  materialIron: '§i',
  materialNetherite: '§j',
  materialRedstone: '§m',
  materialCopper: '§n',
  materialGold: '§p',
  materialEmerald: '§q',
  materialDiamond: '§s',
  materialLapis: '§t',
  materialAmethyst: '§u',
  materialResin: '§v',
  bold: '§l',
  reset: '§r',
};

/**
 * How a colour is re-drawn when it lands on a form button.
 *
 * Form buttons are a light grey panel. Gray (`§7`) is that same grey, so a
 * subtitle drawn in it disappears entirely, and the bright half of the palette
 * — aqua, green, yellow — sits close enough in value to read as washed out.
 * Every button label is therefore mapped through this table into the dark half,
 * which keeps the meaning a colour carries while putting real contrast under
 * it. Body and chat text is drawn on a dark panel and is left alone.
 *
 * Codes with no entry here are already dark enough and pass through unchanged.
 *
 * @type {Record<string, string>}
 */
export const BUTTON_COLOR = {
  '§7': '§8', // gray        -> dark gray
  '§f': '§0', // white       -> black
  '§b': '§3', // aqua        -> dark aqua
  '§a': '§2', // green       -> dark green
  '§c': '§4', // red         -> dark red
  '§e': '§6', // yellow      -> gold
  '§d': '§5', // pink        -> purple
  '§9': '§1', // blue        -> dark blue
  '§g': '§6', // minecoin    -> gold
  '§h': '§8', // quartz      -> dark gray
  '§i': '§8', // iron        -> dark gray
  '§p': '§6', // gold ore    -> gold
  '§q': '§2', // emerald     -> dark green
  '§s': '§3', // diamond     -> dark aqua
  '§u': '§5', // amethyst    -> purple
  '§v': '§6', // resin       -> gold
};

/** Prefix shown on every message this add-on sends to a player. */
export const MSG_PREFIX = `${C.darkGray}[${C.aqua}Clans${C.darkGray}]${C.reset} `;

/** The role name the clan owner always holds. Reserved; never assignable. */
export const LEADER_ROLE = 'Leader';

/** Dynamic-property keys and key prefixes. See PLAN.md section 4. */
export const KEY = {
  schemaVersion: 'clan:v',
  clanIndex: 'clan:index',
  /** `clan:c:<clanId>` -> JSON clan record */
  clan: 'clan:c:',
  /** `clan:nm:<lowercase name>` -> clanId */
  clanName: 'clan:nm:',
  /** `clan:pm:<playerId>` -> clanId */
  playerClan: 'clan:pm:',
  /** `clan:pn:<playerId>` -> last known player name */
  playerName: 'clan:pn:',
  /** `clan:pi:<lowercase player name>` -> playerId */
  playerId: 'clan:pi:',
  /**
   * `clan:pp:<playerId>` -> last seen `PlayerPermissionLevel`, as a number.
   *
   * Permission level can only be read for a player who is present, so without
   * a record of it a visitor who logs off becomes indistinguishable from anyone
   * else — and reappears in every picker they were meant to be kept out of.
   * Written on join and refreshed by the same poll that watches for op changes,
   * so it is never more than one poll interval stale for anyone online.
   */
  playerPermission: 'clan:pp:',
  /** `clan:inv:<playerId>` -> JSON array of pending invites for that player */
  invites: 'clan:inv:',
  settings: 'clan:settings',
  /** JSON array of pending creation and promotion requests awaiting review */
  requests: 'clan:requests',
  /**
   * JSON array of war ids that are still pending or active, not an index of
   * every war: wars are kept forever, and one property holding every id would
   * reach the ~32KB string ceiling near two thousand wars. Full history is
   * enumerated from `getDynamicPropertyIds()` instead.
   */
  warLive: 'clan:warlive',
  /** `clan:war:<warId>` -> JSON war record; never deleted once the war began */
  war: 'clan:war:',
  /** `clan:warpair:<idA>|<idB>` (sorted) -> warId of the live war between them */
  warPair: 'clan:warpair:',
  /** `clan:warpast:<idA>|<idB>` (sorted) -> JSON array of every war id, oldest first */
  warPast: 'clan:warpast:',
  /** JSON array of alliance ids that are still pending or standing */
  allyLive: 'clan:allylive',
  /** `clan:ally:<allianceId>` -> JSON alliance record; kept once agreed */
  alliance: 'clan:ally:',
  /** `clan:allypair:<idA>|<idB>` (sorted) -> id of the live alliance between them */
  allyPair: 'clan:allypair:',
  /** `clan:allypast:<idA>|<idB>` (sorted) -> JSON array of every alliance id, oldest first */
  allyPast: 'clan:allypast:',
  /** `clan:peace:<playerId>` -> present when the player is marked Peaceful */
  peaceful: 'clan:peace:',
  /**
   * `clan:ledger:<playerId>` -> present once they have been given one.
   *
   * A separate key from the old `clan:compass:`. The item's identifier changed
   * when it stopped being a compass, so every copy already in a world became an
   * unknown item; a fresh key re-issues once to everybody and then behaves as
   * the old one did.
   */
  ledgerIssued: 'clan:ledger:',
  staffRoles: 'clan:staff:roles',
  /** `clan:staff:a:<playerId>` -> staff role id */
  staffAssign: 'clan:staff:a:',
};

/** Current storage schema version. */
export const SCHEMA_VERSION = 1;

/** Validation bounds. */
export const LIMITS = {
  clanNameMin: 3,
  clanNameMax: 16,
  roleNameMin: 1,
  roleNameMax: 16,
  staffSymbolMax: 8,
  /** Guard against a single clan record growing past a sane property size. */
  maxMembersPerClan: 100,
  /** Pending invites a single player may hold; the oldest is dropped past this. */
  maxPendingInvites: 10,
  /** Clan-creation requests the review queue will hold. */
  maxPendingRequests: 200,
  /** Standing alliances one clan may hold, pending proposals aside. */
  maxAlliancesPerClan: 10,
  /**
   * Characters one stored record may hold. A dynamic property string tops out
   * near 32KB; this sits below that so a refusal is a warning rather than an
   * engine error.
   */
  maxRecordBytes: 30000,
  /** Characters a single book page holds, enforced by the engine. */
  bookPageChars: 256,
  /** Pages a single book holds, enforced by the engine. */
  bookMaxPages: 50,
  /**
   * Rendered lines a page holds. The engine caps only characters; the line
   * budget is a rendering concern, so this is the book UI's capacity rather
   * than an API rule.
   */
  bookPageLines: 14,
  /** Characters a book line fits before it wraps onto the next one. */
  bookLineChars: 19,
  /** Characters a signed book title holds, enforced by the engine. */
  bookTitleChars: 16,
};

/** The base item a war record book is built from, before it is signed. */
export const BOOK_ITEM = 'minecraft:writable_book';

/** Dynamic property stamped on a printed book, naming the war it records. */
export const WAR_STAMP = 'clan:war';

/** The item that opens the clan menu, for players who would rather not type. */
export const LEDGER_ITEM = 'clan:clan_ledger';

/** The placeable block that opens the war screen. */
export const WAR_MAP_BLOCK = 'clan:war_map';

/** Scoreboard objective that projects war kill totals into the sidebar. */
export const WAR_OBJECTIVE = 'clan_war';

/**
 * The two tiers a clan can hold. Every clan starts as an outpost and must be
 * promoted; only a full clan may go to war.
 */
export const TIER = {
  outpost: 'outpost',
  clan: 'clan',
};

/** How long a pending clan invite stays valid, in seconds (7 days). */
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * A staff role: the script-managed layer that sits between "ordinary player"
 * and "operator". Never confers admin.
 *
 * Each power is carried by the role rather than by a matching switch in the
 * add-on settings, so a server can have one role that reviews clans and another
 * that only adjusts war kills.
 *
 * The five specific powers are read through {@link StaffRole} accessors in
 * `staff.js`, which fall back to `manageClans` when a stored role predates
 * them — so a world upgrading in keeps exactly the powers it had.
 *
 * @typedef {object} StaffRole
 * @property {string} id            stable lowercase identifier
 * @property {string} name          display name
 * @property {string} symbol        short chat tag body, e.g. `Mod`
 * @property {string} color         a formatting code from {@link C}
 * @property {boolean} manageClans  may act on any clan
 * @property {boolean} [approveClans]      may approve clan creation requests
 * @property {boolean} [approvePromotions] may approve outpost promotions
 * @property {boolean} [adjustWarKills]    may correct a war's kill totals
 * @property {boolean} [generateWarBooks]  may print any clan's war record
 * @property {boolean} [assignPeaceful]    may grant or clear the Peaceful marker
 * @property {number} priority      higher wins when sorting; display only
 * @property {string} [showAs]      `symbol`, `name` or `both`; defaults to `name`
 * @property {string} [brackets]    a bracket style id; defaults to none
 * @property {string} [bracketColor] colour for those brackets
 * @property {boolean} [builtin]    shipped by default; cannot be deleted
 */

/**
 * Roles present the first time the add-on runs. `Mod` carries clan-management
 * access, as specified.
 *
 * @type {StaffRole[]}
 */
export const DEFAULT_STAFF_ROLES = [
  {
    id: 'mod',
    name: 'Mod',
    symbol: '⚔',
    color: C.blue,
    manageClans: true,
    approveClans: true,
    approvePromotions: true,
    adjustWarKills: true,
    generateWarBooks: true,
    assignPeaceful: true,
    priority: 50,
    showAs: 'name',
    builtin: true,
  },
  {
    id: 'helper',
    name: 'Helper',
    symbol: '❖',
    color: C.green,
    manageClans: false,
    approveClans: false,
    approvePromotions: false,
    adjustWarKills: false,
    generateWarBooks: false,
    assignPeaceful: false,
    priority: 10,
    showAs: 'name',
    builtin: true,
  },
];

/**
 * Every symbol a system role, the Admin title or the Peaceful marker can be
 * given, in dropdown order.
 *
 * A curated list rather than free text: a glyph outside the game's font renders
 * as a hollow box, and it does so on other people's screens rather than on the
 * screen of whoever chose it.
 *
 * Grouped by the kind of thing they say — rank, conflict, allegiance, shape.
 *
 * As with the colours, only the id and the glyph are here; the name a player
 * reads is in `TEXT.symbol`, because `config.js` cannot reach the catalogue
 * without closing an import cycle.
 */
export const SYMBOL_CHOICES = [
  { id: 'star', symbol: '★' },
  { id: 'starOutline', symbol: '☆' },
  { id: 'sparkle', symbol: '✦' },
  { id: 'sparkleOutline', symbol: '✧' },
  { id: 'burst', symbol: '✪' },
  { id: 'asterisk', symbol: '✶' },
  { id: 'crown', symbol: '♔' },
  { id: 'swords', symbol: '⚔' },
  { id: 'hammers', symbol: '⚒' },
  { id: 'flag', symbol: '⚑' },
  { id: 'flagOutline', symbol: '⚐' },
  { id: 'skull', symbol: '☠' },
  { id: 'peace', symbol: '☮' },
  { id: 'balance', symbol: '☯' },
  { id: 'node', symbol: '❖' },
  { id: 'cross', symbol: '✚' },
  { id: 'crossOrnate', symbol: '✜' },
  { id: 'dagger', symbol: '†' },
  { id: 'doubleDagger', symbol: '‡' },
  { id: 'diamond', symbol: '◆' },
  { id: 'diamondOutline', symbol: '◇' },
  { id: 'circle', symbol: '●' },
  { id: 'circleOutline', symbol: '○' },
  { id: 'square', symbol: '■' },
  { id: 'squareOutline', symbol: '□' },
  { id: 'triangleUp', symbol: '▲' },
  { id: 'triangleDown', symbol: '▼' },
  { id: 'spade', symbol: '♠' },
  { id: 'club', symbol: '♣' },
  { id: 'heart', symbol: '♥' },
  { id: 'suitDiamond', symbol: '♦' },
];

/**
 * Every colour a name, role or title can be given, in dropdown order.
 *
 * All sixteen original codes, followed by Bedrock's material colours — the
 * ore-and-metal tones, the only palette entries that are not a flat hue. Bright
 * first, dark after, materials last, so the common choices sit at the top of
 * the dropdown.
 *
 * Order is presentation only: a colour is stored as its code, so inserting an
 * entry here never re-points a colour anyone already chose.
 *
 * Only the id is here, not the label a player reads: `config.js` is imported by
 * every module including the ones that run first, and reaching for the text
 * catalogue from it would close an import cycle. The names live in
 * `TEXT.color`, keyed by these ids.
 */
export const ROLE_COLOR_CHOICES = [
  { id: 'white', code: C.white },
  { id: 'gray', code: C.gray },
  { id: 'darkGray', code: C.darkGray },
  { id: 'black', code: C.black },
  { id: 'blue', code: C.blue },
  { id: 'aqua', code: C.aqua },
  { id: 'green', code: C.green },
  { id: 'yellow', code: C.yellow },
  { id: 'gold', code: C.gold },
  { id: 'red', code: C.red },
  { id: 'pink', code: C.pink },
  { id: 'purple', code: C.purple },
  { id: 'darkBlue', code: C.darkBlue },
  { id: 'darkAqua', code: C.darkAqua },
  { id: 'darkGreen', code: C.darkGreen },
  { id: 'darkRed', code: C.darkRed },
  { id: 'minecoin', code: C.minecoin },
  { id: 'quartz', code: C.materialQuartz },
  { id: 'iron', code: C.materialIron },
  { id: 'netherite', code: C.materialNetherite },
  { id: 'redstone', code: C.materialRedstone },
  { id: 'copper', code: C.materialCopper },
  { id: 'goldOre', code: C.materialGold },
  { id: 'emerald', code: C.materialEmerald },
  { id: 'diamond', code: C.materialDiamond },
  { id: 'lapis', code: C.materialLapis },
  { id: 'amethyst', code: C.materialAmethyst },
  { id: 'resin', code: C.materialResin },
];
