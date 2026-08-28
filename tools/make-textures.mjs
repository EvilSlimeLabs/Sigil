// Generates the resource pack's textures.
//
//   node tools/make-textures.mjs
//
// The art is produced by code rather than committed as opaque binaries, so it
// can be reviewed in a diff, tweaked by changing a number, and regenerated.
// Randomness runs through a seeded generator, so the output is identical on
// every run — a texture that changed every build would make diffs useless.
//
//   clan_war_map.png   64x64  a torn, stained campaign map
//   clan_compass.png   32x32  a brass compass with a red north needle

import { writePng, canvas, set, get, opaque, clear, shade, line, disc, triangle, rng } from './pixels.mjs';

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
  for (const [mx, my, mw] of [
    [36, 24, 4],
    [43, 21, 5],
    [50, 26, 4],
    [45, 30, 3],
  ]) {
    for (let row = 0; row <= mw; row++) {
      const half = mw - row;
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
  triangle(c, [cx, cy - 7], [cx - 2, cy - 3], [cx + 2, cy - 3], MAP.red);

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

// ── The compass ───────────────────────────────────────────────────────────

const COMPASS = {
  rimDark: [92, 66, 26],
  rimBrass: [186, 146, 62],
  rimLight: [226, 194, 108],
  face: [232, 224, 202],
  faceShade: [206, 196, 172],
  tick: [64, 56, 44],
  needleRed: [190, 46, 42],
  needleGrey: [78, 84, 96],
  pin: [48, 42, 34],
};

function makeCompass() {
  const S = 32;
  const c = canvas(S, S);
  const cx = 15.5;
  const cy = 15.5;

  // Brass housing, then the dial recessed inside it.
  disc(c, cx, cy, 14.6, COMPASS.rimDark);
  disc(c, cx, cy, 13.4, COMPASS.rimBrass);
  disc(c, cx, cy, 11.6, COMPASS.rimDark);
  disc(c, cx, cy, 10.8, COMPASS.face);

  // A highlight on the upper-left of the rim, so it reads as metal.
  for (let a = 190; a <= 250; a += 3) {
    const r = (a * Math.PI) / 180;
    set(c, Math.round(cx + Math.cos(r) * 13), Math.round(cy + Math.sin(r) * 13), COMPASS.rimLight);
    set(c, Math.round(cx + Math.cos(r) * 12.2), Math.round(cy + Math.sin(r) * 12.2), COMPASS.rimLight);
  }

  // Shading in the lower-right of the dial gives the face some depth.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > 7.5 && d < 10.8 && x + y > 34) set(c, x, y, COMPASS.faceShade);
    }
  }

  // Cardinal ticks.
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    for (let r = 8; r <= 10; r++) {
      set(c, Math.round(cx + dx * r), Math.round(cy + dy * r), COMPASS.tick);
    }
  }
  // Intercardinal ticks, one pixel each.
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const r = 9.5 / Math.SQRT2;
    set(c, Math.round(cx + dx * r), Math.round(cy + dy * r), COMPASS.tick);
  }

  // The needle: red to the north, grey to the south, pinned at the centre.
  triangle(c, [cx, cy - 9.5], [cx - 2.2, cy + 0.5], [cx + 2.2, cy + 0.5], COMPASS.needleRed);
  triangle(c, [cx, cy + 9.5], [cx - 2.2, cy - 0.5], [cx + 2.2, cy - 0.5], COMPASS.needleGrey);
  disc(c, cx, cy, 1.2, COMPASS.pin);

  return c;
}

// ── Output ────────────────────────────────────────────────────────────────

const out = 'clan_rp/textures';
console.log('clan_war_map.png ', writePng(`${out}/blocks/clan_war_map.png`, makeWarMap()), 'bytes');
console.log('clan_compass.png ', writePng(`${out}/items/clan_compass.png`, makeCompass()), 'bytes');
