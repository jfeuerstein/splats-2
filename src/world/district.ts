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

  // ---------------------------------------------------------------- Run 1: First Line
  // Straight street x = 1P, heading -z. Evenly spaced lines, level roofs. Teaches hold / release.
  {
    const i = 1, x = i * P;
    shape("x", i, 0, N - 1, (b, side, k) => 19.2 + ((b * 3 + side * 2 + k) % 3) * 1.6);
    for (let b = 0; b < N; b++) {
      const z = -b * P;
      if (b > 0) lamp(x, 25, z);
      line("x", x, z - 19, 25, 1.2);
      line("x", x, z - 41, 25, 1.2);
    }
    courses.push({
      id: "first-line", name: "First Line", idea: "Hold to swing, let go to fly.",
      hint: "Hold as you fall. Let go on the way up.",
      guide: [node(i, 0), node(i, N)], start: [x, 20, -2], startSpeed: 10,
    });
  }

  // ---------------------------------------------------------------- Run 2: Slack
  // Street x = 3P, heading +z (from j = 9 back to j = 0). Long lines that sag deep in the
  // middle, with market stalls under them: hang near a pole for a tight high arc.
  {
    const i = 3, x = i * P;
    shape("x", i, 0, N - 1, (b, side, k) => 17.6 + ((b + side + k) % 2) * 3.2);
    for (let b = N - 1; b >= 0; b--) {
      const zc = -b * P - P / 2;
      if (b < N - 1) lamp(x, 24, -(b + 1) * P);
      line("x", x, zc + 11, 24, 5.5);
      line("x", x, zc - 11, 24, 5.5);
      // A stall under the middle of each block, alternating sides of centre.
      const off = b % 2 ? 2.5 : -2.5;
      const st = { x0: x + off - 3, x1: x + off + 3, z0: zc - 5, z1: zc + 5, h: 6.4 };
      extra.push(st);
      props.push({ kind: "stall", x: x + off, y: 0, z: zc, a: b });
    }
    courses.push({
      id: "slack", name: "Slack", idea: "Lines sag most in the middle.",
      hint: "Slide your thumb to hang nearer a pole: tighter, higher swing.",
      guide: [node(i, N), node(i, 0)], start: [x, 20, -N * P + 2], startSpeed: 10,
    });
  }

  // ---------------------------------------------------------------- Run 3: Corner
  // East along z = -2P (i 0→5), south along x = 5P (j 2→6), east along z = -6P (i 5→9).
  {
    shape("z", 2, 0, 4, (b, s, k) => 20.8 + ((b + s * k) % 2) * 1.6);
    shape("x", 5, 2, 5, (b, s, k) => 20.8 + ((b + s + k) % 2) * 1.6);
    shape("z", 6, 5, 8, (b, s, k) => 20.8 + ((b * s + k) % 2) * 1.6);
    const y = 26;
    for (let b = 0; b < 5; b++) {
      const xs = b * P;
      if (b > 0) lamp(xs, y, -2 * P);
      line("z", -2 * P, xs + 19, y, 1.2);
      line("z", -2 * P, xs + 41, y, 1.2);
    }
    for (let b = 2; b < 6; b++) {
      const zs = -b * P;
      if (b > 2) lamp(5 * P, y, zs);
      line("x", 5 * P, zs - 19, y, 1.2);
      line("x", 5 * P, zs - 41, y, 1.2);
    }
    for (let b = 5; b < N; b++) {
      const xs = b * P;
      if (b > 5) lamp(xs, y, -6 * P);
      line("z", -6 * P, xs + 19, y, 1.2);
      line("z", -6 * P, xs + 41, y, 1.2);
    }
    // Corner pivots: tall antennas on the inside corner roofs.
    const ant = (x: number, z: number, lx: number, lz: number) => {
      setH(lx, lz, 22.4);
      anchors.push({ kind: "point", a: [x, 31, z], look: "antenna" });
      props.push({ kind: "antenna", x, y: 22.4, z, a: 31 - 22.4 });
    };
    ant(5 * P - HALF - 1, -2 * P - HALF - 1, 9, 4); // right turn (east → south): inside is south-west... see guide
    ant(5 * P + HALF + 1, -6 * P + HALF + 1, 10, 11); // left turn (south → east)
    courses.push({
      id: "corner", name: "Corner", idea: "Lean to carry speed round a turn.",
      hint: "Slide toward the turn while you hold. The antenna is the pivot.",
      guide: [node(0, 2), node(5, 2), node(5, 6), node(9, 6)], start: [2, 21, -2 * P], startSpeed: 10,
    });
  }

  // ---------------------------------------------------------------- Run 4: Crane Yard
  // Street x = 7P heading -z. Low unfinished buildings, crane hooks that travel.
  {
    const i = 7, x = i * P;
    shape("x", i, 0, N - 1, (b, side, k) => 9.6 + ((b * 5 + side * 3 + k) % 4) * 1.6);
    let n = 0;
    for (let b = 0; b < N; b++) {
      const z0 = -b * P;
      for (const dz of [0, -30]) {
        if (b === 0 && dz === 0) continue;
        const z = z0 + dz;
        const side = n % 2 ? 1 : -1;
        const across = n % 3 !== 2;
        const y = 25 + (n % 2) * 2;
        anchors.push({
          kind: "point", a: [x, y, z], look: "crane",
          move: across
            ? { axis: [5.5, 0, 0], period: 3.6 + (n % 3) * 0.5, phase: (n * 0.37) % 1 }
            : { axis: [0, 3.5, 0], period: 3.0, phase: (n * 0.41) % 1 },
        });
        props.push({ kind: "crane", x: x + side * (HALF + 6), y: 0, z, a: y + 3, b: -side, c: across ? 0 : 1 });
        n++;
      }
    }
    courses.push({
      id: "crane-yard", name: "Crane Yard", idea: "Anchors that move.",
      hint: "Watch the hook, not the crane. Grab when it swings your way.",
      guide: [node(i, 0), node(i, N)], start: [x, 20, -2], startSpeed: 12,
    });
  }

  // ---------------------------------------------------------------- Run 5: Kite Wind
  // Street z = -8P heading -x (i 9→0). Kites as anchors; alternating cross-wind.
  {
    const j = 8, z = -j * P;
    shape("z", j, 0, N - 1, (b, side, k) => 14.4 + ((b + side * 2 + k) % 3) * 1.6);
    let n = 0;
    for (let b = N - 1; b >= 0; b--) {
      const xc = b * P + P / 2;
      for (const dx of [15, -15]) {
        const kx = xc + dx;
        anchors.push({
          kind: "point", a: [kx, 26, z + ((n % 3) - 1) * 2], look: "kite",
          move: { axis: [0, 1.2, 1.5], period: 2.6 + (n % 4) * 0.3, phase: (n * 0.29) % 1 },
        });
        n++;
      }
      // Wind blows across the street in alternating blocks, with a calm block between.
      if (b % 3 !== 1) {
        const dir = b % 3 === 0 ? 1 : -1;
        wind.push({ x0: b * P + HALF, x1: (b + 1) * P - HALF, z0: z - 14, z1: z + 14, y0: 0, y1: 60, accel: [0, 1.5, dir * 7] });
      }
    }
    courses.push({
      id: "kite-wind", name: "Kite Wind", idea: "Wind pushes the swing sideways.",
      hint: "Lean into the wind. The washing shows which way it blows.",
      guide: [node(N, j), node(0, j)], start: [N * P - 2, 20, z], startSpeed: 12,
    });
  }

  // ---------------------------------------------------------------- Run 6: The Drop
  // Street z = -4P heading +x. Towers and high lines for the first half, then the street
  // falls away to low roofs: let go, fall, and catch the low lines with all that speed.
  {
    const j = 4, z = -j * P;
    shape("z", j, 0, 3, (b, s, k) => 41.6 + ((b + s + k) % 2) * 3.2);
    shape("z", j, 4, N - 1, (b, s, k) => 12.8 + ((b * 2 + s + k) % 3) * 1.6);
    for (let b = 0; b < N; b++) {
      const xs = b * P;
      const high = b < 4;
      const y = high ? 50 : b === 4 ? 30 : 20;
      if (b > 0) lamp(xs, b === 4 ? 44 : y, z);
      line("z", z, xs + 19, y, 1.2);
      line("z", z, xs + 41, b === 4 ? 22 : y, 1.2);
    }
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
