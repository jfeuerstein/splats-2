import { describe, expect, it } from "vitest";
import { defaults, type Tuning } from "../src/tuning";
import {
  AIR, DT, EV_ATTACH, EV_BUMP, EV_FINISH, EV_LAND, EV_RELEASE, GROUND, SWING,
  cloneState, initState, pickAnchor, speedOf, step,
  type Input, type Pick, type SimState,
} from "../src/sim/sim";
import { runBot, runScript } from "../src/sim/bot";
import { anchorPos, heightAt, makeWorld, projectGuide, type Anchor, type Box, type GuideHit, type SimWorld, type V3 } from "../src/sim/world";
import { greybox } from "../src/world/greybox";

// ---------------------------------------------------------------- helpers

const T0 = (over: Partial<Tuning> = {}): Tuning => ({ ...defaults(), ...over });

interface WOpts { boxes?: Box[]; anchors?: Anchor[]; start?: V3; startSpeed?: number; guide?: V3[] }
/** Test world. Default guide runs straight toward -z from the origin. */
function world(o: WOpts = {}): SimWorld {
  return makeWorld(o.boxes ?? [], {
    id: "t", name: "t", idea: "t",
    guide: o.guide ?? [[0, 0, 0], [0, 0, -400]],
    start: o.start ?? [0, 20, 0],
    startSpeed: o.startSpeed ?? 10,
    anchors: o.anchors ?? [],
    wind: [],
  });
}

const point = (x: number, y: number, z: number): Anchor => ({ kind: "point", a: [x, y, z] });
const HOLD: Input = { hold: true, lean: 0 };
const FREE: Input = { hold: false, lean: 0 };

function newPick(): Pick { return { anchor: -1, u: 0, score: 0, x: 0, y: 0, z: 0 }; }

function expectSameState(a: SimState, b: SimState): void {
  const ka = Object.keys(a) as (keyof SimState)[];
  expect(Object.keys(b).sort()).toEqual([...ka].sort());
  for (const k of ka) expect(b[k], `field ${k}`).toBe(a[k]);
}

/** Expand a run-length script into one Input per tick. */
function expandScript(script: number[]): Input[] {
  const out: Input[] = [];
  for (let i = 0; i < script.length; i += 3)
    for (let k = 0; k < script[i]; k++) out.push({ hold: script[i + 1] === 1, lean: script[i + 2] / 100 });
  return out;
}

const NUM_FIELDS = ["px", "py", "pz", "vx", "vy", "vz"] as const;

// The greybox bot run is used by several tests; compute once.
const gb = greybox();
const gbT = defaults();
const gbRun = runBot(gb, gbT);

// ---------------------------------------------------------------- 1. determinism

describe("determinism", () => {
  it("runBot twice on greybox gives bit-identical state and script", () => {
    const r2 = runBot(greybox(), defaults());
    expect(r2.script).toEqual(gbRun.script);
    expectSameState(gbRun.final, r2.final);
    expect(r2.avgSpeed).toBe(gbRun.avgSpeed);
    expect(r2.topSpeed).toBe(gbRun.topSpeed);
    expect(r2.landings).toBe(gbRun.landings);
    expect(r2.attaches).toBe(gbRun.attaches);
  });

  it("runScript reproduces the bot's final state exactly", () => {
    const s = runScript(gb, gbT, gbRun.script);
    for (const k of ["tick", ...NUM_FIELDS] as const) expect(s[k], k).toBe(gbRun.final[k]);
    expectSameState(gbRun.final, s);
  });
});

// ---------------------------------------------------------------- 2. cloneState

describe("cloneState", () => {
  const inputs = expandScript(gbRun.script);

  it("clone and original stay identical under identical input for 500 ticks", () => {
    const a = initState(gb);
    for (let i = 0; i < 600; i++) step(a, inputs[i], gb, gbT);
    const b = cloneState(a);
    expect(b).not.toBe(a);
    for (let i = 600; i < 1100; i++) {
      step(a, inputs[i], gb, gbT);
      step(b, inputs[i], gb, gbT);
    }
    expectSameState(a, b);
  });

  it("stepping the clone with different input leaves the original untouched", () => {
    const a = initState(gb);
    for (let i = 0; i < 600; i++) step(a, inputs[i], gb, gbT);
    const snapshot = { ...a };
    const b = cloneState(a);
    for (let i = 600; i < 1100; i++) step(b, { hold: !inputs[i].hold, lean: 1 }, gb, gbT);
    expectSameState(snapshot as SimState, a);
    expect(b.tick).toBe(1100);
    expect(a.tick).toBe(600);
    // and the branch really diverged
    const c = cloneState(snapshot as SimState);
    for (let i = 600; i < 1100; i++) step(c, inputs[i], gb, gbT);
    expect([b.px, b.py, b.pz]).not.toEqual([c.px, c.py, c.pz]);
  });
});

// ---------------------------------------------------------------- 3. greybox completable

describe("greybox bot run", () => {
  it("finishes in under 40 s with average speed > 15 m/s", () => {
    expect(gbRun.finished).toBe(true);
    expect(gbRun.seconds).toBeLessThan(40);
    expect(gbRun.avgSpeed).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------- 4. no-fail guarantee

describe("no-fail guarantee", () => {
  it("with no input the runner finishes within 120 s and stays finite and above the street", () => {
    const w = greybox(), T = defaults();
    const s = initState(w);
    const max = Math.round(120 / DT);
    let sawLand = false;
    while (!s.finished && s.tick < max) {
      step(s, FREE, w, T);
      if (s.ev & EV_LAND) sawLand = true;
      for (const k of NUM_FIELDS) {
        const v = s[k];
        if (Number.isNaN(v) || Math.abs(v) > 1e5) throw new Error(`tick ${s.tick}: ${k} = ${v}`);
      }
      if (s.py < -0.01) throw new Error(`tick ${s.tick}: py = ${s.py}`);
    }
    expect(sawLand).toBe(true);
    expect(s.finished).toBe(true);
    expect(s.tick * DT).toBeLessThan(120);
  });
});

// ---------------------------------------------------------------- 5. pendulum constraint

describe("pendulum constraint", () => {
  it("never exceeds the rope length and the rope never grows while attached", () => {
    const w = world({ start: [0, 20, 0], anchors: [point(0, 38, -14)] });
    const T = defaults();
    const s = initState(w);
    let swingTicks = 0, prevRope = Infinity, prevMode = AIR;
    for (let i = 0; i < 6 * 120; i++) {
      step(s, i < 3 * 120 ? HOLD : FREE, w, T);
      if (s.mode === SWING) {
        swingTicks++;
        const d = Math.hypot(s.px - s.ax, s.py - s.ay, s.pz - s.az);
        expect(d).toBeLessThanOrEqual(s.rope + 1e-6);
        if (prevMode === SWING) expect(s.rope).toBeLessThanOrEqual(prevRope);
        prevRope = s.rope;
      }
      prevMode = s.mode;
    }
    expect(swingTicks).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------- 6. release carries momentum

describe("release", () => {
  it("never loses speed (>1%) on the EV_RELEASE tick and switches to AIR", () => {
    const w = greybox(), T = defaults();
    let prev = 0;
    let releases = 0;
    const bad: string[] = [];
    runBot(w, T, {
      onTick: (s) => {
        if (s.ev & EV_RELEASE) {
          releases++;
          const after = speedOf(s);
          if (after < prev * 0.99) bad.push(`tick ${s.tick}: ${prev} -> ${after}`);
          if (s.mode !== AIR) bad.push(`tick ${s.tick}: mode ${s.mode}`);
        }
        prev = speedOf(s);
      },
    });
    // initial `prev` is 0 only for the first tick, which cannot be a release
    expect(releases).toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------- 7. energy

describe("energy", () => {
  it("does not grow by more than 2% over 5 s of ideal pendulum swinging", () => {
    const T = T0({ pump: 0, releaseBoost: 0, releaseLift: 0, drag: 0, leanAccel: 0, assistSteer: 0, reel: 0 });
    const w = world({ start: [0, 22, 0], anchors: [point(0, 42, -10)] });
    const s = initState(w);
    const g = T.gravity * T.swingGravity;
    const E = () => 0.5 * speedOf(s) ** 2 + g * s.py;
    step(s, HOLD, w, T);
    expect(s.mode).toBe(SWING);
    const E0 = E();
    let maxGrowth = -Infinity;
    for (let i = 0; i < 5 * 120; i++) {
      step(s, HOLD, w, T);
      expect(s.mode).toBe(SWING);
      maxGrowth = Math.max(maxGrowth, E() - E0);
    }
    expect(maxGrowth).toBeLessThan(0.02 * Math.abs(E0));
  });
});

// ---------------------------------------------------------------- 8. lean

describe("lean", () => {
  // Convention (sim.ts, world.ts): for horizontal tangent (tx, tz) the right-hand side is
  // (-tz, tx). Travelling toward -z, t = (0, -1) so right = (+1, 0) = +x. projectGuide's
  // `lat` is positive on the right.
  function endState(lean: number): SimState {
    const T = T0({ assistSteer: 0 });
    const w = world({ start: [0, 22, 0], anchors: [point(0, 40, -14)] });
    const s = initState(w);
    for (let i = 0; i < 2 * 120; i++) step(s, { hold: true, lean }, w, T);
    expect(s.mode).toBe(SWING);
    return s;
  }

  it("lean +1 ends to the right of lean 0, lean -1 to the left (right = +x for -z travel)", () => {
    const r = endState(1), c = endState(0), l = endState(-1);
    expect(r.px).toBeGreaterThan(c.px + 0.5);
    expect(l.px).toBeLessThan(c.px - 0.5);
    expect(r.lat).toBeGreaterThan(c.lat);
    expect(l.lat).toBeLessThan(c.lat);
    // sign convention: positive lat is positive x on this guide
    expect(Math.sign(r.lat)).toBe(Math.sign(r.px));
  });
});

// ---------------------------------------------------------------- 9. pickAnchor

describe("pickAnchor", () => {
  const T = defaults();

  it("(a) returns false when nothing is in range", () => {
    expect(pickAnchor(initState(world()), 0, world(), T, newPick())).toBe(false);
    const far = world({ anchors: [point(0, 40, -200)] });
    expect(pickAnchor(initState(far), 0, far, T, newPick())).toBe(false);
  });

  it("(b) lean -1 picks the left anchor and lean +1 the right one", () => {
    const w = world({ anchors: [point(-8, 32, -10), point(8, 32, -10)] });
    const s = initState(w);
    const p = newPick();
    expect(pickAnchor(s, -1, w, T, p)).toBe(true);
    expect(p.anchor).toBe(0);
    expect(p.x).toBeLessThan(0);
    expect(pickAnchor(s, 1, w, T, p)).toBe(true);
    expect(p.anchor).toBe(1);
    expect(p.x).toBeGreaterThan(0);
    // mirrored order of definition gives the mirrored answer
    const w2 = world({ anchors: [point(8, 32, -10), point(-8, 32, -10)] });
    expect(pickAnchor(initState(w2), -1, w2, T, p)).toBe(true);
    expect(p.anchor).toBe(1);
  });

  it("(c) never picks an anchor behind the runner", () => {
    for (const z of [3, 10, 20]) {
      const w = world({ anchors: [point(0, 35, z)] });
      expect(pickAnchor(initState(w), 0, w, T, newPick())).toBe(false);
    }
    // and with only one ahead, the one behind is not chosen
    const w = world({ anchors: [point(0, 35, 12), point(0, 35, -12)] });
    const p = newPick();
    expect(pickAnchor(initState(w), 0, w, T, p)).toBe(true);
    expect(p.anchor).toBe(1);
  });

  it("(d) never picks an anchor below the runner", () => {
    for (const y of [5, 15, 19.5, 20]) {
      const w = world({ anchors: [point(0, y, -10)] });
      expect(pickAnchor(initState(w), 0, w, T, newPick())).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- 10. early-press buffer

describe("early press", () => {
  const T = defaults();
  /** Tick at which an anchor at distance d ahead first becomes pickable on the free-fall path. */
  function firstInRange(d: number): number {
    const w = world({ anchors: [point(0, 32, -d)] });
    const s = initState(w), p = newPick();
    for (let i = 0; i < 240; i++) {
      if (pickAnchor(s, 0, w, T, p)) return i;
      step(s, FREE, w, T);
    }
    return -1;
  }
  function findD(lo: number, hi: number): number {
    for (let d = 20; d < 70; d += 0.25) {
      const k = firstInRange(d);
      if (k >= lo && k <= hi) return d;
    }
    throw new Error("no suitable distance");
  }

  it("attaches without a second press when the anchor comes into range", () => {
    const d = findD(Math.round(0.1 / DT), Math.round(0.25 / DT));
    const w = world({ anchors: [point(0, 32, -d)] });
    const s = initState(w);
    let attachTick = -1;
    for (let i = 0; i < 120; i++) {
      step(s, HOLD, w, T);
      if (s.ev & EV_ATTACH && attachTick < 0) attachTick = i;
    }
    expect(attachTick).toBeGreaterThan(Math.round(0.1 / DT) - 2);
    expect(attachTick * DT).toBeLessThanOrEqual(0.25 + 2 * DT);
    expect(s.mode).toBe(SWING);
    expect(s.anchor).toBe(0);
  });

  it("keeps reaching while held: attaches however long the anchor takes to come into reach", () => {
    const d = findD(Math.round(0.5 / DT), Math.round(1 / DT));
    const w = world({ anchors: [point(0, 32, -d)] });
    const s = initState(w);
    let attached = false;
    for (let i = 0; i < 150; i++) { step(s, HOLD, w, T); if (s.ev & EV_ATTACH) attached = true; }
    expect(attached).toBe(true);
  });
});

// ---------------------------------------------------------------- 11. landing

describe("landing", () => {
  it("lands on a roof with no input, loses horizontal speed, then jogs along the guide", () => {
    const roof: Box = { x0: -10, x1: 10, z0: -400, z1: 20, h: 10 };
    const w = world({ boxes: [roof], start: [0, 14, 0] });
    const T = defaults();
    const s = initState(w);
    let before = 0, landed = false, after = 0;
    for (let i = 0; i < 600 && !landed; i++) {
      before = Math.hypot(s.vx, s.vz);
      step(s, FREE, w, T);
      if (s.ev & EV_LAND) { landed = true; after = Math.hypot(s.vx, s.vz); }
    }
    expect(landed).toBe(true);
    expect(s.mode).toBe(GROUND);
    expect(s.py).toBe(10);
    expect(after).toBeLessThan(before);
    const z0 = s.pz;
    for (let i = 0; i < 4 * 120; i++) step(s, FREE, w, T);
    expect(s.mode).toBe(GROUND);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(T.jog, 1);
    expect(z0 - s.pz).toBeGreaterThan(T.jog * 4 * 0.9);
    expect(s.progress).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- 12. walls

describe("walls", () => {
  it("flying into the side of a tall box never puts the runner inside it; EV_BUMP fires", () => {
    const box: Box = { x0: -10, x1: 10, z0: -30, z1: -20, h: 60 };
    const w = world({ boxes: [box], start: [0, 15, 0] });
    const T = T0({ gravity: 0 }); // stay at constant height so we hit the side, not the roof
    const s = initState(w);
    let bumped = false;
    for (let i = 0; i < 600; i++) {
      step(s, FREE, w, T);
      if (s.ev & EV_BUMP) bumped = true;
      const inside = s.px > box.x0 && s.px < box.x1 && s.pz > box.z0 && s.pz < box.z1 && s.py < box.h;
      if (inside) throw new Error(`tick ${s.tick}: inside box at ${s.px},${s.py},${s.pz}`);
    }
    expect(bumped).toBe(true);
    expect(s.pz).toBeGreaterThanOrEqual(box.z1);
  });
});

// ---------------------------------------------------------------- 13. anchorPos

describe("anchorPos", () => {
  it("moving anchors are periodic in t", () => {
    const a: Anchor = { kind: "point", a: [1, 30, -5], move: { axis: [4, 2, 0], period: 3.7, phase: 0.2 } };
    const p = anchorPos(a, 1.3, 0, 0, [0, 0, 0]);
    const q = anchorPos(a, 1.3 + 3.7, 0, 0, [0, 0, 0]);
    const q2 = anchorPos(a, 1.3 + 2 * 3.7, 0, 0, [0, 0, 0]);
    for (let i = 0; i < 3; i++) { expect(q[i]).toBeCloseTo(p[i], 9); expect(q2[i]).toBeCloseTo(p[i], 9); }
    const mid = anchorPos(a, 1.3 + 3.7 / 4, 0, 0, [0, 0, 0]);
    expect(Math.abs(mid[0] - p[0]) + Math.abs(mid[1] - p[1])).toBeGreaterThan(0.1);
  });

  it("line sag is larger mid-span than near the end and grows with the sag argument", () => {
    const a: Anchor = { kind: "line", a: [-7, 25, 0], b: [7, 25, 0], sag: 1.5 };
    const drop = (u: number, sag: number) => 25 - anchorPos(a, 0, u, sag, [0, 0, 0])[1];
    expect(drop(0.5, 1)).toBeGreaterThan(drop(0.1, 1));
    expect(drop(0.5, 0.5)).toBeGreaterThan(drop(0.1, 0.5));
    expect(drop(0.5, 0)).toBeGreaterThan(drop(0.1, 0));
    expect(drop(0.5, 0.5)).toBeGreaterThan(drop(0.5, 0));
    expect(drop(0.5, 1)).toBeGreaterThan(drop(0.5, 0.5));
    expect(drop(0.1, 1)).toBeGreaterThan(drop(0.1, 0));
    // fully loaded mid-span drop equals the declared sag
    expect(drop(0.5, 1)).toBeCloseTo(1.5, 12);
    // ends do not sag
    expect(drop(0, 1)).toBe(0);
    expect(drop(1, 1)).toBeCloseTo(0, 12);
  });
});

// ---------------------------------------------------------------- 14. projectGuide

describe("projectGuide", () => {
  // L shape: 20 m toward -z, then 20 m toward +x.
  const guide: V3[] = [[0, 0, 0], [0, 0, -20], [20, 0, -20]];
  const w = world({ guide });

  it("progress increases monotonically along both legs", () => {
    const hit: GuideHit = { s: 0, seg: 0, tx: 1, tz: 0, lat: 0 };
    let seg = 0, prev = -Infinity;
    const pts: [number, number][] = [];
    for (let z = 0; z >= -20; z -= 0.25) pts.push([0, z]);
    for (let x = 0.25; x <= 20; x += 0.25) pts.push([x, -20]);
    for (const [x, z] of pts) {
      projectGuide(w, x, z, seg, hit);
      seg = hit.seg;
      expect(hit.s).toBeGreaterThanOrEqual(prev);
      prev = hit.s;
    }
    expect(prev).toBeCloseTo(40, 9);
    expect(seg).toBe(1);
  });

  it("lat is positive to the right of the direction of travel on both legs", () => {
    const hit: GuideHit = { s: 0, seg: 0, tx: 1, tz: 0, lat: 0 };
    // leg 1 heads -z: right = +x
    projectGuide(w, 2, -10, 0, hit);
    expect(hit.lat).toBeCloseTo(2, 12);
    expect(hit.s).toBeCloseTo(10, 12);
    projectGuide(w, -3, -10, 0, hit);
    expect(hit.lat).toBeCloseTo(-3, 12);
    // leg 2 heads +x: right = +z
    projectGuide(w, 10, -18, 1, hit);
    expect(hit.lat).toBeCloseTo(2, 12);
    expect(hit.s).toBeCloseTo(30, 12);
    projectGuide(w, 10, -23, 1, hit);
    expect(hit.lat).toBeCloseTo(-3, 12);
  });
});

// ---------------------------------------------------------------- 15. finish

describe("finish", () => {
  it("finished flips exactly once, EV_FINISH fires on exactly one tick, finishTick is set", () => {
    const w = greybox(), T = defaults();
    const s = initState(w);
    let flips = 0, finishEvents = 0, prev = false, finishEventTick = -1;
    expect(s.finishTick).toBe(-1);
    for (let i = 0; i < 80 * 120 && flips === 0; i++) {
      step(s, FREE, w, T);
      if (s.finished && !prev) flips++;
      if (s.ev & EV_FINISH) { finishEvents++; finishEventTick = s.tick; }
      prev = s.finished;
    }
    expect(flips).toBe(1);
    // keep stepping afterwards: no further flips or events
    const ft = s.finishTick;
    for (let i = 0; i < 300; i++) {
      step(s, FREE, w, T);
      if (s.ev & EV_FINISH) finishEvents++;
      expect(s.finished).toBe(true);
    }
    expect(finishEvents).toBe(1);
    expect(ft).toBeGreaterThanOrEqual(0);
    expect(s.finishTick).toBe(ft);
    // finishTick is the tick index of the stepping call that finished (tick before increment)
    expect(finishEventTick).toBe(ft + 1);
    expect(heightAt(w, 0, 0)).toBe(0);
  });
});
