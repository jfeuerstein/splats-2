// Dev helper: npx vite-node tools/simtry.ts [courseIndex] [-v] — bot run summary per course.
import { defaults } from "../src/tuning";
import { district, courseWorld } from "../src/world/district";
import { runBot } from "../src/sim/bot";
import { initState, step } from "../src/sim/sim";
const T = defaults();
const d = district();
const only = process.argv[2] && process.argv[2] !== "-v" ? Number(process.argv[2]) : -1;
const verbose = process.argv.includes("-v");
console.log("lots", d.lots.length, "anchors", d.anchors.length, "props", d.props.length);
d.courses.forEach((c, i) => {
  if (only >= 0 && i !== only) return;
  const w = courseWorld(d, i);
  const r = runBot(w, T, { onTick: verbose ? (s) => { if (s.ev & 31) console.log((s.tick / 120).toFixed(2), "m" + s.mode, "ev" + s.ev, "p", s.px.toFixed(1), s.py.toFixed(1), s.pz.toFixed(1), "v", Math.hypot(s.vx, s.vy, s.vz).toFixed(1), "lat", s.lat.toFixed(1), "a", s.anchor); } : undefined });
  // idle run: no input at all
  const s = initState(w); let n = 0;
  while (!s.finished && n < 120 * 400) { step(s, { hold: false, lean: 0 }, w, T); n++; }
  console.log(c.id.padEnd(11), "len", w.length, "boxes", w.boxes.length, "anch", w.course.anchors.length, "| bot", r.finished ? "ok" : "FAIL", r.seconds.toFixed(1) + "s avg", r.avgSpeed.toFixed(1), "top", r.topSpeed.toFixed(1), "land", r.landings, "att", r.attaches, "| idle", s.finished ? (n / 120).toFixed(0) + "s" : "FAIL at " + s.progress.toFixed(0));
});
