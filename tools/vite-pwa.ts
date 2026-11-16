// Small Vite plugin: generates icons (pixel art, in code), manifest.webmanifest and sw.js.
// No asset files in the repo. All URLs are relative so it works under any sub-path.
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { Plugin } from "vite";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGB (opaque) PNG encoder. */
function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * stride + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const P = {
  paper: "#f4efe6", cream: "#e3dccf", sky: "#bfe3ee", sky2: "#8fcbe6", terra: "#d9623b", orange: "#f0a23a",
  yellow: "#f7d354", green: "#5fb56a", teal: "#2f9c95", blue: "#3b6fc4", indigo: "#2b2a4a", pink: "#e0568c",
};
const hex = (s: string): [number, number, number] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** Draw the scene on an N x N grid; the design lives in a 36x36 box offset by `pad` cells. */
function drawGrid(n: number, pad: number): string[][] {
  const g: string[][] = Array.from({ length: n }, (_, y) => Array.from({ length: n }, () => (y < n * 0.62 ? P.sky : P.sky2)));
  const set = (x: number, y: number, c: string) => { x += pad; y += pad; if (x >= 0 && y >= 0 && x < n && y < n) g[y][x] = c; };
  const rect = (x0: number, y0: number, w: number, h: number, c: string) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c); };
  // Buildings, extended past the 36 box so the maskable variant has no gaps.
  rect(-pad, 9, 8 + pad, 36 + pad, P.cream);
  rect(-pad, 9, 8 + pad, 1, P.paper);
  rect(28, 12, 8 + pad, 36 + pad, P.cream);
  rect(28, 12, 8 + pad, 1, P.paper);
  for (const wy of [14, 20, 26]) { rect(2, wy, 3, 3, P.sky2); rect(31, wy + 2, 3, 3, P.sky2); }
  rect(-pad, 34, 8 + pad, 2 + pad, P.paper); rect(28, 34, 8 + pad, 2 + pad, P.paper);
  // Sagging line from (8,11) to (28,13).
  const ly = (x: number) => Math.round(11 + (x - 8) * 0.1 + 6 * Math.sin(((x - 8) / 20) * Math.PI));
  for (let x = 8; x < 28; x++) set(x, ly(x), P.indigo);
  // Laundry (3x3, hung below the line).
  const laundry: [number, string][] = [[10, P.terra], [14, P.yellow], [23, P.teal], [26, P.pink]];
  for (const [x, c] of laundry) { rect(x, ly(x) + 1, 3, 3, c); set(x + 1, ly(x), P.indigo); }
  // Rope + swinging figure.
  const rx = 19;
  for (let y = ly(rx) + 1; y < 26; y++) set(rx, y, P.indigo);
  set(rx + 1, 24, P.indigo); set(rx - 1, 24, P.indigo);
  rect(rx - 1, 26, 3, 2, P.indigo);         // head
  rect(rx - 1, 28, 3, 3, P.indigo);         // body
  set(rx - 2, 29, P.indigo); set(rx + 2, 27, P.indigo); // arms
  set(rx - 1, 31, P.indigo); set(rx + 2, 31, P.indigo); // legs
  set(rx, 26, P.orange); set(rx + 1, 26, P.orange);     // face/scarf accent
  return g;
}

function renderIcon(size: number, grid: number, pad: number): Buffer {
  const g = drawGrid(grid, pad);
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    const gy = Math.min(grid - 1, Math.floor((y * grid) / size));
    for (let x = 0; x < size; x++) {
      const [r, gg, b] = hex(g[gy][Math.min(grid - 1, Math.floor((x * grid) / size))]);
      const i = (y * size + x) * 3; rgb[i] = r; rgb[i + 1] = gg; rgb[i + 2] = b;
    }
  }
  return encodePng(size, size, rgb);
}

const ICONS: Record<string, () => Buffer> = {
  "icon-180.png": () => renderIcon(180, 36, 0),
  "icon-192.png": () => renderIcon(192, 36, 0),
  "icon-512.png": () => renderIcon(512, 36, 0),
  // Maskable: same art on a 44 grid with the 36 design centred (inside the 80% safe zone).
  "icon-512-maskable.png": () => renderIcon(512, 44, 4),
};

const MANIFEST = {
  name: "Washline", short_name: "Washline", display: "standalone", orientation: "portrait",
  start_url: "./", scope: "./", background_color: "#f4efe6", theme_color: "#f4efe6",
  icons: [
    { src: "./icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "./icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

function swSource(files: string[], version: string): string {
  return `// Generated at build time. Cache name changes with every distinct build.
const CACHE = "washline-${version}";
const FILES = ${JSON.stringify(files)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // The page itself comes from the network when there is one (3 s limit), so a new
    // build is picked up at the next launch instead of being pinned by the cache.
    if (req.mode === "navigate") {
      try {
        const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(no, 3000))]);
        if (res && res.ok) { cache.put("./index.html", res.clone()).catch(() => {}); return res; }
      } catch (err) { /* offline or slow: fall through to the cache */ }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      if (req.mode === "navigate") {
        const page = await cache.match("./index.html", { ignoreSearch: true }) || await cache.match("./", { ignoreSearch: true });
        if (page) return page;
      }
      throw err;
    }
  })());
});
`;
}

export function pwa(): Plugin {
  const types: Record<string, string> = { "manifest.webmanifest": "application/manifest+json" };
  return {
    name: "washline-pwa",
    enforce: "post",
    configureServer(server) {
      const cache = new Map<string, Buffer>();
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? "").split("?")[0].split("/").pop() ?? "";
        if (ICONS[name]) {
          if (!cache.has(name)) cache.set(name, ICONS[name]());
          res.setHeader("Content-Type", "image/png"); res.end(cache.get(name)); return;
        }
        if (name === "manifest.webmanifest") { res.setHeader("Content-Type", types[name]); res.end(JSON.stringify(MANIFEST)); return; }
        next();
      });
    },
    generateBundle(_o, bundle) {
      for (const [name, make] of Object.entries(ICONS)) this.emitFile({ type: "asset", fileName: name, source: make() });
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(MANIFEST, null, 2) });
      const files = ["./", ...[...Object.keys(bundle), ...Object.keys(ICONS), "manifest.webmanifest"].map((f) => "./" + f)];
      const uniq = [...new Set(files)].sort();
      const version = createHash("sha256").update(uniq.join("\n")).update(
        Object.values(bundle).map((b) => (b.type === "chunk" ? b.code : typeof b.source === "string" ? b.source : Buffer.from(b.source))).map((s) => createHash("sha256").update(s).digest("hex")).join("")
      ).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: swSource(uniq, version) });
    },
  };
}
