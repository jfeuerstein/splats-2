// The swing simulation. Deterministic: the next state depends only on (state, input, world, tuning).
// No Math.random, no clocks, no frame dt. Fixed timestep DT. Mutates the state it is given;
// use cloneState() to branch. Ghosts, the bot and the unit tests all rely on this.

import type { Tuning } from "../tuning";
import { anchorPos, guidePoint, heightAt, projectGuide, type GuideHit, type SimWorld, type V3 } from "./world";

export const HZ = 120;
export const DT = 1 / HZ;
export const RADIUS = 0.45;

export const AIR = 0, SWING = 1, GROUND = 2;

export const EV_ATTACH = 1, EV_RELEASE = 2, EV_LAND = 4, EV_BUMP = 8, EV_FINISH = 16, EV_SKIM = 32;

export interface Input {
  hold: boolean;
  /** -1 (left) .. 1 (right). Only meaningful while holding. */
  lean: number;
}

export interface SimState {
  tick: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  mode: number;
  /** Tethered anchor index, or -1. */
  anchor: number;
  /** Where on a line anchor the tether sits. */
  u: number;
  rope: number;
  /** 0..1 how far the held line has sagged. */
  sag: number;
  holdPrev: boolean;
  /** Ticks left in which an early press may still attach. -1 = press consumed. */
  buffer: number;
  /** Remembered lean, biases the next anchor choice. */
  bias: number;
  lean: number;
  lastAnchor: number;
  seg: number;
  progress: number;
  lat: number;
  /** Ground heading. */
  hx: number; hz: number;
  finished: boolean;
  finishTick: number;
  /** Events raised by the last step (EV_* bits). */
  ev: number;
  /** Anchor attach point last tick (for rendering the rope). */
  ax: number; ay: number; az: number;
}

export function initState(w: SimWorld): SimState {
  const c = w.course;
  const g0 = c.guide[0], g1 = c.guide[1];
  const len = Math.hypot(g1[0] - g0[0], g1[2] - g0[2]) || 1;
  const hx = (g1[0] - g0[0]) / len, hz = (g1[2] - g0[2]) / len;
  return {
    tick: 0,
    px: c.start[0], py: c.start[1], pz: c.start[2],
    vx: hx * c.startSpeed, vy: 0, vz: hz * c.startSpeed,
    mode: AIR, anchor: -1, u: 0, rope: 0, sag: 0,
    holdPrev: false, buffer: -1, bias: 0, lean: 0, lastAnchor: -1,
    seg: 0, progress: 0, lat: 0, hx, hz,
    finished: false, finishTick: -1, ev: 0, ax: 0, ay: 0, az: 0,
  };
}

export function cloneState(s: SimState): SimState {
  return { ...s };
}

const _hit: GuideHit = { s: 0, seg: 0, tx: 1, tz: 0, lat: 0 };
const _a: V3 = [0, 0, 0];

const _c: V3 = [0, 0, 0];
const _dir = { x: 1, z: 0 };

/**
 * Direction (unit, horizontal) from the runner to a point further along the guide.
 * Everything that "follows the course" (aim, quiet steering, the jog) uses this, so corners
 * are anticipated rather than reacted to.
 */
function carrot(s: SimState, w: SimWorld, T: Tuning, ahead: number): { x: number; z: number } {
  guidePoint(w, s.progress + ahead, _c);
  const dx = _c[0] - s.px, dz = _c[2] - s.pz;
  const l = Math.hypot(dx, dz) || 1;
  _dir.x = dx / l; _dir.z = dz / l;
  return _dir;
}

/** -1..1: how hard to lean (positive = right) to head for the course line ahead. */
export function steerWant(s: SimState, w: SimWorld, T: Tuning): number {
  const sph = Math.hypot(s.vx, s.vz);
  if (sph < 1) return 0;
  const c = carrot(s, w, T, T.lookBase + sph * T.lookTime);
  // sin of the angle from velocity to carrot, positive when the carrot is to the right
  const cross = (s.vx * c.z - s.vz * c.x) / sph;
  const k = cross * T.steerGain;
  return k < -1 ? -1 : k > 1 ? 1 : k;
}

export interface Pick { anchor: number; u: number; score: number; x: number; y: number; z: number }

/**
 * Which anchor a press would grab right now. The same function drives the on-screen reticle,
 * so what is shown is what is grabbed. Returns false if nothing is in reach.
 */
export function pickAnchor(s: SimState, lean: number, w: SimWorld, T: Tuning, out: Pick): boolean {
  const t = s.tick * DT;
  // Aim: velocity heading, pulled toward the course ahead, turned by lean.
  const sp = Math.hypot(s.vx, s.vz);
  const cr = carrot(s, w, T, T.lookBase + sp * T.lookTime);
  let hx: number, hz: number;
  if (s.mode === GROUND || sp < 2) {
    hx = cr.x; hz = cr.z;
  } else {
    const k = T.aimCourse;
    hx = (s.vx / sp) * (1 - k) + cr.x * k;
    hz = (s.vz / sp) * (1 - k) + cr.z * k;
    const l = Math.hypot(hx, hz) || 1;
    hx /= l; hz /= l;
  }
  const ang = (lean * T.aimLean * Math.PI) / 180;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // rotate toward the right (right = (-hz, hx))
  const ax = hx * ca - hz * sa, az = hz * ca + hx * sa;
  const rx = -az, rz = ax;

  const ground = s.mode === GROUND;
  const idealF = T.aheadBase + sp * T.aheadTime;
  const idealUp = T.idealUp;
  const cone = (T.cone * Math.PI) / 180;
  const qx = s.px + ax * idealF, qz = s.pz + az * idealF;

  let best = -Infinity;
  const as = w.course.anchors;
  for (let i = 0; i < as.length; i++) {
    const a = as[i];
    let u = 0;
    if (a.kind === "line" && a.b) {
      // Point of the line nearest (in plan) to where we would like to hang from.
      const dx = a.b[0] - a.a[0], dz = a.b[2] - a.a[2];
      const l2 = dx * dx + dz * dz || 1;
      u = ((qx - a.a[0]) * dx + (qz - a.a[2]) * dz) / l2;
      u = u < 0.06 ? 0.06 : u > 0.94 ? 0.94 : u;
    }
    anchorPos(a, t, u, 0, _a);
    const dx = _a[0] - s.px, dy = _a[1] - s.py, dz = _a[2] - s.pz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > T.rangeMax || dist < T.rangeMin) continue;
    if (dy < (ground ? 2.5 : 1.0)) continue;
    const f = dx * ax + dz * az;
    const side = dx * rx + dz * rz;
    if (f < (ground ? -1 : 0.5)) continue;
    const angle = Math.atan2(Math.abs(side), f);
    if (angle > cone) continue;
    // The arc has to clear what is below it.
    const floor = Math.max(heightAt(w, _a[0], _a[2]), heightAt(w, s.px, s.pz));
    if (_a[1] - floor - T.clearance < T.ropeMin * 0.6) continue;
    const an = angle / cone, dn = (f - idealF) / idealF, un = (dy - idealUp) / idealUp;
    let score = -T.wAngle * an * an - T.wDist * dn * dn - T.wUp * un * un;
    if (i === s.lastAnchor) score -= T.wRepeat;
    if (score > best) {
      best = score;
      out.anchor = i; out.u = u; out.score = score;
      out.x = _a[0]; out.y = _a[1]; out.z = _a[2];
    }
  }
  return best > -Infinity;
}

const _pick: Pick = { anchor: -1, u: 0, score: 0, x: 0, y: 0, z: 0 };

function attach(s: SimState, p: Pick, T: Tuning): void {
  if (s.mode === GROUND) {
    const sp = Math.hypot(s.vx, s.vz);
    s.vx = s.hx * sp; s.vz = s.hz * sp; s.vy = T.hop;
    s.py += 0.05;
  }
  s.mode = SWING;
  s.anchor = p.anchor;
  s.u = p.u;
  s.sag = 0;
  s.rope = Math.hypot(p.x - s.px, p.y - s.py, p.z - s.pz);
  s.buffer = -1;
  s.ev |= EV_ATTACH;
}

/** Advance one fixed tick. */
/**
 * The lean used to choose an anchor: the stronger of the thumb's lean now and the lean
 * remembered from the last release. `step` and the reticle both use this, so the reticle
 * always marks the anchor a press would take.
 */
export function aimFor(s: SimState, leanIn: number): number {
  return Math.abs(leanIn) > Math.abs(s.bias) ? leanIn : s.bias;
}

export function step(s: SimState, input: Input, w: SimWorld, T: Tuning): void {
  s.ev = 0;
  const t = s.tick * DT;
  const hold = input.hold;
  const leanIn = hold ? (input.lean < -1 ? -1 : input.lean > 1 ? 1 : input.lean) : 0;
  const pressed = hold && !s.holdPrev;
  const released = !hold && s.holdPrev;
  s.holdPrev = hold;

  // --- press / release
  if (pressed) s.buffer = 1;
  if (released) {
    if (s.mode === SWING) {
      s.mode = AIR;
      s.lastAnchor = s.anchor;
      s.anchor = -1;
      const sp = Math.hypot(s.vx, s.vy, s.vz) || 1;
      s.vx += (s.vx / sp) * T.releaseBoost;
      s.vy += (s.vy / sp) * T.releaseBoost + T.releaseLift;
      s.vz += (s.vz / sp) * T.releaseBoost;
      s.bias = s.lean;
      s.ev |= EV_RELEASE;
    }
    s.buffer = -1;
  }
  // A held thumb keeps reaching: the first anchor to come into reach takes it.
  if (hold && s.mode !== SWING && s.buffer >= 0) {
    if (pickAnchor(s, aimFor(s, leanIn), w, T, _pick)) attach(s, _pick, T);
  }
  if (hold) s.lean = leanIn;
  else {
    s.lean = 0;
    s.bias *= Math.exp(-DT / T.biasDecay);
  }

  projectGuide(w, s.px, s.pz, s.seg, _hit);
  const opx = s.px, opy = s.py, opz = s.pz;

  if (s.mode === GROUND) {
    // --- jog along the course, steering back to the line
    let sp = Math.hypot(s.vx, s.vz);
    sp = T.jog + (sp - T.jog) * Math.exp(-T.groundDecel * DT);
    const cg = carrot(s, w, T, T.jogLook);
    // Turn the heading toward the course at a limited rate so the jog rounds corners.
    let dx = s.hx + (cg.x - s.hx) * T.jogTurn, dz = s.hz + (cg.z - s.hz) * T.jogTurn;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    s.hx = dx; s.hz = dz;
    s.vx = dx * sp; s.vz = dz * sp; s.vy = 0;
    const nx = s.px + s.vx * DT, nz = s.pz + s.vz * DT;
    const hAhead = Math.max(heightAt(w, nx, nz), heightAt(w, nx + dx * RADIUS, nz + dz * RADIUS));
    if (hAhead > s.py + 0.5) {
      // A wall: scramble up it.
      s.py = Math.min(hAhead, s.py + T.climb * DT);
      if (s.py >= hAhead) { s.px = nx; s.pz = nz; }
    } else {
      s.px = nx; s.pz = nz;
      if (hAhead < s.py - 0.5) s.mode = AIR; // ran off an edge
      else s.py = hAhead;
    }
  } else {
    // --- air and swing share integration
    const swing = s.mode === SWING;
    let ax = 0, ay = -T.gravity * (swing ? T.swingGravity : 1), az = 0;
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    const sph = Math.hypot(s.vx, s.vz);
    // Sideways basis from horizontal velocity (or the course when nearly vertical).
    let fx = _hit.tx, fz = _hit.tz;
    if (sph > 1.5) { fx = s.vx / sph; fz = s.vz / sph; }
    const rx = -fz, rz = fx;
    // Quiet steering toward the course line ahead.
    const want = steerWant(s, w, T);
    if (swing) {
      let lean = leanIn + want * T.assistSteer * (1 - Math.abs(leanIn));
      lean = lean < -1 ? -1 : lean > 1 ? 1 : lean;
      ax += rx * lean * T.leanAccel; az += rz * lean * T.leanAccel;
      if (sp > 0.5) {
        const fade = Math.max(0, 1 - sp / T.pumpSpeed);
        const k = T.pump * fade * (s.vy < 0 ? 1 : T.pumpUp) / sp;
        ax += s.vx * k; ay += s.vy * k; az += s.vz * k;
      }
    } else {
      const k = want * T.assistAir;
      ax += rx * k; az += rz * k;
    }
    // Wind
    const ws = w.course.wind;
    for (let i = 0; i < ws.length; i++) {
      const z = ws[i];
      if (s.px >= z.x0 && s.px <= z.x1 && s.pz >= z.z0 && s.pz <= z.z1 && s.py >= z.y0 && s.py <= z.y1) {
        ax += z.accel[0]; ay += z.accel[1]; az += z.accel[2];
      }
    }
    s.vx += ax * DT; s.vy += ay * DT; s.vz += az * DT;
    let drag = T.drag;
    const sp2 = Math.hypot(s.vx, s.vy, s.vz);
    if (sp2 > T.speedCap) drag += (sp2 - T.speedCap) * T.capDrag;
    const dk = Math.exp(-drag * DT);
    s.vx *= dk; s.vy *= dk; s.vz *= dk;
    s.px += s.vx * DT; s.py += s.vy * DT; s.pz += s.vz * DT;

    if (swing) {
      const a = w.course.anchors[s.anchor];
      s.sag += (1 - s.sag) * (1 - Math.exp(-DT / T.sagTime));
      anchorPos(a, t + DT, s.u, s.sag, _a);
      s.ax = _a[0]; s.ay = _a[1]; s.az = _a[2];
      // Reel in so the bottom of the arc clears the roofs.
      const floor = Math.max(heightAt(w, _a[0], _a[2]), heightAt(w, s.px, s.pz));
      let target = Math.min(T.ropeMax, _a[1] - floor - T.clearance);
      if (target < T.ropeMin) target = T.ropeMin;
      if (s.rope > target) s.rope = Math.max(target, s.rope - T.reel * DT);
      let rx2 = s.px - _a[0], ry2 = s.py - _a[1], rz2 = s.pz - _a[2];
      const d = Math.hypot(rx2, ry2, rz2);
      if (d > s.rope && d > 1e-6) {
        rx2 /= d; ry2 /= d; rz2 /= d;
        s.px = _a[0] + rx2 * s.rope; s.py = _a[1] + ry2 * s.rope; s.pz = _a[2] + rz2 * s.rope;
        const vr = s.vx * rx2 + s.vy * ry2 + s.vz * rz2;
        if (vr > 0) { s.vx -= rx2 * vr; s.vy -= ry2 * vr; s.vz -= rz2 * vr; }
      }
    }

    // --- collide with buildings and the street
    const bs = w.boxes;
    let top = 0; // highest surface we are standing in/on
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (s.py >= b.h) continue;
      if (s.px < b.x0 - RADIUS || s.px > b.x1 + RADIUS || s.pz < b.z0 - RADIUS || s.pz > b.z1 + RADIUS) continue;
      const wasOver = opx >= b.x0 - RADIUS && opx <= b.x1 + RADIUS && opz >= b.z0 - RADIUS && opz <= b.z1 + RADIUS;
      if ((wasOver && opy >= b.h - 0.6) || s.py > b.h - 0.6) {
        if (b.h > top) top = b.h;
        continue;
      }
      // Side hit: push out along the shallowest axis and lose speed.
      const dx0 = s.px - (b.x0 - RADIUS), dx1 = b.x1 + RADIUS - s.px;
      const dz0 = s.pz - (b.z0 - RADIUS), dz1 = b.z1 + RADIUS - s.pz;
      const m = Math.min(dx0, dx1, dz0, dz1);
      let into = 0;
      if (m === dx0) { s.px = b.x0 - RADIUS; if (s.vx > 0) { into = s.vx; s.vx = 0; } }
      else if (m === dx1) { s.px = b.x1 + RADIUS; if (s.vx < 0) { into = -s.vx; s.vx = 0; } }
      else if (m === dz0) { s.pz = b.z0 - RADIUS; if (s.vz > 0) { into = s.vz; s.vz = 0; } }
      else { s.pz = b.z1 + RADIUS; if (s.vz < 0) { into = -s.vz; s.vz = 0; } }
      if (into > 1) {
        s.vx *= T.wallKeep; s.vz *= T.wallKeep;
        if (s.vy < 0) s.vy *= T.wallKeep;
        s.ev |= EV_BUMP;
      }
    }
    if (s.py <= top) {
      s.py = top;
      if (s.mode === SWING) {
        if (s.vy < 0) s.vy = 0;
        const k = Math.exp(-T.skim * DT);
        s.vx *= k; s.vz *= k;
        s.ev |= EV_SKIM;
      } else if (s.vy <= 0) {
        s.mode = GROUND;
        s.vx *= T.landKeep; s.vz *= T.landKeep; s.vy = 0;
        const sl = Math.hypot(s.vx, s.vz);
        if (sl > 0.5) { s.hx = s.vx / sl; s.hz = s.vz / sl; } else { s.hx = _hit.tx; s.hz = _hit.tz; }
        s.ev |= EV_LAND;
      }
    }
  }

  projectGuide(w, s.px, s.pz, s.seg, _hit);
  s.seg = _hit.seg;
  s.progress = _hit.s;
  s.lat = _hit.lat;
  if (!s.finished && s.progress >= w.length) {
    s.finished = true;
    s.finishTick = s.tick;
    s.ev |= EV_FINISH;
  }
  s.tick++;
}

export function speedOf(s: SimState): number {
  return Math.hypot(s.vx, s.vy, s.vz);
}
