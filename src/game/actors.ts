// Everything that moves is drawn here each frame as a handful of splats through view.dyn:
// the runner, the rope, washing lines (they sag and flutter), crane hooks, kites, the
// reticle and the ghost. Palette indices only.
import { T } from "../tuning";
import { DT, GROUND, SWING, type SimState } from "../sim/sim";
import { anchorPos, type Anchor, type SimWorld, type V3, type Wind } from "../sim/world";
import { PAINT_H, PAINT_W, paintCol, paintRow } from "../sim/paint";

export interface Dyn { begin(): void; add(x: number, y: number, z: number, r: number, color: number): void; end(): void }

export interface DrawCtx {
  dyn: Dyn;
  paint: Uint8Array;
  time: number;
  /** camera position and basis */
  cx: number; cy: number; cz: number;
  rx: number; ry: number; rz: number; // camera right
  ux: number; uy: number; uz: number; // camera up
  fx: number; fy: number; fz: number; // camera forward
  /** world radius that covers about one low-res pixel at 1 m distance */
  pxPerM: number;
}

const INDIGO = 12, WHITE = 15, PINK = 13, PALE = 0, PALE2 = 1, GREY = 3;
const CLOTH = [6, 7, 8, 9, 11, 13, 15, 10];

function h01(n: number): number {
  let h = (n * 374761393) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Radius floor so thin things never drop below about 0.7 low-res px. */
function floorR(c: DrawCtx, x: number, y: number, z: number, r: number): number {
  const d = (x - c.cx) * c.fx + (y - c.cy) * c.fy + (z - c.cz) * c.fz;
  const m = d * c.pxPerM * 0.7;
  return r > m ? r : m;
}

function add(c: DrawCtx, x: number, y: number, z: number, r: number, col: number): void {
  c.dyn.add(x, y, z, floorR(c, x, y, z, r), col);
}

function painted(c: DrawCtx, x: number, z: number, thr: number): boolean {
  const col = paintCol(x) | 0, row = paintRow(z) | 0;
  if (col < 0 || row < 0 || col >= PAINT_W || row >= PAINT_H) return false;
  return c.paint[row * PAINT_W + col] > thr;
}

function seg(c: DrawCtx, ax: number, ay: number, az: number, bx: number, by: number, bz: number, n: number, r: number, col: number): void {
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    add(c, ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u, r, col);
  }
}

function windAt(wind: Wind[], x: number, y: number, z: number, out: V3): V3 {
  out[0] = out[1] = out[2] = 0;
  for (const w of wind) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && y >= w.y0 && y <= w.y1) { out[0] += w.accel[0]; out[1] += w.accel[1]; out[2] += w.accel[2]; }
  return out;
}

const _p: V3 = [0, 0, 0], _q: V3 = [0, 0, 0], _w: V3 = [0, 0, 0];

/** Washing lines, lamps' glow, crane hooks and kites for every anchor in view. */
export function drawAnchors(c: DrawCtx, anchors: Anchor[], wind: Wind[], held: Anchor | null, heldU: number, heldSag: number, simT: number): void {
  for (let ai = 0; ai < anchors.length; ai++) {
    const a = anchors[ai];
    const mx = a.b ? (a.a[0] + a.b[0]) / 2 : a.a[0], mz = a.b ? (a.a[2] + a.b[2]) / 2 : a.a[2];
    const dx = mx - c.cx, dy = a.a[1] - c.cy, dz = mz - c.cz;
    const depth = dx * c.fx + dy * c.fy + dz * c.fz;
    if (depth < -12 || depth > 260) continue;
    const near = depth < 90;
    if (a.kind === "line" && a.b) {
      const isHeld = a === held;
      const n = near ? 18 : 8;
      // wire
      anchorPos(a, simT, heldU, heldSag, _q); // attach point if held
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        if (isHeld) {
          // two straight runs meeting at the loaded point
          const e = u < heldU ? a.a : a.b, k = u < heldU ? u / heldU : (1 - u) / (1 - heldU);
          _p[0] = e[0] + (_q[0] - e[0]) * k; _p[1] = e[1] + (_q[1] - e[1]) * k; _p[2] = e[2] + (_q[2] - e[2]) * k;
        } else anchorPos(a, simT, u, 0, _p);
        add(c, _p[0], _p[1], _p[2], 0.07, INDIGO);
      }
      // clothes
      const count = near ? 7 : 4;
      const wv = windAt(wind, mx, a.a[1], mz, _w);
      const lx = a.b[0] - a.a[0], lz = a.b[2] - a.a[2];
      const ll = Math.hypot(lx, lz) || 1;
      // flutter is across the line (along the street)
      const nx = -lz / ll, nz = lx / ll;
      for (let k = 0; k < count; k++) {
        const id = ai * 16 + k;
        const u = 0.12 + ((k + h01(id) * 0.6) / count) * 0.76;
        if (isHeld) {
          const e = u < heldU ? a.a : a.b, kk = u < heldU ? u / heldU : (1 - u) / (1 - heldU);
          _p[0] = e[0] + (_q[0] - e[0]) * kk; _p[1] = e[1] + (_q[1] - e[1]) * kk; _p[2] = e[2] + (_q[2] - e[2]) * kk;
        } else anchorPos(a, simT, u, 0, _p);
        const col = painted(c, _p[0], _p[2], 40 + h01(id + 7) * 150) ? CLOTH[(h01(id + 3) * CLOTH.length) | 0] : k % 3 === 0 ? PALE2 : PALE;
        const fl = Math.sin(c.time * (2.2 + h01(id) * 1.5) + id) * 0.12 + (isHeld ? Math.sin(c.time * 14 + id) * 0.1 : 0);
        const wx = wv[0] * 0.09 + nx * fl, wz = wv[2] * 0.09 + nz * fl;
        const tall = h01(id + 11) > 0.5;
        add(c, _p[0] + wx * 0.4, _p[1] - 0.45, _p[2] + wz * 0.4, 0.42, col);
        if (near) add(c, _p[0] + wx, _p[1] - (tall ? 1.15 : 0.95), _p[2] + wz, tall ? 0.42 : 0.36, col);
      }
    } else if (a.look === "crane") {
      anchorPos(a, simT, 0, 0, _p);
      const topY = a.a[1] + 4;
      seg(c, _p[0], _p[1] + 0.4, _p[2], _p[0], topY, _p[2], near ? 6 : 3, 0.07, INDIGO);
      add(c, _p[0], _p[1], _p[2], 0.42, painted(c, _p[0], _p[2], 90) ? 7 : GREY);
      add(c, _p[0], _p[1] - 0.45, _p[2], 0.26, INDIGO);
    } else if (a.look === "kite") {
      anchorPos(a, simT, 0, 0, _p);
      const on = painted(c, _p[0], _p[2], 90);
      const k1 = on ? CLOTH[ai % 6] : PALE, k2 = on ? WHITE : PALE2;
      // diamond in the camera plane
      add(c, _p[0], _p[1], _p[2], 0.5, k1);
      add(c, _p[0] + c.ux * 0.6, _p[1] + c.uy * 0.6, _p[2] + c.uz * 0.6, 0.36, k2);
      add(c, _p[0] - c.ux * 0.6, _p[1] - c.uy * 0.6, _p[2] - c.uz * 0.6, 0.36, k1);
      add(c, _p[0] + c.rx * 0.55, _p[1] + c.ry * 0.55, _p[2] + c.rz * 0.55, 0.32, k2);
      add(c, _p[0] - c.rx * 0.55, _p[1] - c.ry * 0.55, _p[2] - c.rz * 0.55, 0.32, k1);
      // tail and string
      for (let i = 1; i <= 5; i++) add(c, _p[0] + Math.sin(c.time * 3 + i + ai) * 0.25, _p[1] - 0.8 - i * 0.5, _p[2] + Math.cos(c.time * 2.3 + i) * 0.25, 0.16, i % 2 ? PINK : k2);
      if (near) seg(c, _p[0], _p[1] - 3.4, _p[2], a.a[0] + 2, a.a[1] - 11, a.a[2] + 5, 8, 0.05, INDIGO);
    }
  }
}

/** The runner: a small dark figure with a pink scarf. (x, y, z) = feet / hang point. */
export function drawRunner(c: DrawCtx, s: SimState, x: number, y: number, z: number, body = INDIGO, scarf = PINK, skin = 7): void {
  const sp = Math.hypot(s.vx, s.vy, s.vz);
  // up axis: along the rope when swinging, tilted into velocity otherwise
  let ux = 0, uy = 1, uz = 0;
  let hx = s.hx, hz = s.hz;
  const sph = Math.hypot(s.vx, s.vz);
  if (sph > 1) { hx = s.vx / sph; hz = s.vz / sph; }
  if (s.mode === SWING) {
    const dx = s.ax - x, dy = s.ay - y, dz = s.az - z;
    const l = Math.hypot(dx, dy, dz) || 1;
    ux = dx / l; uy = dy / l; uz = dz / l;
  } else if (s.mode !== GROUND) {
    const tilt = Math.min(0.5, sph * 0.015);
    ux = hx * tilt; uz = hz * tilt; uy = Math.sqrt(1 - tilt * tilt);
  } else {
    ux = hx * 0.18; uz = hz * 0.18; uy = 0.98;
  }
  const sx = -hz, sz = hx; // sideways
  const t = c.time;
  const run = s.mode === GROUND ? Math.sin(t * 16) : 0;
  // legs
  const kick = s.mode === GROUND ? run * 0.3 : -0.25;
  add(c, x + sx * 0.14 + hx * kick, y + 0.16, z + sz * 0.14 + hz * kick, 0.17, body);
  add(c, x - sx * 0.14 - hx * kick, y + 0.16 + (s.mode === GROUND ? 0 : 0.1), z - sz * 0.14 - hz * kick, 0.17, body);
  // torso, head
  add(c, x + ux * 0.62, y + uy * 0.62, z + uz * 0.62, 0.3, body);
  add(c, x + ux * 0.95, y + uy * 0.95, z + uz * 0.95, 0.26, body);
  add(c, x + ux * 1.32, y + uy * 1.32, z + uz * 1.32, 0.21, skin);
  // arms: up the rope when swinging, back when flying
  if (s.mode === SWING) {
    add(c, x + ux * 1.62 + sx * 0.1, y + uy * 1.62, z + uz * 1.62 + sz * 0.1, 0.12, body);
    add(c, x + ux * 1.85, y + uy * 1.85, z + uz * 1.85, 0.12, skin);
  } else {
    const sw = s.mode === GROUND ? run * 0.25 : -0.3;
    add(c, x + ux * 0.9 + sx * 0.32 + hx * sw, y + uy * 0.9, z + uz * 0.9 + sz * 0.32 + hz * sw, 0.12, body);
    add(c, x + ux * 0.9 - sx * 0.32 - hx * sw, y + uy * 0.9, z + uz * 0.9 - sz * 0.32 - hz * sw, 0.12, body);
  }
  // scarf streams out behind, longer with speed
  const n = 5, len = 0.25 + Math.min(1, sp / 25) * 0.3;
  let bx = x + ux * 1.12, by = y + uy * 1.12, bz = z + uz * 1.12;
  const vx = sp > 1 ? s.vx / sp : hx, vy = sp > 1 ? s.vy / sp : 0, vz = sp > 1 ? s.vz / sp : hz;
  for (let i = 1; i <= n; i++) {
    const wv = Math.sin(t * 9 - i * 0.9) * 0.07 * i;
    bx -= vx * len - sx * wv * 0.3; by -= vy * len - 0.03 + wv * 0.25; bz -= vz * len - sz * wv * 0.3;
    add(c, bx, by, bz, 0.17 - i * 0.015, scarf);
  }
}

export function drawRope(c: DrawCtx, s: SimState, x: number, y: number, z: number): void {
  if (s.mode !== SWING) return;
  const dx = s.ax - x, dy = s.ay - y, dz = s.az - z;
  const l = Math.hypot(dx, dy, dz) || 1;
  const n = Math.max(4, Math.min(28, Math.round(l / 0.7)));
  const hx = x + (dx / l) * 1.85, hy = y + (dy / l) * 1.85, hz = z + (dz / l) * 1.85;
  seg(c, hx, hy, hz, s.ax, s.ay, s.az, n, 0.07, WHITE);
}

/** Marks the anchor a press would grab. */
export function drawReticle(c: DrawCtx, x: number, y: number, z: number, strong: boolean): void {
  const d = (x - c.cx) * c.fx + (y - c.cy) * c.fy + (z - c.cz) * c.fz;
  if (d < 1) return;
  const px = d * c.pxPerM; // one low-res pixel in metres here
  const r = px * (3.2 + Math.sin(c.time * 9) * 0.5);
  const dot = px * 0.75;
  const col = strong ? 8 : WHITE;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    c.dyn.add(x + c.rx * ox + c.ux * oy, y + c.ry * ox + c.uy * oy, z + c.rz * ox + c.uz * oy, dot, col);
  }
}

/** The best run so far, as a pale figure. ghost = x,y,z triples in decimetres at `hz` Hz. */
export function drawGhost(c: DrawCtx, ghost: Int16Array, tick: number, hz: number): void {
  const f = (tick * DT) * hz;
  const i = Math.floor(f), u = f - i;
  if ((i + 1) * 3 + 2 >= ghost.length) return;
  const a = i * 3, b = a + 3;
  const x = (ghost[a] + (ghost[b] - ghost[a]) * u) / 10, y = (ghost[a + 1] + (ghost[b + 1] - ghost[a + 1]) * u) / 10, z = (ghost[a + 2] + (ghost[b + 2] - ghost[a + 2]) * u) / 10;
  add(c, x, y + 0.5, z, 0.3, 4);
  add(c, x, y + 1.05, z, 0.24, 5);
  // a short dotted wake
  for (let k = 1; k <= 3; k++) {
    const j = (i - k * 2) * 3;
    if (j >= 0) add(c, ghost[j] / 10, ghost[j + 1] / 10 + 0.6, ghost[j + 2] / 10, 0.12, 4);
  }
}

/** Colour puffs shed behind the runner while fast enough to paint. */
export class Trail {
  private x = new Float32Array(24); private y = new Float32Array(24); private z = new Float32Array(24);
  private age = new Float32Array(24).fill(9);
  private col = new Uint8Array(24);
  private head = 0; private acc = 0;
  reset(): void { this.age.fill(9); }
  update(c: DrawCtx, s: SimState, x: number, y: number, z: number, dt: number, strength: number): void {
    this.acc += dt * (strength > 0 ? 14 : 0);
    while (this.acc >= 1) {
      this.acc -= 1;
      const i = this.head = (this.head + 1) % 24;
      this.x[i] = x + (h01(i * 31 + ((c.time * 60) | 0)) - 0.5) * 0.8; this.y[i] = y + 0.5 + (h01(i * 17 + ((c.time * 61) | 0)) - 0.5) * 0.8; this.z[i] = z + (h01(i * 13 + ((c.time * 59) | 0)) - 0.5) * 0.8;
      this.age[i] = 0; this.col[i] = [PINK, 8, 7, WHITE][i % 4];
    }
    for (let i = 0; i < 24; i++) {
      const a = (this.age[i] += dt);
      if (a > 0.7) continue;
      add(c, this.x[i], this.y[i] + a * 0.6, this.z[i], 0.3 * (1 - a / 0.7), this.col[i]);
    }
  }
}
export { T as _T };
