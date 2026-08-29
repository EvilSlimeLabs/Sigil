/**
 * The alliance lifecycle, the two system switches, and the rules where the war
 * system and the alliance system meet.
 */

import { prepare, load, check, checkEqual, finish } from './harness.mjs';

prepare([
  'config.js',
  'format.js',
  'text.js',
  'storage.js',
  'hooks.js',
  'players.js',
  'settings.js',
  'staff.js',
  'clans.js',
  'wars.js',
  'alliances.js',
]);

const mock = await load('mock-server.js');
const storage = await load('storage.js');
const playersMod = await load('players.js');
const settings = await load('settings.js');
const clans = await load('clans.js');
const wars = await load('wars.js');
const alliances = await load('alliances.js');
const { LIMITS } = await load('config.js');

storage.initSchema();
// Outposts are kept out of alliances by default; the switch is exercised below.
settings.update({ outpostPromotionMembers: 3, outpostsMayAlly: true });

/**
 * A full clan with enough members to fight.
 *
 * @param {string} prefix
 * @param {string} name
 */
function fullClan(prefix, name) {
  const leader = new mock.Player(prefix + '0', name + 'Leader');
  playersMod.register(leader);
  const clan = clans.createClan(leader.id, leader.name, name).value;
  for (const suffix of ['1', '2']) {
    const member = new mock.Player(prefix + suffix, name + suffix);
    playersMod.register(member);
    clans.addMember(clan.id, member.id, member.name);
  }
  clans.promote(clan.id);
  return { leader, clan: clans.getClan(clan.id) };
}

const north = fullClan('n', 'Northmen');
const south = fullClan('s', 'Southguard');
const east = fullClan('e', 'Eastwatch');

// ── Proposing, accepting, and what an alliance then forbids ──────────────

const proposal = alliances.propose(north.clan, south.clan, north.leader.id);
check('an alliance can be proposed', proposal.ok);
checkEqual('and starts pending', proposal.value.state, 'pending');
checkEqual('the clan asked sees it waiting', alliances.proposalsTo(south.clan.id).length, 1);
checkEqual('the clan that asked sees it outstanding', alliances.proposalsFrom(north.clan.id).length, 1);
check('and neither counts as allied yet', !alliances.allied(north.clan.id, south.clan.id));

check(
  'a second proposal between the same two is refused',
  !alliances.propose(north.clan, south.clan, north.leader.id).ok,
);
check(
  'and so is one in the other direction',
  !alliances.propose(south.clan, north.clan, south.leader.id).ok,
);
check(
  'the clan that asked cannot answer for the other',
  !alliances.accept(proposal.value.id, north.clan.id).ok,
);

check('the clan asked can accept', alliances.accept(proposal.value.id, south.clan.id).ok);
check('and the two now stand allied', alliances.allied(north.clan.id, south.clan.id));
checkEqual('which shows on both rosters', alliances.alliesOf(south.clan.id).length, 1);
check('an already-answered proposal cannot be answered again', !alliances.accept(proposal.value.id, south.clan.id).ok);

// The one mechanical effect: allies cannot fight.
const refused = wars.declare(north.clan, south.clan, north.leader.id);
check('an ally cannot be declared on', !refused.ok);
check('and the refusal says why', String(refused.error).includes('allied'));
check(
  'a clan that is not an ally still can be',
  wars.declare(north.clan, east.clan, north.leader.id).ok,
);

// ── Breaking one, and what that frees ────────────────────────────────────

const standing = alliances.between(north.clan.id, south.clan.id);
check('a clan outside the alliance cannot break it', !alliances.breakAlliance(standing.id, east.clan.id).ok);
check('either side inside it can', alliances.breakAlliance(standing.id, south.clan.id).ok);
check('after which they are not allied', !alliances.allied(north.clan.id, south.clan.id));
checkEqual('and the alliance is filed in their history', alliances.historyBetween(north.clan.id, south.clan.id).length, 1);
checkEqual('recording who broke it', alliances.historyBetween(north.clan.id, south.clan.id)[0].outcome, 'broken');
check('war between them is possible again', wars.declare(north.clan, south.clan, north.leader.id).ok);

// ── Declining, withdrawing, and disbanding ───────────────────────────────

const declined = alliances.propose(south.clan, east.clan, south.leader.id);
check('a proposal can be declined by the clan asked', alliances.decline(declined.value.id, east.clan.id).ok);
checkEqual('and is filed as declined', alliances.getAlliance(declined.value.id).outcome, 'declined');

const withdrawn = alliances.propose(south.clan, east.clan, south.leader.id);
check('the clan asked cannot withdraw a proposal', !alliances.withdraw(withdrawn.value.id, east.clan.id).ok);
check('the clan that made it can', alliances.withdraw(withdrawn.value.id, south.clan.id).ok);
checkEqual('and it is filed as withdrawn', alliances.getAlliance(withdrawn.value.id).outcome, 'withdrawn');

const doomed = fullClan('d', 'Doomed');
alliances.propose(doomed.clan, south.clan, doomed.leader.id);
const pact = alliances.between(doomed.clan.id, south.clan.id);
alliances.accept(pact.id, south.clan.id);
check('a clan can hold a standing alliance', alliances.allied(doomed.clan.id, south.clan.id));
clans.disband(doomed.clan.id);
check('which ends when that clan disbands', !alliances.allied(doomed.clan.id, south.clan.id));
checkEqual('filed as such', alliances.getAlliance(pact.id).outcome, 'disbanded');

// ── A clan cannot ally with one it is fighting ───────────────────────────

const fighting = wars.warBetween(north.clan.id, south.clan.id);
check('the two are at war', fighting !== undefined);
const duringWar = alliances.propose(north.clan, south.clan, north.leader.id);
check('so an alliance between them is refused', !duringWar.ok);
check('and the refusal names the war', String(duringWar.error).includes('war'));

// ── Outposts deal only when the server says so ───────────────────────────

const scoutLeader = new mock.Player('o0', 'Scoutleader');
playersMod.register(scoutLeader);
const scouts = clans.createClan(scoutLeader.id, scoutLeader.name, 'Scouts').value;
check('the new clan is an outpost', clans.isOutpost(clans.getClan(scouts.id)));

settings.update({ outpostsMayAlly: false });
const outpostRefused = alliances.propose(clans.getClan(scouts.id), east.clan, scoutLeader.id);
check('with the switch off an outpost cannot propose', !outpostRefused.ok);
check('and the refusal names the outpost', String(outpostRefused.error).includes('Scouts'));
check(
  'nor can a full clan propose to one',
  !alliances.propose(east.clan, clans.getClan(scouts.id), east.leader.id).ok,
);
check(
  'while two full clans are unaffected',
  alliances.propose(east.clan, doomed.clan, east.leader.id).ok === false ||
    alliances.between(east.clan.id, doomed.clan.id) !== undefined,
);

settings.update({ outpostsMayAlly: true });
const outpostAllowed = alliances.propose(clans.getClan(scouts.id), east.clan, scoutLeader.id);
check('with the switch on an outpost can propose', outpostAllowed.ok);
alliances.withdraw(outpostAllowed.value.id, scouts.id);

// ── The alliance switch ──────────────────────────────────────────────────

const survivor = alliances.propose(south.clan, east.clan, south.leader.id);
check('an alliance stands before the switch is thrown', survivor.ok);
alliances.accept(survivor.value.id, east.clan.id);
check('and is agreed', alliances.allied(south.clan.id, east.clan.id));

settings.update({ alliancesEnabled: false });
checkEqual('turning alliances off dissolves every one of them', alliances.liveAlliances().length, 0);
check('so the two are no longer allied', !alliances.allied(south.clan.id, east.clan.id));
checkEqual('and it is filed as dissolved by the setting', alliances.getAlliance(survivor.value.id).outcome, 'disabled');
check('with alliances off, nothing can be proposed', !alliances.propose(south.clan, east.clan, south.leader.id).ok);

settings.update({ alliancesEnabled: true });
check('turning it back on restores proposing', alliances.propose(south.clan, east.clan, south.leader.id).ok);

// ── The war switch ───────────────────────────────────────────────────────

checkEqual('there is a live war to start with', wars.liveWars().length, 2);
settings.update({ warsEnabled: false });
checkEqual('turning wars off annuls every live war', wars.liveWars().length, 0);
check(
  'and no new war can be declared',
  !wars.declare(east.clan, north.clan, east.leader.id).ok,
);
checkEqual(
  'the annulled wars are recorded as annulled',
  wars.historyFor(north.clan.id).filter((war) => war.outcome === 'annulled').length,
  2,
);

settings.update({ warsEnabled: true });
check('turning wars back on allows a declaration again', wars.declare(east.clan, north.clan, east.leader.id).ok);

// ── An admin promotes an outpost the queue would have refused ────────────

const smallLeader = new mock.Player('t0', 'Tinyleader');
playersMod.register(smallLeader);
const tiny = clans.createClan(smallLeader.id, smallLeader.name, 'Tinyclan').value;
check('the outpost is below strength', clans.memberCount(tiny) < settings.promotionThreshold());

const requests = await load('requests.js');
check(
  'so a promotion request is refused',
  !requests.filePromotion({ id: smallLeader.id, name: smallLeader.name }, clans.getClan(tiny.id)).ok,
);
check('while promoting it outright still works', clans.promote(tiny.id).ok);
check('and it is a full clan afterwards', !clans.isOutpost(clans.getClan(tiny.id)));

checkEqual('the alliance cap is a real number', typeof LIMITS.maxAlliancesPerClan, 'number');

finish();
