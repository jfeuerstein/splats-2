// The renderer: Spark splats into a small render target holding palette-index codes, then
// a post pass that maps codes to the 16 palette colours and draws the sky. The canvas is
// the low-res image; CSS `image-rendering: pixelated` scales it up by an integer factor.

import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { SparkRenderer, SplatMesh, PackedSplats, dyno, utils } from "@sparkjsdev/spark";
import { T } from "../tuning";
import { PAINT_W, PAINT_H, paintCol, paintRow } from "../sim/paint";
import { buildCity, REF_SPLAT_SCALE, SUN_DIR, type City } from "./city";
import { StaticPool } from "./pool";
import { makeDynModifier, makeWorldModifier, patchSparkShaders, MAX_STD_DEV, type SplatShaderUniforms } from "./sparkfx";
import { PALETTE_RGB } from "./palette";

export interface ViewStats { budget: number; live: number; tiles: number; levelCounts: number[]; lowW: number; lowH: number; uploadsPerSec: number }
export interface View {
  readonly camera: THREE.PerspectiveCamera;
  readonly paint: Uint8Array; paintDirty(): void;
  readonly dyn: { begin(): void; add(x: number, y: number, z: number, r: number, color: number): void; end(): void };
  resize(): void;
  setBudget(maxSplats: number): void;
  render(timeSec: number): void;
  settle(): Promise<void>;
  grab(): { w: number; h: number; rgba: Uint8Array };
  stats(): ViewStats;
  dispose(): void;
  /** Palette index a dynamic splat should use at (x, z): painted if the paint map there exceeds threshold (0..254). */
  paletteAt(x: number, z: number, painted: number, pale: number, threshold: number): number;
}

/** Experiment switches (spike / tools only). */
export interface ViewOptions { sortRadial: boolean; accumExtSplats: boolean; dynCapacity: number; selectHz: number }

const ROW = 2048;

class DynSplats {
  packed: PackedSplats;
  mesh: SplatMesh;
  n = 0;
  hwm = 0;
  private uploadedOnce = false;
  private dirty = false;
  private ox = 0; private oy = 0; private oz = 0;
  constructor(private cap: number, rmul: ReturnType<typeof dyno.dynoFloat>, private camera: THREE.Camera) {
    this.cap = Math.ceil(cap / ROW) * ROW;
    this.packed = new PackedSplats({ packedArray: new Uint32Array(this.cap * 4), numSplats: this.cap });
    this.mesh = new SplatMesh({ packedSplats: this.packed, objectModifier: makeDynModifier(rmul), raycastable: false, editable: false });
  }
  begin(): void {
    this.n = 0;
    const p = this.camera.position;
    this.ox = Math.round(p.x / 4) * 4; this.oy = Math.round(p.y / 4) * 4; this.oz = Math.round(p.z / 4) * 4;
  }
  add(x: number, y: number, z: number, r: number, color: number): void {
    if (this.n >= this.cap) return;
    const s = Math.max(1e-4, r) / MAX_STD_DEV;
    utils.setPackedSplat(this.packed.packedArray!, this.n++, x - this.ox, y - this.oy, z - this.oz, s, s, s, 0, 0, 0, 1, 1, (color & 15) / 255, 0, 0);
  }
  end(): void {
    // Slots below the high-water mark stay "active" (parked far below, culled by the
    // far plane) so a splat added next frame is already in Spark's sorted set.
    const arr = this.packed.packedArray!;
    for (let i = this.n; i < this.hwm; i++) utils.setPackedSplat(arr, i, 0, -20000, 0, 0.01, 0.01, 0.01, 0, 0, 0, 1, 1, 0, 0, 0);
    this.hwm = Math.max(this.hwm, this.n);
    this.mesh.position.set(this.ox, this.oy, this.oz);
    this.mesh.updateMatrixWorld();
    this.dirty = true;
  }
  upload(renderer: THREE.WebGLRenderer): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    const tex = this.packed.source;
    const glTex = tex && renderer.properties.has(tex) ? (renderer.properties.get(tex) as { __webglTexture?: WebGLTexture }).__webglTexture : undefined;
    if (!this.uploadedOnce || !glTex) {
      this.packed.needsUpdate = true;
      this.uploadedOnce = !!glTex;
    } else if (this.hwm > 0) {
      const rows = Math.ceil(this.hwm / ROW);
      const gl = renderer.getContext() as WebGL2RenderingContext;
      renderer.state.activeTexture(gl.TEXTURE0);
      renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, ROW, rows, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, this.packed.packedArray!.subarray(0, rows * ROW * 4));
      renderer.state.unbindTexture();
    }
    this.mesh.updateVersion();
    return true;
  }
}

const POST_VS = /* glsl */ `in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const POST_FS = /* glsl */ `precision highp float;
uniform sampler2D tScene;
uniform vec3 pal[16];
uniform vec3 camR; uniform vec3 camU; uniform vec3 camF;
uniform float tanV; uniform float aspect; uniform float dither;
uniform vec3 sunDir;
in vec2 vUv; out vec4 o;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float bayer4(vec2 px) {
  ivec2 q = ivec2(mod(px, 4.0));
  const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
float cloud(vec2 q) { return vnoise(q * 0.7) * 0.6 + vnoise(q * 1.9 + 7.0) * 0.4; }
int sky(vec3 d, vec2 px) {
  float e = d.y;
  float sd = dot(d, sunDir);
  if (sd > 0.9993) return 15;
  if (sd > 0.9978) return 0;
  if (e > 0.03) {
    // chunky clouds on a plane overhead: world-anchored under rotation
    vec2 q = d.xz / e * 1.2;
    float fade = smoothstep(0.03, 0.10, e) * (1.0 - smoothstep(0.45, 0.75, e));
    float n = cloud(q) * fade;
    if (n > 0.6) {
      float below = cloud(q + vec2(0.0, -0.10) / max(e, 0.05)) * fade;
      return (n > 0.66 || below > 0.6) ? 15 : 0;
    }
  }
  float b = dither * (bayer4(px) - 0.5) * 0.10;
  if (e + b < 0.05) return 0;
  if (e + b < 0.26) return 4;
  return 5;
}
void main() {
  vec4 s = texelFetch(tScene, ivec2(gl_FragCoord.xy), 0);
  int idx;
  if (s.a < 0.5) {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 d = normalize(camF + ndc.x * tanV * aspect * camR + ndc.y * tanV * camU);
    idx = sky(d, gl_FragCoord.xy);
  } else {
    idx = clamp(int(floor(s.r * 16.0)), 0, 15);
  }
  o = vec4(pal[idx], 1.0);
}`;

export async function createView(canvas: HTMLCanvasElement, opts: Partial<ViewOptions> = {}): Promise<View> {
  const o: ViewOptions = { sortRadial: true, accumExtSplats: false, dynCapacity: 4096, selectHz: 8, ...opts };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false, depth: false });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 0.5, 0.3, 1500);

  const spark = new SparkRenderer({
    renderer, enableLod: false, maxStdDev: MAX_STD_DEV, blurAmount: 0, preBlurAmount: 0, falloff: 0,
    minAlpha: 0.5 / 255, clipXY: 1.6, sortRadial: o.sortRadial, accumExtSplats: o.accumExtSplats,
  });
  const su: SplatShaderUniforms = patchSparkShaders(spark);
  scene.add(spark);

  const paint = new Uint8Array(PAINT_W * PAINT_H);
  const paintTex = new THREE.DataTexture(paint, PAINT_W, PAINT_H, THREE.RedFormat, THREE.UnsignedByteType);
  paintTex.minFilter = paintTex.magFilter = THREE.NearestFilter;
  paintTex.generateMipmaps = false;
  paintTex.needsUpdate = true;
  let paintIsDirty = false;

  const rmul = dyno.dynoFloat(T.splatScale / REF_SPLAT_SCALE, "wlRadiusMul");
  const city: City = buildCity();
  const makeMesh = (p: PackedSplats) => new SplatMesh({ packedSplats: p, objectModifier: makeWorldModifier(paintTex, rmul), raycastable: false, editable: false });
  let budget = Math.round(T.budget * 1000);
  const pool = new StaticPool(city, budget, makeMesh);
  scene.add(pool.mesh);
  const dyn = new DynSplats(o.dynCapacity, rmul, camera);
  scene.add(dyn.mesh);

  const rtOpts = { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false };
  const rt = new THREE.WebGLRenderTarget(16, 16, rtOpts);
  const rtGrab = new THREE.WebGLRenderTarget(16, 16, rtOpts);
  const post = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: rt.texture },
      pal: { value: PALETTE_RGB.map((c) => new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255)) },
      camR: { value: new THREE.Vector3() }, camU: { value: new THREE.Vector3() }, camF: { value: new THREE.Vector3() },
      tanV: { value: 1 }, aspect: { value: 1 }, dither: { value: T.dither },
      sunDir: { value: new THREE.Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) },
    },
    vertexShader: POST_VS, fragmentShader: POST_FS,
  });
  const quad = new FullScreenQuad(post);

  let lowW = 16, lowH = 16;
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const cw = window.innerWidth, ch = window.innerHeight;
    const dpw = Math.max(1, Math.round(cw * dpr)), dph = Math.max(1, Math.round(ch * dpr));
    const scale = Math.max(1, Math.round(dpw / T.lowW));
    lowW = Math.max(1, Math.floor(dpw / scale));
    lowH = Math.max(1, Math.floor(dph / scale));
    renderer.setSize(lowW, lowH, false);
    canvas.style.width = `${(lowW * scale) / dpr}px`;
    canvas.style.height = `${(lowH * scale) / dpr}px`;
    rt.setSize(lowW, lowH);
    rtGrab.setSize(lowW, lowH);
    camera.aspect = lowW / lowH;
    camera.updateProjectionMatrix();
  };
  resize();

  let lastSelect = -1e9;
  let changeStamp = 0;
  let forceSelect = false;
  let settleInfo: Record<string, unknown> = {};
  const uploadTimes: number[] = [];
  const prevCam = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  let lastScale = T.splatScale;
  const anySpark = spark as unknown as { lastSortTime: number; sorting: boolean; sortDirty: boolean };
  const sortedSince = (stamp: number) => anySpark.lastSortTime >= stamp && !anySpark.sorting;

  // Chrome/WebKit update WebGL fence status between animation frames: wait on frames.
  const nextFrame = () => new Promise<void>((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 100); });
  const gpuIdle = async () => {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    gl.flush();
    const t0 = performance.now();
    while (gl.clientWaitSync(sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0) === gl.TIMEOUT_EXPIRED && performance.now() - t0 < 20000) await nextFrame();
    gl.deleteSync(sync);
  };

  const drawPost = (target: THREE.WebGLRenderTarget | null) => {
    const e = camera.matrixWorld.elements;
    post.uniforms.camR.value.set(e[0], e[1], e[2]).normalize();
    post.uniforms.camU.value.set(e[4], e[5], e[6]).normalize();
    post.uniforms.camF.value.set(-e[8], -e[9], -e[10]).normalize();
    post.uniforms.tanV.value = Math.tan((camera.fov * Math.PI) / 360);
    post.uniforms.aspect.value = camera.aspect;
    post.uniforms.dither.value = T.dither;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  };

  const render = (_timeSec: number) => {
    if (camera.aspect !== lowW / lowH) { camera.aspect = lowW / lowH; }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const now = performance.now();
    if (!prevCam.equals(camera.matrixWorld)) { changeStamp = now; prevCam.copy(camera.matrixWorld); }
    su.wlMinPx.value = T.minPx;
    su.wlSnap.value = T.pixelSnap > 0.5;
    if (T.splatScale !== lastScale) {
      lastScale = T.splatScale;
      rmul.value = T.splatScale / REF_SPLAT_SCALE;
      pool.mesh.updateVersion(); dyn.mesh.updateVersion(); changeStamp = now;
    }
    pool.flushPending(sortedSince);
    if (forceSelect || now - lastSelect > 1000 / o.selectHz) {
      pool.select(camera, { near: T.lodNear, far: T.lodFar, draw: T.drawDist, fovY: camera.fov, aspect: camera.aspect }, budget, forceSelect ? Infinity : 8000, now);
      lastSelect = now;
    }
    if (pool.upload(renderer)) { pool.mesh.updateVersion(); uploadTimes.push(now); changeStamp = now; }
    if (dyn.upload(renderer)) changeStamp = now;
    if (paintIsDirty) { paintIsDirty = false; paintTex.needsUpdate = true; pool.mesh.updateVersion(); changeStamp = now; }

    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(scene, camera);
    pool.afterRender(renderer);
    drawPost(null);
    while (uploadTimes.length && uploadTimes[0] < now - 1000) uploadTimes.shift();
    void tmpV;
  };

  const view: View = {
    camera,
    paint,
    paintDirty() { paintIsDirty = true; },
    dyn: { begin: () => dyn.begin(), add: (x, y, z, r, c) => dyn.add(x, y, z, r, c), end: () => dyn.end() },
    resize,
    setBudget(n: number) {
      budget = Math.max(ROW, Math.round(n));
      if (Math.abs(budget - pool.capacity) < ROW && budget <= pool.capacity) return;
      const old = pool.setBudget(budget);
      scene.remove(old);
      old.dispose();
      scene.add(pool.mesh);
      lastSelect = -1e9;
    },
    render,
    async settle() {
      // Render only when no sort is in flight (each render queues GPU work; on slow GPUs an
      // unconditional loop starves Spark's depth-readback fence), then let the GPU drain.
      let renders = 0;
      for (let i = 0; i < 2000; i++) {
        if (!anySpark.sorting || renders === 0) {
          forceSelect = true;
          render(0);
          forceSelect = false;
          renders++;
          await gpuIdle();
        }
        const busy = pool.backlog > 0 || pool.pendingCount() > 0 || anySpark.sorting || anySpark.sortDirty || !sortedSince(changeStamp);
        settleInfo = { i, renders, backlog: pool.backlog, pending: pool.pendingCount(), sorting: anySpark.sorting, sortDirty: anySpark.sortDirty, lastSort: anySpark.lastSortTime, changeStamp };
        if (!busy && renders > 1) return;
        await nextFrame();
      }
    },
    grab() {
      drawPost(rtGrab);
      const buf = new Uint8Array(lowW * lowH * 4);
      renderer.readRenderTargetPixels(rtGrab, 0, 0, lowW, lowH, buf);
      renderer.setRenderTarget(null);
      // top row first
      const out = new Uint8Array(buf.length), row = lowW * 4;
      for (let y = 0; y < lowH; y++) out.set(buf.subarray((lowH - 1 - y) * row, (lowH - y) * row), y * row);
      return { w: lowW, h: lowH, rgba: out };
    },
    stats() {
      return { budget, live: pool.live + dyn.n, tiles: pool.liveTiles(), levelCounts: pool.levelCounts(), lowW, lowH, uploadsPerSec: uploadTimes.length };
    },
    dispose() {
      scene.remove(spark); spark.dispose();
      pool.mesh.dispose(); dyn.mesh.dispose();
      rt.dispose(); rtGrab.dispose(); post.dispose(); quad.dispose(); paintTex.dispose();
      renderer.dispose();
    },
    paletteAt(x, z, painted, pale, threshold) {
      const c = Math.floor(paintCol(x)), r = Math.floor(paintRow(z));
      if (c < 0 || r < 0 || c >= PAINT_W || r >= PAINT_H) return pale;
      return paint[r * PAINT_W + c] > threshold ? painted : pale;
    },
  };
  // expose some internals for the spike/tools
  (view as unknown as { _debug: unknown })._debug = { spark, pool, city, su, renderer, settleInfo: () => settleInfo };
  return view;
}
