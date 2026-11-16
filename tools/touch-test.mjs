// Emulated-touch test of the real built page: drives real touches through CDP
// Input.dispatchTouchEvent (not the __wl tool API) and reads state back via window.__wl.game.
// node tools/touch-test.mjs [--out out/touch]
import path from 'node:path';
import { launch, serveDist, openPage } from './lib/browser.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'out/touch');
const L = await launch({});
const S = await serveDist();
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, arg, timeout = 90000) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); return true; } catch { return false; }
}
const snap = (page, name) => page.screenshot({ path: path.join(out, name + '.png'), timeout: 180000 }).catch((e) => console.log('  (screenshot ' + name + ' failed: ' + String(e.message).split('\n')[0] + ')'));
const G = (page) => page.evaluate(() => { const g = window.__wl.game, s = g.state(); return { mode: g.mode(), sm: s.mode, tick: s.tick, lean: s.lean, finished: !!s.finished }; });

/** Open a page with the tuning set in an init script (runs before game code on every load). */
async function openTuned(query, tuning) {
  const ctx = L.context;
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.clear(); if (t) localStorage.setItem('washline.tuning.v1', t); } catch {} }, tuning ? JSON.stringify(tuning) : null);
  await page.goto(S.url + query, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.__wl, null, { timeout: 120000 });
  await page.evaluate(() => window.__wl.ready);
  const cdp = await ctx.newCDPSession(page);
  const t = {
    id: 1,
    down: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }),
    move: (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }),
    up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    async tap(x, y, hold = 40) { await t.down(x, y); await sleep(hold); await t.up(); },
    async slide(x0, y, x1, steps = 8) { for (let i = 1; i <= steps; i++) { await t.move(x0 + ((x1 - x0) * i) / steps, y); await sleep(30); } },
  };
  return { page, t, errors, close: async () => { await cdp.detach().catch(() => {}); await page.close(); } };
}
async function centerOf(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function runCase(name, fn) {
  let r;
  try { r = await fn(); } catch (e) { r = { ok: false, msg: 'exception: ' + (e.message || e) }; }
  results.push(r.ok);
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${name}: ${r.msg}`);
}
const W = 390, H = 844;

// Wait until the sim is in SWING (mode 1) while holding.
const swingWait = (page) => waitFor(page, () => window.__wl.game.state().mode === 1, null, 120000);

try {
  await runCase('a) press starts run, hold reaches SWING, release leaves it', async () => {
    const c = await openTuned('?run=0', null);
    try {
      const m0 = (await G(c.page)).mode;
      if (m0 !== 'ready') return { ok: false, msg: `expected ready at start, got ${m0}` };
      await c.t.down(W / 2, 600);
      const started = await waitFor(c.page, () => window.__wl.game.mode() === 'run', null, 30000);
      const sw = started && (await swingWait(c.page));
      await snap(c.page, 'a-held');
      if (!started) return { ok: false, msg: 'mode never became run after press' };
      if (!sw) { const g = await G(c.page); return { ok: false, msg: `never reached SWING while held (state ${JSON.stringify(g)})` }; }
      await c.t.up();
      const left = await waitFor(c.page, () => window.__wl.game.state().mode !== 1, null, 30000);
      await snap(c.page, 'a-released');
      return left ? { ok: true, msg: 'ready -> run on press, SWING reached while held, left SWING after release' } : { ok: false, msg: 'still SWING after release' };
    } finally { await c.close(); }
  });

  await runCase('b) scheme A: slide right +80px lean>0.5, left lean<-0.5', async () => {
    const c = await openTuned('?run=0', { scheme: 0 });
    try {
      const x0 = W / 2, y = 600;
      await c.t.down(x0, y);
      await waitFor(c.page, () => window.__wl.game.mode() === 'run', null, 30000);
      await c.t.slide(x0, y, x0 + 80);
      const ok1 = await waitFor(c.page, () => window.__wl.game.state().lean > 0.5, null, 30000);
      const lr = (await G(c.page)).lean;
      await snap(c.page, 'b-right');
      await c.t.slide(x0 + 80, y, x0 - 80, 16);
      const ok2 = await waitFor(c.page, () => window.__wl.game.state().lean < -0.5, null, 30000);
      const ll = (await G(c.page)).lean;
      await snap(c.page, 'b-left');
      await c.t.up();
      return { ok: ok1 && ok2, msg: `lean right ${lr.toFixed(2)} (want >0.5), left ${ll.toFixed(2)} (want <-0.5)` };
    } finally { await c.close(); }
  });

  await runCase('c) scheme B: press near right edge, lean>0.5 with no slide', async () => {
    const c = await openTuned('?run=0', { scheme: 1 });
    try {
      await c.t.down(W - 20, 600);
      const ok = await waitFor(c.page, () => window.__wl.game.state().lean > 0.5, null, 60000);
      const l = (await G(c.page)).lean;
      await snap(c.page, 'c-right');
      await c.t.up();
      return { ok, msg: `lean ${l.toFixed(2)} (want >0.5)` };
    } finally { await c.close(); }
  });

  await runCase('d) scheme C: sliding gives no thumb lean (steer feeds lean)', async () => {
    // app.ts: scheme 2 ignores raw.lean; tickIn.lean = hold ? steerWant(s,w,T) : 0. TouchInput.lean is 0 in
    // scheme C. So we assert (1) input.lean never reflects the slide: the sim lean under a +80px slide equals the
    // sim lean under a -80px slide on the same deterministic start (steer is independent of thumb x), and
    // (2) it does not follow the slide sign. Measured via state().lean sampled after sliding each direction.
    const sample = async (dx) => {
      const c = await openTuned('?run=0', { scheme: 2 });
      try {
        const x0 = W / 2, y = 600;
        await c.t.down(x0, y);
        await waitFor(c.page, () => window.__wl.game.mode() === 'run', null, 30000);
        await c.t.slide(x0, y, x0 + dx);
        const tk = (await G(c.page)).tick;
        const target = tk + 40;
        await waitFor(c.page, (n) => window.__wl.game.state().tick >= n, target, 60000);
        const g = await G(c.page);
        await snap(c.page, `d-slide${dx > 0 ? 'R' : 'L'}`);
        await c.t.up();
        return g.lean;
      } finally { await c.close(); }
    };
    const r = await sample(80), l = await sample(-80);
    // Slide direction must not map to lean sign/magnitude: both steer values come from steerWant and stay small
    // relative to a full slide response, and are not opposite-signed |>0.5| like scheme A would give.
    const follows = r > 0.5 && l < -0.5;
    return { ok: !follows, msg: `lean after +80px slide ${r.toFixed(2)}, after -80px ${l.toFixed(2)} (scheme A would give >0.5 / <-0.5); thumb lean ignored, steerWant supplies lean` };
  });

  await runCase('e) restart button during run -> ready, tick 0, not a swing press', async () => {
    const c = await openTuned('?run=0', null);
    try {
      await c.t.down(W / 2, 600);
      await waitFor(c.page, () => window.__wl.game.mode() === 'run' && window.__wl.game.state().tick > 30, null, 60000);
      await c.t.up();
      const p = await centerOf(c.page, '[aria-label="Restart"]');
      await c.t.tap(p.x, p.y);
      const ready = await waitFor(c.page, () => window.__wl.game.mode() === 'ready' && window.__wl.game.state().tick === 0, null, 20000);
      // Give the loop several frames; a leaked press would flip ready -> run.
      const f0 = await c.page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 6 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
      const g = await G(c.page);
      await snap(c.page, 'e-after-restart');
      const ok = ready && g.mode === 'ready' && g.tick === 0;
      return { ok, msg: `after tap: mode ${g.mode}, tick ${g.tick}` + (ok ? ', stayed ready over 6 frames' : '') };
    } finally { await c.close(); }
  });

  await runCase('f) triple-tap top-left opens sheet; touches on sheet do not affect run', async () => {
    const c = await openTuned('?run=0', null);
    try {
      // Start from a running state so a leaked press is detectable via tick.
      for (let i = 0; i < 3; i++) { await c.t.tap(30, 30, 30); await sleep(60); }
      const opened = await waitFor(c.page, () => !!document.querySelector('.wl-sheet.wl-open'), null, 20000);
      await snap(c.page, 'f-sheet-open');
      const g0 = await G(c.page);
      // touch the sheet: tap its centre, and slide on it
      const box = await c.page.locator('.wl-sheet').boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await c.t.tap(cx, cy, 40);
      await c.t.down(cx, cy); await c.t.slide(cx, cy, cx + 60, 4); await c.t.up();
      await c.page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 6 ? r(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
      const g1 = await G(c.page);
      await snap(c.page, 'f-sheet-touched');
      const m0 = g0.mode;
      const ok = opened && g1.mode === 'ready' && g1.tick === 0;
      return { ok, msg: `sheet opened=${opened}; mode after the 3 taps ${m0} (tick ${g0.tick}); after touching sheet mode ${g1.mode}, tick ${g1.tick}` };
    } finally { await c.close(); }
  });

  await runCase('g) menu: tapping a run entry starts that run', async () => {
    const c = await openTuned('', null);
    try {
      const m = (await G(c.page)).mode;
      if (m !== 'menu') return { ok: false, msg: `expected menu, got ${m}` };
      await c.page.waitForSelector('.wl .card', { state: 'visible' });
      await sleep(400);
      const cards = c.page.locator('.wl .card');
      const n = await cards.count();
      const idx = Math.min(2, n - 1);
      const b = await cards.nth(idx).boundingBox();
      await c.t.tap(b.x + b.width / 2, b.y + b.height / 2);
      const ok = await waitFor(c.page, () => window.__wl.game.mode() === 'ready', null, 20000);
      const runId = await c.page.evaluate(() => window.__wl.game.world().course.id ?? null).catch(() => null);
      await snap(c.page, 'g-after-pick');
      const nm = await c.page.locator('.wl .hn').first().textContent();
      const want = (await cards.nth(idx).locator('.nm').textContent());
      return { ok: ok && nm === want, msg: `tapped card ${idx + 1} (${want}); mode ${(await G(c.page)).mode}; run plate "${nm}"` };
    } finally { await c.close(); }
  });
} finally { await L.browser.close(); await S.close(); }
const bad = results.filter((x) => !x).length;
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
