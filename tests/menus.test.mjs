/**
 * Exercises the menu layer — the 3,000 lines that were previously only
 * type-checked.
 *
 * What matters here is not that a screen renders, but **who is offered what**:
 * every permission gate in the UI lives in a button that is conditionally
 * added, so a test that reads the offered buttons is testing the permission
 * model as players actually meet it.
 */

import { prepare, load, check, checkEqual, finish } from './harness.mjs';

prepare([
  'config.js',
  'format.js',
  'brackets.js',
  'storage.js',
  'players.js',
  'settings.js',
  'staff.js',
  'peaceful.js',
  'clans.js',
  'invites.js',
  'requests.js',
  'announce.js',
  'wars.js',
  'warbook.js',
  'purge.js',
  'hooks.js',
  'display.js',
  'forms.js',
  'text.js',
  'ui.js',
]);

const mock = await load('mock-server.js');
const ui2 = await load('mock-server-ui.js');
const storage = await load('storage.js');
const playersMod = await load('players.js');
const settings = await load('settings.js');
const staff = await load('staff.js');
const clans = await load('clans.js');
const requests = await load('requests.js');
const wars = await load('wars.js');
const ui = await load('ui.js');
const { TEXT: txt } = await load('text.js');

const admin = new mock.Player('m0', 'Steve', true);
const leader = new mock.Player('m1', 'Alex');
const member = new mock.Player('m2', 'Kai');
const mod = new mock.Player('m3', 'Robin');
const stranger = new mock.Player('m4', 'Zoe');
const roster = [admin, leader, member, mod, stranger];
mock.__setPlayers(roster);

storage.initSchema();
staff.ensureDefaults();
for (const p of roster) playersMod.register(p);
staff.assignRole(mod.id, 'mod');
settings.update({ requireClanApproval: false, outpostPromotionMembers: 2 });

const wolves = clans.createClan(leader.id, leader.name, 'Wolves').value;
clans.addMember(wolves.id, member.id, member.name);

/**
 * Lets every pending microtask run.
 *
 * Screens are async and run() deliberately does not await them, so a screen
 * that opens a second screen finishes on the microtask queue. Draining it is
 * what makes a whole navigation path observable from a test.
 */
async function drain(rounds = 60) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/** Runs a screen to completion and returns everything it showed. */
async function open(screen) {
  ui2.__resetForms();
  screen();
  await drain();
  return ui2.__shown();
}

/** The buttons a form offered, flattened to first lines. */
function buttonsOf(entry) {
  return (entry?.buttons ?? []).map((b) => b.split('\n')[0]);
}

/**
 * Finds a screen by its title among everything shown.
 *
 * Once the queued answers run out, each screen cancels and calls back into its
 * parent, so the *last* form shown is whatever the navigation unwound to — not
 * the screen under test. Naming the screen is both more precise and more
 * readable than counting positions.
 */
function screen(shownForms, titleFragment) {
  return shownForms.find((entry) => entry.title.includes(titleFragment));
}

// ── The main menu offers what each role may actually do ───────────────────
const leaderMenu = buttonsOf((await open(() => ui.mainMenu(leader)))[0]);
check('a leader sees their clan', leaderMenu.some((b) => b.includes('My Clan')));
check('a leader sees the war map', leaderMenu.some((b) => b.includes('War Map')));
check('a leader sees no staff tools', !leaderMenu.some((b) => b.includes('Manage Clans')));
check('a leader sees no admin tools', !leaderMenu.some((b) => b.includes('Settings')));

const strangerMenu = buttonsOf((await open(() => ui.mainMenu(stranger)))[0]);
check('a clanless player is offered clan creation', strangerMenu.some((b) => b.includes('Create a Clan')));
check('and no war map', !strangerMenu.some((b) => b.includes('War Map')));

const modMenu = buttonsOf((await open(() => ui.mainMenu(mod)))[0]);
check('a Mod sees clan management', modMenu.some((b) => b.includes('Manage Clans')));
check('a Mod sees active wars', modMenu.some((b) => b.includes('Active Wars')));
check('a Mod sees clan requests', modMenu.some((b) => b.includes('Clan Requests')));
check('a Mod does not see staff roles', !modMenu.some((b) => b.includes('Staff Roles')));
check('a Mod does not see settings', !modMenu.some((b) => b.includes('Settings')));
check('a Mod cannot purge', !modMenu.some((b) => b.includes('Purge')));

const adminMenu = buttonsOf((await open(() => ui.mainMenu(admin)))[0]);
check('an admin sees staff roles', adminMenu.some((b) => b.includes('Staff Roles')));
check('an admin sees settings', adminMenu.some((b) => b.includes('Settings')));
check('an admin sees display settings', adminMenu.some((b) => b.includes('Display Settings')));
check('an admin can purge', adminMenu.some((b) => b.includes('Purge')));

// ── Member actions are gated by who is looking ────────────────────────────
const asStranger = await open(() => {
  ui2.__answers('Members', 'Kai');
  ui.myClanMenu(leader);
});
const memberScreen = screen(asStranger, 'Kai');
check('the leader reaches a member screen', memberScreen !== undefined);
check('a leader may set a role', buttonsOf(memberScreen).some((b) => b.includes('Set Role')));
check('a leader may remove', buttonsOf(memberScreen).some((b) => b.includes('Remove')));

// A plain member browsing the same clan is offered nothing but Back.
const browsed = await open(() => {
  ui2.__answers('Wolves', 'Kai');
  ui.browseClans(stranger);
});
const strangerView = screen(browsed, 'Kai');
checkEqual('a stranger gets only Back on a member', buttonsOf(strangerView).join(), 'Back');

// ── The mutating flows refuse even when reached directly ──────────────────
// memberBrowser is exported, so a caller could route a stranger into it.
const forced = await open(() => {
  ui2.__answers('Kai');
  ui.memberBrowser(stranger, wolves.id);
});
checkEqual(
  'a stranger routed straight in still gets only Back',
  buttonsOf(screen(forced, 'Kai')).join(),
  'Back',
);

// ── Staff war browser is reachable without a clan ─────────────────────────
const ravens = clans.createClan(stranger.id, stranger.name, 'Ravens').value;
clans.addMember(ravens.id, mod.id, mod.name);
for (const clan of [wolves, ravens]) {
  const req = requests.filePromotion(
    { id: clans.getClan(clan.id).ownerId, name: 'x' },
    clans.getClan(clan.id),
  );
  if (req.ok) requests.approve(req.value.id);
}
const war = wars.declare(clans.getClan(wolves.id), clans.getClan(ravens.id), leader.id);
wars.accept(war.value.id);

const adminWars = await open(() => ui.staffWarBrowser(admin));
check('an admin with no clan sees the live war', buttonsOf(adminWars[0]).length === 1);

const adminWarDetail = await open(() => {
  ui2.__answers(0);
  ui.staffWarBrowser(admin);
});
const detail = screen(adminWarDetail, '1st War');
check('an admin may annul', buttonsOf(detail).some((b) => b.includes('Annul')));
check('an admin may adjust kills', buttonsOf(detail).some((b) => b.includes('Adjust Kills')));
check('an admin is offered no surrender', !buttonsOf(detail).some((b) => b.includes('Surrender')));
check('an admin is offered no peace', !buttonsOf(detail).some((b) => b.includes('Peace')));

// A belligerent Leader gets the opposite set.
const leaderWar = await open(() => {
  ui2.__answers('War Map', 'Our Wars', 0);
  ui.mainMenu(leader);
});
const leaderDetail = screen(leaderWar, '1st War');
check('a leader may surrender', buttonsOf(leaderDetail).some((b) => b.includes('Surrender')));
check('a leader may offer peace', buttonsOf(leaderDetail).some((b) => b.includes('Peace')));

// ── A modal round-trips its values by key ─────────────────────────────────
// The mock deliberately gives non-inputs a slot, the stricter of the two
// possible engine behaviours, so this proves the resolver handles it.
settings.update({ requireClanApproval: true });
await open(() => {
  ui2.__answer({
    requireApproval: false,
    staffApproveClans: true,
    staffApprovePromotions: true,
    promotionMembers: 7,
    warNeedsAcceptance: false,
    staffAdjustKills: true,
    staffWarBooks: true,
    maxWars: 3,
    notifyEnabled: true,
    notifyCreated: true,
    notifyJoined: true,
    notifyLeft: true,
    notifyDisbanded: true,
    notifyPromoted: true,
    notifyWarDeclared: true,
    notifyWarEnded: true,
    pollSeconds: 45,
  });
  ui.settingsMenu(admin);
});

const saved = settings.get();
check('the first toggle landed on the first setting', saved.requireClanApproval === false);
checkEqual('a slider mid-form landed correctly', saved.outpostPromotionMembers, 7);
check('a toggle after two dividers landed correctly', saved.warRequiresAcceptance === false);
checkEqual('the last slider landed correctly', saved.opPollSeconds, 45);
checkEqual('and the war cap', saved.maxActiveWarsPerClan, 3);

// The same form under the other convention: non-inputs contribute nothing.
// The resolver works this out from the response length, so both must land.
ui2.__setSlotMode("inputs-only");
settings.update({ requireClanApproval: true, outpostPromotionMembers: 5, opPollSeconds: 20 });
await open(() => {
  ui2.__answer({
    requireApproval: false,
    staffApproveClans: true,
    staffApprovePromotions: true,
    promotionMembers: 9,
    warNeedsAcceptance: true,
    staffAdjustKills: true,
    staffWarBooks: true,
    maxWars: 4,
    notifyEnabled: true,
    notifyCreated: true,
    notifyJoined: true,
    notifyLeft: true,
    notifyDisbanded: true,
    notifyPromoted: true,
    notifyWarDeclared: true,
    notifyWarEnded: true,
    pollSeconds: 90,
  });
  ui.settingsMenu(admin);
});

const other = settings.get();
check("the first toggle still lands when non-inputs take no slot", other.requireClanApproval === false);
checkEqual("and a mid-form slider", other.outpostPromotionMembers, 9);
checkEqual("and the final slider", other.opPollSeconds, 90);
checkEqual("and the war cap", other.maxActiveWarsPerClan, 4);
ui2.__setSlotMode("all-slots");

// Non-admins cannot open it at all.
const modSettings = await open(() => ui.settingsMenu(mod));
checkEqual('a Mod is shown no settings form', modSettings.length, 0);

// ── Reviewers are told what was actually requested ────────────────────────
// One notice worded for creation used to be sent for promotions and renames
// too, and promotion requests went to whoever could approve *creations* —
// which is a separate setting.
settings.update({ requireClanApproval: true });
const notified = (player) => player.messages.map((m) => m.replace(/§./g, ''));

admin.messages.length = 0;
mod.messages.length = 0;
requests.file({ id: stranger.id, name: stranger.name }, 'Badgers');
ui2.__resetForms();
await open(() => ui.mainMenu(admin));
// The notice itself is sent by the command/menu paths; assert the wording
// each kind produces rather than the delivery.
checkEqual(
  'a creation notice says a clan was requested',
  txt.cmd.reviewNoticeCreate('Zoe', 'Badgers').replace(/§./g, '').split(String.fromCharCode(10))[0],
  'Zoe requested the clan Badgers.',
);
checkEqual(
  'a promotion notice says promotion',
  txt.cmd.reviewNoticePromote('Alex', 'Wolves').replace(/§./g, '').split(String.fromCharCode(10))[0],
  'Alex asked to promote Wolves to a full clan.',
);
checkEqual(
  'a rename notice names both names',
  txt.cmd.reviewNoticeRename('Alex', 'Wolves', 'Direwolves').replace(/§./g, '').split(String.fromCharCode(10))[0],
  'Alex asked to rename Wolves to Direwolves.',
);

// Promotion approval rights are separate from creation approval rights.
settings.update({ staffCanApproveClans: false, staffCanApprovePromotions: true });
const promoRequest = { kind: 'promote', clanId: wolves.id, name: 'Wolves', requesterId: leader.id, requesterName: 'Alex', id: 'x', at: 0 };
const createRequest = { kind: 'create', name: 'Badgers', requesterId: stranger.id, requesterName: 'Zoe', id: 'y', at: 0 };
check('a Mod may still review promotions', requests.canApproveRequest(mod, promoRequest));
check('but not creations', !requests.canApproveRequest(mod, createRequest));
settings.update({ staffCanApproveClans: true });

// ── Long lists page rather than building one button per record ───────────
// A form with four hundred buttons is not a menu. Every list screen goes
// through the same picker, so this holds for all of them.
const crowd = Array.from({ length: 95 }, (_, i) => new mock.Player(`c${i}`, `Recruit${i}`));
mock.__setPlayers([...roster, ...crowd]);
for (const person of crowd) playersMod.register(person);

const bigClan = clans.createClan(crowd[0].id, crowd[0].name, 'Legion').value;
for (const person of crowd.slice(1)) clans.addMember(bigClan.id, person.id, person.name);

/** The list form itself, past the search step a long list opens with. */
function listScreen(shownForms, titleFragment) {
  return shownForms.find((f) => f.kind === 'action' && f.title.includes(titleFragment));
}

// Past the threshold the picker asks for a search term first; an empty one
// means "show me everything", and then it pages.
const paged = await open(() => {
  ui2.__answers('Members', { query: '' });
  ui.myClanMenu(crowd[0]);
});

const search = paged.find((f) => f.kind === 'modal');
check('a long list asks for a search term first', search !== undefined);

const roster1 = listScreen(paged, 'Members');
check('the list itself is shown', roster1 !== undefined);
check('a long roster is capped at one page', buttonsOf(roster1).length <= 41);
check('and offers a next page', buttonsOf(roster1).some((b) => b.includes('Next page')));
check('but no previous page on the first', !buttonsOf(roster1).some((b) => b.includes('Previous')));
check('the page count is shown', roster1.body.includes('Page 1 of'));

// Paging buttons sit after the items, so an item's index never shifts.
const itemButtons = buttonsOf(roster1).filter((b) => !b.includes('page'));
checkEqual(
  'paging buttons come last',
  buttonsOf(roster1).slice(0, itemButtons.length).join('|'),
  itemButtons.join('|'),
);

// Paging forward reaches the rest, and offers the way back.
const paged2 = await open(() => {
  ui2.__answers('Members', { query: '' }, 'Next page');
  ui.myClanMenu(crowd[0]);
});
const listPages = paged2.filter((f) => f.kind === 'action' && f.title.includes('Members'));
const secondPage = listPages[listPages.length - 1];
check('the second page offers a way back', buttonsOf(secondPage).some((b) => b.includes('Previous')));
check('and the page number advanced', secondPage.body.includes('Page 2 of'));

// A search narrows the list instead of paging it.
const searched = await open(() => {
  ui2.__answers('Members', { query: 'Recruit9' });
  ui.myClanMenu(crowd[0]);
});
const narrowed = listScreen(searched, 'Members');
check('searching narrows the list', buttonsOf(narrowed).length < 41);
check('and every row matches', buttonsOf(narrowed).every((b) => b.includes('Recruit9')));

clans.disband(bigClan.id);
mock.__setPlayers(roster);

// ── A war record is read a page at a time ────────────────────────────────
const recordWar = wars.historyFor(wolves.id)[0] ?? wars.historyFor(ravens.id)[0];
if (recordWar) {
  const shownRecord = await open(() => ui.warRecord(admin, recordWar.id));
  const first = shownRecord[0];
  check('the record opens on one page', first !== undefined);
  check('and does not dump every page into the body', first.body.length < 600);
}

finish();
