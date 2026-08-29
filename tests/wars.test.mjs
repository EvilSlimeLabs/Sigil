/**
 * Exercises outposts and wars: the tier gate on declaring, acceptance, the
 * one-war-per-pair rule, every way a war can end, kill attribution, per-member
 * tallies, corrections, indefinite history and the record book.
 *
 * Kill attribution gets the most attention, because the requirement is narrow:
 * only a credited kill between two clans actually at war may score.
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
  'wars.js',
  'warbook.js',
  'hooks.js',
]);

const mock = await load('mock-server.js');
const storage = await load('storage.js');
const playersMod = await load('players.js');
const settings = await load('settings.js');
const staff = await load('staff.js');
const clans = await load('clans.js');
const requests = await load('requests.js');
const wars = await load('wars.js');
const warbook = await load('warbook.js');

const admin = new mock.Player('w0', 'Steve', true);
const leadA = new mock.Player('w1', 'Alex');
const leadB = new mock.Player('w2', 'Robin');
const memberA = new mock.Player('w3', 'Kai');
const memberB = new mock.Player('w4', 'Sam');
const outsider = new mock.Player('w5', 'Jules');
const roster = [admin, leadA, leadB, memberA, memberB, outsider];
mock.__setPlayers(roster);

storage.initSchema();
staff.ensureDefaults();
for (const p of roster) playersMod.register(p);

settings.update({ requireClanApproval: false, outpostPromotionMembers: 2 });

/** Creates a promoted, war-capable clan. */
function fullClan(leader, name, members) {
  const clan = clans.createClan(leader.id, leader.name, name).value;
  // Enough to qualify for promotion, then promote, then the rest. An outpost
  // holds fewer members than a full clan, so a large roster cannot be assembled
  // before the promotion that lifts the cap — which is the point of the two
  // limits being separate.
  for (const m of members.slice(0, 4)) clans.addMember(clan.id, m.id, m.name);
  const req = requests.filePromotion({ id: leader.id, name: leader.name }, clans.getClan(clan.id));
  requests.approve(req.value.id);
  for (const m of members.slice(4)) clans.addMember(clan.id, m.id, m.name);
  return clans.getClan(clan.id);
}

// ── Outposts ──────────────────────────────────────────────────────────────
const wolvesOutpost = clans.createClan(leadA.id, leadA.name, 'Wolves').value;
check('a new clan is an outpost', clans.isOutpost(clans.getClan(wolvesOutpost.id)));
clans.addMember(wolvesOutpost.id, memberA.id, memberA.name);
const ravensOutpost = clans.createClan(leadB.id, leadB.name, 'Ravens').value;
clans.addMember(ravensOutpost.id, memberB.id, memberB.name);

check(
  'an outpost cannot declare war',
  !wars.declare(clans.getClan(wolvesOutpost.id), clans.getClan(ravensOutpost.id), leadA.id).ok,
);

const promoA = requests.filePromotion({ id: leadA.id, name: leadA.name }, clans.getClan(wolvesOutpost.id));
requests.approve(promoA.value.id);
check('a promoted clan is no longer an outpost', !clans.isOutpost(clans.getClan(wolvesOutpost.id)));
check(
  'a full clan cannot declare on an outpost',
  !wars.declare(clans.getClan(wolvesOutpost.id), clans.getClan(ravensOutpost.id), leadA.id).ok,
);

const promoB = requests.filePromotion({ id: leadB.id, name: leadB.name }, clans.getClan(ravensOutpost.id));
requests.approve(promoB.value.id);

const wolves = clans.getClan(wolvesOutpost.id);
const ravens = clans.getClan(ravensOutpost.id);

// ── Declaring ─────────────────────────────────────────────────────────────
const first = wars.declare(wolves, ravens, leadA.id);
check('war is declared', first.ok);
checkEqual('the first war between a pair is the 1st', first.value.ordinal, 1);
checkEqual('it starts pending', first.value.state, 'pending');
checkEqual('clan names are cached on the record', first.value.nameA, 'Wolves');
check(
  'a second war between the same pair is refused',
  !wars.declare(wolves, ravens, leadA.id).ok,
);
check('the reverse pairing is refused too', !wars.declare(ravens, wolves, leadB.id).ok);

check('no kill scores while pending', wars.recordKill(memberA, memberB) === undefined);
check('the declaration is accepted', wars.accept(first.value.id).ok);

// ── Kill attribution ──────────────────────────────────────────────────────
const scored = wars.recordKill(memberA, memberB);
check('a credited cross-clan kill scores', scored !== undefined);
checkEqual('it scores for the killer clan', scored.scoringClanId, wolves.id);
checkEqual('the member tally starts at one', scored.playerKills, 1);
checkEqual('the side total is one', wars.sideTotal(wars.getWar(first.value.id), wolves.id), 1);

check('friendly fire does not score', wars.recordKill(memberA, leadA) === undefined);
check('killing yourself does not score', wars.recordKill(memberA, memberA) === undefined);
check('a killer with no clan does not score', wars.recordKill(outsider, memberB) === undefined);
check('a victim with no clan does not score', wars.recordKill(memberA, outsider) === undefined);
checkEqual('none of those moved the total', wars.sideTotal(wars.getWar(first.value.id), wolves.id), 1);

wars.recordKill(memberA, memberB);
wars.recordKill(leadA, memberB);
wars.recordKill(memberB, memberA);

const live = wars.getWar(first.value.id);
checkEqual('kills accumulate per member', live.sides[wolves.id].byPlayer[memberA.id].kills, 2);
checkEqual('a second member is tracked separately', live.sides[wolves.id].byPlayer[leadA.id].kills, 1);
checkEqual('the side total sums its members', wars.sideTotal(live, wolves.id), 3);
checkEqual('the other side scores on its own', wars.sideTotal(live, ravens.id), 1);
checkEqual('member names are cached for the record', live.sides[wolves.id].byPlayer[memberA.id].name, 'Kai');

// ── Corrections ───────────────────────────────────────────────────────────
check('an admin may adjust', wars.canAdjustKills(admin));
check('an ordinary player may not', !wars.canAdjustKills(outsider));

const unattributed = wars.adjustKills(first.value.id, wolves.id, 2);
checkEqual('an unattributed adjustment raises the total', unattributed.value.total, 5);
checkEqual(
  'and lands in the bucket, not on a member',
  wars.getWar(first.value.id).sides[wolves.id].adjust,
  2,
);

const attributed = wars.adjustKills(first.value.id, wolves.id, 3, memberA);
checkEqual('a named adjustment lands on that member', attributed.value.playerKills, 5);
checkEqual('and raises the side total', attributed.value.total, 8);
checkEqual(
  'while the bucket is untouched',
  wars.getWar(first.value.id).sides[wolves.id].adjust,
  2,
);

check(
  'a member of the other side cannot be credited',
  !wars.adjustKills(first.value.id, wolves.id, 1, memberB).ok,
);
check(
  'someone in no clan cannot be credited',
  !wars.adjustKills(first.value.id, wolves.id, 1, outsider).ok,
);
check('a zero adjustment is refused', !wars.adjustKills(first.value.id, wolves.id, 0).ok);

const floored = wars.adjustKills(first.value.id, wolves.id, -99, memberA);
checkEqual('a member tally floors at zero', floored.value.playerKills, 0);
checkEqual('the scoreboard follows', mock.__sidebar().getScore('Wolves'), wars.sideTotal(wars.getWar(first.value.id), wolves.id));

// ── Surrender ─────────────────────────────────────────────────────────────
check(
  'a clan outside the war cannot surrender it',
  !wars.surrender(first.value.id, 'c_nope', leadA.id).ok,
);

const surrendered = wars.surrender(first.value.id, wolves.id, leadA.id);
check('a clan may surrender', surrendered.ok);
checkEqual('the outcome is surrender', surrendered.value.outcome, 'surrender');
checkEqual('the other clan wins', surrendered.value.winner, ravens.id);
checkEqual('the surrendering clan loses', surrendered.value.loser, wolves.id);
checkEqual('it is recorded who surrendered', surrendered.value.endedBy, leadA.id);
checkEqual('the war is ended', wars.getWar(first.value.id).state, 'ended');
checkEqual('it is no longer live', wars.warsFor(wolves.id).length, 0);
check('the sidebar clears with no active war', mock.__sidebar() === undefined);
check('kills no longer score', wars.recordKill(memberA, memberB) === undefined);
check('surrendering twice is refused', !wars.surrender(first.value.id, wolves.id, leadA.id).ok);

// ── History is kept, and ordinals advance ─────────────────────────────────
checkEqual('the ended war is retained', wars.getWar(first.value.id).state, 'ended');
checkEqual('it appears in history', wars.historyFor(wolves.id).length, 1);

const second = wars.declare(wolves, ravens, leadA.id);
check('the same pair may fight again', second.ok);
checkEqual('the rematch is the 2nd war', second.value.ordinal, 2);
checkEqual('both wars are on record for the pair', wars.warsBetween(wolves.id, ravens.id).length, 2);
checkEqual('the first war still reads as the 1st', wars.getWar(first.value.id).ordinal, 1);

// ── Peace ─────────────────────────────────────────────────────────────────
wars.accept(second.value.id);
const offered = wars.offerPeace(second.value.id, wolves.id, leadA.id);
check('peace can be offered', offered.ok);
check('one offer alone does not end the war', !offered.value.agreed);
checkEqual('the war is still active', wars.getWar(second.value.id).state, 'active');
check(
  'the same side cannot accept its own offer',
  !wars.offerPeace(second.value.id, wolves.id, leadA.id).ok,
);

const agreed = wars.offerPeace(second.value.id, ravens.id, leadB.id);
check('the other side accepting ends it', agreed.value.agreed);
checkEqual('the outcome is peace', agreed.value.war.outcome, 'peace');
checkEqual('peace has no winner', agreed.value.war.winner, '');

// ── Refusing a declaration leaves no record ───────────────────────────────
const third = wars.declare(wolves, ravens, leadA.id);
checkEqual('the next war would be the 3rd', third.value.ordinal, 3);
check('a pending declaration can be refused', wars.decline(third.value.id).ok);
check('a refused declaration leaves no record', wars.getWar(third.value.id) === undefined);
checkEqual('and frees its ordinal', wars.warsBetween(wolves.id, ravens.id).length, 2);
const reDeclared = wars.declare(wolves, ravens, leadA.id);
checkEqual('so the next real war is still the 3rd', reDeclared.value.ordinal, 3);

// ── Annulment ─────────────────────────────────────────────────────────────
wars.accept(reDeclared.value.id);
check('an admin may annul', wars.canAnnul(admin));
check('an ordinary player may not', !wars.canAnnul(outsider));
const annulled = wars.annul(reDeclared.value.id, admin.id);
check('a war can be annulled', annulled.ok);
checkEqual('the outcome is annulled', annulled.value.outcome, 'annulled');
checkEqual('annulment records no winner', annulled.value.winner, '');

// ── Forfeit on disband ────────────────────────────────────────────────────
const fourth = wars.declare(wolves, ravens, leadA.id);
wars.accept(fourth.value.id);
checkEqual('a fourth war is live', wars.warsFor(wolves.id).length, 1);
clans.disband(ravens.id);
const forfeited = wars.getWar(fourth.value.id);
checkEqual('disbanding forfeits the war', forfeited.outcome, 'forfeit');
checkEqual('the surviving clan wins', forfeited.winner, wolves.id);
checkEqual('the disbanded clan loses', forfeited.loser, ravens.id);
checkEqual('no war is live afterwards', wars.warsFor(wolves.id).length, 0);
check('the record survives the clan', wars.getWar(fourth.value.id) !== undefined);
checkEqual('and still names the vanished clan', forfeited.nameB, 'Ravens');

// ── The record book ───────────────────────────────────────────────────────
checkEqual('ordinals read correctly', warbook.ordinal(1), '1st');
checkEqual('and for 2', warbook.ordinal(2), '2nd');
checkEqual('and for 3', warbook.ordinal(3), '3rd');
checkEqual('and for 4', warbook.ordinal(4), '4th');
checkEqual('and for the teens', warbook.ordinal(11), '11th');
checkEqual('and for 12', warbook.ordinal(12), '12th');
checkEqual('and for 13', warbook.ordinal(13), '13th');
checkEqual('and for 21', warbook.ordinal(21), '21st');

const record = wars.getWar(first.value.id);
checkEqual('the book title fits the 16-char cap', warbook.bookTitle(record).length <= 16, true);
checkEqual('the title carries the ordinal', warbook.bookTitle(record), 'War #1');
checkEqual('the item name carries both clans', warbook.bookName(record), 'War #1: Wolves vs Ravens');

const pages = warbook.buildPages(record);
check('the book has pages', pages.length > 0);
check('it stays within 50 pages', pages.length <= 50);
check(
  'every page stays within 256 characters',
  pages.every((page) => page.length <= 256),
);
const text = pages.join('\n');
check('page one names the war', text.includes('1st War'));
check('the winner is recorded', text.includes('Winner: Ravens'));
check('and how it was won', text.includes('surrendered'));
check('both clans are listed', text.includes('Wolves') && text.includes('Ravens'));
check('members appear with their kills', text.includes('Kai'));
check('an unattributed adjustment is labelled', text.includes('Adjustment'));

// A war nobody corrected mentions no adjustment at all.
const cleanPages = warbook.buildPages(wars.getWar(fourth.value.id)).join('\n');
check('an uncorrected war never mentions adjustments', !cleanPages.includes('Adjustment'));

const built = warbook.buildBook(record, 'Steve');
checkEqual('the book is a book item', built.typeId, 'minecraft:writable_book');
checkEqual('it is signed', built.getComponent('minecraft:book').isSigned, true);
checkEqual('with the short title', built.getComponent('minecraft:book').title, 'War #1');
checkEqual('and the author', built.getComponent('minecraft:book').author, 'Steve');
checkEqual('the item name is the long form', built.nameTag, 'War #1: Wolves vs Ravens');
// The stamp is a line of lore, not a dynamic property: signing makes the book
// stackable and the engine refuses dynamic properties on stackable items.
check('the war id is stamped in the lore', built.getLore().some((l) => l.includes(record.id)));
check('and the stamp round-trips back to the war', warbook.warOfBook(built)?.id === record.id);
check('a plain book is not mistaken for a record', warbook.warOfBook(new mock.ItemStack('minecraft:writable_book', 1)) === undefined);

const given = warbook.givePlayerBook(leadA, record);
check('the book reaches the player', given.ok);
checkEqual('it is in their inventory', leadA.container.items.length, 1);

const unfinished = wars.declare(wolves, clans.createClan(outsider.id, outsider.name, 'Falcons').value, leadA.id);
check(
  'an unfinished war cannot be printed',
  unfinished.ok === false || !warbook.givePlayerBook(leadA, unfinished.value).ok,
);

// ── A roster too big for one page ─────────────────────────────────────────
// The case that matters: a clan with more members than a page holds must
// spill onto a continuation page that still says whose roster it is, and must
// not drop anybody on the way.
const horde = Array.from({ length: 40 }, (_, i) => new mock.Player(`h${i}`, `Fighter${i + 1}`));
mock.__setPlayers([...roster, ...horde]);
for (const p of horde) playersMod.register(p);

// A long clan name, so the heading wraps and costs two lines.
const bigA = fullClan(horde[0], 'Northern Legion', horde.slice(1, 20));
const bigB = fullClan(horde[20], 'Southern Host', horde.slice(21, 40));
const bigWar = wars.declare(bigA, bigB, horde[0].id).value;
wars.accept(bigWar.id);

for (let i = 0; i < 20; i++) {
  for (let k = 0; k <= i % 5; k++) wars.recordKill(horde[i], horde[20 + i]);
}
wars.adjustKills(bigWar.id, bigA.id, 3);
wars.surrender(bigWar.id, bigB.id, horde[20].id);

const bigRecord = wars.getWar(bigWar.id);
const bigPages = warbook.buildPages(bigRecord);

check(
  'a large roster still fits within 50 pages',
  bigPages.length <= 50 && bigPages.length > 4,
);
check(
  'every page of a large record stays within 256 characters',
  bigPages.every((page) => page.length <= 256),
);

// No page may exceed the rendered line budget, counting wrapped lines.
const renderedLines = (page) =>
  page.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 19)), 0);
check(
  'no page exceeds the 14-line rendered budget',
  bigPages.every((page) => renderedLines(page) <= 14),
);

const rosterPages = bigPages.filter((page) => page.startsWith('Northern Legion'));
check('the big roster spans more than one page', rosterPages.length > 1);
check(
  'every continuation page repeats the heading',
  rosterPages.slice(1).every((page) => page.startsWith('Northern Legion') && page.includes('(cont.)')),
);
check('only the first roster page omits "cont."', !rosterPages[0].includes('(cont.)'));

const bigText = bigPages.join('\n');
for (let i = 0; i < 20; i++) {
  if (!bigText.includes(`Fighter${i + 1} `)) {
    check(`Fighter${i + 1} appears in the record`, false);
    break;
  }
}
check(
  'every scoring member appears exactly once',
  Array.from({ length: 20 }, (_, i) => `Fighter${i + 1}`).every(
    (name) => bigText.split(new RegExp(`\\b${name}\\b`)).length === 2,
  ),
);
check('the adjustment survives the split', bigText.includes('Adjustment'));

// ── An unanswered declaration is discarded, not forfeited ────────────────
// It was never a war, so it must not end with a winner. Disbanding a clan used
// to record a forfeit for a declaration nobody had answered.
const owlLead = new mock.Player('x1', 'Perch');
const owlMate = new mock.Player('x2', 'Talon');
const hawkLead = new mock.Player('x3', 'Stoop');
const hawkMate = new mock.Player('x4', 'Quill');
const aviary = [owlLead, owlMate, hawkLead, hawkMate];
mock.__setPlayers([...roster, ...aviary]);
for (const bird of aviary) playersMod.register(bird);

const owls = fullClan(owlLead, 'Owls', [owlMate]);
const hawks = fullClan(hawkLead, 'Hawks', [hawkMate]);

const unanswered = wars.declare(owls, hawks, owlLead.id);
checkEqual('the declaration is pending', unanswered.value.state, 'pending');
const ordinalBefore = unanswered.value.ordinal;

mock.__clearBroadcasts();
clans.disband(hawks.id);

check('an unanswered declaration leaves no record', wars.getWar(unanswered.value.id) === undefined);
checkEqual('it is no longer live', wars.warsFor(owls.id).length, 0);
check(
  'and nothing is announced about a war that never happened',
  mock.__broadcasts().every((line) => !line.includes('forfeit')),
);

// The ordinal it reserved is freed, exactly as a refusal frees one.
const hawksAgain = fullClan(hawkLead, 'Hawks', [hawkMate]);
const redeclared = wars.declare(clans.getClan(owls.id), hawksAgain, owlLead.id);
checkEqual('the ordinal it reserved is freed', redeclared.value.ordinal, ordinalBefore);

// An accepted war, by contrast, does forfeit when a side disbands.
wars.accept(redeclared.value.id);
clans.disband(hawksAgain.id);
const birdWar = wars.getWar(redeclared.value.id);
checkEqual('an accepted war still forfeits', birdWar.outcome, 'forfeit');
checkEqual('and names the surviving winner', birdWar.winner, owls.id);

clans.disband(owls.id);
mock.__setPlayers(roster);

// ── A record written before per-member tallies existed ────────────────────
// Those wars carry a flat `kills` map and no `sides`. Their totals are real
// counts with nobody behind them, so they read back as adjustments.
const legacyId = 'w_legacy01';
mock.world.setDynamicProperty(
  'clan:war:' + legacyId,
  JSON.stringify({
    id: legacyId,
    clanA: wolves.id,
    clanB: ravens.id,
    state: 'ended',
    declaredBy: leadA.id,
    declaredAt: 1,
    startedAt: 2,
    endedAt: 3,
    kills: { [wolves.id]: 7, [ravens.id]: 4 },
  }),
);

const legacy = wars.getWar(legacyId);
check('a legacy record still loads', legacy !== undefined);
checkEqual('its ordinal defaults to the 1st', legacy.ordinal, 1);
checkEqual('its outcome is empty', legacy.outcome, '');
checkEqual('old totals become adjustments', legacy.sides[wolves.id].adjust, 7);
checkEqual('for both sides', legacy.sides[ravens.id].adjust, 4);
checkEqual('and read back as the side total', wars.sideTotal(legacy, wolves.id), 7);
check('with no members attributed', Object.keys(legacy.sides[wolves.id].byPlayer).length === 0);
checkEqual('missing clan names are filled in', legacy.nameA, 'Wolves');

const legacyPages = warbook.buildPages(legacy).join(String.fromCharCode(10));
check('a legacy record still prints', legacyPages.includes('Adjustment'));

// ── A record too large to print in full ───────────────────────────────────
// Synthesised rather than played out: what matters is that the cap is honoured
// and the omission is stated, not how the war was fought.
const hugeId = 'w_huge0001';
const hugeSide = { adjust: 0, byPlayer: {} };
for (let i = 0; i < 900; i += 1) {
  hugeSide.byPlayer['h' + i] = { name: 'Fighter' + i, kills: (i % 9) + 1 };
}
mock.world.setDynamicProperty(
  'clan:war:' + hugeId,
  JSON.stringify({
    id: hugeId,
    ordinal: 9,
    clanA: wolves.id,
    clanB: ravens.id,
    nameA: 'Wolves',
    nameB: 'Ravens',
    state: 'ended',
    outcome: 'peace',
    winner: '',
    loser: '',
    endedBy: '',
    peaceOfferedBy: '',
    declaredBy: leadA.id,
    declaredAt: 1,
    startedAt: 2,
    endedAt: 3,
    sides: { [wolves.id]: hugeSide, [ravens.id]: { adjust: 0, byPlayer: {} } },
  }),
);

const hugePages = warbook.buildPages(wars.getWar(hugeId));
checkEqual('an oversized record is capped at 50 pages', hugePages.length, 50);
check(
  'every page of it still fits the character cap',
  hugePages.every((page) => page.length <= 256),
);
check('and the omission is stated', hugePages[hugePages.length - 1].includes('omitted'));

// ── Permission to print ───────────────────────────────────────────────────
check('an admin may print any clan record', wars.canGenerateWarBooks(admin));
staff.assignRole(memberA.id, 'mod');
check('a Mod may by default', wars.canGenerateWarBooks(memberA));
staff.updateRole('mod', { generateWarBooks: false });
check('an admin can revoke it from the role', !wars.canGenerateWarBooks(memberA));
check('and the role keeps its other powers', wars.canAdjustKills(memberA));
staff.updateRole('mod', { generateWarBooks: true });
check('an ordinary player may not', !wars.canGenerateWarBooks(outsider));

finish();
