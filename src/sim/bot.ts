// A simple policy that plays a course, used to (a) prove a run can be finished and
// (b) produce input scripts. Deterministic. Not used by the game itself.
import type { Tuning } from "../tuning";
import { DT, GROUND, SWING, initState, pickAnchor, step, type Input, type Pick, type SimState } from "./sim";
import type { SimWorld } from "./world";

export interface BotOpts {
  /** Release when climbing at least this steeply (vy / speed). */
  releaseAt?: number;
  /** Seconds to wait in the air before grabbing again. */
  airWait?: number;
  maxSeconds?: number;
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

export function runBot(w: SimWorld, T: Tuning, o: BotOpts = {}): BotResult {
  const s = initState(w);
  const pick: Pick = { anchor: -1, u: 0, score: 0, x: 0, y: 0, z: 0 };
  const releaseAt = o.releaseAt ?? 0.45, airWait = o.airWait ?? 0.12;
  const max = Math.round((o.maxSeconds ?? 240) / DT);
  const script: number[] = [];
  let hold = false, sinceRelease = 1e9, heldTicks = 0;
  let sum = 0, top = 0, landings = 0, attaches = 0;
  const input: Input = { hold: false, lean: 0 };
  while (!s.finished && s.tick < max) {
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    if (s.mode === SWING) {
      heldTicks++;
      const climbing = sp > 1 && s.vy / sp > releaseAt;
      // Past the anchor and rising steeply enough, or swinging back.
      const fwd = s.vx * (s.ax - s.px) + s.vz * (s.az - s.pz);
      if ((climbing && fwd < 0) || heldTicks > 4 / DT) hold = false;
    } else {
      sinceRelease += DT;
      heldTicks = 0;
      if (!hold && sinceRelease > airWait && (s.mode === GROUND || s.vy < 2) && pickAnchor(s, 0, w, T, pick)) hold = true;
      else if (hold) hold = false; // buffered press found nothing; let go and try again
    }
    input.hold = hold; input.lean = 0;
    const n = script.length;
    if (n && script[n - 2] === (hold ? 1 : 0) && script[n - 1] === 0) script[n - 3]++;
    else script.push(1, hold ? 1 : 0, 0);
    const wasSwing = s.mode === SWING;
    step(s, input, w, T);
    if (wasSwing && s.mode !== SWING) sinceRelease = 0;
    if (s.ev & 4) landings++;
    if (s.ev & 1) attaches++;
    sum += sp; if (sp > top) top = sp;
    o.onTick?.(s, input);
  }
  return { finished: s.finished, seconds: s.tick * DT, script, avgSpeed: sum / Math.max(1, s.tick), topSpeed: top, landings, attaches, final: s };
}

/** Replay a run-length script. */
export function runScript(w: SimWorld, T: Tuning, script: number[], maxSeconds = 300, onTick?: (s: SimState, i: Input) => void): SimState {
  const s = initState(w);
  const input: Input = { hold: false, lean: 0 };
  const max = Math.round(maxSeconds / DT);
  for (let i = 0; i < script.length && !s.finished; i += 3) {
    input.hold = script[i + 1] === 1; input.lean = script[i + 2] / 100;
    for (let k = 0; k < script[i] && !s.finished && s.tick < max; k++) { step(s, input, w, T); onTick?.(s, input); }
  }
  // After the script ends, idle (the jog always gets there in the end).
  input.hold = false; input.lean = 0;
  while (!s.finished && s.tick < max) { step(s, input, w, T); onTick?.(s, input); }
  return s;
}
