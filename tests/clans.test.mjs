/**
 * Exercises the clan lifecycle: permissions, creation, consent-based joining,
 * roles, leadership transfer, removal and disbanding.
 */

import { prepare, load, check, checkEqual, finish } from './harness.mjs';

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
  'hooks.js',
]);

const mock = await load('mock-server.js');
const storage = await load('storage.js');
const playersMod = await load('players.js');
const staff = await load('staff.js');
const clans = await load('clans.js');
const invites = await load('invites.js');

const steve = new mock.Player('p1', 'Steve', true); // operator, therefore admin
const alex = new mock.Player('p2', 'Alex');
const zoe = new mock.Player('p3', 'Zoe');
mock.__setPlayers([steve, alex, zoe]);

storage.initSchema();
staff.ensureDefaults();
for (const player of [steve, alex, zoe]) playersMod.register(player);

// ── Admin is operator status, and only that ───────────────────────────────
check('an operator is an admin', staff.isAdmin(steve));
check('a non-operator is not an admin', !staff.isAdmin(alex));
check('an admin can manage any clan', staff.canManageAnyClan(steve));
check('an ordinary player cannot manage any clan', !staff.canManageAnyClan(alex));
check('an admin can edit staff roles', staff.canManageStaffRoles(steve));

// ── Staff roles grant clan access without granting admin ──────────────────
const mod = staff.allRoles().find((role) => role.id === 'mod');
check('the built-in Mod role manages clans', mod?.manageClans === true);
staff.assignRole(alex.id, 'mod');
check('a non-op Mod gains clan management', staff.canManageAnyClan(alex));
check('a non-op Mod is still not an admin', !staff.isAdmin(alex));
check('a non-op Mod cannot edit staff roles', !staff.canManageStaffRoles(alex));
staff.assignRole(alex.id, undefined);
check('clearing the staff role removes clan access', !staff.canManageAnyClan(alex));

// ── Creation ──────────────────────────────────────────────────────────────
const created = clans.createClan(steve.id, steve.name, 'Wolves');
check('a clan is created', created.ok);
const clan = created.ok ? created.value : null;
checkEqual('the owner holds Leader', clans.roleOf(clan, steve.id), 'Leader');
check('a duplicate name is refused case-insensitively', !clans.createClan(zoe.id, zoe.name, 'wolves').ok);
check('a second clan for the same owner is refused', !clans.createClan(steve.id, steve.name, 'Bears').ok);
check('a too-short name is refused', !clans.createClan(zoe.id, zoe.name, 'ab').ok);

check('formatting codes are accepted but stripped', clans.createClan(zoe.id, zoe.name, '§cRed§r').ok);
checkEqual('the stored name has no formatting codes', clans.clanOf(zoe.id)?.name, 'Red');
clans.disband(clans.clanOf(zoe.id).id);

// ── Joining requires consent ──────────────────────────────────────────────
const from = { id: steve.id, name: steve.name };
check('an invite is sent', invites.invite(clan, from, { id: alex.id, name: alex.name }).ok);
check('the invitee is NOT yet a member', !clans.isMember(clans.getClan(clan.id), alex.id));
checkEqual('the invite is pending', invites.pendingFor(alex.id).length, 1);
check('a duplicate invite is refused', !invites.invite(clan, from, { id: alex.id, name: alex.name }).ok);
check('self-invitation is refused', !invites.invite(clan, from, from).ok);

const accepted = invites.accept({ id: alex.id, name: alex.name }, invites.pendingFor(alex.id)[0]);
check('accepting joins the clan', accepted.ok);
check('the invitee is now a member', clans.isMember(clans.getClan(clan.id), alex.id));
checkEqual('other invites are cleared on accept', invites.pendingFor(alex.id).length, 0);
check('someone already in a clan cannot be invited', !invites.invite(clan, from, { id: alex.id, name: alex.name }).ok);

invites.invite(clan, from, { id: zoe.id, name: zoe.name });
invites.decline(zoe.id, invites.pendingFor(zoe.id)[0]);
checkEqual('declining removes the invite', invites.pendingFor(zoe.id).length, 0);
check('declining does not join the clan', clans.clanOf(zoe.id) === undefined);

// Expiry is enforced lazily, on read.
invites.invite(clan, from, { id: zoe.id, name: zoe.name });
const key = `clan:inv:${zoe.id}`;
const stored = JSON.parse(mock.world.getDynamicProperty(key));
stored[0].expiresAt = storage.now() - 1;
mock.world.setDynamicProperty(key, JSON.stringify(stored));
checkEqual('expired invites are pruned when read', invites.pendingFor(zoe.id).length, 0);

// ── Clan roles ────────────────────────────────────────────────────────────
check('a role is assigned', clans.setMemberRole(clan.id, alex.id, 'Officer').ok);
checkEqual('the role reads back', clans.roleOf(clans.getClan(clan.id), alex.id), 'Officer');
check('the role joins the clan palette', clans.getClan(clan.id).roles.includes('Officer'));
check('"Leader" cannot be assigned to a member', !clans.setMemberRole(clan.id, alex.id, 'Leader').ok);
check('the owner cannot be given another role', !clans.setMemberRole(clan.id, steve.id, 'Grunt').ok);
check('a role is cleared with an empty string', clans.setMemberRole(clan.id, alex.id, '').ok);
checkEqual('the cleared role reads empty', clans.roleOf(clans.getClan(clan.id), alex.id), '');

check('a palette role is added directly', clans.addClanRole(clan.id, 'Scout').ok);
check('a duplicate palette role is refused', !clans.addClanRole(clan.id, 'scout').ok);

// ── Leadership transfer ───────────────────────────────────────────────────
clans.setMemberRole(clan.id, alex.id, 'Officer');
check('leadership transfers', clans.transferLeadership(clan.id, alex.id).ok);
const afterTransfer = clans.getClan(clan.id);
checkEqual('the new owner holds Leader', clans.roleOf(afterTransfer, alex.id), 'Leader');
checkEqual('the previous owner drops to no role', clans.roleOf(afterTransfer, steve.id), '');
check('the previous owner remains a member', clans.isMember(afterTransfer, steve.id));

// ── Removal ───────────────────────────────────────────────────────────────
check('the owner cannot be removed', !clans.removeMember(clan.id, alex.id).ok);
check('a member is removed', clans.removeMember(clan.id, steve.id).ok);
check('the removed player has no clan', clans.clanOf(steve.id) === undefined);

// ── Disbanding ────────────────────────────────────────────────────────────
const surviving = clans.getClan(clan.id);
invites.invite(surviving, { id: alex.id, name: alex.name }, { id: zoe.id, name: zoe.name });
checkEqual('an invite is outstanding before disband', invites.pendingFor(zoe.id).length, 1);

invites.revokeAllForClan(surviving.id);
clans.disband(surviving.id);
checkEqual('outstanding invites are swept', invites.pendingFor(zoe.id).length, 0);
check('the clan record is gone', clans.getClan(clan.id) === undefined);
checkEqual('the clan index is empty', clans.clanIds().length, 0);
check('former members are freed', clans.clanOf(alex.id) === undefined);
check('the name is released for reuse', clans.createClan(zoe.id, zoe.name, 'Wolves').ok);

const orphaned = [...mock.__dumpProps().keys()].filter((id) => id.startsWith('clan:pm:'));
checkEqual('no stale player-to-clan index entries remain', orphaned.length, 1);

// ── Concurrent edits do not clobber each other ────────────────────────────
// A form can sit open for minutes. If a mutator wrote back a clan object its
// caller had fetched beforehand, anything that changed in between would be
// erased. Every mutator takes an id and re-reads, so this holds.
const cohort = new mock.Player('p9', 'Casey');
const latecomer = new mock.Player('p10', 'Drew');
mock.__setPlayers([steve, alex, zoe, cohort, latecomer]);
playersMod.register(cohort);
playersMod.register(latecomer);

const shared = clans.createClan(cohort.id, cohort.name, 'Foxes').value;

// What a UI flow would have captured before showing its form.
const stale = clans.getClan(shared.id);

// Meanwhile, somebody else joins.
clans.addMember(shared.id, latecomer.id, latecomer.name);

// The original flow now completes against the id it was given.
clans.addClanRole(stale.id, 'Scout');

const after = clans.getClan(shared.id);
check('a member added during an open form survives', clans.isMember(after, latecomer.id));
check('and the later edit still applied', after.roles.includes('Scout'));
checkEqual('the clan has both members', clans.memberCount(after), 2);

finish();
