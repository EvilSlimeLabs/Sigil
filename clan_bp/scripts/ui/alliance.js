// @ts-check
/**
 * The alliance screens: what a clan is allied with, the proposals in either
 * direction, and the flows that propose, answer and break one.
 *
 * Reached from the clan menu rather than from the War Map, because an alliance
 * is a standing arrangement between clans rather than something fought. Only
 * the Leader may deal on the clan's behalf, which is the same rule declaring a
 * war follows.
 */

import { action, showAction as show } from '../forms.js';
import { C } from '../config.js';
import { errorMsg, successMsg, msg, truncate } from '../format.js';
import { TEXT } from '../text.js';
import * as clans from '../clans.js';
import * as alliances from '../alliances.js';
import * as settings from '../settings.js';
import * as announce from '../announce.js';
import * as players from '../players.js';
import { confirm, pickFrom, run } from './shared.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../alliances.js').Alliance} Alliance */

/**
 * Whether the alliance system is on, telling the player when it is not.
 *
 * @param {Player} player
 * @returns {boolean}
 */
export function alliancesOn(player) {
  if (settings.alliancesEnabled()) return true;
  player.sendMessage(errorMsg(TEXT.alliance.alliancesAreDisabled));
  return false;
}

/**
 * Tells both clans in an alliance something.
 *
 * @param {Alliance} alliance
 * @param {string} text
 */
function tellBoth(alliance, text) {
  for (const clanId of [alliance.clanA, alliance.clanB]) {
    const clan = clans.getClan(clanId);
    if (!clan) continue;
    for (const id of Object.keys(clan.members)) players.notify(id, msg(text));
  }
}

/**
 * One row in the alliance list: who it is with, and where it stands.
 *
 * @param {Alliance} alliance
 * @param {string} clanId the clan whose screen this is
 * @returns {string}
 */
function allianceRow(alliance, clanId) {
  const them = truncate(alliances.nameOf(alliance, alliances.partnerOf(alliance, clanId)), 20);
  if (alliance.state === 'active') return TEXT.menu.allyRowStanding(them);
  return alliance.clanA === clanId
    ? TEXT.menu.allyRowProposedByUs(them)
    : TEXT.menu.allyRowProposedToUs(them);
}

/**
 * The clan's alliances: everything standing, and every proposal either way.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function allianceMenu(player, back) {
  if (!alliancesOn(player)) return;
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.notInAClanCreate));
      back?.();
      return;
    }

    const home = () => allianceMenu(player, back);
    const isLeader = clans.isOwner(clan, player.id);
    const standing = alliances.alliesOf(clan.id);
    const incoming = alliances.proposalsTo(clan.id);
    const outgoing = alliances.proposalsFrom(clan.id);

    const form = action()
      .title(TEXT.menu.alliances)
      .body(TEXT.menu.allianceBody(standing.length, incoming.length));

    /** @type {Array<() => void>} */
    const actions = [];

    for (const alliance of [...incoming, ...standing, ...outgoing]) {
      form.button(allianceRow(alliance, clan.id));
      actions.push(() => allianceDetail(player, alliance.id, home));
    }

    if (isLeader) {
      form.divider();
      form.button(TEXT.menu.proposeAnAlliance);
      actions.push(() => proposePicker(player, clan.id, home));
    }

    if (back) {
      form.button(TEXT.menu.back);
      actions.push(back);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back?.();
      return;
    }
    actions[response.selection]?.();
  });
}

/**
 * One alliance or proposal, with whatever the viewer may do about it.
 *
 * @param {Player} player
 * @param {string} allianceId
 * @param {() => void} back
 */
function allianceDetail(player, allianceId, back) {
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    const alliance = alliances.getAlliance(allianceId);
    if (!clan || !alliance || alliance.state === 'ended') {
      player.sendMessage(errorMsg(TEXT.alliance.allianceGone));
      back();
      return;
    }

    const them = alliances.nameOf(alliance, alliances.partnerOf(alliance, clan.id));
    const isLeader = clans.isOwner(clan, player.id);
    const theyAsked = alliance.clanB === clan.id;

    const form = action()
      .title(`${C.gold}${truncate(them, 22)}`)
      .body(
        alliance.state === 'active'
          ? TEXT.menu.allianceDetailStanding(them)
          : theyAsked
            ? TEXT.menu.allianceDetailIncoming(them)
            : TEXT.menu.allianceDetailOutgoing(them),
      );

    /** @type {Array<() => void>} */
    const actions = [];

    if (isLeader && alliance.state === 'pending' && theyAsked) {
      form.button(TEXT.menu.accept);
      actions.push(() => answerProposal(player, allianceId, true, back));
      form.button(TEXT.menu.decline);
      actions.push(() => answerProposal(player, allianceId, false, back));
    } else if (isLeader && alliance.state === 'pending') {
      form.button(TEXT.menu.withdrawProposal);
      actions.push(() => withdrawProposalFlow(player, allianceId, back));
    } else if (isLeader && alliance.state === 'active') {
      form.button(TEXT.menu.breakAlliance);
      actions.push(() => breakAllianceFlow(player, allianceId, back));
    }

    form.button(TEXT.menu.back);
    actions.push(back);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back();
      return;
    }
    actions[response.selection]?.();
  });
}

/**
 * Picks a clan to propose an alliance to.
 *
 * Clans already allied, already asked, or at war with this one are left out of
 * the list rather than shown and then refused.
 *
 * @param {Player} player
 * @param {string} clanId
 * @param {() => void} back
 */
function proposePicker(player, clanId, back) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.clanGone));
      back();
      return;
    }
    if (!clans.isOwner(clan, player.id)) {
      player.sendMessage(errorMsg(TEXT.alliance.onlyTheLeaderMayDeal));
      back();
      return;
    }

    // Outposts are left out when the server does not let them deal, rather
    // than listed and then refused at the confirmation.
    const outpostsAllowed = settings.outpostsMayAlly();
    if (!outpostsAllowed && clans.isOutpost(clan)) {
      player.sendMessage(errorMsg(TEXT.alliance.outpostsCannotAlly(clan.name)));
      back();
      return;
    }

    const candidates = clans
      .allClans()
      .filter(
        (other) =>
          other.id !== clanId &&
          !alliances.between(clanId, other.id) &&
          (outpostsAllowed || !clans.isOutpost(other)),
      );
    if (candidates.length === 0) {
      player.sendMessage(msg(TEXT.menu.noClanToAllyWith));
      back();
      return;
    }

    const chosen = await pickFrom(player, {
      back,
      title: TEXT.menu.proposeAnAlliance,
      body: TEXT.menu.proposeAnAllianceBody,
      items: candidates,
      describe: (other) =>
        TEXT.menu.clanRowMembers(truncate(other.name, 20), clans.memberCount(other)),
      match: (other) => other.name,
    });
    if (!chosen) return;

    if (!(await confirm(
      player,
      TEXT.menu.proposeAnAlliance,
      TEXT.menu.proposeConfirm(chosen.name),
      TEXT.menu.propose,
    ))) {
      back();
      return;
    }

    const proposed = alliances.propose(clan, chosen, player.id);
    if (!proposed.ok) {
      player.sendMessage(errorMsg(proposed.error));
      back();
      return;
    }

    player.sendMessage(successMsg(TEXT.menu.allianceProposedTo(chosen.name)));
    for (const id of Object.keys(chosen.members)) {
      players.notify(id, msg(TEXT.menu.allianceProposalReceived(clan.name)));
    }
    back();
  });
}

/**
 * Accepts or declines a proposal made to this clan.
 *
 * @param {Player} player
 * @param {string} allianceId
 * @param {boolean} accepting
 * @param {() => void} back
 */
function answerProposal(player, allianceId, accepting, back) {
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.notInAClanCreate));
      back();
      return;
    }
    if (!clans.isOwner(clan, player.id)) {
      player.sendMessage(errorMsg(TEXT.alliance.onlyTheLeaderMayDeal));
      back();
      return;
    }

    const result = accepting
      ? alliances.accept(allianceId, clan.id)
      : alliances.decline(allianceId, clan.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    const alliance = result.value;
    const them = alliances.nameOf(alliance, alliances.partnerOf(alliance, clan.id));
    if (accepting) {
      tellBoth(alliance, TEXT.menu.allianceAgreedNotice(alliance.nameA, alliance.nameB));
      announce.allianceFormed(alliance.nameA, alliance.nameB);
    } else {
      player.sendMessage(msg(TEXT.menu.allianceDeclinedConfirm(them)));
      const proposer = clans.getClan(alliance.clanA);
      for (const id of Object.keys(proposer?.members ?? {})) {
        players.notify(id, msg(TEXT.menu.allianceDeclinedNotice(clan.name)));
      }
    }
    back();
  });
}

/**
 * Takes back a proposal this clan made.
 *
 * @param {Player} player
 * @param {string} allianceId
 * @param {() => void} back
 */
function withdrawProposalFlow(player, allianceId, back) {
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    if (!clan) {
      back();
      return;
    }

    const result = alliances.withdraw(allianceId, clan.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    const them = alliances.nameOf(result.value, alliances.partnerOf(result.value, clan.id));
    player.sendMessage(msg(TEXT.menu.allianceProposalWithdrawn(them)));
    back();
  });
}

/**
 * Ends a standing alliance. Either side may, without the other agreeing.
 *
 * @param {Player} player
 * @param {string} allianceId
 * @param {() => void} back
 */
function breakAllianceFlow(player, allianceId, back) {
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    const alliance = alliances.getAlliance(allianceId);
    if (!clan || !alliance) {
      player.sendMessage(errorMsg(TEXT.alliance.allianceGone));
      back();
      return;
    }
    if (!clans.isOwner(clan, player.id)) {
      player.sendMessage(errorMsg(TEXT.alliance.onlyTheLeaderMayDeal));
      back();
      return;
    }

    const them = alliances.nameOf(alliance, alliances.partnerOf(alliance, clan.id));
    if (!(await confirm(
      player,
      TEXT.menu.breakAlliance,
      TEXT.menu.breakAllianceConfirm(them),
      TEXT.menu.breakIt,
    ))) {
      back();
      return;
    }

    const result = alliances.breakAlliance(allianceId, clan.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    tellBoth(result.value, TEXT.menu.allianceBrokenNotice(clan.name, them));
    announce.allianceEnded(clan.name, them);
    back();
  });
}
