/**
 * Exercises the admin-facing layer: settings, the clan-creation approval
 * queue, notification gating, and purging a player.
 */

import { prepare, load, check, checkEqual, plain, finish } from './harness.mjs';

prepare([
  'config.js',
  'format.js',
  'text.js',
  'storage.js',
  'players.js',
  'settings.js',
  'staff.js',
  'clans.js',
  'invites.js',
  'requests.js',
  'announce.js',
  'peaceful.js',
  'brackets.js',
  'display.js',
  'purge.js',
  'hooks.js',
]);

const mock = await load('mock-server.js');
const storage = await load('storage.js');
const playersMod = await load('players.js');
const settings = await load('settings.js');
const staff = await load('staff.js');
const clans = await load('clans.js');
const invites = await load('invites.js');
const requests = await load('requests.js');
const announce = await load('announce.js');
const peaceful = await load('peaceful.js');
const display = await load('display.js');
const { purge } = await load('purge.js');

const admin = new mock.Player('g1', 'Steve', true);
const mod = new mock.Player('g2', 'Alex');
const player = new mock.Player('g3', 'Zoe');
const other = new mock.Player('g4', 'Robin');
mock.__setPlayers([admin, mod, player, other]);

storage.initSchema();
staff.ensureDefaults();
for (const p of [admin, mod, player, other]) playersMod.register(p);
staff.assignRole(mod.id, 'mod');

// ── Settings defaults ─────────────────────────────────────────────────────
const defaults = settings.get();
check('approval is required by default', defaults.requireClanApproval === true);
check('the Mod role may approve by default', staff.roleById('mod').approveClans === true);
check('and the Helper role may not', staff.roleById('helper').approveClans === false);
checkEqual('an outpost holds fifteen by default', settings.memberLimit(true), 15);
checkEqual('a full clan holds a hundred', settings.memberLimit(false), 100);
checkEqual('operator status is re-checked every 20 seconds by default', defaults.opPollSeconds, 20);
check('notifications are on by default', defaults.notifications.enabled === true);
check(
  'every notification category is on by default',
  defaults.notifications.clanCreated &&
    defaults.notifications.memberJoined &&
    defaults.notifications.memberLeft &&
    defaults.notifications.clanDisbanded,
);
checkEqual('the default poll interval is 400 ticks', settings.opPollIntervalTicks(), 400);

// A partial update leaves the other switches alone.
settings.update({ notifications: { memberLeft: false } });
check('a partial update preserves untouched switches', settings.get().notifications.memberJoined === true);
check('a partial update applies the change', settings.get().notifications.memberLeft === false);
settings.update({ notifications: { memberLeft: true } });

// A malformed interval cannot produce a zero-tick poll.
settings.update({ opPollSeconds: 0 });
// Clamped to a 5-second floor, so a malformed value cannot schedule a poll
// that runs every tick.
checkEqual('a zero interval is clamped to the 5-second floor', settings.opPollIntervalTicks(), 100);
settings.update({ opPollSeconds: 20 });

// ── Who may approve ───────────────────────────────────────────────────────
check('an admin may approve requests', requests.canApprove(admin));
check('a Mod may approve requests by default', requests.canApprove(mod));
check('an ordinary player may not approve', !requests.canApprove(player));

// The power is on the role, so revoking it is a role edit and it touches only
// that power on only that role.
staff.updateRole('mod', { approveClans: false });
check('an admin can revoke Mod approval rights', !requests.canApprove(mod));
check('the admin keeps approval rights regardless', requests.canApprove(admin));
check('and Mod keeps its other powers', peaceful.canAssign(mod));
staff.updateRole('mod', { approveClans: true });

// ── Admins bypass the queue; everyone else files a request ────────────────
check('an admin does not need approval', !requests.approvalRequiredFor(admin));
check('an ordinary player does need approval', requests.approvalRequiredFor(player));

const filed = requests.file({ id: player.id, name: player.name }, 'Wolves');
check('a request is filed', filed.ok);
check('filing does not create a clan', clans.clanOf(player.id) === undefined);
checkEqual('the queue holds the request', requests.all().length, 1);

// A second request from the same player replaces the first.
requests.file({ id: player.id, name: player.name }, 'Bears');
checkEqual('re-filing replaces rather than duplicates', requests.all().length, 1);
checkEqual('the replacement name is kept', requests.forPlayer(player.id).name, 'Bears');

// A name already requested by someone else is refused.
check(
  'another player cannot request the same name',
  !requests.file({ id: other.id, name: other.name }, 'bears').ok,
);

// ── Approval creates the clan with the requester as Leader ────────────────
mock.__clearBroadcasts();
const approved = requests.approve(requests.forPlayer(player.id).id);
check('the request is approved', approved.ok);
checkEqual('the clan now exists', clans.clanOf(player.id)?.name, 'Bears');
checkEqual('the requester is the Leader', clans.roleOf(clans.clanOf(player.id), player.id), 'Leader');
checkEqual('the queue is emptied', requests.all().length, 0);

// ── Notification gating ───────────────────────────────────────────────────
mock.__clearBroadcasts();
announce.clanCreated('Bears', 'Zoe');
checkEqual('an enabled category broadcasts', mock.__broadcasts().length, 1);
check('the broadcast names the clan', plain(mock.__broadcasts()[0]).includes('Bears'));

mock.__clearBroadcasts();
settings.update({ notifications: { clanCreated: false } });
announce.clanCreated('Bears', 'Zoe');
checkEqual('a disabled category stays silent', mock.__broadcasts().length, 0);

announce.memberJoined('Bears', 'Robin');
checkEqual('other categories are unaffected', mock.__broadcasts().length, 1);

mock.__clearBroadcasts();
settings.update({ notifications: { enabled: false } });
announce.memberJoined('Bears', 'Robin');
announce.memberLeft('Bears', 'Robin', true);
announce.clanDisbanded('Bears');
checkEqual('the master switch silences everything', mock.__broadcasts().length, 0);

settings.update({ notifications: { enabled: true, clanCreated: true } });

// ── Denial ────────────────────────────────────────────────────────────────
requests.file({ id: other.id, name: other.name }, 'Falcons');
const denied = requests.deny(requests.forPlayer(other.id).id);
check('a request is denied', denied.ok);
checkEqual('denial empties the queue', requests.all().length, 0);
check('denial creates no clan', clans.clanOf(other.id) === undefined);

// ── Approval fails cleanly if the requester joined a clan meanwhile ───────
requests.file({ id: other.id, name: other.name }, 'Falcons');
const bears = clans.clanOf(player.id);
clans.addMember(bears.id, other.id, other.name);
const stale = requests.approve(requests.forPlayer(other.id).id);
check('a stale request is refused', !stale.ok);
checkEqual('the stale request is dropped', requests.all().length, 0);

// ── Purging a player ──────────────────────────────────────────────────────
// The real workflow is: ban them on your platform, they are gone, then purge.
// So the target is taken offline first — which is also what makes the name
// registry the only way to find them.
mock.__setPlayers([admin, mod, player]);

// A plain member: removed from their clan, everything else scrubbed.
invites.invite(bears, { id: player.id, name: player.name }, { id: mod.id, name: mod.name });
checkEqual('the invite exists before the purge', invites.pendingFor(mod.id).length, 1);

peaceful.set(other.id, true);
check('the target is Peaceful before the purge', peaceful.isPeaceful(other.id));

const report = purge(other.id, other.name);
check('the purge reports the Peaceful marker', report.hadPeaceful);
check('and clears it', !peaceful.isPeaceful(other.id));
checkEqual('the purge reports the clan', report.clanName, 'Bears');
check('the purged member left the clan', clans.clanOf(other.id) === undefined);
check('the clan survives', clans.getClan(bears.id) !== undefined);
check('the name registry entry is gone', playersMod.nameOf(other.id) === undefined);
check('the player can no longer be found by name', playersMod.idForName('Robin') === undefined);

// An owner with other members: leadership passes rather than the clan dying.
clans.addMember(bears.id, mod.id, mod.name);
const ownerReport = purge(player.id, player.name);
check('the owner purge did not disband the clan', !ownerReport.clanDisbanded);
checkEqual('leadership passed to the remaining member', ownerReport.newLeaderName, 'Alex');
checkEqual('the heir is now Leader', clans.roleOf(clans.clanOf(mod.id), mod.id), 'Leader');
check('the purged owner is gone from the clan', clans.clanOf(player.id) === undefined);
checkEqual('invites the purged player sent are withdrawn', invites.pendingFor(mod.id).length, 0);

// A lone owner: the clan is disbanded, since nobody is left to lead it.
const soloReport = purge(mod.id, mod.name);
check('a lone owner purge disbands the clan', soloReport.clanDisbanded);
checkEqual('no clans remain', clans.clanIds().length, 0);
check('the purged staff role is cleared', staff.roleOf(mod.id) === undefined);

// ── A purged player who is online is redrawn as nobody ───────────────────
// Clearing their clan signals a refresh, so the staff role and Peaceful marker
// have to be gone by then — otherwise the redraw paints the very tags being
// taken away, and nothing runs again to correct it.
const ghost = new mock.Player('g9', 'Wisp');
mock.__setPlayers([admin, mod, player, ghost]);
playersMod.register(ghost);
staff.assignRole(ghost.id, 'mod');
peaceful.set(ghost.id, true);

const host = clans.createClan(admin.id, admin.name, 'Hosts').value;
clans.addMember(host.id, ghost.id, ghost.name);
display.refresh(ghost);
check('the ghost shows their tags first', plain(ghost.nameTag).includes('Hosts'));

purge(ghost.id, ghost.name);
checkEqual('a purged online player is redrawn as their bare name', plain(ghost.nameTag), 'Wisp');
check('with no staff tag left', !plain(ghost.nameTag).includes('Mod'));
check('and no clan', clans.clanOf(ghost.id) === undefined);

// ── Visitors are not candidates, and operators hold Admin alone ──────────
const visitor = new mock.Player('g9', 'Watcher');
visitor.playerPermissionLevel = mock.PlayerPermissionLevel.Visitor;
const founder = new mock.Player('g7', 'Founder');
mock.__setPlayers([admin, mod, player, visitor, founder]);
playersMod.register(visitor);
playersMod.register(founder);

check('a visitor is recognised as one', playersMod.isVisitor(visitor));
check('and is dropped from the candidate list', !playersMod.allKnown().some((r) => r.id === visitor.id));
check('while everyone else stays on it', playersMod.allKnown().some((r) => r.id === founder.id));

const hostClan = clans.createClan(founder.id, founder.name, 'Wardens').value;

// Logging off does not stop someone being a visitor: the level seen on their
// last visit is stored, so they stay out of the pickers while away.
mock.__setPlayers([admin, mod, player, founder]);
check(
  'a visitor who logs off is still filtered',
  !playersMod.allKnown().some((r) => r.id === visitor.id),
);
check('and is still refused an invite', !invites.invite(
  clans.getClan(clans.clanOf(founder.id)?.id ?? ''),
  { id: founder.id, name: founder.name },
  { id: visitor.id, name: visitor.name },
).ok);

// Rejoining at a higher level clears it: the record is corrected on join, so
// a promoted visitor becomes a candidate without an admin doing anything.
visitor.playerPermissionLevel = mock.PlayerPermissionLevel.Member;
mock.__setPlayers([admin, mod, player, visitor, founder]);
playersMod.register(visitor);
check('a promoted visitor becomes a candidate again', playersMod.allKnown().some((r) => r.id === visitor.id));
mock.__setPlayers([admin, mod, player, founder]);
check('and stays one after logging off', playersMod.allKnown().some((r) => r.id === visitor.id));

// A player never observed at all is not filtered — never having been seen is
// not evidence of anything.
check(
  'a player with no permission record is left alone',
  playersMod.lastPermission('never-seen') === undefined,
);

// Back to a visitor for the checks below.
visitor.playerPermissionLevel = mock.PlayerPermissionLevel.Visitor;
mock.__setPlayers([admin, mod, player, visitor, founder]);
playersMod.register(visitor);

const refused = invites.invite(
  clans.getClan(hostClan.id),
  { id: founder.id, name: founder.name },
  { id: visitor.id, name: visitor.name },
);
check('a visitor cannot be invited', !refused.ok);
check('and is told why', String(refused.error).includes('Visitor'));

check('an operator may not hold a staff role', !staff.mayHoldRole(admin));
check('an ordinary member may', staff.mayHoldRole(founder));
const custom = new mock.Player('g8', 'Custom');
custom.playerPermissionLevel = mock.PlayerPermissionLevel.Custom;
check('and a custom-permission player may too', staff.mayHoldRole(custom));

// ── A clan that thins out is queued for review, not demoted ──────────────
settings.update({ outpostPromotionMembers: 3 });
// A leader with no clan of their own; `founder` already runs Wardens.
const chief = new mock.Player('b0', 'Chief');
playersMod.register(chief);
const band = clans.createClan(chief.id, chief.name, 'Banders').value;
for (const [i, id] of ['b1', 'b2'].entries()) {
  const p = new mock.Player(id, 'Bander' + i);
  playersMod.register(p);
  clans.addMember(band.id, p.id, p.name);
}
const bandPromotion = requests.filePromotion({ id: chief.id, name: chief.name }, clans.getClan(band.id));
requests.approve(bandPromotion.value.id);
check('the clan is promoted', !clans.isOutpost(clans.getClan(band.id)));

clans.removeMember(band.id, 'b1');
const queued = requests.all().filter((r) => r.kind === 'demote' && r.clanId === band.id);
checkEqual('losing a member queues one demotion review', queued.length, 1);
check('and the clan is not demoted yet', !clans.isOutpost(clans.getClan(band.id)));

clans.removeMember(band.id, 'b2');
checkEqual(
  'losing another does not queue a second',
  requests.all().filter((r) => r.kind === 'demote' && r.clanId === band.id).length,
  1,
);

// Recruiting back to strength makes the review refuse rather than demote.
const rejoin = new mock.Player('b3', 'Bander3');
playersMod.register(rejoin);
clans.addMember(band.id, rejoin.id, rejoin.name);
clans.addMember(band.id, 'b1', 'Bander0');
check('a recovered clan is not demoted', !requests.approve(queued[0].id).ok);
check('and stays a full clan', !clans.isOutpost(clans.getClan(band.id)));

// Back below strength, the review goes through.
clans.removeMember(band.id, 'b1');
clans.removeMember(band.id, rejoin.id);
check('an understrength clan is demoted on approval', requests.approve(queued[0].id).ok);
check('and is an outpost again', clans.isOutpost(clans.getClan(band.id)));

// -- Demotions are a queue of their own -----------------------------------
const reviewer = new mock.Player('q0', 'Queenie');
reviewer.playerPermissionLevel = mock.PlayerPermissionLevel.Operator;
playersMod.register(reviewer);

const solo = new mock.Player('q1', 'Solo');
playersMod.register(solo);
const keep = clans.createClan(solo.id, solo.name, 'Keepers').value;
for (const [i, id] of ['q2', 'q3'].entries()) {
  const p = new mock.Player(id, 'Keeper' + i);
  playersMod.register(p);
  clans.addMember(keep.id, p.id, p.name);
}
requests.approve(requests.filePromotion({ id: solo.id, name: solo.name }, clans.getClan(keep.id)).value.id);
clans.removeMember(keep.id, 'q2');

checkEqual('the demotion queue holds it', requests.demotionsReviewableBy(reviewer).length, 1);
check(
  'and the request queue does not',
  requests.reviewableBy(reviewer).every((r) => r.kind !== 'demote'),
);
checkEqual(
  'while the front door counts both',
  requests.pendingFor(reviewer),
  requests.reviewableBy(reviewer).length + 1,
);

// -- The sweep settles the queue against the clans that exist -------------
requests.demotions().forEach((r) => requests.withdraw(r.id));
checkEqual('a queue emptied behind the system stays empty', requests.demotions().length, 0);
checkEqual('until a sweep re-files it', requests.sweepDemotions().filed, 1);
checkEqual('and a second sweep files nothing new', requests.sweepDemotions().filed, 0);

// Lowering the threshold puts the clan back at strength, so the review goes.
settings.update({ outpostPromotionMembers: 2 });
checkEqual('lowering the threshold clears the review', requests.demotions().length, 0);
check('and the clan keeps its rank', !clans.isOutpost(clans.getClan(keep.id)));

// Raising it strands the clan below a line that moved under it.
settings.update({ outpostPromotionMembers: 4 });
checkEqual('raising it files a review without anyone leaving', requests.demotions().length, 1);

finish();
