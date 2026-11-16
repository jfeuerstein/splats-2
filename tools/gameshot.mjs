// Plays a run from its recorded script in the real page and saves frames.
// node tools/gameshot.mjs [run=0] [from=600] [count=16] [stepTicks=2] [out=out/game]
import path from 'node:path';
import { launch, serveDist, openPage, grabLow, writePng, upscale } from './lib/browser.mjs';
const [run = '0', from = '600', count = '16', step = '2', out = 'out/game'] = process.argv.slice(2);
const L = await launch({});
const S = await serveDist();
try {
  const { page, errors } = await openPage(`${S.url}?manual&run=${run}`, L, { timeout: 120000 });
  const script = await page.evaluate(async (r) => (await window.__wl.game.scriptFor?.(r)) ?? null, Number(run));
  await page.evaluate(([r]) => { window.__wl.game.pick(r); }, [Number(run)]);
  // replay script by ticks
  const sc = script;
  if (!sc) throw new Error('no scriptFor');
  let tick = 0; const frames = [];
  const adv = async (n, h, l) => { await page.evaluate(([n, h, l]) => window.__wl.game.advance(n, h, l), [n, h, l]); tick += n; };
  const want = []; for (let i = 0; i < Number(count); i++) want.push(Number(from) + i * Number(step));
  let wi = 0;
  for (let i = 0; i < sc.length && wi < want.length; i += 3) {
    let n = sc[i]; const h = !!sc[i + 1], l = sc[i + 2] / 100;
    while (n > 0 && wi < want.length) {
      const k = Math.min(n, want[wi] - tick);
      if (k > 0) { await adv(k, h, l); n -= k; }
      if (tick === want[wi]) { await page.evaluate(() => window.__wl.view.settle()); await page.evaluate(() => window.__wl.game.draw()); await page.evaluate(() => window.__wl.view.settle()); frames.push(await grabLow(page)); wi++; }
    }
  }
  const { w, h } = frames[0]; const cols = Math.min(8, frames.length), rows = Math.ceil(frames.length / cols), k = 2;
  const W = cols * w * k, H = rows * h * k, sheet = Buffer.alloc(W * H * 4, 255);
  frames.forEach((f, i) => { const u = upscale(f.rgba, w, h, k); const ox = (i % cols) * w * k, oy = Math.floor(i / cols) * h * k; for (let y = 0; y < u.h; y++) u.rgba.copy(sheet, ((oy + y) * W + ox) * 4, y * u.w * 4, (y + 1) * u.w * 4); });
  writePng(path.join(out, `run${run}-${from}.png`), W, H, sheet);
  const u = upscale(frames[frames.length - 1].rgba, w, h, 4); writePng(path.join(out, `run${run}-${from}-last.png`), u.w, u.h, u.rgba);
  await page.screenshot({ path: path.join(out, `run${run}-${from}-page.png`) });
  console.log('frames', frames.length, 'errors', errors.length, errors.slice(0, 3), await page.evaluate(() => JSON.stringify(window.__wl.stats())));
} finally { await L.browser.close(); await S.close(); }
