// @ts-check
/**
 * Clan alliances: a standing agreement between two clans, proposed by one and
 * accepted by the other.
 *
 * The shape follows `wars.js`, because the relationship is the same one pointed
 * the other way: two clans, a state, a consent step, and a history that outlives
 * the agreement. A proposal waits until the other clan answers; an accepted
 * alliance stands until either side breaks it or one of the clans is disbanded.
 *
 * An alliance carries one mechanical effect: allied clans cannot declare war on
 * each other. `wars.js` learns that through the declaration veto in `hooks.js`
 * rather than by importing this module, because the check in the other
 * direction — refusing a proposal between clans that are already fighting —
 * reads `wars.js` from here.
 *
 * Storage mirrors the war records. Live alliance ids sit in one array; every
 * alliance record is kept forever under its own key, and the pair keys index
 * both the standing agreement and the full history between two clans.
 */

import { KEY, LIMITS } from './config.js';
import { getJson, setJson, remove, getString, setString, now } from './storage.js';
import * as clans from './clans.js';
import * as wars from './wars.js';
import * as settings from './settings.js';
import { onClanDisbanded, onSettingsChanged, onWarDeclarationVeto } from './hooks.js';
import { TEXT } from './text.js';

/** @typedef {'pending' | 'active' | 'ended'} AllianceState */

/**
 * How an alliance finished.
 *
 * @typedef {'' | 'declined' | 'withdrawn' | 'broken' | 'disbanded' | 'disabled'} AllianceOutcome
 */

/**
 * @typedef {object} Alliance
 * @property {string} id
 * @property {string} clanA          the clan that proposed
 * @property {string} clanB          the clan that was asked
 * @property {string} nameA          names are stored so a record survives a rename
 * @property {string} nameB
 * @property {AllianceState} state
 * @property {AllianceOutcome} outcome
 * @property {string} proposedBy     player id
 * @property {number} proposedAt     unix seconds
 * @property {number} [agreedAt]
 * @property {number} [endedAt]
 * @property {string} [endedByClan]  which side broke it, for `broken`
 */

/**
 * @template T
 * @typedef {import('./format.js').Result<T>} Result
 */

/**
 * The pair key for two clans, ordered so either argument order finds it.
 *
 * @param {string} clanIdA
 * @param {string} clanIdB
 * @returns {string}
 */
function pairId(clanIdA, clanIdB) {
  return [clanIdA, clanIdB].sort().join('|');
}

/**
 * @returns {string[]}
 */
function liveIds() {
  return getJson(KEY.allyLive, /** @type {string[]} */ ([]));
}

/**
 * @param {string[]} ids
 */
function saveLiveIds(ids) {
  if (ids.length === 0) remove(KEY.allyLive);
  else setJson(KEY.allyLive, ids);
}

/**
 * @param {Alliance} alliance
 */
function save(alliance) {
  setJson(KEY.alliance + alliance.id, alliance);
}

/**
 * @param {string} allianceId
 * @returns {Alliance | undefined}
 */
export function getAlliance(allianceId) {
  return getJson(KEY.alliance + allianceId, /** @type {Alliance | undefined} */ (undefined));
}

/**
 * Every alliance still pending or standing.
 *
 * @returns {Alliance[]}
 */
export function liveAlliances() {
  return liveIds()
    .map(getAlliance)
    .filter(/** @returns {a is Alliance} */ (a) => a !== undefined);
}

/**
 * Every pending proposal and standing alliance one clan is part of.
 *
 * @param {string} clanId
 * @returns {Alliance[]}
 */
export function alliancesFor(clanId) {
  return liveAlliances().filter((a) => a.clanA === clanId || a.clanB === clanId);
}

/**
 * The clans this one currently stands allied with.
 *
 * @param {string} clanId
 * @returns {Alliance[]}
 */
export function alliesOf(clanId) {
  return alliancesFor(clanId).filter((a) => a.state === 'active');
}

/**
 * Proposals waiting on this clan to answer.
 *
 * @param {string} clanId
 * @returns {Alliance[]}
 */
export function proposalsTo(clanId) {
  return alliancesFor(clanId).filter((a) => a.state === 'pending' && a.clanB === clanId);
}

/**
 * Proposals this clan has made and not yet had answered.
 *
 * @param {string} clanId
 * @returns {Alliance[]}
 */
export function proposalsFrom(clanId) {
  return alliancesFor(clanId).filter((a) => a.state === 'pending' && a.clanA === clanId);
}

/**
 * The live alliance or proposal between two clans, if there is one.
 *
 * @param {string} clanIdA
 * @param {string} clanIdB
 * @returns {Alliance | undefined}
 */
export function between(clanIdA, clanIdB) {
  const id = getString(KEY.allyPair + pairId(clanIdA, clanIdB));
  return id === undefined ? undefined : getAlliance(id);
}

/**
 * Whether two clans stand allied right now.
 *
 * @param {string} clanIdA
 * @param {string} clanIdB
 * @returns {boolean}
 */
export function allied(clanIdA, clanIdB) {
  return between(clanIdA, clanIdB)?.state === 'active';
}

/**
 * Every alliance the two clans have ever had, oldest first.
 *
 * @param {string} clanIdA
 * @param {string} clanIdB
 * @returns {Alliance[]}
 */
export function historyBetween(clanIdA, clanIdB) {
  return getJson(KEY.allyPast + pairId(clanIdA, clanIdB), /** @type {string[]} */ ([]))
    .map(getAlliance)
    .filter(/** @returns {a is Alliance} */ (a) => a !== undefined);
}

/**
 * The other clan in an alliance.
 *
 * @param {Alliance} alliance
 * @param {string} clanId
 * @returns {string}
 */
export function partnerOf(alliance, clanId) {
  return alliance.clanA === clanId ? alliance.clanB : alliance.clanA;
}

/**
 * The stored name of one side.
 *
 * @param {Alliance} alliance
 * @param {string} clanId
 * @returns {string}
 */
export function nameOf(alliance, clanId) {
  return alliance.clanA === clanId ? alliance.nameA : alliance.nameB;
}

/**
 * Proposes an alliance between two clans.
 *
 * Both clans are named rather than passed as ids so the record can keep their
 * names, which is what lets a finished alliance still read correctly after a
 * rename or a disband.
 *
 * @param {import('./clans.js').Clan} proposing
 * @param {import('./clans.js').Clan} target
 * @param {string} proposedBy player id
 * @returns {Result<Alliance>}
 */
export function propose(proposing, target, proposedBy) {
  if (!settings.alliancesEnabled()) {
    return { ok: false, error: TEXT.alliance.alliancesAreDisabled };
  }
  if (proposing.id === target.id) {
    return { ok: false, error: TEXT.alliance.cannotAllyWithSelf };
  }

  if (!settings.outpostsMayAlly()) {
    const outpost = [proposing, target].find((clan) => clans.isOutpost(clan));
    if (outpost) {
      return { ok: false, error: TEXT.alliance.outpostsCannotAlly(outpost.name) };
    }
  }

  const existing = between(proposing.id, target.id);
  if (existing?.state === 'active') {
    return { ok: false, error: TEXT.alliance.alreadyAllied(proposing.name, target.name) };
  }
  if (existing?.state === 'pending') {
    return { ok: false, error: TEXT.alliance.proposalAlreadyStanding(proposing.name, target.name) };
  }

  // A clan cannot ally with one it is fighting. The war has to be settled
  // first, which is the same order the fiction implies.
  if (wars.warBetween(proposing.id, target.id)) {
    return { ok: false, error: TEXT.alliance.atWarWith(target.name) };
  }

  const limit = LIMITS.maxAlliancesPerClan;
  if (alliesOf(proposing.id).length >= limit) {
    return { ok: false, error: TEXT.alliance.allianceLimitReached(proposing.name, limit) };
  }
  if (alliesOf(target.id).length >= limit) {
    return { ok: false, error: TEXT.alliance.allianceLimitReached(target.name, limit) };
  }

  /** @type {Alliance} */
  const alliance = {
    id: `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    clanA: proposing.id,
    clanB: target.id,
    nameA: proposing.name,
    nameB: target.name,
    state: 'pending',
    outcome: '',
    proposedBy,
    proposedAt: now(),
  };

  save(alliance);
  saveLiveIds([...liveIds(), alliance.id]);
  setString(KEY.allyPair + pairId(proposing.id, target.id), alliance.id);
  return { ok: true, value: alliance };
}

/**
 * Accepts a standing proposal.
 *
 * @param {string} allianceId
 * @param {string} clanId must be the clan that was asked
 * @returns {Result<Alliance>}
 */
export function accept(allianceId, clanId) {
  if (!settings.alliancesEnabled()) {
    return { ok: false, error: TEXT.alliance.alliancesAreDisabled };
  }
  const alliance = getAlliance(allianceId);
  if (!alliance) return { ok: false, error: TEXT.alliance.proposalGone };
  if (alliance.state !== 'pending') {
    return { ok: false, error: TEXT.alliance.proposalAlreadyAnswered };
  }
  if (alliance.clanB !== clanId) {
    return { ok: false, error: TEXT.alliance.onlyTheAskedClanMayAnswer };
  }

  alliance.state = 'active';
  alliance.agreedAt = now();
  save(alliance);
  return { ok: true, value: alliance };
}

/**
 * Closes a live alliance or proposal and files it in the pair's history.
 *
 * @param {Alliance} alliance
 * @param {AllianceOutcome} outcome
 * @param {string} [endedByClan]
 * @returns {Alliance}
 */
function close(alliance, outcome, endedByClan) {
  alliance.state = 'ended';
  alliance.outcome = outcome;
  alliance.endedAt = now();
  if (endedByClan) alliance.endedByClan = endedByClan;
  save(alliance);

  saveLiveIds(liveIds().filter((id) => id !== alliance.id));
  remove(KEY.allyPair + pairId(alliance.clanA, alliance.clanB));

  const pastKey = KEY.allyPast + pairId(alliance.clanA, alliance.clanB);
  const past = getJson(pastKey, /** @type {string[]} */ ([]));
  if (!past.includes(alliance.id)) setJson(pastKey, [...past, alliance.id]);

  return alliance;
}

/**
 * Refuses a standing proposal.
 *
 * @param {string} allianceId
 * @param {string} clanId must be the clan that was asked
 * @returns {Result<Alliance>}
 */
export function decline(allianceId, clanId) {
  const alliance = getAlliance(allianceId);
  if (!alliance) return { ok: false, error: TEXT.alliance.proposalGone };
  if (alliance.state !== 'pending') {
    return { ok: false, error: TEXT.alliance.proposalAlreadyAnswered };
  }
  if (alliance.clanB !== clanId) {
    return { ok: false, error: TEXT.alliance.onlyTheAskedClanMayAnswer };
  }
  return { ok: true, value: close(alliance, 'declined') };
}

/**
 * Takes back a proposal that has not been answered.
 *
 * @param {string} allianceId
 * @param {string} clanId must be the clan that proposed
 * @returns {Result<Alliance>}
 */
export function withdraw(allianceId, clanId) {
  const alliance = getAlliance(allianceId);
  if (!alliance) return { ok: false, error: TEXT.alliance.proposalGone };
  if (alliance.state !== 'pending') {
    return { ok: false, error: TEXT.alliance.proposalAlreadyAnswered };
  }
  if (alliance.clanA !== clanId) {
    return { ok: false, error: TEXT.alliance.onlyTheProposingClanMayWithdraw };
  }
  return { ok: true, value: close(alliance, 'withdrawn') };
}

/**
 * Ends a standing alliance. Either side may, without the other's consent.
 *
 * @param {string} allianceId
 * @param {string} clanId
 * @returns {Result<Alliance>}
 */
export function breakAlliance(allianceId, clanId) {
  const alliance = getAlliance(allianceId);
  if (!alliance) return { ok: false, error: TEXT.alliance.allianceGone };
  if (alliance.state !== 'active') {
    return { ok: false, error: TEXT.alliance.notAStandingAlliance };
  }
  if (alliance.clanA !== clanId && alliance.clanB !== clanId) {
    return { ok: false, error: TEXT.alliance.clanNotInAlliance };
  }
  return { ok: true, value: close(alliance, 'broken', clanId) };
}

/**
 * Ends every live alliance and proposal a clan holds. Used when it disbands.
 *
 * @param {string} clanId
 * @returns {Alliance[]}
 */
export function endAllFor(clanId) {
  return alliancesFor(clanId).map((alliance) => close(alliance, 'disbanded', clanId));
}

/**
 * Ends every live alliance and proposal there is. Used when the alliance system
 * is switched off, so a world with alliances turned off has none standing rather
 * than a set nobody can see or act on.
 *
 * @returns {Alliance[]}
 */
export function dissolveAllLive() {
  return liveAlliances().map((alliance) => close(alliance, 'disabled'));
}

// Turning the alliance system off leaves nothing standing, the same way turning
// wars off annuls what was being fought. Idempotent, so the check costs nothing
// on the settings writes that have no bearing on alliances.
onSettingsChanged(() => {
  if (settings.alliancesEnabled()) return;
  const ended = dissolveAllLive();
  if (ended.length > 0) {
    console.log(`[sigil] alliances disabled: ${ended.length} dissolved`);
  }
});

// An alliance must not outlive either clan in it.
onClanDisbanded((clanId) => {
  endAllFor(clanId);
});

// Allied clans cannot declare war on each other; the alliance has to be broken
// first. Registered rather than imported by `wars.js`, which does not know this
// module exists.
onWarDeclarationVeto((clanIdA, clanIdB) =>
  allied(clanIdA, clanIdB) ? TEXT.alliance.cannotDeclareOnAnAlly : undefined,
);
