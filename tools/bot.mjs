// Plays every run from its recorded script inside the real page (real View, real game loop
// code path) and proves it finishes. Saves a picture of each result screen.
// node tools/bot.mjs [--out out/bot] [--every N]   (N > 0 also renders every N ticks: slow)
import path from 'node:path';
import { launch, serveDist, openPage, grabLow, writePng, upscale } from './lib/browser.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('--out', 'out/bot'), every = Number(arg('--every', '0'));
const L = await launch({});
const S = await serveDist();
let bad = 0;
try {
  const { page, errors } = await openPage(`${S.url}?manual&run=0`, L, { timeout: 120000 });
  const n = await page.evaluate(() => { let i = 0; while (window.__wl.game.scriptFor(i)) i++; return i; }).catch(() => 6);
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate(async ([i, every]) => {
      const g = window.__wl.game;
      g.pick(i);
      await g.play(g.scriptFor(i), every);
      const s = g.state();
      return { mode: g.mode(), finished: !!s.finished, seconds: s.tick / 120, fill: g.fill() };
    }, [i, every]);
    const ok = r.finished && r.mode === 'done';
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} run ${i + 1}: ${r.seconds.toFixed(1)} s, fill ${(r.fill * 100).toFixed(0)}%, mode ${r.mode}`);
    await page.evaluate(() => window.__wl.view.settle());
    await page.screenshot({ path: path.join(out, `run${i + 1}-done.png`) });
  }
  if (errors.length) { bad++; console.log('page errors:', errors.slice(0, 5)); }
} finally { await L.browser.close(); await S.close(); }
process.exit(bad ? 1 : 0);
