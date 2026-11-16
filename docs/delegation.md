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
