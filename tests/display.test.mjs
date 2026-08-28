/**
 * Exercises how a player's identity is rendered.
 *
 * Ordering is asserted explicitly rather than inferred from the parts being
 * present, because the requirements are specific about it: the system title
 * comes first in both surfaces, and Peaceful sits after every other title but
 * still before the name.
 */

import { prepare, load, check, checkEqual, plain, finish } from './harness.mjs';

prepare([
  'config.js',
  'format.js',
  'text.js',
  'brackets.js',
  'storage.js',
  'players.js',
  'settings.js',
  'staff.js',
  'peaceful.js',
  'clans.js',
  'hooks.js',
  'display.js',
]);

const mock = await load('mock-server.js');
const format = await load('format.js');
const storage = await load('storage.js');
const playersMod = await load('players.js');
const settings = await load('settings.js');
const staff = await load('staff.js');
const peaceful = await load('peaceful.js');
const clans = await load('clans.js');
const display = await load('display.js');

const admin = new mock.Player('a1', 'Steve', true);
const member = new mock.Player('a2', 'Alex');
const plainPlayer = new mock.Player('a3', 'Zoe');
mock.__setPlayers([admin, member, plainPlayer]);

storage.initSchema();
staff.ensureDefaults();
for (const player of [admin, member, plainPlayer]) playersMod.register(player);

// ── Defaults ──────────────────────────────────────────────────────────────
const defaults = settings.get().display;
check('the clan role is hidden on nametags by default', defaults.nametag.showClanRole === false);
checkEqual('the role sits before the clan by default', defaults.nametag.rolePosition, 'before');
checkEqual('clan brackets are off by default', defaults.nametag.clanBrackets, 'off');
checkEqual('role brackets are square by default', defaults.nametag.roleBrackets, 'square');
check('the clan role shows in chat by default', defaults.chat.showClanRole === true);
checkEqual('the poll defaults to 20 seconds', settings.get().opPollSeconds, 20);
checkEqual('that is 400 ticks', settings.opPollIntervalTicks(), 400);

// ── Nothing to show ───────────────────────────────────────────────────────
checkEqual('a plain player has no chat prefix', plain(display.chatPrefixFor(plainPlayer)), '');
display.refresh(plainPlayer);
checkEqual('a plain player nametag is just their name', plain(plainPlayer.nameTag), 'Zoe');

// ── The Admin title ───────────────────────────────────────────────────────
checkEqual('an admin shows the symbol alone by default', plain(display.chatPrefixFor(admin)), '✦ ');
display.refresh(admin);
checkEqual('the admin title precedes the name on the nametag', plain(admin.nameTag), '✦ Steve');

settings.update({ display: { admin: { showAs: 'name' } } });
checkEqual('the title can show the name instead', plain(display.chatPrefixFor(admin)), 'Admin ');
settings.update({ display: { admin: { showAs: 'both' } } });
checkEqual('or both', plain(display.chatPrefixFor(admin)), '✦ Admin ');
settings.update({ display: { admin: { symbol: '★', showAs: 'symbol' } } });
checkEqual('the admin symbol is a setting', plain(display.chatPrefixFor(admin)), '★ ');
settings.update({ display: { admin: { symbol: '✦' } } });

// ── Clan and role on the nametag ──────────────────────────────────────────
const wolves = clans.createClan(admin.id, admin.name, 'Wolves').value;
display.refresh(admin);
checkEqual('the clan sits on the second line, unbracketed', plain(admin.nameTag), '✦ Steve\nWolves');

settings.update({ display: { nametag: { showClanRole: true } } });
display.refresh(admin);
checkEqual('the role appears before the clan, in square brackets', plain(admin.nameTag), '✦ Steve\n[Leader] Wolves');

settings.update({ display: { nametag: { rolePosition: 'after' } } });
display.refresh(admin);
checkEqual('the role can be moved after the clan', plain(admin.nameTag), '✦ Steve\nWolves [Leader]');

settings.update({ display: { nametag: { clanBrackets: 'angled', roleBrackets: 'curly' } } });
display.refresh(admin);
checkEqual('both bracket styles apply', plain(admin.nameTag), '✦ Steve\n<Wolves> {Leader}');

settings.update({ display: { nametag: { clanBrackets: 'bar', roleBrackets: 'star' } } });
display.refresh(admin);
checkEqual('bar and star styles apply', plain(admin.nameTag), '✦ Steve\n|Wolves| *Leader*');

settings.update({ display: { nametag: { clanBrackets: 'dash', roleBrackets: 'off' } } });
display.refresh(admin);
checkEqual('dash and no-bracket styles apply', plain(admin.nameTag), '✦ Steve\n-Wolves- Leader');

settings.update({
  display: {
    nametag: { showClanRole: false, rolePosition: 'before', clanBrackets: 'off', roleBrackets: 'square' },
  },
});

// ── The clan role in chat ─────────────────────────────────────────────────
checkEqual('chat shows the clan role by default', plain(display.chatPrefixFor(admin)), '✦ [Wolves|Leader] ');
settings.update({ display: { chat: { showClanRole: false } } });
checkEqual('the clan role can be hidden in chat', plain(display.chatPrefixFor(admin)), '✦ [Wolves] ');
settings.update({ display: { chat: { showClanRole: true } } });

// ── Staff roles ───────────────────────────────────────────────────────────
clans.addMember(wolves.id, member.id, member.name);
staff.assignRole(member.id, 'mod');
checkEqual('a staff role shows its name by default', plain(display.chatPrefixFor(member)), 'Mod [Wolves] ');
staff.updateRole('mod', { showAs: 'symbol' });
checkEqual('a staff role can show its symbol', plain(display.chatPrefixFor(member)), '⚔ [Wolves] ');
staff.updateRole('mod', { symbol: '§', showAs: 'both' });
staff.updateRole('mod', { symbol: 'M', showAs: 'both' });
checkEqual('a staff role can show both', plain(display.chatPrefixFor(member)), 'M Mod [Wolves] ');
staff.updateRole('mod', { showAs: 'name' });

display.refresh(member);
checkEqual('the staff title also shows on the nametag', plain(member.nameTag), 'Mod Alex\nWolves');

// Admin outranks a staff role when a player holds both.
staff.assignRole(admin.id, 'mod');
checkEqual('admin wins over a staff role', plain(display.chatPrefixFor(admin)), '✦ [Wolves|Leader] ');

// ── Peaceful ──────────────────────────────────────────────────────────────
check('nobody is Peaceful to begin with', !peaceful.isPeaceful(member.id));
peaceful.set(member.id, true);
check('Peaceful can be granted', peaceful.isPeaceful(member.id));
checkEqual(
  'Peaceful sits after every other title but before the name in chat',
  plain(display.chatPrefixFor(member)),
  'Mod [Wolves] ☮ ',
);
display.refresh(member);
checkEqual('Peaceful sits before the name on the nametag', plain(member.nameTag), 'Mod ☮ Alex\nWolves');

// It stacks with Admin.
peaceful.set(admin.id, true);
checkEqual(
  'Peaceful stacks with Admin',
  plain(display.chatPrefixFor(admin)),
  '✦ [Wolves|Leader] ☮ ',
);

// Visibility.
settings.update({ display: { peaceful: { visibility: 'chat' } } });
display.refresh(member);
checkEqual('Peaceful can be hidden from the nametag', plain(member.nameTag), 'Mod Alex\nWolves');
check('but still shows in chat', plain(display.chatPrefixFor(member)).includes('☮'));

settings.update({ display: { peaceful: { visibility: 'nametag' } } });
check('and the other way round', !plain(display.chatPrefixFor(member)).includes('☮'));

settings.update({ display: { peaceful: { visibility: 'none' } } });
display.refresh(member);
check('or hidden entirely', !plain(member.nameTag).includes('☮'));
settings.update({ display: { peaceful: { visibility: 'both' } } });

// Order is configurable.
settings.update({ display: { chat: { peacefulOrder: 0, systemOrder: 20 } } });
checkEqual(
  'the Peaceful marker can be moved to the front',
  plain(display.chatPrefixFor(member)),
  '☮ [Wolves] Mod ',
);
settings.update({ display: { chat: { peacefulOrder: 20, systemOrder: 0 } } });

// Who may assign it.
check('an admin may assign Peaceful', peaceful.canAssign(admin));
staff.assignRole(plainPlayer.id, 'helper');
check('a role without clan management may not', !peaceful.canAssign(plainPlayer));
check('a clan-managing role may by default', peaceful.canAssign(member));
settings.update({ staffCanAssignPeaceful: false });
check('an admin can revoke that', !peaceful.canAssign(member));
settings.update({ staffCanAssignPeaceful: true });
staff.assignRole(plainPlayer.id, undefined);

// ── Colours are settings, and the tier picks which one applies ────────────
check('the clan is still an outpost', clans.isOutpost(clans.getClan(wolves.id)));
check('an outpost uses the outpost colour', display.chatPrefixFor(member).includes('§5Wolves'));

settings.update({ display: { colors: { outpost: '§8' } } });
check('the outpost colour is a setting', display.chatPrefixFor(member).includes('§8Wolves'));

clans.promote(wolves.id);
check('a promoted clan uses the clan colour', display.chatPrefixFor(member).includes('§aWolves'));
settings.update({ display: { colors: { clan: '§d' } } });
check('the clan colour is a setting', display.chatPrefixFor(member).includes('§dWolves'));

// ── A clan's own colour overrides the default, for every member ───────────
clans.setColor(wolves.id, '§6');
check('a clan colour overrides the default', display.chatPrefixFor(member).includes('§6Wolves'));
settings.update({ display: { colors: { clan: '§b' } } });
check(
  'and keeps overriding it after the default changes',
  display.chatPrefixFor(member).includes('§6Wolves'),
);
check('a colour outside the palette is refused', !clans.setColor(wolves.id, '§z').ok);
check(
  'and the clan keeps the colour it had',
  display.chatPrefixFor(member).includes('§6Wolves'),
);
clans.setColor(wolves.id, '');
check(
  'clearing it returns the clan to the default',
  display.chatPrefixFor(member).includes('§bWolves'),
);
settings.update({ display: { colors: { clan: '§b', outpost: '§7' } } });

// ── The name has a position, so a tag can sit after it ────────────────────
checkEqual('nothing follows the name by default', plain(display.chatSuffixFor(member)), '');
check('and the clan tag is in front of it', plain(display.chatPrefixFor(member)).includes('[Wolves]'));

// Ordering the name before the clan tag moves the tag to the other side of it.
settings.update({ display: { chat: { nameOrder: 5 } } });
check('the clan tag can be moved past the name', plain(display.chatSuffixFor(member)).includes('[Wolves]'));
check('and is gone from in front of it', !plain(display.chatPrefixFor(member)).includes('[Wolves]'));
const reordered = plain(display.identityLine(member));
check(
  'the identity line keeps the system title in front',
  reordered.indexOf('Mod') < reordered.indexOf('Alex'),
);
check('and puts the clan tag after the name', reordered.indexOf('[Wolves]') > reordered.indexOf('Alex'));

settings.update({ display: { chat: { nameOrder: 30 } } });
checkEqual('and moving the name back restores it', plain(display.chatSuffixFor(member)), '');
check('with the tag in front again', plain(display.chatPrefixFor(member)).includes('[Wolves]'));

// ── Op changes are picked up by polling ───────────────────────────────────
peaceful.set(admin.id, false);
staff.assignRole(admin.id, undefined);
display.refresh(admin);
admin.playerPermissionLevel = mock.PlayerPermissionLevel.Member;
display.pollAdminChanges();
checkEqual('de-opping drops the admin title', plain(admin.chatNamePrefix), '[Wolves|Leader] ');
admin.playerPermissionLevel = mock.PlayerPermissionLevel.Operator;
display.pollAdminChanges();
checkEqual('re-opping restores it', plain(admin.chatNamePrefix), '✦ [Wolves|Leader] ');

checkEqual('the property strategy was detected', display.chatStatus(), 'chat tags active (Player.chatNamePrefix)');

// ── Leaving reverts the display ───────────────────────────────────────────
peaceful.set(member.id, false);
staff.assignRole(member.id, undefined);
clans.removeMember(wolves.id, member.id);
checkEqual('the nametag reverts when a member leaves', plain(member.nameTag), 'Alex');
checkEqual('and so does the chat prefix', plain(member.chatNamePrefix), 'undefined');

// ── Button labels are re-coloured for the panel they sit on ───────────────
//
// Gray is the button's own colour, so a subtitle drawn in it is invisible; the
// bright half of the palette washes out on it. Both are mapped into the dark
// half, and nothing that was already dark is touched.
checkEqual('gray becomes dark gray on a button', format.buttonText('§7detail'), '§8detail');
checkEqual('white becomes black', format.buttonText('§fName'), '§0Name');
checkEqual('aqua becomes dark aqua', format.buttonText('§bWolves'), '§3Wolves');
checkEqual('red becomes dark red', format.buttonText('§cDisband'), '§4Disband');
checkEqual('a colour that was already dark is left alone', format.buttonText('§8x§4y'), '§8x§4y');
checkEqual(
  'every code in a multi-line label is mapped',
  format.buttonText('§bWolves\n§74 members'),
  '§3Wolves\n§84 members',
);
checkEqual('an uncoloured label is unchanged', format.buttonText('Back'), 'Back');

// ── Labels are broken to fit the panel ────────────────────────────────────
//
// The sentence that overflowed is the one asserted here. Width is counted in
// visible characters, so a coloured label is not punished for its codes.
const overflow = 'Lower numbers are drawn first, before the player name.';
const wrapped = format.wrapText(overflow);
check('an over-long label is broken', wrapped.includes('\n'));
check(
  'and every line fits the width',
  wrapped.split('\n').every((line) => plain(line).length <= 34),
);
checkEqual('the words survive the break', plain(wrapped).replace(/\n/g, ' '), overflow);
checkEqual('a short label is left on one line', format.wrapText('Colour'), 'Colour');
checkEqual(
  'formatting codes do not count towards the width',
  format.wrapText('§7' + 'a'.repeat(34)),
  '§7' + 'a'.repeat(34),
);
check(
  'the colour in force carries onto the next line',
  format.wrapText('§7' + 'word '.repeat(10), 20).split('\n')[1].startsWith('§7'),
);
checkEqual(
  'a caller\u2019s own line breaks are kept',
  format.wrapText('one\ntwo'),
  'one\ntwo',
);

finish();
