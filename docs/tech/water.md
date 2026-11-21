# Water

Goal: a stylized ocean that still reads as real water, suits the low-poly look, and costs about
what the current one costs. It needs Gerstner swell, depth and fresnel colour, a sun glint, and
foam on crests and around the raft and floating items. The physics API must not change.

Prototype: `sandbox/water/` (`index.html`, `main.js`, `water.js`). It has tiers `a`, `b` and `c`,
plus `cur`, which runs the shipping `dist/ocean.js` in the same scene with the colour overrides
from `dist/game.js` so the two can be compared directly. Views are `fp` (deck), `over` (high
3/4 view), `sun` (into the sun) and `low` (swimmer eye height). `amp=2.6` gives a rough sea.

Checks:

- `python sandbox/water/shoot.py [out] [cur,a,b,c]`: shots for every tier and view, plus
  interleaved timing (`FRAMES`, `ROUNDS` env vars).
- `python sandbox/water/shoot_game.py <dist_dir> <out> <prefix>`: the real game (title, spawn,
  looking at the raft edge). Use it for an A/B of `dist/` against a patched copy.
- `node sandbox/water/parity.mjs`: physics parity with `dist/ocean.js` (heights and slopes).
- `node sandbox/water/parity.mjs` also checks that `setAmp(a)` moves the CPU heights with the shader.
- `node sandbox/water/cpu-cost.mjs`: JS cost of the raft SDF bake, floater stamping, `footprint` and
  `getHeight`.
- `python sandbox/water/profile.py 'tier=cur' 'tier=a' ...`: interleaved A/B of lab variants. Besides wall
  ms it reports `cpuMs`, the CPU time the browser's GPU process spends per frame. SwiftShader rasterises
  there, so it is the shader work itself and moves only a few % with the load from other agents, while
  wall ms swings 2 to 4x. Use `cpuMs`. `prof=NO_X` passes shader `#define`s for knock-outs, `src=` loads
  another copy of the module (a saved older version for before/after), `nowater=1` hides the ocean.

## What the game has today

- `dist/ocean.js`: one 280 m, 100x100 plane with 4 Gerstner waves (sum of amplitudes .255 m,
  base y -.24, speed x0.6) in the vertex shader. In the fragment shader: 5 analytic ripples for
  the normal, a sky gradient with Schlick fresnel, crest subsurface, a Blinn sun lobe (pow 260
  plus pow 36), and a "lace" foam made of noise contour lines gated by wave height, which also
  scatters white specks everywhere. The colour fades to the sky colour 28 to 125 m out. It does
  not know the raft or the items exist. Nothing marks where wood meets water, so the raft and
  the debris look pasted on.
- `dist/waterfx.js` (pooled splash drops and rings) and `dist/sky.js` are **not imported** by
  `dist/game.js`. Only `ocean.js` is live. This work leaves both alone.
- Physics consumers, all through `ocean.getHeight(x, z)`, `ocean.getSlope(x, z, t, e)` and
  `ocean.mesh.position.y` in `dist/game.js`:
  - raft bob and tilt (`updateRaft`)
  - player swim test (`movePlayer`, which passes `waterY` to `PlayerPhysics`)
  - floating items (`updateItems`)
  - hook and bobber surface mapping (`surfaceY`, `updateHook`)

  `dist/hook-physics.js` uses its own flat `WATER_Y = 0.05` and never calls the ocean. The
  `height()` in `dist/debris.js` shapes debris meshes and is not water. Neither needs a change.

## Research notes (what was tried, what was kept)

- **Waves.** Keep the exact Gerstner set. The CPU `getHeight` inverts the horizontal shift with 2
  fixed-point iterations, and the raft, player and items depend on it. `water.js` uses the same
  constants and code path, and `parity.mjs` reports `worstDiff: 0` over 25,200 samples and 36
  time steps. `setAmp(a)` (default 1) scales the GPU waves and the CPU wave table together for
  rough weather; `parity.mjs` checks that runtime `setAmp(2.6)` equals creating with `amp: 2.6`
  and that `setAmp(1)` returns to the shipping heights exactly. Never set `uAmp` alone.
- **Crest foam from the Jacobian.** For Gerstner waves, `J = (1+dDx/dx)(1+dDz/dz) - (dDx/dz)^2`
  drops where crests bunch together. That is where real whitecaps sit, and it beats a height
  threshold, which also lights up broad, gentle swells. The terms reuse the `sin` that `wave()`
  already computes, so they are accumulated **in the vertex shader** at no extra cost and passed
  as one varying. A per-pixel version added 4 more `sin` per pixel. Interpolating on the 2.8 m
  grid looked blocky with a hard threshold. That is fixed by using the mask only to set lace
  width and fading it in with a smoothstep.
- **Lace style.** The current game's look of contour lines of noise (`abs(noise - .5) < w`)
  is the one stylized element worth keeping. The problem was where it went (everywhere) and
  that it aliased (specks at distance). Now a mask chooses where it goes (crests, raft, items),
  the mask also sets line width (thin lace becomes a patch near contact), and coverage is
  anti-aliased by the pixel's footprint on the water (distance and grazing angle, so no `fwidth`),
  with lines thinner than a pixel dimmed, so far lines thin out instead of sparkling or blurring.
  The noise is a baked 512x512 R8 tiling value-noise texture (one fetch per octave instead of four
  hashes).
- **Contact foam without a depth prepass.** The raft is grid tiles (2 m, at `tile*2`), so its
  footprint is known exactly. `setRaft(tiles)` bakes a 128x128 RG8 signed distance texture fitted
  to the raft's bounding box plus an 8 m margin. It stamps each tile into the texels within
  reach, a few ms for 7 to 400 tiles, and only runs when tiles change. R is the raft SDF, G the
  same footprint shifted by the deck shadow offset (sun direction x deck height), so one fetch
  gives:
  - a thin, noise-ragged white collar on the logs
  - thin lace rings that pulse outward to about 1.1 m
  - a fake deck shadow
  - darker, foam-free water under the deck, so plank gaps show shaded water, not foam

  Floating items are capsules: `footprint(mesh)` measures the model's local bounding box once and
  returns `[x, z, r, hx, hz]`, the long horizontal side turned by the mesh's current rotation and
  scale, so a plank gets a band of lace along its length and a barrel or jug a small round one.
  `setFloaters` stamps every capsule into a 256x256 R8 distance map (64 m, 0.25 m texels) centred
  on the camera, about 0.02 to 0.1 ms a frame for 30 items, so the shader does one fetch however
  many items float. (The first pass looped over 16 circles per pixel, the single most expensive
  term; the nearest-16 limit is gone too.) Items get lace only: a solid collar showed as a white
  disc that never matches the model.
- **Hook bobber.** `setBobber(position | null)` while the hook floats (within .25 m of
  `getHeight`): a small white collar plus ripple rings running outward to about .75 m. A landing
  splash ring was tried and cut for cost (it is visible for one second per cast).
- **Sun glint.** The old pow-260 lobe on nearly flat water made a large blown-out white patch
  in the 3/4 view. It is now a tight lobe (pow 700, computed as pow 70 to the 10th by squaring)
  times a glitter mask, plus a low broad sheen (pow 70 x .1). The glitter is one random point per
  ~11 cm cell with its own flash cycle (on at once, fades over 40% of the cycle, then dark), so
  the sun path twinkles point by point over time instead of showing a frozen pattern. One hash
  per pixel. Past about 14 to 55 m it blends to a constant, so the far path stays continuous.
- **Body colour.** The existing deep/shallow teal by height and slow noise patches is kept.
  Subsurface is now backlit: crest mask x view-against-sun x grazing view, in the Sea of
  Thieves style. Fresnel is capped at .75 so the low-poly sky never turns the sea into a
  mirror. The fade to sky colour is the same as today.
- **Tier B, a half-res opaque prepass (colour and depth).** This gives intersection foam around
  any mesh, refraction and depth absorption. It looked almost identical to A here. The water is
  deep everywhere, so absorption saturates, the only intersecting objects are the raft and the
  items, which A already handles analytically, and refraction is invisible at these angles. The
  cost is roughly 2x the frame and 2x the draw calls, because the whole scene renders twice.
  **Not worth it.**
- **Tier C, B plus a quarter-res planar reflection.** The only thing it adds is a reflection of
  the raft and islands near the waterline. From deck height with fresnel capped at .75 it is not
  visible in the shots. It costs a third scene render. **Not worth it.** It would matter only
  with a swimmer camera at the waterline (`view=low`).
- Rejected without building: FFT ocean (needs float render targets and is heavy for a calm
  stylized sea); screen-space reflections (need a prepass, as B does); flat-shaded facet
  normals (on a 2.8 m grid with 10 cm amplitude the facets do not read, and they fight the
  ripple normals).

## Tiers and numbers

Machine: SwiftShader (CPU rasteriser) on a shared 4-core box with load average 25 to 40 from
other agents. **Only ratios mean anything.** Wall-clock frame times swing 2 to 4x between
identical runs here, so this pass measures `cpuMs` (`profile.py`): CPU time of the browser's GPU
process per frame, where SwiftShader rasterises. Repeat runs agree within a few %. Variants are
interleaved in the same browser (order reversed every round), `FRAMES`=10 after an 8-frame
warm-up, 2 rounds, 1280x720, calm sea, sun shadows on as in the game. `a0` is the first tier A
(commit 472d549), loaded with `src=shots/water-a0.js`.

Lab, GPU-process ms per frame (x cur in the same run):

| view | cur (dist/ocean.js) | a0 (first tier A) | **a (this pass)** | scene without water |
|------|--------------------:|------------------:|------------------:|--------------------:|
| fp (deck) | 236 (1.0) | 461 (1.96) | **242 (1.03)** | 86 |
| over (3/4, high) | 295 (1.0) | 590 (2.00) | **322 (1.09)** | 84 |
| sun (into the sun) | 286 (1.0) | 495 (1.73) | **298 (1.04)** | 96 |

So the water shader itself (frame minus the no-water scene) is about 1.04 to 1.13x the current
ocean's (1.04 / 1.13 / 1.06), down from 2.5 / 2.4 / 2.1x for a0. Earlier runs during the pass gave a at 1.08 to 1.20x; the
spread is load and tuning between runs.

Real game (`shoot_game.py`, 40 frames looking at the raft edge, GPU-process ms per frame, two
runs each, interleaved cur / old / new): cur 1102 / 1080, a0 1300 / 1322 (x1.20), a 1140 / 1151
(x1.05). A later run of the final shader gave 1063. Draw calls, programs, triangles and geometries
are unchanged from cur; A adds three small textures (raft SDF 32 KB, floater map 64 KB, noise
256 KB).

### Where the cost was, and what was cut

Profiled with compile-time knock-outs (`profile.py ... 'src=shots/water-prof2.js&prof=NO_X'`).
The key finding: **SwiftShader does not skip untaken branches.** A runtime-false `if` around the
lace noise cost the same as no `if` at all; only compiling the code out saved time. So on this
renderer every term costs on every water pixel, whatever gates surround it. (On a real GPU the
gates in the shader still skip work in coherent regions, so they stay.)

| term in a0 | what changed | effect |
|---|---|---|
| 16-slot floater loop per pixel | capsules stamped on the CPU into a camera-centred 256x256 distance map; one fetch | biggest single term; also removes the 16-item limit |
| 2 raft SDF fetches (contact + shadow) | RG texture: shadow offset baked into G | one fetch |
| lace noise: 2 procedural value noises (8 hashes) | baked 512x512 tiling noise texture, 2 fetches | ~a third of the remaining foam cost |
| `fwidth` for lace AA | footprint from distance and grazing angle | small |
| debug views (`uDebug` ifs, one more SDF fetch) | compiled in only with `options.debug` | small |
| `pow(ndh, 700)` | `pow(ndh, 70)^10` by squaring | small |
| body-colour noise (2 value noises per pixel) | per vertex (7 to 22 m features on a 2.8 m grid) | small |
| ring `sin`s, bobber block | triangle waves; bobber stamped into the floater map | bobber block was ~6% on its own |
| far-sky early `return` | removed: SwiftShader ran both paths, including a second colour-space conversion | ~5% |

Tried and reverted: an integer (uint multiply/xor) hash was ~2.8x slower than the float `fract`
hash in SwiftShader. Glitter (one hash per pixel) and the 5 ripple `cos` are each about 5% and
were kept for looks.

JS per frame: `footprint` x30 + `setFloaters` (stamping) about 0.02 to 0.1 ms on an unloaded core
(`cpu-cost.mjs` reports 10 to 20x more on this loaded box). `getHeight` is unchanged code. The raft
bake runs only on raft edits and now stamps twice (SDF and shadow), a few ms for 7 to 400 tiles.

### Tiers B and C (first pass, wall-clock, not re-measured)

| tier | x cur (two runs) | calls | textures | programs |
|------|-----------------:|------:|---------:|---------:|
| b (+prepass) | 2.5 / 2.7 | 83 | 4 | 6 |
| c (+prepass +reflection) | 2.3 / 2.3 | 120 | 5 | 8 |

They render the scene two or three times and looked almost identical to A here.

## Decision

**Ship tier A** as a drop-in replacement for `dist/ocean.js`. It has the same file name, the
same `createOcean` export, bit-identical `getHeight`/`getSlope`, and the same draw call count.
On top of that, call `setRaft` from `rebuildRaft()`, and `setBobber` + `setFloaters` once a frame
from `updateItems()`. See `docs/tech/water-ADOPT.md`.

What it fixes, visible in the screenshots:

- The raft and every floating item now sit **in** the water. The raft has a thin ragged collar,
  fine lace rings and a soft deck shadow; each item has lace shaped by its footprint (a band
  along a plank or leaf, a small ring around a jug) with ripple rings running outward; the hook
  bobber gets the same while it floats.
- The large blown-out sun blob becomes a sun path of twinkling points.
- The white specks scattered over the whole sea are gone. Lace appears on crests, more of it
  on steeper ones (rough sea), and thins out with distance.

Screenshots (in `sandbox/water/shots/`, git-ignored, so regenerate them with the scripts):

- lab, current against new: `cur-*.png` and `a-*.png` (`fp`, `over`, `sun`, plus
  `a-fp-amp2.6.png` for a rough sea); `python sandbox/water/shoot.py sandbox/water/shots cur,a`
- real game: `game-{cur,old,new}-{title,spawn,down,cast}.png` (`old` = first tier A, `cast` = hook
  thrown and floating)

Tiers B and C stay in `water.js` behind `#define`s for reference. They cost nothing unless
`tier` is `'b'` or `'c'`. Recommendation: delete them if nobody picks them up.

## Honest weaknesses

- Still about +3 to 10% over the current ocean's lab frame in SwiftShader (+5% for the whole
  game frame), not free. Nothing here was measured on a real GPU, where the per-pixel gates also
  skip work and the textures are trivially cheap.
- Item foam is lace and rings only, no solid collar, so from the deck at 5 to 15 m it is subtle;
  it is a capsule of the bounding box, so an L-shaped or very irregular model gets a rounded band.
  The floater map has 0.25 m texels; small items (jug, bobber) get a slightly soft shape.
- The bobber gets item-style lace and rings, not a distinct splash: the dedicated collar,
  ripple and landing-splash code cost ~6% of the lab frame on SwiftShader and was folded into
  the floater map. The bobber is stamped by `setFloaters`, so `setBobber` must come first.
- Lace anti-aliasing uses an analytic pixel footprint rather than `fwidth`, tuned by eye
  (`isoAA = foot * 1.2`, coverage floors .5). Lines far away are dimmer and thinner than in the
  first pass, by design.
- The baked noise tiles every 64 cells (30 m for the first lace octave); with two octaves at a
  non-integer ratio and different drifts, no repeat was visible in the shots.
- Contact foam knows only the raft tiles, the items and the bobber. Swimmers and the islands'
  shores get none (that needs tier B).
- The raft SDF assumes the raft does not move or turn in x/z, which is true today. If the raft
  ever drifts, call `setRaftPose(x, z, yaw)`; a new yaw re-bakes, because the shadow offset is
  baked in raft space. The shadow also bakes the sun direction and `deckLift` at `setRaft` time.
- Glitter is a per-cell flash (one point per ~11 cm cell), so up close it can read as a regular
  dot field, especially in the high `over` view.
