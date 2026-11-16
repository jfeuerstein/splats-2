// Offline shell check on the real build: load once online, wait for the service worker to activate and
// precache, go offline, reload, confirm the game boots from the cache.
// node tools/offline-test.mjs [--out out/offline]
import path from 'node:path';
import fs from 'node:fs';
import { launch, serveDist, openPage, grabLow, writePng } from './lib/browser.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'out/offline');
fs.mkdirSync(out, { recursive: true });
const L = await launch({});
const S = await serveDist();
const origin = new URL(S.url).origin;
let bad = 0;
const check = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
try {
  const online = [];
  const onReq = (list) => (r) => list.push(r.url());
  L.context.on('request', onReq(online));
  const { page } = await openPage(`${S.url}?run=0`, L, { timeout: 120000 });
  // Wait for the SW to be active and controlling-ready, and the precache to hold every listed file.
  const info = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const deadline = Date.now() + 60000;
    const sw = await (await fetch('./sw.js', { cache: 'no-store' })).text();
    const files = JSON.parse(/const FILES = (\[.*?\]);/s.exec(sw)[1]);
    const cacheName = /const CACHE = "(.*?)"/.exec(sw)[1];
    let have = 0;
    while (Date.now() < deadline) {
      const c = await caches.open(cacheName);
      have = (await c.keys()).length;
      if (reg.active && have >= files.length) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return { state: reg.active && reg.active.state, files: files.length, have, cacheName };
  });
  check(info.state === 'activated' && info.have >= info.files, `service worker ${info.state}, precache ${info.have}/${info.files} (${info.cacheName})`);
  const offOrigin = [...new Set(online)].filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  console.log(`online requests (${new Set(online).size} unique):`);
  for (const u of [...new Set(online)]) console.log('  ' + u.replace(origin, ''));
  check(offOrigin.length === 0, offOrigin.length ? `cross-origin requests: ${offOrigin.join(', ')}` : 'no requests to another origin');
  await page.close();

  await L.context.setOffline(true);
  const failed = [], offReqs = [];
  const p2 = await L.context.newPage();
  p2.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  p2.on('request', (r) => offReqs.push(r.url()));
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(`${S.url}?run=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let boot = true;
  try { await p2.waitForFunction(() => !!window.__wl, null, { timeout: 120000 }); await p2.evaluate(() => window.__wl.ready); } catch { boot = false; }
  check(boot, 'window.__wl appeared while offline');
  check(failed.length === 0, failed.length ? 'failed requests: ' + failed.join('; ') : `no failed requests (${offReqs.length} requests, served by SW)`);
  check(errs.length === 0, errs.length ? 'page errors: ' + errs.join('; ') : 'no page errors');
  if (boot) {
    await p2.evaluate(() => window.__wl.view.settle());
    const g = await grabLow(p2);
    let distinct = new Set();
    for (let i = 0; i < g.rgba.length; i += 4) distinct.add(g.rgba.readUInt32LE(i));
    writePng(path.join(out, 'offline-grab.png'), g.w, g.h, g.rgba);
    check(distinct.size > 8, `canvas non-blank: ${g.w}x${g.h}, ${distinct.size} distinct colours`);
    await p2.screenshot({ path: path.join(out, 'offline-page.png'), timeout: 120000 }).catch(() => {});
  }
} finally { await L.browser.close(); await S.close(); }
process.exit(bad ? 1 : 0);
