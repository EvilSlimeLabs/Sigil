// @ts-check
/**
 * Constants shared across the add-on: colour codes, dynamic-property key
 * prefixes, validation bounds and the built-in staff roles.
 *
 * Nothing in here touches the game APIs, so it is safe to import from any
 * module including ones that run during early execution.
 */

/** Minecraft formatting codes, named so call sites read as prose. */
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
  bold: '§l',
  reset: '§r',
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
  /** `clan:inv:<playerId>` -> JSON array of pending invites for that player */
  invites: 'clan:inv:',
  settings: 'clan:settings',
  /** JSON array of pending creation and promotion requests awaiting review */
  requests: 'clan:requests',
  /**
   * JSON array of war ids that are still pending or active. Deliberately not
   * an index of *every* war: wars are kept forever, and one property holding
   * every id would hit the ~32KB string ceiling somewhere near two thousand
   * wars. Full history is enumerated from `getDynamicPropertyIds()` instead.
   */
  warLive: 'clan:warlive',
  /** `clan:war:<warId>` -> JSON war record; never deleted once the war began */
  war: 'clan:war:',
  /** `clan:warpair:<idA>|<idB>` (sorted) -> warId of the live war between them */
  warPair: 'clan:warpair:',
  /** `clan:warpast:<idA>|<idB>` (sorted) -> JSON array of every war id, oldest first */
  warPast: 'clan:warpast:',
  /** `clan:peace:<playerId>` -> present when the player is marked Peaceful */
  peaceful: 'clan:peace:',
  /** `clan:compass:<playerId>` -> present once they have been given one */
  compassIssued: 'clan:compass:',
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
export const COMPASS_ITEM = 'clan:clan_compass';

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
 * @typedef {object} StaffRole
 * @property {string} id            stable lowercase identifier
 * @property {string} name          display name
 * @property {string} symbol        short chat tag body, e.g. `Mod`
 * @property {string} color         a formatting code from {@link C}
 * @property {boolean} manageClans  may act on any clan
 * @property {number} priority      higher wins when sorting; display only
 * @property {string} [showAs]      `symbol`, `name` or `both`; defaults to `name`
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
    priority: 10,
    showAs: 'name',
    builtin: true,
  },
];

/** Colours offered when creating or editing a staff role, in dropdown order. */
export const ROLE_COLOR_CHOICES = [
  { label: 'Blue', code: C.blue },
  { label: 'Aqua', code: C.aqua },
  { label: 'Green', code: C.green },
  { label: 'Yellow', code: C.yellow },
  { label: 'Gold', code: C.gold },
  { label: 'Red', code: C.red },
  { label: 'Pink', code: C.pink },
  { label: 'Purple', code: C.purple },
  { label: 'Gray', code: C.gray },
  { label: 'White', code: C.white },
];
