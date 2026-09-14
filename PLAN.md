# Sigil: Clans, Wars & Chat Tags — Minecraft Bedrock Add-On

**Status:** plan of record. The build follows this document; deviations get recorded here.
**Target:** Minecraft Bedrock Edition, behavior pack, script API.
**Author:** Wedge Talon

---

## 1. Requirements (as given)

1. Players may create a clan and become its **owner**.
2. Owners may **invite** and **remove** other players. An invited player must **accept** before joining.
3. **Admins** may remove members from **any** clan.
4. Owners may **optionally** assign roles to their clan members.
5. The clan owner automatically holds the role **"Leader"**.
6. Admins may **transfer** the Leader role to another member of that clan.
7. Clan name + role display **in game underneath the player name**.
8. Clan name + role display **in chat, before the player name**.
9. Admins have a **symbol in chat, before everything else**, marking them as admin.
10. Slash commands are supported, but there must also be an **in-game interface** that makes the system easy to use for **console players**, particularly clan leaders and admins.
11. Clan creation may require **admin approval**, controlled by an admin-only setting that is **on by default**. `/clan:create` then files a request for review; on approval the clan forms with the requester as Leader. Admins' own creations are auto-approved. Mods may approve too by default, and admins can toggle that.
12. **Chat notifications** are configurable: a master switch plus a sub-switch per category, all **on by default**. Categories: clan created (after approval), member joined, member left, clan disbanded.
13. A **War Map** that can be **placed and interacted with**. A clan Leader using it may **declare war** on another clan. By default the declaration must be **accepted** by the other clan's Leader, toggleable by admins. Wars track **kills** on a scoreboard. A kill counts **only** when a clan member is credited with killing a member of the opposing clan — kills by anyone else, and deaths with no credited player, do not count. Admins — and optionally Mods, toggleable — can **add or subtract** war kills. Several wars may run at once, but **not two between the same pair of clans**. The number of active wars a clan may hold is an admin setting, **unlimited by default**.
14. A newly created clan begins as an **Outpost**. An Outpost must **request promotion** to a full clan, approvable by admins and optionally Mods. Promotion requires at least **5 members including the Leader**, settable by admins. **Outposts cannot declare war.**
15. **Nametag display is configurable**: show or hide the clan role (default **hide**); role **before or after** the clan (default **before**); and a **bracket style** for the clan (default **off**) and for the role (default **square**), each chosen from off, square, angled, curly, bar, star and dash.
16. **Chat shows the clan role or not**, a setting, default **on**.
17. The **symbol for each system role** — Admin, Mod and any other — is a setting.
18. The operator-status poll defaults to **20 seconds**, not 5 minutes.
19. Clan Leaders **create, assign and remove custom roles** for their own clan. Roles are per-clan and never global, and are **display only** — no mechanical effect. They render in the Role position of the nametag when enabled, and the Role position in chat when enabled.
20. A **Peaceful** system role, assignable by admins and optionally Mods. It adds a symbol in the nametag and in chat. Its **visibility** is settable (nametag, chat, both, neither) and its **order** is settable for each. By default it sits **before the player name in the nametag**, and in chat **after every other title but before the name**.
21. Admins and Mods are shown by their **system role name, their symbol, or both** — an admin setting. This title sits **before the name in the nametag**, and at the **very start of the chat message**.
22. **Peaceful stacks with Admin and Mod**: a player can hold a system role and Peaceful at once.
23. The UI provides a **colour picker wherever a colour applies**.
24. A war ends when one clan's Leader **surrenders**; the clan that did not surrender is the **winner**. Wars may also end by **mutual peace** (a draw), by **admin annulment** (no winner), or by **forfeit** when a clan is disbanded or purged mid-war.
25. Every war is **kept indefinitely**, including repeat wars between the same pair. Each war carries an **ordinal** — 1st, 2nd, 3rd — counted per pair of clans.
26. Wars track a **kill count for every individual member**, not only a clan total. A staff kill correction may **name a player**, in which case it lands on that member's tally; unnamed, it is recorded as an unattributed **Adjustment**.
27. A Leader can obtain a **written book** recording any ended war their clan fought, giving the **winner**, the **total kill count**, and the **per-member kill counts for both clans**. Admins — and optionally Mods — can generate that book for any clan and any war.

### Clarified by the user

- **Admin == Operator, strictly.** If you are not an op you cannot be an admin; if you are an op you *are* an admin. Admin is derived at read time, never stored, never granted by this add-on.
- There is a **second, script-managed role system** ("staff roles") separate from clan roles. Admins customise it. Each staff role may or may not carry **clan-management access**.
- A **`Mod`** staff role exists by default and **does** have clan-management access.
- Staff roles can be assigned to non-ops. They can never confer admin.
- **Joining is consent-based.** A clan owner does not add players directly; they send an **invite**, and the invited player must explicitly **accept** it. Removal stays unilateral — an owner (or anyone with clan-management access) can remove a member without consent.

---

## 2. API stability decision

The user's rule: *if it can be done with stable APIs, it must be; otherwise use the most-stable beta API that achieves it — do not drop the requirement.*

### Verified facts (read from the published `index.d.ts`, not from docs or memory)

| Fact | Evidence |
|---|---|
| `@minecraft/server@2.9.0` (npm `latest`) has **no chat API whatsoever** | `WorldBeforeEvents` exposes no `chatSend`; a grep for any `chat` identifier outside comments returns nothing. The single `chatSend` hit is a stale doc-comment example attached to an unrelated property. |
| `Player.chatNamePrefix` / `chatNameSuffix` / `chatDisplayName` / `chatMessagePrefix` are **beta-only** | Present in beta builds, each tagged `@beta`. |
| `world.beforeEvents.chatSend` is **beta-only** | Present in beta builds under `@beta`. |
| Everything else we need **is stable in 2.9.0** | Custom commands, dynamic properties, `Entity.nameTag`, `Player.playerPermissionLevel`, `system.beforeEvents.startup`, and all of `@minecraft/server-ui@2.1.0`. |

**Conclusion:** requirements 8 and 9 (chat) are impossible on stable. Everything else — requirements 1–7 — is fully achievable on stable and **will be implemented with stable APIs only**.

### Chosen beta surface

**Module version: `@minecraft/server` `2.10.0-beta`**, i.e. the npm build `2.10.0-beta.1.26.44-stable`.

Rationale for that build specifically: Mojang publishes two beta lines — one tracking the **preview** client (`...-preview.NN`) and one tracking the **released** client (`...-stable`). The `-stable` line is the conservative choice, because it is the beta channel validated against the shipping game. The current preview-line beta (`2.11.0-beta....-preview.27`) is explicitly rejected as less stable.

`@minecraft/server-ui` stays on **stable `2.1.0`**. No beta UI surface is used.

### Chosen beta API: `Player.chatNamePrefix`, not `chatSend`

Both are `@beta` in the same build, so neither wins on tag. `chatNamePrefix` is chosen because it is the **smaller and less invasive** surface:

- It is three additive **properties**, not an event carrying cancellation semantics.
- It formats **native** chat. The `chatSend` route requires `cancel = true` plus a manual `world.sendMessage()` re-broadcast, which discards native chat behaviour (client-side rendering, mute/report/moderation handling, targeted messages) and reorders messages.
- If the property one day disappears or moves, chat is simply un-prefixed. If a cancel-and-rebroadcast handler breaks, **chat itself breaks**. The lower blast radius wins.

### Beta containment

**All** beta usage is confined to a single file, `scripts/display.js`, behind a capability-detecting adapter with three tiers:

1. `chatNamePrefix` present → use it (preferred).
2. Else `world.beforeEvents.chatSend` present → cancel and re-broadcast (documented fallback).
3. Else → no chat formatting; **every other feature still works**.

Nothing outside `display.js` imports or references a beta API. Requirements 1–7 keep working with zero beta support present.

### Operational consequence

The world must have the **Beta APIs** experimental toggle enabled. This is stated in the README and is the price of requirements 8 and 9. It is not required for the add-on to load — only for chat formatting to appear.

---

## 3. Permission model

Three independent layers. They are deliberately not conflated.

```
ADMIN        derived, never stored
             player.playerPermissionLevel === PlayerPermissionLevel.Operator

STAFF ROLE   script-managed, at most one per player, may be held by non-ops
             { id, name, symbol, colour, manageClans, priority }
             built-in default: "Mod"  ->  manageClans = true
             never confers admin

CLAN ROLE    per-clan, free text, assigned by the clan owner
             the owner's role is always "Leader" and is neither stored nor editable
```

Derived checks:

- `isAdmin(p)` — the op check above.
- `canManageAnyClan(p)` — `isAdmin(p) || staffRoleOf(p)?.manageClans === true`.
  Grants: remove a member from any clan, assign that clan's roles, transfer
  Leader, and disband it. Role assignment is included deliberately: a power set
  that can remove a member but not correct their label would be an odd one, and
  every mutating screen asserts this predicate for itself rather than trusting
  that the menu hid the button.
- `canManageStaffRoles(p)` — `isAdmin(p)` **only**. Creating, editing, deleting and assigning staff roles is admin-exclusive, so a `Mod` cannot promote itself or anyone else.
- `canApproveClans(p)` — `isAdmin(p) || (settings.staffCanApproveClans && staffRoleOf(p)?.manageClans)`. Approving or denying clan-creation requests. The setting defaults to on, so `Mod` can approve out of the box; an admin can switch it off without touching the role itself.
- `canManageSettings(p)` — `isAdmin(p)` **only**. All add-on settings, including the two above, are admin-exclusive. A `Mod` can never widen its own powers.
- `canGenerateWarBooks(p)` — `isAdmin(p) || (settings.staffCanGenerateWarBooks && staffRoleOf(p)?.manageClans)`, for printing **any** clan's war record. A Leader needs none of this to print a war **their own clan fought**; that right comes from leading a participant, not from staff standing.
- **Surrendering is not a permission.** Only the Leader of a participating clan may surrender, and only on their own clan's behalf — there is no staff override, because a forced surrender would record a defeat that the clan did not choose. Staff who need a war gone annul it instead, which records no winner.

Requirement 6 ("admins may transfer Leader") is implemented as `canManageAnyClan`, because the user defined clan-management access as exactly this power set and gave `Mod` that access by default.

**All commands register at `CommandPermissionLevel.Any` with `cheatsRequired: false`,** with permission enforced in script at run time. Registering the admin commands at `GameDirectors` would lock out non-op staff-role holders, contradicting the requirement.

---

## 4. Data model

Storage is **world dynamic properties**, sharded per record rather than kept in one blob, to stay clear of per-property size limits and to keep writes small.

| Key | Value |
|---|---|
| `clan:v` | schema version number (currently `1`) |
| `clan:index` | JSON `string[]` of clan ids |
| `clan:c:<clanId>` | JSON clan record (below) |
| `clan:nm:<lowercaseClanName>` | `clanId` — enforces clan-name uniqueness |
| `clan:pm:<playerId>` | the `clanId` the player belongs to, or absent |
| `clan:pn:<playerId>` | last-known player name (display cache) |
| `clan:pi:<lowercasePlayerName>` | `playerId` — resolves offline players by name |
| `clan:inv:<playerId>` | JSON `Invite[]` — pending invites addressed to this player |
| `clan:warlive` | JSON `string[]` of war ids still pending or active |
| `clan:war:<warId>` | JSON war record; never deleted once the war began |
| `clan:warpair:<idA>\|<idB>` | the live war id for that pair, or absent |
| `clan:warpast:<idA>\|<idB>` | JSON `string[]` of every war id between the pair |
| `clan:peace:<playerId>` | present when the player holds the Peaceful marker |
| `clan:ledger:<playerId>` | present once they have been issued a Clan Ledger |
| `clan:settings` | JSON settings record (below) |
| `clan:requests` | JSON `ClanRequest[]` — pending clan-creation requests |
| `clan:staff:roles` | JSON `StaffRole[]` |
| `clan:staff:a:<playerId>` | staff role id |

Clan record:

```jsonc
{
  "id": "c_ab12cd34",
  "name": "Wolves",
  "ownerId": "-1234567890",
  "createdAt": 1735000000,
  "members": {
    "-1234567890": { "name": "Steve", "role": "",        "joinedAt": 1735000000 },
    "-9876543210": { "name": "Alex",  "role": "Officer", "joinedAt": 1735000100 }
  },
  "roles": ["Officer", "Scout"]
}
```

Notes:

- The owner **is** a member. Their stored `role` is ignored; `Leader` is always returned for them. This makes requirement 5 unbreakable — there is no state in which the owner lacks Leader.
- `roles` is the clan's optional palette of role names, so the owner picks from a list in the UI rather than retyping. Assigning a role outside the palette adds it to the palette.
- `player.id` is the identity key; names are a display cache refreshed on every join, because gamertags can change.
- Membership lives **inside** the clan record, so loading a clan is one read. `clan:pm:*` is the reverse index, so a player lookup is also one read.

### Invites

An invite is a pending offer addressed to a player. It is stored on the **invitee**, not on the clan, so the common read ("what am I being offered?") is a single property fetch.

```jsonc
// clan:inv:<inviteeId>
[
  {
    "clanId": "c_ab12cd34",
    "clanName": "Wolves",
    "byId": "-1234567890",
    "byName": "Steve",
    "at": 1735000200,
    "expiresAt": 1735605000
  }
]
```

Rules:

- Invites **persist across logout**, so an owner can invite an offline player and it is waiting when they next join.
- Invites **expire after 7 days**. Expiry is enforced lazily: every read prunes entries past `expiresAt`, so there is no timer to maintain.
- A player may hold at most **10** pending invites; the oldest is dropped when an eleventh arrives.
- Accepting an invite **clears every other pending invite** for that player, since a player can only be in one clan.
- An invite is also invalidated at accept time if the clan was disbanded, is full, or the player joined a clan in the meantime. These are checked on accept, not on receipt.

### Settings

One record, admin-editable, stored whole because it is small and always read together. Every field defaults to the permissive/safe value described in the requirements.

```jsonc
// clan:settings
{
  // Clans and outposts
  "requireClanApproval": true,        // creation goes to review first
  "staffCanApproveClans": true,       // clan-managing staff may approve creations
  "staffCanApprovePromotions": true,  // ...and outpost promotions
  "outpostPromotionMembers": 5,       // members needed to request promotion

  // Wars
  "warRequiresAcceptance": true,      // a declaration must be accepted to start
  "maxActiveWarsPerClan": 0,          // 0 means unlimited
  "staffCanAdjustWarKills": true,     // clan-managing staff may correct tallies
  "staffCanGenerateWarBooks": true,   // ...and print any clan's war record

  // People
  "staffCanAssignPeaceful": true,     // clan-managing staff may grant Peaceful
  "opPollSeconds": 20,                // how often operator status is re-checked

  // Appearance — the full tree is in section 5
  "display": { "nametag": {}, "chat": {}, "admin": {}, "peaceful": {}, "colors": {} },

  "notifications": {
    "enabled": true,                  // master switch
    "clanCreated": true,
    "memberJoined": true,
    "memberLeft": true,
    "clanDisbanded": true,
    "clanPromoted": true,
    "warDeclared": true,
    "warEnded": true
  }
}
```

Reads merge the stored record over the defaults, so a settings record written by an older version of the pack gains new keys at their default rather than reading as `undefined` — the failure mode where a newly added notification category silently never fires. `display` and `notifications` are merged one level deeper, because a shallow spread would drop every nested default the stored record happened not to mention.

A notification category fires only when the master switch **and** its own switch are on.

### Clan-creation requests

```jsonc
// clan:requests
[
  {
    "id": "r_ab12cd34",
    "name": "Wolves",
    "requesterId": "-1234567890",
    "requesterName": "Steve",
    "at": 1735000000
  }
]
```

Rules:

- Filed by `/clan:create` (or the create form) when `requireClanApproval` is on and the requester is not an admin.
- **Admins skip the queue**: their creation is applied immediately, as specified.
- A player may hold **one** pending request at a time; filing again replaces it.
- A requested name reserves nothing, but is checked against both existing clans and other pending requests at file time *and again* at approval time — the second check is what matters, since two requests for the same name can be filed before either is reviewed.
- Approval creates the clan with the requester as owner, and therefore Leader. If the requester joined a clan while waiting, approval fails with a clear reason and the request is dropped.
- Denial removes the request and tells the requester, with an optional reason.
- Requests do not expire. A queue that silently emptied itself would be worse than one an admin must clear.

### Outposts

Every clan carries a `tier`, either `outpost` or `clan`. **New clans are always created as outposts** — including ones an admin creates and ones approved from the request queue. Promotion is the only way to become a full clan.

- An outpost may request promotion once it has at least `outpostPromotionMembers` members (default 5, admin-settable), counting the Leader.
- Promotion requests share the review queue with creation requests, so reviewers have one screen rather than two. A request carries a `kind` of `create` or `promote`.
- **Promotion is permanent.** A clan that later falls below the threshold stays
  a full clan. Demoting mid-war would mean annulling its wars and retroactively
  applying "outposts cannot be drawn into a war", which is a worse outcome than
  a small clan keeping a rank it earned.
- **Outposts cannot declare war, and cannot be declared upon.** The requirement states only that they cannot declare; being a legal *target* while unable to fight back would be a one-sided war, so they are excluded from both sides. This is a judgment call and is flagged as one.
- Outposts render in their own colour, distinct from the clan colour, so the tier is visible at a glance without adding a second tag. A clan that has chosen a colour of its own uses that instead, at either tier — the choice is the Leader's, and a clan that wants to be recognisable outranks a tier hint.

### Wars

```jsonc
// clan:war:<warId>
{
  "id": "w_ab12cd34",
  "ordinal": 3,               // the 3rd war ever fought between this pair
  "clanA": "c_111",           // the declaring clan
  "clanB": "c_222",           // the defending clan
  "nameA": "Wolves",          // names cached at declaration, so a record still
  "nameB": "Ravens",          // reads after a clan is renamed or disbanded
  "state": "active",          // pending | active | ended
  "declaredBy": "-1234567890",
  "declaredAt": 1735000000,
  "startedAt": 1735000600,
  "endedAt": 0,

  "outcome": "",              // '' until ended; then surrender | peace | annulled | forfeit
  "winner": "",               // clan id, or '' for peace and annulled
  "loser": "",                // clan id, or ''
  "endedBy": "",              // player id who surrendered, proposed peace, or annulled

  "sides": {
    "c_111": {
      "adjust": 0,            // staff corrections, kept apart from earned kills
      "byPlayer": {
        "-1234567890": { "name": "Steve", "kills": 4 }
      }
    },
    "c_222": { "adjust": 0, "byPlayer": {} }
  }
}
```

A side's total is `sum(byPlayer.kills) + adjust`. The two are split because a correction may or may not belong to a particular member: crediting a miscounted kill to the player who earned it is a different statement from adding a kill to the clan with no one to attribute it to, and the book should not silently claim the second is the first.

Names are cached on the record at the moment they are needed — the clan names at declaration, a member's name at their first kill — because a war record outlives the clan, the membership and sometimes the player. A record that renders as "Unknown player" years later is not much of a record.

#### Indexes

| Key | Value |
|---|---|
| `clan:warlive` | JSON array of war ids that are `pending` or `active` |
| `clan:warpair:<idA>\|<idB>` | the **live** war id for that pair, or absent |
| `clan:warpast:<idA>\|<idB>` | JSON array of every war id between the pair, oldest first |

There is deliberately **no global array of every war id**. Wars are kept forever, and a single dynamic property holding every id would hit the roughly 32 KB string ceiling somewhere near two thousand wars — a cap that would arrive silently and be painful to undo. Instead:

- The full history is enumerated with `getDynamicPropertyIds()` filtered by the `clan:war:` prefix, which has no such ceiling. This is only done when someone browses history, never on a hot path.
- `clan:warlive` stays small — it holds only unfinished wars — and is what the scoreboard and the "are we at war?" checks read.
- `clan:warpast:<pair>` gives the ordinal (its length plus one at declaration) and backs the war-record picker, and is bounded by how many times two clans have fought.

Pair keys sort the two clan ids, so the key is the same whichever clan is asked about.

#### Rules

- Only a **Leader** of a full clan may declare. The target must also be a full clan.
- `warRequiresAcceptance` (default **on**, admin-toggleable) decides whether the war starts `pending` — awaiting the defending Leader's acceptance — or goes straight to `active`.
- `maxActiveWarsPerClan` (default **0, meaning unlimited**) caps how many `active` or `pending` wars one clan may hold.
- A pair may hold at most one war that is not `ended`. Once ended, the same pair may declare again — and the new war gets the next ordinal.
- **A war is never deleted.** Ending only sets `state`, `outcome` and `endedAt`.

#### How a war ends

There is no bare "end this war" any more. Every ending records who won and why.

| Ending | Who | Outcome | Winner |
|---|---|---|---|
| **Surrender** | either clan's Leader, for their own clan | `surrender` | the clan that did **not** surrender |
| **Mutual peace** | one Leader proposes, the other accepts | `peace` | none — a draw |
| **Forfeit** | automatic, when a clan is disbanded or its last member purged | `forfeit` | the surviving clan |
| **Annulment** | admins and clan-managing staff | `annulled` | none |

Surrender is the ordinary exit and the one the requirement names. The other three exist because surrender alone cannot cover every case: two Leaders who both want out should not have to stage a loss; a clan that stops existing cannot surrender; and an abandoned war between inactive clans would otherwise sit on the scoreboard forever with no one able to clear it.

A pending declaration that is refused is not a war and gets no record — it is discarded, as now.

**What counts as a kill.** On `entityDie`: the dead entity must be a player in one warring clan, and `damageSource.damagingEntity` must be a player in the opposing clan of that same war. Everything else is ignored — mob kills, fall damage, friendly fire, and any death with no credited player. For projectiles the API credits `damagingEntity` to the shooter, which is the right attribution. The kill is recorded against the **side the killer was on at that moment**, so a player who later changes clans does not take their kills with them.

**The scoreboard.** One objective, `clan_war`, displayed in the sidebar, with each warring clan's name as a participant and its kill total as the score. One objective rather than one per war, because the sidebar can only show a single objective and several wars may be running. The war records are the source of truth; the scoreboard is a projection rebuilt from them, so a manual scoreboard edit cannot corrupt the real counts.

**Adjusting kills.** Admins always may. Clan-managing staff roles may too when `staffCanAdjustWarKills` is on (default on). An adjustment is a signed delta, and it may optionally **name a player**:

- **With a player named**, the delta lands on that member's own `byPlayer.kills`. This is the case where a kill was genuinely missed or wrongly credited, and the correction belongs on the player's line — so the book shows them with the right tally and no separate footnote.
- **With no player named**, the delta lands on the side's `adjust` bucket and is reported as `Adjustment` in the book. This is the case where the clan total is wrong but nobody can say whose kill it was.

Either way the affected figure floors at zero: a member cannot be driven below zero kills, and neither can a side's bucket. The named player must be a member of the side being adjusted; naming someone from the opposing clan is refused rather than quietly applied to the wrong side. A player who scored nothing yet can still be named — the entry is created, which is what makes "credit the kill they were owed" work at all.

The command is `/clan:warkills <clan> <delta> [player]`, with the player optional; the War Map screen offers the same choice as a dropdown that defaults to the unattributed bucket.

### War record books

A written book recording a finished war. Generated on demand, never stored — the war record is the truth and the book is a rendering of it.

**This is a stable API.** `ItemBookComponent` (`minecraft:book`) is present in `@minecraft/server` 2.9.0 with no `@beta` tag; verified against the published type definitions rather than assumed. Nothing about this feature needs the beta module.

```js
const book = new ItemStack('minecraft:writable_book');
const contents = book.getComponent('minecraft:book');
contents.setContents(pages);        // replaces every page
contents.signBook('War #3', author); // signed books are read-only
book.nameTag = 'War #3: Wolves vs Ravens';
book.setDynamicProperty('clan:war', war.id);
```

`setContents` and `signBook` cannot run in restricted-execution mode, which costs nothing here — every command handler already defers into `system.run`.

#### Titling

The engine caps a signed book's title at **16 characters**, which "3rd Wolves vs Ravens War" does not come close to fitting. Title and displayed name are separate things, so:

- **Signed title:** `War #3` — short, always fits, never truncated by a long clan name.
- **Item name:** `War #3: Wolves vs Ravens`, set through `ItemStack.nameTag`, which has no such limit. This is the text players actually read in the hotbar and inventory.
- **Page 1 heading** repeats the full name, so the book is self-describing once opened.

#### Layout

Page 1 is the summary; the rest is the roster, split by side.

```
=== 3rd War ===
Wolves vs Ravens

Winner: Ravens
by surrender

Kills
  Wolves   12
  Ravens   19

Fought 4 Jan - 9 Jan
```

Roster pages list every member who scored, highest first, then members who scored nothing, so the book is useful even when a clan turned out in force and few landed a kill.

A side's unattributed `adjust` appears as its own `Adjustment` row at the foot of that side's roster, and only when it is non-zero — a book for a war nobody corrected never mentions adjustments at all. Corrections that named a player are already part of that player's line and get no separate row, which is the point of allowing them to be named.

```text
Ravens          19

  Alex          7
  Robin         5
  Kai           4
  Sam           0
  Adjustment    3
```

#### Capacity

The engine caps a page at **256 characters** and a book at **50 pages**. It says nothing about lines — the line budget is a *rendering* concern, and a page that overruns it is simply unreadable rather than rejected. The book UI fits about **14 lines**, and long text wraps, so a 22-character clan heading quietly costs two of them.

Pages are therefore budgeted in **rendered** lines, counting wrapping, and against the character cap at the same time. Rosters are laid out as titled sections: a clan with more members than one page holds spills onto continuation pages that **repeat the heading** with `(cont.)`. Without that, a large clan's second page was a bare list of names with nothing saying whose roster it was.

A war between two full 100-member clans runs about twenty pages, so the 50-page cap is comfortable. Past it, the tail is truncated with a stated `+N more` rather than throwing.

#### Who can get one

- A **Leader** may generate a book for any ended war **their own clan fought**.
- **Admins** may generate one for any clan and any war.
- **Clan-managing staff roles** may too, when `staffCanGenerateWarBooks` is on (default **on**, admin-toggleable), matching how the other "optionally Mods" powers work.

A book is a snapshot taken when it is printed. A signed book is immutable, so a staff kill adjustment made afterwards will not appear in a book already handed out; reprinting gives the corrected figures. This is stated on the last page.

### Player registry


`clan:pn:*` and `clan:pi:*` are written on initial spawn. They let the UI list and act on **offline** members — required by "admins may remove members from any clan", which cannot depend on the target being online.

---

## 5. Display

Display is fully settings-driven. Rather than a fixed format with a few switches bolted on, both the nametag and the chat prefix are assembled from the same four **components**, each of which can be shown, hidden, ordered and styled:

| Component | What it is |
|---|---|
| `system` | The Admin or staff-role title — name, symbol, or both |
| `peaceful` | The Peaceful marker |
| `clan` | The clan name |
| `role` | The member's clan role |

Each surface decides which components it draws and in what order, from an integer `order` per component. Assembling both surfaces from one component list is what keeps "before the name in the nametag, at the very start in chat" from becoming two unrelated pieces of formatting code that drift apart.

### Bracket styles

Applied to the clan and role components on the nametag:

| Style | Renders |
|---|---|
| `off` | `Wolves` |
| `square` | `[Wolves]` |
| `angled` | `<Wolves>` |
| `curly` | `{Wolves}` |
| `bar` | `\|Wolves\|` |
| `star` | `*Wolves*` |
| `dash` | `-Wolves-` |

### Nametag

`Entity.nameTag` — stable API. Two lines: titles and the player's name on the first, the clan line on the second.

```
✦ ☮ Steve
Leader [Wolves]
```

Defaults, per the requirements:

- **Clan role hidden.** The second line is just the clan until an admin turns the role on.
- **Role before clan**, when shown.
- **Clan brackets off**, **role brackets square**.
- **System title first**, then **Peaceful**, then the name.

### Chat

`Player.chatNamePrefix` — beta, through the adapter in §2.

```
✦ [Mod] [Wolves|Leader] ☮ Steve: hello
```

Defaults:

- **System title at the very start**, satisfying requirement 21 and the original requirement 9.
- **Clan tag next**, showing `[Clan|Role]`; the `|Role` half is on by default and can be switched off.
- **Peaceful last of the titles, immediately before the name**, as specified.

### System roles and their symbols

Every staff role carries a `symbol`, a `name`, a `color` and a `showAs` of `symbol`, `name` or `both`. Admin is not a staff role — it is derived from operator status and cannot be assigned — so its symbol, colour and `showAs` live in settings under `display.admin`, and are edited on the same screen as the staff roles so that "set the symbol for a system role" is one place regardless of which role it is.

### Peaceful

A separate flag, not a staff role slot, precisely because requirement 22 says it stacks: a player can be Admin *and* Peaceful, or Mod *and* Peaceful. It is stored per player at `clan:peace:<playerId>`.

- Assignable by admins, and by clan-managing staff roles when `staffCanAssignPeaceful` is on (default on).
- `visibility` is `both` (default), `nametag`, `chat` or `none`.
- Order is settable independently for the nametag and for chat.

### Clan roles

Already per-clan and display-only, which is requirement 19. Leaders create them, assign them, and remove them; a role created in one clan means nothing in another. Nothing in the codebase branches on a clan role — it is a label, and the `Leader` reservation for the owner is the only rule attached to it.

### Colours

Every colour in the display is a setting, chosen from a shared palette through the same dropdown wherever a colour applies: the clan tag, the role, the outpost tint, the Admin title, the Peaceful marker, and each staff role.

The palette is all sixteen original formatting codes plus Bedrock's later material tones — Minecoin, Quartz, Iron, Netherite, Redstone, Copper, Gold Ore, Emerald, Diamond, Lapis, Amethyst and Resin. Only the code and a stable id live in `config.js`; the name a player reads is in the text catalogue, because `config.js` is imported by every module including the ones that run first and reaching for the catalogue from it would close an import cycle.

**The clan colour belongs to the clan, not to the settings screen.** The add-on-wide clan and outpost colours are defaults; a Leader can set a colour on their own clan from **My Clan → Clan Colour**, stored on the clan record and applied to every member on both surfaces. It is deliberately one setting for the whole clan rather than per member: the point of a clan colour is that a clan is recognisable across a server, which per-member overrides would take away. Clearing it returns the clan to the default for its tier.

**Button labels are re-coloured on the way out.** Form buttons are drawn on a light grey panel, and the palette above was chosen against the dark panel that bodies and chat use. Gray is the button's own colour and vanishes into it; the bright half of the palette washes out on it. `format.buttonText` maps every code in a label into the dark half, and the action-form builder in `forms.js` applies it to every button — which is what makes the rule hold for labels assembled at runtime from a clan name in a colour its Leader picked.

### Where the name sits in chat

The nametag draws its titles before the player's name and nothing after it, which is all the surface allows. Chat has two properties — `chatNamePrefix` and `chatNameSuffix` — so the player's **name carries an order of its own** in the same sequence as the system title, the clan tag and the Peaceful marker. A component numbered above the name is drawn after it. The default puts the name last at 30, so everything precedes it and the behaviour is what it always was; there is no separate before/after switch, because a second ordering scheme would have to be kept consistent with the first.


---

---

## 5b. Console accessibility

Typing `/clan:menu` on a controller means opening chat, navigating an on-screen keyboard and spelling out a namespaced command. That is the worst path through the add-on and it is the one a console clan leader would hit constantly, so the forms UI needs a physical entry point.

**The Clan Ledger.** A custom item, `clan:clan_ledger`. Using it opens the main menu — one button press, no typing, and every screen from there on is a form that a controller navigates natively.

It shipped as a compass through 1.3.x and was renamed once the art settled. A compass points at something; this opens a record, and the menu behind it is membership, roles and standing — which is what a ledger holds. The identifier changed with the name, so a copy already in a world becomes an unknown item; the issue key was renamed alongside it (`clan:ledger:` rather than `clan:compass:`) so every player is handed the replacement exactly once instead of being told they already have one.

- It is given automatically on a player's first join, and `/clan:ledger` replaces a lost one — but only when the player is not already carrying one, since every copy opens the same menu and a second is only clutter.
- It is purely a key to the UI: no crafting, no durability, no gameplay effect.
- Its icon is a custom texture from the resource pack.

This is an addition to the command surface, not a replacement. Everything remains reachable by command for players who prefer typing, and the forms UI is already the complete surface (§6), so console players lose access to nothing.

**The War Map.** A custom **block**, `clan:war_map`. It is placed in the world and interacted with, and interacting opens the war screen: declare a war, respond to a declaration, view the standings, or end a war. A clan Leader gets one with `/clan:warmap`; admins can hand them out.

It is a block rather than an item because the requirement asks for something placed — a physical war map in a clan's base, which is a better fit for how clans actually play than a menu buried in an inventory.

**Interaction goes through a custom block component**, `clan:war_map`, registered on `StartupEvent.blockComponentRegistry`. This is what makes the engine treat the block as interactive at all: `world.afterEvents.playerInteractWithBlock` fires only when a player *uses an item on* a block, so before the component existed the only interaction that reached the handler was a player holding a second War Map and trying to place it. The world event is kept as a fallback for a game that does not take the registration, and `warmap.js` discards whichever of the two arrives second within ten ticks.

**It requires support, like a painting or an item frame.** Bedrock raises no neighbour-changed event for scripts, so the block carries `minecraft:tick` at a one-second interval and the component's `onTick` asks whether the surface it was placed against is still solid. Polling rather than reacting means the map also comes down when its wall is removed by a command, a piston or an explosion — cases a break handler would miss. An unloaded neighbour counts as present, so a chunk boundary never destroys a map.

**It mounts to surfaces like a painting**, not as a full cube:

- A **flat panel** on a custom model, with **no collision box** — you walk through it, exactly as with a painting.
- Each panel is a **single quad**, not a box. Omitting a face from the model's `uv` map removes it, so there is one face and nothing else: no second face coplanar with it, and no edges. It is still visible from both sides, because `alpha_test` does not cull back faces — that is what the later `alpha_test_single_sided` method was added to do, and this block deliberately does not ask for it.

  Both of the box-shaped answers are wrong, and it is worth writing down why. A one-pixel box has four narrow side faces, and a side face is a full rectangle while the sheet drawn on the large faces has a torn silhouette — so whatever those faces draw, a slice of the map or a plain parchment edge, stands out past every tear as a solid rectangular rim. Collapsing the box to a zero-length axis removes those faces but leaves the up and down quads on the same plane; the renderer cannot order two coplanar faces, and since Bedrock shades a downward face much darker than an upward one, the fight between them reads as the block flickering black. One face has neither problem, and it is what vanilla's own flat blocks do.

  Each quad sits a quarter-pixel off the surface it is mounted on so it cannot z-fight with the block behind it.
- Placeable on the **top of a block** (lying flat on the floor) and on **all four walls** (hanging vertically). **Not on a ceiling**, enforced by the custom component's `beforeOnPlayerPlace` rather than by a component. `minecraft:placement_filter` was the declarative way to say this, and it was removed: it refuses any face it does not consider a full one, so it also blocked top slabs and the flat sides of stairs — surfaces an item frame accepts. Losing it costs the native pop-off behaviour too, which is no loss, because the support tick was already doing that job.
- Orientation comes from the `minecraft:placement_position` trait's `minecraft:block_face` state, which records the face the player clicked. One permutation per wall direction swaps in that direction's geometry and its selection box; the default (floor) permutation needs neither.
- **There is no `minecraft:transformation`.** The wall panel started as one model turned by a Y rotation, with the selection box set per permutation on the assumption that the transform moved the art but not the box. In a live world the hitbox came out on the same side whichever face the map was hung on — which is what a transform being applied to the box as well looks like. Rather than work out which half of that assumption was wrong, each of the four facings now has its quad authored where it belongs, so the art and the box are written in the same coordinate space by hand and nothing is applied to one and not the other. Five small models instead of one and a rotation table is a cheap price for removing a whole class of doubt.

### Resource pack

Adding custom art means a second pack, `sigil_rp/`, which the behavior pack lists as a dependency so enabling one pulls in the other. It carries the War Map's model and texture, the Clan Ledger icon, and the display-name strings. Both textures are generated from a committed script (`tools/make-textures.mjs`) rather than pasted in as binary, so the art is reviewable in a diff and regenerable. The map is **64×64** rather than the usual 16 so the torn edges, stains and markings have room to read; the compass and the map's inventory icon are **16×16**, the resolution every vanilla item uses.

The compass took three passes to stop looking foreign, and each pass removed a different tell. It began at 32×32 with a brass housing and a ring of evenly spaced tick marks: twice the detail of anything beside it in the hotbar, and a ring of ticks around a dial reads as a clock face rather than a compass. The second pass dropped to 16×16 and lost the ticks, but was still assembled from concentric `disc()` calls with the light and shade laid on as a diagonal sweep — and perfect circles and a mathematically straight shading seam are not how any vanilla item is drawn. The third is **a hand-authored pixel grid**, written out row by row in `tools/make-textures.mjs`: still art in code and still reviewable in a diff — more so, since the diff shows the picture — but with a chunky cut octagon for a silhouette and the shading stepped where a pixel artist would step it. The grid is checked on every run for a wrong row length or a character outside the palette, because a hand-written grid is the one thing here a typo could damage silently.

What keeps it feeling special rather than merely plain is a thin brass ring seated between the iron housing and the dial. Vanilla mixes materials on one item routinely, so the accent reads as ornament rather than as another game's art, and the item already carries `minecraft:foil` — the enchant glint does the rest. Randomness runs through a seeded generator, so the output is byte-identical on every run.

---

## 6. Command surface

All namespaced under `clan:` (Bedrock requires a namespace on custom commands). Registered in `system.beforeEvents.startup` via `StartupEvent.customCommandRegistry`.

| Command | Params | Who | Effect |
|---|---|---|---|
| `/clan:menu` | — | anyone | Opens the main UI. The primary interface. |
| `/clan:create` | `name: String`, `player: PlayerSelector?` | anyone not in a clan; the optional player is admin-only | Create a clan, or file a creation request when approval is required. Admins always create immediately, and may name another player to found the clan for. A clan founded this way still starts as an outpost and is promoted the same way. |
| `/clan:ledger` | — | anyone | Get a replacement Clan Ledger, unless one is already held. |
| `/clan:warmap` | — | Leader of a full clan | Get a War Map block to place. |
| `/clan:promote` | — | Leader of an outpost | Request promotion to a full clan. |
| `/clan:war` | — | anyone in a clan | Open the war screen: declare, respond, view standings, end. |
| `/clan:wars` | — | anyone | List every active war and its kill standings. |
| `/clan:warhistory` | `clan: String` (optional) | anyone | List ended wars, for your clan or a named one. |
| `/clan:warbook` | `clan: String`, `ordinal: Integer`, `opponent: String` (all optional) | Leader for their own clan; `canGenerateWarBooks` for any | Print the record book for an ended war. No arguments opens a picker; a clan alone opens its history. Ordinals are per **pair**, so an ambiguous number asks for the opponent rather than guessing. |
| `/clan:rename` | `name: String` | Leader | Rename the clan, or file a rename request when approval is required. |
| `/clan:invite` | `target: PlayerSelector` | owner | Invite an online player. They must accept. |
| `/clan:invites` | — | anyone | List your pending invites. |
| `/clan:accept` | `clan: String` (optional) | invitee | Accept an invite. With one pending invite the argument may be omitted. |
| `/clan:deny` | `clan: String` (optional) | invitee | Decline an invite. Omit the argument when only one is pending. |
| `/clan:kick` | `target: PlayerSelector` | owner, or `canManageAnyClan` | Remove a member. |
| `/clan:role` | `target: PlayerSelector`, `role: String` | owner | Assign or clear a clan role. Empty string clears. |
| `/clan:leave` | — | member | Leave your clan. Owners must transfer or disband first. |
| `/clan:disband` | — | owner, or `canManageAnyClan` | Delete the clan. |
| `/clan:info` | `target: PlayerSelector` (optional) | anyone | Show clan info for yourself or another player. |
| `/clan:list` | — | anyone | List all clans with member counts. |
| `/clan:transfer` | `target: PlayerSelector` | `canManageAnyClan` | Move Leader to another member of that clan. |
| `/clan:manage` | — | `canManageAnyClan` | Staff UI: browse every clan, act on any member. |
| `/clan:requests` | — | `canApproveClans` | Review, approve and deny pending clan-creation requests. |
| `/clan:staff` | — | admin only | Staff-role editor and assignment UI. |
| `/clan:settings` | — | admin only | Approval, notification and polling settings. |
| `/clan:display` | — | admin only | Nametag and chat layout, titles, colours. |
| `/clan:peaceful` | — | admin, or staff when allowed | Grant or clear the Peaceful role. |
| `/clan:purge` | `player: PlayerSelector` | admin only | Remove a player from the system entirely. Use after banning them on your platform. |
| `/clan:warkills` | `clan: String`, `delta: Integer`, `player: PlayerSelector` (optional) | admin, or staff when allowed | Adjust war kills. Naming a player credits or debits that member; unnamed, it is recorded as an Adjustment. |
| `/clan:status` | — | admin only | Diagnostics: active chat strategy, clan and role counts. |

**Online versus offline:** `PlayerSelector` resolves online players only. Every operation that may target an **offline** player (kick from any clan, transfer, role assignment) is additionally available through the forms UI, which lists members from stored data. The split is intentional: commands are the fast path for online targets, the UI is the complete surface.

**Execution mode:** custom-command callbacks run in restricted-execution mode. They return `{ status: CustomCommandStatus.Success }` synchronously; every mutation, every `form.show()`, and every `chatNamePrefix` write is deferred into `system.run(...)`.

---

## 7. Events and lifecycle

| Hook | Purpose |
|---|---|
| `system.beforeEvents.startup` | Register all custom commands and enums, and the War Map's block component. Nothing else — the world is not loaded yet. |
| `world.afterEvents.playerSpawn` | On `initialSpawn`: refresh the name registry, reconcile the player's clan state, apply nametag and chat prefix, send a short welcome showing their identity, and notify them of any pending invites. |
| `world.afterEvents.playerLeave` | Nothing persistent. Membership survives logout by design. |
| `world.afterEvents.itemUse` | Opens the main menu when the used item is the Clan Ledger. |
| `world.afterEvents.playerInteractWithBlock` | Fallback path to the war screen, for a game that did not take the block component. De-duplicated against it. |
| `world.afterEvents.entityDie` | Credits a war kill when a clan member kills an opposing member of a clan they are at war with. |
| `system.runInterval` (every 20 s) | Re-evaluate op status for online players and re-apply display when it changed. Bedrock fires no event for op grant or revoke, so admin status is polled. Cost is one enum read per online player. |

---

## 8. Validation rules

- **Clan name:** 3–16 characters, `A-Za-z0-9 _-`, not blank after trimming, case-insensitively unique.
- **Clan role name:** 1–16 characters, same charset. `Leader` is reserved — the owner holds it implicitly and it can never be assigned to anyone else.
- **Staff role name:** 1–16 characters. Symbol: up to 8 characters after stripping, then wrapped in the role's colour by the add-on.
- **All user text is stripped of `§`** before storage, so no player can inject colour codes or forge an admin symbol into their own tag.
- One clan per player. One staff role per player.
- **Invites:** at most 10 pending per player, 7-day expiry, no duplicate invite from the same clan, cannot invite someone already in a clan, cannot invite yourself, refused once the clan is at `maxMembersPerClan`.

---

## 9. Project layout

```
c:\dev\clan\
  PLAN.md                       this document
  README.md                     install and usage; states the Beta APIs toggle
  package.json                  dev-only: type packages plus tsc for checking
  tsconfig.json                 checkJs / noEmit — type-checks the shipped JS
  types/
    minecraft-globals.d.ts      declares the runtime's `console`
  tests/
    harness.mjs                 runs the shipped modules against a mock game
    mock-server.js              minimal stand-in for @minecraft/server
    mock-server-ui.js           scriptable form answers, for the menu layer
    clans.test.mjs              lifecycle, permissions, invites, roles
    menus.test.mjs              which screens each role reaches, and what they offer
    display.test.mjs            nametag and chat composition, brackets, Peaceful
    governance.test.mjs         settings, approval queue, notifications, purge
    wars.test.mjs               outposts, declarations, kill attribution
  sigil_rp/
    manifest.json
    pack_icon.png
    models/blocks/war_map.geo.json  floor and wall panel geometry
    textures/blocks/clan_war_map.png
    textures/items/clan_ledger.png
    textures/terrain_texture.json
    textures/item_texture.json
    texts/en_US.lang
    texts/languages.json
  sigil_bp/
    manifest.json
    pack_icon.png
    items/
      clan_ledger.json          console-friendly key to the UI, BP-only
      war_map.json              the War Map's item form: icon, stack size of 1
    blocks/
      war_map.json              surface-mounted war map, painting-like
    scripts/
      main.js                   entry: wiring only
      config.js                 constants, colours, defaults, key prefixes
      format.js                 sanitising, validation, text helpers
      storage.js                dynamic-property codec (get/set JSON, delete)
      players.js                player id <-> name registry, target resolution
      staff.js                  admin detection, staff roles, permission checks
      brackets.js               bracket styles for nametag components
      forms.js                  form plumbing; resolves modal answers by name
      text.js                   every user-facing string in the add-on
      settings.js               admin-editable settings, merged over defaults
      peaceful.js               the Peaceful marker; stacks with any system role
      wars.js                   declarations, kill attribution, scoreboard
      warbook.js                renders a finished war into a signed book
      purge.js                  full removal of a player from the system
      ledger.js                 the Clan Ledger and War Map items
      warmap.js                 the placed War Map: interaction and support
      clans.js                  clan domain logic: CRUD, membership, roles
      invites.js                pending invites: issue, list, accept, decline
      requests.js               clan-creation requests: file, approve, deny
      announce.js               global chat notifications, gated by settings
      hooks.js                  identity-changed signal; breaks an import cycle
      display.js                nametag and chat adapter — THE ONLY beta file
      commands.js               custom command registration
      ui.js                     server-ui forms
```

### Build approach

**No bundler, no transpile.** The pack ships as plain ES modules loaded directly by the game, exactly as authored — the smallest possible gap between what is checked and what runs.

Type safety is kept by writing `// @ts-check` JSDoc-annotated JS and running `npx tsc --noEmit` against the real published `.d.ts`. The code is therefore type-checked against the actual API surface with no build step standing between source and shipped pack.

### Manifest

```jsonc
{
  "format_version": 2,
  "header": {
    "name": "Sigil",
    "uuid": "6f467335-f553-4279-8c1b-79e488ba84ce",
    "version": [1, 0, 0],
    "min_engine_version": [1, 26, 40]
  },
  "modules": [
    { "type": "script", "language": "javascript", "entry": "scripts/main.js",
      "uuid": "321c6ad0-6237-4807-8303-6ffbafbcb0ee", "version": [1, 0, 0] }
  ],
  "dependencies": [
    { "module_name": "@minecraft/server",    "version": "2.10.0-beta" },
    { "module_name": "@minecraft/server-ui", "version": "2.1.0" }
  ]
}
```

The third generated UUID `37b15a1a-f323-4c80-a464-5bcb65fc77cb` is held in reserve for a resource pack should one ever be needed. None is needed now — the add-on ships no assets.

---

## 10. Build order

1. Scaffold: `package.json`, `tsconfig.json`, `sigil_bp/manifest.json`, `pack_icon.png`.
2. `config.js`, `format.js`, `storage.js` — foundations, no game state.
3. `players.js` — identity registry.
4. `settings.js` — admin-editable settings merged over defaults.
5. `staff.js` — admin plus staff roles plus permission predicates.
6. `clans.js` — the domain core.
7. `invites.js` — the consent layer on top of membership.
8. `requests.js` — the approval layer on top of creation.
9. `announce.js` — global notifications, gated by settings.
10. `display.js` — nametag, then the chat adapter with its three tiers.
11. `commands.js` — every command from §6.
12. `ui.js` — every screen, including the settings and request-review screens.
13. `items/clan_ledger.json` — the console entry point.
14. `main.js` — wiring and lifecycle.
15. `warbook.js` — pagination and book generation, once the war record carries per-member counts.
16. `tsc --noEmit` must pass clean, and every test suite must pass.
17. `README.md`.

---

## 11. Known limitations, stated up front

- **Chat formatting requires the Beta APIs experimental toggle.** There is no way around it; stable has no chat surface at all. Everything else works without it.
- **Op changes are polled, not evented.** Bedrock raises no event when a player is opped or de-opped, so admin status is re-checked on a timer and can lag by up to one poll interval.

  **Answer: the interval is a setting** — `opPollMinutes`, admin-editable, **default 5 minutes**. Because `system.runInterval` cannot have its period changed after the fact, the poll is registered with `system.runInterval` and its run id kept; changing the setting calls `system.clearRun` on the old id and registers a new one, so a change takes effect immediately rather than at the next server start. Admins who want tighter tracking can lower it; the check itself is one enum comparison per online player, so the cost of a short interval is negligible either way.
- **Joining requires consent; removal does not.** An invited player must accept, but an owner or clan manager removes a member unilaterally. That asymmetry is intentional and matches the requirements.
- **Invites are not push notifications.** An offline invitee learns of the invite when they next join.
- **`PlayerSelector` command arguments cannot target offline players.** The UI covers those cases, including inviting a player who has joined the world before but is offline now.

- **Bans cannot be observed.**

  **Answer: no — not with any current script API, stable or beta.** This was checked against the published type definitions rather than assumed: the `@minecraft/server` surface contains no ban or kick API, no ban list, and no ban event. The only matches for "banned" anywhere in the module are `ContainerRules.bannedItems`, which is about item filtering. `PlayerLeaveAfterEvent` — the one event that fires when a player goes away — carries only `playerId` and `playerName`, with no reason, so a ban is indistinguishable from a normal disconnect. Banning itself happens outside the scripting sandbox entirely: through a dedicated server's allowlist and `permissions.json`, or through Realms/console platform moderation, none of which the script can read.

  **What is provided instead:** an explicit admin action, `/clan:purge <player>`, plus the same action in the staff UI, which scrubs a player from the entire system in one step — clan membership (transferring or disbanding their clan if they owned one), staff role, pending invites, pending creation request, and the name registry. The intended workflow is that an admin bans through their platform's own tooling and then purges here. Making it explicit is also safer than inferring: a script that removed players on a guessed signal would eventually delete a clan leader over a bad connection.
- **A signed book's title is capped at 16 characters** by the engine, so the book itself is titled `War #3`. The full `War #3: Wolves vs Ravens` lives on the item's name, which has no such cap, and is repeated as the heading on page 1.
- **A book is a snapshot.** Signed books are immutable, so a kill correction made after a book was printed will not appear in that copy. Reprinting gives the corrected figures, and the book says so on its last page.
- **Books cap at 50 pages of 256 characters, and about 14 rendered lines.** The line budget is the book UI's, not the API's, so pages are measured in wrapped lines as well as characters. A roster too long for one page continues onto the next with its heading repeated. A war between two full 100-member clans needs roughly twenty pages; past the 50-page cap the tail is truncated with a stated count rather than throwing.
- **One runtime assumption remains in the book path:** that `minecraft:writable_book` carries the `minecraft:book` component and that `signBook` converts it into a written book. The component and its methods are confirmed present in stable 2.9.0, but which base item to instantiate cannot be verified without launching the game. `minecraft:written_book` is the fallback.
- **War history has no global index by design.** Keeping every war forever would have pushed a single all-ids property past the roughly 32 KB dynamic-property ceiling near two thousand wars. History is enumerated from `getDynamicPropertyIds()` instead, which has no such cap; only unfinished wars sit in a stored array.
- Clan names are unique world-wide and case-insensitive.
