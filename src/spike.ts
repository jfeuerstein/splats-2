// M0 render spike: fly down course 0's street on a swing-like path.
// URL: ?spike=1 [&paint=0..1] [&budget=N] [&auto=0] [&snap=0|1] [&radial=0|1] [&ext=0|1] [&scale=x] [&near=m&far=m] [&minpx=x]

import { createView, type View } from "./render/view";
import { district } from "./world/district";
import { anchorPos, type Anchor, type V3 } from "./sim/world";
import { PAINT_W, PAINT_H, PAINT_SPAN } from "./sim/paint";
import { T } from "./tuning";
import { setDetailWeight } from "./render/city";

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

if (q.has("snap")) T.pixelSnap = num("snap", 0);
if (q.has("scale")) T.splatScale = num("scale", T.splatScale);
if (q.has("near")) T.lodNear = num("near", T.lodNear);
if (q.has("far")) T.lodFar = num("far", T.lodFar);
if (q.has("minpx")) T.minPx = num("minpx", T.minPx);
if (q.has("dw")) setDetailWeight(num("dw", 0.6));
if (q.has("loww")) T.lowW = num("loww", T.lowW);

const SPEED = 22;
const course = district().courses[0];
const X = course.guide[0][0];

function pose(s: number): { pos: V3; look: V3 } {
  const pos: V3 = [X + 3 * Math.sin(s / 40), 9 + 5 * Math.cos(s / 11), -s];
  const vx = (3 / 40) * Math.cos(s / 40), vy = (-5 / 11) * Math.sin(s / 11), vz = -1;
  const l = Math.hypot(vx, vy, vz);
  return { pos, look: [pos[0] + (12 * vx) / l, pos[1] + (12 * vy) / l, pos[2] + (12 * vz) / l] };
}

function fillPaint(view: View, f: number): void {
  // painted where -z < f * span, with a 30 m stippled ramp
  const p = view.paint;
  for (let row = 0; row < PAINT_H; row++) {
    const zz = ((row + 0.5) / PAINT_H) * PAINT_SPAN; // = -z
    const v = Math.max(0, Math.min(1, (f * PAINT_SPAN - zz) / 30 + 0.5));
    p.fill(f >= 1 ? 255 : f <= 0 ? 0 : Math.round(v * 255), row * PAINT_W, (row + 1) * PAINT_W);
  }
  view.paintDirty();
}

const lines: Anchor[] = district().anchors.filter((a) => a.kind === "line");
const tmp: V3 = [0, 0, 0];
const CLOTHES = [6, 7, 8, 9, 11, 13, 15];

/** Placeholder dynamic content: runner blob, rope to the next line, and the washing lines with clothes. */
function drawDyn(view: View, s: number, t: number): void {
  const d = view.dyn;
  d.begin();
  const cam = view.camera.position;
  // washing lines near the camera (the game will own these)
  for (let li = 0; li < lines.length; li++) {
    const a = lines[li];
    const dz = a.a[2] - cam.z, dx = a.a[0] - cam.x;
    if (dx * dx + dz * dz > 160 * 160) continue;
    const len = Math.hypot(a.b![0] - a.a[0], a.b![2] - a.a[2]);
    const n = Math.ceil(len / 0.25);
    for (let k = 0; k <= n; k++) {
      anchorPos(a, t, k / n, 0, tmp);
      d.add(tmp[0], tmp[1], tmp[2], 0.05, 12);
    }
    // clothes: small rectangles hanging below, pale until painted
    for (let c = 0; c < 6; c++) {
      const u = 0.15 + c * 0.13;
      anchorPos(a, t, u, 0, tmp);
      const pc = CLOTHES[(li * 7 + c * 3) % CLOTHES.length];
      const sway = 0.08 * Math.sin(t * 3 + c + li);
      const w = c % 3 === 0 ? 3 : 2, h = c % 2 === 0 ? 4 : 3;
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
        const x = tmp[0] + (a.b![0] !== a.a[0] ? (i - (w - 1) / 2) * 0.18 : 0);
        const z = tmp[2] + (a.b![2] !== a.a[2] ? (i - (w - 1) / 2) * 0.18 : 0) + sway * j;
        const y = tmp[1] - 0.1 - j * 0.18;
        d.add(x, y, z, 0.11, view.paletteAt(x, z, pc, j === 0 ? 1 : 0, (i * 37 + j * 91 + c * 53) % 255));
      }
    }
  }
  // runner: 10 m ahead on the path, 2 m below
  const r = pose(s + 10).pos;
  const rx = r[0], ry = r[1] - 2, rz = r[2];
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996, h = (i / 26) * 1.6;
    d.add(rx + Math.cos(a) * 0.22, ry + h - 0.8, rz + Math.sin(a) * 0.22, 0.17, i > 20 ? 13 : 12);
  }
  // rope to the next line ahead
  let best: Anchor | null = null;
  for (const a of lines) if (a.a[2] < rz - 4 && (!best || a.a[2] > best.a[2]) && Math.abs(a.a[0] - X) < 20) best = a;
  if (best) {
    anchorPos(best, t, 0.5, 0.3, tmp);
    const len = Math.hypot(tmp[0] - rx, tmp[1] - ry, tmp[2] - rz);
    const n = Math.ceil(len / 0.2);
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      d.add(rx + (tmp[0] - rx) * u, ry + 0.6 + (tmp[1] - ry - 0.6) * u, rz + (tmp[2] - rz) * u, 0.04, 13);
    }
  }
  d.end();
}

async function main(): Promise<void> {
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const view = await createView(canvas, {
    sortRadial: num("radial", 1) > 0.5,
    accumExtSplats: num("ext", 0) > 0.5,
  });
  if (q.has("budget")) view.setBudget(num("budget", 100000));
  fillPaint(view, num("paint", 0));
  window.addEventListener("resize", () => view.resize());

  let curS = 0;
  const setPose = (s: number) => {
    curS = s;
    const p = pose(s);
    view.camera.fov = 68;
    view.camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
    view.camera.up.set(0, 1, 0);
    view.camera.lookAt(p.look[0], p.look[1], p.look[2]);
    view.camera.updateMatrixWorld();
  };
  // deterministic dyn time for tools: tied to s
  const frameAt = async (s: number) => {
    setPose(s);
    drawDyn(view, s, s / SPEED);
    view.render(s / SPEED);
    await view.settle();
    view.render(s / SPEED);
  };

  const auto = num("auto", 1) > 0.5;
  const toB64 = (u: Uint8Array) => {
    let str = "";
    for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(str);
  };
  setPose(0);
  const ready = (async () => { await frameAt(0); })();
  (window as unknown as { __wl: unknown }).__wl = {
    ready,
    view,
    pose,
    frame: frameAt,
    grab: () => { const g = view.grab(); return { w: g.w, h: g.h, rgba: toB64(g.rgba) }; },
    stats: () => ({ ...view.stats(), s: curS, debug: debugStats(view) }),
  };
  await ready;
  if (auto) {
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      const s = (t * SPEED) % 540;
      setPose(s);
      drawDyn(view, s, t);
      view.render(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

function debugStats(view: View): Record<string, number> {
  const d = (view as unknown as { _debug: { spark: { activeSplats: number }; pool: { lodScale: number; lastSelectMs: number; uploads: number; uploadBytes: number; capacity: number; backlog: number } } })._debug;
  return { activeSplats: d.spark.activeSplats, lodScale: d.pool.lodScale, selectMs: d.pool.lastSelectMs, uploads: d.pool.uploads, uploadBytes: d.pool.uploadBytes, capacity: d.pool.capacity, backlog: d.pool.backlog };
}

void main();
