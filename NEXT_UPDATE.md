# Next Update

## G — Runtime assumptions not yet verified in-game

### G5. The War Map's custom component declaration

`blocks/war_map.json` names `clan:war_map` directly inside `components`, which
is the form Scripting V2 defines. The block's `format_version` stays at
`1.21.40`: raising it re-versions `collision_box`, `selection_box` and
`material_instances` against a newer vanilla baseline, and those three are tuned
to specific behaviour.

The previous form, a `minecraft:custom_components` array, is deprecated.

What to check on first load, in order:

1. Right-click a placed map with an empty hand. The war screen should open.
2. Try to hang a map on the underside of a block. It should be refused.
3. Break the block a map is mounted on. The map should drop within a second.

Steps 2 and 3 come from the component alone. Step 1 also has a fallback —
`world.beforeEvents.playerInteractWithBlock` in `warmap.js` — so the screen
opening is not by itself proof the component registered.

If any of the three fails, the registration did not take, and the fix is to
restore the `minecraft:custom_components` array alongside the flattened key.

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
  useful to operators.
