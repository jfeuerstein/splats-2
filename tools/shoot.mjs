#!/usr/bin/env node
// Headless screenshot / frame-sequence tool. See --help.
import fs from 'node:fs';
import path from 'node:path';
import { launch, serveDist, openPage, grabLow, writePng, upscale, glInfo } from './lib/browser.mjs';

const HELP = `Usage: node tools/shoot.mjs [options]
  --url <base>        base URL (default: build dist/ if missing and serve it locally)
  --build             force 'npx vite build' before serving dist/
  --query "a=b&c=d"   URL params (default "spike=1&auto=0")
  --size WxH          CSS px viewport (default 390x844)    --dpr <n> (default 3)
  --still s[,s...]    per s: frame(s), save still-<s>.png (device px) + still-<s>-low.png (grab x4)
  --seq from:to:step  consecutive frames; writes seq-<from>-<to>.png (contact sheet, 2x, <=32 frames),
                      seq-<from>-<to>-flicker.png (heat, 4x), seq-<from>-<to>-metrics.json
  --frames            with --seq: also frame-NNN.png (4x) for every frame
  --flipY             flip grab() vertically (use if grab() rows are bottom-up)
  --out <dir>         output dir (default out/shots)
  --wait <ms>         settle wait after each frame (default 0)
  --timeout <ms>      page readiness timeout (default 60000)
  --eval "<js>"       JS evaluated in the page after ready
  --help
Flicker metric: flickerRate = mean over t of fraction of pixels with f[t-1]==f[t+1] != f[t];
changeRate = mean fraction differing between consecutive frames; ratio = flicker/change.`;

const argv = process.argv.slice(2);
const opt = { url: '', query: 'spike=1&auto=0', size: '390x844', dpr: 3, out: 'out/shots', wait: 0, timeout: 60000, still: '', seq: '', eval: '' };
const bools = new Set(['build', 'frames', 'flipY', 'help']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { console.error('unexpected arg ' + a); process.exit(2); }
  const k = a.slice(2);
  if (bools.has(k)) opt[k] = true; else if (k in opt) opt[k] = argv[++i]; else { console.error('unknown option ' + a); process.exit(2); }
}
if (opt.help || argv.length === 0) { console.log(HELP); process.exit(0); }
if (!opt.still && !opt.seq) { console.error('nothing to do: give --still and/or --seq\n'); console.log(HELP); process.exit(2); }

const [sw, sh] = opt.size.split('x').map(Number);
const dpr = Number(opt.dpr), wait = Number(opt.wait), timeout = Number(opt.timeout);
const out = path.resolve(opt.out);
fs.mkdirSync(out, { recursive: true });
const fmt = (n) => String(+n.toFixed(4));
const key = (px, i) => (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];

let server, launched, ctx = { logs: [], errors: [] };
let code = 0;
try {
  let base = opt.url;
  if (!base) { server = await serveDist(undefined, { build: !!opt.build }); base = server.url; }
  launched = await launch({ size: [sw, sh], dpr });
  const url = new URL(base);
  for (const [k, v] of new URLSearchParams(opt.query)) url.searchParams.set(k, v);
  const t0 = Date.now();
  const { page, logs, errors } = await openPage(url.toString(), launched, { timeout, evalJs: opt.eval }).catch((e) => { ctx = e; throw e; });
  ctx = { logs, errors };
  console.log('[shoot] page ready in', Date.now() - t0, 'ms;', JSON.stringify(await glInfo(page)));
  const settle = async () => { if (wait > 0) await page.waitForTimeout(wait); };
  const grab = () => grabLow(page, { flipY: !!opt.flipY });

  if (opt.still) {
    for (const s of opt.still.split(',').map((x) => x.trim()).filter(Boolean)) {
      await page.evaluate((v) => window.__wl.frame(v), Number(s)); await settle();
      await page.screenshot({ path: path.join(out, `still-${s}.png`), fullPage: true });
      const g = await grab(); const u = upscale(g.rgba, g.w, g.h, 4);
      writePng(path.join(out, `still-${s}-low.png`), u.w, u.h, u.rgba);
      console.log(`[shoot] still ${s}: low-res ${g.w}x${g.h}`);
    }
  }

  if (opt.seq) {
    const [from, to, step] = opt.seq.split(':').map(Number);
    if (![from, to, step].every(Number.isFinite) || !(step > 0) || to < from) throw new Error('bad --seq, want from:to:step');
    const ss = []; for (let s = from; s <= to + 1e-9; s += step) ss.push(+s.toFixed(6));
    const frames = [];
    for (const s of ss) {
      await page.evaluate((v) => window.__wl.frame(v), s); await settle();
      frames.push(await grab());
    }
    const { w, h } = frames[0], n = frames.length, np = w * h;
    const tag = `seq-${opt.seq.split(':').slice(0, 2).join('-')}`;
    // metrics
    const flickerCount = new Uint32Array(np);
    const flickerPer = [], changePer = [], colours = new Set();
    for (const f of frames) for (let i = 0; i < np; i++) colours.add(key(f.rgba, i * 4));
    for (let t = 1; t < n; t++) {
      let c = 0;
      for (let i = 0; i < np; i++) if (key(frames[t - 1].rgba, i * 4) !== key(frames[t].rgba, i * 4)) c++;
      changePer.push(c / np);
    }
    for (let t = 1; t < n - 1; t++) {
      let c = 0;
      for (let i = 0; i < np; i++) {
        const a = key(frames[t - 1].rgba, i * 4), b = key(frames[t].rgba, i * 4), d = key(frames[t + 1].rgba, i * 4);
        if (a === d && b !== a) { c++; flickerCount[i]++; }
      }
      flickerPer.push(c / np);
    }
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const flickerRate = mean(flickerPer), changeRate = mean(changePer);
    const stats = await page.evaluate(() => { try { return window.__wl.stats(); } catch (e) { return { error: String(e) }; } });
    const metrics = {
      frames: n, size: { w, h }, from, to, step, flickerRate, changeRate,
      ratio: changeRate > 0 ? flickerRate / changeRate : null,
      distinctColours: colours.size, flickerPerFrame: flickerPer, changePerFrame: changePer, stats,
    };
    fs.writeFileSync(path.join(out, `${tag}-metrics.json`), JSON.stringify(metrics, null, 1));
    // contact sheet
    const cap = Math.min(n, 32), cols = Math.min(8, cap), rows = Math.ceil(cap / cols), k = 2, gap = 2;
    const SW = cols * (w * k + gap) + gap, SH = rows * (h * k + gap) + gap;
    const sheet = Buffer.alloc(SW * SH * 4);
    for (let i = 0; i < sheet.length; i += 4) { sheet[i] = 40; sheet[i + 1] = 40; sheet[i + 2] = 48; sheet[i + 3] = 255; }
    for (let f = 0; f < cap; f++) {
      const u = upscale(frames[f].rgba, w, h, k);
      const ox = gap + (f % cols) * (w * k + gap), oy = gap + Math.floor(f / cols) * (h * k + gap);
      for (let y = 0; y < u.h; y++) u.rgba.copy(sheet, ((oy + y) * SW + ox) * 4, y * u.w * 4, (y + 1) * u.w * 4);
    }
    writePng(path.join(out, `${tag}.png`), SW, SH, sheet);
    // flicker heat
    const heat = Buffer.alloc(np * 4); const mx = Math.max(1, ...flickerCount);
    for (let i = 0; i < np; i++) { const v = Math.round((flickerCount[i] / mx) * 255); heat[i * 4] = heat[i * 4 + 1] = heat[i * 4 + 2] = v; heat[i * 4 + 3] = 255; }
    const hu = upscale(heat, w, h, 4); writePng(path.join(out, `${tag}-flicker.png`), hu.w, hu.h, hu.rgba);
    if (opt.frames) frames.forEach((f, i) => { const u = upscale(f.rgba, w, h, 4); writePng(path.join(out, `frame-${String(i).padStart(3, '0')}.png`), u.w, u.h, u.rgba); });
    console.log(`[shoot] seq ${n} frames ${w}x${h}: flickerRate=${fmt(flickerRate)} changeRate=${fmt(changeRate)} ratio=${metrics.ratio === null ? 'n/a' : fmt(metrics.ratio)} distinctColours=${colours.size}`);
    console.log('[shoot] stats', JSON.stringify(stats));
  }
  if (errors.length) { console.error('[shoot] page errors:\n' + errors.join('\n')); code = 1; }
  console.log('[shoot] output in', out);
} catch (e) {
  console.error('[shoot] FAILED:', e.message);
  const l = (e.logs || ctx.logs || []).slice(-30);
  if (l.length) console.error('--- last console lines ---\n' + l.join('\n'));
  code = 1;
} finally {
  try { await launched?.close(); } catch {}
  try { await server?.close(); } catch {}
}
process.exit(code);
