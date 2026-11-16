// Paint: a top-down map of the district. Pure functions on a Uint8Array.
// Value 0..255 per cell; a splat shows its colour when the cell value exceeds the splat's
// own random threshold, so partial values read as stippling.

import type { Tuning } from "../tuning";
import type { SimWorld } from "./world";

export const PAINT_W = 512;
export const PAINT_H = 512;
/** Metres covered by the map on each axis: x in [0, PAINT_SPAN], z in [-PAINT_SPAN, 0]. */
export const PAINT_SPAN = 540;
export const CELL = PAINT_SPAN / PAINT_W;

export function paintCol(x: number): number { return (x / PAINT_SPAN) * PAINT_W; }
export function paintRow(z: number): number { return (-z / PAINT_SPAN) * PAINT_H; }

export function newPaint(): Uint8Array { return new Uint8Array(PAINT_W * PAINT_H); }

/** Raise paint around (x, z). Returns true if anything changed. */
export function stamp(map: Uint8Array, x: number, z: number, radius: number, strength: number): boolean {
  if (radius <= 0 || strength <= 0) return false;
  const cx = paintCol(x), cz = paintRow(z), r = radius / CELL;
  const c0 = Math.max(0, Math.floor(cx - r)), c1 = Math.min(PAINT_W - 1, Math.ceil(cx + r));
  const r0 = Math.max(0, Math.floor(cz - r)), r1 = Math.min(PAINT_H - 1, Math.ceil(cz + r));
  let changed = false;
  const top = 255 * strength, ir2 = 1 / (r * r);
  for (let row = r0; row <= r1; row++) {
    const dz = row + 0.5 - cz;
    for (let col = c0; col <= c1; col++) {
      const dx = col + 0.5 - cx;
      const q = 1 - (dx * dx + dz * dz) * ir2;
      if (q <= 0) continue;
      // Flat core, soft rim.
      const v = (top * Math.min(1, q * 2.2)) | 0;
      const i = row * PAINT_W + col;
      if (v > map[i]) { map[i] = v; changed = true; }
    }
  }
  return changed;
}

/** Paint laid down by moving at `speed`: [radius m, strength 0..1]. */
export function brush(speed: number, T: Tuning): [number, number] {
  const f = Math.max(0, Math.min(1, (speed - T.paintMinSpeed) / (T.paintFullSpeed - T.paintMinSpeed)));
  if (f <= 0) return [0, 0];
  return [T.paintRadiusMin + (T.paintRadius - T.paintRadiusMin) * f, 0.4 + 0.6 * f];
}

/** Cells that count for a run: everything within `reach` metres of its guide. */
export function courseMask(w: SimWorld, reach = 13): Uint32Array {
  const g = w.course.guide;
  const out: number[] = [];
  for (let row = 0; row < PAINT_H; row++) {
    const z = -((row + 0.5) / PAINT_H) * PAINT_SPAN;
    for (let col = 0; col < PAINT_W; col++) {
      const x = ((col + 0.5) / PAINT_W) * PAINT_SPAN;
      for (let i = 1; i < g.length; i++) {
        const ax = g[i - 1][0], az = g[i - 1][2];
        const dx = g[i][0] - ax, dz = g[i][2] - az;
        let u = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        if (Math.hypot(x - ax - dx * u, z - az - dz * u) <= reach) { out.push(row * PAINT_W + col); break; }
      }
    }
  }
  return Uint32Array.from(out);
}

/** 0..1: how full the run's street is. */
export function coverage(map: Uint8Array, mask: Uint32Array): number {
  let sum = 0;
  for (let i = 0; i < mask.length; i++) sum += map[mask[i]];
  return mask.length ? sum / (255 * mask.length) : 0;
}

export function extract(map: Uint8Array, mask: Uint32Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = map[mask[i]];
  return out;
}

/** map[cell] = max(map[cell], values[i] * scale) over the mask. */
export function mergeMax(map: Uint8Array, mask: Uint32Array, values: Uint8Array, scale = 1): void {
  const n = Math.min(mask.length, values.length);
  for (let i = 0; i < n; i++) {
    const v = (values[i] * scale) | 0;
    if (v > map[mask[i]]) map[mask[i]] = v;
  }
}
