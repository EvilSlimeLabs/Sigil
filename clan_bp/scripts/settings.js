// @ts-check
/**
 * Add-on settings: admin-editable switches that change how the system behaves
 * for everyone.
 *
 * Stored as one record rather than a property per switch, because settings are
 * small and always read together. Reads merge the stored record over the
 * defaults, so a world configured by an older version of the pack picks up new
 * switches at their default value instead of reading them as `undefined` — the
 * failure mode where a new notification category silently never fires.
 *
 * Editing any of these is admin-only (`canManageSettings`). That includes
 * `staffCanApproveClans`, so a clan-managing staff role can never widen its own
 * powers.
 */

import { KEY, C } from './config.js';
import { getJson, setJson } from './storage.js';


/**
 * How a system role is rendered: its symbol alone, its name alone, or both.
 *
 * @typedef {"symbol" | "name" | "both"} ShowAs
 */

/**
 * Where the Peaceful marker appears.
 *
 * @typedef {"both" | "nametag" | "chat" | "none"} PeacefulVisibility
 */

/**
 * Every bracket style carries its own colour. The brackets and the name inside
 * them are separate marks doing separate jobs — the name identifies, the
 * brackets only punctuate — and tying them to one colour meant an admin could
 * not quieten the punctuation without also draining the name.
 *
 * @typedef {object} NametagSettings
 * @property {boolean} showClanRole  default false, per the requirement
 * @property {string} rolePosition   "before" or "after" the clan name
 * @property {string} clanBrackets   a bracket style id
 * @property {string} clanBracketColor
 * @property {string} roleBrackets   a bracket style id
 * @property {string} roleBracketColor
 * @property {number} systemOrder    where the Admin/staff title sits
 * @property {number} peacefulOrder  where the Peaceful marker sits
 */

/**
 * Chat is assembled around the player's name rather than only in front of it,
 * so `nameOrder` is a real position in the same sequence as the rest: anything
 * ordered below it is drawn before the name, anything above it after.
 *
 * There is deliberately no setting for the brackets around the whole author.
 * Bedrock composes the chat author as prefix + name + suffix and then draws its
 * own angle brackets around the result, so everything written here lands inside
 * them and no property removes them. The only way to control them is to cancel
 * each message and re-broadcast a replacement — the fallback path below, which
 * discards native chat behaviour and takes chat down with it if the handler
 * ever throws. Not worth it for punctuation. The outer brackets are an engine
 * limitation and are left alone.
 *
 * @typedef {object} ChatSettings
 * @property {boolean} showClanRole  default true
 * @property {string} clanBrackets     a bracket style id, around the clan tag
 * @property {string} clanBracketColor
 * @property {number} systemOrder
 * @property {number} clanOrder
 * @property {number} peacefulOrder
 * @property {number} nameOrder      where the player's own name sits
 */

/**
 * @typedef {object} AdminDisplaySettings
 * @property {string} symbol
 * @property {string} name
 * @property {string} color
 * @property {ShowAs} showAs
 */

/**
 * @typedef {object} PeacefulSettings
 * @property {string} symbol
 * @property {string} name
 * @property {string} color
 * @property {ShowAs} showAs
 * @property {PeacefulVisibility} visibility
 */

/**
 * The default colours a clan's identity is drawn in. A clan whose Leader has
 * chosen a colour of its own overrides `clan` for that clan only; these are
 * what every clan that has not chosen still uses.
 *
 * @typedef {object} ColorSettings
 * @property {string} clan
 * @property {string} role
 * @property {string} outpost
 */

/**
 * @typedef {object} DisplaySettings
 * @property {NametagSettings} nametag
 * @property {ChatSettings} chat
 * @property {AdminDisplaySettings} admin
 * @property {PeacefulSettings} peaceful
 * @property {ColorSettings} colors
 */

/**
 * @typedef {object} NotificationSettings
 * @property {boolean} enabled        master switch for all global notifications
 * @property {boolean} clanCreated    a clan was formed (after approval)
 * @property {boolean} memberJoined   a player accepted an invite
 * @property {boolean} memberLeft     a player left or was removed
 * @property {boolean} clanDisbanded  a clan was deleted
 * @property {boolean} clanPromoted   an outpost became a full clan
 * @property {boolean} warDeclared    a war was declared or began
 * @property {boolean} warEnded       a war finished
 */

/**
 * @typedef {object} Settings
 * @property {boolean} requireClanApproval   clan creation goes to review first
 * @property {boolean} staffCanApproveClans  clan-managing staff roles may approve
 * @property {boolean} staffCanApprovePromotions  clan-managing staff may approve promotions
 * @property {number} opPollSeconds          how often operator status is re-checked
 * @property {number} outpostPromotionMembers  members an outpost needs to request promotion
 * @property {boolean} warRequiresAcceptance   a declaration must be accepted to start
 * @property {number} maxActiveWarsPerClan     0 means unlimited
 * @property {boolean} staffCanAdjustWarKills  clan-managing staff may edit kill totals
 * @property {boolean} staffCanGenerateWarBooks clan-managing staff may print any clan's war record
 * @property {boolean} staffCanAssignPeaceful  clan-managing staff may grant Peaceful
 * @property {DisplaySettings} display
 * @property {NotificationSettings} notifications
 */

/**
 * Every switch on, as specified: approval required by default, mods able to
 * approve by default, all notifications on by default.
 *
 * @type {Settings}
 */
const DEFAULTS = {
  requireClanApproval: true,
  staffCanApproveClans: true,
  staffCanApprovePromotions: true,
  opPollSeconds: 20,
  outpostPromotionMembers: 5,
  warRequiresAcceptance: true,
  maxActiveWarsPerClan: 0,
  staffCanAdjustWarKills: true,
  staffCanGenerateWarBooks: true,
  staffCanAssignPeaceful: true,
  display: {
    nametag: {
      // Hidden by default, as specified. The clan alone is the second line
      // until an admin turns the role on.
      showClanRole: false,
      rolePosition: 'before',
      clanBrackets: 'off',
      clanBracketColor: C.darkGray,
      roleBrackets: 'square',
      roleBracketColor: C.darkGray,
      systemOrder: 0,
      peacefulOrder: 10,
    },
    chat: {
      showClanRole: true,
      // The clan tag was hard-coded in square brackets before this; the style
      // and its colour are settings now, on the same footing as the nametag's.
      clanBrackets: 'square',
      clanBracketColor: C.darkGray,
      // The system title sits at the very start of the message; Peaceful comes
      // after every other title but still before the name. The name is last of
      // the four by default, so nothing is drawn after it until an admin moves
      // something past it.
      systemOrder: 0,
      clanOrder: 10,
      peacefulOrder: 20,
      nameOrder: 30,
    },
    admin: { symbol: '✦', name: 'Admin', color: C.red, showAs: 'symbol' },
    peaceful: { symbol: '☮', name: 'Peaceful', color: C.green, showAs: 'symbol', visibility: 'both' },
    // Three colours that read apart from each other at a glance and none of
    // which is the grey the chat window itself uses. The outpost tone is
    // deliberately unlike the clan tone: the tier should be visible without
    // reading the word.
    colors: { clan: C.green, role: C.aqua, outpost: C.purple },
  },
  notifications: {
    enabled: true,
    clanCreated: true,
    memberJoined: true,
    memberLeft: true,
    clanDisbanded: true,
    clanPromoted: true,
    warDeclared: true,
    warEnded: true,
  },
};

/**
 * The merged settings, held between writes.
 *
 * `get()` runs on every nametag refresh, every chat prefix and every poll tick,
 * and each call re-parsed the whole stored record. Every write in the add-on
 * goes through `update()` or `reset()`, so invalidating there is reliable.
 *
 * A pack or command editing `clan:settings` directly would go unseen until the
 * next write; that is an accepted trade for not re-parsing JSON on a hot path.
 *
 * @type {Settings | undefined}
 */
let cached;

/** Drops the cache, so the next read re-merges from storage. */
export function invalidate() {
  cached = undefined;
}

/**
 * The effective settings: stored values layered over the defaults.
 *
 * @returns {Settings}
 */
export function get() {
  if (cached) return cached;
  const stored = getJson(KEY.settings, /** @type {SettingsChanges} */ ({}));
  const display = stored.display ?? {};
  cached = {
    ...DEFAULTS,
    ...stored,
    notifications: { ...DEFAULTS.notifications, ...(stored.notifications ?? {}) },
    // Display settings nest a level deeper than the rest, so each sub-object is
    // merged in turn. A single shallow spread here would drop every default the
    // stored record happens not to mention.
    display: {
      nametag: { ...DEFAULTS.display.nametag, ...(display.nametag ?? {}) },
      chat: { ...DEFAULTS.display.chat, ...(display.chat ?? {}) },
      admin: { ...DEFAULTS.display.admin, ...(display.admin ?? {}) },
      peaceful: { ...DEFAULTS.display.peaceful, ...(display.peaceful ?? {}) },
      colors: { ...DEFAULTS.display.colors, ...(display.colors ?? {}) },
    },
  };
  return cached;
}

/**
 * A change set. Sub-objects are partial too, so a caller can flip one switch
 * without restating the ones beside it.
 *
 * @typedef {Partial<Omit<Settings, 'display' | 'notifications'>> & {
 *   display?: {
 *     nametag?: Partial<NametagSettings>,
 *     chat?: Partial<ChatSettings>,
 *     admin?: Partial<AdminDisplaySettings>,
 *     peaceful?: Partial<PeacefulSettings>,
 *     colors?: Partial<ColorSettings>,
 *   },
 *   notifications?: Partial<NotificationSettings>,
 * }} SettingsChanges
 */

/**
 * Applies a partial update, leaving untouched switches alone.
 *
 * @param {SettingsChanges} changes
 * @returns {Settings} the settings now in effect
 */
export function update(changes) {
  const current = get();
  const incoming = changes.display ?? {};
  /** @type {Settings} */
  const next = {
    ...current,
    ...changes,
    notifications: { ...current.notifications, ...(changes.notifications ?? {}) },
    display: {
      nametag: { ...current.display.nametag, ...(incoming.nametag ?? {}) },
      chat: { ...current.display.chat, ...(incoming.chat ?? {}) },
      admin: { ...current.display.admin, ...(incoming.admin ?? {}) },
      peaceful: { ...current.display.peaceful, ...(incoming.peaceful ?? {}) },
      colors: { ...current.display.colors, ...(incoming.colors ?? {}) },
    },
  };
  setJson(KEY.settings, next);
  cached = next;
  return next;
}

/**
 * Whether a notification category should be sent right now. A category fires
 * only when the master switch and its own switch are both on.
 *
 * @param {keyof Omit<NotificationSettings, 'enabled'>} category
 * @returns {boolean}
 */
export function notifies(category) {
  const { notifications } = get();
  return notifications.enabled && notifications[category];
}

/**
 * The operator-status poll interval in ticks, clamped to a sane range so a
 * malformed stored value cannot schedule a zero-tick interval.
 *
 * @returns {number}
 */
export function opPollIntervalTicks() {
  const seconds = get().opPollSeconds;
  const safe = Number.isFinite(seconds) ? Math.min(Math.max(seconds, 5), 3600) : 20;
  return Math.round(safe * 20);
}

/**
 * The number of members an outpost needs before it may request promotion,
 * clamped so a malformed value cannot make promotion impossible or automatic.
 *
 * @returns {number}
 */
export function promotionThreshold() {
  const value = get().outpostPromotionMembers;
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), 50) : 5;
}

/**
 * How many simultaneous wars one clan may hold, or `undefined` for unlimited.
 * Zero — the default — means unlimited, as specified.
 *
 * @returns {number | undefined}
 */
export function warLimit() {
  const value = get().maxActiveWarsPerClan;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

/**
 * Restores every setting to its default.
 *
 * @returns {Settings}
 */
export function reset() {
  setJson(KEY.settings, DEFAULTS);
  invalidate();
  return get();
}
