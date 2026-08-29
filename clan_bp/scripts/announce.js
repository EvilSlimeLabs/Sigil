// @ts-check
/**
 * Global chat notifications.
 *
 * Every announcement funnels through here so the settings check happens in
 * exactly one place. Callers state what happened; whether anyone hears about it
 * is this module's decision, not theirs. That is what keeps a new call site
 * from accidentally bypassing the master switch.
 */

import { world } from '@minecraft/server';
import { C } from './config.js';
import { msg } from './format.js';
import * as settings from './settings.js';
import { TEXT } from './text.js';

/**
 * Sends a world-wide message if the given category is enabled.
 *
 * @param {keyof Omit<import('./settings.js').NotificationSettings, 'enabled'>} category
 * @param {string} text
 */
function broadcast(category, text) {
  if (!settings.notifies(category)) return;
  world.sendMessage(msg(text));
}

/**
 * A clan came into existence — after approval, when approval is required.
 *
 * @param {string} clanName
 * @param {string} leaderName
 */
export function clanCreated(clanName, leaderName) {
  broadcast(
    'clanCreated',
    TEXT.announce.hasBeenFoundedBy(clanName, leaderName),
  );
}

/**
 * A player accepted an invite and joined.
 *
 * @param {string} clanName
 * @param {string} playerName
 */
export function memberJoined(clanName, playerName) {
  broadcast(
    'memberJoined',
    `${C.white}${playerName}${C.green} joined ${C.aqua}${clanName}${C.green}.`,
  );
}

/**
 * A player left of their own accord, or was removed.
 *
 * @param {string} clanName
 * @param {string} playerName
 * @param {boolean} removed true when someone else removed them
 */
export function memberLeft(clanName, playerName, removed) {
  broadcast(
    'memberLeft',
    removed
      ? TEXT.announce.wasRemovedFrom(playerName, clanName)
      : `${C.white}${playerName}${C.gray} left ${C.aqua}${clanName}${C.gray}.`,
  );
}

/**
 * A clan was deleted.
 *
 * @param {string} clanName
 */
export function clanDisbanded(clanName) {
  broadcast('clanDisbanded', TEXT.announce.hasBeenDisbanded(clanName));
}

/**
 * An outpost became a full clan.
 *
 * @param {string} clanName
 */
export function clanPromoted(clanName) {
  broadcast(
    'clanPromoted',
    TEXT.announce.hasBeenPromotedFromAn(clanName),
  );
}

/**
 * Two clans agreed an alliance.
 *
 * @param {string} clanNameA
 * @param {string} clanNameB
 */
export function allianceFormed(clanNameA, clanNameB) {
  broadcast('allianceChanged', TEXT.announce.allianceFormed(clanNameA, clanNameB));
}

/**
 * One clan broke an alliance.
 *
 * @param {string} breakingName
 * @param {string} otherName
 */
export function allianceEnded(breakingName, otherName) {
  broadcast('allianceChanged', TEXT.announce.allianceEnded(breakingName, otherName));
}

/**
 * War was declared. Announced whether or not it needs accepting, but worded to
 * say which it is — a pending declaration is not yet a war.
 *
 * @param {string} declaringName
 * @param {string} targetName
 * @param {boolean} pending
 */
export function warDeclared(declaringName, targetName, pending) {
  broadcast(
    'warDeclared',
    pending
      ? TEXT.announce.hasDeclaredWarOnAwaiting(declaringName, targetName)
      : TEXT.announce.isNowAtWarWith(declaringName, targetName),
  );
}

/**
 * A pending declaration was accepted and the war has begun.
 *
 * @param {string} clanNameA
 * @param {string} clanNameB
 */
export function warBegan(clanNameA, clanNameB) {
  broadcast('warDeclared', TEXT.announce.warHasBrokenOutBetween(clanNameA, clanNameB));
}

/**
 * A war finished. The wording follows the outcome, because "won by surrender"
 * and "annulled with no winner" are different events and a single generic line
 * would flatten them into the same announcement.
 *
 * @param {import('./wars.js').War} war
 * @param {number} killsA
 * @param {number} killsB
 */
export function warEnded(war, killsA, killsB) {
  const score =
    `${C.white}${war.nameA} ${killsA}${C.gray} - ${C.white}${killsB} ${war.nameB}`;
  const winner = war.winner === war.clanA ? war.nameA : war.winner === war.clanB ? war.nameB : '';
  const loser = war.loser === war.clanA ? war.nameA : war.loser === war.clanB ? war.nameB : '';

  let headline;
  switch (war.outcome) {
    case 'surrender':
      headline = TEXT.announce.hasSurrenderedTo(loser, winner);
      break;
    case 'forfeit':
      headline = TEXT.announce.forfeitedItsWarWith(loser, winner);
      break;
    case 'peace':
      headline = TEXT.announce.andHaveMadePeace(war.nameA, war.nameB);
      break;
    case 'annulled':
      headline = TEXT.announce.theWarBetweenAndWas(war.nameA, war.nameB);
      break;
    default:
      headline = TEXT.announce.theWarBetweenAndIs(war.nameA, war.nameB);
  }

  broadcast('warEnded', `${headline} ${score}`);
}
