// Generates the resource pack's textures.
//
//   node tools/make-textures.mjs
//
// The art is produced by code rather than committed as opaque binaries, so it
// can be reviewed in a diff, tweaked by changing a number, and regenerated.
// Randomness runs through a seeded generator, so the output is identical on
// every run — a texture that changed every build would make diffs useless.
//
//   clan_war_map.png       64x64  a torn, stained campaign map
//   clan_war_map_item.png  16x16  the same map as an inventory icon
//   clan_ledger.png        16x16  the clan's ledger: crimson boards, gold S

import { writePng, canvas, set, opaque, clear, shade, line, triangle, rng } from './pixels.mjs';

// ── The war map ───────────────────────────────────────────────────────────

const MAP = {
  parchment: [222, 198, 152],
  parchmentLight: [234, 212, 170],
  parchmentDark: [202, 174, 126],
  aged: [176, 144, 96],
  scorch: [120, 92, 58],
  ink: [78, 58, 38],
  inkSoft: [116, 94, 68],
  water: [118, 158, 184],
  waterDeep: [96, 136, 166],
  forest: [96, 122, 78],
  red: [178, 46, 40],
  redDark: [130, 30, 26],
};

function makeWarMap() {
  const S = 64;
  const c = canvas(S, S);
  const rand = rng(0x5c1a4d);

  // 1. The sheet's torn outline. Each edge gets a random walk, so the border
  //    wanders instead of sitting on a straight line.
  const walk = (n, max) => {
    const out = [];
    let v = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      v += Math.floor(rand() * 3) - 1;
      v = Math.max(0, Math.min(max, v));
      out.push(v);
    }
    return out;
  };
  const top = walk(S, 5);
  const bottom = walk(S, 5);
  const left = walk(S, 5);
  const right = walk(S, 5);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const inside = y >= top[x] && y < S - bottom[x] && x >= left[y] && x < S - right[y];
      if (!inside) continue;
      // A little grain, not a lot: enough that the sheet is not perfectly
      // flat, far short of reading as noise.
      const r = rand();
      const tone = r < 0.07 ? MAP.parchmentLight : r < 0.14 ? MAP.parchmentDark : MAP.parchment;
      set(c, x, y, tone);
    }
  }

  // 2. Bites torn out of the edges, and a couple of holes worn through.
  const bite = (x, y, r) => {
    for (let yy = y - r; yy <= y + r; yy++) {
      for (let xx = x - r; xx <= x + r; xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r + rand() * 2) clear(c, xx, yy);
      }
    }
  };
  bite(2, 20, 4);
  bite(61, 44, 5);
  bite(26, 1, 4);
  bite(48, 62, 4);
  bite(9, 58, 3);
  bite(19, 33, 2); // worn through
  bite(52, 12, 2);

  // 3. A tear running in from the right edge.
  let tx = 63;
  let ty = 30;
  for (let i = 0; i < 14; i++) {
    clear(c, tx, ty);
    clear(c, tx, ty + 1);
    tx -= 1;
    ty += Math.floor(rand() * 3) - 1;
  }

  // 4. Scorch and age around every torn boundary, including the holes. Done as
  //    a distance pass so the interior tears darken exactly like the outside.
  const edgeDist = new Int8Array(S * S).fill(9);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!opaque(c, x, y)) continue;
      let best = 9;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (!opaque(c, x + dx, y + dy)) {
            best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dy)));
          }
        }
      }
      edgeDist[y * S + x] = best;
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = edgeDist[y * S + x];
      if (d === 1) set(c, x, y, rand() < 0.6 ? MAP.scorch : MAP.aged);
      else if (d === 2) set(c, x, y, rand() < 0.45 ? MAP.aged : MAP.parchmentDark);
    }
  }

  // The silhouette as it stands now, used at the end to clip everything
  // drawn on top of it.
  const mask = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) mask[y * S + x] = opaque(c, x, y) ? 1 : 0;
  }

  const inside = (x, y) => edgeDist[y * S + x] >= 3;
  const draw = (x, y, rgb) => {
    if (inside(x, y)) set(c, x, y, rgb);
  };

  // 5. Coastline: sea to the west, land to the east.
  const coast = (y) => 20 + Math.round(7 * Math.sin(y / 9) + 4 * Math.sin(y / 3.5));
  for (let y = 0; y < S; y++) {
    const edge = coast(y);
    for (let x = 0; x < edge; x++) {
      draw(x, y, x < edge - 5 ? MAP.waterDeep : MAP.water);
    }
    draw(edge, y, MAP.inkSoft);
  }

  // 6. A river running inland from the coast.
  let rx = coast(38);
  let ry = 38;
  for (let i = 0; i < 26; i++) {
    draw(rx, ry, MAP.water);
    rx += 1;
    ry += i % 3 === 0 ? (rand() < 0.5 ? -1 : 1) : 0;
  }

  // 7. Mountains as little carets, forest as stipple.
  //
  // The peak is the first row and the base the last, so each caret points up —
  // which on this sheet is north, the way a hand-drawn chart marks high ground.
  // They were built the other way up at first and read as pits.
  //
  // Shading is by column rather than by row, so it survives the flip untouched:
  // west of the peak is the lit face, east of it the shadowed one.
  for (const [mx, my, mw] of [
    [36, 24, 4],
    [43, 21, 5],
    [50, 26, 4],
    [45, 30, 3],
  ]) {
    for (let row = 0; row <= mw; row++) {
      const half = row;
      for (let i = -half; i <= half; i++) {
        draw(mx + i, my + row, i < 0 ? MAP.inkSoft : MAP.ink);
      }
    }
  }
  for (let i = 0; i < 34; i++) {
    const fx = 30 + Math.floor(rand() * 14);
    const fy = 42 + Math.floor(rand() * 12);
    draw(fx, fy, MAP.forest);
  }

  // 8. A dashed advance route ending at the objective.
  const route = [
    [25, 51],
    [31, 44],
    [34, 37],
    [41, 30],
    [44, 23],
  ];
  let dashStep = 0;
  for (let leg = 0; leg < route.length - 1; leg++) {
    const [ax, ay] = route[leg];
    const [bx, by] = route[leg + 1];
    const span = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let i = 0; i < span; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / span);
      const y = Math.round(ay + ((by - ay) * i) / span);
      // Three on, two off, measured along the path rather than per segment.
      if (dashStep % 5 < 3) draw(x, y, MAP.redDark);
      dashStep += 1;
    }
  }

  // 9. The objective, marked with an X.
  for (let i = -3; i <= 3; i++) {
    draw(47 + i, 17 + i, MAP.red);
    draw(47 + i, 17 - i, MAP.red);
  }

  for (const [sx, sy] of [
    [33, 33],
    [52, 38],
    [29, 24],
  ]) {
    draw(sx, sy, MAP.ink);
    draw(sx + 1, sy, MAP.ink);
    draw(sx, sy + 1, MAP.ink);
    draw(sx + 1, sy + 1, MAP.ink);
  }

  // 10. A second position, flagged.
  line(c, 25, 47, 25, 53, MAP.redDark);
  triangle(c, [26, 47], [31, 49], [26, 51], MAP.red);

  // 11. Compass rose, lower left on the land side.
  const cx = 14;
  const cy = 52;
  for (let i = 1; i <= 5; i++) {
    draw(cx, cy - i, MAP.ink);
    draw(cx, cy + i, MAP.ink);
    draw(cx - i, cy, MAP.ink);
    draw(cx + i, cy, MAP.ink);
  }
  for (let i = 1; i <= 2; i++) {
    draw(cx - i, cy - i, MAP.inkSoft);
    draw(cx + i, cy - i, MAP.inkSoft);
    draw(cx - i, cy + i, MAP.inkSoft);
    draw(cx + i, cy + i, MAP.inkSoft);
  }
  // The north mark, kept small: drawn any larger it outweighs the
  // rose it sits on, and because the rose's arm is one pixel wide the mark has
  // to be symmetric about that pixel's centre or the whole rose reads as
  // off-centre. Hence the half-pixel offsets rather than round numbers.
  triangle(c, [cx + 0.5, cy - 5.8], [cx - 1, cy - 3], [cx + 2, cy - 3], MAP.red);

  // 12. Fold creases, then coffee-coloured stains.
  for (let y = 0; y < S; y++) shade(c, 31, y, -14);
  for (let x = 0; x < S; x++) shade(c, x, 30, -12);
  for (const [sx, sy, sr] of [
    [17, 14, 5],
    [52, 47, 6],
    [37, 8, 4],
  ]) {
    for (let y = sy - sr; y <= sy + sr; y++) {
      for (let x = sx - sr; x <= sx + sr; x++) {
        const d = Math.hypot(x - sx, y - sy);
        if (d <= sr && rand() < 1 - d / sr) shade(c, x, y, -16);
      }
    }
  }

  // 13. Re-apply the torn silhouette. Lines and triangles paint without
  //     regard for the sheet's edges, so anything that strayed past a tear is
  //     erased here rather than each call site having to clip itself.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (mask[y * S + x] === 0) clear(c, x, y);
    }
  }

  return c;
}

// ── The Clan Ledger ───────────────────────────────────────────────────────
//
// This one was drawn by hand, in an editor, and transcribed here rather than
// designed in code. Three attempts at a compass and several sheets of sigils
// went past before the shape was settled, and the last step was the author
// pushing pixels around directly — so what follows is that file, exactly, as a
// grid.
//
// It is kept as a grid rather than committed as a PNG for the same reason
// everything else here is: the art stays reviewable in a diff, and a change to
// one pixel shows up as a change to one character. The generator is the source
// of truth; `clan_ledger.png` is its output.
//
// What the drawing does, since none of it is obvious from the numbers: the
// spine is a deep-crimson stripe down the left rather than wood, gold corner
// pieces bracket the board top and bottom, and the paper edge sits along the
// bottom in a muted tone instead of down the right in white — which is what
// gives the front board a clean boundary on every side. The ribbon marker
// drops out of the foot.

const LEDGER_PALETTE = {
  k: [38, 32, 30], // outline
  d: [61, 14, 23], // spine, deepest crimson
  c: [96, 22, 36], // board, shadowed
  C: [142, 36, 52], // board
  G: [240, 205, 122], // gold: corners, and the S
  p: [206, 196, 170], // paper edge, muted — not white
};

const LEDGER_PIXELS = [
  '.kdGGcccccccGGk.',
  '.kdGCCCCCCCCCGk.',
  '.kdcCCCCGGCCCck.',
  '.kdcCCGGCGGCCck.',
  '.kdcCCGGCCCCCck.',
  '.kdcCCCGGGCCCck.',
  '.kdcCCCCCGGCCck.',
  '.kdcCCGGCGGCCck.',
  '.kdcCCCCGGCCCck.',
  '.kdGCCCCCCCCCGk.',
  '.kdGGcccccccGGk.',
  '.kdkkkkkkkkkkkk.',
  '.kkpppppppppppk.',
  '.kkpppppkCCkppk.',
  '..kkkkkkkCCkkkk.',
  '........kCCk....',
];

function makeLedger() {
  const S = LEDGER_PIXELS.length;
  const c = canvas(S, S);

  LEDGER_PIXELS.forEach((row, y) => {
    if (row.length !== S) {
      throw new Error(`ledger row ${y} is ${row.length} pixels, expected ${S}`);
    }
    [...row].forEach((key, x) => {
      if (key === '.') return;
      const rgb = LEDGER_PALETTE[key];
      if (!rgb) throw new Error(`ledger row ${y} uses "${key}", which is not in the palette`);
      set(c, x, y, rgb);
    });
  });

  return c;
}

// ── The war map's item icon ───────────────────────────────────────────────
//
// A block normally gets its inventory icon from a render of its own model, and
// that is what the War Map used until it needed a real item to carry a stack
// size of one. An item has to name an icon, so here is one.
//
// It is drawn fresh at 16x16 rather than pointing the icon at the 64x64 block
// texture: scaled down to a slot, the torn edges and route markings on that
// one turn to mud. What survives at sixteen pixels is a sheet, a fold and a
// red cross, so that is what this is.

const MAP_ICON = {
  edge: [150, 120, 78],
  parchment: [222, 198, 152],
  parchmentLight: [236, 214, 172],
  parchmentDark: [198, 170, 122],
  ink: [86, 66, 44],
  red: [178, 46, 40],
};

function makeWarMapIcon() {
  const S = 16;
  const c = canvas(S, S);

  // The sheet: an inset rectangle with the corners knocked off, so it reads as
  // a loose page rather than a card.
  for (let y = 2; y <= 13; y++) {
    for (let x = 1; x <= 14; x++) {
      const corner =
        (x <= 2 && y <= 3) || (x >= 13 && y <= 3) || (x <= 2 && y >= 12) || (x >= 13 && y >= 12);
      if (corner) continue;
      set(c, x, y, MAP_ICON.parchment);
    }
  }

  // A darker rim one pixel in from the silhouette, which is what gives a flat
  // shape depth at this size.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!opaque(c, x, y)) continue;
      const exposed =
        !opaque(c, x - 1, y) || !opaque(c, x + 1, y) || !opaque(c, x, y - 1) || !opaque(c, x, y + 1);
      if (exposed) set(c, x, y, MAP_ICON.edge);
    }
  }

  // One light source, upper left.
  for (const [x, y] of [
    [3, 3],
    [4, 3],
    [5, 3],
    [3, 4],
    [2, 5],
    [2, 6],
  ]) {
    if (opaque(c, x, y)) set(c, x, y, MAP_ICON.parchmentLight);
  }

  // One fold, down the middle. A second crease across it turned the whole icon
  // into a plus sign at this size, which is not what a chart looks like.
  for (let y = 3; y <= 12; y++) if (opaque(c, 8, y)) set(c, 8, y, MAP_ICON.parchmentDark);

  // A few ink marks standing in for terrain, kept to the left of the fold so
  // the right half is clear for the objective.
  for (const [x, y] of [
    [4, 5],
    [5, 5],
    [4, 6],
    [3, 9],
    [4, 10],
    [5, 10],
    [6, 7],
  ]) {
    if (opaque(c, x, y)) set(c, x, y, MAP_ICON.ink);
  }

  // The objective: a three-by-three cross, which is the smallest X that still
  // reads as one rather than as a smudge.
  for (let i = -1; i <= 1; i++) {
    if (opaque(c, 11 + i, 9 + i)) set(c, 11 + i, 9 + i, MAP_ICON.red);
    if (opaque(c, 11 + i, 9 - i)) set(c, 11 + i, 9 - i, MAP_ICON.red);
  }

  return c;
}

// ── Output ────────────────────────────────────────────────────────────────

const out = 'sigil_rp/textures';
console.log('clan_war_map.png      ', writePng(`${out}/blocks/clan_war_map.png`, makeWarMap()), 'bytes');
console.log(
  'clan_war_map_item.png ',
  writePng(`${out}/items/clan_war_map_item.png`, makeWarMapIcon()),
  'bytes',
);
console.log('clan_ledger.png       ', writePng(`${out}/items/clan_ledger.png`, makeLedger()), 'bytes');
