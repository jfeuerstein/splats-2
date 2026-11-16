// One fixed-capacity splat pool for the static world, filled from tiles by a CPU selector.
//
// The pool is a single PackedSplats/SplatMesh whose numSplats never changes (so Spark's
// mapping never changes). Capacity is split into 32-splat pages; a tile owns any set of
// pages. Free pages are zeroed (all scales 0 = inactive). Changed rows are uploaded with
// texSubImage3D, so a selector step costs only the rows it touched.

import * as THREE from "three";
import { PackedSplats, SplatMesh, utils } from "@sparkjsdev/spark";
import { CELLS, LEVELS, SplatBuf, type City, type Tile } from "./city";
import { byteToScale, MAX_STD_DEV, originByteX, originByteZ } from "./sparkfx";

export const PAGE = 16;
const ROW = 2048; // Spark splat texture width

export interface LodParams { near: number; far: number; draw: number; fovY: number; aspect: number }

export class StaticPool {
  capacity = 0;
  packed!: PackedSplats;
  mesh!: SplatMesh;
  private used!: Uint8Array;
  private freeCount = 0;
  private cursor = 0;
  private dirtyRows = new Uint8Array(0);
  private anyDirty = false;
  private uploadedOnce = false;
  private buf = new SplatBuf();
  /** Pages waiting for a sort that includes their replacement before they are cleared. */
  pendingFree: { pages: number[]; stamp: number }[] = [];
  live = 0;
  lodScale = 1;
  /** Tiles whose wanted level differs from their current one after the last select(). */
  backlog = 0;
  uploads = 0;
  uploadBytes = 0;
  lastSelectMs = 0;

  constructor(private city: City, budget: number, private makeMesh: (p: PackedSplats) => SplatMesh) {
    this.alloc(budget);
  }

  private alloc(budget: number): void {
    const cap = Math.max(ROW, Math.ceil(budget / ROW) * ROW);
    this.capacity = cap;
    const arr = new Uint32Array(cap * 4);
    this.packed = new PackedSplats({ packedArray: arr, numSplats: cap, maxSplats: cap });
    this.mesh = this.makeMesh(this.packed);
    this.used = new Uint8Array(cap / PAGE);
    this.dirtyRows = new Uint8Array(cap / ROW);
    this.freeCount = cap / PAGE;
    this.cursor = 0;
    this.uploadedOnce = false;
    this.pendingFree = [];
    this.live = 0;
    for (const t of this.city.tiles) { t.level = -1; t.pages = []; }
  }

  /** Replace the pool (rare). Returns the old mesh so the caller can remove and dispose it. */
  setBudget(budget: number): SplatMesh {
    const old = this.mesh;
    this.alloc(budget);
    return old;
  }

  private takePage(): number {
    const n = this.used.length;
    for (let k = 0; k < n; k++) {
      const p = (this.cursor + k) % n;
      if (!this.used[p]) { this.used[p] = 1; this.freeCount--; this.cursor = p + 1; return p; }
    }
    return -1;
  }
  private releasePages(pages: number[]): void {
    const arr = this.packed.packedArray!;
    for (const p of pages) {
      arr.fill(0, p * PAGE * 4, (p + 1) * PAGE * 4);
      this.used[p] = 0;
      this.freeCount++;
      this.markDirty(p);
      if (p < this.cursor) this.cursor = p;
    }
  }
  private markDirty(page: number): void {
    const r = Math.floor((page * PAGE) / ROW);
    this.dirtyRows[r] = 1;
    this.anyDirty = true;
  }

  /** Write a tile at a level into fresh pages. Returns false if the pool is full. */
  private writeTile(t: Tile, level: number): boolean {
    const b = this.buf;
    b.reset();
    t.gen(level, b);
    t.exact[level] = b.n;
    const need = Math.ceil(b.n / PAGE);
    if (need > this.freeCount) return false;
    const pages: number[] = [];
    for (let k = 0; k < need; k++) pages.push(this.takePage());
    const arr = this.packed.packedArray!;
    const sy = byteToScale(originByteX(t.ox)), sz = byteToScale(originByteZ(t.oz));
    for (let i = 0; i < b.n; i++) {
      const page = pages[(i / PAGE) | 0];
      const slot = page * PAGE + (i % PAGE);
      const code = b.code[i];
      utils.setPackedSplat(arr, slot, b.x[i] - t.ox, b.y[i], b.z[i] - t.oz, b.r[i] / MAX_STD_DEV, sy, sz, 0, 0, 0, 1, 1,
        (code & 255) / 255, ((code >> 8) & 255) / 255, ((code >> 16) & 255) / 255);
    }
    for (const p of pages) this.markDirty(p);
    t.pages = pages;
    t.level = level;
    return true;
  }

  private levelFor(d: number, cur: number, D: number[], hyst: number): number {
    const raw = (dd: number) => (dd < D[0] ? 0 : dd < D[1] ? 1 : dd < D[2] ? 2 : 3);
    const L = raw(d);
    if (cur < 0) return L;
    if (L > cur) return Math.max(cur, raw(d / hyst));
    if (L < cur) return Math.min(cur, raw(d * hyst));
    return L;
  }

  /**
   * Decide every tile's level for this camera and rewrite changed tiles.
   * maxWrite caps splats generated in one call (the rest waits for the next call).
   */
  select(cam: THREE.PerspectiveCamera, lp: LodParams, budget: number, maxWrite: number, sortStamp: number): void {
    const t0 = performance.now();
    const tiles = this.city.tiles;
    const p = cam.position;
    const e = cam.matrixWorld.elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], fx = -e[8], fy = -e[9], fz = -e[10];
    // generous frustum: wider by a margin, apex pulled back, so rotation/translation between
    // selector runs never reveals a missing tile
    const marg = 0.35; // rad
    const tanV = Math.tan(Math.min(1.45, (lp.fovY * Math.PI) / 360 + marg));
    const tanH = Math.tan(Math.min(1.45, Math.atan(Math.tan((lp.fovY * Math.PI) / 360) * lp.aspect) + marg));
    const back = 8;
    const ax = p.x - fx * back, ay = p.y - fy * back, az = p.z - fz * back;
    const planes = [
      [-rx + fx * tanH, -ry + fy * tanH, -rz + fz * tanH],
      [rx + fx * tanH, ry + fy * tanH, rz + fz * tanH],
      [-ux + fx * tanV, -uy + fy * tanV, -uz + fz * tanV],
      [ux + fx * tanV, uy + fy * tanV, uz + fz * tanV],
    ];
    const vis = new Uint8Array(tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const cx = Math.max(t.x0, Math.min(p.x, t.x1)), cy = Math.max(t.y0, Math.min(p.y, t.y1)), cz = Math.max(t.z0, Math.min(p.z, t.z1));
      const d = Math.hypot(cx - p.x, cy - p.y, cz - p.z);
      t.dist = d;
      if (d > lp.draw) continue;
      if ((t.nx || t.ny || t.nz) && t.nx * p.x + t.ny * p.y + t.nz * p.z < t.d - 1.5) continue;
      let inside = true;
      for (const pl of planes) {
        const qx = pl[0] > 0 ? t.x1 : t.x0, qy = pl[1] > 0 ? t.y1 : t.y0, qz = pl[2] > 0 ? t.z1 : t.z0;
        if ((qx - ax) * pl[0] + (qy - ay) * pl[1] + (qz - az) * pl[2] < 0) { inside = false; break; }
      }
      if (inside) vis[i] = 1;
    }
    // fit the budget: shrink LOD distances until the estimate fits; recover slowly
    const est = (k: number) => {
      const D = [lp.near * k, lp.far * k, lp.far * 2 * k];
      let sum = 0;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (!vis[i]) { t.want = -1; continue; }
        const L = this.levelFor(t.dist, t.level, D, 1.08);
        t.want = L > t.maxLevel ? -1 : L;
        if (t.want >= 0) sum += Math.ceil((t.exact[t.want] >= 0 ? t.exact[t.want] : t.est[t.want]) / PAGE) * PAGE;
      }
      return sum;
    };
    const cap = Math.min(budget, this.capacity) * 0.9;
    let k = this.lodScale;
    let total = est(k);
    if (total > cap) {
      while (total > cap && k > 0.1) { k *= 0.9; total = est(k); }
    } else if (k < 1) {
      // grow back only when the larger distances fit with a clear margin (no oscillation)
      const k2 = Math.min(1, k / 0.9);
      const t2 = est(k2);
      if (t2 < cap * 0.85) { k = k2; total = t2; } else total = est(k);
    }
    this.lodScale = k;

    // apply: drop first, then write nearest first
    const changes: Tile[] = [];
    for (const t of tiles) {
      if (t.want === t.level) continue;
      if (t.want < 0) { this.releasePages(t.pages); this.live -= t.exact[t.level] ?? 0; t.pages = []; t.level = -1; continue; }
      changes.push(t);
    }
    changes.sort((a, b) => a.dist - b.dist);
    let written = 0;
    let starved = false;
    this.backlog = 0;
    for (const t of changes) {
      if (written >= maxWrite) { this.backlog++; continue; }
      const oldPages = t.pages, oldLevel = t.level;
      if (!this.writeTile(t, t.want)) {
        // pool full: free the old copy now and retry once
        if (oldPages.length) { this.releasePages(oldPages); t.pages = []; this.live -= t.exact[oldLevel]; t.level = -1; }
        if (!this.writeTile(t, t.want)) { this.backlog++; starved = true; continue; }
        this.live += t.exact[t.level];
        written += t.exact[t.level];
        continue;
      }
      written += t.exact[t.level];
      this.live += t.exact[t.level];
      if (oldPages.length) {
        // keep the old copy until a sort that includes the new one has finished
        this.pendingFree.push({ pages: oldPages, stamp: sortStamp });
        this.live -= t.exact[oldLevel];
      }
    }
    // estimates were too low for the real allocation: pull LOD distances in for next time
    if (starved) this.lodScale = Math.max(0.1, this.lodScale * 0.9);
    this.lastSelectMs = performance.now() - t0;
  }

  /** Clear old copies whose replacements are now sorted. `sortedSince(stamp)` says if a sort covering that time finished. */
  flushPending(sortedSince: (stamp: number) => boolean): void {
    if (!this.pendingFree.length) return;
    const keep: { pages: number[]; stamp: number }[] = [];
    for (const f of this.pendingFree) {
      if (sortedSince(f.stamp)) this.releasePages(f.pages);
      else keep.push(f);
    }
    this.pendingFree = keep;
  }

  pendingCount(): number { return this.pendingFree.length; }

  /** Upload dirty rows. Returns true if anything was uploaded (caller bumps the mesh version). */
  upload(renderer: THREE.WebGLRenderer): boolean {
    if (!this.anyDirty) return false;
    this.anyDirty = false;
    this.uploads++;
    const tex = this.packed.source;
    const glTex = tex ? (renderer.properties.get(tex) as { __webglTexture?: WebGLTexture }).__webglTexture : undefined;
    if (!this.uploadedOnce || !tex || !glTex) {
      // first upload goes through Spark (creates the texture)
      this.dirtyRows.fill(0);
      this.packed.needsUpdate = true;
      this.uploadBytes += this.capacity * 16;
      this.uploadedOnce = !!glTex;
      return true;
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), pre = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    const align = gl.getParameter(gl.UNPACK_ALIGNMENT);
    renderer.state.activeTexture(gl.TEXTURE0);
    renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const arr = this.packed.packedArray!, dr = this.dirtyRows;
    // one texSubImage3D per contiguous run of dirty rows (2048 splats = 32 KB per row)
    for (let r = 0; r < dr.length; ) {
      if (!dr[r]) { r++; continue; }
      let e = r;
      while (e + 1 < dr.length && dr[e + 1]) e++;
      const rows = e - r + 1;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, r, 0, ROW, rows, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, arr.subarray(r * ROW * 4, (e + 1) * ROW * 4));
      this.uploadBytes += rows * ROW * 16;
      dr.fill(0, r, e + 1);
      r = e + 1;
    }
    renderer.state.unbindTexture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, pre);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, align);
    return true;
  }

  /** Call after a render: once Spark created the texture, later uploads go row by row. */
  afterRender(renderer: THREE.WebGLRenderer): void {
    if (!this.uploadedOnce && this.packed.source && renderer.properties.has(this.packed.source)) {
      const g = (renderer.properties.get(this.packed.source) as { __webglTexture?: WebGLTexture }).__webglTexture;
      if (g && !this.packed.needsUpdate) this.uploadedOnce = true;
    }
  }

  levelCounts(): number[] {
    const c = new Array(LEVELS).fill(0);
    let n = 0;
    for (const t of this.city.tiles) if (t.level >= 0) { c[t.level] += t.exact[t.level]; n++; }
    return c;
  }
  liveTiles(): number { let n = 0; for (const t of this.city.tiles) if (t.level >= 0) n++; return n; }
}

export { CELLS };
