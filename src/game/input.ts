// Touch → { hold, lean }. Three schemes, switchable live from the tuning sheet (T.scheme):
//  A  Drag lean: lean is how far the thumb has slid from where it went down.
//  B  Thumb position: lean is where the thumb is across the screen; pressing off-centre
//     already aims the grab that way.
//  C  Timing only: no lean from the thumb at all; the game steers (the app supplies lean).
import { T } from "../tuning";

export interface RawInput { hold: boolean; lean: number }

function shape(v: number): number {
  const a = Math.abs(v);
  if (a <= T.leanDead) return 0;
  const n = Math.min(1, (a - T.leanDead) / (1 - T.leanDead));
  return Math.sign(v) * Math.pow(n, T.leanCurve);
}

/** Size (CSS px) of the top-left corner reserved for the tuning-sheet triple tap. */
const CORNER = 72;

export class TouchInput {
  hold = false;
  lean = 0;
  /** For drawing the thumb hint. */
  downX = 0; downY = 0; curX = 0; curY = 0;
  private id = -1;
  private keys = new Set<string>();
  /** Counts presses; the app uses it to start a run / dismiss cards. */
  presses = 0;
  private latch = false;

  constructor(private el: HTMLElement) {
    const o = { passive: false } as const;
    el.addEventListener("pointerdown", this.down, o);
    el.addEventListener("pointermove", this.move, o);
    el.addEventListener("pointerup", this.up, o);
    el.addEventListener("pointercancel", this.up, o);
    // iOS: stop scroll / zoom / callout gestures at the source.
    for (const t of ["touchstart", "touchmove", "touchend", "gesturestart", "contextmenu", "dblclick"]) el.addEventListener(t, (e) => e.preventDefault(), o);
    window.addEventListener("keydown", (e) => { if (!e.repeat && e.code === "Space") this.presses++; this.keys.add(e.code); });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    // iOS can suspend a Home Screen app mid-hold without pointerup or blur.
    const drop = () => { this.keys.clear(); this.id = -1; this.hold = false; this.lean = 0; };
    window.addEventListener("blur", drop);
    window.addEventListener("pagehide", drop);
    document.addEventListener("visibilitychange", () => { if (document.hidden) drop(); });
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    // The top-left corner belongs to the tuning-sheet gesture.
    if (e.clientX < CORNER && e.clientY < CORNER) return;
    // A second finger is ignored; a new primary pointer replaces a stale one.
    if (this.id !== -1 && !e.isPrimary) return;
    this.id = e.pointerId;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this.downX = this.curX = e.clientX;
    this.downY = this.curY = e.clientY;
    this.hold = true;
    this.latch = true;
    this.presses++;
    this.update();
  };
  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    this.curX = e.clientX; this.curY = e.clientY;
    this.update();
  };
  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.id) return;
    this.id = -1;
    this.hold = false;
    this.lean = 0;
  };

  private update(): void {
    const w = this.el.clientWidth || window.innerWidth;
    if (T.scheme === 0) this.lean = shape((this.curX - this.downX) / T.leanPx);
    else if (T.scheme === 1) this.lean = shape((this.curX - w / 2) / ((w / 2) * T.zoneWidth));
    else this.lean = 0;
  }

  /** Sample for one simulation tick. */
  read(out: RawInput): RawInput {
    const k = this.keys;
    if (this.id === -1 && (k.has("Space") || k.has("ArrowLeft") || k.has("ArrowRight") || k.has("ArrowUp"))) {
      out.hold = true;
      out.lean = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
      return out;
    }
    // A tap shorter than a frame still counts as one tick of hold.
    out.hold = this.hold || this.latch;
    this.latch = false;
    out.lean = out.hold ? this.lean : 0;
    return out;
  }
}
