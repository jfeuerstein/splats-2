// Shared headless-browser helpers for Washline tools (shoot, touch, bot).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function loadPlaywright() {
  try {
    return createRequire('/opt/node-tools/node_modules/playwright/')('playwright');
  } catch {}
  try { return createRequire('/opt/node-tools/node_modules/playwright/package.json')('playwright'); } catch {}
  return await import('playwright');
}

export const CHROMIUM_ARGS = [
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
];
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

/** Launch Chromium with a mobile/touch context. Returns { browser, context, close }. */
export async function launch({ size = [390, 844], dpr = 3 } = {}) {
  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const context = await browser.newContext({
    viewport: { width: size[0], height: size[1] },
    deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: MOBILE_UA,
  });
  return { browser, context, close: () => browser.close() };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.ply': 'application/octet-stream',
};

/** Static file server for a directory (default dist/). Returns { url, close }. */
export async function serveDist(dir = path.join(REPO, 'dist'), { build = false } = {}) {
  if (dir === path.join(REPO, 'dist') && (build || !fs.existsSync(path.join(dir, 'index.html')))) {
    console.log('[shoot] running npx vite build ...');
    const r = spawnSync('npx', ['vite', 'build'], { cwd: REPO, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('vite build failed (exit ' + r.status + ')');
  }
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Open a page and wait for window.__wl (+ its ready promise).
 * Returns { page, logs, errors }. Throws Error with .logs on failure.
 */
export async function openPage(url, launched, { timeout = 60000, evalJs = '' } = {}) {
  const page = await launched.context.newPage();
  const logs = [], errors = [];
  page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => { const s = 'pageerror: ' + (e.stack || e.message); logs.push(s); errors.push(s); });
  const fail = (msg) => { const e = new Error(msg); e.logs = logs.slice(-30); e.errors = errors; return e; };
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  try {
    await page.waitForFunction(() => !!window.__wl, null, { timeout });
  } catch { throw fail('window.__wl never appeared'); }
  const ok = await page.evaluate(async (t) => {
    return await Promise.race([
      Promise.resolve(window.__wl.ready).then(() => true),
      new Promise((r) => setTimeout(() => r(false), t)),
    ]);
  }, timeout).catch((e) => { throw fail('ready failed: ' + e.message); });
  if (!ok) throw fail('readiness timed out after ' + timeout + ' ms');
  if (evalJs) await page.evaluate(evalJs);
  return { page, logs, errors };
}

export async function glInfo(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  });
}

/** Grab the low-res final image. Returns { w, h, rgba: Buffer } with row 0 = top. */
export async function grabLow(page, { flipY = false } = {}) {
  const g = await page.evaluate(() => window.__wl.grab());
  const rgba = Buffer.from(g.rgba, 'base64');
  if (rgba.length !== g.w * g.h * 4) throw new Error(`grab size mismatch: ${rgba.length} vs ${g.w}x${g.h}x4`);
  if (flipY) {
    const row = g.w * 4, out = Buffer.alloc(rgba.length);
    for (let y = 0; y < g.h; y++) rgba.copy(out, y * row, (g.h - 1 - y) * row, (g.h - y) * row);
    return { w: g.w, h: g.h, rgba: out };
  }
  return { w: g.w, h: g.h, rgba };
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function writePng(file, w, h, rgba) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, encodePng(w, h, rgba));
}

/** Nearest-neighbour integer upscale. Returns { w, h, rgba }. */
export function upscale(rgba, w, h, k) {
  const W = w * k, H = h * k, out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < W; x++) rgba.copy(out, (y * W + x) * 4, (sy * w + Math.floor(x / k)) * 4, (sy * w + Math.floor(x / k)) * 4 + 4);
  }
  return { w: W, h: H, rgba: out };
}
