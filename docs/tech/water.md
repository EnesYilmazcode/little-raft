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
- `node sandbox/water/cpu-cost.mjs`: JS cost of the raft SDF bake, floater pick and `getHeight`.

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
  time steps. A runtime `uAmp` (default 1) scales the GPU and CPU sides together for rough
  weather later.
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
  anti-aliased with `fwidth(noise)`, so far lines thin out instead of sparkling.
- **Contact foam without a depth prepass.** The raft is grid tiles (2 m, at `tile*2`), so its
  footprint is known exactly. `setRaft(tiles)` bakes a 128x128 R8 signed distance texture fitted
  to the raft's bounding box plus an 8 m margin. It stamps each tile into the texels within
  reach, about 2 to 9 ms for 7 to 400 tiles, and only runs when tiles change. The shader reads
  it for:
  - a thin, noise-ragged white collar on the logs
  - lace rings that pulse outward to about 1.1 m
  - a fake deck shadow: the SDF sampled once more, offset toward the sun by the deck height
  - darker, foam-free water under the deck, so plank gaps show shaded water, not foam

  Floating items are passed as up to 8 circles (`setFloaters`, nearest to the camera) and get
  lace rings only. A solid collar was tried and dropped, because a circle never matches a
  plank or a palm leaf and showed as a white disc.
- **Sun glint.** The old pow-260 lobe on nearly flat water made a large blown-out white patch
  in the 3/4 view. It is now a tight lobe (pow 700) multiplied by a fine noise "glitter" cell
  mask, so the sun path breaks into points, plus a low broad sheen (pow 70 x .1). Past about
  20 to 70 m the mask blends to a constant, so the far path stays continuous.
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

Machine: SwiftShader (CPU rasteriser) on a shared 4-core box with load average 25 to 35 from
other agents. **Only the ratios mean anything.** Each tier was measured in the same browser,
interleaved over 3 rounds (`fp` view, calm, 1280x720, 40 frames after a 10-frame warm-up), and
the median is reported. `renderer.info` is for one whole frame, including the shadow map pass
(sun shadows are on, as in the game).

TIMING_TABLE

The real game (`shoot_game.py`, 40 frames at spawn, same loaded machine) gave 1470 ms with
the current ocean and 1741 to 1773 ms with tier A, about +20% for the whole frame. Draw calls,
programs and geometries are unchanged. Tier A adds one 16 KB texture.

JS per frame: `setFloaters` with 30 items and a nearest-8 sort takes about 0.015 to 0.1 ms.
`getHeight` is unchanged code. The SDF bake runs only on raft edits.

## Decision

**Ship tier A** as a drop-in replacement for `dist/ocean.js`. It has the same file name, the
same `createOcean` export, bit-identical `getHeight`/`getSlope`, and the same draw call count.
On top of that, call `setRaft` from `rebuildRaft()` and call `setFloaters` once a frame from
`updateItems()`. See `docs/tech/water-ADOPT.md`.

What it fixes, visible in the screenshots:

- The raft and every floating item now sit **in** the water. Each has a ragged white collar
  and lace rings, and the deck casts a soft shadow on the sea.
- The large blown-out sun blob becomes a glittering sun path.
- The white specks scattered over the whole sea are gone. Lace appears on crests, more of it
  on steeper ones (rough sea), and fades cleanly with distance.

Screenshots (in `sandbox/water/shots/`, git-ignored, so regenerate them with the scripts):

- sandbox, current against new: `cur-*.png` and `a-*.png` (`fp`, `over`, `sun`, plus
  `a-fp-amp2.6.png` for a rough sea)
- real game: `game-cur-{title,spawn,down}.png` and `game-new-{title,spawn,down}.png`

Tiers B and C stay in `water.js` behind `#define`s for reference. They cost nothing unless
`tier` is `'b'` or `'c'`. Recommendation: delete them if nobody picks them up.

## Honest weaknesses

- About +50% fragment cost for the water in the SwiftShader lab and about +20% for the whole
  game frame. On a real GPU one full-screen pass of this size is trivial, but it is not free,
  and nothing here was measured on real hardware.
- Floater foam uses circles (r = .35 for every item). Long planks get a round ring, and items
  beyond the nearest 8 get no foam. Items more than about 30 m away fade out anyway.
- Contact foam only knows the raft tiles and the item circles. The hook bobber, swimmers and
  the islands' shores get none. That would need tier B or more circles. Adding the bobber as
  a 9th circle is a one-line follow-up.
- The raft SDF assumes the raft does not move or turn in x/z, which is true today because the
  raft group only bobs and tilts. If the raft ever drifts, call `setRaftPose(x, z, yaw)` each
  frame.
- Close up from the deck, the contact lace is fairly bold, about 5 to 10 cm ribbons. That is a
  taste call, and it is tunable in one place: the `0.01 + laceMask * 0.055` width and the
  `fp * 2.1` noise scale.
- The glitter mask is a value-noise cell, so frozen-time screenshots show it as a fixed
  pattern. In motion it scrolls with the foam noise and twinkles, but there is no
  per-sparkle lifetime.
