// Every feel, camera and render constant lives here. The tuning sheet (src/game/sheet.ts)
// is generated from this table, and overrides persist in localStorage.
// Row: [default, min, max, step, group, label, optional choice names]

type Row = readonly [number, number, number, number, string, string, (readonly string[])?];

export const DEFS = {
  // --- controls
  scheme: [0, 0, 2, 1, "Controls", "Control scheme", ["A · Drag lean", "B · Thumb position", "C · Timing only"]],
  leanPx: [70, 20, 200, 5, "Controls", "A: drag px for full lean"],
  leanDead: [0.08, 0, 0.4, 0.01, "Controls", "Lean dead zone"],
  leanCurve: [1.4, 0.5, 3, 0.1, "Controls", "Lean response curve"],
  zoneWidth: [0.7, 0.3, 1, 0.05, "Controls", "B: screen width used"],
  assistSteer: [0.35, 0, 1, 0.05, "Controls", "Auto-steer toward the line"],
  assistAir: [6, 0, 20, 0.5, "Controls", "Air drift toward line m/s²"],
  holdBuffer: [0.35, 0, 1, 0.05, "Controls", "Early-press buffer s"],

  // --- anchor choice
  rangeMax: [30, 10, 60, 1, "Anchors", "Max tether range m"],
  rangeMin: [3, 0, 10, 0.5, "Anchors", "Min tether range m"],
  cone: [70, 20, 120, 5, "Anchors", "Search cone half-angle °"],
  aimLean: [38, 0, 80, 2, "Anchors", "Lean turns aim by °"],
  aimCourse: [0.35, 0, 1, 0.05, "Anchors", "Aim follows course (0-1)"],
  aheadBase: [7, 0, 20, 0.5, "Anchors", "Ideal anchor ahead m"],
  aheadTime: [0.42, 0, 1.5, 0.02, "Anchors", "…plus speed × s"],
  idealUp: [9, 2, 25, 0.5, "Anchors", "Ideal anchor height above m"],
  wAngle: [1.0, 0, 4, 0.1, "Anchors", "Weight: off-aim angle"],
  wDist: [0.8, 0, 4, 0.1, "Anchors", "Weight: distance"],
  wUp: [0.35, 0, 4, 0.05, "Anchors", "Weight: height"],
  wRepeat: [1.5, 0, 5, 0.1, "Anchors", "Penalty: same anchor again"],
  biasDecay: [1.2, 0.1, 5, 0.1, "Anchors", "Lean memory after release s"],

  // --- swing
  gravity: [24, 5, 60, 0.5, "Swing", "Gravity m/s²"],
  swingGravity: [1.25, 0.5, 3, 0.05, "Swing", "Gravity × while tethered"],
  pump: [9, 0, 40, 0.5, "Swing", "Downswing push m/s²"],
  pumpUp: [0.25, 0, 1, 0.05, "Swing", "Push kept on upswing"],
  pumpSpeed: [30, 5, 60, 1, "Swing", "Push fades out by m/s"],
  leanAccel: [26, 0, 80, 1, "Swing", "Lean sideways m/s²"],
  ropeMax: [20, 6, 40, 1, "Swing", "Longest rope m"],
  ropeMin: [4, 1, 12, 0.5, "Swing", "Shortest rope m"],
  reel: [16, 0, 60, 1, "Swing", "Reel-in speed m/s"],
  clearance: [1.6, 0, 6, 0.1, "Swing", "Arc clearance over roofs m"],
  releaseBoost: [1.5, 0, 10, 0.25, "Swing", "Release kick m/s"],
  releaseLift: [2.0, 0, 10, 0.25, "Swing", "Release lift m/s"],
  drag: [0.05, 0, 0.5, 0.01, "Swing", "Air drag 1/s"],
  speedCap: [38, 10, 80, 1, "Swing", "Soft speed cap m/s"],
  sagTime: [0.25, 0.02, 1, 0.01, "Swing", "Line sag settle s"],

  // --- ground
  jog: [7, 2, 15, 0.5, "Ground", "Jog speed m/s"],
  landKeep: [0.55, 0, 1, 0.05, "Ground", "Speed kept on landing"],
  groundDecel: [1.6, 0.2, 8, 0.1, "Ground", "Slow to jog rate 1/s"],
  climb: [14, 2, 40, 1, "Ground", "Wall scramble m/s"],
  hop: [5, 0, 15, 0.5, "Ground", "Hop when tethering from ground m/s"],
  wallKeep: [0.6, 0, 1, 0.05, "Ground", "Speed kept on wall bump"],
  skim: [0.8, 0, 5, 0.1, "Ground", "Roof skim friction 1/s"],

  // --- camera
  camDist: [7.5, 3, 20, 0.5, "Camera", "Distance behind m"],
  camHeight: [2.6, 0, 10, 0.2, "Camera", "Height above m"],
  camLook: [9, 0, 30, 1, "Camera", "Look ahead m"],
  camLookUp: [1.5, -5, 10, 0.5, "Camera", "Look target lift m"],
  camDirLag: [0.35, 0.02, 2, 0.01, "Camera", "Heading follow s"],
  camPitch: [0.35, 0, 1, 0.05, "Camera", "Follow vertical velocity (0-1)"],
  camPosLag: [0.09, 0.01, 1, 0.01, "Camera", "Position lag s"],
  camFov: [68, 40, 100, 1, "Camera", "Field of view ° (vertical)"],
  camFovSpeed: [14, 0, 40, 1, "Camera", "Extra FOV at top speed °"],
  camRoll: [0.12, 0, 0.6, 0.01, "Camera", "Roll into lean (rad)"],
  camDistSpeed: [2.5, 0, 10, 0.5, "Camera", "Pull back at top speed m"],

  // --- paint
  paintMinSpeed: [9, 0, 30, 0.5, "Paint", "No paint below m/s"],
  paintFullSpeed: [30, 10, 60, 1, "Paint", "Full paint at m/s"],
  paintRadius: [13, 2, 30, 0.5, "Paint", "Paint reach at full speed m"],
  paintRadiusMin: [3, 0, 15, 0.5, "Paint", "Paint reach at min speed m"],

  // --- look
  lowW: [200, 120, 400, 10, "Look", "Render width px"],
  splatScale: [0.62, 0.3, 1.2, 0.01, "Look", "Splat size ÷ cell"],
  lodNear: [55, 10, 200, 5, "Look", "Fine → mid detail at m"],
  lodFar: [120, 30, 400, 10, "Look", "Mid → coarse detail at m"],
  drawDist: [420, 100, 800, 20, "Look", "Draw distance m"],
  dither: [0.35, 0, 1, 0.05, "Look", "Palette dither"],
  outline: [0.5, 0, 1, 0.05, "Look", "Depth outline"],

  // --- sound
  volume: [0.7, 0, 1, 0.05, "Sound", "Volume"],
  music: [0.5, 0, 1, 0.05, "Sound", "Music level"],
} as const satisfies Record<string, Row>;

export type TuneKey = keyof typeof DEFS;
export type Tuning = { [K in TuneKey]: number };

export function defaults(): Tuning {
  const t = {} as Tuning;
  for (const k of Object.keys(DEFS) as TuneKey[]) t[k] = DEFS[k][0];
  return t;
}

/** The live tuning object. The game reads from this every frame; the sheet writes to it. */
export const T: Tuning = defaults();

const KEY = "washline.tuning.v1";

export function loadTuning(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const o = JSON.parse(raw) as Record<string, number>;
    for (const k of Object.keys(DEFS) as TuneKey[]) {
      const v = o[k];
      if (typeof v === "number" && isFinite(v)) T[k] = Math.min(DEFS[k][2], Math.max(DEFS[k][1], v));
    }
  } catch {
    /* ignore */
  }
}

/** Saves only values that differ from defaults, so new defaults reach untouched sliders. */
export function saveTuning(): void {
  const o: Record<string, number> = {};
  for (const k of Object.keys(DEFS) as TuneKey[]) if (T[k] !== DEFS[k][0]) o[k] = T[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

export function resetTuning(): void {
  Object.assign(T, defaults());
  saveTuning();
}

export function changedTuning(): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of Object.keys(DEFS) as TuneKey[]) if (T[k] !== DEFS[k][0]) o[k] = T[k];
  return o;
}
