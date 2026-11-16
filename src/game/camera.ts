// The follow camera. There is no camera control: it trails the runner's velocity and looks
// where they are going. Runs at display rate; purely cosmetic (never feeds the sim).
import { T } from "../tuning";
import { GROUND, type SimState } from "../sim/sim";
import { heightAt, type SimWorld } from "../sim/world";

export interface CamPose { px: number; py: number; pz: number; lx: number; ly: number; lz: number; roll: number; fov: number }

export class FollowCam {
  // smoothed heading (unit-ish, 3D)
  private dx = 0; private dy = 0; private dz = -1;
  private ox = 0; private oy = 0; private oz = 0; // smoothed runner position
  private roll = 0;
  private fov = 68;
  private dist = 7;
  pose: CamPose = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: -1, roll: 0, fov: 68 };

  reset(s: SimState): void {
    const sp = Math.hypot(s.vx, s.vz) || 1;
    this.dx = s.vx / sp; this.dz = s.vz / sp; this.dy = 0;
    if (sp < 0.5) { this.dx = s.hx; this.dz = s.hz; }
    this.ox = s.px; this.oy = s.py; this.oz = s.pz;
    this.roll = 0; this.fov = T.camFov; this.dist = T.camDist;
  }

  update(s: SimState, w: SimWorld, x: number, y: number, z: number, dt: number): CamPose {
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    // Target heading: velocity direction, vertical part damped. On the ground use the jog heading.
    let tx: number, ty: number, tz: number;
    if (s.mode === GROUND || sp < 1.5) { tx = s.hx; ty = 0; tz = s.hz; }
    else { tx = s.vx / sp; ty = (s.vy / sp) * T.camPitch; tz = s.vz / sp; }
    const k = 1 - Math.exp(-dt / T.camDirLag);
    this.dx += (tx - this.dx) * k; this.dy += (ty - this.dy) * k; this.dz += (tz - this.dz) * k;
    const hl = Math.hypot(this.dx, this.dz) || 1;
    const hx = this.dx / hl, hz = this.dz / hl;

    const kp = 1 - Math.exp(-dt / T.camPosLag);
    this.ox += (x - this.ox) * kp; this.oy += (y - this.oy) * kp; this.oz += (z - this.oz) * kp;

    const f = Math.min(1, sp / T.speedCap);
    const kd = 1 - Math.exp(-dt / 0.5);
    this.dist += (T.camDist + f * T.camDistSpeed - this.dist) * kd;
    this.fov += (T.camFov + f * T.camFovSpeed - this.fov) * kd;
    this.roll += (-s.lean * T.camRoll - this.roll) * (1 - Math.exp(-dt / 0.25));

    // Behind and above; pull in if that would put the camera inside a building.
    let d = this.dist;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 6; i++) {
      cx = this.ox - hx * d; cz = this.oz - hz * d;
      cy = this.oy + T.camHeight - this.dy * d * 0.6;
      const h = heightAt(w, cx, cz);
      if (cy > h + 0.8) break;
      if (h - this.oy < 3) { cy = h + 0.8; break; } // low roof: rise over it instead
      d *= 0.7;
    }
    const p = this.pose;
    p.px = cx; p.py = cy; p.pz = cz;
    p.lx = this.ox + hx * T.camLook; p.ly = this.oy + T.camLookUp + this.dy * T.camLook; p.lz = this.oz + hz * T.camLook;
    p.roll = this.roll; p.fov = this.fov;
    return p;
  }
}
