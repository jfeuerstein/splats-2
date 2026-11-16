// The district: one street grid, six authored runs through it. Pure data, shared by the
// simulation (collision, anchors) and the renderer (splat generation).
//
// Grid: streets every P metres, 16 m wide. Street centre lines at x = i*P and z = -j*P.
// Each block holds 2x2 lots; every lot is one box building.

import { makeWorld, type Anchor, type Box, type Course, type SimWorld, type V3, type Wind } from "../sim/world";

export const P = 60;
export const STREET = 16;
export const HALF = STREET / 2;
export const LOT = (P - STREET) / 2; // 22
export const N = 9; // blocks per side
export const SIZE = N * P; // 540

export interface Lot extends Box { lx: number; lz: number; tint: number }

export interface Prop {
  kind: "stall" | "tank" | "crane" | "pole" | "antenna" | "lamp";
  x: number; y: number; z: number;
  /** kind-specific: crane arm direction/length, pole height, … */
  a?: number; b?: number; c?: number;
}

export interface District {
  lots: Lot[];
  /** Low obstacles that are also collision boxes (market stalls). */
  extra: Box[];
  anchors: Anchor[];
  props: Prop[];
  wind: Wind[];
  courses: CourseDef[];
}

export interface CourseDef {
  id: string;
  name: string;
  idea: string;
  hint: string;
  guide: V3[];
  start: V3;
  startSpeed: number;
}

function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const node = (i: number, j: number): V3 => [i * P, 0, -j * P];

/** Lot footprint from lot indices (0..2N-1). */
function lotRect(lx: number, lz: number) {
  const x0 = (lx >> 1) * P + HALF + (lx & 1) * LOT;
  const zTop = -((lz >> 1) * P + HALF + (lz & 1) * LOT);
  return { x0, x1: x0 + LOT, z0: zTop - LOT, z1: zTop };
}

/** Lot indices on each side of a street, at block b along it. Streets: 'x' = runs along z at x=i*P. */
function sideLots(axis: "x" | "z", street: number, block: number): [number, number][][] {
  // returns [leftSide lots, rightSide lots] as [lx, lz] (both lots of the block along the street)
  const a0 = block * 2, a1 = block * 2 + 1;
  const lo = street * 2 - 1, hi = street * 2;
  if (axis === "x") return [[[lo, a0], [lo, a1]], [[hi, a0], [hi, a1]]];
  return [[[a0, lo], [a1, lo]], [[a0, hi], [a1, hi]]];
}

export function buildDistrict(): District {
  const heights = new Map<number, number>();
  const key = (lx: number, lz: number) => lx * 64 + lz;
  const L = 2 * N;
  for (let lx = 0; lx < L; lx++)
    for (let lz = 0; lz < L; lz++) {
      const r = hash(lx, lz, 1);
      heights.set(key(lx, lz), 12.8 + Math.floor(r * r * 9) * 1.6);
    }
  const setH = (lx: number, lz: number, h: number) => {
    if (lx >= 0 && lz >= 0 && lx < L && lz < L) heights.set(key(lx, lz), h);
  };
  /** Set heights along a street: f(block, side 0/1, k 0/1) -> height. */
  const shape = (axis: "x" | "z", street: number, b0: number, b1: number, f: (b: number, side: number, k: number) => number) => {
    for (let b = Math.min(b0, b1); b <= Math.max(b0, b1); b++) {
      const sides = sideLots(axis, street, b);
      for (let side = 0; side < 2; side++) for (let k = 0; k < 2; k++) setH(sides[side][k][0], sides[side][k][1], f(b, side, k));
    }
  };

  const anchors: Anchor[] = [];
  const props: Prop[] = [];
  const extra: Box[] = [];
  const wind: Wind[] = [];
  const courses: CourseDef[] = [];

  /** A washing line across a street. along = position along the street axis, c = street centre coordinate. */
  const line = (axis: "x" | "z", c: number, along: number, y: number, sag: number, half = HALF) => {
    const a: V3 = axis === "x" ? [c - half, y, along] : [along, y, c - half];
    const b: V3 = axis === "x" ? [c + half, y, along] : [along, y, c + half];
    anchors.push({ kind: "line", a, b, sag, look: "line" });
  };
  const lamp = (x: number, y: number, z: number) => {
    anchors.push({ kind: "point", a: [x, y, z], look: "antenna" });
    props.push({ kind: "lamp", x, y, z });
  };

  /**
   * String anchors along a street from s0 to s1 (coordinates along the street axis, either
   * direction). Between walls it is a washing line; in an intersection it is a lamp on a cable.
   */
  const strand = (axis: "x" | "z", c: number, s0: number, s1: number, spacing: number, y: (s: number, n: number) => number, sag: number) => {
    const dir = Math.sign(s1 - s0);
    let n = 0;
    for (let s = s0; dir * (s1 - s) >= 0; s += dir * spacing, n++) {
      const m = ((Math.abs(s) % P) + P) % P;
      const inCross = m < HALF + 1.5 || m > P - HALF - 1.5;
      const yy = y(s, n);
      if (inCross) lamp(axis === "x" ? c : s, yy, axis === "x" ? s : c);
      else line(axis, c, s, yy, sag);
    }
  };

  // ---------------------------------------------------------------- Run 1: First Line
  // Straight street x = 1P, heading -z. Evenly spaced lines, level roofs. Teaches hold / release.
  {
    const i = 1, x = i * P;
    shape("x", i, 0, N - 1, (b, side, k) => 19.2 + ((b * 3 + side * 2 + k) % 3) * 1.6);
    strand("x", x, -22, -SIZE + 10, 38, () => 26, 1.2);
    courses.push({
      id: "first-line", name: "First Line", idea: "Hold to swing, let go to fly.",
      hint: "Hold as you fall. Let go on the way up.",
      guide: [node(i, 0), node(i, N)], start: [x, 21, -2], startSpeed: 10,
    });
  }

  // ---------------------------------------------------------------- Run 2: Slack
  // Street x = 3P, heading +z (from j = 9 back to j = 0). Long lines that sag deep in the
  // middle, with market stalls under them: hang near a pole for a tight high arc.
  {
    const i = 3, x = i * P;
    shape("x", i, 0, N - 1, (b, side, k) => 17.6 + ((b + side + k) % 2) * 3.2);
    let n = 0;
    for (let z = -SIZE + 22; z < -12; z += 36, n++) {
      const m = ((-z % P) + P) % P;
      if (m < HALF + 1.5 || m > P - HALF - 1.5) { lamp(x, 25, z); continue; }
      line("x", x, z, 25, 6);
      // A stall a little past each line, alternating sides of the street centre.
      const off = n % 2 ? 3 : -3;
      const zs = z + 13;
      const ms = ((-zs % P) + P) % P;
      if (ms > HALF + 6 && ms < P - HALF - 6) {
        extra.push({ x0: x + off - 3, x1: x + off + 3, z0: zs - 4, z1: zs + 4, h: 6.4 });
        props.push({ kind: "stall", x: x + off, y: 0, z: zs, a: n });
      }
    }
    courses.push({
      id: "slack", name: "Slack", idea: "Lines sag most in the middle.",
      hint: "Slide your thumb to hang nearer a pole: tighter, higher swing.",
      guide: [node(i, N), node(i, 0)], start: [x, 21, -N * P + 2], startSpeed: 10,
    });
  }

  // ---------------------------------------------------------------- Run 3: Corner
  // East along z = -2P (i 0→5), south along x = 5P (j 2→6), east along z = -6P (i 5→9).
  {
    shape("z", 2, 0, 4, (b, s, k) => 20.8 + ((b + s * k) % 2) * 1.6);
    shape("x", 5, 2, 5, (b, s, k) => 20.8 + ((b + s + k) % 2) * 1.6);
    shape("z", 6, 5, 8, (b, s, k) => 20.8 + ((b * s + k) % 2) * 1.6);
    const y = () => 27;
    strand("z", -2 * P, 24, 5 * P - 30, 36, y, 1.2);
    strand("x", 5 * P, -2 * P - 30, -6 * P + 30, 36, y, 1.2);
    strand("z", -6 * P, 5 * P + 30, SIZE - 10, 36, y, 1.2);
    // Corner pivots: tall antennas on the inside corner roofs.
    const ant = (x: number, z: number, lx: number, lz: number) => {
      setH(lx, lz, 22.4);
      anchors.push({ kind: "point", a: [x, 31, z], look: "antenna" });
      props.push({ kind: "antenna", x, y: 22.4, z, a: 31 - 22.4 });
    };
    ant(5 * P - HALF - 2, -2 * P - HALF - 2, 9, 4); // east → south: inside corner is the south-west block
    ant(5 * P + HALF + 2, -6 * P + HALF + 2, 10, 11); // south → east: inside corner is the north-east block
    courses.push({
      id: "corner", name: "Corner", idea: "Lean to carry speed round a turn.",
      hint: "Slide toward the turn while you hold. The antenna is the pivot.",
      guide: [node(0, 2), node(5, 2), node(5, 6), node(9, 6)], start: [2, 22, -2 * P], startSpeed: 10,
    });
  }

  // ---------------------------------------------------------------- Run 4: Crane Yard
  // Street x = 7P heading -z. Low unfinished buildings, crane hooks that travel.
  {
    const i = 7, x = i * P;
    shape("x", i, 0, N - 1, (b, side, k) => 9.6 + ((b * 5 + side * 3 + k) % 4) * 1.6);
    let n = 0;
    for (let z = -24; z > -SIZE + 8; z -= 40, n++) {
      const side = n % 2 ? 1 : -1;
      const across = n % 3 !== 2;
      const y = 26 + (n % 2) * 2;
      anchors.push({
        kind: "point", a: [x, y, z], look: "crane",
        move: across
          ? { axis: [5.5, 0, 0], period: 3.6 + (n % 3) * 0.5, phase: (n * 0.37) % 1 }
          : { axis: [0, 3.5, 0], period: 3.0, phase: (n * 0.41) % 1 },
      });
      props.push({ kind: "crane", x: x + side * (HALF + 6), y: 0, z, a: y + 4, b: -side, c: across ? 0 : 1 });
    }
    courses.push({
      id: "crane-yard", name: "Crane Yard", idea: "Anchors that move.",
      hint: "Watch the hook, not the crane. Grab when it swings your way.",
      guide: [node(i, 0), node(i, N)], start: [x, 21, -2], startSpeed: 12,
    });
  }

  // ---------------------------------------------------------------- Run 5: Kite Wind
  // Street z = -8P heading -x (i 9→0). Kites as anchors; alternating cross-wind.
  {
    const j = 8, z = -j * P;
    shape("z", j, 0, N - 1, (b, side, k) => 14.4 + ((b + side * 2 + k) % 3) * 1.6);
    let n = 0;
    for (let kx = SIZE - 24; kx > 8; kx -= 38, n++) {
      anchors.push({
        kind: "point", a: [kx, 27, z + ((n % 3) - 1) * 2.5], look: "kite",
        move: { axis: [0, 1.2, 1.5], period: 2.6 + (n % 4) * 0.3, phase: (n * 0.29) % 1 },
      });
    }
    // Wind blows across the street in alternating blocks, with a calm block between.
    for (let b = N - 1; b >= 0; b--) {
      if (b % 3 === 1) continue;
      const dir = b % 3 === 0 ? 1 : -1;
      wind.push({ x0: b * P + HALF, x1: (b + 1) * P - HALF, z0: z - 14, z1: z + 14, y0: 0, y1: 60, accel: [0, 1.5, dir * 7] });
    }
    courses.push({
      id: "kite-wind", name: "Kite Wind", idea: "Wind pushes the swing sideways.",
      hint: "Lean into the wind. The washing shows which way it blows.",
      guide: [node(N, j), node(0, j)], start: [N * P - 2, 21, z], startSpeed: 12,
    });
  }

  // ---------------------------------------------------------------- Run 6: The Drop
  // Street z = -4P heading +x. Towers and high lines for the first half, then the street
  // falls away to low roofs: let go, fall, and catch the low lines with all that speed.
  {
    const j = 4, z = -j * P;
    shape("z", j, 0, 3, (b, s, k) => 41.6 + ((b + s + k) % 2) * 3.2);
    shape("z", j, 4, N - 1, (b, s, k) => 12.8 + ((b * 2 + s + k) % 3) * 1.6);
    strand("z", z, 22, 4 * P - 24, 38, () => 51, 1.2);
    strand("z", z, 4 * P + 28, SIZE - 10, 38, () => 22, 1.2);
    courses.push({
      id: "the-drop", name: "The Drop", idea: "Fall is speed. Catch it low.",
      hint: "After the towers, let go and fall. Hold again late.",
      guide: [node(0, j), node(N, j)], start: [2, 46, z], startSpeed: 12,
    });
  }

  const lots: Lot[] = [];
  for (let lx = 0; lx < L; lx++)
    for (let lz = 0; lz < L; lz++) {
      const r = lotRect(lx, lz);
      lots.push({ ...r, h: heights.get(key(lx, lz))!, lx, lz, tint: Math.floor(hash(lx, lz, 7) * 1000) });
    }
  // Roof furniture (render only).
  for (const lot of lots) {
    const r = hash(lot.lx, lot.lz, 3);
    if (r < 0.3) props.push({ kind: "tank", x: lot.x0 + 5 + hash(lot.lx, lot.lz, 4) * 12, y: lot.h, z: lot.z0 + 5 + hash(lot.lx, lot.lz, 5) * 12 });
  }
  return { lots, extra, anchors, props, wind, courses };
}

let _d: District | null = null;
export function district(): District {
  return (_d ??= buildDistrict());
}

/** The simulation's view of one run: only what is near its guide. */
export function courseWorld(d: District, index: number): SimWorld {
  const c = d.courses[index];
  const near = (x: number, z: number, r: number) => {
    for (let i = 1; i < c.guide.length; i++) {
      const a = c.guide[i - 1], b = c.guide[i];
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const l2 = dx * dx + dz * dz;
      let u = ((x - a[0]) * dx + (z - a[2]) * dz) / l2;
      u = Math.max(-0.1, Math.min(1.1, u));
      if (Math.hypot(x - a[0] - dx * u, z - a[2] - dz * u) < r) return true;
    }
    return false;
  };
  const boxes: Box[] = [];
  for (const b of [...d.lots, ...d.extra]) if (near((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 75)) boxes.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, h: b.h });
  const anchors = d.anchors.filter((a) => near(a.a[0], a.a[2], 40));
  const course: Course = { id: c.id, name: c.name, idea: c.idea, guide: c.guide, start: c.start, startSpeed: c.startSpeed, anchors, wind: d.wind };
  return makeWorld(boxes, course);
}
