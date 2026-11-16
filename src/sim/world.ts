// Static description of what the simulation can touch. Pure data + pure queries.
// Coordinates: metres, y up. Buildings are axis-aligned boxes standing on y = 0 (the street).

export type V3 = [number, number, number];

export interface Box {
  x0: number; z0: number; x1: number; z1: number; // footprint
  h: number; // roof height
}

export interface Anchor {
  kind: "point" | "line";
  a: V3;
  /** Other end of a line anchor. */
  b?: V3;
  /** Metres the middle of a line drops when carrying the runner. */
  sag?: number;
  /** Moving anchors: a + axis * sin(2π(t/period + phase)). Pure function of time. */
  move?: { axis: V3; period: number; phase: number };
  /** Render hint only. */
  look?: "line" | "crane" | "antenna" | "kite";
}

export interface Wind {
  x0: number; z0: number; x1: number; z1: number; y0: number; y1: number;
  accel: V3;
}

export interface Course {
  id: string;
  name: string;
  idea: string;
  /** Polyline the run follows (x, y, z); y is unused for progress. */
  guide: V3[];
  start: V3;
  startSpeed: number;
  anchors: Anchor[];
  wind: Wind[];
}

export interface SimWorld {
  boxes: Box[];
  course: Course;
  /** Cumulative guide length at each guide vertex. */
  cum: number[];
  length: number;
}

export function makeWorld(boxes: Box[], course: Course): SimWorld {
  const cum = [0];
  for (let i = 1; i < course.guide.length; i++) {
    const a = course.guide[i - 1], b = course.guide[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  return { boxes, course, cum, length: cum[cum.length - 1] };
}

/** Height of the highest roof under (x, z), or 0 for the street. */
export function heightAt(w: SimWorld, x: number, z: number): number {
  let h = 0;
  const bs = w.boxes;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.h > h) h = b.h;
  }
  return h;
}

export interface GuideHit { s: number; seg: number; tx: number; tz: number; lat: number }

/**
 * Project (x, z) on the guide near segment `hint`. `lat` is the signed sideways offset
 * (positive = right of the direction of travel).
 */
export function projectGuide(w: SimWorld, x: number, z: number, hint: number, out: GuideHit): GuideHit {
  const g = w.course.guide;
  const n = g.length - 1;
  let best = Infinity;
  const lo = Math.max(0, hint - 1), hi = Math.min(n - 1, hint + 2);
  for (let i = lo; i <= hi; i++) {
    const ax = g[i][0], az = g[i][2];
    const dx = g[i + 1][0] - ax, dz = g[i + 1][2] - az;
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len, tz = dz / len;
    let u = (x - ax) * tx + (z - az) * tz;
    // Let the first and last segments extend so progress is defined before start / after the end.
    const uc = Math.min(i === n - 1 ? Infinity : len, Math.max(i === 0 ? -Infinity : 0, u));
    const px = ax + tx * uc, pz = az + tz * uc;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) {
      best = d;
      u = uc;
      out.s = w.cum[i] + u;
      out.seg = i;
      out.tx = tx;
      out.tz = tz;
      // right = (-tz, tx)
      out.lat = (x - px) * -tz + (z - pz) * tx;
    }
  }
  return out;
}

/** Position of an anchor's attach point at time t. u = position along a line (0..1), sag = current sag fraction 0..1. */
export function anchorPos(a: Anchor, t: number, u: number, sag: number, out: V3): V3 {
  let x = a.a[0], y = a.a[1], z = a.a[2];
  if (a.kind === "line" && a.b) {
    x += (a.b[0] - x) * u;
    y += (a.b[1] - y) * u;
    z += (a.b[2] - z) * u;
    // Resting droop is a quarter of the loaded sag; load pulls it the rest of the way.
    y -= (a.sag ?? 0) * 4 * u * (1 - u) * (0.25 + 0.75 * sag);
  }
  if (a.move) {
    const k = Math.sin(2 * Math.PI * (t / a.move.period + a.move.phase));
    x += a.move.axis[0] * k;
    y += a.move.axis[1] * k;
    z += a.move.axis[2] * k;
  }
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}
