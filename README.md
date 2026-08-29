# Sigil: Clans, Wars & Chat Tags

A Minecraft Bedrock add-on that gives players clans — with outposts that earn promotion, invited members, per-clan roles, a staff role system, wars with a kill scoreboard, and a fully configurable identity shown under the player's name and in chat.

---

## Installing

There are two packs. The behavior pack holds the logic; the resource pack holds the War Map's model and texture and the Clan Ledger icon. The behavior pack declares the resource pack as a dependency, so enabling one should pull in the other.

1. Open `Sigil-<version>.mcaddon` with Minecraft, which installs both packs at once. On a server instead, unzip `Sigil-BP-<version>.mcpack` into the world's `behavior_packs/` folder and `Sigil-RP-<version>.mcpack` into `resource_packs/`.
2. Enable **Sigil** in the world's Behavior Packs and **Sigil Resources** in its Resource Packs. Both packs put their version at the front of the description, so the pack list tells you which one is installed.
3. Turn on the **Beta APIs** experiment in world settings.

## Building a release

```bash
npm run release
```

That runs the type check, the audits and the tests, and then writes three files into `dist/`: the `.mcaddon` holding both packs, and each pack on its own as a `.mcpack`. `npm run build` skips straight to packaging.

The bundler checks the seams between the two packs before it writes anything — that the behavior pack's dependency really points at the resource pack beside it, that both packs carry the same version, that each pack's description still leads with that version, that every texture and geometry the blocks name exists, and that the `@minecraft/*` versions in the manifest match the packages the code was type-checked against. Any of those failing stops the build, because each one is a fault the game reports only as a purple block or a single line in the content log.

### Why Beta APIs is needed

Only for chat. The current stable `@minecraft/server` (2.9.0) has **no chat API at all** — no way to read, cancel or format a chat message. Putting a clan tag before a player's name in chat is impossible without a beta API, so the pack uses the smallest one that does it: `Player.chatNamePrefix`.

Everything else — clans, wars, invites, roles, approvals, settings, nametags and the whole menu — is stable API and works with the experiment off. If the pack cannot find a chat API it says so in the content log and leaves chat unformatted.

---

## Using it

### The Clan Ledger

The menu opens on what the player came for — their clan, their invites, the clan list. Everything a staff role or an admin can do sits behind two further buttons, **Admin** and **System Settings**: acting on somebody in particular versus setting a rule that applies to everybody. An ordinary player sees neither.

Every player is given a **Clan Ledger** on their first join. Using it opens the menu — the whole system is reachable from there without typing anything, which is the point on a controller. Lost it? `/clan:ledger`. One is the limit: the command checks your inventory first and tells you so rather than handing out a second.

It was a compass for the first few versions, which was the wrong object: a compass points at something, and this opens a record. The ledger is the book a clan keeps, and what is behind it — membership, roles, standing — is what a ledger holds.

### The War Map

A clan Leader gets one with `/clan:warmap`, puts it up in their base, and right-clicks it to declare war, answer declarations, check standings, or end a war. It is the only way into the war screen apart from `/clan:war` — the compass menu deliberately does not repeat it, so the map is a thing you go to rather than decoration.

It mounts to surfaces like a painting rather than sitting there as a full cube: a flat panel, placeable **on the floor or on any wall, but not on a ceiling** — and on the same partial surfaces an item frame accepts, such as the top of a slab or the flat side of a staircase. On a wall it hangs facing you; on the floor it lies flat, like a chart spread on a table. It is drawn a pixel shy of a full block on each side, so it reads as an object resting on a surface rather than as the surface itself.

**It needs something to hang on.** Break the wall or floor behind a placed map and it comes down and drops itself, the way a painting or an item frame does.

Right-clicking a placed map opens the war screen and nothing else — sneak if you want to build against it, as with any other interactive block.

A War Map does not stack: one per slot, like a painting you are carrying rather than a stack of paper.

### Everyday commands

| Command | What it does |
|---|---|
| `/clan:menu` | Open the menu |
| `/clan:create <name> [player]` | Create an outpost, or request one if approval is required. Admins may name a player to create it for |
| `/clan:invite <player>` | Invite someone — they must accept |
| `/clan:invites` | See your pending invites |
| `/clan:accept [clan]` | Accept an invite |
| `/clan:deny [clan]` | Decline an invite |
| `/clan:role <player> <role>` | Give a member a role, or clear it with `""` |
| `/clan:kick <player>` | Remove a member |
| `/clan:transfer <player>` | Hand leadership to another member |
| `/clan:promote` | Request promotion from outpost to full clan |
| `/clan:war` | Open the war screen |
| `/clan:wars` | List every active war |
| `/clan:warhistory [clan]` | List ended wars, yours or a named clan's |
| `/clan:warbook [clan] [n] [opponent]` | Print the record book for an ended war |
| `/clan:warmap` | Get a War Map block |
| `/clan:rename <name>` | Rename your clan, or request a new name |
| `/clan:leave` | Leave your clan |
| `/clan:disband` | Delete your clan |
| `/clan:info [player]` | Show clan details |
| `/clan:list` | List every clan |
| `/clan:ledger` | Get a replacement Clan Ledger — refused if you already have one |

`/clan:accept` and `/clan:deny` take no argument when only one invite is pending.

### Staff and admin commands

| Command | Who |
|---|---|
| `/clan:manage` | Anyone with clan-management access |
| `/clan:requests` | Anyone who can approve creations or promotions |
| `/clan:warkills <clan> <delta> [player]` | Admins, and staff when allowed — correct a tally, optionally crediting one member |
| `/clan:peaceful` | Admins, and staff when allowed — grant or clear Peaceful |
| `/clan:staff` | Admins — create and assign staff roles |
| `/clan:settings` | Admins — approval, notifications, wars, polling |
| `/clan:display` | Admins — nametag and chat layout, titles, colours |
| `/clan:create <name> <player>` | Admins — found an outpost on another player's behalf |
| `/clan:purge <player>` | Admins — erase a player from the system |
| `/clan:status` | Admins — diagnostics |

---

## Outposts and clans

Every new clan starts as an **Outpost**. To become a full clan it needs **5 members** including the Leader (an admin setting) and then a **promotion request**, which admins — and Mods by default — approve. A clan an admin founds for someone with `/clan:create <name> <player>` is no exception: it starts as an outpost and is promoted the same way.

Outposts show in the outpost colour rather than the clan colour, and **cannot declare or be drawn into wars**. The requirement only says they cannot declare; letting them be declared *upon* would mean a war they cannot fight, so they are excluded from both sides.

---

## How the roles work

Three separate layers, deliberately not the same thing.

**Admin** is operator status, full stop. `/op someone` makes them an admin; de-opping removes it. The pack never grants or stores admin, and nothing inside it can make a non-operator an admin.

An operator **cannot also hold a staff role**. Admin is the whole permission rather than one rank among several, so a role underneath it could only be a weaker duplicate of powers already held — and the displayed title prefers Admin anyway, so it would be invisible too. Every other permission level may hold any role. The Admin title's own symbol, name and colour are edited from the staff role list beside the roles it sits above, in a narrower form: no powers, because an admin already has all of them.

**Visitors are excluded from every candidate list** and cannot be invited to a clan. A visitor cannot build, mine or interact, so they cannot take part in anything a clan does.

Permission level can only be read for a player who is present, so the pack records the level it last saw — on join, and on the same poll that watches for op changes. A visitor who logs off therefore stays a visitor and stays out of the pickers; rejoin them at a higher level and they become a candidate again on the spot, with no admin action. A player the pack has never seen is not filtered, because never having been observed is not evidence of anything.

**Staff roles** are the pack's own layer, for trusted players who are not operators. Each has a name, a symbol, a colour, whether it shows as symbol/name/both, and **its own set of powers**: manage any clan, approve clan requests, approve promotions, adjust war kills, print any clan's war records, grant the Peaceful marker. `Mod` ships with all of them; `Helper` ships with none. Only admins can create, edit or assign staff roles — so a `Mod` can never promote itself.

Those powers used to be global switches in the settings, which meant they applied to every clan-managing role at once — you could not have one role that reviews clans and another that only corrects war kills. A role stored before the change keeps exactly the powers it had.

**Clan roles** are per-clan labels the Leader creates, assigns and removes. `Officer`, `Scout`, anything they like. They are **display only** — nothing in the pack branches on them — and a role made in one clan means nothing in another. The owner always holds `Leader`, automatically and unchangeably.

**Peaceful** is separate from all of that, and stacks: a player can be Admin *and* Peaceful, or Mod *and* Peaceful. Admins — and Mods by default — grant it.

---

## Joining a clan

Owners **invite**; the invited player **accepts**. Nobody is added to a clan without agreeing to it.

Invites survive logout, so you can invite someone who is offline and they will see it when they next join. They expire after 7 days, and accepting one clears any others you were holding.

Removal is the other way round: an owner, or anyone with clan-management access, can remove a member without asking.

---

## Wars

A Leader of a **full clan** declares war on another full clan. By default the other Leader must **accept** before it starts — an admin can switch that off so declarations take effect immediately.

**Kills only count when they are real.** The dead player must be in one warring clan and the credited killer in the opposing clan of that same war. Mob kills, fall damage, friendly fire, and any death with no credited player score nothing. For arrows the game credits the shooter, which is the right answer.

Standings show on a sidebar scoreboard, rebuilt from the war records — so editing the scoreboard with vanilla commands cannot corrupt the real totals. Admins, and Mods by default, can correct a total with `/clan:warkills` or through the War Map.

Several wars can run at once, but **never two between the same pair of clans**. Once a war ends, that pair may declare again as the next numbered war. An admin can cap how many wars a clan holds; the default is unlimited.

### How a war ends

| Ending | Who | Result |
|---|---|---|
| **Surrender** | a Leader, for their own clan | the other clan wins |
| **Peace** | one Leader offers, the other accepts | a draw |
| **Forfeit** | automatic, when a clan is disbanded | the surviving clan wins |
| **Annulment** | admins and clan-managers | no winner |

Surrender is the ordinary exit, and it has **no staff override** — a forced surrender would record a defeat the clan never chose. Staff who need an abandoned war cleared annul it instead, which records no winner.

### War records

Every war is kept **forever**, numbered per pair of clans: the 1st Wolves vs Ravens war stays readable after the 2nd and 3rd are fought. Wars track kills **per member**, not just per clan.

`/clan:warhistory` lists what a clan has fought. `/clan:warbook` prints any finished war as a real written book you can keep, trade or put in a frame — named `War #3: Wolves vs Ravens`, giving the winner and how they won, both clans' totals, and every member's kill count.

A Leader can print any war **their own clan** fought. Admins — and Mods by default — can print any clan's.

Ordinals are numbered per **pair** of clans, so a clan that has fought two others may have two "1st" wars. `/clan:warbook` says so and asks for the opponent rather than guessing.

A correction made with `/clan:warkills` can **name a player**, in which case it lands on that member's own line; unnamed, it shows as a separate Adjustment row so the book never credits a kill to someone who did not make it. Books are snapshots: a correction made after printing needs a fresh copy, which the last page says.

---

## Clan creation approval

**On by default.** When it is on, `/clan:create` files a request instead of making an outpost. Anyone who can approve sees it in `/clan:requests` — or on the menu — and can approve or deny it, with an optional reason passed back to the requester.

- Admins skip the queue entirely; their outposts are created immediately.
- `Mod` can approve by default. Admins can turn that off in `/clan:settings` without changing the role.
- Creation approval and promotion approval are separate switches, so one can be delegated without the other.

---

## Display settings

`/clan:display`, admins only. Both the nametag and chat are assembled from the same four components — the system title, the Peaceful marker, the clan and the clan role — each of which can be shown, hidden, ordered and coloured.

**Nametags**

- Show or hide the clan role — default **hidden**
- Role **before** or **after** the clan — default before
- Bracket style for the clan (default **none**) and for the role (default **square**), from none, square, angled, curly, bar, star and dash
- A colour per bracket style, set apart from the text inside it — brackets punctuate, names identify, and one colour for both meant you could not quieten the punctuation without draining the name
- Where the system title and Peaceful marker sit relative to the name

**Chat**

- Show or hide the clan role — default **shown**
- The clan tag's bracket style and its colour
- Where the system title, clan tag and Peaceful marker sit
- Where the **player's own name** sits. The name has an order like everything else, so a tag numbered above it is drawn **after** the name rather than before it. By default the name is last and everything precedes it.

**Titles**

- The Admin title's symbol, name, colour, brackets, and whether it shows as symbol, name, or both. **Symbols are chosen from a curated list** rather than typed: a glyph outside the game's font renders as a hollow box, and it does so on everyone else's screen rather than on the screen of whoever picked it. A symbol an older version stored is kept at the top of the list so upgrading never silently changes a tag.
- The same for the Peaceful role, plus whether it appears in the nametag, chat, both or neither
- Each staff role carries its own symbol, name, colour, show-as and brackets
- **Brackets on system titles** — the Admin title, each staff role and the Peaceful marker can each be wrapped in a bracket style with a colour of its own, the same way the clan tag is. Off by default, so an upgraded world reads exactly as it did

**Colours** are picked from a shared palette wherever a colour applies — clan, role, outpost tint, Admin, Peaceful, and each staff role. The palette is all sixteen original formatting colours plus Bedrock's material tones — Minecoin, Quartz, Iron, Netherite, Redstone, Copper, Gold Ore, Emerald, Diamond, Lapis, Amethyst and Resin.

The clan, role and outpost colours set here are **defaults**. A Leader can give their own clan a colour from **My Clan → Clan Colour**, which applies to every member of that clan, on nametags and in chat, and overrides the default until it is cleared. It is one setting for the whole clan — members cannot colour themselves.

Defaults produce `✦ Steve` above the head with `Wolves` beneath, and `✦ [Wolves|Leader] Steve: hello` in chat, with the clan in green, roles in aqua and outposts in purple.

---

## Other settings

`/clan:settings`, admins only.

- **Require admin approval to create a clan** — default on
- **Members needed to request promotion** — default 5
- **Max members in an outpost** — default 15
- **Max members in a full clan** — default 100. An outpost is meant to be small; promotion is what lifts the cap, which gives the tier a consequence beyond being allowed to fight
- **War declarations must be accepted** — default on
- **Max active wars per clan** — default 0, meaning unlimited
- **Chat notifications** — a master switch plus one per category: clan created, member joined, member left, clan disbanded, outpost promoted, war declared, war ended. All default on.
- **Staff roles may print any war record** — default on
- **Re-check operator status every N seconds** — default **20**. Bedrock fires no event when someone is opped or de-opped, so admin status is polled; this is how often. Changing it takes effect immediately.

---

## Banning players

The scripting API cannot see bans. There is no ban list, no ban event, and `playerLeave` does not say why someone left — a ban looks exactly like a lost connection. Banning happens outside the add-on, in your server's allowlist or your platform's moderation tools.

So the pack gives you `/clan:purge <player>` instead, also on the admin menu. It removes a player from the system completely: their membership, their staff role, every invite they sent or received, any pending request, and their name record. If they owned a clan, leadership passes to its longest-serving member; if they were the only member, the clan is disbanded.

Ban them on your platform first, then purge.

---

## Development

```bash
npm install     # type definitions and TypeScript
npm run verify  # type-check, audit, then run all five test suites
npm run audit   # every player-visible string is in the catalogue; no import cycles
```

The behavior pack ships as plain ES modules — no bundler, no transpile step, so what runs in the game is exactly what is in `clan_bp/scripts/`. Type safety comes from `// @ts-check` with JSDoc, checked against the real published `.d.ts`:

```bash
npm run check
```

The tests run the shipped modules under Node against a small mock of `@minecraft/server`, rewriting only the import specifier:

```bash
npm test
```

They cover the clan lifecycle and permissions, the menu layer's permission gates, the exact composition of the nametag and chat prefix, the settings, approval and purge behaviour, and outposts, wars and kill attribution.

All three textures are generated by a script rather than committed as opaque binaries, so the art can be reviewed in a diff and regenerated. The map is 64×64 so its torn edges and markings have room to read; the Clan Ledger and the map's inventory icon are 16×16, the resolution every vanilla item uses, because an item at twice the detail of everything beside it in the hotbar reads as a foreign object. The ledger is a transcription rather than a drawing: it was pushed around by hand in an image editor and the finished pixels were copied into the generator as a grid, so the art stays reviewable in a diff and a one-pixel change shows up as a one-character change. The generator is seeded, so output is identical on every run:

```bash
node tools/make-textures.mjs
```

The two pack icons are generated the same way, from the same drawing helpers in `tools/pixels.mjs` — one emblem in two palettes, so the packs read as a pair in the pack list while still being told apart:

```bash
node tools/make-icons.mjs
```

Every string a player sees lives in `clan_bp/scripts/text.js`, so the whole player-facing surface can be read in one file — and translated from one file.

Work deliberately left for a later round — duplicate catalogue entries, test coverage gaps, splitting `ui.js`, and the runtime assumptions that still need a pass in a live world — is recorded in [NEXT_UPDATE.md](NEXT_UPDATE.md).
