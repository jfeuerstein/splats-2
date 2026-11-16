# Playtest guide

I can run the simulation, look at screenshots and frame sequences, and prove a run can be
finished. I cannot feel the swing, hear the sound, or see the real frame rate. This page
says what to try on the phone and what to send back.

## Set up (once)

0. One repo setting first: GitHub → Settings → Pages → Source: **GitHub Actions**. Then re-run
   the failed "Deploy to GitHub Pages" workflow (or push anything). If the deploy job is then
   refused for this branch, open Settings → Environments → github-pages and allow the branch
   (or merge to the default branch).
1. Open `https://jfeuerstein.github.io/splats-2/` in Safari on the iPhone.
2. Share → Add to Home Screen. Launch it from the icon (full screen, no Safari bars).
3. After one launch it works offline (try Airplane Mode once).

## The hidden tuning sheet

- **Triple-tap the top-left corner** of the screen (or add `?tune` to the URL).
- Every feel, camera, paint, look and sound constant is there, grouped. `−`/`+` nudge one
  step. Changes apply immediately and are saved on the phone.
- **Control scheme** is the first row under Controls.
- **Copy changes** copies only the values you changed as JSON. Paste that back to me and I
  will make them the defaults.
- **Benchmark** flies run 1 on autopilot at six splat budgets and reports frame times.

## First: the benchmark (2 minutes)

Run it once from the Home Screen app with the phone cool and off the charger, then once
more after five minutes of play. Send me both reports (select the text). I need:
- the highest budget that holds 60 fps, and whether the second run is worse (heat);
- whether anything visibly hitches when buildings ahead sharpen (level-of-detail swaps).

If no budget holds 60 fps, tell me: that is pillar 4, and I would rather rethink than ship it.

## Then: feel (the part only you can do)

Play run 1 (First Line) for five minutes on each control scheme before judging.

1. **Is the swing good with nothing to collect?** After ten swings in a row, is there a
   rhythm you want to keep? If not, which is it: too floaty, too heavy, too slow, too fast,
   too automatic? (Sliders to try: Gravity, Gravity × while tethered, Downswing push,
   Release kick/lift, Longest rope.)
2. **Does the grab do what you meant?** Watch the four-dot reticle: it marks the anchor a
   press will take. Count the times it took one you did not mean, and where (after a
   corner? over an intersection? on the cranes?). (Sliders: Search cone, Ideal anchor
   ahead, Aim follows course, Lean turns aim.)
3. **Release timing.** Is there a clear best moment to let go, and can you feel when you
   hit it? Does a late release (swinging back) feel like your mistake or the game's?
4. **Lean.** On run 3 (Corner): can you carry speed round both turns? Which scheme makes
   that easiest? Does lean do too little, too much, or arrive too late?
   - A · Drag lean: is 70 px of travel right? Does your thumb drift off-centre over a run?
   - B · Thumb position: does pressing off-centre grab the wrong line by accident?
   - C · Timing only: is it boring, or is it the right floor?
5. **Holding early.** A held thumb keeps reaching and takes the first anchor that comes
   into reach. Does that feel helpful, or does it grab too soon with a poor arc?
6. **Missing.** Miss on purpose. Is dropping to a jog a fair cost? Is getting back on a
   line quick, or do you wait around? Does the wall scramble look acceptable?
7. **Restart.** Tap ↻ mid-run. Is it instant? Is "press to go" right, or should it launch
   by itself?

## Camera

- Any motion discomfort after a few minutes? Where: the bottom of the arc, the release, the
  corner? (Sliders: Heading follow, Follow vertical velocity, Position lag, FOV, Roll.)
- Can you always see the next anchor before you need it? On The Drop, can you see the low
  lines before you fall?
- Does the camera ever end up inside a building or staring at a wall?

## Look (pillar 4)

- Does it read as pixel art, or as blobs? Near walls, mid-distance facades, far skyline:
  which is weakest?
- While moving: any shimmer, crawling edges, or popping on distant buildings? Any flicker
  where two colours meet? Is the washing line always visible far enough ahead?
- Is the upscale crisp (hard square pixels), or blurry? (If blurry, tell me the iPhone
  model and iOS version.)
- Does colour arriving feel like a reward? Is the pale city too bare before you paint it?
  Can you see it arrive, or does it mostly happen below the screen? (Paint → "Paint lands
  this many s ahead", "Paint reach at full speed".)
- Is 80–90 % fill on a clean run too generous? What did your first few runs score?
- With the best run shown as light stipple during a run (Paint → "How strongly the best
  run shows"): helpful, or confusing?

## Runs

For each of the six: did you understand the idea without reading the hint? Roughly how
long did a clean run take (30–90 s is the target; my bot, close to a perfect player, does 24–42 s)? Which one would
you replay, and which would you skip?

## Sound (I have never heard it)

- Is anything harsh, too loud, or annoying after two minutes? Which sound?
- Can you hear the arc (the tether tone rising through the bottom of the swing)?
- Do the notes on grab/release feel like you are playing them?
- Does sound start on the first touch? Does it come back after switching apps? (The mute
  switch silences it; that is expected.)

## What to send back

1. Both benchmark reports.
2. "Copy changes" JSON once the swing feels right to you, and which control scheme you kept.
3. Answers to whichever questions above had a clear answer. One line each is plenty.
4. Screenshots or a screen recording of anything that looked wrong.
