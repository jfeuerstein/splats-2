# Diary

Newest last. What was decided, why, and what the evidence was.

## M0 — spike: can splats be pixel art under a moving camera?

**Read first.** three 0.187 and Spark 2.4 from the installed packages and current docs;
the facts that matter are in `docs/spark-notes.md`. The ones that shaped everything:
Spark bakes all splats into one buffer and re-sorts it whenever the camera moves, so the
cost is the total number of live splats; `falloff: 0` gives flat hard-edged splats; the
packed format stores centres as float16, far too coarse for a 540 m district; Spark's own
level-of-detail only works for splat files, not generated splats.

**Approaches considered for problem A.**
- *Texel splatting* (Ebert 2026, arXiv 2603.14587): render the scene into a cube map from a
  grid-snapped point and splat each texel back as a world-space quad. Perfectly stable under
  rotation, but it needs a mesh scene to render the cube map from (we have none, by rule) and
  costs a second full pass. Not used.
- *Screen-space tricks* (snapping the camera, as in orthographic pixel-art 3D): do not
  survive perspective and a camera that swings.
- *World-anchored splats sized to a world grid* — chosen. Every splat sits on a world grid,
  is opaque and hard-edged, and has its palette colour baked in. Stability comes from the
  world never being resampled: a wall is the same few thousand dots every frame. Distance is
  handled by four levels whose cell doubles (0.4 / 0.8 / 1.6 / 3.2 m), swapped per 12.8 m
  tile at about 35 / 80 / 160 m, so a splat is never much under two low-res pixels.

**What the spike measured** (frame sequences at 22 m/s down a street, 195 × 422, flicker =
share of pixels per frame that differ from both the frame before and the frame after):

| Variant | Flicker |
|---|---|
| Hard discs | 4.76 % |
| Squares snapped to the pixel grid, integer size | 4.55 % |
| + coarse levels prefer wall colour to window colour | 4.03 % |
| + finer levels end sooner (35 / 80 m) | 3.66 % |
| All together (the defaults) | 3.43 % |

At walking pace (0.1 m per frame) it is 0.9 %. What is left sits in facades 40–150 m away
where a window is 2–4 pixels. Pictures: `npm run shoot -- --seq 60:71.47:0.37` regenerates
them into `out/`. I looked at pale and painted sequences and at the paint boundary: it
reads as pixel art, not as blurred splats; near geometry is steady; the far skyline is
steady; the middle distance crawls a little.

**Verdict on pillar 4 (look):** holds in headless frames. **Frame rate: unknown** — see
below.

**Splat budget and LOD plan.** A typical view needs 30–50 thousand live splats plus up to
2.5 thousand dynamic ones (lines, clothes, runner, rope). The pool is fixed-size (default
100 k, the "Splat budget" slider); a selector runs a few times a second, picks a level per
tile, and if the view would exceed the budget pulls every LOD distance in by a common
factor. At 60 k the densest views pull in to 0.81× with no visible change, so there is
headroom to go down. Nothing here has been timed on a phone: the in-game Benchmark flies
run 1 at six budgets and is the only evidence that counts.

**Things that turned out differently from the notes.**
- Positions are stored relative to an 8 m grid in spare bytes and decoded in the shader, so
  float16 never touches a world coordinate.
- Spark only draws splats that were live at its last sort, so a tile keeps its old level
  until the new one has been sorted (otherwise tiles blink).
- Spark's "sRGB" is a 2.2 power curve; the pipeline bypasses colour management and writes
  palette indices, which the final pass looks up, so colours are exact.
- Washing lines and their clothes are drawn every frame by the game (they sag and flutter),
  not baked.

## M1 — feel: the swing, and steering it with one thumb

**The model** (`src/sim/sim.ts`): fixed 120 Hz, pure, deterministic. A rope is a one-sided
distance constraint; taut, the velocity along it is removed, so letting go keeps exactly the
momentum you had. On top: heavier gravity while tethered (snappier arcs), a push on the
downswing that fades with speed (you can build speed from a standstill, not without limit),
a small kick and lift on release, reel-in so the arc clears what is below. 23 unit tests
cover energy, the constraint, determinism and replay.

**Problem B: three schemes, all on the phone** (tuning sheet → Controls):
A drag lean, B thumb position, C timing only. I cannot tell which is right without a thumb;
C exists because the bot proves every run can be finished with no lean at all, which makes
it the honest floor. What makes any of them workable is the same quiet help: the grab aims
at a point ahead *along the street*, not just along your velocity, so corners are taken
before you see them; and the lean at release biases the next grab for about a second.

**Things that went wrong and what fixed them.**
- Anchors every 20 m made the fastest play slow (the bot averaged 15 m/s): you were always
  about to grab again. Spacing is now 36–40 m: lines between walls, lamps over crossings.
- On Slack the runner jittered at stall edges (810 "landings" in one run): standing height
  now uses the higher of two probes ahead.
- On Corner the bot flew straight on: aim, auto-steer and the jog all now chase a point a
  little way down the street's centre line.
- **Paint landed where you could not see it.** The first pictures of the real game showed
  the colour arriving under and behind the runner, below the bottom of the screen: the
  camera looks ahead. Paint now lands 0.6 s ahead of the runner and reaches 18 m at full
  speed, so it climbs the walls beside you and floods the street you are looking at.

**Proof of completion.** `npm run bot` plays all six runs in the real page from recorded
inputs: 24–40 s each, 79–88 % fill. Standing still finishes too (the runner jogs): 76–110 s.
The bot is close to a perfect player, so a person should land in the 30–90 s target; if a
clean human run is under 30 s, the streets need lengthening (tell me).

**Blind review (opus, plan + diff only).** Nineteen findings; the ones that mattered:
the benchmark never left the start line and clamped away every stall over 100 ms (so the
only performance evidence would have been wrong); restarting within 0.9 s of the finish
lost the run; the reticle and the grab chose with different lean; a saved script could not
replay because lean was stored rounded but played unrounded; a thumb could stay "held"
after an app switch; the offline cache pinned old builds. All fixed. One rule changed as a
result: a held thumb now keeps reaching and takes the first anchor that comes into reach
(before, a press expired after 0.35 s and you had to tap again), which is what the plan
said and is kinder to the low floor.

## M2 — colour and the real look

M0's pipeline is the real look, so M2 was about colour in play. Each building has a hue
family (lit / mid / shade face) and a contrasting roof; the street has its own. Every
splat carries its pale and painted colour and a random threshold, so paint strength reads
as stipple density: about 85 % solid at cruising speed, fully solid only near 30 m/s.
Checked in frame sequences of the real game (`node tools/gameshot.mjs`): colour climbs the
walls beside the runner and floods the street ahead; consecutive frames are steady; the
rope is one clean line. Two families used sky colours and looked like holes in the
buildings; replaced.

## M3 — the district

Six runs on one shared 540 m grid, each built round one idea (table in the plan). Run
picker with fill bars, saves (best fill, best paint, ghost of the best run, play count),
ghost drawn during a run, synthesised sound, offline shell with generated icons. Proven by
tools: `npm run bot` (all six finish in the real page), `npm run touch` (seven cases with
real touch events: press/hold/release, each scheme's lean, restart, tuning-sheet gesture,
menu), `npm run offline` (boots with the network off, no request leaves the origin).

## Unverified — what only the phone can answer

1. **Frame rate.** Nothing is known. Headless is a software renderer at ~2 fps. Run the
   Benchmark (tuning sheet). If no budget holds 60 fps that is pillar 4 and I stop and
   rethink rather than switch to meshes.
2. **Feel.** The bot proves runs can be finished, not that swinging is good. Which control
   scheme, and every Swing / Anchors / Camera slider, is a guess until a thumb tries it.
3. **Sound.** Never heard. It compiles and its graph is sane; it may be ugly.
4. **Safari specifics.** Partial texture uploads, the crisp upscale, audio unlock, Home
   Screen resume, service-worker updates: all only tested in Chromium.
5. **Run length.** The near-perfect bot takes 24–42 s. If a clean human run is under 30 s
   the streets should be longer.
6. **Mid-distance shimmer** (3.4 % of pixels per frame at speed, in window grids 40–150 m
   away): acceptable in sequences here; judge it in motion on the real screen.

Known and left: saved scripts do not record the tuning they were made with (nothing
replays them yet; ghosts are stored positions and are unaffected); no save migration
(format version 1); audio constants are a separate table not shown in the tuning sheet;
"The Drop" does not yet look as tall at its start as its idea deserves.
