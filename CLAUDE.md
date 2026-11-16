# Washline

One-thumb 3D swing game for iPhone Safari (Home Screen web app). Pixel art made of Gaussian
splats, everything generated in code. Design: docs/game-plan.md. Diary: docs/history.md.
Spark API facts (verified against the installed version): docs/spark-notes.md.

## Layout
- `src/tuning.ts` — EVERY feel/camera/look constant, with ranges. The tuning sheet is generated from it. Never hard-code a feel number elsewhere.
- `src/sim/` — deterministic swing simulation. Fixed 120 Hz step, no clocks, no Math.random, no DOM, no three.js. `sim.ts` (step, pickAnchor), `world.ts` (queries), `bot.ts` (policy bot + script replay), `paint.ts`.
- `src/world/district.ts` — the district and its six runs as pure data (boxes, anchors, wind, guides).
- `src/render/` — splat generation, Spark setup, low-res target, palette pass. Only this folder imports three / Spark.
- `src/game/` — loop, input schemes, camera, UI, saves, ghosts, audio.
- `tools/` — headless checks (Playwright + Chromium are preinstalled; never `playwright install`).
- `tests/` — vitest unit tests for the sim.

## Rules
- Splats only. Never substitute meshes or sprites for world geometry. If splats cannot do something, stop and report with evidence.
- No asset files, no runtime network, no API keys. Sound is synthesised.
- No fail states, timers or meters in the game.
- three.js and Spark move fast: check `node_modules` types or docs/spark-notes.md, not memory.
- Judge moving-camera image quality from frame sequences (`npm run shoot -- --seq`), never stills. Look at the pictures.
- Headless frame times mean nothing for the phone. The in-game benchmark (tuning sheet → Benchmark) is the only performance evidence.

## Commands
- `npm run dev` — dev server. `npm run build` — typecheck + production build to dist/.
- `npm run check` — `tsc --noEmit` + unit tests. Must pass before every commit.
- `npm run shoot` — screenshots / frame sequences at phone size (see `node tools/shoot.mjs --help`).
- `npm run touch` — emulated touch test. `npm run bot` — plays every run from its script in the real page.
- `npx vite-node tools/simtry.ts [-v] [course]` — fast sim-only bot summary for course design.

## Delegation
Subagents are defined in `.claude/agents/` (mech = haiku, builder = sonnet, engineer = opus, reviewer = opus read-only).
Log every delegated task in docs/delegation.md.
