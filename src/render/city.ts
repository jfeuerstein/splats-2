// The static world as tiles of world-anchored splats.
//
// Every splat sits on a fixed world-space grid cell of its surface and carries two palette
// indices (painted, pale) baked from world-space sun light and material, plus a per-splat
// paint threshold. Nothing here depends on the camera, so colour cannot swim.
//
// A tile is a patch of surface (or one prop) that can produce its splats at any of four
// levels of detail whose cell size doubles (CELLS). The selector in pool.ts decides levels.

import { district, P, HALF, LOT, N, type Lot, type Prop } from "../world/district";
import { anchorPos, type Anchor, type V3 } from "../sim/world";
import { C, wallFamily, roofFamily, windowColour } from "./palette";

export const CELLS = [0.4, 0.8, 1.6, 3.2] as const;
export const LEVELS = CELLS.length;
/** Splat radius as a fraction of its cell at the reference tuning (render radius is scaled live by T.splatScale / this). */
export const REF_SPLAT_SCALE = 0.72;

/** Sun direction (towards the sun), normalised. From the east, a little behind a camera heading -z. */
const SUN: V3 = (() => {
  const v: V3 = [0.55, 0.78, 0.36];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
export const SUN_DIR: Readonly<V3> = SUN;

// ------------------------------------------------------------------ splat output buffer
export class SplatBuf {
  n = 0;
  x = new Float32Array(4096);
  y = new Float32Array(4096);
  z = new Float32Array(4096);
  r = new Float32Array(4096);
  /** painted | pale << 8 | threshold << 16 */
  code = new Uint32Array(4096);
  reset(): void { this.n = 0; }
  push(x: number, y: number, z: number, r: number, painted: number, pale: number): void {
    if (this.n === this.x.length) this.grow();
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.r[i] = r;
    this.code[i] = painted | (pale << 8) | (thresh(x, y, z) << 16);
  }
  private grow(): void {
    const m = this.x.length * 2;
    const f = (a: Float32Array) => { const b = new Float32Array(m); b.set(a); return b; };
    this.x = f(this.x); this.y = f(this.y); this.z = f(this.z); this.r = f(this.r);
    const c = new Uint32Array(m); c.set(this.code); this.code = c;
  }
}

function ihash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}
function hash01(a: number, b: number, c = 0): number { return ihash(a, b, c) / 4294967296; }
/** Per-splat paint threshold 0..254 from its world position (deterministic). */
function thresh(x: number, y: number, z: number): number {
  return ihash(Math.round(x * 8), Math.round(y * 8) + 7919, Math.round(z * 8)) % 255;
}

// ------------------------------------------------------------------ lot heights / shadows
const L2 = 2 * N;
const heights = new Float32Array(L2 * L2);
let maxH = 0;
let lotsByIndex: Lot[] = [];

function lotIx(x: number, z: number): number {
  const bx = Math.floor(x / P), u = x - bx * P;
  if (u < HALF || u >= P - HALF) return -1;
  const w = -z, bz = Math.floor(w / P), v = w - bz * P;
  if (v < HALF || v >= P - HALF) return -1;
  const lx = 2 * bx + (u >= HALF + LOT ? 1 : 0), lz = 2 * bz + (v >= HALF + LOT ? 1 : 0);
  if (lx < 0 || lz < 0 || lx >= L2 || lz >= L2) return -1;
  return lx * L2 + lz;
}
export function roofAt(x: number, z: number): number {
  const i = lotIx(x, z);
  return i < 0 ? 0 : heights[i];
}
/** True if the point cannot see the sun (marching the lot height field). */
function shadowed(x: number, y: number, z: number): boolean {
  const step = 0.5;
  for (let t = 0.3; ; t += step) {
    const py = y + SUN[1] * t;
    if (py > maxH) return false;
    if (roofAt(x + SUN[0] * t, z + SUN[2] * t) > py) return true;
  }
}
function sunLit(nx: number, ny: number, nz: number, x: number, y: number, z: number): boolean {
  if (nx * SUN[0] + ny * SUN[1] + nz * SUN[2] < 0.05) return false;
  return !shadowed(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05);
}

// ------------------------------------------------------------------ tiles
export interface Tile {
  /** AABB */
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number;
  /** Outward normal for back-face culling (0,0,0 = none). */
  nx: number; ny: number; nz: number;
  /** Plane offset: visible when n·cam > d - margin. */
  d: number;
  maxLevel: number;
  /** Estimated splat count per level. */
  est: number[];
  /** Exact counts once generated (-1 = unknown). */
  exact: number[];
  /** Splat origin snapped to the 8 m grid (centres are stored relative to it). */
  ox: number; oz: number;
  gen: (level: number, out: SplatBuf) => void;
  // selector state
  level: number; want: number; dist: number; pages: number[];
}

function mkTile(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, n: V3 | null, maxLevel: number, est: number[], gen: Tile["gen"]): Tile {
  const nx = n ? n[0] : 0, ny = n ? n[1] : 0, nz = n ? n[2] : 0;
  // plane through the AABB face the normal points out of
  const d = n ? nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) : 0;
  return {
    x0, y0, z0, x1, y1, z1, nx, ny, nz, d, maxLevel, est, exact: [-1, -1, -1, -1],
    ox: Math.round((x0 + x1) / 16) * 8, oz: Math.round((z0 + z1) / 16) * 8,
    gen, level: -1, want: -1, dist: 0, pages: [],
  };
}

// ------------------------------------------------------------------ facades
const enum M { Wall, Trim, Band, Plinth, Stain, Win, Shop, Door, Shut, AwnA, AwnB }
let DETAIL_WEIGHT = 0.3; // coarse cells prefer wall over windows
/** Experiment knob: weight of window/door votes when merging cells at coarse levels (call before createView). */
export function setDetailWeight(w: number): void { DETAIL_WEIGHT = w; }

interface Style { bay: number; winW: number; winH: number; shutters: boolean; bands: boolean; shops: boolean; awnings: boolean }
function styleOf(lot: Lot): Style {
  const t = lot.tint;
  const bay = [2.2, 2.75, 3.6667][t % 3];
  return {
    bay,
    winW: bay < 2.5 ? 0.8 : bay < 3 ? 1.2 : 1.6,
    winH: (t >> 2) & 1 ? 2.0 : 1.6,
    shutters: ((t >> 3) % 3) === 0,
    bands: ((t >> 4) & 1) === 1,
    shops: ((t >> 5) & 1) === 1,
    awnings: ((t >> 6) % 3) === 0,
  };
}

const GROUND_H = 4.0, FLOOR_H = 3.2;

/** Material at facade-local (u, v). face: 0..3, street: face looks onto a street. */
function facade(st: Style, lot: Lot, face: number, street: boolean, u: number, v: number, H: number): M {
  if (v > H - 0.8) return M.Trim;
  if (v < 0.4) return M.Plinth;
  const bi = Math.floor(u / st.bay);
  const bu = u - bi * st.bay - st.bay / 2;
  const h = hash01(lot.lx * 64 + lot.lz, face * 97 + bi, 11);
  if (v < GROUND_H) {
    if (!street) return M.Wall;
    if (h < 0.3) return Math.abs(bu) < 0.6 && v < 2.8 ? M.Door : M.Wall;
    if (st.shops && Math.abs(bu) < st.bay / 2 - 0.35 && v >= 0.8 && v < 3.2) return M.Shop;
    if (!st.shops && Math.abs(bu) < st.winW / 2 && v >= 1.2 && v < 2.8) return M.Win;
    return M.Wall;
  }
  const fl = Math.floor((v - GROUND_H) / FLOOR_H);
  const fv = v - GROUND_H - fl * FLOOR_H;
  if (st.bands && fv < 0.4) return M.Band;
  if (h > 0.93) return M.Wall; // blank bay
  const aw = Math.abs(bu), half = st.winW / 2;
  const inWinV = fv >= 0.8 && fv < 0.8 + st.winH;
  if (aw < half && inWinV) return M.Win;
  if (st.shutters && aw >= half && aw < half + 0.4 && inWinV) return M.Shut;
  if (aw < half && fv > 0 && fv < 0.8 && hash01(bi, fl + 31, lot.tint) < 0.18) return M.Stain;
  return M.Wall;
}

function isDetail(m: M): boolean { return m === M.Win || m === M.Shop || m === M.Door || m === M.Shut || m === M.Stain; }

/** [painted, pale] for a facade material. */
function facadeColour(m: M, lit: boolean, fam: readonly number[], rfam: readonly number[]): [number, number] {
  switch (m) {
    case M.Wall: return lit ? [fam[0], C.Mid] : [fam[1], C.Shade];
    case M.Trim: case M.Band: return lit ? [C.White, C.Lit] : [fam[0], C.Mid];
    case M.Plinth: return lit ? [fam[1], C.Shade] : [fam[2], C.Deep];
    case M.Stain: return lit ? [fam[1], C.Shade] : [fam[2], C.Deep];
    case M.Win: case M.Shop: return [windowColour(fam), C.Deep];
    case M.Door: return [fam.includes(C.Brown) ? C.Indigo : C.Brown, C.Deep];
    case M.Shut: return lit ? [rfam[0], C.Shade] : [rfam[1], C.Deep];
    case M.AwnA: return lit ? [C.White, C.Lit] : [rfam[0], C.Mid];
    case M.AwnB: return lit ? [rfam[0], C.Shade] : [rfam[1], C.Deep];
  }
}

/** Dominant material of the cell [u0,u1]x[v0,v1] (sub-sampled), preferring wall. */
function cellMaterial(st: Style, lot: Lot, face: number, street: boolean, uc: number, vc: number, cu: number, cv: number, H: number, sub: number): M {
  if (sub <= 1) return facade(st, lot, face, street, uc, vc, H);
  const votes = new Float32Array(11);
  for (let i = 0; i < sub; i++)
    for (let j = 0; j < sub; j++) {
      const m = facade(st, lot, face, street, uc + ((i + 0.5) / sub - 0.5) * cu, vc + ((j + 0.5) / sub - 0.5) * cv, H);
      votes[m] += isDetail(m) ? DETAIL_WEIGHT : 1;
    }
  let best = 0;
  for (let m = 1; m < 11; m++) if (votes[m] > votes[best]) best = m;
  return best as M;
}

interface Face { lot: Lot; face: number; street: boolean; ox: number; oz: number; ux: number; uz: number; n: V3; W: number; H: number; vis0: number }

function faceTiles(f: Face, tiles: Tile[]): void {
  const { lot, H } = f;
  if (H - f.vis0 < 0.2) return;
  const st = styleOf(lot);
  const fam = wallFamily(lot.tint), rfam = roofFamily(lot.tint);
  const nU = 2;
  // vertical chunks of <= 12.8 m (aligned to the face's own grid)
  const vChunks: [number, number][] = [];
  const nChunks = Math.max(1, Math.ceil((H - f.vis0) / 12.8 - 0.01));
  for (let k = 0; k < nChunks; k++) {
    const v0 = f.vis0 + ((H - f.vis0) * k) / nChunks;
    const v1 = k === nChunks - 1 ? H + 1 : f.vis0 + ((H - f.vis0) * (k + 1)) / nChunks;
    vChunks.push([k === 0 ? -1 : v0, v1]);
  }
  for (let iu = 0; iu < nU; iu++) {
    const ua = (iu * f.W) / nU, ub = ((iu + 1) * f.W) / nU;
    for (const [va, vb] of vChunks) {
      const top = vb > H;
      const p0x = f.ox + f.ux * ua, p0z = f.oz + f.uz * ua;
      const p1x = f.ox + f.ux * ub, p1z = f.oz + f.uz * ub;
      const pad = 0.6;
      const est = CELLS.map((c) => Math.ceil((ub - ua) / c) * Math.ceil((Math.min(vb, H) - va) / c + 1) + (top ? Math.ceil((ub - ua) / c) : 0));
      const gen = (level: number, out: SplatBuf) => {
        const c = CELLS[level];
        const nu = Math.max(1, Math.round(f.W / c)), cu = f.W / nu;
        const nv = Math.max(1, Math.round(H / c)), cv = H / nv;
        const r = c * REF_SPLAT_SCALE;
        const sub = level === 0 ? 1 : level === 1 ? 2 : 4;
        const [nx, , nz] = f.n;
        for (let i = 0; i < nu; i++) {
          const uc = (i + 0.5) * cu;
          if (uc < ua || uc >= ub) continue;
          const x = f.ox + f.ux * uc, z = f.oz + f.uz * uc;
          for (let j = 0; j < nv; j++) {
            const vc = (j + 0.5) * cv;
            if (vc < va || vc >= vb) continue;
            if (vc + cv / 2 < f.vis0 + 0.1) continue;
            const m = cellMaterial(st, lot, f.face, f.street, uc, vc, cu, cv, H, sub);
            const lit = sunLit(nx, 0, nz, x, vc, z);
            const [pc, pl] = facadeColour(m, lit, fam, rfam);
            out.push(x, vc, z, r, pc, pl);
            // awnings over ground-floor shops: two rows sloping out from the wall
            if (level <= 1 && f.street && st.awnings && j === Math.floor(3.4 / cv) && m !== M.Door) {
              const bi = Math.floor(uc / st.bay), bu = uc - bi * st.bay - st.bay / 2;
              if (Math.abs(bu) < st.bay / 2 - 0.3 && hash01(lot.lx * 64 + lot.lz, f.face * 97 + bi, 11) >= 0.3) {
                const stripe = Math.floor(uc / 0.55) & 1 ? M.AwnA : M.AwnB;
                const rows = level === 0 ? 3 : 1;
                for (let k = 0; k < rows; k++) {
                  const dd = level === 0 ? 0.35 + k * 0.4 : 0.7;
                  const yy = 3.7 - dd * 0.6;
                  const [ac, al] = facadeColour(stripe, sunLit(0, 1, 0, x + nx * dd, yy, z + nz * dd), fam, rfam);
                  out.push(x + nx * dd, yy, z + nz * dd, r, ac, al);
                }
              }
            }
          }
          // parapet: a raised row along the roof edge
          if (top && level <= 1) {
            const yy = H + c * 0.5;
            const [pc, pl] = facadeColour(M.Trim, sunLit(0, 1, 0, x, yy, z), fam, rfam);
            out.push(x - nx * c * 0.3, yy, z - nz * c * 0.3, r, pc, pl);
          }
        }
      };
      const n = f.n;
      tiles.push(mkTile(
        Math.min(p0x, p1x) - (n[0] ? pad : 0), va, Math.min(p0z, p1z) - (n[2] ? pad : 0),
        Math.max(p0x, p1x) + (n[0] ? pad : 0), Math.min(vb, H) + (top ? 1 : 0), Math.max(p0z, p1z) + (n[2] ? pad : 0),
        n, LEVELS - 1, est, gen,
      ));
      // back-face plane goes through the wall itself, not the padded AABB
      const t = tiles[tiles.length - 1];
      t.d = n[0] * f.ox + n[2] * f.oz;
    }
  }
}

// ------------------------------------------------------------------ roofs
const enum R { Roof, Ring, Hatch, Vent, Patch }
function roofMat(lot: Lot, x: number, z: number): R {
  const e = Math.min(x - lot.x0, lot.x1 - x, z - lot.z0, lot.z1 - z);
  if (e < 0.5) return R.Ring;
  const hx = lot.x0 + 4 + hash01(lot.lx, lot.lz, 21) * 12, hz = lot.z0 + 4 + hash01(lot.lx, lot.lz, 22) * 12;
  if (Math.abs(x - hx) < 0.9 && Math.abs(z - hz) < 0.9) return R.Hatch;
  if (hash01(Math.floor(x / 2.4), Math.floor(z / 2.4), 23) < 0.04) return R.Vent;
  if (hash01(Math.floor(x / 3.2), Math.floor(z / 3.2), 24 + lot.tint) < 0.2) return R.Patch;
  return R.Roof;
}
function roofColour(m: R, lit: boolean, rf: readonly number[]): [number, number] {
  switch (m) {
    case R.Roof: return lit ? [rf[0], C.Lit] : [rf[1], C.Mid];
    case R.Patch: return lit ? [rf[1], C.Mid] : [rf[2], C.Shade];
    case R.Ring: return lit ? [C.White, C.Mid] : [rf[0], C.Shade];
    case R.Hatch: return lit ? [rf[2], C.Shade] : [C.Indigo, C.Deep];
    case R.Vent: return [C.Indigo, C.Deep];
  }
}

function roofTiles(lot: Lot, tiles: Tile[]): void {
  const H = lot.h, rf = roofFamily(lot.tint);
  for (let qx = 0; qx < 2; qx++)
    for (let qz = 0; qz < 2; qz++) {
      const xa = lot.x0 + qx * LOT / 2, xb = xa + LOT / 2, za = lot.z0 + qz * LOT / 2, zb = za + LOT / 2;
      const est = CELLS.map((c) => Math.ceil(LOT / 2 / c) ** 2);
      const gen = (level: number, out: SplatBuf) => {
        const c = CELLS[level];
        const n = Math.max(1, Math.round(LOT / c)), cs = LOT / n;
        const r = c * REF_SPLAT_SCALE;
        for (let i = 0; i < n; i++) {
          const x = lot.x0 + (i + 0.5) * cs;
          if (x < xa || x >= xb) continue;
          for (let j = 0; j < n; j++) {
            const z = lot.z0 + (j + 0.5) * cs;
            if (z < za || z >= zb) continue;
            let m = roofMat(lot, x, z);
            if (level >= 2 && m !== R.Ring) m = R.Roof;
            const [pc, pl] = roofColour(m, sunLit(0, 1, 0, x, H, z), rf);
            out.push(x, H, z, r, pc, pl);
          }
        }
      };
      tiles.push(mkTile(xa, H - 0.5, za, xb, H + 0.5, zb, [0, 1, 0], LEVELS - 1, est, gen));
      tiles[tiles.length - 1].d = H;
    }
}

// ------------------------------------------------------------------ ground (streets + outskirts)
const G0 = -8 - 51.2, G1 = 548 + 51.2, GT = 12.8;
function groundColour(x: number, z: number, lit: boolean): [number, number] {
  if (x < -8 || x > 548 || z > 8 || z < -548) return lit ? [C.Green, C.Mid] : [C.Teal, C.Shade]; // outskirts
  const i = Math.round(x / P), j = Math.round(-z / P);
  const dx = x - i * P, dz = -z - j * P;
  const ns = Math.abs(dx) < HALF, ew = Math.abs(dz) < HALF;
  const adx = Math.abs(dx), adz = Math.abs(dz);
  if (ns && ew) {
    // intersection: plain road with a manhole
    if (adx < 0.6 && adz < 0.6) return [C.Indigo, C.Deep];
    return lit ? [C.Teal, C.Mid] : [C.Blue, C.Shade];
  }
  const a = ns ? adx : adz; // distance from the street centre line
  const along = ns ? -z : x;
  const across = ns ? adz : adx; // distance from the crossing street's centre
  if (a > 5.6) return lit ? [C.Yellow, C.Lit] : [C.Orange, C.Mid]; // pavement
  if (a > 5.2) return lit ? [C.Brown, C.Shade] : [C.Indigo, C.Deep]; // kerb
  if (across < 10.4 && across >= HALF && Math.floor(a / 0.8) % 2 === 0) return lit ? [C.White, C.Lit] : [C.SkyLight, C.Mid]; // crossing
  if (a < 0.2 && ((Math.floor(along / 3) & 1) === 0)) return lit ? [C.White, C.Lit] : [C.SkyLight, C.Mid]; // centre dashes
  return lit ? [C.Teal, C.Mid] : [C.Blue, C.Shade];
}

function groundTiles(tiles: Tile[]): void {
  for (let gx = G0; gx < G1 - 0.01; gx += GT)
    for (let gz = -G0; gz > -G1 + 0.01; gz -= GT) {
      const za = gz - GT, zb = gz, xa = gx, xb = gx + GT;
      // skip tiles completely inside one lot
      if (lotIx(xa + 0.01, za + 0.01) >= 0 && lotIx(xa + 0.01, za + 0.01) === lotIx(xb - 0.01, zb - 0.01) && lotIx(xa + 0.01, zb - 0.01) === lotIx(xb - 0.01, za + 0.01) && lotIx(xb - 0.01, zb - 0.01) === lotIx(xa + 0.01, zb - 0.01)) continue;
      const est = CELLS.map((c) => (GT / c) ** 2);
      const gen = (level: number, out: SplatBuf) => {
        const c = CELLS[level];
        const n = Math.round(GT / c);
        const r = c * REF_SPLAT_SCALE;
        for (let i = 0; i < n; i++) {
          const x = xa + (i + 0.5) * c;
          for (let j = 0; j < n; j++) {
            const z = za + (j + 0.5) * c;
            if (lotIx(x, z) >= 0) continue;
            const [pc, pl] = groundColour(x, z, sunLit(0, 1, 0, x, 0, z));
            out.push(x, 0, z, r, pc, pl);
          }
        }
      };
      tiles.push(mkTile(xa, -0.5, za, xb, 0.5, zb, null, LEVELS - 1, est, gen));
    }
}

// ------------------------------------------------------------------ props
/** Thin strut from a to b; spacing and radius follow the level. */
function strut(out: SplatBuf, level: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, thick: number, painted: number, pale: number): void {
  const sp = [0.18, 0.36, 0.72, 1.44][level];
  const r = Math.max(thick, sp * 0.6);
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(1, Math.ceil(len / sp));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    out.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, r, painted, pale);
  }
}
/** Solid box surface (all six faces) with lighting per face. */
function box(out: SplatBuf, level: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour: (lit: boolean, top: boolean) => [number, number], cell: number = CELLS[level]): void {
  const c = cell, r = c * REF_SPLAT_SCALE;
  const nx = Math.max(1, Math.round((x1 - x0) / c)), ny = Math.max(1, Math.round((y1 - y0) / c)), nz = Math.max(1, Math.round((z1 - z0) / c));
  const cx = (x1 - x0) / nx, cy = (y1 - y0) / ny, cz = (z1 - z0) / nz;
  const faces: [V3, number][] = [[[1, 0, 0], x1], [[-1, 0, 0], x0], [[0, 1, 0], y1], [[0, -1, 0], y0], [[0, 0, 1], z1], [[0, 0, -1], z0]];
  for (const [n, p] of faces) {
    const [a, b] = n[0] ? [ny, nz] : n[1] ? [nx, nz] : [nx, ny];
    for (let i = 0; i < a; i++)
      for (let j = 0; j < b; j++) {
        let x: number, y: number, z: number;
        if (n[0]) { x = p; y = y0 + (i + 0.5) * cy; z = z0 + (j + 0.5) * cz; }
        else if (n[1]) { y = p; x = x0 + (i + 0.5) * cx; z = z0 + (j + 0.5) * cz; }
        else { z = p; x = x0 + (i + 0.5) * cx; y = y0 + (j + 0.5) * cy; }
        const [pc, pl] = colour(sunLit(n[0], n[1], n[2], x, y, z), n[1] > 0);
        out.push(x, y, z, r, pc, pl);
      }
  }
}

function propTile(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxLevel: number, gen: Tile["gen"]): Tile {
  const t = mkTile(x0, y0, z0, x1, y1, z1, null, maxLevel, [0, 0, 0, 0], gen);
  // estimates: generate once per level (props are small)
  const b = new SplatBuf();
  for (let l = 0; l <= maxLevel; l++) { b.reset(); gen(l, b); t.est[l] = b.n; t.exact[l] = b.n; }
  return t;
}

const DARK: [number, number] = [C.Indigo, C.Deep];

function lineSupports(a: Anchor, tiles: Tile[]): void {
  if (!a.b) return;
  const mid: V3 = [(a.a[0] + a.b[0]) / 2, 0, (a.a[2] + a.b[2]) / 2];
  for (const p of [a.a, a.b]) {
    let dx = p[0] - mid[0], dz = p[2] - mid[2];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const h = roofAt(p[0] + dx * 1.0, p[2] + dz * 1.0);
    const y = p[1];
    const gen = (level: number, out: SplatBuf) => {
      if (h >= y + 0.6) {
        // wall bracket: arm out of the wall plus a diagonal strut
        strut(out, level, p[0] + dx * 0.1, y, p[2] + dz * 0.1, p[0] - dx * 0.5, y, p[2] - dz * 0.5, 0.07, ...DARK);
        if (level <= 1) strut(out, level, p[0] + dx * 0.1, y - 0.6, p[2] + dz * 0.1, p[0] - dx * 0.4, y, p[2] - dz * 0.4, 0.05, ...DARK);
      } else {
        // pole standing on the roof edge (or the street) up to the line end
        const px = p[0] + dx * 0.4, pz = p[2] + dz * 0.4;
        strut(out, level, px, h, pz, px, y + 0.3, pz, 0.08, ...DARK);
        if (level <= 1) strut(out, level, px, y + 0.2, pz, p[0] - dx * 0.2, y + 0.2, p[2] - dz * 0.2, 0.05, ...DARK);
      }
    };
    const lo = Math.min(h, y - 0.7);
    tiles.push(propTile(p[0] - 1, lo, p[2] - 1, p[0] + 1, y + 1, p[2] + 1, 2, gen));
  }
}

function lampTile(p: Prop, tiles: Tile[]): void {
  const { x, y, z } = p;
  const gen = (level: number, out: SplatBuf) => {
    // two cables crossing the intersection, corner to corner, through the lamp
    for (const [sx, sz] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
      // a mast on each corner roof carries the cable, so it sags down to the lamp
      const roof = Math.max(roofAt(x + sx * (HALF + 1), z + sz * (HALF + 1)), 4), cy = y + 1.6;
      const mx = x + sx * (HALF + 0.6), mz = z + sz * (HALF + 0.6);
      if (roof < cy) strut(out, level, mx, roof, mz, mx, cy, mz, 0.1, ...DARK);
      strut(out, level, mx, cy, mz, x, y + 0.6, z, 0.04, ...DARK);
    }
    const s = level === 0 ? 0.22 : 0.4;
    out.push(x, y + 0.45, z, s * 1.1, C.Indigo, C.Deep);
    if (level <= 1) { out.push(x + 0.25, y + 0.35, z, s, C.Indigo, C.Deep); out.push(x - 0.25, y + 0.35, z, s, C.Indigo, C.Deep); }
    out.push(x, y + 0.1, z, s, C.Yellow, C.Lit);
  };
  tiles.push(propTile(x - HALF - 1, y - 1, z - HALF - 1, x + HALF + 1, y + 2, z + HALF + 1, 2, gen));
}

function antennaTile(p: Prop, tiles: Tile[]): void {
  const { x, y, z } = p, h = p.a ?? 8;
  const gen = (level: number, out: SplatBuf) => {
    strut(out, level, x, y, z, x, y + h, z, 0.12, C.Indigo, C.Deep);
    if (level <= 2) {
      for (const f of [0.6, 0.85]) {
        const w = f > 0.7 ? 0.7 : 1.1;
        strut(out, level, x - w, y + h * f, z, x + w, y + h * f, z, 0.06, C.Indigo, C.Deep);
        strut(out, level, x, y + h * f, z - w, x, y + h * f, z + w, 0.06, C.Indigo, C.Deep);
      }
    }
    out.push(x, y + h + 0.2, z, Math.max(0.3, CELLS[level] * 0.4), C.Pink, C.Shade);
  };
  tiles.push(propTile(x - 1.5, y, z - 1.5, x + 1.5, y + h + 1, z + 1.5, 3, gen));
}

function tankTile(p: Prop, tiles: Tile[]): void {
  const { x, y, z } = p;
  const R = 1.4, legH = 1.2, bodyH = 2.2;
  const gen = (level: number, out: SplatBuf) => {
    const c = CELLS[level], r = c * REF_SPLAT_SCALE;
    for (const [sx, sz] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) strut(out, level, x + sx * R * 0.6, y, z + sz * R * 0.6, x + sx * R * 0.6, y + legH, z + sz * R * 0.6, 0.08, C.Indigo, C.Deep);
    const na = Math.max(4, Math.round((2 * Math.PI * R) / c));
    const nh = Math.max(1, Math.round(bodyH / c));
    for (let i = 0; i < na; i++) {
      const ang = ((i + 0.5) / na) * Math.PI * 2;
      const nx = Math.cos(ang), nz = Math.sin(ang);
      for (let j = 0; j < nh; j++) {
        const yy = y + legH + (j + 0.5) * (bodyH / nh);
        const hoop = level <= 1 && (j === 1 || j === nh - 2);
        const lit = sunLit(nx, 0, nz, x + nx * R, yy, z + nz * R);
        const col: [number, number] = hoop ? [C.Indigo, C.Deep] : lit ? [C.Orange, C.Mid] : [C.Brown, C.Shade];
        out.push(x + nx * R, yy, z + nz * R, r, ...col);
      }
    }
    // lid: a low cone
    const nr = Math.max(1, Math.round(R / c));
    for (let k = 0; k < nr; k++) {
      const rr = (k + 0.5) * (R / nr);
      const nn = Math.max(1, Math.round((2 * Math.PI * rr) / c));
      for (let i = 0; i < nn; i++) {
        const ang = ((i + 0.5) / nn) * Math.PI * 2;
        const yy = y + legH + bodyH + 0.5 * (1 - rr / R);
        out.push(x + Math.cos(ang) * rr, yy, z + Math.sin(ang) * rr, r, C.Terracotta, C.Lit);
      }
    }
  };
  tiles.push(propTile(x - R - 0.5, y, z - R - 0.5, x + R + 0.5, y + legH + bodyH + 1, z + R + 0.5, 3, gen));
}

function stallTile(p: Prop, extra: { x0: number; x1: number; z0: number; z1: number; h: number }[], tiles: Tile[]): void {
  const bx = extra.find((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1) ?? { x0: p.x - 3, x1: p.x + 3, z0: p.z - 4, z1: p.z + 4, h: 6.4 };
  const { x0, x1, z0, z1, h } = bx;
  const xc = (x0 + x1) / 2;
  const fam = [[C.Pink, C.Terracotta], [C.Green, C.Teal], [C.Orange, C.Terracotta], [C.Blue, C.Indigo]][((p.a ?? 0) | 0) % 4];
  const gen = (level: number, out: SplatBuf) => {
    const c = Math.min(CELLS[level], 0.8), r = c * REF_SPLAT_SCALE;
    // posts
    for (const px of [x0 + 0.2, x1 - 0.2]) for (const pz of [z0 + 0.2, z1 - 0.2]) strut(out, level, px, 0, pz, px, h - 0.8, pz, 0.08, C.Indigo, C.Deep);
    // striped gable canopy
    const nx = Math.max(2, Math.round((x1 - x0) / c)), nz = Math.max(2, Math.round((z1 - z0) / c));
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * ((x1 - x0) / nx);
      const yy = h - (Math.abs(x - xc) / ((x1 - x0) / 2)) * 0.8;
      for (let j = 0; j < nz; j++) {
        const z = z0 + (j + 0.5) * ((z1 - z0) / nz);
        const stripe = Math.floor((z - z0) / 0.8) & 1;
        const lit = sunLit(x > xc ? 0.7 : -0.7, 0.7, 0, x, yy, z);
        const col: [number, number] = stripe ? (lit ? [C.White, C.Lit] : [C.SkyLight, C.Mid]) : lit ? [fam[0], C.Shade] : [fam[1], C.Deep];
        out.push(x, yy, z, r, ...col);
      }
    }
    // counters with goods
    if (level <= 2) {
      box(out, level, x0 + 0.3, 0, z0 + 0.3, x0 + 1.1, 1.0, z1 - 0.3, (lit, top) => top ? [C.Yellow, C.Lit] : lit ? [C.Brown, C.Shade] : [C.Indigo, C.Deep], c);
      box(out, level, x1 - 1.1, 0, z0 + 0.3, x1 - 0.3, 1.0, z1 - 0.3, (lit, top) => top ? [C.Green, C.Lit] : lit ? [C.Brown, C.Shade] : [C.Indigo, C.Deep], c);
    }
  };
  tiles.push(propTile(x0, 0, z0, x1, h + 0.5, z1, 3, gen));
}

function craneTile(p: Prop, tiles: Tile[]): void {
  const x = p.x, z = p.z, top = p.a ?? 28, dir = p.b ?? 1;
  const base = roofAt(x, z);
  const gen = (level: number, out: SplatBuf) => {
    const Y: [number, number] = [C.Yellow, C.Shade], Y2: [number, number] = [C.Orange, C.Deep];
    const w = 0.8;
    for (const [sx, sz] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) strut(out, level, x + sx * w, base, z + sz * w, x + sx * w, top, z + sz * w, 0.1, ...(sx > 0 ? Y : Y2));
    if (level <= 2) for (let yy = base + 1.6; yy < top; yy += level <= 1 ? 1.6 : 3.2) {
      strut(out, level, x - w, yy, z - w, x + w, yy + 1.6 * 0, z + w, 0.06, ...Y2);
      strut(out, level, x - w, yy, z + w, x + w, yy, z - w, 0.06, ...Y2);
    }
    // jib (towards and over the street) and counter-jib
    const xa = x - dir * 7, xb = x + dir * 23;
    strut(out, level, xa, top, z - 0.5, xb, top, z - 0.5, 0.1, ...Y);
    strut(out, level, xa, top, z + 0.5, xb, top, z + 0.5, 0.1, ...Y);
    strut(out, level, x, top + 3, z, xb, top + 0.2, z, 0.06, ...Y2);
    strut(out, level, x, top + 3, z, xa, top + 0.2, z, 0.06, ...Y2);
    strut(out, level, x, top, z, x, top + 3, z, 0.1, ...Y);
    if (level <= 1) for (let k = 0; k < 10; k++) {
      const xx = x + dir * (1 + k * 2.2);
      strut(out, level, xx, top, z - 0.5, xx + dir * 1.1, top, z + 0.5, 0.05, ...Y2);
    }
    box(out, level, Math.min(xa, xa + dir * 2.4), top - 1.6, z - 1, Math.max(xa, xa + dir * 2.4), top, z + 1, (lit) => lit ? [C.Shade, C.Shade] : DARK, Math.min(CELLS[level], 0.8));
    box(out, level, x - 1, top - 2.2, z - 1, x + 1, top - 0.2, z + 1, (lit) => lit ? [C.White, C.Lit] : [C.Blue, C.Shade], Math.min(CELLS[level], 0.8));
  };
  tiles.push(propTile(Math.min(x - dir * 7, x + dir * 23) - 1, base, z - 1.5, Math.max(x - dir * 7, x + dir * 23) + 1, top + 3.5, z + 1.5, 3, gen));
}

// ------------------------------------------------------------------ build
export interface City { tiles: Tile[]; maxH: number }

export function buildCity(): City {
  const d = district();
  lotsByIndex = new Array(L2 * L2);
  maxH = 0;
  for (const lot of d.lots) {
    heights[lot.lx * L2 + lot.lz] = lot.h;
    lotsByIndex[lot.lx * L2 + lot.lz] = lot;
    maxH = Math.max(maxH, lot.h);
  }
  for (const b of d.extra) maxH = Math.max(maxH, b.h);
  const tiles: Tile[] = [];
  groundTiles(tiles);
  const hAt = (lx: number, lz: number) => (lx < 0 || lz < 0 || lx >= L2 || lz >= L2 ? 0 : heights[lx * L2 + lz]);
  for (const lot of d.lots) {
    roofTiles(lot, tiles);
    const { lx, lz } = lot;
    // neighbour across each face inside the same block (else the face looks onto a street)
    const east = (lx & 1) === 0 ? hAt(lx + 1, lz) : 0; // +x face
    const west = (lx & 1) === 1 ? hAt(lx - 1, lz) : 0; // -x face
    const south = (lz & 1) === 0 ? hAt(lx, lz + 1) : 0; // lz+1 is further -z: the -z face
    const north = (lz & 1) === 1 ? hAt(lx, lz - 1) : 0; // +z face
    const W = LOT, H = lot.h;
    // u runs along the face; origin at one corner
    faceTiles({ lot, face: 0, street: (lx & 1) === 1, ox: lot.x1, oz: lot.z1, ux: 0, uz: -1, n: [1, 0, 0], W, H, vis0: east }, tiles);
    faceTiles({ lot, face: 1, street: (lx & 1) === 0, ox: lot.x0, oz: lot.z0, ux: 0, uz: 1, n: [-1, 0, 0], W, H, vis0: west }, tiles);
    faceTiles({ lot, face: 2, street: (lz & 1) === 0, ox: lot.x0, oz: lot.z1, ux: 1, uz: 0, n: [0, 0, 1], W, H, vis0: north }, tiles);
    faceTiles({ lot, face: 3, street: (lz & 1) === 1, ox: lot.x1, oz: lot.z0, ux: -1, uz: 0, n: [0, 0, -1], W, H, vis0: south }, tiles);
  }
  for (const a of d.anchors) if (a.kind === "line") lineSupports(a, tiles);
  for (const p of d.props) {
    if (p.kind === "lamp") lampTile(p, tiles);
    else if (p.kind === "antenna") antennaTile(p, tiles);
    else if (p.kind === "tank") tankTile(p, tiles);
    else if (p.kind === "stall") stallTile(p, d.extra, tiles);
    else if (p.kind === "crane") craneTile(p, tiles);
  }
  return { tiles, maxH };
}

/** Washing-line resting curve (for tools / dyn users): point at u along the line. */
export function linePoint(a: Anchor, u: number, out: V3): V3 { return anchorPos(a, 0, u, 0, out); }
