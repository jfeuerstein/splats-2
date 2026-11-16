// The game: states (menu / ready / run / done), the fixed-step loop, and the glue between
// simulation, view, input, UI, saves and sound.
import { T, loadTuning } from "../tuning";
import { DT, HZ, SWING, EV_RELEASE, initState, pickAnchor, steerWant, step, type Input, type Pick, type SimState } from "../sim/sim";
import { makeBot, pushScript } from "../sim/bot";
import type { SimWorld } from "../sim/world";
import { stampRun, coverage, courseMask, extract, mergeMax, newPaint, stamp } from "../sim/paint";
import { courseWorld, district } from "../world/district";
import { SCRIPTS } from "../world/scripts";
import { createView, type View } from "../render/view";
import { FollowCam } from "./camera";
import { TouchInput } from "./input";
import { Trail, drawAnchors, drawGhost, drawReticle, drawRope, drawRunner, type DrawCtx } from "./actors";
import { createUi } from "./ui";
import { createSheet, installSheetGesture } from "./sheet";
import { GHOST_HZ, loadSave, recordRun, storeSave, wipeSave } from "./save";
import { createAudio } from "./audio";
import { runBenchmark } from "./bench";

type Mode = "menu" | "ready" | "run" | "done";

const q = new URLSearchParams(location.search);
const manual = q.has("manual"); // tools drive time; no real-time stepping

export interface Game {
  view: View;
  mode(): Mode;
  state(): SimState;
  world(): SimWorld;
  pick(index: number): void;
  restart(): void;
  /** Step the simulation `ticks` times with a fixed input, then draw. For tools. */
  advance(ticks: number, hold: boolean, lean: number): void;
  /** Replay a run-length script from the start of the current run, drawing every `every` ticks. */
  play(script: number[], every?: number): Promise<void>;
  fill(): number;
  draw(): void;
  /** The recorded bot script of run `i` (valid for default tuning). */
  scriptFor(i: number): number[];
}

async function boot(): Promise<void> {
  loadTuning();
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const uiRoot = document.getElementById("ui") as HTMLElement;
  const view = await createView(canvas);
  const d = district();
  const worlds = d.courses.map((_, i) => courseWorld(d, i));
  const masks = worlds.map((w) => courseMask(w));
  let save = loadSave();
  const audio = createAudio();
  const input = new TouchInput(canvas);
  const cam = new FollowCam();
  const trail = new Trail();

  let mode: Mode = "menu";
  let index = Math.max(0, d.courses.findIndex((c) => c.id === save.lastRun));
  let w = worlds[index];
  let s = initState(w);
  let live = newPaint(); // this run's paint
  let script: number[] = [];
  let ghostRec: number[] = [];
  let doneAt = 0;
  let hinted = false;
  let fillShown = 0;
  let painting = 0;
  const bot = makeBot();
  const raw = { hold: false, lean: 0 };
  const tickIn: Input = { hold: false, lean: 0 };
  const pk: Pick = { anchor: -1, u: 0, score: 0, x: 0, y: 0, z: 0 };
  let lastPresses = 0;

  // ---------------------------------------------------------------- paint bookkeeping
  /** Fill the displayed map from saved best runs. scale < 1 shows them as a lighter stipple. */
  function showBest(scale: number): void {
    view.paint.fill(0);
    d.courses.forEach((c, i) => {
      const r = save.runs[c.id];
      if (r) mergeMax(view.paint, masks[i], r.paint, scale);
    });
    view.paintDirty();
  }

  // ---------------------------------------------------------------- UI
  const cards = () => d.courses.map((c) => ({ id: c.id, name: c.name, idea: c.idea, best: save.runs[c.id]?.best ?? 0, plays: save.runs[c.id]?.plays ?? 0 }));
  const ui = createUi(uiRoot, {
    onTap: () => { audio.unlock(); audio.ui("tap"); },
    onPick: (i) => startRun(i < 0 ? (index + 1) % d.courses.length : i),
    onRestart: () => startRun(index),
    onMenu: () => openMenu(),
  });

  function openMenu(): void {
    mode = "menu";
    ui.hideRun(); ui.hideResult();
    ui.showMenu(cards(), index);
    resetSim();
    showBest(1);
  }

  function resetSim(): void {
    w = worlds[index];
    s = initState(w);
    cam.reset(s);
    trail.reset();
    script = []; ghostRec = [];
    live.fill(0);
    hinted = false; fillShown = 0; painting = 0;
    lastPresses = input.presses;
  }

  function startRun(i: number): void {
    index = i;
    save.lastRun = d.courses[i].id;
    resetSim();
    mode = "ready";
    ui.hideMenu(); ui.hideResult();
    ui.showRun(d.courses[i].name, d.courses[i].hint);
    ui.setFill(0);
    showBest(T.bestShow);
    audio.ui("start");
  }

  function finishRun(): void {
    const fill = coverage(live, masks[index]);
    const id = d.courses[index].id;
    const isBest = recordRun(save, id, { best: fill, paint: extract(live, masks[index]), ghost: Int16Array.from(ghostRec), script: script.slice(), ticks: s.tick });
    storeSave(save);
    ui.showResult({ name: d.courses[index].name, fill, best: save.runs[id].best, isBest, hasNext: index < d.courses.length - 1 });
    if (isBest) audio.ui("best");
  }

  // ---------------------------------------------------------------- tuning sheet
  const sheet = createSheet(uiRoot, {
    onChange: (key) => {
      if (key === "volume" || key === "music") audio.setVolume(T.volume, T.music);
      if (key === "budget") view.setBudget(T.budget * 1000);
      if (key === "lowW") view.resize();
      if (key === "bestShow" && mode !== "menu") { showBest(T.bestShow); mergeLive(); }
    },
    actions: [
      { label: "Benchmark", run: async () => { sheet.setReport("Running benchmark… (about 40 s, leave the phone alone)"); sheet.close(); const r = await runBenchmark(game, worlds[0]); sheet.setReport(r); sheet.open(); } },
      { label: "Restart run", run: () => { sheet.close(); startRun(index); } },
      { label: "Wipe save", run: () => { wipeSave(); save = loadSave(); openMenu(); sheet.close(); } },
    ],
    info: () => {
      const st = view.stats();
      return `build ${__BUILD__}\n${st.lowW}x${st.lowH} px · ${fps.toFixed(0)} fps (worst ${worst.toFixed(0)} ms)\nsplats ${st.live}/${st.budget} · levels ${st.levelCounts.join("/")}\nspeed ${Math.hypot(s.vx, s.vy, s.vz).toFixed(1)} m/s · run ${d.courses[index].id}`;
    },
  });
  installSheetGesture(document.body, sheet);

  function mergeLive(): void {
    const p = view.paint;
    for (let i = 0; i < p.length; i++) if (live[i] > p[i]) p[i] = live[i];
    view.paintDirty();
  }

  // ---------------------------------------------------------------- simulation tick
  function tick(inp: Input): void {
    pushScript(script, inp);
    step(s, inp, w, T);
    if (s.ev) {
      audio.event(s.ev, Math.hypot(s.vx, s.vy, s.vz));
      if (s.ev & EV_RELEASE && !hinted) { hinted = true; ui.hideHint(); }
    }
    if (s.tick % (HZ / GHOST_HZ) === 0) {
      ghostRec.push(Math.round(s.px * 10), Math.round(s.py * 10), Math.round(s.pz * 10));
      if (!s.finished) {
        painting = stampRun(live, s.px, s.pz, s.vx, s.vy, s.vz, T);
        if (painting > 0) { stampRun(view.paint, s.px, s.pz, s.vx, s.vy, s.vz, T); view.paintDirty(); }
      }
    }
  }

  // ---------------------------------------------------------------- drawing
  const ctx: DrawCtx = { dyn: view.dyn, paint: view.paint, time: 0, cx: 0, cy: 0, cz: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, pxPerM: 0.005 };

  function draw(alpha = 0, dt = 1 / 60, time = performance.now() / 1000): void {
    // Runner position, extrapolated between ticks.
    const x = s.px + s.vx * alpha, y = s.py + s.vy * alpha, z = s.pz + s.vz * alpha;
    const p = cam.update(s, w, x, y, z, dt);
    const c = view.camera;
    // basis
    let fx = p.lx - p.px, fy = p.ly - p.py, fz = p.lz - p.pz;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx; // f × up(0,1,0) = (-fz, 0, fx)
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    // up = r × f, then roll about f
    let ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
    const upx = ux * cr + rx * sr, upy = uy * cr, upz = uz * cr + rz * sr;
    c.position.set(p.px, p.py, p.pz);
    c.up.set(upx, upy, upz);
    c.lookAt(p.lx, p.ly, p.lz);
    if (Math.abs(c.fov - p.fov) > 0.01) { c.fov = p.fov; c.updateProjectionMatrix(); }
    const st = view.stats();
    ctx.time = time;
    ctx.cx = p.px; ctx.cy = p.py; ctx.cz = p.pz;
    ctx.fx = fx; ctx.fy = fy; ctx.fz = fz;
    ctx.rx = rx * cr - ux * sr; ctx.ry = -uy * sr; ctx.rz = rz * cr - uz * sr;
    ctx.ux = upx; ctx.uy = upy; ctx.uz = upz;
    ctx.pxPerM = (2 * Math.tan((p.fov * Math.PI) / 360)) / (st.lowH || 420);

    view.dyn.begin();
    const held = s.mode === SWING ? w.course.anchors[s.anchor] : null;
    drawAnchors(ctx, d.anchors, d.wind, held, s.u, s.sag, s.tick * DT);
    const g = save.runs[d.courses[index].id]?.ghost;
    if (g && g.length && mode === "run") drawGhost(ctx, g, s.tick, GHOST_HZ);
    drawRope(ctx, s, x, y, z);
    drawRunner(ctx, s, x, y, z);
    trail.update(ctx, s, x, y, z, dt, mode === "menu" ? 0 : painting);
    if (s.mode !== SWING && mode !== "done" && pickAnchor(s, input.hold ? input.lean : s.bias, w, T, pk)) drawReticle(ctx, pk.x, pk.y, pk.z, mode === "ready");
    view.dyn.end();
    view.render(time);
  }

  // ---------------------------------------------------------------- main loop
  let last = 0, acc = 0, fps = 60, worst = 0, worstT = 0;
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const t = now / 1000;
    let dt = t - last;
    last = t;
    if (dt > 0.1 || dt <= 0) dt = 1 / 60; // tab was hidden, or first frame
    fps += (1 / dt - fps) * 0.05;
    if (dt * 1000 > worst || t - worstT > 3) { worst = dt * 1000; worstT = t; }
    if (benchHook) benchHook(dt);

    if (mode === "ready") {
      if (input.presses !== lastPresses && !sheet.isOpen) { mode = "run"; audio.unlock(); }
    }
    if (sheet.isOpen && mode === "run") { /* paused while tuning */ }
    else if (mode === "run" || mode === "done" || mode === "menu") {
      acc += dt;
      while (acc >= DT) {
        acc -= DT;
        if (mode === "menu" || auto) {
          bot(s, w, T, tickIn);
          if (mode === "menu") { step(s, tickIn, w, T); if (s.finished) resetSim(); }
          else tick(tickIn);
        } else if (mode === "run") {
          input.read(raw);
          tickIn.hold = raw.hold;
          tickIn.lean = T.scheme === 2 ? (raw.hold ? steerWant(s, w, T) : 0) : raw.lean;
          tick(tickIn);
        } else {
          tickIn.hold = false; tickIn.lean = 0;
          step(s, tickIn, w, T);
        }
        if (mode === "run" && s.finished) { mode = "done"; doneAt = t; }
      }
      if (mode === "done" && doneAt && t - doneAt > 0.9) { doneAt = 0; finishRun(); }
    } else acc = 0;

    if (mode === "run" || mode === "done") {
      const f = coverage(live, masks[index]);
      if (Math.abs(f - fillShown) >= 0.005) { fillShown = f; ui.setFill(f); }
    }
    audio.frame({ speed: Math.hypot(s.vx, s.vy, s.vz), mode: s.mode as 0 | 1 | 2, vy: s.vy, lean: s.lean, painting: mode === "run" ? painting : 0, fill: fillShown, inRun: mode === "run" }, dt);
    draw(mode === "ready" ? 0 : acc, dt, t);
  }

  // ---------------------------------------------------------------- tool / benchmark hooks
  let auto = q.has("bot");
  let benchHook: ((dt: number) => void) | null = null;
  const game: Game & { setAuto(on: boolean): void; onFrame(f: ((dt: number) => void) | null): void } = {
    view,
    mode: () => mode,
    state: () => s,
    world: () => w,
    pick: (i) => startRun(i),
    restart: () => startRun(index),
    advance(ticks, hold, lean) {
      if (mode === "ready") mode = "run";
      tickIn.hold = hold; tickIn.lean = lean;
      for (let i = 0; i < ticks; i++) { if (mode === "run") tick(tickIn); else step(s, tickIn, w, T); if (mode === "run" && s.finished) { mode = "done"; finishRun(); } }
      draw(0, ticks * DT, s.tick * DT);
    },
    async play(sc, every = 0) {
      startRun(index);
      mode = "run";
      for (let i = 0; i < sc.length && mode === "run"; i += 3) {
        tickIn.hold = sc[i + 1] === 1; tickIn.lean = sc[i + 2] / 100;
        for (let k = 0; k < sc[i] && mode === "run"; k++) {
          tick(tickIn);
          if (s.finished) { mode = "done"; finishRun(); }
          else if (every && s.tick % every === 0) { draw(0, every * DT, s.tick * DT); await view.settle(); }
        }
      }
      draw(0, DT, s.tick * DT);
      await view.settle();
      draw(0, DT, s.tick * DT);
    },
    fill: () => coverage(live, masks[index]),
    draw: () => draw(0, 1 / 60, s.tick * DT),
    scriptFor: (i) => SCRIPTS[d.courses[i].id],
    setAuto: (on) => { auto = on; },
    onFrame: (f) => { benchHook = f; },
  };

  window.addEventListener("resize", () => view.resize());
  window.addEventListener("orientationchange", () => view.resize());
  document.addEventListener("visibilitychange", () => { if (document.hidden) audio.suspend(); else { audio.resume(); last = 0; } });
  window.addEventListener("pointerup", () => audio.unlock(), { passive: true });
  audio.setVolume(T.volume, T.music);
  view.setBudget(T.budget * 1000);
  view.resize();

  if (q.has("run")) startRun(Math.max(0, Math.min(d.courses.length - 1, Number(q.get("run")) || 0)));
  else openMenu();

  draw();
  await view.settle();
  draw();
  (window as any).__wl = { ready: Promise.resolve(), view, game, grab: () => view.grab(), stats: () => view.stats() };
  if (!manual) requestAnimationFrame(frame);
}

declare const __BUILD__: string;

boot().catch((e) => {
  console.error(e);
  const pre = document.createElement("pre");
  pre.style.cssText = "position:fixed;inset:0;margin:0;padding:24px;background:#f4efe6;color:#2b2a4a;white-space:pre-wrap;font:14px ui-monospace,monospace;z-index:99";
  pre.textContent = "Washline could not start.\n\n" + (e?.stack || e);
  document.body.appendChild(pre);
});
