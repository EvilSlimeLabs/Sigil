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
 * Screens are async and run() does not await them, so a screen
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
// Wars are reached through the War Map block and `/clan:war`, never from the
// clan menu — repeating them here made the placed block look decorative.
check('a leader is offered no war entry', !leaderMenu.some((b) => b.includes('War Map')));
check('a leader sees no staff tools', !leaderMenu.some((b) => b.includes('Admin')));
check('a leader sees no admin tools', !leaderMenu.some((b) => b.includes('Settings')));

const strangerMenu = buttonsOf((await open(() => ui.mainMenu(stranger)))[0]);
check('a clanless player is offered clan creation', strangerMenu.some((b) => b.includes('Create a Clan')));
check('and no war map', !strangerMenu.some((b) => b.includes('War Map')));

// ── Staff powers live behind exactly two doors ────────────────────────────
// The front door carries what a player came for. Everything a staff role or an
// admin can do is one level in, so an operator opening the menu to look at
// their own clan is not met by eleven buttons about other people's.
const modMenu = buttonsOf((await open(() => ui.mainMenu(mod)))[0]);
check('a Mod sees the admin door', modMenu.some((b) => b.includes('Admin')));
check('a Mod does not see system settings', !modMenu.some((b) => b.includes('System Settings')));
check('and no staff powers are on the front door', !modMenu.some((b) => b.includes('Manage Clans')));
check('nor any wars', !modMenu.some((b) => b.includes('Active Wars')));
check('nor the review queue', !modMenu.some((b) => b.includes('Clan Requests')));

const modAdmin = buttonsOf((await open(() => ui.adminMenu(mod)))[0]);
check('a Mod reaches clan management through it', modAdmin.some((b) => b.includes('Manage Clans')));
check('and active wars', modAdmin.some((b) => b.includes('Active Wars')));
check('and the review queue', modAdmin.some((b) => b.includes('Clan Requests')));
check('but cannot purge', !modAdmin.some((b) => b.includes('Purge')));
check('and cannot found a clan for anyone', !modAdmin.some((b) => b.includes('Create a Clan for')));

const adminFront = buttonsOf((await open(() => ui.mainMenu(admin)))[0]);
check('an admin sees the admin door', adminFront.some((b) => b.includes('Admin')));
check('an admin sees system settings', adminFront.some((b) => b.includes('System Settings')));
check('the front door carries nothing else of theirs', adminFront.length <= 5);

const adminTools = buttonsOf((await open(() => ui.adminMenu(admin)))[0]);
check('an admin can purge', adminTools.some((b) => b.includes('Purge')));
check(
  'an admin can found a clan for someone else',
  adminTools.some((b) => b.includes('Create a Clan for a Player')),
);

const sysSettings = buttonsOf((await open(() => ui.systemSettingsMenu(admin)))[0]);
check('an admin sees staff roles', sysSettings.some((b) => b.includes('Staff Roles')));
check('an admin sees settings', sysSettings.some((b) => b.includes('Settings')));
check('an admin sees display settings', sysSettings.some((b) => b.includes('Display Settings')));
check(
  'the settings screen is not called a clan setting',
  !sysSettings.some((b) => b === 'Clan Settings'),
);

// A Mod routed straight into the settings screen is still refused.
const modSystemSettings = await open(() => ui.systemSettingsMenu(mod));
checkEqual('a Mod cannot reach system settings directly', modSystemSettings.length, 0);

// ── Back buttons exist only where there is somewhere to go back to ────────
//
// A screen opened from the clan menu is told its way home and shows a Back
// button; the same screen opened from a command or the War Map block is not,
// because there is no parent to return to.
const fromLedger = await open(() => {
  ui2.__answers('My Clan');
  ui.mainMenu(leader);
});
const clanFromLedger = buttonsOf(screen(fromLedger, 'Wolves'));
check('a screen reached from the ledger offers Back', clanFromLedger.includes('Back'));

const direct = buttonsOf((await open(() => ui.myClanMenu(leader)))[0]);
check('the same screen reached directly does not', !direct.includes('Back'));

// ── A Leader sets the clan colour; nobody else does ───────────────────────
check('a leader is offered the clan colour', direct.some((b) => b.includes('Clan Colour')));
const asMember = buttonsOf((await open(() => ui.myClanMenu(member)))[0]);
check('an ordinary member is not', !asMember.some((b) => b.includes('Clan Colour')));

const colourScreen = await open(() => {
  ui2.__answers('Clan Colour', { color: 6 });
  ui.myClanMenu(leader);
});
check(
  'the colour screen offers the whole palette plus a default',
  (screen(colourScreen, 'Clan Colour')?.inputs ?? []).length === 1,
);
// Index 6 in the dropdown: the placeholder default sits at 0, so the palette
// runs from 1 and aqua is the sixth entry.
checkEqual('choosing one stores it on the clan', clans.getClan(wolves.id).color, '§b');

await open(() => {
  ui2.__answers('Clan Colour', { color: 0 });
  ui.myClanMenu(leader);
});
checkEqual(
  'and the placeholder clears it again',
  clans.getClan(wolves.id).color,
  undefined,
);

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

// A belligerent Leader gets the opposite set, reached from the war screen the
// War Map block opens.
const leaderWar = await open(() => {
  ui2.__answers('Our Wars', 0);
  ui.warMenu(leader);
});
const leaderDetail = screen(leaderWar, '1st War');
check('a leader may surrender', buttonsOf(leaderDetail).some((b) => b.includes('Surrender')));
check('a leader may offer peace', buttonsOf(leaderDetail).some((b) => b.includes('Peace')));

// ── A modal round-trips its values by key ─────────────────────────────────
// The mock gives non-inputs a slot, the stricter of the two
// possible engine behaviours, so this proves the resolver handles it.
settings.update({ requireClanApproval: true });
await open(() => {
  ui2.__answer({
    requireApproval: false,
    promotionMembers: 7,
    maxOutpost: 12,
    maxClan: 60,
    warNeedsAcceptance: false,
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
checkEqual('and the outpost member cap', saved.maxOutpostMembers, 12);
checkEqual('and the full-clan member cap', saved.maxClanMembers, 60);

// The same form under the other convention: non-inputs contribute nothing.
// The resolver works this out from the response length, so both must land.
ui2.__setSlotMode("inputs-only");
settings.update({ requireClanApproval: true, outpostPromotionMembers: 5, opPollSeconds: 20 });
await open(() => {
  ui2.__answer({
    requireApproval: false,
    promotionMembers: 9,
    maxOutpost: 20,
    maxClan: 80,
    warNeedsAcceptance: true,
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
// Each kind of request has its own wording, and a promotion notice goes to
// whoever can approve promotions rather than creations.
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
  txt.request.reviewNoticeCreate('Zoe', 'Badgers').replace(/§./g, '').split(String.fromCharCode(10))[0],
  'Zoe requested the clan Badgers.',
);
checkEqual(
  'a promotion notice says promotion',
  txt.request.reviewNoticePromote('Alex', 'Wolves').replace(/§./g, '').split(String.fromCharCode(10))[0],
  'Alex asked to promote Wolves to a full clan.',
);
checkEqual(
  'a rename notice names both names',
  txt.request.reviewNoticeRename('Alex', 'Wolves', 'Direwolves').replace(/§./g, '').split(String.fromCharCode(10))[0],
  'Alex asked to rename Wolves to Direwolves.',
);

// Promotion approval rights are separate from creation approval rights.
staff.updateRole('mod', { approveClans: false, approvePromotions: true });
const promoRequest = { kind: 'promote', clanId: wolves.id, name: 'Wolves', requesterId: leader.id, requesterName: 'Alex', id: 'x', at: 0 };
const createRequest = { kind: 'create', name: 'Badgers', requesterId: stranger.id, requesterName: 'Zoe', id: 'y', at: 0 };
check('a Mod may still review promotions', requests.canApproveRequest(mod, promoRequest));
check('but not creations', !requests.canApproveRequest(mod, createRequest));
staff.updateRole('mod', { approveClans: true });
settings.update({ staffCanApproveClans: true });

// ── Long lists page rather than building one button per record ───────────
// A form with four hundred buttons is not a menu. Every list screen goes
// through the same picker, so this holds for all of them.
const crowd = Array.from({ length: 95 }, (_, i) => new mock.Player(`c${i}`, `Recruit${i}`));
mock.__setPlayers([...roster, ...crowd]);
for (const person of crowd) playersMod.register(person);

const bigClan = clans.createClan(crowd[0].id, crowd[0].name, 'Legion').value;
// Promote before filling: an outpost holds far fewer members than a full clan,
// so a roster this size only exists on the far side of promotion. The
// threshold is set explicitly because the modal round-trip above left it at
// whatever that test was proving.
settings.update({ outpostPromotionMembers: 2 });
for (const person of crowd.slice(1, 3)) clans.addMember(bigClan.id, person.id, person.name);
const legionPromotion = requests.filePromotion(
  { id: crowd[0].id, name: crowd[0].name },
  clans.getClan(bigClan.id),
);
requests.approve(legionPromotion.value.id);
for (const person of crowd.slice(3)) clans.addMember(bigClan.id, person.id, person.name);

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
// Forty rows, then Next page, then Back: this screen was opened from the
// clan menu, so it has somewhere to go back to.
const navigation = (b) => b.includes('page') || b === 'Back';
check('a long roster is capped at one page', buttonsOf(roster1).length <= 42);
check('and offers a next page', buttonsOf(roster1).some((b) => b.includes('Next page')));
check('but no previous page on the first', !buttonsOf(roster1).some((b) => b.includes('Previous')));
check('and a way back out of the list', buttonsOf(roster1).includes('Back'));
check('the page count is shown', roster1.body.includes('Page 1 of'));

// Paging and navigation buttons sit after the items, so an item's index never
// shifts under someone part-way through reading the page.
const itemButtons = buttonsOf(roster1).filter((b) => !navigation(b));
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
check(
  'and every row matches',
  buttonsOf(narrowed)
    .filter((b) => !navigation(b))
    .every((b) => b.includes('Recruit9')),
);

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
