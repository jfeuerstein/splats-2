// Saves in localStorage. Typed arrays are stored compactly: paint as PackBits-style RLE + base64,
// ghost as base64 of little-endian Int16 bytes, script as a plain number array.

export interface RunSave {
  best: number; // 0..1 street fill of the best run
  paint: Uint8Array; // best run's paint values, one byte per cell of that run's mask
  ghost: Int16Array; // best run's path: x,y,z triples in decimetres, sampled at GHOST_HZ
  script: number[]; // best run's inputs, run-length triples [ticks, hold 0/1, lean*100]
  ticks: number; // length of the best run in simulation ticks
  plays: number; // times this run has been finished
}

export const GHOST_HZ = 20;

export interface SaveData {
  version: number;
  runs: Record<string, RunSave>;
  lastRun: string | null;
  seenIntro: boolean;
}

const KEY = "washline.save.v1";
const VERSION = 1;

function fresh(): SaveData {
  return { version: VERSION, runs: {}, lastRun: null, seenIntro: false };
}

function defaultStorage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- codecs

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(s);
}

function fromBase64(str: string): Uint8Array {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * PackBits-style RLE. Header h < 128: h+1 literal bytes follow. h >= 128: the next byte repeats
 * (h - 128 + 2) times (2..129).
 */
export function rleEncode(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  const n = src.length;
  let i = 0;
  let litStart = -1;
  const flush = (end: number) => {
    while (litStart >= 0 && litStart < end) {
      const len = Math.min(128, end - litStart);
      out.push(len - 1);
      for (let k = 0; k < len; k++) out.push(src[litStart + k]);
      litStart += len;
    }
    litStart = -1;
  };
  while (i < n) {
    let j = i + 1;
    while (j < n && src[j] === src[i] && j - i < 129) j++;
    const run = j - i;
    if (run >= 3 || (run === 2 && litStart < 0)) {
      flush(i);
      out.push(128 + run - 2, src[i]);
    } else if (litStart < 0) {
      litStart = i;
    }
    // runs of 1 (or 2 inside a literal) stay literal; advance past what we looked at
    i = j;
  }
  flush(n);
  return Uint8Array.from(out);
}

export function rleDecode(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const h = src[i++];
    if (h < 128) {
      const len = h + 1;
      if (i + len > src.length) throw new Error("rle: truncated literal");
      for (let k = 0; k < len; k++) out.push(src[i + k]);
      i += len;
    } else {
      if (i >= src.length) throw new Error("rle: truncated run");
      const len = h - 128 + 2;
      const v = src[i++];
      for (let k = 0; k < len; k++) out.push(v);
    }
  }
  return Uint8Array.from(out);
}

function encodeGhost(g: Int16Array): string {
  const b = new Uint8Array(g.length * 2);
  for (let i = 0; i < g.length; i++) {
    const v = g[i];
    b[i * 2] = v & 0xff;
    b[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return toBase64(b);
}

function decodeGhost(s: string): Int16Array {
  const b = fromBase64(s);
  if (b.length % 2) throw new Error("ghost: odd length");
  const g = new Int16Array(b.length / 2);
  for (let i = 0; i < g.length; i++) g[i] = ((b[i * 2] | (b[i * 2 + 1] << 8)) << 16) >> 16;
  return g;
}

interface EncRun {
  best: number;
  paint: string;
  ghost: string;
  script: number[];
  ticks: number;
  plays: number;
}

function encodeRun(r: RunSave, dropScript: boolean): EncRun {
  return {
    best: r.best,
    paint: toBase64(rleEncode(r.paint)),
    ghost: encodeGhost(r.ghost),
    script: dropScript ? [] : r.script,
    ticks: r.ticks,
    plays: r.plays,
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);

function decodeRun(o: unknown): RunSave {
  const r = o as Partial<EncRun> | null;
  if (!r || typeof r !== "object") throw new Error("run");
  if (!isNum(r.best) || !isNum(r.ticks) || !isNum(r.plays)) throw new Error("run numbers");
  if (typeof r.paint !== "string" || typeof r.ghost !== "string") throw new Error("run data");
  if (!Array.isArray(r.script) || !r.script.every(isNum)) throw new Error("run script");
  return {
    best: r.best,
    paint: rleDecode(fromBase64(r.paint)),
    ghost: decodeGhost(r.ghost),
    script: r.script.slice(),
    ticks: r.ticks,
    plays: r.plays,
  };
}

function serialize(data: SaveData, dropScripts: boolean): string {
  const runs: Record<string, EncRun> = {};
  for (const id of Object.keys(data.runs)) runs[id] = encodeRun(data.runs[id], dropScripts);
  return JSON.stringify({ version: data.version, runs, lastRun: data.lastRun, seenIntro: data.seenIntro });
}

// ---------------------------------------------------------------- API

/** Never throws; corrupt / missing / wrong version gives fresh data. */
export function loadSave(storage: Storage | undefined = defaultStorage()): SaveData {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return fresh();
    const o = JSON.parse(raw) as {
      version?: unknown; runs?: unknown; lastRun?: unknown; seenIntro?: unknown;
    };
    if (!o || typeof o !== "object" || o.version !== VERSION) return fresh();
    const out = fresh();
    if (o.runs && typeof o.runs === "object") {
      for (const id of Object.keys(o.runs)) {
        try {
          out.runs[id] = decodeRun((o.runs as Record<string, unknown>)[id]);
        } catch {
          /* drop only the damaged run */
        }
      }
    }
    out.lastRun = typeof o.lastRun === "string" ? o.lastRun : null;
    out.seenIntro = o.seenIntro === true;
    return out;
  } catch {
    return fresh();
  }
}

/** False if storage failed (quota, private mode). Never throws. */
export function storeSave(data: SaveData, storage: Storage | undefined = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(KEY, serialize(data, false));
    return true;
  } catch {
    /* fall through: retry without scripts */
  }
  try {
    storage.setItem(KEY, serialize(data, true));
    return true;
  } catch {
    return false;
  }
}

export function wipeSave(storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Record a finished run. Replaces the stored best only if `run.best` is higher; always increments plays. */
export function recordRun(data: SaveData, id: string, run: Omit<RunSave, "plays">): boolean {
  const old = data.runs[id];
  const plays = (old?.plays ?? 0) + 1;
  data.lastRun = id;
  if (!old || run.best > old.best) {
    data.runs[id] = { ...run, plays };
    return true;
  }
  old.plays = plays;
  return false;
}
