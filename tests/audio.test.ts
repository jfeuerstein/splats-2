import { describe, expect, it } from "vitest";
import {
  airLevel, chainDegree, chainFreq, chordRoot, createAudio, degreeSemis, mulberry32, tetherFreq,
} from "../src/game/audio";

describe("audio helpers", () => {
  it("air is silent when slow and loud when fast", () => {
    expect(airLevel(3)).toBe(0);
    expect(airLevel(30)).toBeGreaterThan(0.95);
  });
  it("tether pitch rises with speed", () => {
    expect(tetherFreq(10)).toBeLessThan(tetherFreq(20));
    expect(tetherFreq(20)).toBeLessThan(tetherFreq(35));
  });
  it("chain climbs and chord root moves every 8 notes", () => {
    expect(chainDegree(20)).toBeGreaterThan(chainDegree(0));
    expect(chordRoot(0)).not.toBe(chordRoot(8));
    expect(chainFreq(30, 30)).toBeGreaterThan(chainFreq(0, 0));
    expect(degreeSemis(5)).toBe(12);
  });
  it("prng is deterministic and in range", () => {
    const a = mulberry32(1), b = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it("is a safe no-op without Web Audio", () => {
    const au = createAudio();
    au.frame({ speed: 10, mode: 1, vy: 0, lean: 0, painting: 0, fill: 0, inRun: true }, 0.016);
    au.event(31, 10); au.ui("tap"); au.setVolume(1, 1); au.suspend(); au.resume(); au.unlock();
    au.event(1, 10);
  });
});
