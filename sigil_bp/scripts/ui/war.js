// @ts-check
/**
 * Wars, end to end: declaring one, answering a declaration, the live war screen
 * and its adjustments, standings, history, and printing a record book.
 */

import { action, showAction as show, modal } from '../forms.js';
import { C } from '../config.js';
import { errorMsg, successMsg, msg, truncate } from '../format.js';
import { TEXT } from '../text.js';
import * as clans from '../clans.js';
import * as staff from '../staff.js';
import * as wars from '../wars.js';
import * as warbook from '../warbook.js';
import * as settings from '../settings.js';
import * as announce from '../announce.js';
import * as players from '../players.js';
import { confirm, pickFrom, run, warsOn } from './shared.js';
import { promotionRequest } from './clan.js';

/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('../clans.js').Clan} Clan */

// ── Wars ──────────────────────────────────────────────────────────────────

/**
 * Renders a war as one line of standings.
 *
 * @param {import('../wars.js').War} war
 * @returns {string}
 */
function warLine(war) {
  return (
    `${C.white}${war.nameA} ${C.yellow}${wars.sideTotal(war, war.clanA)}` +
    `${C.darkGray} - ${C.yellow}${wars.sideTotal(war, war.clanB)} ${C.white}${war.nameB}`
  );
}


/**
 * The war screen. Opened by the War Map block, or by `/clan:war`.
 *
 * What it offers depends on who is looking: a Leader of a full clan can declare
 * and respond, any member can watch the standings, and staff can intervene.
 *
 * @param {Player} player
 */
export function warMenu(player) {
  if (!warsOn(player)) return;
  run(player, async () => {
    const clan = clans.clanOf(player.id);
    if (!clan) {
      player.sendMessage(errorMsg(TEXT.common.notInAClan));
      return;
    }

    const isLeader = clans.isOwner(clan, player.id);
    const outpost = clans.isOutpost(clan);
    const live = wars.warsFor(clan.id);
    const incoming = live.filter((war) => war.state === 'pending' && war.clanB === clan.id);
    const active = live.filter((war) => war.state === 'active');

    const status = outpost
      ? TEXT.menu.isAnOutpostOutpostsCannot2(clan.name)
      : TEXT.menu.warCounts(active.length, incoming.length);

    const form = action()
      .title(TEXT.menu.warMap)
      .body(`${C.gray}${clan.name}\n${status}`);

    /** @type {Array<() => void>} */
    const actions = [];

    if (isLeader && !outpost) {
      form.button(TEXT.menu.declareWar);
      actions.push(() => declareWarPicker(player, clan.id));
    }

    if (isLeader && incoming.length > 0) {
      form.button(TEXT.menu.answerDeclarationsWaiting(incoming.length));
      actions.push(() => declarationInbox(player, clan.id));
    }

    // A declaration nobody has answered can be taken back; the defender can
    // refuse one, and without this the clan that made it could not.
    const outgoing = live.filter((war) => war.state === 'pending' && war.clanA === clan.id);
    if (isLeader && outgoing.length > 0) {
      form.button(TEXT.menu.withdrawDeclarationButton(outgoing.length));
      actions.push(() => withdrawDeclarationPicker(player, clan.id));
    }

    form.button(TEXT.menu.warStandingsAllActiveWars);
    actions.push(() => warStandings(player));

    const fought = wars.historyFor(clan.id).length;
    form.button(
      fought > 0
        ? TEXT.menu.warRecordsButton(fought)
        : TEXT.menu.warRecordsButtonEmpty,
    );
    actions.push(() => warHistoryMenu(player));

    if (live.length > 0 && (isLeader || staff.canManageAnyClan(player))) {
      form.button(TEXT.menu.ourWarsEndAWar);
      actions.push(() => ourWars(player, clan.id));
    }

    if (outpost && isLeader) {
      form.button(TEXT.menu.requestPromotionButton);
      actions.push(() => promotionRequest(player));
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}


/**
 * Chooses a clan to declare war on. Outposts are excluded from the list, since
 * they can neither declare nor be declared upon.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function declareWarPicker(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const candidates = clans
      .allClans()
      .filter(
        (other) =>
          other.id !== clanId &&
          !clans.isOutpost(other) &&
          wars.warBetween(clanId, other.id) === undefined,
      );

    if (candidates.length === 0) {
      player.sendMessage(
        errorMsg(TEXT.menu.noClanToDeclareOn),
      );
      warMenu(player);
      return;
    }

    const form = action()
      .title(TEXT.menu.declareWar)
      .body(
        TEXT.menu.chooseAClanToDeclare(
          settings.get().warRequiresAcceptance
            ? TEXT.menu.theirLeaderMustAccept
            : TEXT.menu.theWarBeginsImmediately,
        ),
      );
    for (const other of candidates) {
      form.button(
        TEXT.menu.memberS2(truncate(other.name, 20), clans.memberCount(other)),
      );
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      warMenu(player);
      return;
    }

    const target = candidates[response.selection];
    if (!target) return;

    const body =
      TEXT.menu.declareWarConfirm(target.name) +
      TEXT.menu.declareWarNote;
    if (!(await confirm(player, TEXT.menu.declareWar, body, 'Declare'))) {
      warMenu(player);
      return;
    }

    const declared = wars.declare(clan, target, player.id);
    if (!declared.ok) {
      player.sendMessage(errorMsg(declared.error));
      warMenu(player);
      return;
    }

    const war = declared.value;
    if (war.state === 'pending') {
      player.sendMessage(successMsg(TEXT.menu.warDeclaredAwaitingAnswer(target.name)));
      players.notify(
        target.ownerId,
        msg(
          TEXT.menu.hasDeclaredWarOnAnswer(clan.name, target.name),
        ),
      );
    } else {
      player.sendMessage(successMsg(TEXT.menu.youAreNowAtWar(target.name)));
      for (const id of Object.keys(target.members)) {
        players.notify(id, msg(TEXT.menu.warDeclaredNotice(clan.name, target.name)));
      }
    }
    announce.warDeclared(clan.name, target.name, war.state === 'pending');
    warMenu(player);
  });
}


/**
 * Declarations awaiting this Leader's answer.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function declarationInbox(player, clanId) {
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const incoming = wars
      .warsFor(clanId)
      .filter((war) => war.state === 'pending' && war.clanB === clanId);
    if (incoming.length === 0) {
      player.sendMessage(msg(TEXT.menu.noDeclarationsWaiting));
      warMenu(player);
      return;
    }

    const form = action()
      .title(TEXT.menu.declarations)
      .body(TEXT.menu.declarationInboxBody(incoming.length, clan.name));
    for (const war of incoming) {
      const from = clans.getClan(war.clanA);
      form.button(TEXT.menu.declaredWar(truncate(from?.name ?? TEXT.fragment.lostClan, 20)));
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      warMenu(player);
      return;
    }

    const war = incoming[response.selection];
    if (war) answerDeclaration(player, war.id);
  });
}


/**
 * @param {Player} player
 * @param {string} warId
 */
function answerDeclaration(player, warId) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war || war.state !== 'pending') {
      player.sendMessage(errorMsg(TEXT.menu.thatDeclarationIsNoLonger));
      warMenu(player);
      return;
    }

    const attacker = clans.getClan(war.clanA);
    const defender = clans.getClan(war.clanB);
    const form = action()
      .title(`${C.red}${truncate(attacker?.name ?? TEXT.fragment.lostClan, 20)}`)
      .body(
        TEXT.menu.hasDeclaredWarOnAccepting(attacker?.name ?? TEXT.menu.aLostClan, defender?.name ?? TEXT.menu.yourClan),
      )
      .button(TEXT.menu.acceptTheWar)
      .button(TEXT.menu.refuse)
      .button(TEXT.menu.decideLater);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined || response.selection === 2) {
      declarationInbox(player, war.clanB);
      return;
    }

    if (response.selection === 0) {
      const accepted = wars.accept(warId);
      if (!accepted.ok) {
        player.sendMessage(errorMsg(accepted.error));
      } else {
        player.sendMessage(successMsg(TEXT.menu.theWarWithHasBegun(attacker?.name ?? 'them')));
        notifyBothClans(accepted.value, TEXT.menu.theWarHasBegun);
        announce.warBegan(attacker?.name ?? 'a clan', defender?.name ?? 'a clan');
      }
      warMenu(player);
      return;
    }

    const declined = wars.decline(warId);
    if (!declined.ok) {
      player.sendMessage(errorMsg(declined.error));
    } else {
      player.sendMessage(msg(TEXT.menu.youRefusedTheDeclaration));
      players.notify(
        war.declaredBy,
        msg(TEXT.menu.declarationRefused(defender?.name ?? 'They')),
      );
    }
    warMenu(player);
  });
}


/**
 * Messages every member of both clans in a war.
 *
 * @param {import('../wars.js').War} war
 * @param {string} text
 */
function notifyBothClans(war, text) {
  for (const clanId of [war.clanA, war.clanB]) {
    const clan = clans.getClan(clanId);
    if (!clan) continue;
    for (const id of Object.keys(clan.members)) players.notify(id, msg(text));
  }
}


/**
 * Read-only standings for every active war in the world.
 *
 * @param {Player} player
 */
export function warStandings(player) {
  if (!warsOn(player)) return;
  run(player, async () => {
    const active = wars.liveWars().filter((war) => war.state === 'active');
    if (active.length === 0) {
      player.sendMessage(msg(TEXT.cmd.noActiveWars));
      return;
    }

    const form = action()
      .title(TEXT.menu.warStandings)
      .body(`${C.gray}${active.map(warLine).join('\n')}`)
      .button(TEXT.menu.close);
    await show(form, player);
  });
}


/**
 * The wars this clan is in, with the actions the viewer is allowed to take.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function ourWars(player, clanId) {
  run(player, async () => {
    const live = wars.warsFor(clanId);
    if (live.length === 0) {
      player.sendMessage(msg(TEXT.menu.notInAnyWar));
      warMenu(player);
      return;
    }

    const form = action().title(TEXT.menu.ourWars).body(TEXT.menu.selectAWar);
    for (const war of live) {
      const state = war.state === 'pending' ? `${C.yellow}${TEXT.fragment.warPending}` : `${C.red}${TEXT.fragment.warActive}`;
      form.button(`${warLine(war)}\n${state}`);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      warMenu(player);
      return;
    }

    const war = live[response.selection];
    if (war) warDetail(player, war.id, clanId);
  });
}


/**
 * @param {Player} player
 * @param {string} warId
 * @param {string} viewingClanId
 */
function warDetail(player, warId, viewingClanId) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war || war.state === 'ended') {
      player.sendMessage(errorMsg(TEXT.menu.thatWarIsOver));
      warMenu(player);
      return;
    }

    // A neutral viewer — staff browsing every live war — passes no clan. They
    // get the staff actions and none of the belligerent ones, because they are
    // not a party to this war.
    const asParty = war.clanA === viewingClanId || war.clanB === viewingClanId;
    const clan = asParty ? clans.getClan(viewingClanId) : undefined;
    const isLeader = clan !== undefined && clans.isOwner(clan, player.id);
    const back = asParty ? () => ourWars(player, viewingClanId) : () => staffWarBrowser(player);

    const theirOffer = asParty && war.peaceOfferedBy === wars.opponentOf(war, viewingClanId);
    const ourOffer = asParty && war.peaceOfferedBy === viewingClanId;
    const standing = theirOffer
      ? TEXT.menu.theyHaveOfferedPeace
      : ourOffer
        ? TEXT.menu.yourPeaceOfferIsAwaiting
        : '';

    const form = action()
      .title(TEXT.menu.war(warbook.ordinal(war.ordinal)))
      .body(TEXT.menu.state(warLine(war), war.state, standing));

    /** @type {Array<() => void>} */
    const actions = [];

    if (wars.canAdjustKills(player)) {
      form.button(TEXT.menu.adjustKillsStaff);
      actions.push(() => adjustKillsForm(player, warId, back));
    }

    // Only a Leader may concede, and only for their own clan.
    if (isLeader && war.state === 'active') {
      form.button(
        theirOffer
          ? TEXT.menu.acceptPeaceButton
          : ourOffer
            ? TEXT.menu.withdrawPeaceOffer
            : TEXT.menu.offerPeaceTheyMustAgree,
      );
      actions.push(() =>
        ourOffer
          ? withdrawPeaceFlow(player, warId, viewingClanId, back)
          : peaceFlow(player, warId, viewingClanId, back),
      );

      form.button(TEXT.menu.surrenderButton);
      actions.push(() => surrenderFlow(player, warId, viewingClanId, back));
    }

    if (wars.canAnnul(player)) {
      form.button(TEXT.menu.annulWarStaffNoWinner);
      actions.push(() => annulFlow(player, warId, back));
    }

    if (actions.length === 0) {
      form.button(TEXT.menu.back);
      actions.push(back);
    }

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back();
      return;
    }
    actions[response.selection]?.();
  });
}


/**
 * Staff correction of a kill total, as a signed delta.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {() => void} back
 */
function adjustKillsForm(player, warId, back) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) return;
    if (!wars.canAdjustKills(player)) {
      player.sendMessage(errorMsg(TEXT.common.notWarAdjuster));
      back();
      return;
    }

    const sides = [war.clanA, war.clanB];
    const names = sides.map((id) => wars.nameOf(war, id));

    // Everyone who could carry the correction: current members of either side,
    // plus anyone already on the record from when they were one.
    /** @type {Array<{ id: string, name: string, side: string }>} */
    const candidates = [];
    for (const clanId of sides) {
      const clan = clans.getClan(clanId);
      if (clan) {
        for (const row of clans.memberList(clan)) {
          candidates.push({ id: row.id, name: row.member.name, side: clanId });
        }
      }
      for (const [id, entry] of Object.entries(war.sides[clanId]?.byPlayer ?? {})) {
        if (!candidates.some((c) => c.id === id)) {
          candidates.push({ id, name: entry.name, side: clanId });
        }
      }
    }

    const targetOptions = [
      TEXT.fragment.pickUnattributed,
      ...candidates.map((c) => `${c.name} ${C.darkGray}(${wars.nameOf(war, c.side)})`),
    ];

    const response = await modal(TEXT.menu.adjustKills)
      .dropdown('clan', TEXT.menu.clan, names, { defaultValueIndex: 0 })
      .slider('delta', TEXT.menu.changeBy, -20, 20, { defaultValue: 0, valueStep: 1 })
      .divider()
      .label(TEXT.menu.adjustKillsNote)
      .dropdown('target', TEXT.menu.creditTo, targetOptions, { defaultValueIndex: 0 })
      .submitButton(TEXT.menu.apply)
      .show(player);

    if (response.canceled) {
      back();
      return;
    }

    const index = response.num('clan');
    const delta = response.num('delta');
    const targetIndex = response.num('target');
    if (delta === 0) {
      back();
      return;
    }

    const target = targetIndex > 0 ? candidates[targetIndex - 1] : undefined;
    const result = wars.adjustKills(
      warId,
      sides[index],
      delta,
      target ? { id: target.id, name: target.name } : undefined,
    );
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else if (target) {
      player.sendMessage(
        successMsg(
          TEXT.cmd.memberKillsAdjusted(target.name, result.value.playerKills ?? 0, names[index], result.value.total),
        ),
      );
    } else {
      player.sendMessage(
        successMsg(TEXT.menu.totalsAsAnAdjustment(names[index], result.value.total)),
      );
    }
    back();
  });
}


/**
 * A clan concedes. There is no staff override; staff close an abandoned war by
 * annulling it, which records no defeat against either side.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {string} clanId the surrendering clan
 * @param {() => void} back
 */
function surrenderFlow(player, warId, clanId, back) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) return;

    const us = wars.nameOf(war, clanId);
    const them = wars.nameOf(war, wars.opponentOf(war, clanId));
    const body =
      `${C.gray}Surrender to ${C.white}${them}${C.gray}?\n\n` +
      `${warLine(war)}\n\n` +
      TEXT.menu.winnerRecorded(them) +
      TEXT.menu.thisIsPermanentAndGoes;

    if (!(await confirm(player, `${C.red}Surrender`, body, 'Surrender'))) {
      back();
      return;
    }

    const result = wars.surrender(warId, clanId, player.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    const ended = result.value;
    player.sendMessage(msg(TEXT.menu.youSurrenderedWon(them)));
    notifyBothClans(ended, TEXT.menu.surrenderedWinsTheWar(us, them));
    announce.warEnded(ended, wars.sideTotal(ended, ended.clanA), wars.sideTotal(ended, ended.clanB));
    warMenu(player);
  });
}


/**
 * Offers peace, or accepts one already standing. Peace ends the war with no
 * winner on either side.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {string} clanId
 * @param {() => void} back
 */
function peaceFlow(player, warId, clanId, back) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) return;

    const them = wars.nameOf(war, wars.opponentOf(war, clanId));
    const theirOffer = war.peaceOfferedBy === wars.opponentOf(war, clanId);
    const body = theirOffer
      ? TEXT.menu.acceptPeaceConfirm(them, warLine(war))
      : TEXT.menu.offerPeaceConfirm(them, warLine(war)) +
        TEXT.menu.theWarEndsOnlyOnce;

    if (
      !(await confirm(
        player,
        `${C.green}${theirOffer ? TEXT.menu.acceptPeace : TEXT.menu.offerPeace}`,
        body,
        theirOffer ? 'Accept' : TEXT.menu.offerPeace,
      ))
    ) {
      back();
      return;
    }

    const result = wars.offerPeace(warId, clanId, player.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    if (!result.value.agreed) {
      player.sendMessage(successMsg(TEXT.menu.peaceOfferedTo(them)));
      players.notify(
        clans.getClan(wars.opponentOf(war, clanId))?.ownerId ?? '',
        msg(TEXT.menu.peaceOfferedNotice(wars.nameOf(war, clanId))),
      );
      back();
      return;
    }

    const ended = result.value.war;
    player.sendMessage(successMsg(TEXT.menu.peaceAgreedConfirm));
    notifyBothClans(ended, TEXT.menu.peaceAgreedNote);
    announce.warEnded(ended, wars.sideTotal(ended, ended.clanA), wars.sideTotal(ended, ended.clanB));
    warMenu(player);
  });
}


/**
 * Closes a war with no winner. The staff escape hatch for a war both clans
 * have walked away from.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {() => void} back
 */
function annulFlow(player, warId, back) {
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) return;
    if (!wars.canAnnul(player)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotAnnulWars));
      back();
      return;
    }

    const body =
      TEXT.menu.annulConfirm(war.nameA) +
      `${C.white}${war.nameB}${C.gray}?\n\n${warLine(war)}\n\n` +
      TEXT.menu.annulNote +
      TEXT.menu.abandonedToRecordADefeat;

    if (!(await confirm(player, TEXT.menu.annulWar, body, 'Annul'))) {
      back();
      return;
    }

    const result = wars.annul(warId, player.id);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
      back();
      return;
    }

    const ended = result.value;
    player.sendMessage(successMsg(TEXT.menu.theWarWasAnnulled));
    notifyBothClans(ended, TEXT.menu.theWarHasBeenAnnulled);
    announce.warEnded(ended, wars.sideTotal(ended, ended.clanA), wars.sideTotal(ended, ended.clanB));
    warMenu(player);
  });
}


/**
 * Withdraws a peace offer this clan had standing.
 *
 * @param {Player} player
 * @param {string} warId
 * @param {string} clanId
 * @param {() => void} back
 */
function withdrawPeaceFlow(player, warId, clanId, back) {
  run(player, async () => {
    const result = wars.withdrawPeace(warId, clanId);
    player.sendMessage(
      result.ok ? msg(TEXT.menu.peaceOfferWithdrawn) : errorMsg(result.error),
    );
    back();
  });
}


/**
 * Withdraws one of this clan's unanswered declarations.
 *
 * @param {Player} player
 * @param {string} clanId
 */
function withdrawDeclarationPicker(player, clanId) {
  run(player, async () => {
    const outgoing = wars
      .warsFor(clanId)
      .filter((war) => war.state === 'pending' && war.clanA === clanId);
    if (outgoing.length === 0) {
      player.sendMessage(msg(TEXT.menu.noUnansweredDeclarations));
      warMenu(player);
      return;
    }

    const form = action()
      .title(TEXT.menu.withdrawDeclaration)
      .body(TEXT.menu.theseClansHaveNotAnswered);
    for (const war of outgoing) form.button(`${C.aqua}${truncate(war.nameB, 22)}`);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      warMenu(player);
      return;
    }

    const war = outgoing[response.selection];
    if (!war) return;

    const result = wars.withdrawDeclaration(war.id, clanId);
    if (!result.ok) {
      player.sendMessage(errorMsg(result.error));
    } else {
      player.sendMessage(msg(TEXT.menu.withdrewDeclaration(war.nameB)));
      players.notify(
        clans.getClan(war.clanB)?.ownerId ?? '',
        msg(TEXT.menu.declarationWithdrawnNotice(war.nameA)),
      );
    }
    warMenu(player);
  });
}


/**
 * Every live war in the world, for staff.
 *
 * Reachable without belonging to a clan, which is the whole point: annulment
 * is the escape hatch for a war both clans have abandoned, and a neutral admin
 * is exactly who should be using it.
 *
 * @param {Player} player
 * @param {() => void} [back]
 */
export function staffWarBrowser(player, back) {
  if (!warsOn(player)) return;
  run(player, async () => {
    if (!wars.canAnnul(player) && !wars.canAdjustKills(player)) {
      player.sendMessage(errorMsg(TEXT.menu.youDoNotHaveWar));
      return;
    }

    const live = wars.liveWars();
    if (live.length === 0) {
      player.sendMessage(msg(TEXT.cmd.noActiveWars));
      back?.();
      return;
    }

    const form = action()
      .title(TEXT.menu.activeWars)
      .body(TEXT.menu.warsInProgress(live.length));
    for (const war of live) {
      const state = war.state === 'pending' ? `${C.yellow}${TEXT.fragment.warPending}` : `${C.red}${TEXT.fragment.warActive}`;
      form.button(`${warLine(war)}\n${state}`);
    }
    if (back) form.button(TEXT.menu.back);

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) {
      back?.();
      return;
    }

    const war = live[response.selection];
    // Viewed as a neutral party: no clan of their own is in play, so the
    // surrender and peace options correctly do not appear.
    if (war) warDetail(player, war.id, '');
    else back?.();
  });
}


/**
 * One war's record, opened from a printed book.
 *
 * @param {Player} player
 * @param {string} warId
 */
export function warRecord(player, warId, page = 0) {
  if (!warsOn(player)) return;
  run(player, async () => {
    const war = wars.getWar(warId);
    if (!war) {
      player.sendMessage(errorMsg(TEXT.menu.thatWarIsNoLonger));
      return;
    }

    // Read a page at a time, as the book is. Joining fifty pages into one form
    // body produced roughly twelve thousand characters in a panel meant for a
    // paragraph — technically shown, practically unreadable.
    const pages = warbook.buildPages(war);
    const index = Math.max(0, Math.min(page, pages.length - 1));

    const form = action()
      .title(`${C.gold}${warbook.bookName(war)}`)
      .body(
        pages.length > 1
          ? TEXT.menu.recordPageFooter(pages[index], index + 1, pages.length)
          : pages[index],
      );

    /** @type {Array<() => void>} */
    const actions = [];
    if (index > 0) {
      form.button(TEXT.menu.pickerPrevious);
      actions.push(() => warRecord(player, warId, index - 1));
    }
    if (index < pages.length - 1) {
      form.button(TEXT.menu.pickerNext);
      actions.push(() => warRecord(player, warId, index + 1));
    }
    form.button(TEXT.menu.close);
    actions.push(() => {});

    const response = await show(form, player);
    if (response.canceled || response.selection === undefined) return;
    actions[response.selection]?.();
  });
}


// ── War history and record books ──────────────────────────────────────────

/**
 * Past wars, and the books that record them.
 *
 * A Leader sees their own clan's history without any staff standing; staff who
 * may print any clan's records get a clan picker first.
 *
 * @param {Player} player
 */
export function warHistoryMenu(player) {
  if (!warsOn(player)) return;
  run(player, async () => {
    const own = clans.clanOf(player.id);
    const mayPrintAny = wars.canGenerateWarBooks(player);

    if (mayPrintAny) {
      const all = clans.allClans();
      if (all.length === 0) {
        player.sendMessage(msg(TEXT.menu.noClansExistYet));
        return;
      }

      // One pass over history for the whole list, rather than one per clan.
      const counts = wars.endedCountsByClan();
      const form = action()
        .title(TEXT.menu.warRecords)
        .body(TEXT.menu.chooseAClanWhoseWar);
      for (const clan of all) {
        const fought = counts.get(clan.id) ?? 0;
        form.button(
          TEXT.menu.clanHistoryButton(truncate(clan.name, 20), fought),
        );
      }

      const response = await show(form, player);
      if (response.canceled || response.selection === undefined) return;
      const chosen = all[response.selection];
      if (chosen) clanWarHistory(player, chosen.id);
      return;
    }

    if (!own) {
      player.sendMessage(errorMsg(TEXT.common.notInAClan));
      return;
    }
    clanWarHistory(player, own.id);
  });
}


/**
 * One clan's finished wars, addressable from a command.
 *
 * @param {Player} player
 * @param {string} clanId
 */
export function clanWarHistoryFor(player, clanId) {
  if (!warsOn(player)) return;
  clanWarHistory(player, clanId);
}


/**
 * One clan's finished wars.
 *
 * @param {Player} player
 * @param {string} clanId
 */
export function clanWarHistory(player, clanId) {
  if (!warsOn(player)) return;
  run(player, async () => {
    const clan = clans.getClan(clanId);
    if (!clan) return;

    const history = wars.historyFor(clanId);
    if (history.length === 0) {
      player.sendMessage(msg(TEXT.cmd.noFinishedWars(clan.name)));
      return;
    }

    const war = await pickFrom(player, {
      title: TEXT.menu.wars2(truncate(clan.name, 18)),
      body: TEXT.menu.clanHistoryBody(history.length),
      items: history,
      describe: (entry) => {
        const them = wars.nameOf(entry, wars.opponentOf(entry, clanId));
        const verdict =
          entry.winner === clanId
            ? `${C.green}${TEXT.fragment.won}`
            : entry.winner
              ? `${C.red}${TEXT.fragment.lost}`
              : `${C.gray}${TEXT.fragment.drawn}`;
        return TEXT.menu.warHistoryRow(
          warbook.ordinal(entry.ordinal),
          truncate(them, 14),
          verdict,
          wars.sideTotal(entry, clanId),
          wars.sideTotal(entry, wars.opponentOf(entry, clanId)),
        );
      },
      match: (entry) => wars.nameOf(entry, wars.opponentOf(entry, clanId)),
    });

    if (war) printWarBook(player, war, clanId);
  });
}


/**
 * Prints the record for one war, after checking the viewer is entitled to it.
 *
 * @param {Player} player
 * @param {import('../wars.js').War} war
 * @param {string} clanId
 */
function printWarBook(player, war, clanId) {
  run(player, async () => {
    const own = clans.clanOf(player.id);
    const isTheirLeader = own !== undefined && own.id === clanId && clans.isOwner(own, player.id);
    if (!isTheirLeader && !wars.canGenerateWarBooks(player)) {
      player.sendMessage(errorMsg(TEXT.menu.youCannotPrintThatClan));
      return;
    }

    const printed = warbook.givePlayerBook(player, war);
    player.sendMessage(
      printed.ok ? successMsg(TEXT.cmd.printed(printed.value)) : errorMsg(printed.error),
    );
    clanWarHistory(player, clanId);
  });
}
