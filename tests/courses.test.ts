import { describe, expect, it } from "vitest";
import { defaults } from "../src/tuning";
import { courseWorld, district } from "../src/world/district";
import { runBot, runScript } from "../src/sim/bot";
import { initState, step } from "../src/sim/sim";
import { SCRIPTS } from "../src/world/scripts";
import { brush, coverage, courseMask, newPaint, stamp } from "../src/sim/paint";

const T = defaults();
const d = district();

describe("the six runs", () => {
  it("has six runs", () => expect(d.courses.length).toBe(6));

  d.courses.forEach((c, i) => {
    const w = courseWorld(d, i);
    it(`${c.id}: the stored script finishes the run`, () => {
      const s = runScript(w, T, SCRIPTS[c.id], 120);
      expect(s.finished).toBe(true);
      expect(s.tick / 120).toBeLessThan(90);
    });
    it(`${c.id}: the stored script is what the bot produces now (regenerate with npm run scripts)`, () => {
      expect(runBot(w, T).script).toEqual(SCRIPTS[c.id]);
    });
    it(`${c.id}: doing nothing still gets there (no fail state)`, () => {
      const s = initState(w);
      let n = 0;
      while (!s.finished && n++ < 120 * 200) step(s, { hold: false, lean: 0 }, w, T);
      expect(s.finished).toBe(true);
    });
    it(`${c.id}: a fast run fills more of the street than a jog`, () => {
      const mask = courseMask(w);
      const fill = (script: number[]) => {
        const map = newPaint();
        runScript(w, T, script, 200, (s) => {
          if (s.tick % 6 === 0) { const [r, k] = brush(Math.hypot(s.vx, s.vy, s.vz), T); if (r > 0) stamp(map, s.px, s.pz, r, k); }
        });
        return coverage(map, mask);
      };
      const fast = fill(SCRIPTS[c.id]), idle = fill([]);
      expect(fast).toBeGreaterThan(0.3);
      expect(fast).toBeGreaterThan(idle + 0.2);
    });
  });
});
