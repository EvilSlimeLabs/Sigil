# Next Update



## C — Duplication and naming

### C1. 46 duplicate strings in the catalogue

`text.js` has 616 entries, of which 46 bodies appear more than once under
different keys. This is fallout from the content-driven extraction: it keyed by
call site, not by meaning, so the same sentence extracted from three files
became three entries.

The risk is drift. An admin who reworded "You are not in a clan." would find it
still saying the old thing in two other menus.

**Fix.** Group by body, keep the entry whose key reads best, repoint the other
call sites, delete the losers. This is mechanical and safe to codemod — the
bodies are identical, so no wording decision is involved. Add a rule to
`tools/audit-text.mjs` that fails on a duplicate body so the condition cannot
come back.

### C2. Auto-generated key names

The extraction slugged keys from the first five words, which produced names that
describe the sentence rather than its role:

    chatTagsActivePlayerChatnameprefix
    morePageSOmittedThis
    aLostClan
    noClanAccess

`morePageSOmittedThis` is the worst of them — the slug ran through a word
boundary and capitalised mid-word. These are legible enough to work with, but
they are not names anyone would have chosen, and a translator reading the
catalogue alone gets no hint of context.

**Fix.** Rename by hand, namespace by namespace, in one pass. Keys are
referenced only as `TEXT.<ns>.<key>`, so a rename is a safe find-and-replace
verified by `tsc`. Do C1 first — deduplicating removes ~46 names that would
otherwise need renaming.

### C3. Two copies of `notifyReviewers` and the manage-permission check

- `notifyReviewers` at [commands.js:160](clan_bp/scripts/commands.js#L160) and
  [ui.js:374](clan_bp/scripts/ui.js#L374)
- `mayManage` at [commands.js:108](clan_bp/scripts/commands.js#L108) and
  `mayManageClan` at [ui.js:200](clan_bp/scripts/ui.js#L200)

These already drifted once. The reviewer-notice wording bug fixed last round
existed because the rename notice was corrected in one copy and not the other,
and the promotion path in one copy called `canApprove` where it needed
`canApproveRequest`.

**Fix.** Move both into the domain modules that own the concept —
`notifyReviewers` into `requests.js` (it is a fact about a request, not about a
menu), the permission predicate into `clans.js` beside `isOwner`. Both callers
import it. This is the highest-value item in section C: it is the one that has
already caused two real bugs.

---

## E — Test coverage

### E1. 104 of 193 exported functions are never called from a test

The suites are strong where they are pointed — wars has 140 checks — and absent
elsewhere. Untested exports by module:

| Module | Untested exports |
| --- | --- |
| `format.js` | 11 |
| `ui.js` | 13 |
| `wars.js` | 10 |
| `clans.js` | 9 |
| `storage.js` | 8 |
| `requests.js` | 7 |
| `compass.js`, `display.js` | 6 each |
| `staff.js`, `invites.js` | 5 each |
| everything else | 1–4 each |

Not all of these are equally worth testing. Ranked by what would actually catch
a bug:

1. **`format.js` validators** (`validateClanName`, `validateRoleName`,
   `validateStaffSymbol`, `sanitize`, `truncate`) — pure functions guarding
   every name a player can type, and the cheapest tests in the project to
   write. These should not have been skipped.
2. **`storage.js`** (`setJsonGuarded`, `idsWithPrefix`, `remove`) — the
   foundation everything else persists through, including the ~32KB
   per-property ceiling that `setJsonGuarded` exists to enforce.
3. **`clans.js` mutators** (`rename`, `deleteClanRole`, `refreshMemberName`) —
   these write, so a regression loses data rather than misdrawing a menu.
4. **`wars.js`** (`withdrawDeclaration`, `withdrawPeace`, `forfeitAllFor`,
   `syncScoreboard`) — `forfeitAllFor` is the path item B2 just changed.
5. `ui.js` menus and `display.js` render helpers — highest effort, lowest
   yield, since the menu suite already covers the flows players actually walk.

### E2. The `forms.js` warning path is untested

`resolveValues` warns when `formValues.length` matches neither the slot count
nor the input count — the case that means the runtime changed its convention
under us. The mock can produce it (`__setSlotMode`), but no test asserts the
warning fires or that the fallback still maps inputs in order. That branch is
precisely the one nobody will notice breaking.

### E3. Settings-cache invalidation is unverified

`settings.invalidate()` is exported and never tested. The cache is read on
nearly every display refresh, so a stale read after a settings change would show
as "my colour change did nothing until I rejoined" — a bug report that would be
very hard to trace back here.

### E4. Announce wording is asserted loosely

Several war tests assert that an announcement *fired* rather than what it said.
The B2 fix changed which announcement fires for an unanswered declaration; a
wording assertion would have caught the original behaviour earlier than review
did.

---

## F — Structure

### F1. `ui.js` is over 3,000 lines

A third of the behaviour pack in one file — the next largest is `commands.js`,
at roughly a third its size. It is navigable because the menus are ordered and commented, but it is
the file most likely to collect a merge conflict and the one where C3's
duplication grew in the first place.

**Fix.** Split along the seams that already exist, one module per menu family:
`ui/clan.js`, `ui/war.js`, `ui/staff.js`, `ui/settings.js`, `ui/peaceful.js`,
with `ui.js` retained as the entry point that routes the root menu. Deferred
because it touches every menu at once and the A/B/D round had already moved a
lot of that code; doing both in one pass would have made review impossible.
`tools/audit-imports.mjs` now guards the cycle risk that a split introduces.

### F2. Identity signalling is inconsistent

`clans.js` mutators signal `identityChanged` reliably. `staff.js` role changes
and `peaceful.set` do not always, and `purge.js` needed an explicit
`identityChanged(playerId)` appended last round to fix the "ghost" bug where a
purged online player kept rendering their old clan.

That fix was correct but local. The general problem is that signalling is a
convention each mutator has to remember rather than something the design
enforces.

**Fix.** Make every mutator that can change a rendered identity route through a
single helper that writes and signals, so forgetting is not possible. Audit the
call sites first — this is a behavioural change, and the ghost bug shows the
failure mode is silent.

### F3. `text.js` has no regeneration path

The catalogue was produced by a codemod in a scratch directory, not by anything
committed. `tools/audit-text.mjs` can prove a string is *missing* from the
catalogue, but nothing can regenerate or reformat it.

**Fix.** Commit the extraction codemod under `tools/` alongside the audits, even
though it is a one-shot. It is the only executable record of how the catalogue
was built, and C1/C2 both want to run something like it again.

---

## G — Runtime assumptions not yet verified in-game

Everything below type-checks against the published `.d.ts` and passes against
the mocks. None of it has been observed in a running world. These are the items
most likely to produce a surprise on first load, and they should be checked
before the structural work in F, not after.

1. **`ItemStack` dynamic properties surviving a drop and pickup.** The war map
   and the compass carry their identity in dynamic properties. If those do not
   survive the item-entity round trip, a dropped war map comes back blank. This
   is the assumption most likely to be wrong and the one with no workaround
   short of a redesign, so verify it first.
2. **`Date` behaviour under the script runtime.** War records store timestamps
   and the history is indefinite. The runtime's `Date` support and the world's
   clock behaviour across a save and reload have not been confirmed.
3. **The `minecraft:book` component on a `writable_book`.** `setContents` and
   `signBook` are stable in 2.9.0 and the limits are documented (256 characters
   per page, 50 pages, 16-character title), but the give-a-signed-book flow has
   not been executed against the real component.
4. **Block textures and the `minecraft:placement_position` trait.** The
   painting-like placement of the war map, and whether the generated 64×64 and
   16×16 textures read correctly at in-game scale. `tools/make-textures.mjs`
   regenerates them, so iteration here is cheap.
5. **The War Map's custom block component.** `minecraft:custom_components` is
   the form valid at the block's declared `format_version` of 1.21.40, and it
   is the form this pack uses — but Microsoft's Scripting V2 documentation
   describes it as deprecated in favour of naming the component directly inside
   `components`, and this pack is on Scripting V2. Whether a 1.21.40 block file
   still gets its component registered under a 1.26 engine is the single
   assumption here with no way to check it short of loading the pack. The
   failure is not silent: the world event fallback in `warmap.js` keeps the war
   screen reachable with an item in hand, so what would be lost is the empty-
   hand interaction and the support check. If the smoke pass shows the
   registration did not take, the fix is to move the declaration into
   `components` and raise the block's `format_version`.
6. **`replace_block_item` on the War Map.** A block's generated item form
   always stacks to 64, and `minecraft:max_stack_size` is an item component
   with no block equivalent — so the map now ships an item of its own, sharing
   the block's identifier and claiming it with `minecraft:block_placer`'s
   `replace_block_item`. Worth confirming the block still places normally from
   it, still drops that item when broken, and appears once rather than twice in
   the creative menu.
7. **The War Map's collision box.** The map used to have none, which is what
   let a painting on a neighbouring wall size itself as though the map's block
   were empty and grow straight over it. It now has one matching each facing's
   selection box, on the theory that a painting refuses space a solid block
   occupies. The cost is that the map is no longer something you walk through:
   flush against a wall that is imperceptible, and on the floor it is a
   pressure plate's worth of step. Worth confirming the painting actually stops
   there, and worth deciding whether the lost walk-through matters — reverting
   is one line per permutation.
8. **The War Map's X axis, now settled by observation.** Three separate things
   were wrong on the east and west faces and each was found by placing a map
   rather than by reasoning about the trait:

   - The panel belongs on the *opposite* side of its cell from what the Z axis
     predicts. Authored the way north and south are, it hung a block off its
     wall.
   - The block holding it up is therefore on the far side from where the panel
     is drawn, so `SUPPORT_OFFSET` and the model disagree on purpose. Making
     them agree tore maps down a second after they were placed.
   - The image comes out mirrored on those two faces, so their `u` runs
     backwards.

   None of the three applies to north or south. No explanation is offered for
   why the axes differ; the block is drawn to match what the game does with it,
   and this note exists so the next person does not "fix" the inconsistency and
   reintroduce all three.

9. **The War Map's single-quad panels.** Each panel is one face: the other
   five are omitted from the model's `uv` map, which the documentation says
   removes them. It stays visible from both sides only because `alpha_test`
   does not cull back faces — which is what `alpha_test_single_sided` was
   added to do, so the behaviour is deliberate and documented rather than
   accidental. Worth looking at a placed map from below and from behind. If a
   face turns out to render anyway, or the back turns out to be culled, the
   fallback is a one-pixel box whose four narrow faces sample a transparent
   texel from inside one of the holes worn through the sheet.
10. **`Player.chatNameSuffix`.** The chat components ordered past the player's
   name are written to it. It sits beside `chatNamePrefix` in the same beta
   API, so it is very likely present wherever the prefix is, but only the
   prefix has ever been exercised.
11. **The material colour codes.** `§g` and `§h`–`§v` are Bedrock-only additions
   and are now offered in the colour dropdown. A code the running game does not
   know renders as literal text rather than colour, which would be visible
   immediately in the dropdown itself.

12. **The outer chat brackets are the engine's, and stay that way.** Settled,
   and recorded so it is not re-litigated: the pack has never written an angle
   bracket, so the `<...>` around a chat author are Minecraft's. It composes
   the author as prefix + name + suffix and brackets the result, so everything
   written here lands inside them and no property reaches them.

   The only route to controlling them is cancelling each message and
   re-broadcasting a replacement — the `chatSend` fallback, which discards
   native chat behaviour and takes chat down with it if the handler ever
   throws. That was weighed and declined: not worth risking a server's chat
   over punctuation. An enclosure setting that could only add a second, inner
   set of brackets was built and then removed, because a setting whose whole
   effect is "now there are two" is not worth its place in a menu.

13. **The curated symbol list.** Thirty-one glyphs, none of them verified
   against the running game's font. Any that render as a hollow box should be
   cut from `SYMBOL_CHOICES`; the ids are only referenced from `TEXT.symbol`,
   so removing one is a two-line change.

**Fix.** A single manual smoke pass in a test world, in the order above, with
findings recorded back into `PLAN.md` under the limitations section.

---

## H — Logical expansions

Not requested, not planned, recorded so the shape of the system is on paper.
Roughly in order of value per unit of work.

- **Clan alliances.** Wars already model a two-clan relationship with state and
  history. A non-aggression or alliance relation reuses that machinery, and
  would reuse the declaration and consent flow wholesale.
- **A war leaderboard.** Kill totals per member already persist per war, and
  `endedCountsByClan` already aggregates. An all-time standings board is mostly
  a rendering job over data that exists.
- **Clan banks or shared storage.** Frequently wanted alongside clans; entirely
  new persistence, and the ~32KB per-property ceiling would need sharding as
  `wars.js` does.
- **Clan territory claims.** Would give outposts a spatial meaning beyond a
  promotion tier. Large: needs chunk-level storage and a permission check on
  block events, which is the first thing in this project that would run on a
  hot path.
- **Configurable war objectives** beyond kills — captures, duration,
  structures. The scoreboard objective is already indirected through the
  catalogue, so the rendering side is ready; the scoring side is not.
- **An export or import path for clan data**, for server migration. Cheap,
  useful to operators, and it would make G1 and G2 easier to test.
