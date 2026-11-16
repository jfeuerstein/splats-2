/**
 * Washline sound: everything synthesised at runtime with Web Audio. No files, no samples.
 * Import-safe in Node (nothing touches AudioContext until unlock()).
 */

export interface AudioFrame {
  speed: number;
  mode: 0 | 1 | 2;
  vy: number;
  lean: number;
  painting: number;
  fill: number;
  inRun: boolean;
}
export interface GameAudio {
  unlock(): void;
  frame(f: AudioFrame, dt: number): void;
  event(bits: number, speed: number): void;
  ui(kind: "tap" | "start" | "best"): void;
  setVolume(master: number, music: number): void;
  suspend(): void;
  resume(): void;
}

// ---------------------------------------------------------------------------
// Tuning constants (candidates for the tuning sheet)
// ---------------------------------------------------------------------------
export const AUDIO_TUNING = {
  /** Max simultaneous one-shot voices; the oldest is stolen beyond this. */
  voiceCap: 16,
  /** Air rush loudness at full speed (linear gain before master). */
  airGain: 0.14,
  /** Tether hum loudness while swinging (linear gain). */
  tetherGain: 0.07,
  /** Mallet note loudness (peak gain before music bus). */
  noteGain: 0.15,
  /** Fraction of the chain kept on landing (0 = full reset, 1 = no drop). */
  landKeep: 0.35,
  /** Echo feedback on mallet notes. */
  echoFeedback: 0.32,
  /** Pad drone level before music bus. */
  padGain: 0.05,
} as const;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------
export const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
export const CHORD_ROOTS = [0, -3, -7, -5]; // I, vi, IV, V roots in semitones from C
export const BASE_MIDI = 60;
export const PATTERN = [0, 1, 2, 1, 3, 2, 4, 3];

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
export function num(x: unknown, fallback = 0): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
/** Deterministic PRNG returning [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Scale degree index (may exceed 4: wraps into higher octaves) to semitones above the root. */
export function degreeSemis(d: number): number {
  const di = Math.max(0, Math.floor(d));
  return SCALE[di % SCALE.length]! + 12 * Math.floor(di / SCALE.length);
}
/** Chord root (semitones) for a running note count; moves every 8 notes. */
export function chordRoot(noteCount: number): number {
  return CHORD_ROOTS[Math.floor(Math.max(0, noteCount) / 8) % CHORD_ROOTS.length]!;
}
/** Melody scale-degree index for a chain count: slow climb with a small wavy contour. */
export function chainDegree(chain: number): number {
  const c = Math.max(0, Math.floor(chain));
  return Math.min(Math.floor(c / 2), 9) + PATTERN[c % PATTERN.length]!;
}
export function chainFreq(chain: number, noteCount: number): number {
  return mtof(BASE_MIDI + chordRoot(noteCount) + degreeSemis(chainDegree(chain)));
}
export function airLevel(speed: number): number {
  const t = smoothstep(6, 30, speed);
  return t * Math.sqrt(t);
}
export function airCenter(speed: number): number {
  return 350 + smoothstep(6, 32, speed) * 3600;
}
/** Tether hum pitch (Hz): rises with speed, so lowest at the top of the arc. */
export function tetherFreq(speed: number): number {
  return 92 + Math.pow(clamp(speed, 0, 36) / 36, 1.15) * 250;
}
export function jogRate(speed: number): number {
  return clamp(2.2 + speed * 0.3, 2, 5);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
interface Voice {
  g: GainNode;
  srcs: AudioScheduledSourceNode[];
}

type AnyCtx = BaseAudioContext;

export function createAudio(injected?: BaseAudioContext): GameAudio {
  const T = AUDIO_TUNING;
  const rng = mulberry32(0x5eed1234);
  let ctx: AnyCtx | null = null;
  let offline = false;
  let dead = false;
  let userSuspended = false;
  let masterVol = 0.8;
  let musicVol = 0.7;

  // nodes
  let masterGain!: GainNode;
  let musicGain!: GainNode;
  let musicFilter!: BiquadFilterNode;
  let sfxBus!: GainNode;
  let contBus!: GainNode;
  let panner: StereoPannerNode | null = null;
  let echoIn!: GainNode;
  let noiseBuf!: AudioBuffer;
  let airGain!: GainNode;
  let airBand!: BiquadFilterNode;
  let thGain!: GainNode;
  let thLow!: BiquadFilterNode;
  let thOscA!: OscillatorNode;
  let thOscB!: OscillatorNode;
  let padGain!: GainNode;
  let padFilter!: BiquadFilterNode;
  let padOscs: OscillatorNode[] = [];

  const voices: Voice[] = [];

  // state
  let chain = 0;
  let noteCount = 0;
  let curRoot = 0;
  let fillNow = 0;
  let accum = 0;
  let jogT = 0;
  let beatT = 0;
  let lastSkim = -1;
  let lastResumeTry = 0;

  const running = (): boolean => {
    if (!ctx || dead) return false;
    if (offline) return true;
    return (ctx.state as string) === "running";
  };

  function build(c: AnyCtx): void {
    // Master chain: bus -> compressor -> soft clip (bounded +-0.76) -> master gain -> out.
    const bus = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x);
    }
    shaper.curve = curve;
    shaper.oversample = "2x";
    masterGain = c.createGain();
    masterGain.gain.value = masterVol * 0.9;
    bus.connect(comp);
    comp.connect(shaper);
    shaper.connect(masterGain);
    masterGain.connect(c.destination);

    sfxBus = c.createGain();
    sfxBus.connect(bus);
    contBus = c.createGain();
    if (typeof c.createStereoPanner === "function") {
      panner = c.createStereoPanner();
      contBus.connect(panner);
      panner.connect(sfxBus);
    } else {
      contBus.connect(sfxBus);
    }

    // Music bus: filter -> gain -> bus, with an echo.
    musicGain = c.createGain();
    musicGain.gain.value = musicVol;
    musicGain.connect(bus);
    musicFilter = c.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 1800;
    musicFilter.Q.value = 0.3;
    musicFilter.connect(musicGain);
    echoIn = c.createGain();
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.27;
    const fb = c.createGain();
    fb.gain.value = T.echoFeedback;
    const echoLp = c.createBiquadFilter();
    echoLp.type = "lowpass";
    echoLp.frequency.value = 2200;
    const wet = c.createGain();
    wet.gain.value = 0.38;
    echoIn.connect(delay);
    delay.connect(echoLp);
    echoLp.connect(fb);
    fb.connect(delay);
    echoLp.connect(wet);
    wet.connect(musicFilter);

    // Shared noise buffer (2 s, deterministic).
    const len = Math.floor(c.sampleRate * 2);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    const nr = mulberry32(0xa11ce);
    for (let i = 0; i < len; i++) d[i] = nr() * 2 - 1;

    // Air rush.
    const airSrc = c.createBufferSource();
    airSrc.buffer = noiseBuf;
    airSrc.loop = true;
    airBand = c.createBiquadFilter();
    airBand.type = "bandpass";
    airBand.frequency.value = 400;
    airBand.Q.value = 0.7;
    airGain = c.createGain();
    airGain.gain.value = 0;
    airSrc.connect(airBand);
    airBand.connect(airGain);
    airGain.connect(contBus);
    airSrc.start();

    // Tether hum: two detuned triangles -> lowpass.
    thOscA = c.createOscillator();
    thOscB = c.createOscillator();
    thOscA.type = "triangle";
    thOscB.type = "triangle";
    thOscA.frequency.value = 100;
    thOscB.frequency.value = 100;
    thOscA.detune.value = -7;
    thOscB.detune.value = 7;
    thLow = c.createBiquadFilter();
    thLow.type = "lowpass";
    thLow.frequency.value = 500;
    thLow.Q.value = 1.2;
    thGain = c.createGain();
    thGain.gain.value = 0;
    thOscA.connect(thLow);
    thOscB.connect(thLow);
    thLow.connect(thGain);
    thGain.connect(contBus);
    thOscA.start();
    thOscB.start();

    // Pad bed (root, fifth, major tenth), slow filter LFO.
    padGain = c.createGain();
    padGain.gain.value = 0;
    padFilter = c.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = 700;
    padFilter.Q.value = 0.5;
    padFilter.connect(padGain);
    padGain.connect(musicFilter);
    const padTypes: OscillatorType[] = ["sine", "triangle", "sine"];
    const padOff = [0, 7, 16];
    padOscs = padOff.map((o, i) => {
      const osc = c.createOscillator();
      osc.type = padTypes[i]!;
      osc.frequency.value = mtof(48 + o);
      osc.detune.value = (i - 1) * 4;
      const g = c.createGain();
      g.gain.value = i === 1 ? 0.5 : 0.8;
      osc.connect(g);
      g.connect(padFilter);
      osc.start();
      return osc;
    });
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = c.createGain();
    lfoG.gain.value = 180;
    lfo.connect(lfoG);
    lfoG.connect(padFilter.frequency);
    lfo.start();
  }

  function unlock(): void {
    if (dead) return;
    try {
      if (!ctx) {
        if (injected) {
          ctx = injected;
          offline = typeof (injected as OfflineAudioContext).startRendering === "function";
        } else {
          const g = globalThis as unknown as Record<string, unknown>;
          const AC = (g.AudioContext ?? g.webkitAudioContext) as
            | (new (o?: AudioContextOptions) => AudioContext)
            | undefined;
          if (!AC) {
            dead = true;
            return;
          }
          try {
            ctx = new AC({ latencyHint: "interactive" });
          } catch {
            ctx = new AC();
          }
        }
        build(ctx);
      }
      userSuspended = false;
      if (!offline && (ctx.state as string) !== "running") {
        (ctx as AudioContext).resume().catch(() => {});
      }
    } catch {
      dead = true;
    }
  }

  // ----- voices -----
  function dropVoice(v: Voice): void {
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    try {
      v.g.disconnect();
    } catch {
      /* ignore */
    }
  }
  function killVoice(v: Voice, now: number): void {
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(0, now, 0.008);
      for (const s of v.srcs) {
        try {
          s.stop(now + 0.05);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  function addVoice(g: GainNode, srcs: AudioScheduledSourceNode[]): void {
    const c = ctx!;
    const v: Voice = { g, srcs };
    if (voices.length >= T.voiceCap) {
      const old = voices.shift()!;
      killVoice(old, c.currentTime);
    }
    voices.push(v);
    srcs[0]!.onended = () => dropVoice(v);
  }

  /** Percussive envelope helper. */
  function env(g: GainNode, when: number, peak: number, attack: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  }

  function tone(
    when: number, type: OscillatorType, f0: number, f1: number, dur: number,
    peak: number, attack: number, dest: AudioNode,
  ): void {
    const c = ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur * 0.8);
    const g = c.createGain();
    env(g, when, peak, attack, dur);
    o.connect(g);
    g.connect(dest);
    o.start(when);
    o.stop(when + dur + 0.03);
    addVoice(g, [o]);
  }

  function noiseBurst(
    when: number, ftype: BiquadFilterType, f0: number, f1: number, Q: number, dur: number,
    peak: number, attack: number, dest: AudioNode,
  ): void {
    const c = ctx!;
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = ftype;
    f.Q.value = Q;
    f.frequency.setValueAtTime(f0, when);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), when + dur * 0.9);
    const g = c.createGain();
    env(g, when, peak, attack, dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(when, rng() * 1.5);
    s.stop(when + dur + 0.03);
    addVoice(g, [s]);
  }

  /** Soft mallet/bell: sine + FM + triangle body, fast decay. */
  function mallet(freq: number, when: number, vel: number, toMusic: boolean, octaveLayer = 0): void {
    const c = ctx!;
    const dur = 0.9;
    const g = c.createGain();
    env(g, when, vel, 0.004, dur);
    const car = c.createOscillator();
    car.type = "sine";
    car.frequency.value = freq;
    const mod = c.createOscillator();
    mod.type = "sine";
    mod.frequency.value = freq * 2;
    const mg = c.createGain();
    mg.gain.setValueAtTime(freq * 1.4, when);
    mg.gain.exponentialRampToValueAtTime(freq * 0.02, when + 0.3);
    mod.connect(mg);
    mg.connect(car.frequency);
    const tri = c.createOscillator();
    tri.type = "triangle";
    tri.frequency.value = freq;
    const tg = c.createGain();
    tg.gain.value = 0.25;
    tri.connect(tg);
    car.connect(g);
    tg.connect(g);
    const srcs: AudioScheduledSourceNode[] = [car, mod, tri];
    if (octaveLayer > 0.05) {
      const oct = c.createOscillator();
      oct.type = "sine";
      oct.frequency.value = freq * 2;
      const og = c.createGain();
      og.gain.value = octaveLayer * 0.5;
      oct.connect(og);
      og.connect(g);
      srcs.push(oct);
    }
    if (toMusic) {
      g.connect(musicFilter);
      g.connect(echoIn);
    } else {
      g.connect(sfxBus);
    }
    for (const s of srcs) {
      s.start(when);
      s.stop(when + dur + 0.03);
    }
    addVoice(g, srcs);
  }

  function updatePadChord(now: number): void {
    const root = chordRoot(noteCount);
    if (root === curRoot) return;
    curRoot = root;
    const off = [0, 7, 16];
    padOscs.forEach((o, i) => o.frequency.setTargetAtTime(mtof(48 + root + off[i]!), now, 0.7));
  }

  function melodyNote(when: number, vel: number): void {
    mallet(chainFreq(chain, noteCount), when, vel * T.noteGain, true, fillNow);
    chain++;
    noteCount++;
    updatePadChord(when);
  }

  // ----- events -----
  function event(bits: number, speedIn: number): void {
    if (!running()) return;
    const c = ctx!;
    const speed = clamp(num(speedIn), 0, 40);
    const sp = speed / 35;
    const now = c.currentTime + 0.005;
    try {
      if (bits & 1) {
        // attach: pluck glide + noise transient + melody note
        const f0 = 300 + speed * 9;
        tone(now, "triangle", f0, f0 * 0.5, 0.16, 0.2, 0.002, sfxBus);
        tone(now, "sine", f0 * 0.5, f0 * 0.25, 0.14, 0.12, 0.002, sfxBus);
        noiseBurst(now, "bandpass", 2600, 1800, 1.2, 0.03, 0.12, 0.002, sfxBus);
        melodyNote(now, 0.9);
      }
      if (bits & 2) {
        // release: airy whoof + tiny scale blip + melody note
        const vol = 0.06 + sp * 0.12;
        noiseBurst(now, "bandpass", 500, 2400 + speed * 50, 0.9, 0.28, vol, 0.05, sfxBus);
        const semis = SCALE[Math.floor(rng() * SCALE.length)]! + (rng() < 0.4 ? 12 : 0);
        tone(now + 0.02, "sine", mtof(72 + chordRoot(noteCount) + semis), mtof(72 + chordRoot(noteCount) + semis) * 1.01,
          0.13, 0.035 + sp * 0.02, 0.01, sfxBus);
        melodyNote(now + 0.01, 0.8);
      }
      if (bits & 4) {
        tone(now, "sine", 95, 48, 0.2, 0.34, 0.003, sfxBus);
        noiseBurst(now, "lowpass", 1400, 500, 0.7, 0.1, 0.1, 0.004, sfxBus);
        chain = Math.floor(chain * T.landKeep);
      }
      if (bits & 8) {
        tone(now, "sine", 62, 40, 0.14, 0.3, 0.002, sfxBus);
        noiseBurst(now, "lowpass", 600, 300, 0.6, 0.09, 0.09, 0.002, sfxBus);
      }
      if (bits & 16) {
        // finish: rising arpeggio that resolves (~1.2 s)
        const r = BASE_MIDI + chordRoot(0);
        const steps = [0, 2, 4, 7, 9, 12, 16];
        const t0 = now + 0.02;
        for (let i = 0; i < 6; i++) {
          mallet(mtof(r + 12 + steps[i]! % 12 + (steps[i]! >= 12 ? 12 : 0)), t0 + i * 0.14, 0.12, false);
        }
        mallet(mtof(r + 12), t0 + 0.84, 0.1, false);
        mallet(mtof(r + 19), t0 + 0.86, 0.09, false);
        mallet(mtof(r + 28), t0 + 0.88, 0.07, false);
      }
      if (bits & 32) {
        if (now - lastSkim >= 0.125 || now < lastSkim) {
          lastSkim = now;
          noiseBurst(now, "bandpass", 3200, 2600, 1.0, 0.07, 0.035 + sp * 0.03, 0.006, sfxBus);
        }
      }
    } catch {
      /* never throw into the game loop */
    }
  }

  function ui(kind: "tap" | "start" | "best"): void {
    if (!running()) return;
    const now = ctx!.currentTime + 0.005;
    try {
      if (kind === "tap") {
        tone(now, "sine", 880, 1180, 0.07, 0.07, 0.003, sfxBus);
      } else if (kind === "start") {
        tone(now, "sine", 523, 523, 0.1, 0.08, 0.003, sfxBus);
        tone(now + 0.08, "sine", 784, 784, 0.14, 0.08, 0.003, sfxBus);
      } else {
        const r = BASE_MIDI + 24;
        [0, 4, 7, 9, 12, 16].forEach((s, i) => mallet(mtof(r + s), now + 0.04 + i * 0.07, 0.06, false));
      }
    } catch {
      /* ignore */
    }
  }

  // ----- continuous -----
  function frame(f: AudioFrame, dtIn: number): void {
    if (!ctx || dead || userSuspended) return;
    const c = ctx;
    if (!running()) {
      // iOS "interrupted": poke it occasionally; harmless without a gesture.
      const w = typeof performance !== "undefined" ? performance.now() : 0;
      if (!offline && w - lastResumeTry > 2000) {
        lastResumeTry = w;
        (c as AudioContext).resume().catch(() => {});
      }
      return;
    }
    const dt = clamp(num(dtIn), 0, 0.1);
    const speed = clamp(num(f.speed), 0, 40);
    const painting = clamp(num(f.painting), 0, 1);
    fillNow = clamp(num(f.fill), 0, 1);
    try {
      const now = c.currentTime;

      // Jog ticks.
      if (f.mode === 2 && speed > 0.5) {
        jogT += dt * jogRate(speed);
        if (jogT >= 1) {
          jogT -= 1;
          const alt = rng() < 0.5 ? 0 : 1;
          noiseBurst(now + 0.003, "bandpass", 1500 + alt * 500 + rng() * 200, 900, 2.0, 0.035,
            0.05 + speed * 0.002, 0.002, contBus);
        }
      } else {
        jogT = 0.7;
      }

      // Sparse shimmer while painting.
      beatT += dt;
      if (beatT >= 0.22) {
        beatT = 0;
        if (f.inRun && painting > 0.15 && rng() < painting * 0.3) {
          const semis = SCALE[Math.floor(rng() * SCALE.length)]! + 12 * (1 + (rng() < 0.3 ? 1 : 0));
          mallet(mtof(BASE_MIDI + chordRoot(noteCount) + semis + 12), now + 0.01,
            T.noteGain * (0.3 + 0.3 * painting), true, 0);
        }
      }

      // Smoothed parameters, ~30 Hz.
      accum += dt;
      if (accum < 1 / 30) return;
      accum = 0;
      const air = f.inRun ? airLevel(speed) : 0;
      airGain.gain.setTargetAtTime(air * T.airGain, now, 0.12);
      airBand.frequency.setTargetAtTime(airCenter(speed), now, 0.12);
      if (panner) panner.pan.setTargetAtTime(clamp(num(f.lean), -1, 1) * 0.45, now, 0.1);

      const tOn = f.mode === 1;
      const tf = tetherFreq(speed);
      thOscA.frequency.setTargetAtTime(tf, now, 0.05);
      thOscB.frequency.setTargetAtTime(tf * 1.003, now, 0.05);
      thLow.frequency.setTargetAtTime(450 + speed * 28, now, 0.08);
      thGain.gain.setTargetAtTime(tOn ? T.tetherGain * (0.6 + 0.4 * (speed / 35)) : 0, now, tOn ? 0.025 : 0.05);

      padGain.gain.setTargetAtTime(T.padGain, now, 0.6);
      padFilter.frequency.setTargetAtTime(550 + fillNow * 900, now, 0.8);
      musicFilter.frequency.setTargetAtTime(1500 + fillNow * 5500, now, 0.8);
    } catch {
      /* ignore */
    }
  }

  function setVolume(master: number, music: number): void {
    masterVol = clamp(num(master, 0.8), 0, 1);
    musicVol = clamp(num(music, 0.7), 0, 1);
    if (ctx && !dead) {
      try {
        masterGain.gain.setTargetAtTime(masterVol * 0.9, ctx.currentTime, 0.03);
        musicGain.gain.setTargetAtTime(musicVol, ctx.currentTime, 0.03);
      } catch {
        /* ignore */
      }
    }
  }

  function suspend(): void {
    if (!ctx || dead) return;
    userSuspended = true;
    if (!offline) (ctx as AudioContext).suspend().catch(() => {});
  }
  function resume(): void {
    if (!ctx || dead) return;
    userSuspended = false;
    accum = 0;
    if (!offline && (ctx.state as string) !== "running") (ctx as AudioContext).resume().catch(() => {});
  }

  return { unlock, frame, event, ui, setVolume, suspend, resume };
}
