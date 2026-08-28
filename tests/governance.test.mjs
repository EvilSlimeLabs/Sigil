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
check('staff may approve by default', defaults.staffCanApproveClans === true);
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

settings.update({ staffCanApproveClans: false });
check('an admin can revoke Mod approval rights', !requests.canApprove(mod));
check('the admin keeps approval rights regardless', requests.canApprove(admin));
settings.update({ staffCanApproveClans: true });

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

finish();
