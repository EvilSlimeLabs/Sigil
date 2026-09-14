/**
 * Packages the two packs into an installable release.
 *
 * A .mcaddon is just a zip, but a zip that fails tells you almost nothing about
 * why: Minecraft rejects a bad manifest with one line in the content log, and a
 * missing texture only shows up as a purple block ten minutes into a world. So
 * this checks the seams *before* it writes anything — that the behavior pack's
 * dependency really points at the resource pack shipped beside it, that every
 * texture and geometry the blocks name exists, and that the API versions in the
 * manifest match the ones the code was type-checked against.
 *
 * The zip is written by hand rather than with a library, for the same reason the
 * textures are drawn in code: no dependency to trust, and byte-identical output
 * on every run.
 *
 * Produces the .mcaddon a player double-clicks, and the two .mcpack files a
 * server owner drops into a world's pack folders separately.
 *
 *   node tools/bundle.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DIST = path.join(ROOT, 'dist');

/** The pack name carries punctuation that has no place in a filename. */
const RELEASE = 'Sigil';

const BP = 'sigil_bp';
const RP = 'sigil_rp';

/** Editor and OS droppings, which must never reach a release. */
const JUNK = /^(\.|Thumbs\.db$|desktop\.ini$|.*\.tmp$)/i;

// ── ZIP writing ───────────────────────────────────────────────────────────

const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A fixed 1980-01-01 stamp, so rebuilding the same source gives the same bytes.
// Real timestamps would make every release differ from the last for no reason.
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;

/**
 * Builds a zip from `[{ name, data }]`. Names use forward slashes whatever the
 * platform — a backslash in a zip entry is a filename on Linux, not a folder.
 */
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    // Storing beats deflating when the file is already compressed, as the PNGs are.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x031e, 4); // made by unix, so the mode below is honoured
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const count = entries.length;
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ── Reading the packs ─────────────────────────────────────────────────────

/** @type {string[]} */
const problems = [];
const fail = (what) => problems.push(what);

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const ver = (v) => (Array.isArray(v) ? v.join('.') : String(v));

/** Every value stored under `key`, at any depth. */
function valuesAt(node, key, found = []) {
  if (Array.isArray(node)) {
    for (const v of node) valuesAt(v, key, found);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) found.push(v);
      valuesAt(v, key, found);
    }
  }
  return found;
}

/**
 * Files in a pack, as zip entries rooted at the pack's own contents — a .mcpack
 * is only recognised when its manifest.json sits at the top of the zip, not one
 * folder down.
 */
function collect(dir) {
  const entries = [];
  (function walk(rel) {
    for (const name of fs.readdirSync(path.join(ROOT, dir, rel)).sort()) {
      if (JUNK.test(name)) continue;
      const child = rel ? `${rel}/${name}` : name;
      if (fs.statSync(path.join(ROOT, dir, child)).isDirectory()) walk(child);
      else entries.push({ name: child, data: fs.readFileSync(path.join(ROOT, dir, child)) });
    }
  })('');
  return entries;
}

const pkg = readJson('package.json');
const bp = readJson(`${BP}/manifest.json`);
const rp = readJson(`${RP}/manifest.json`);

// ── Checks: the manifests ─────────────────────────────────────────────────

// One version for the whole release. A behavior pack that says 1.0.1 while the
// resource pack still says 1.0.0 asks for a dependency it no longer matches.
const version = ver(bp.header.version);
if (ver(rp.header.version) !== version) {
  fail(`version mismatch: ${BP} is ${version}, ${RP} is ${ver(rp.header.version)}`);
}
if (pkg.version !== version) {
  fail(`version mismatch: manifests are ${version}, package.json is ${pkg.version}`);
}

// The pack list shows a description and no version, so the description leads
// with one. That buys a version you can read in-game at the cost of a string
// that can drift from the manifest beside it — which is what this stops. The
// resource pack's description is also translated, and the .lang entry is the
// one the game actually shows, so it is checked too rather than assumed to
// have been updated alongside the manifest.
const versionTag = `v${version} `;
/** @type {Array<[string, string | undefined]>} */
const described = [
  [`${BP}/manifest.json`, bp.header.description],
  [`${RP}/manifest.json`, rp.header.description],
  [
    `${RP}/texts/en_US.lang`,
    fs
      .readFileSync(path.join(ROOT, RP, 'texts', 'en_US.lang'), 'utf8')
      .split(/\r?\n/)
      .find((line) => line.startsWith('pack.description='))
      ?.slice('pack.description='.length),
  ],
];
for (const [where, description] of described) {
  if (description === undefined) fail(`${where} has no pack description`);
  else if (!description.startsWith(versionTag)) {
    fail(`${where} description does not start with "${versionTag.trim()}": ${description}`);
  }
}

// Every UUID in the release must be its own. Minecraft indexes packs by UUID and
// quietly keeps only one of a colliding pair.
const uuids = new Map();
for (const [label, manifest] of [
  [BP, bp],
  [RP, rp],
]) {
  for (const [what, uuid] of [
    ['header', manifest.header.uuid],
    ...manifest.modules.map((m, i) => [`module ${i}`, m.uuid]),
  ]) {
    const seen = uuids.get(uuid);
    if (seen) fail(`duplicate uuid ${uuid}: ${seen} and ${label} ${what}`);
    else uuids.set(uuid, `${label} ${what}`);
  }
}

// The behavior pack has to point at the resource pack travelling with it.
const packDep = (bp.dependencies ?? []).find((d) => d.uuid);
if (!packDep) {
  fail(`${BP} declares no dependency on ${RP}, so the textures will not follow it`);
} else if (packDep.uuid !== rp.header.uuid) {
  fail(`${BP} depends on uuid ${packDep.uuid}, but ${RP} is ${rp.header.uuid}`);
} else if (ver(packDep.version) !== ver(rp.header.version)) {
  fail(`${BP} wants ${RP} ${ver(packDep.version)}, but it is ${ver(rp.header.version)}`);
}

// The API versions in the manifest decide what the game hands the scripts. If
// they drift from the packages tsc checked against, the type check is fiction.
for (const dep of bp.dependencies ?? []) {
  if (!dep.module_name) continue;
  const installed = (pkg.devDependencies?.[dep.module_name] ?? '').replace(/^[\^~]/, '');
  if (!installed) fail(`manifest needs ${dep.module_name}, which package.json does not install`);
  else if (!installed.startsWith(dep.version)) {
    fail(`manifest wants ${dep.module_name} ${dep.version}, but ${installed} is installed`);
  }
}

if (ver(bp.header.min_engine_version) !== ver(rp.header.min_engine_version)) {
  fail('min_engine_version differs between the packs');
}

const script = bp.modules.find((m) => m.type === 'script');
if (!script) fail(`${BP} declares no script module`);
else if (!exists(`${BP}/${script.entry}`)) fail(`script entry ${script.entry} does not exist`);

for (const dir of [BP, RP]) {
  if (!exists(`${dir}/pack_icon.png`)) fail(`${dir} has no pack_icon.png`);
}

// ── Checks: the assets the packs name ─────────────────────────────────────

// An import that resolves in the editor but not on disk is a pack that loads to
// a blank error. Cycles are audit-imports.mjs's job; this only asks whether the
// file is there, and Windows' case-insensitive lookup means the name must match too.
(function scripts(rel) {
  for (const name of fs.readdirSync(path.join(ROOT, BP, 'scripts', rel))) {
    const file = rel ? `${rel}/${name}` : name;
    if (fs.statSync(path.join(ROOT, BP, 'scripts', file)).isDirectory()) {
      scripts(file);
      continue;
    }
    if (!name.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(ROOT, BP, 'scripts', file), 'utf8');
    for (const [, target] of src.matchAll(/^\s*(?:import|export)[^'"]*['"](\.[^'"]+)['"]/gm)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      if (!exists(`${BP}/scripts/${resolved}`)) fail(`${file} imports missing ${target}`);
    }
  }
})('');

// Texture atlases: the key a block or item names has to be in the atlas, and the
// file the atlas names has to be on disk.
/** @type {Record<string, string[]>} */
const atlases = {};
for (const [atlas, file] of [
  ['terrain', 'terrain_texture.json'],
  ['item', 'item_texture.json'],
]) {
  const data = readJson(`${RP}/textures/${file}`);
  atlases[atlas] = Object.keys(data.texture_data ?? {});
  for (const [key, entry] of Object.entries(data.texture_data ?? {})) {
    for (const tex of [entry.textures].flat()) {
      const texture = typeof tex === 'string' ? tex : tex?.path;
      if (!['.png', '.tga'].some((ext) => exists(`${RP}/${texture}${ext}`))) {
        fail(`${atlas} atlas key "${key}" points at ${texture}, which is not there`);
      }
    }
  }
}

// Geometry a block asks for has to be a model the resource pack actually holds.
const geometries = [];
(function models(rel) {
  for (const name of fs.readdirSync(path.join(ROOT, rel))) {
    const child = `${rel}/${name}`;
    if (fs.statSync(path.join(ROOT, child)).isDirectory()) models(child);
    else if (name.endsWith('.geo.json')) {
      geometries.push(...valuesAt(readJson(child), 'description').map((d) => d.identifier));
    }
  }
})(`${RP}/models`);

for (const file of fs.readdirSync(path.join(ROOT, BP, 'blocks'))) {
  const block = readJson(`${BP}/blocks/${file}`);
  for (const geo of valuesAt(block, 'minecraft:geometry')) {
    const id = typeof geo === 'string' ? geo : geo.identifier;
    if (!geometries.includes(id)) fail(`blocks/${file} uses ${id}, which no model defines`);
  }
  for (const instances of valuesAt(block, 'minecraft:material_instances')) {
    for (const instance of Object.values(instances)) {
      const texture = instance?.texture;
      if (texture && !atlases.terrain.includes(texture)) {
        fail(`blocks/${file} uses texture "${texture}", which the terrain atlas lacks`);
      }
    }
  }
}

for (const file of fs.readdirSync(path.join(ROOT, BP, 'items'))) {
  for (const icon of valuesAt(readJson(`${BP}/items/${file}`), 'minecraft:icon')) {
    const key = typeof icon === 'string' ? icon : (icon.texture ?? icon.textures);
    if (key && !atlases.item.includes(key)) {
      fail(`items/${file} uses icon "${key}", which the item atlas lacks`);
    }
  }
}

for (const code of readJson(`${RP}/texts/languages.json`)) {
  if (!exists(`${RP}/texts/${code}.lang`)) fail(`languages.json lists ${code}, with no ${code}.lang`);
}

// ── Writing the release ───────────────────────────────────────────────────

if (problems.length > 0) {
  for (const problem of problems) console.log(`  ${problem}`);
  console.log(`\nbundle: ${problems.length} problem(s), nothing written`);
  process.exitCode = 1;
} else {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const write = (name, bytes, count) => {
    fs.writeFileSync(path.join(DIST, name), bytes);
    console.log(`  dist/${name}  ${String(count).padStart(3)} files  ${kb(bytes.length)}`);
    return bytes;
  };

  // Each pack ships on its own too, for dropping into a server's world folders.
  const packs = [
    [`${RELEASE}-BP-${version}.mcpack`, collect(BP)],
    [`${RELEASE}-RP-${version}.mcpack`, collect(RP)],
  ].map(([name, entries]) => ({ name, data: write(name, zip(entries), entries.length) }));

  // The .mcaddon is those same two .mcpack files in one zip, which is the shape
  // Microsoft's own mcaddonTask emits — one double-click installs the add-on.
  write(`${RELEASE}-${version}.mcaddon`, zip(packs), packs.length);

  console.log(`\nbundle: ${bp.header.name} ${version}, ready to install`);
}
