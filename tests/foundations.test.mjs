/**
 * The layers everything else is built on: the validators that guard every name
 * a player can type, the storage the whole pack persists through, the clan and
 * war mutators that write rather than draw, and the two places a wrong answer
 * would be silent — the form resolver's fallback and the settings cache.
 *
 * These were the largest gap in the suite. The menus and the war lifecycle were
 * covered thoroughly while the functions underneath them had never been called
 * from a test, which is the wrong way round: a regression here loses data,
 * where a regression in a menu misdraws a button.
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
  'peaceful.js',
  'clans.js',
  'wars.js',
  'announce.js',
  'forms.js',
  'ledger.js',
]);

const mock = await load('mock-server.js');
const mockUi = await load('mock-server-ui.js');
const format = await load('format.js');
const storage = await load('storage.js');
const settings = await load('settings.js');
const staff = await load('staff.js');
const peaceful = await load('peaceful.js');
const playersMod = await load('players.js');
const clans = await load('clans.js');
const wars = await load('wars.js');
const ledger = await load('ledger.js');
const hooks = await load('hooks.js');
const forms = await load('forms.js');
const { LIMITS } = await load('config.js');

const plain = (text) => String(text).replace(/§./g, '');

// ── format.js: the validators every typed name passes through ────────────

checkEqual('sanitize strips formatting codes', format.sanitize('§cRed§r'), 'Red');
checkEqual('sanitize trims the ends', format.sanitize('  a   b  '), 'a   b');
checkEqual('sanitize drops control characters', format.sanitize('ab'), 'ab');

check('a plain clan name validates', format.validateClanName('Wardens').ok);
check('a blank clan name does not', !format.validateClanName('   ').ok);
check('a one-character clan name does not', !format.validateClanName('W').ok);
check(
  'an over-long clan name does not',
  !format.validateClanName('W'.repeat(LIMITS.maxClanNameLength + 1)).ok,
);
checkEqual(
  'a validated name comes back sanitised',
  format.validateClanName('  §aWardens  ').value,
  'Wardens',
);

check('a plain role name validates', format.validateRoleName('Scout').ok);
check('a blank role name does not', !format.validateRoleName('').ok);

check('a single-glyph staff symbol validates', format.validateStaffSymbol('★').ok);
check('an empty staff symbol does not', !format.validateStaffSymbol('').ok);
check(
  'a staff symbol past the limit does not',
  !format.validateStaffSymbol('★'.repeat(LIMITS.staffSymbolMax + 1)).ok,
);

checkEqual('truncate leaves a short string alone', format.truncate('Wardens', 20), 'Wardens');
checkEqual('truncate shortens a long one', format.truncate('Wardens', 4).length, 4);
check('truncate marks what it cut', format.truncate('Wardensmith', 6).endsWith('…'));

checkEqual(
  'wrapText breaks on a space rather than mid-word',
  format.wrapText('aaa bbb ccc', 7).split(String.fromCharCode(10))[0],
  'aaa bbb',
);
check(
  'wrapText leaves a string shorter than the width alone',
  !format.wrapText('short', 30).includes(String.fromCharCode(10)),
);

checkEqual('slugify lowercases and joins', format.slugify('Head Moderator'), 'head_moderator');
checkEqual('and falls back rather than return nothing', format.slugify('!!!'), 'role');
checkEqual(
  'normalizeKey ignores case and surrounding space',
  format.normalizeKey('  The Wardens  '),
  format.normalizeKey('the wardens'),
);

// ── storage.js: the property store everything persists through ───────────

storage.setString('sigil:test:a', 'one');
checkEqual('a string round-trips', storage.getString('sigil:test:a'), 'one');
storage.remove('sigil:test:a');
checkEqual('and is gone once removed', storage.getString('sigil:test:a'), undefined);

storage.setString('sigil:pfx:x', '1');
storage.setString('sigil:pfx:y', '1');
storage.setString('sigil:other:z', '1');
const ids = storage.idsWithPrefix('sigil:pfx:').sort();
checkEqual('idsWithPrefix finds both matching ids', ids.join(','), 'sigil:pfx:x,sigil:pfx:y');
check('and nothing under another prefix', !ids.some((id) => id.endsWith(':z')));

check(
  'setJsonGuarded writes a record inside the limit',
  storage.setJsonGuarded('sigil:test:small', { a: 1 }),
);
check(
  'and refuses one past it',
  !storage.setJsonGuarded('sigil:test:big', { a: 'x'.repeat(LIMITS.maxRecordBytes) }),
);
checkEqual(
  'leaving nothing written for the refusal',
  storage.getString('sigil:test:big'),
  undefined,
);

// A write that changes what a player renders as announces itself, which is the
// whole reason `setRendered` exists rather than a bare `setString`.
let signalled = [];
hooks.onIdentityChanged((id) => signalled.push(id));

signalled = [];
storage.setRendered('r1', 'sigil:test:rendered', 'v');
checkEqual('setRendered announces the player it wrote for', signalled.join(','), 'r1');
signalled = [];
storage.setRendered('r1', 'sigil:test:rendered', undefined);
checkEqual('removing through it announces too', signalled.join(','), 'r1');
checkEqual('and the property is gone', storage.getString('sigil:test:rendered'), undefined);

signalled = [];
storage.refreshRendered(['r1', 'r2']);
checkEqual('refreshRendered announces every id given', signalled.join(','), 'r1,r2');

// The mutators that were forgetting to signal before this existed.
signalled = [];
peaceful.set('r3', true);
check('marking a player Peaceful announces it', signalled.includes('r3'));
check('and the marker is stored', peaceful.isPeaceful('r3'));
signalled = [];
peaceful.set('r3', false);
check('clearing it announces too', signalled.includes('r3'));
check('and the marker is gone', !peaceful.isPeaceful('r3'));

// ── settings.js: the cache the renderer reads on every refresh ───────────

settings.update({ outpostPromotionMembers: 3 });
checkEqual('a setting reads back', settings.get().outpostPromotionMembers, 3);
storage.setJson('clan:settings', { ...settings.get(), outpostPromotionMembers: 9 });
checkEqual(
  'a write behind the cache is not seen while it stands',
  settings.get().outpostPromotionMembers,
  3,
);
settings.invalidate();
checkEqual('invalidate makes the next read reach storage', settings.get().outpostPromotionMembers, 9);
settings.update({ outpostPromotionMembers: 3 });

// ── clans.js: the mutators that write ────────────────────────────────────

const chief = new mock.Player('f1', 'Chief', true);
const hand = new mock.Player('f2', 'Hand');
playersMod.register(chief);
playersMod.register(hand);

const guild = clans.createClan(chief.id, chief.name, 'Guilders').value;
clans.addMember(guild.id, hand.id, hand.name);

check('a clan renames', clans.rename(guild.id, 'Guildmasters').ok);
checkEqual('and reads back under the new name', clans.getClan(guild.id).name, 'Guildmasters');
check('a rename to an invalid name is refused', !clans.rename(guild.id, ' ').ok);
check('a rename of a clan that is gone is refused', !clans.rename('no-such-clan', 'Anything').ok);

clans.setMemberRole(guild.id, hand.id, 'Scout');
checkEqual('a clan role is recorded', clans.roleOf(clans.getClan(guild.id), hand.id), 'Scout');
check('deleting that role succeeds', clans.deleteClanRole(guild.id, 'Scout').ok);
checkEqual(
  'and clears it from everyone holding it',
  clans.roleOf(clans.getClan(guild.id), hand.id),
  '',
);
check('deleting the Leader role is refused', !clans.deleteClanRole(guild.id, 'Leader').ok);

clans.refreshMemberName(hand.id, 'Handy');
checkEqual(
  'a renamed player is picked up on the roster',
  clans.getClan(guild.id).members[hand.id].name,
  'Handy',
);
clans.refreshMemberName('nobody', 'Ghost');
checkEqual(
  'and a player in no clan is left alone',
  clans.getClan(guild.id).members[hand.id].name,
  'Handy',
);

check('mayManage is true for the Leader', clans.mayManage(chief, clans.getClan(guild.id)));
check('and false for an ordinary member', !clans.mayManage(hand, clans.getClan(guild.id)));

// ── wars.js: withdrawal, forfeiture and the scoreboard projection ────────

const rivalLead = new mock.Player('f3', 'Rival');
playersMod.register(rivalLead);
const rivals = clans.createClan(rivalLead.id, rivalLead.name, 'Rivalry').value;
for (const [i, id] of ['f4', 'f5'].entries()) {
  const p = new mock.Player(id, 'Rival' + i);
  playersMod.register(p);
  clans.addMember(rivals.id, p.id, p.name);
}
const third = new mock.Player('f6', 'Third');
playersMod.register(third);
const thirds = clans.createClan(third.id, third.name, 'Thirders').value;
clans.addMember(thirds.id, 'f7', 'Thirder1');
clans.addMember(thirds.id, 'f8', 'Thirder2');

clans.promote(guild.id);
clans.promote(rivals.id);
clans.promote(thirds.id);
clans.addMember(guild.id, 'f9', 'Guilder2');

// `declare` takes the clans themselves; everything after it takes ids.
const declared = wars.declare(clans.getClan(guild.id), clans.getClan(rivals.id), chief.id);
const pending = declared.value;
check('a declaration can be withdrawn by the clan that made it', wars.withdrawDeclaration(pending.id, guild.id).ok);
check('and is gone afterwards', wars.getWar(pending.id) === undefined);

const second = wars.declare(clans.getClan(guild.id), clans.getClan(rivals.id), chief.id).value;
check(
  'the target cannot withdraw the declaration',
  !wars.withdrawDeclaration(second.id, rivals.id).ok,
);
wars.accept(second.id);
check(
  'an accepted war cannot be withdrawn as a declaration',
  !wars.withdrawDeclaration(second.id, guild.id).ok,
);

wars.offerPeace(second.id, guild.id, chief.id);
check(
  'a peace offer can be withdrawn by the side that made it',
  wars.withdrawPeace(second.id, guild.id).ok,
);
check('but not when there is no offer standing', !wars.withdrawPeace(second.id, guild.id).ok);

const announced = [];
const originalSay = mock.world.sendMessage;
mock.world.sendMessage = (text) => announced.push(plain(text));

const forfeited = wars.forfeitAllFor(guild.id);
checkEqual('disbanding a clan forfeits its live wars', forfeited.length, 1);
checkEqual('and the war is over', wars.getWar(second.id).state, 'ended');
check(
  'with the surviving clan named in the announcement',
  announced.some((line) => line.includes('Rivalry')),
);

mock.world.sendMessage = originalSay;

check('syncScoreboard runs against the stored wars', wars.syncScoreboard() === undefined);

// ── announce.js: what the announcements actually say ─────────────────────

const said = [];
mock.world.sendMessage = (text) => said.push(plain(text));

const announce = await load('announce.js');
announce.clanCreated('Guildmasters', 'Chief');
check('a creation names the clan and its founder', said.some((l) => l.includes('Guildmasters') && l.includes('Chief')));

said.length = 0;
announce.memberLeft('Guildmasters', 'Handy', false);
check('leaving reads as leaving', said.some((l) => l.includes('Handy') && l.includes('left')));

said.length = 0;
announce.memberLeft('Guildmasters', 'Handy', true);
check('being removed does not', said.some((l) => l.includes('Handy') && !l.includes('left')));

said.length = 0;
announce.warDeclared('Guildmasters', 'Rivalry', true);
check(
  'a declaration awaiting an answer says so',
  said.some((l) => l.includes('Guildmasters') && l.includes('Rivalry')),
);

said.length = 0;
settings.update({ notifications: { enabled: false } });
announce.clanCreated('Guildmasters', 'Chief');
checkEqual('nothing is announced with notifications off', said.length, 0);
settings.update({ notifications: { enabled: true } });

mock.world.sendMessage = originalSay;

// ── forms.js: the resolver's fallback when neither convention fits ───────

const viewer = new mock.Player('f10', 'Viewer');

mockUi.__setSlotMode('all-slots');
mockUi.__answer({ name: 'Typed', flag: true });
const allSlots = await forms
  .modal('T')
  .label('a label')
  .textField('name', 'Name', '')
  .divider()
  .toggle('flag', 'Flag', false)
  .show(viewer);
checkEqual('non-inputs taking a slot resolves by position', allSlots.str('name'), 'Typed');
checkEqual('and the toggle beside it', allSlots.bool('flag'), true);

mockUi.__setSlotMode('inputs-only');
mockUi.__answer({ name: 'Typed', flag: true });
const inputsOnly = await forms
  .modal('T')
  .label('a label')
  .textField('name', 'Name', '')
  .divider()
  .toggle('flag', 'Flag', false)
  .show(viewer);
checkEqual('inputs-only resolves the same way', inputsOnly.str('name'), 'Typed');
checkEqual('and the toggle again', inputsOnly.bool('flag'), true);

const warned = [];
const originalWarn = console.warn;
console.warn = (text) => warned.push(String(text));

mockUi.__setSlotMode('mismatched');
mockUi.__answer({ name: 'Typed', flag: true });
const mismatched = await forms
  .modal('T')
  .label('a label')
  .textField('name', 'Name', '')
  .divider()
  .toggle('flag', 'Flag', false)
  .show(viewer);

console.warn = originalWarn;
mockUi.__setSlotMode('all-slots');

check(
  'a count matching neither convention is reported',
  warned.some((line) => line.includes('unexpected form response')),
);
checkEqual('and the inputs still map in order', mismatched.str('name'), 'Typed');
checkEqual('with the unanswered one falling back', mismatched.bool('flag'), false);

// ── The two items can be switched off ─────────────────────────────────────
// Both default on. With the Ledger off a joining player is neither issued one
// nor marked as issued, so turning it back on still reaches them.
check('the Ledger defaults on', settings.ledgerEnabled() === true);
check('the War Map defaults on', settings.warMapEnabled() === true);

const newcomer = new mock.Player('ledger-1', 'Newcomer');
settings.update({ ledgerEnabled: false });
ledger.ensure(newcomer);
checkEqual('no Ledger is issued while it is off', newcomer.container.items.length, 0);
settings.update({ ledgerEnabled: true });
ledger.ensure(newcomer);
checkEqual('one is issued once it is back on', newcomer.container.items.length, 1);
ledger.ensure(newcomer);
checkEqual('and only once', newcomer.container.items.length, 1);

finish();
