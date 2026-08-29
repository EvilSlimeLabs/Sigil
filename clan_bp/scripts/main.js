// @ts-check
/**
 * Entry point. Wiring only — the behaviour lives in the modules this imports.
 *
 * Ordering matters in one place: custom commands must be registered inside
 * `system.beforeEvents.startup`, which fires before the world exists. Anything
 * that reads or writes world state therefore waits for the first player spawn
 * instead.
 */

import { system, world, Player } from '@minecraft/server';
import { msg } from './format.js';
import { initSchema } from './storage.js';
import * as playersRegistry from './players.js';
import * as clans from './clans.js';
import * as staff from './staff.js';
import * as invites from './invites.js';
import * as requests from './requests.js';
import * as settings from './settings.js';
import * as wars from './wars.js';
import * as alliances from './alliances.js';
import * as display from './display.js';
import * as commands from './commands.js';
import * as ui from './ui.js';
import * as ledger from './ledger.js';
import * as warbook from './warbook.js';
import * as warmap from './warmap.js';
import { TEXT } from './text.js';

let worldReady = false;
let chatStatusLogged = false;

/**
 * One-time world setup, run on the first player spawn.
 * `system.beforeEvents.startup` is too early for dynamic properties, so this is
 * the earliest safe point.
 */
function initWorld() {
  if (worldReady) return;
  worldReady = true;

  initSchema();
  staff.ensureDefaults();
  // Registered here rather than at module scope because the interval period
  // comes from stored settings, which are not readable before the world loads.
  display.restartAdminPolling();
  // Demotions are otherwise only noticed when a member leaves, which cannot
  // happen while nobody is playing. A roster edited by a command between
  // sessions, or a promotion threshold raised in the settings, would go unseen
  // until the next departure — so the queue is settled against the clans that
  // actually exist before anyone opens it.
  // A world whose war system was turned off between sessions should not come
  // back with wars standing.
  if (!settings.warsEnabled()) {
    const annulled = wars.annulAllLive();
    if (annulled.length > 0) {
      console.log(`[sigil] wars disabled: ${annulled.length} annulled at load`);
    }
  }

  // The alliance module also registers the veto that stops two allied clans
  // declaring war, and ends alliances when a clan disbands.
  if (!settings.alliancesEnabled()) {
    const dissolved = alliances.dissolveAllLive();
    if (dissolved.length > 0) {
      console.log(`[sigil] alliances disabled: ${dissolved.length} dissolved at load`);
    }
  }

  const swept = requests.sweepDemotions();
  if (swept.filed > 0 || swept.cleared > 0) {
    console.log(
      `[sigil] demotion review: ${swept.filed} raised, ${swept.cleared} cleared`,
    );
  }
  // The sidebar is a projection of the war records, so it is rebuilt on load
  // rather than trusted to have survived correctly.
  wars.syncScoreboard();
  console.log('[sigil] clan system ready');
}

/**
 * Brings a joining player's stored state and displayed identity up to date, and
 * tells them anything that happened while they were away.
 *
 * @param {import('@minecraft/server').Player} player
 */
function onJoin(player) {
  playersRegistry.register(player);
  // Reads elsewhere are pure, so the repair and the pruning happen here, on a
  // path that was going to write anyway.
  clans.reconcile(player.id);
  invites.prune(player.id);
  clans.refreshMemberName(player.id, player.name);
  display.refresh(player);
  ledger.ensure(player);

  const clan = clans.clanOf(player.id);
  if (clan) {
    player.sendMessage(
      msg(TEXT.join.welcomeBack(display.identityLine(player))),
    );
  }

  const pending = invites.pendingFor(player.id);
  if (pending.length > 0) {
    const names = pending.map((invite) => invite.clanName).join(', ');
    player.sendMessage(
      msg(
        TEXT.join.pendingInvites(pending.length, names),
      ),
    );
  }

  const ownRequest = requests.forPlayer(player.id);
  if (ownRequest) {
    player.sendMessage(
      msg(TEXT.join.yourRequestStillPending(ownRequest.name)),
    );
  }

  // Reviewers get told on join if work is waiting, since requests can be filed
  // while every reviewer is offline.
  if (requests.canApprove(player)) {
    const queued = requests.all().length;
    if (queued > 0) {
      player.sendMessage(
        msg(
          TEXT.join.requestsAwaitingReview(queued),
        ),
      );
    }
  }
}

// Commands and block components are both described before the world loads;
// neither reads state here. The War Map's component is what makes the placed
// block interactive at all, so it has to be registered in this window or not
// at all.
system.beforeEvents.startup.subscribe((event) => {
  commands.register(event.customCommandRegistry);
  warmap.register(event.blockComponentRegistry);
});

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) {
    // A respawn: the nametag survives, but re-applying costs nothing and keeps
    // the display correct if anything changed while the player was dead.
    display.refresh(event.player);
    return;
  }

  initWorld();
  onJoin(event.player);

  // Chat support is feature-detected against the first real player, so the
  // result is only meaningful once someone has joined. Log it once.
  if (!chatStatusLogged) {
    chatStatusLogged = true;
    console.log(`[sigil] ${display.chatStatus()}`);
  }
});

world.afterEvents.playerLeave.subscribe((event) => {
  display.forget(event.playerId);
  warmap.forget(event.playerId);
});

// The Clan Ledger: one button press instead of typing a namespaced command,
// which is the difference between usable and unusable on a controller.
world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;

  if (ledger.isLedger(event.itemStack)) {
    system.run(() => ui.mainMenu(player));
    return;
  }

  // A printed war record opens the war it documents, so a book in hand is a
  // shortcut as well as a keepsake.
  const documented = warbook.warOfBook(event.itemStack);
  if (documented) {
    system.run(() => ui.warRecord(player, documented.id));
  }
});

// The War Map: a placed block a clan interacts with to run its wars. The block
// component registered above makes it interactive; this cancels the press so a
// held item is not placed through it, and opens the screen for a game that did
// not take the component. `warmap.js` throws away whichever arrives second.
warmap.subscribeInteractionGuard();

// War kills. Only a credited player-versus-player kill between two clans that
// are at war with each other counts — `wars.recordKill` is what decides, and it
// returns undefined for everything else.
world.afterEvents.entityDie.subscribe((event) => {
  const victim = event.deadEntity;
  const killer = event.damageSource.damagingEntity;
  if (!(victim instanceof Player) || !(killer instanceof Player)) return;

  // Names are passed in, not looked up later: the war record caches them so it
  // still reads years on, after the player may be long gone.
  const scored = wars.recordKill(
    { id: killer.id, name: killer.name },
    { id: victim.id, name: victim.name },
  );
  if (!scored) return;

  const scoringClan = clans.getClan(scored.scoringClanId);
  const opposingId = wars.opponentOf(scored.war, scored.scoringClanId);
  const opposingClan = clans.getClan(opposingId);
  if (!scoringClan || !opposingClan) return;

  const line = msg(
    TEXT.join.killed(killer.name, victim.name, scoringClan.name, wars.sideTotal(scored.war, scored.scoringClanId), wars.sideTotal(scored.war, opposingId), opposingClan.name, killer.name, scored.playerKills),
  );
  for (const clan of [scoringClan, opposingClan]) {
    for (const id of Object.keys(clan.members)) playersRegistry.notify(id, line);
  }
});
