# Working on this add-on

Standing rules and the project information worth having before touching
anything. Everything here is general Bedrock add-on practice **except** the
sections and bullets marked **[project]**, which describe this pack specifically
and are the parts to change or drop when reusing this file elsewhere.

---

## The project **[project]**

**Sigil: Clans, Wars & Chat Tags** — a Minecraft Bedrock add-on for player-run
clans, clan wars and chat identity. Two packs: `clan_bp/` (behavior) and
`clan_rp/` (resource).

| Path | What it is |
| --- | --- |
| `clan_bp/scripts/` | The whole system, plain ES modules |
| `clan_bp/scripts/ui/` | The menus, one module per family |
| `clan_bp/scripts/text.js` | Every string a player sees |
| `clan_rp/` | Textures, models, `en_US.lang` |
| `tools/` | Texture generation, audits, the bundler, the text codemod |
| `tests/` | Suites that run the shipped modules under Node |
| `dist/` | Built `.mcaddon` and `.mcpack` files |
| `NEXT_UPDATE.md` | Unverified assumptions and planned expansions |

Runs on `@minecraft/server` 2.x (Scripting V2) with `@minecraft/server-ui`.
`min_engine_version` is 1.26.40. Type safety is `// @ts-check` plus JSDoc,
checked against the real published `.d.ts` — there is no TypeScript source and
no build step, so what ships is what runs.

---

## Finish every round with a version bump

**Every time a set of tasks is completed, bump the version.** This is not
something to ask about or offer; it is part of finishing the work. If a round of
changes is done and the version has not moved, the round is not done.

- **Minor** (`1.2.0` → `1.3.0`) — new behaviour a player or admin can notice: a
  new command, menu, setting, block or item, or a change to what an existing
  feature does.
- **Fix** (`1.2.0` → `1.2.1`) — refinements to what is already there: bug fixes,
  texture and model iterations, wording, layout, internal restructuring with no
  visible change in behaviour.

When a round contains both, the minor bump wins and the fix digit resets to
zero. **The major digit is not covered by this rule** and does not move without
being told.

The user will sometimes say a change "rolls into" the previous one and does not
increment the counter. That overrides the rule for that round.

### Where the version lives **[project]**

Seven fields across four files, plus three descriptions. All of them move
together; `npm run release` refuses to build if any disagree.

- `package.json` — the `"version"` string.
- `clan_bp/manifest.json` — **three** array fields: `header.version`,
  `modules[0].version`, and the version on the dependency entry carrying the
  resource pack's `uuid`. That last must match the resource pack's own header
  version, or the behavior pack asks for a resource pack that does not exist.
- `clan_rp/manifest.json` — **two** array fields: `header.version` and
  `modules[0].version`.

A find-and-replace of the version array (`[1, 9, 0]` → `[1, 10, 0]`) across both
manifests catches all five array fields at once.

**Do not touch the `module_name` dependency versions** — `@minecraft/server` and
`@minecraft/server-ui`. Those are API versions, not the pack's.

Each pack description leads with `v<version> — `. There are three:

- `clan_bp/manifest.json` — `header.description`
- `clan_rp/manifest.json` — `header.description`
- `clan_rp/texts/en_US.lang` — the `pack.description=` line. **This is the one
  Minecraft actually shows** for the resource pack; the manifest string is only
  a fallback. Updating only the manifests leaves the resource pack showing no
  version in the pack list.

`package.json`'s `"description"` is npm metadata, never shown in game, and is
left alone.

Afterwards, delete the previous version's files from `dist/` — artifacts are
named by version and the folder otherwise accumulates a set per release.

---

## Every bump ships with a summary and a commit message

Hand over both in the same reply as the bump, without being asked, at the end
after describing the work. They are written for different readers and should not
be the same sentence.

**Release summary** — one or two sentences on what is new and what changed, in
prose. Add a short clause only if something breaks an existing world and the
user has to act on it. Not a formatted document, not a section per subsystem,
not an artifact. Write it directly in the reply.

**Commit message** — one line, a few words, in the user's own log style. No
body, no bullets, no test counts. Real examples from the log:

```
First release
Bugfixes
Fixed and updated items
Revamped the compass to the ledger. More item fixes. Bracket customization.
Changed Sigil watermark in the menu
```

Brevity here is about summaries and commit messages only. Detailed technical
explanation while working through a problem is welcome.

---

## Choosing between stable and beta script APIs

1. **If a requirement can be met with stable APIs, it must be.** Never reach for
   a beta API out of convenience or because it is more ergonomic.
2. **If it genuinely cannot, do not silently drop the requirement.** Use a beta
   API, but pick the most established one that achieves the goal — prefer
   long-lived beta surfaces over ones that shipped very recently.

Before concluding a feature is impossible, or before choosing beta, **verify
against the real published type definitions** rather than from memory. Grep
`node_modules/@minecraft/server/index.d.ts`. The documentation site sometimes
shows examples for APIs no longer in the stable module, and enumerating a class
in the `.d.ts` has more than once turned up a method that a keyword search
missed.

---

## Comments describe how things work, not how they were decided

Write comments that explain mechanism, logic flow, and anything a reader needs
in order to change the code safely. **Do not** record decision history: what was
tried and rejected, what a previous version did, which bug prompted a change,
what was weighed against what. That belongs in the commit log and
`NEXT_UPDATE.md`.

Empirical facts about engine behaviour are worth keeping, stated as facts —
"the X axis runs opposite to the Z axis here" rather than "this took three
builds to work out".

Match the surrounding density: module headers carry a short orientation, exported
functions carry JSDoc with types, and inline comments explain the non-obvious.

---

## Player-visible text lives in one catalogue **[project]**

Every string a player can see is in `clan_bp/scripts/text.js`, reached as
`TEXT.<namespace>.<key>`. Strings with values in them are functions taking those
values in order, so a translation can move them around the sentence. Formatting
codes stay inside the strings.

- `tools/audit-text.mjs` fails the build on any prose literal written outside the
  catalogue. It tests content, not position: any literal holding two or more
  words is prose wherever it appears.
- `tools/text-codemod.mjs` maintains the catalogue — `check` (wired into the
  audit) fails on two keys holding the same body, `dedupe` merges them, and
  `rename <map.json>` applies key renames across the pack and the tests in one
  pass.
- Key names describe the **role** the string plays, not the sentence it holds:
  `pickerSearchLabel`, not `nameContains`.
- `symbol`, `color` and `board` are keyed by id rather than by meaning and are
  left alone by the codemod.

---

## Art is generated, not drawn **[project]**

Textures come from `tools/make-textures.mjs`, which writes PNGs pixel by pixel
through `tools/pixels.mjs`. To change a texture, change the generator and re-run
it — do not hand-edit the output. When the user supplies hand-drawn artwork,
transcribe it into the generator as a pixel grid.

---

## Verify before claiming anything works

`npm run release` runs the whole chain: `tsc --noEmit`, the audits, every test
suite, then the bundler. **It must be green before work is reported as done.**

- `npm run check` — types only
- `npm run audit` — uncatalogued strings, duplicate catalogue bodies, import
  cycles
- `npm test` — the suites
- `npm run build` — bundle to `dist/`

The bundler is not just a zip step: it validates the manifests, every version
field, every description prefix, that each script import resolves on disk, and
that every texture and geometry a JSON file names actually exists.

Tests run the **shipped** modules — the harness copies `clan_bp/scripts/` into
`tests/.generated/` with only the `@minecraft/server` import rewritten to a
mock. What is tested is what ships, not a reimplementation.

---

## Architecture rules that the audits enforce

- **No import cycles.** `tools/audit-imports.mjs` fails on one. When two modules
  genuinely need to know about each other, the fact travels through
  `hooks.js` — a small event bus — rather than closing the loop. That is how
  identity changes reach the renderer, and how the alliance module vetoes a war
  declaration without `wars.js` importing it. **[project]**
- **One direction inside the menu family.** `ui/shared.js` holds what the menus
  are built from and opens no screen of its own; `ui.js` is the front door and
  the barrel that re-exports every screen the rest of the pack opens directly.
  Nothing outside `ui/` imports a `ui/` module. **[project]**
- **Writes that change a rendered identity go through `storage.setRendered`**,
  which persists and announces in one step, so a mutator cannot do the first and
  forget the second. **[project]**

---

## Working habits

- **Isolate one variable at a time.** Changing two things and then attributing
  the result to one of them has produced wrong diagnoses here more than once.
- **Do not claim a causal link that has not been tested.** A hypothesis stated
  once becomes a fact if it is repeated; say "untested" and name the check that
  would settle it. The user tests in-game and reports back — give them the
  specific thing to look at, and say which observations would *not* prove it.
- **In-game behaviour is not knowable from here.** Rendering, placement,
  collision and font coverage need a live world. Record such assumptions in
  `NEXT_UPDATE.md` with the exact check that resolves them, rather than
  asserting them.
- **Prefer Python patch scripts over shell heredocs** for multi-line source
  edits. `\n` inside a heredoc has repeatedly become a literal newline and
  corrupted JS string literals; em dashes have been mangled the same way. Write
  the script with the Write tool, or anchor on text containing neither.
- **Re-compact JSON after writing it with `json.dumps`**, which explodes short
  numeric arrays across lines. The block and model files are kept compact.
