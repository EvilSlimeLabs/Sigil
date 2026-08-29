# Next Update

## Expansions

Not requested, not planned, recorded so the shape of the system is on paper.
Roughly in order of value per unit of work.

- **A war leaderboard.** Kill totals per member already persist per war, and
  `endedCountsByClan` already aggregates. An all-time standings board is mostly
  a rendering job over data that exists.
- **Clan territory claims.** Would give outposts a spatial meaning beyond a
  promotion tier. Large: needs chunk-level storage and a permission check on
  block events, which is the first thing in this project that would run on a
  hot path.
- **Configurable war objectives** beyond kills — captures, duration,
  structures. The scoreboard objective is already indirected through the
  catalogue, so the rendering side is ready; the scoring side is not.