# Washline — game plan

The design as it stands. History and reasons are in `docs/history.md`.

## What it is

A one-thumb 3D swing game for one player on an upright iPhone, installed to the Home Screen.
You swing down the streets of a pale, sunlit rooftop district on washing lines, crane hooks,
lamps, antennas and kites. Wherever you carry speed, the district takes on colour. The best
run of each street stays painted. Filling the streets is the goal.

## Pillars, in order

1. Swinging feels good with nothing to collect.
2. Low floor, high ceiling: one thumb; timing and lean are the depth.
3. A restart costs nothing.
4. The pixel-splat look is the identity. If splats cannot hold the look or the frame rate,
   stop and say so with evidence; never switch to meshes or sprites.

## Controls

- Press and hold: tether to the best anchor ahead. Release: fling, keeping momentum.
- While holding, slide left/right: lean the swing. The lean at release is remembered for
  about a second and biases which anchor the next press takes.
- No camera control.
- Three schemes, switchable in the tuning sheet (problem B, see history):
  - **A · Drag lean** — lean is how far the thumb has slid from where it went down.
  - **B · Thumb position** — lean is where the thumb is across the screen, so pressing
    off-centre already aims the grab.
  - **C · Timing only** — the thumb never leans; the game steers along the street. The
    floor: pure rhythm.
- Quiet assists (all tunable, all in `src/tuning.ts`): the reticle shows exactly the anchor a
  press would take (the same function picks it); a held thumb keeps reaching, so the first anchor to come into reach takes it; aim blends your
  velocity with the course ahead, so corners are anticipated; a gentle auto-steer pulls the
  swing back toward the street; the rope reels in so the arc clears the roofs below.

## Rules of the world

- No death, timers, stamina, score or fail screens. A missed anchor drops you onto a roof or
  the street at a jog; you lose speed, the runner scrambles up walls on their own, and any
  anchor in reach picks you back up.
- A run ends at the end of its street. The only number is how full the street is.
- Restart is one tap (↻) and returns to the start instantly; the run begins on the next press.

## The swing model (`src/sim/`)

Deterministic, fixed 120 Hz, pure functions of (state, input, world, tuning). A 3D pendulum:
the rope is a one-sided distance constraint (it can go slack); velocity along the rope is
removed when taut, so momentum carries through a release exactly. Extras that make it feel
good: stronger gravity while tethered, a push on the downswing that fades out with speed, a
small kick and lift on release, a soft speed cap. Lines sag under load, most in the middle.
Moving anchors are pure functions of time. Wind is an acceleration inside boxes.
Because it is deterministic, a run is fully described by its inputs: ghosts, the scripted
bot, the benchmark and the menu's attract mode all replay inputs or a policy.

## Colour

A top-down paint map of the district (512 × 512, about 1 m cells). While you move faster
than a threshold, you stamp a disc whose radius and strength grow with speed. Every splat
carries a pale colour, a painted colour and its own random threshold, and shows the painted
colour when the map under it exceeds that threshold — so partial paint reads as stipple,
and the edge of your wake is dithered by the splats themselves. During a run your best
previous paint shows as a lighter stipple; your current run paints on top at full strength.
The disc lands a little ahead of you, because that is where the camera is looking.
A run's fill is the mean paint over the cells within 13 m of its street.

## Look

Pixel art made of Gaussian splats, generated in code. The scene is rendered about 195 px
wide (an integer divisor of the screen), every pixel is one of the district's 16 colours,
and the canvas is scaled up with nearest-neighbour. Splats are hard-edged, opaque spheres
fixed to a world grid, with palette colour baked per splat; distance is handled by levels of
detail whose cell size doubles, so no splat is ever much smaller than two pixels. Details and
evidence: history, M0.

## The district and its six runs (`src/world/district.ts`)

A 9 × 9 block grid, 540 m square, streets 16 m wide. All six runs share it, so painting one
street shows from the others.

| # | Run | Idea | What is authored |
|---|---|---|---|
| 1 | First Line | Hold to swing, let go to fly | Straight street, evenly spaced lines, level roofs |
| 2 | Slack | Lines sag most in the middle | Deep-sagging lines with market stalls under them; hang near a pole for a tight, high arc |
| 3 | Corner | Lean to carry speed round a turn | Two right-angle turns with an antenna pivot on each inside corner |
| 4 | Crane Yard | Anchors that move | Low unfinished blocks; crane hooks that traverse or bob |
| 5 | Kite Wind | Wind pushes the swing | Kite anchors; cross-wind in alternating blocks, shown by the washing |
| 6 | The Drop | Fall is speed | Towers and high lines, then the street drops 30 m to low lines |

## Sound

Synthesised with Web Audio: air rush by speed, a tether tone whose pitch follows the arc, and
mallet notes played by your attaches and releases that climb while you chain swings without
landing. Nothing is sampled or borrowed.

## Open

See the end of `docs/history.md` for what is unverified and what the phone must answer.
