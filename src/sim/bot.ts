// A simple policy that plays a course. Used to prove a run can be finished, to produce input
// scripts, to drive the benchmark and the menu's attract mode. Deterministic.
import type { Tuning } from "../tuning";
import { DT, GROUND, SWING, initState, pickAnchor, steerWant, step, type Input, type Pick, type SimState } from "./sim";
import type { SimWorld } from "./world";

export interface BotOpts {
  /** Release when climbing at least this steeply (vy / speed). */
  releaseAt?: number;
  /** Seconds to wait in the air before grabbing again. */
  airWait?: number;
  maxSeconds?: number;
  /** false = never lean (tests the assist alone). */
  lean?: boolean;
  onTick?: (s: SimState, i: Input) => void;
}

export interface BotResult {
  finished: boolean;
  seconds: number;
  /** Run-length script: [ticks, hold(0/1), lean*100] triples. */
  script: number[];
  avgSpeed: number;
  topSpeed: number;
  landings: number;
  attaches: number;
  final: SimState;
}

/** A stateful policy: call once per tick BEFORE step(); it fills `input`. */
export function makeBot(o: BotOpts = {}): (s: SimState, w: SimWorld, T: Tuning, input: Input) => void {
  const pick: Pick = { anchor: -1, u: 0, score: 0, x: 0, y: 0, z: 0 };
  const releaseAt = o.releaseAt ?? 0.45, airWait = o.airWait ?? 0.12;
  let hold = false, sinceRelease = 1e9, heldTicks = 0, wasSwing = false;
  return (s, w, T, input) => {
    if (s.tick === 0) { hold = false; sinceRelease = 1e9; heldTicks = 0; wasSwing = false; }
    if (wasSwing && s.mode !== SWING) sinceRelease = 0;
    wasSwing = s.mode === SWING;
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    if (s.mode === SWING) {
      heldTicks++;
      const climbing = sp > 1 && s.vy / sp > releaseAt;
      // Past the anchor, rising steeply enough and pointing down the course; or held too long.
      const fwd = s.vx * (s.ax - s.px) + s.vz * (s.az - s.pz);
      const onLine = Math.abs(steerWant(s, w, T)) < 0.6;
      if ((climbing && fwd < 0 && onLine) || heldTicks > 4 / DT) hold = false;
    } else {
      sinceRelease += DT;
      heldTicks = 0;
      if (!hold && sinceRelease > airWait && (s.mode === GROUND || s.vy < 2) && pickAnchor(s, 0, w, T, pick)) hold = true;
      else if (hold) hold = false; // buffered press found nothing; let go and try again
    }
    input.hold = hold;
    input.lean = hold && o.lean !== false ? Math.round(steerWant(s, w, T) * 10) / 10 : 0;
  };
}

export function runBot(w: SimWorld, T: Tuning, o: BotOpts = {}): BotResult {
  const s = initState(w);
  const bot = makeBot(o);
  const max = Math.round((o.maxSeconds ?? 240) / DT);
  const script: number[] = [];
  let sum = 0, top = 0, landings = 0, attaches = 0;
  const input: Input = { hold: false, lean: 0 };
  while (!s.finished && s.tick < max) {
    bot(s, w, T, input);
    pushScript(script, input);
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    step(s, input, w, T);
    if (s.ev & 4) landings++;
    if (s.ev & 1) attaches++;
    sum += sp; if (sp > top) top = sp;
    o.onTick?.(s, input);
  }
  return { finished: s.finished, seconds: s.tick * DT, script, avgSpeed: sum / Math.max(1, s.tick), topSpeed: top, landings, attaches, final: s };
}

/** Append one tick of input to a run-length script. Lean is stored in hundredths. */
export function pushScript(script: number[], input: Input): void {
  const h = input.hold ? 1 : 0, l = Math.round(input.lean * 100) + 0; // + 0: never store -0
  const n = script.length;
  if (n && script[n - 2] === h && script[n - 1] === l) script[n - 3]++;
  else script.push(1, h, l);
}

/** Replay a run-length script. After the script ends the runner idles (the jog always arrives). */
export function runScript(w: SimWorld, T: Tuning, script: number[], maxSeconds = 300, onTick?: (s: SimState, i: Input) => void): SimState {
  const s = initState(w);
  const input: Input = { hold: false, lean: 0 };
  const max = Math.round(maxSeconds / DT);
  for (let i = 0; i < script.length && !s.finished; i += 3) {
    input.hold = script[i + 1] === 1; input.lean = script[i + 2] / 100;
    for (let k = 0; k < script[i] && !s.finished && s.tick < max; k++) { step(s, input, w, T); onTick?.(s, input); }
  }
  input.hold = false; input.lean = 0;
  while (!s.finished && s.tick < max) { step(s, input, w, T); onTick?.(s, input); }
  return s;
}
