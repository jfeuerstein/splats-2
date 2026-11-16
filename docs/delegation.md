# Delegation log

Routing: haiku = mechanical; sonnet = well-specified building; opus = hard self-contained
engineering and the blind milestone review. Fable keeps design, the swing model, camera,
architecture, run design and final judgement.

| # | Milestone | Task | Model | Outcome | Rework needed |
|---|---|---|---|---|---|
| 1 | M0 | Research: stable pixel art under a moving perspective camera | sonnet | Good. Found the texel-splatting paper and its costs, flagged what it could not confirm. Recommendation matched the direction chosen. | None |
| 2 | M0 | Spark 2.4 / three 0.187 cheat sheet from installed types + docs (docs/spark-notes.md) | sonnet | Good and thorough (found float16 centres, `falloff`, the timer quirk, linear output to render targets). Slow and costly for a notes file (230k tokens). | None. Next time split: haiku for single facts, sonnet only for the synthesis. |
| 3 | M1 | Unit tests for the swing sim (23 tests) | sonnet | Good. All pass, found a stale comment and listed real edge cases. | Removed the stale comment myself. |
| 4 | M0 | tools/shoot.mjs: stills, frame sequences, flicker metric | sonnet | Good; verified against its own stub because the real page did not exist yet. | Orientation of grab() left unverified (stub was symmetric) — checked at integration. |
| 5 | M0 | Render spike: world-anchored splat pipeline, LOD pool, palette pass, frame-sequence evidence (src/render, src/spike.ts) | opus | Very good. Measured each idea with the flicker metric, found three Spark behaviours the notes had missed, kept to the interface I specified so the game compiled against it unchanged. Long (about 1 h 45 min). | Lamp cables hung upward in an inverted V (my district data put lamps above the roofs; fixed with corner masts). Two paint families used sky colours and read as holes; changed. |
| 6 | M1 | Tuning sheet + saves (src/game/sheet.ts, save.ts, tests) | sonnet | Good, worked first time in the page. | None |
| 7 | M1 | Synthesised audio (src/game/audio.ts, tests) | sonnet | Compiles, tests pass, graph is sane. Nobody has heard it. | Unknown until the phone. |
| 8 | M1 | Menu / HUD / result card (src/game/ui.ts) | sonnet | Good; pixel font drawn in CSS, no assets. | None so far |
| 9 | M3 | Offline shell: icons, manifest, service worker as a Vite plugin (tools/vite-pwa.ts) | sonnet | Good; had to verify on a probe build because the render module did not exist yet. | Re-verified on the real build in task 11. |
| 10 | M1 | Page bot (tools/bot.mjs) | — (did it myself) | 40 lines; quicker to write than to brief. | — |
| 11 | M1 | Emulated touch test + offline test on the real build | sonnet | see below | |
| 12 | M1 | Blind review of the whole tree against the plan | opus (read-only) | see below | |

Routing notes so far: nothing has needed haiku — every mechanical job was smaller than its
brief. Sonnet has not failed a task; the cost is in tasks where it must read a lot (2).
Opus is worth it for work that needs its own measure-and-iterate loop (5).
