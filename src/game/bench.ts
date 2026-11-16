// In-game benchmark. Headless numbers say nothing about the phone, so this runs on the
// device: the bot flies run 1 at several splat budgets while frame times are recorded.
import { T } from "../tuning";
import type { SimWorld } from "../sim/world";

interface BenchGame {
  view: { setBudget(n: number): void; stats(): { live: number; budget: number; lowW: number; lowH: number } };
  pick(i: number): void;
  setAuto(on: boolean): void;
  onFrame(f: ((dt: number) => void) | null): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runBenchmark(game: BenchGame, _w: SimWorld, budgets = [40, 70, 100, 150, 200, 300]): Promise<string> {
  const lines: string[] = [];
  const st0 = game.view.stats();
  lines.push(`Washline benchmark · ${st0.lowW}x${st0.lowH} · dpr ${devicePixelRatio} · ${navigator.userAgent.replace(/^.*?\((.*?)\).*$/, "$1")}`);
  lines.push("budget  live   fps   p50ms p95ms p99ms max  >20ms");
  let best = 0;
  game.setAuto(true);
  for (const b of budgets) {
    game.view.setBudget(b * 1000);
    game.pick(0);
    await wait(1500); // settle: tiles fill, sort catches up
    const dts: number[] = [];
    let live = 0;
    game.onFrame((dt) => { dts.push(dt * 1000); live = Math.max(live, game.view.stats().live); });
    await wait(5000);
    game.onFrame(null);
    if (dts.length < 10) { lines.push(`${b}k: no frames`); continue; }
    dts.sort((a, c) => a - c);
    const pct = (p: number) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
    const mean = dts.reduce((a, c) => a + c, 0) / dts.length;
    const slow = dts.filter((v) => v > 20).length;
    lines.push(`${String(b).padStart(4)}k ${String(Math.round(live / 1000)).padStart(4)}k ${(1000 / mean).toFixed(1).padStart(6)} ${pct(0.5).toFixed(1).padStart(5)} ${pct(0.95).toFixed(1).padStart(5)} ${pct(0.99).toFixed(1).padStart(5)} ${pct(1).toFixed(0).padStart(4)} ${String(slow).padStart(4)}`);
    if (pct(0.95) <= 18.5) best = b;
    // No point going higher once it is clearly failing.
    if (pct(0.5) > 25) break;
  }
  game.setAuto(false);
  game.view.setBudget(T.budget * 1000);
  game.pick(0);
  lines.push(best ? `Highest budget holding 60 fps (p95 ≤ 18.5 ms): ${best}k. Current setting: ${T.budget}k.` : "No budget held 60 fps. Report this: the splat approach may need rethinking.");
  lines.push("Select all of this text and send it back.");
  return lines.join("\n");
}
