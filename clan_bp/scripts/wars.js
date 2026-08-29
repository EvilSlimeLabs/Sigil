// @ts-check
/**
 * Wars between clans: declaration, how they end, kill attribution, and the
 * scoreboard that projects the standings.
 *
 * Four rules shape the design:
 *
 *  1. **A pair of clans may hold only one live war.** Enforced through a pair
 *     index (`clan:warpair:<a>|<b>`, ids sorted) rather than by scanning, so
 *     the check is a single property read however many wars are running.
 *
 *  2. **Only credited player-versus-player kills count.** The dead player must
 *     be in one warring clan and the credited killer in the other. Mob kills,
 *     fall damage, friendly fire and any death with no credited player are
 *     ignored. The kill is booked against the side the killer was on *at that
 *     moment*, so changing clans later does not move their kills.
 *
 *  3. **Wars are never deleted.** Ending sets `state`, `outcome` and `endedAt`
 *     and nothing else. A pair that fights again gets a new record with the
 *     next ordinal, and every earlier war stays readable forever.
 *
 *  4. **There is no global index of every war.** Because history is kept
 *     forever, one property holding every id would have hit the ~32KB string
 *     ceiling near two thousand wars — a cap that arrives silently and is
 *     painful to undo. Live wars sit in a small array; full history is
 *     enumerated from `getDynamicPropertyIds()`, which has no such ceiling.
 */

import { world, DisplaySlotId } from '@minecraft/server';
import { KEY, WAR_OBJECTIVE } from './config.js';
import {
  getString,
  setString,
  remove,
  getJson,
  setJson,
  setJsonGuarded,
  now,
  idsWithPrefix,
} from './storage.js';
import * as clans from './clans.js';
import * as settings from './settings.js';
import * as staff from './staff.js';
import * as announce from './announce.js';
import { onClanDisbanded } from './hooks.js';
import { TEXT } from './text.js';

/** @typedef {'pending' | 'active' | 'ended'} WarState */

/**
 * How a war finished. Empty until it has.
 *
 * @typedef {'' | 'surrender' | 'peace' | 'annulled' | 'forfeit'} WarOutcome
 */

/**
 * One clan's tally in one war.
 *
 * `adjust` is kept apart from `byPlayer` because a staff correction may or may
 * not belong to a particular member: crediting someone the kill they earned is
 * a different statement from adding a kill nobody can be named for, and the
 * record book should not present the second as the first.
 *
 * @typedef {object} WarSide
 * @property {number} adjust
 * @property {Record<string, { name: string, kills: number }>} byPlayer
 */

/**
 * @typedef {object} War
 * @property {string} id
 * @property {number} ordinal      the nth war ever fought between this pair
 * @property {string} clanA        the declaring clan
 * @property {string} clanB        the defending clan
 * @property {string} nameA        clan names cached at declaration, so a record
 * @property {string} nameB        still reads after a rename or a disband
 * @property {WarState} state
 * @property {string} declaredBy
 * @property {number} declaredAt
 * @property {number} startedAt    0 until accepted
 * @property {number} endedAt      0 until ended
 * @property {WarOutcome} outcome
 * @property {string} winner       clan id, or '' for peace and annulment
 * @property {string} loser        clan id, or ''
 * @property {string} endedBy      player id who surrendered, agreed or annulled
 * @property {string} peaceOfferedBy clan id with a standing peace offer, or ''
 * @property {Record<string, WarSide>} sides keyed by clan id
 */

/**
 * @template T
 * @typedef {import('./format.js').Result<T>} Result
 */

/**
 * The pair key for two clans, order-independent.
 *
 * @param {string} clanIdA
 * @param {string} clanIdB
 * @returns {string}
 */
function pairId(clanIdA, clanIdB) {
  return [clanIdA, clanIdB].sort().join('|');
}

/** @returns {string[]} */
function liveIds() {
  return getJson(KEY.warLive, /** @type {string[]} */ ([]));
}

/**
 * @param {string[]} ids
 */
function saveLive(ids) {
  if (ids.length === 0) remove(KEY.warLive);
  else setJson(KEY.warLive, ids);
}

/**
 * Fills in anything a stored record is missing.
 *
 * Wars written before per-member tallies existed carry a flat `kills` map;
 * those totals are read as unattributed adjustments, which is exactly what
 * they are — real counts with no member behind them.
 *
 * @param {any} raw
 * @returns {War | undefined}
 */
function normalise(raw) {
  if (!raw || typeof raw.id !== 'string') return undefined;

  if (!raw.sides) {
    /** @type {Record<string, WarSide>} */
    const sides = {};
    for (const clanId of [raw.clanA, raw.clanB]) {
      sides[clanId] = { adjust: raw.kills?.[clanId] ?? 0, byPlayer: {} };
    }
    raw.sides = sides;
  }
  for (const clanId of [raw.clanA, raw.clanB]) {
    const side = raw.sides[clanId] ?? (raw.sides[clanId] = { adjust: 0, byPlayer: {} });
    if (typeof side.adjust !== 'number') side.adjust = 0;
    if (!side.byPlayer) side.byPlayer = {};
  }

  if (typeof raw.ordinal !== 'number') raw.ordinal = 1;
  if (typeof raw.outcome !== 'string') raw.outcome = '';
  if (typeof raw.winner !== 'string') raw.winner = '';
  if (typeof raw.loser !== 'string') raw.loser = '';
  if (typeof raw.endedBy !== 'string') raw.endedBy = '';
  if (typeof raw.peaceOfferedBy !== 'string') raw.peaceOfferedBy = '';
  if (typeof raw.nameA !== 'string') raw.nameA = clans.getClan(raw.clanA)?.name ?? TEXT.fragment.lostClan;
  if (typeof raw.nameB !== 'string') raw.nameB = clans.getClan(raw.clanB)?.name ?? TEXT.fragment.lostClan;

  return /** @type {War} */ (raw);
}

/**
 * @param {string} warId
 * @returns {War | undefined}
 */
export function getWar(warId) {
  return normalise(getJson(KEY.war + warId, null));
}

/**
 * @param {War} war
 */
function saveWar(war) {
  setJsonGuarded(KEY.war + war.id, war);
}

/**
 * Every war ever fought, newest first.
 *
 * Enumerated from the property store rather than an index array, so history
 * has no size ceiling. Walked only when someone browses; never on a hot path.
 *
 * @returns {War[]}
 */
export function allWars() {
  const wars = idsWithPrefix(KEY.war)
    .map((key) => getWar(key.slice(KEY.war.length)))
    .filter(/** @returns {w is War} */ (w) => w !== undefined);
  wars.sort((a, b) => b.declaredAt - a.declaredAt);
  return wars;
}

/**
 * Wars that have not ended. Reads the small live array rather than scanning.
 *
 * @returns {War[]}
 */
export function liveWars() {
  return liveIds()
    .map(getWar)
    .filter(/** @returns {w is War} */ (w) => w !== undefined && w.state !== 'ended');
}

/**
 * @param {string} clanId
 * @returns {War[]}
 */
export function warsFor(clanId) {
  return liveWars().filter((war) => war.clanA === clanId || war.clanB === clanId);
}

/**
 * Every ended war a clan fought, most recent first.
 *
 * @param {string} clanId
 * @returns {War[]}
 */
export function historyFor(clanId) {
  return allWars()
    .filter((war) => war.state === 'ended' && (war.clanA === clanId || war.clanB === clanId))
    .sort((a, b) => b.endedAt - a.endedAt);
}

/**
 * How many finished wars each clan has fought, in a single pass.
 *
 * Calling `historyFor` once per clan meant enumerating and parsing every war
 * record once per clan — a menu listing fifty clans against five hundred wars
 * ran twenty-five thousand parses to render one screen.
 *
 * @returns {Map<string, number>}
 */
export function endedCountsByClan() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const war of allWars()) {
    if (war.state !== 'ended') continue;
    counts.set(war.clanA, (counts.get(war.clanA) ?? 0) + 1);
    counts.set(war.clanB, (counts.get(war.clanB) ?? 0) + 1);
  }
  return counts;
}

/**
 * Every war between two clans, oldest first, the live one included.
 *
 * @param {string} clanIdA
 * @param {string} clanIdB
 * @returns {War[]}
 */
export function warsBetween(clanIdA, clanIdB) {
  return getJson(KEY.warPast + pairId(clanIdA, clanIdB), /** @type {string[]} */ ([]))
    .map(getWar)
    .filter(/** @returns {w is War} */ (w) => w !== undefined);
}

/**
 * The live war between two clans, if there is one.
 *
 * @param {string} clanIdA
 * @param {string} clanIdB
 * @returns {War | undefined}
 */
export function warBetween(clanIdA, clanIdB) {
  const key = KEY.warPair + pairId(clanIdA, clanIdB);
  const warId = getString(key);
  if (warId === undefined) return undefined;

  const war = getWar(warId);
  if (!war || war.state === 'ended') {
    // The index outlived the war. Heal it so the pair can fight again.
    remove(key);
    return undefined;
  }
  return war;
}

/**
 * @param {War} war
 * @param {string} clanId
 * @returns {string}
 */
export function opponentOf(war, clanId) {
  return war.clanA === clanId ? war.clanB : war.clanA;
}

/**
 * The name a war record holds for a clan, which outlives the clan itself.
 *
 * @param {War} war
 * @param {string} clanId
 * @returns {string}
 */
export function nameOf(war, clanId) {
  return war.clanA === clanId ? war.nameA : war.nameB;
}

/**
 * A side's total: every member's kills plus the unattributed adjustment,
 * floored at zero so a correction can never show a negative score.
 *
 * @param {War} war
 * @param {string} clanId
 * @returns {number}
 */
export function sideTotal(war, clanId) {
  const side = war.sides[clanId];
  if (!side) return 0;
  let sum = side.adjust;
  for (const entry of Object.values(side.byPlayer)) sum += entry.kills;
  return Math.max(0, sum);
}

/**
 * Whether a player may correct war kill tallies.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function canAdjustKills(player) {
  if (staff.isAdmin(player)) return true;
  return staff.hasPower(player, 'adjustWarKills');
}

/**
 * Whether a player may print the record for *any* clan's war. A Leader needs
 * none of this to print a war their own clan fought.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function canGenerateWarBooks(player) {
  if (staff.isAdmin(player)) return true;
  return staff.hasPower(player, 'generateWarBooks');
}

/**
 * Whether a player may annul a war — closing it with no winner.
 *
 * @param {import('@minecraft/server').Player} player
 * @returns {boolean}
 */
export function canAnnul(player) {
  return staff.canManageAnyClan(player);
}

/**
 * Declares war. The declaring player must lead a full clan, and the target
 * must be a full clan too — outposts neither declare nor are declared upon.
 *
 * @param {import('./clans.js').Clan} declaring
 * @param {import('./clans.js').Clan} target
 * @param {string} declaredBy player id of the declaring Leader
 * @returns {Result<War>}
 */
export function declare(declaring, target, declaredBy) {
  if (declaring.id === target.id) {
    return { ok: false, error: TEXT.war.aClanCannotGoTo };
  }
  if (clans.isOutpost(declaring)) {
    return { ok: false, error: TEXT.war.isAnOutpostOutpostsCannot(declaring.name) };
  }
  if (clans.isOutpost(target)) {
    return { ok: false, error: TEXT.war.isAnOutpostAndCannot(target.name) };
  }
  if (warBetween(declaring.id, target.id)) {
    return { ok: false, error: TEXT.war.isAlreadyAtWarWith(declaring.name, target.name) };
  }

  const limit = settings.warLimit();
  if (limit !== undefined) {
    if (warsFor(declaring.id).length >= limit) {
      return { ok: false, error: TEXT.war.alreadyHoldsTheMaximumOf(declaring.name, limit) };
    }
    if (warsFor(target.id).length >= limit) {
      return { ok: false, error: TEXT.war.alreadyHoldsTheMaximumOf(target.name, limit) };
    }
  }

  const requiresAcceptance = settings.get().warRequiresAcceptance;
  const timestamp = now();
  const pastKey = KEY.warPast + pairId(declaring.id, target.id);
  const past = getJson(pastKey, /** @type {string[]} */ ([]));

  /** @type {War} */
  const war = {
    id: `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ordinal: past.length + 1,
    clanA: declaring.id,
    clanB: target.id,
    nameA: declaring.name,
    nameB: target.name,
    state: requiresAcceptance ? 'pending' : 'active',
    declaredBy,
    declaredAt: timestamp,
    startedAt: requiresAcceptance ? 0 : timestamp,
    endedAt: 0,
    outcome: '',
    winner: '',
    loser: '',
    endedBy: '',
    peaceOfferedBy: '',
    sides: {
      [declaring.id]: { adjust: 0, byPlayer: {} },
      [target.id]: { adjust: 0, byPlayer: {} },
    },
  };

  saveWar(war);
  saveLive([...liveIds(), war.id]);
  setString(KEY.warPair + pairId(declaring.id, target.id), war.id);
  setJson(pastKey, [...past, war.id]);

  if (war.state === 'active') syncScoreboard();
  return { ok: true, value: war };
}

/**
 * Accepts a pending declaration, starting the war.
 *
 * @param {string} warId
 * @returns {Result<War>}
 */
export function accept(warId) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatWarNoLongerExists };
  if (war.state !== 'pending') {
    return { ok: false, error: TEXT.war.thatDeclarationIsNoLonger };
  }

  war.state = 'active';
  war.startedAt = now();
  saveWar(war);
  syncScoreboard();
  return { ok: true, value: war };
}

/**
 * Refuses a pending declaration. A refused declaration never became a war, so
 * it leaves no record and frees the ordinal it had reserved.
 *
 * @param {string} warId
 * @returns {Result<War>}
 */
export function decline(warId) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatWarNoLongerExists };
  if (war.state !== 'pending') {
    return { ok: false, error: TEXT.war.thatDeclarationIsNoLonger };
  }

  const pair = pairId(war.clanA, war.clanB);
  const pastKey = KEY.warPast + pair;
  const past = getJson(pastKey, /** @type {string[]} */ ([])).filter((id) => id !== war.id);
  if (past.length === 0) remove(pastKey);
  else setJson(pastKey, past);

  remove(KEY.warPair + pair);
  saveLive(liveIds().filter((id) => id !== war.id));
  remove(KEY.war + war.id);
  return { ok: true, value: war };
}

/**
 * Withdraws a declaration the declaring clan has not yet had answered.
 *
 * Without this a declaration nobody answers is stuck forever: the defender can
 * refuse it, but the clan that made it had no way back, and `surrender` only
 * applies to a war that actually started.
 *
 * Like a refusal, this leaves no record and frees the ordinal.
 *
 * @param {string} warId
 * @param {string} clanId the declaring clan
 * @returns {Result<War>}
 */
export function withdrawDeclaration(warId, clanId) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatDeclarationNoLongerExists };
  if (war.state !== 'pending') {
    return { ok: false, error: TEXT.war.thatWarHasAlreadyBegun };
  }
  if (war.clanA !== clanId) {
    return { ok: false, error: TEXT.war.onlyTheClanThatDeclared };
  }
  return decline(warId);
}

/**
 * Closes a war and records how it ended. The record itself is kept forever;
 * only the live indexes are released.
 *
 * @param {War} war
 * @param {WarOutcome} outcome
 * @param {string} winner
 * @param {string} loser
 * @param {string} endedBy
 * @returns {War}
 */
function finish(war, outcome, winner, loser, endedBy) {
  war.state = 'ended';
  war.outcome = outcome;
  war.winner = winner;
  war.loser = loser;
  war.endedBy = endedBy;
  war.endedAt = now();
  war.peaceOfferedBy = '';
  saveWar(war);

  remove(KEY.warPair + pairId(war.clanA, war.clanB));
  saveLive(liveIds().filter((id) => id !== war.id));
  syncScoreboard();
  return war;
}

/**
 * A clan concedes. The other clan wins.
 *
 * This is the ordinary way out, and it has no staff override: a forced
 * surrender would record a defeat the clan never chose. Staff who need a war
 * gone annul it instead, which records no winner.
 *
 * @param {string} warId
 * @param {string} clanId the clan giving up
 * @param {string} playerId the Leader surrendering
 * @returns {Result<War>}
 */
export function surrender(warId, clanId, playerId) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatWarNoLongerExists };
  if (war.state !== 'active') {
    return { ok: false, error: TEXT.war.thatWarHasNotBegun };
  }
  if (war.clanA !== clanId && war.clanB !== clanId) {
    return { ok: false, error: TEXT.war.thatClanIsNotIn };
  }

  return { ok: true, value: finish(war, 'surrender', opponentOf(war, clanId), clanId, playerId) };
}

/**
 * Offers peace, or accepts one already standing from the other side. Peace
 * ends the war as a draw, with no winner.
 *
 * @param {string} warId
 * @param {string} clanId the clan offering or accepting
 * @param {string} playerId the Leader acting
 * @returns {Result<{ war: War, agreed: boolean }>}
 */
export function offerPeace(warId, clanId, playerId) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatWarNoLongerExists };
  if (war.state !== 'active') return { ok: false, error: TEXT.war.thatWarIsNotBeing };
  if (war.clanA !== clanId && war.clanB !== clanId) {
    return { ok: false, error: TEXT.war.thatClanIsNotIn };
  }
  if (war.peaceOfferedBy === clanId) {
    return { ok: false, error: TEXT.war.youHaveAlreadyOfferedPeace };
  }

  if (war.peaceOfferedBy === opponentOf(war, clanId)) {
    return { ok: true, value: { war: finish(war, 'peace', '', '', playerId), agreed: true } };
  }

  war.peaceOfferedBy = clanId;
  saveWar(war);
  return { ok: true, value: { war, agreed: false } };
}

/**
 * Withdraws a standing peace offer.
 *
 * @param {string} warId
 * @param {string} clanId
 * @returns {Result<War>}
 */
export function withdrawPeace(warId, clanId) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatWarNoLongerExists };
  if (war.peaceOfferedBy !== clanId) {
    return { ok: false, error: TEXT.war.youHaveNoPeaceOffer };
  }
  war.peaceOfferedBy = '';
  saveWar(war);
  return { ok: true, value: war };
}

/**
 * Closes a war with no winner. The staff escape hatch for a war both clans
 * have abandoned, and the reason surrender needs no override.
 *
 * @param {string} warId
 * @param {string} playerId
 * @returns {Result<War>}
 */
export function annul(warId, playerId) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatWarNoLongerExists };
  if (war.state === 'ended') return { ok: false, error: TEXT.war.thatWarHasAlreadyEnded };
  return { ok: true, value: finish(war, 'annulled', '', '', playerId) };
}

/**
 * A clan stops existing mid-war and forfeits it.
 *
 * @param {string} warId
 * @param {string} losingClanId
 * @returns {Result<War>}
 */
export function forfeit(warId, losingClanId) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatWarNoLongerExists };
  if (war.state === 'ended') return { ok: false, error: TEXT.war.thatWarHasAlreadyEnded };

  const survivor = opponentOf(war, losingClanId);
  // With the other clan gone too, there is nobody to award it to.
  if (!clans.getClan(survivor)) {
    return { ok: true, value: finish(war, 'annulled', '', '', '') };
  }
  return { ok: true, value: finish(war, 'forfeit', survivor, losingClanId, '') };
}

/**
 * Forfeits every live war a clan is in. Called when the clan is disbanded,
 * since a war needs two clans.
 *
 * @param {string} clanId
 * @returns {War[]}
 */
export function forfeitAllFor(clanId) {
  /** @type {War[]} */
  const ended = [];
  for (const war of warsFor(clanId)) {
    // A declaration nobody answered was never a war. Discarding it matches
    // what a refusal or a withdrawal does — recording a forfeit would name a
    // winner of something that never happened.
    if (war.state === 'pending') {
      decline(war.id);
      continue;
    }

    const result = forfeit(war.id, clanId);
    if (!result.ok) continue;
    ended.push(result.value);
    // Announced here rather than by the caller: a forfeit can be triggered from
    // a disband, a purge or the hook, and a war that vanishes off the scoreboard
    // with no word to either clan is the worst of those outcomes.
    announce.warEnded(
      result.value,
      sideTotal(result.value, result.value.clanA),
      sideTotal(result.value, result.value.clanB),
    );
  }
  return ended;
}

/**
 * Records a kill if — and only if — it is a credited kill between two clans at
 * war with each other.
 *
 * @param {{ id: string, name: string }} killer
 * @param {{ id: string, name: string }} victim
 * @returns {{ war: War, scoringClanId: string, playerKills: number } | undefined}
 */
export function recordKill(killer, victim) {
  if (killer.id === victim.id) return undefined;

  const killerClan = clans.clanOf(killer.id);
  const victimClan = clans.clanOf(victim.id);
  if (!killerClan || !victimClan) return undefined;
  if (killerClan.id === victimClan.id) return undefined; // friendly fire

  const war = warBetween(killerClan.id, victimClan.id);
  if (!war || war.state !== 'active') return undefined;

  const side = war.sides[killerClan.id];
  const entry =
    side.byPlayer[killer.id] ?? (side.byPlayer[killer.id] = { name: killer.name, kills: 0 });
  entry.name = killer.name; // keep the cached name current while they are here
  entry.kills += 1;
  saveWar(war);
  syncScoreboard();

  return { war, scoringClanId: killerClan.id, playerKills: entry.kills };
}

/**
 * Corrects a side's tally.
 *
 * Naming a player puts the correction on that member's own line, which is
 * right when a kill was genuinely missed or misattributed. Leaving the player
 * out puts it in the side's unattributed bucket, which is right when the total
 * is wrong but nobody can say whose kill it was. The record book renders the
 * two differently, so the distinction survives to the reader.
 *
 * @param {string} warId
 * @param {string} clanId
 * @param {number} delta
 * @param {{ id: string, name: string }} [target] the member to credit or debit
 * @returns {Result<{ total: number, playerKills?: number }>}
 */
export function adjustKills(warId, clanId, delta, target) {
  const war = getWar(warId);
  if (!war) return { ok: false, error: TEXT.war.thatWarNoLongerExists };
  if (war.clanA !== clanId && war.clanB !== clanId) {
    return { ok: false, error: TEXT.war.thatClanIsNotIn };
  }
  if (!Number.isFinite(delta) || Math.round(delta) === 0) {
    return { ok: false, error: TEXT.war.enterANonZeroWhole };
  }

  const side = war.sides[clanId];
  const step = Math.round(delta);

  if (!target) {
    side.adjust += step;
    saveWar(war);
    syncScoreboard();
    return { ok: true, value: { total: sideTotal(war, clanId) } };
  }

  // A correction may only land on someone who fought for this side: either a
  // current member, or someone already on the record from when they were one.
  const onThisSide =
    clans.clanOf(target.id)?.id === clanId || side.byPlayer[target.id] !== undefined;
  if (!onThisSide) {
    return {
      ok: false,
      error: TEXT.war.didNotFightForIn(target.name, nameOf(war, clanId)),
    };
  }

  const entry =
    side.byPlayer[target.id] ?? (side.byPlayer[target.id] = { name: target.name, kills: 0 });
  entry.name = target.name;
  entry.kills = Math.max(0, entry.kills + step);
  saveWar(war);
  syncScoreboard();
  return { ok: true, value: { total: sideTotal(war, clanId), playerKills: entry.kills } };
}

/**
 * Rebuilds the sidebar objective from the war records.
 *
 * One objective rather than one per war, because the sidebar shows a single
 * objective at a time and several wars can run at once. When no war is active
 * the objective is removed, so the sidebar disappears rather than lingering
 * empty.
 */
export function syncScoreboard() {
  const active = liveWars().filter((war) => war.state === 'active');

  try {
    if (active.length === 0) {
      if (world.scoreboard.getObjective(WAR_OBJECTIVE)) {
        world.scoreboard.removeObjective(WAR_OBJECTIVE);
      }
      return;
    }

    let objective = world.scoreboard.getObjective(WAR_OBJECTIVE);
    if (!objective) {
      objective = world.scoreboard.addObjective(WAR_OBJECTIVE, TEXT.board.warKills);
    }
    world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective });

    /** @type {Map<string, number>} */
    const totals = new Map();
    for (const war of active) {
      for (const clanId of [war.clanA, war.clanB]) {
        totals.set(clanId, (totals.get(clanId) ?? 0) + sideTotal(war, clanId));
      }
    }

    const live = new Set();
    for (const [clanId, kills] of totals) {
      const clan = clans.getClan(clanId);
      if (!clan) continue;
      live.add(clan.name);
      objective.setScore(clan.name, kills);
    }
    // Drop participants no longer in any active war, so a finished war's clan
    // does not linger on the board.
    for (const participant of objective.getParticipants()) {
      if (!live.has(participant.displayName)) objective.removeParticipant(participant);
    }
  } catch (err) {
    console.warn(`[sigil] could not update the war scoreboard: ${err}`);
  }
}

// A clan that no longer exists forfeits whatever it was fighting.
onClanDisbanded((clanId) => {
  forfeitAllFor(clanId);
});
