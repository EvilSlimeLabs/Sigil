/**
 * A minimal stand-in for `@minecraft/server`, enough to run the add-on's
 * domain and display logic outside Minecraft.
 *
 * It implements only what the modules under test actually call: a dynamic
 * property store, a player roster, and a scheduler that runs work immediately.
 * It is deliberately not a general-purpose emulator — anything it does not
 * implement should fail loudly rather than silently pass.
 */

const props = new Map();

export const PlayerPermissionLevel = { Visitor: 0, Member: 1, Operator: 2, Custom: 3 };
export const DisplaySlotId = { BelowName: 'BelowName', List: 'List', Sidebar: 'Sidebar' };
export const CommandPermissionLevel = { Any: 0, GameDirectors: 1, Admin: 2, Owner: 3 };
export const CustomCommandParamType = { String: 'String', PlayerSelector: 'PlayerSelector' };
export const CustomCommandStatus = { Success: 0, Failure: 1 };


/**
 * A book component real enough to assert against: it enforces the same three
 * limits the engine does, so a test catches an over-long page or title here
 * rather than in the game.
 */
class MockBook {
  constructor() {
    this.contents = [];
    this.title = undefined;
    this.author = undefined;
    this.isSigned = false;
  }
  get pageCount() {
    return this.contents.length;
  }
  setContents(pages) {
    if (this.isSigned) throw new Error('BookError: signed books are read-only');
    if (pages.length > 50) throw new Error('BookError: ExceedsMaxPages');
    for (const page of pages) {
      if (String(page).length > 256) throw new Error('BookError: ExceedsMaxPageLength');
    }
    this.contents = pages.map(String);
  }
  getPageContent(i) {
    return this.contents[i];
  }
  signBook(title, author) {
    if (title.length > 16) throw new Error('BookError: ExceedsTitleLength');
    this.title = title;
    this.author = author;
    this.isSigned = true;
  }
}

export class ItemStack {
  /**
   * @param {string} typeId
   * @param {number} [amount]
   */
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
    this.nameTag = undefined;
    this.lore = [];
    this.dynamic = new Map();
    // Only book items carry the book component, mirroring the real API.
    this.book = typeId.includes('book') ? new MockBook() : undefined;
  }
  getComponent(id) {
    if (id === 'minecraft:book') return this.book;
    return undefined;
  }
  hasComponent(id) {
    return this.getComponent(id) !== undefined;
  }
  setLore(list) {
    this.lore = (list ?? []).map(String);
  }
  getLore() {
    return [...this.lore];
  }
  setDynamicProperty(key, value) {
    if (value === undefined) this.dynamic.delete(key);
    else this.dynamic.set(key, value);
  }
  getDynamicProperty(key) {
    return this.dynamic.get(key);
  }
}

/** A container just capable enough for the give-an-item paths. */
class MockContainer {
  constructor(size = 36) {
    this.size = size;
    this.items = [];
  }
  get emptySlotsCount() {
    return this.size - this.items.length;
  }
  addItem(stack) {
    if (this.emptySlotsCount <= 0) throw new Error('container full');
    this.items.push(stack);
    return stack;
  }
  getItem(slot) {
    return this.items[slot];
  }
}

export class Player {
  /**
   * @param {string} id
   * @param {string} name
   * @param {boolean} [op]
   */
  constructor(id, name, op = false) {
    this.id = id;
    this.name = name;
    this.playerPermissionLevel = op ? PlayerPermissionLevel.Operator : PlayerPermissionLevel.Member;
    this.nameTag = name;
    // Present-but-undefined, mirroring a game build that supports the beta
    // chat property. Delete it to simulate a build that does not.
    this.chatNamePrefix = undefined;
    this.messages = [];
    this.container = new MockContainer();
  }

  getComponent(id) {
    if (id === 'minecraft:inventory') return { container: this.container };
    return undefined;
  }

  sendMessage(message) {
    this.messages.push(message);
  }
}

const onlinePlayers = [];

/** Replaces the online roster. @param {Player[]} list */
export function __setPlayers(list) {
  onlinePlayers.length = 0;
  onlinePlayers.push(...list);
}

/** Snapshot of the dynamic property store, for assertions. */
export function __dumpProps() {
  return new Map(props);
}

/** Clears all state between test files. */
export function __reset() {
  props.clear();
  onlinePlayers.length = 0;
}

/** Every message broadcast to the world, so notification gating can be asserted. */
const broadcasts = [];

/** @returns {string[]} */
export function __broadcasts() {
  return [...broadcasts];
}

export function __clearBroadcasts() {
  broadcasts.length = 0;
}

/**
 * A scoreboard just real enough to assert the projection: objectives hold
 * participant scores, and the sidebar remembers what was assigned to it.
 */
class MockObjective {
  constructor(id, displayName) {
    this.id = id;
    this.displayName = displayName;
    this.isValid = true;
    this.scores = new Map();
  }
  setScore(participant, score) {
    this.scores.set(String(participant), score);
  }
  getScore(participant) {
    return this.scores.get(String(participant));
  }
  addScore(participant, amount) {
    const next = (this.scores.get(String(participant)) ?? 0) + amount;
    this.scores.set(String(participant), next);
    return next;
  }
  hasParticipant(participant) {
    return this.scores.has(String(participant));
  }
  getParticipants() {
    return [...this.scores.keys()].map((name) => ({ displayName: name }));
  }
  removeParticipant(participant) {
    const name = typeof participant === 'string' ? participant : participant.displayName;
    return this.scores.delete(name);
  }
  getScores() {
    return [...this.scores.entries()].map(([name, score]) => ({
      participant: { displayName: name },
      score,
    }));
  }
}

const objectives = new Map();
let sidebarObjective;

/** The objective currently shown in the sidebar, for assertions. */
export function __sidebar() {
  return sidebarObjective;
}

const scoreboard = {
  addObjective: (id, displayName) => {
    const objective = new MockObjective(id, displayName ?? id);
    objectives.set(id, objective);
    return objective;
  },
  getObjective: (id) => objectives.get(id),
  getObjectives: () => [...objectives.values()],
  removeObjective: (id) => {
    const key = typeof id === 'string' ? id : id.id;
    if (sidebarObjective?.id === key) sidebarObjective = undefined;
    return objectives.delete(key);
  },
  setObjectiveAtDisplaySlot: (slot, options) => {
    if (slot === DisplaySlotId.Sidebar) sidebarObjective = options.objective;
    return options.objective;
  },
  getObjectiveAtDisplaySlot: (slot) =>
    slot === DisplaySlotId.Sidebar && sidebarObjective ? { objective: sidebarObjective } : undefined,
  clearObjectiveAtDisplaySlot: () => {
    const previous = sidebarObjective;
    sidebarObjective = undefined;
    return previous;
  },
  getParticipants: () => [],
};

export const world = {
  scoreboard,
  getDynamicProperty: (key) => props.get(key),
  setDynamicProperty: (key, value) => {
    if (value === undefined) props.delete(key);
    else props.set(key, value);
  },
  getDynamicPropertyIds: () => [...props.keys()],
  getAllPlayers: () => [...onlinePlayers],
  sendMessage: (message) => broadcasts.push(String(message)),
  // No `chatSend` here, so the display adapter's tier-2 probe correctly finds
  // no event fallback.
  beforeEvents: {},
  afterEvents: {},
};

let nextRunId = 1;

export const system = {
  run: (fn) => fn(),
  runTimeout: (fn) => fn(),
  // Returns a distinct id each time so the display module's cancel-and-
  // re-register logic can be observed.
  runInterval: () => nextRunId++,
  clearRun: () => {},
  beforeEvents: { startup: { subscribe: () => {} } },
};
