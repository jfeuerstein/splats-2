import { describe, expect, it } from "vitest";
import {
  GHOST_HZ, loadSave, recordRun, rleDecode, rleEncode, storeSave, wipeSave,
  type RunSave, type SaveData,
} from "../src/game/save";

class FakeStorage {
  map = new Map<string, string>();
  constructor(public maxLen = Infinity) {}
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (v.length > this.maxLen) throw new DOMException("quota", "QuotaExceededError");
    this.map.set(k, v);
  }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const fake = (maxLen?: number) => new FakeStorage(maxLen) as unknown as Storage & FakeStorage;

// small deterministic PRNG
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function makePaint(n: number, noisyFrac: number, seed = 1): Uint8Array {
  const r = rng(seed);
  const p = new Uint8Array(n);
  const noisyStart = Math.floor(n * (1 - noisyFrac));
  let i = 0;
  while (i < noisyStart) {
    const len = 200 + Math.floor(r() * 2000);
    const v = r() < 0.5 ? 0 : 255;
    for (let k = 0; k < len && i < noisyStart; k++) p[i++] = v;
  }
  for (; i < n; i++) p[i] = Math.floor(r() * 256);
  return p;
}

function makeRun(seed: number, best = 0.5): RunSave {
  const r = rng(seed);
  const ghost = new Int16Array(3 * 200);
  for (let i = 0; i < ghost.length; i++) ghost[i] = Math.floor(r() * 65536) - 32768;
  ghost[0] = -32768; ghost[1] = 32767; ghost[2] = 0;
  const script: number[] = [];
  for (let i = 0; i < 40; i++) script.push(1 + Math.floor(r() * 300), r() < 0.5 ? 0 : 1, Math.round((r() * 2 - 1) * 100) + 0);
  return { best, paint: makePaint(5000, 0.3, seed), ghost, script, ticks: 5400, plays: 3 };
}

describe("save codec", () => {
  it("rle round-trips edge cases", () => {
    const cases: number[][] = [
      [], [7], [7, 7], [1, 2, 3], [0, 0, 0, 0, 1, 2, 2, 3, 3, 3], [5, 5, 6, 5, 5, 6],
      new Array(1000).fill(255), [...new Array(300).fill(0), 1, ...new Array(129).fill(9), 8],
    ];
    for (const c of cases) {
      const a = Uint8Array.from(c);
      expect(Array.from(rleDecode(rleEncode(a)))).toEqual(c);
    }
    const noisy = makePaint(10000, 1, 9);
    expect(rleDecode(rleEncode(noisy))).toEqual(noisy);
  });

  it("round-trips a SaveData exactly", () => {
    const data: SaveData = { version: 1, runs: { a: makeRun(1, 0.7), "b/2": makeRun(2, 0.1) }, lastRun: "b/2", seenIntro: true };
    const st = fake();
    expect(storeSave(data, st)).toBe(true);
    const back = loadSave(st);
    expect(back).toEqual(data);
    expect(back.runs.a.paint).toBeInstanceOf(Uint8Array);
    expect(back.runs.a.ghost).toBeInstanceOf(Int16Array);
    expect(back.runs.a.ghost[0]).toBe(-32768);
    expect(back.runs.a.ghost[1]).toBe(32767);
    expect(GHOST_HZ).toBe(20);
  });

  it("missing, corrupt, and wrong-version storage give fresh data", () => {
    const fresh = { version: 1, runs: {}, lastRun: null, seenIntro: false };
    const st = fake();
    expect(loadSave(st)).toEqual(fresh);
    st.map.set("washline.save.v1", "{not json");
    expect(loadSave(st)).toEqual(fresh);
    st.map.set("washline.save.v1", JSON.stringify({ version: 99, runs: {}, lastRun: "x", seenIntro: true }));
    expect(loadSave(st)).toEqual(fresh);
    st.map.set("washline.save.v1", JSON.stringify({ version: 1, runs: { a: { best: "x" } }, lastRun: null, seenIntro: true }));
    expect(loadSave(st).runs).toEqual({});
    expect(loadSave(undefined as unknown as Storage)).toEqual(fresh);
  });

  it("wipeSave removes the save", () => {
    const st = fake();
    storeSave({ version: 1, runs: {}, lastRun: null, seenIntro: true }, st);
    wipeSave(st);
    expect(loadSave(st).seenIntro).toBe(false);
  });

  it("recordRun keeps the better run and counts plays", () => {
    const data = loadSave(fake());
    const { plays: _p, ...r1 } = makeRun(1, 0.4);
    const { plays: _q, ...r2 } = makeRun(2, 0.3);
    const { plays: _r, ...r3 } = makeRun(3, 0.6);
    expect(recordRun(data, "x", r1)).toBe(true);
    expect(recordRun(data, "x", r2)).toBe(false);
    expect(data.runs.x.best).toBe(0.4);
    expect(data.runs.x.paint).toEqual(r1.paint);
    expect(data.runs.x.plays).toBe(2);
    expect(recordRun(data, "x", r3)).toBe(true);
    expect(data.runs.x.best).toBe(0.6);
    expect(data.runs.x.plays).toBe(3);
    expect(data.lastRun).toBe("x");
  });

  it("on quota failure retries without scripts, then reports false", () => {
    const data: SaveData = { version: 1, runs: { a: makeRun(1), b: makeRun(2) }, lastRun: "a", seenIntro: false };
    const full = fake();
    storeSave(data, full);
    const fullLen = full.getItem("washline.save.v1")!.length;

    const tight = fake(fullLen - 100);
    expect(storeSave(data, tight)).toBe(true);
    const back = loadSave(tight);
    expect(back.runs.a.script).toEqual([]);
    expect(back.runs.a.paint).toEqual(data.runs.a.paint);
    expect(back.runs.a.ghost).toEqual(data.runs.a.ghost);
    expect(data.runs.a.script.length).toBeGreaterThan(0); // caller's data untouched

    expect(storeSave(data, fake(10))).toBe(false);
    const always = { getItem: () => null, setItem() { throw new Error("private mode"); }, removeItem() {} } as unknown as Storage;
    expect(storeSave(data, always)).toBe(false);
  });

  it("encodes 20,000 paint bytes (90% runs) under 8 KB", () => {
    const data: SaveData = { version: 1, runs: {}, lastRun: null, seenIntro: false };
    data.runs.a = { best: 0.5, paint: makePaint(20000, 0.1), ghost: new Int16Array(0), script: [], ticks: 1, plays: 1 };
    const st = fake();
    storeSave(data, st);
    const size = st.getItem("washline.save.v1")!.length;
    expect(size).toBeLessThan(8192);
    expect(loadSave(st).runs.a.paint).toEqual(data.runs.a.paint);
  });
});
