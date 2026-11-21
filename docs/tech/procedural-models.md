# Procedural low-poly models

Goal: make the game's props look more charming and more of a set, and cheaper to draw. Every model stays
built in code (no asset files, no new dependencies).

Prototype: `sandbox/procedural-models/`
- `lowpoly-props.js` is the kit and all props. It is one ES module with no imports (THREE is passed in as `T`), and
  it is ready to copy into `dist/`. Drop-in steps are in `procedural-models-ADOPT.md`.
- `index.html` + `gallery.js` is the gallery. Views:
  - `?view=grid&page=0|1`: turntable, three yaw angles × 6 props
  - `?view=compare&page=0|1`: current dist model above the new one
  - `?view=scene`: 3×3 raft with all crafts and floating debris, current on the left, new on the right
  - `?view=stats`: per-model cost
  - `?view=spin`: live turntable
- `shoot.py` is the headless check. Run it from the repo root with `python sandbox/procedural-models/shoot.py
  [view...]`. It writes `shots/{grid_0,grid_1,compare_0,compare_1,scene}.png` and `shots/stats.json`. The PNGs are
  gitignored, so regenerate them locally.
- `deck-study.*` is the earlier salvage experiment on the deck tile (bake+merge, grid AO, instancing), kept for
  reference. Its numbers are in `shots/deck-study-stats.json`.

## What was wrong with the current models

- **No shared look.** Each builder (`crafts.js`, `debris.js`, `plastic.js`, `deck.js`) has its own detail
  level and its own way of colouring: canvas-textured wood, procedural vertex-colour wood grain, smooth lathes,
  translucent decals. Up close they look like different artists made them.
- **Very dense for what you see.** The sail is 22k triangles, the net 17.6k and the crate 10k. A floating barrel
  is 3.6k triangles in 8 meshes.
- **Many draw calls and materials.** Each item and craft creates its own materials, one per colour, so a 3×3
  raft scene has 78 materials and 137 meshes. Every pickup and rebuild disposes those materials and creates new
  ones.

## Approach

Faceted low-poly built from a small kit. Every object is merged into one geometry per material, and all objects
share 4 materials.

| Kit piece | What it does |
|---|---|
| `box(w,h,d,bevel)` | Chamfered box, 44 tris. The bevel strips are flagged so they can be painted 10% lighter. That "toy edge" highlight does most of the charm work. |
| `lathe`, `cyl`, `cone`, `ico`, `torus`, `tube` | Low-segment primitives (6–10 radial, 3–4 for rope). The lathe gets a phase offset so a flat faces the camera. |
| `blade(len, wid, {fold, droop, serrate})` | V-folded leaf strip. Used for pinnate leaflets on the palm and the leaf bundle. |
| `sheet(w, d, nx, nz, fn)` | Deformable grid. Used for sail canvas, corrugated scrap and the pennant. |
| `jitter(g, amt, seed)` | Offsets each vertex by a hash of its own position, so coincident vertices move together and solids stay watertight with no welding pass. |
| `parts().add(geo, colour, {at, rot, from/to, jitter, tint, paint})` | Transforms, then paints vertex colours **per quad** (pairs of consecutive triangles). Each facet gets a small hash-based brightness variation (`tint`). The `paint(colour, centroid, normal)` hook handles end grain, stave stripes, labels, rust and leaf gradients. |
| `parts().build({y0, y1, lo})` | Merges to one non-indexed geometry with flat normals, then applies a cheap baked "AO": a vertical darkening gradient plus darker down-facing faces. |
| `materials` | `lp-solid` (vertex colours), `lp-cloth` (double-sided), `lp-glass` (lantern glass, emissive, transparent) and `lp-glow` (unlit flame). All are flagged `userData.shared`. |
| `PALETTE` | About 50 named colours (wood ramps, rope, leaf ramp, steel/rust, jug, canvas, clay, brass), tuned a little warmer and more saturated to survive ACES tone mapping. |

Why not use the salvage's grid-AO bake or instancing (see `deck-study.js`)?
- Grid AO looked good but took about 330 ms per deck tile. `rebuildRaft()` rebuilds every tile on each edit, so
  that is too slow.
- Instancing would beat merging on draw calls for the deck. But the game's contracts are "one Group per
  tile/item/craft, disposable", and instancing would need a raft-level rewrite. One merged mesh per object gets
  most of the win with no contract changes. Instancing the deck stays a possible later step: about 5 calls for
  the whole raft instead of 1 per tile.

Paint per quad, not per triangle. The first version painted per triangle and got checkerboards on jittered
boxes and lathes. The barrel also showed a float-boundary flicker in its stave index. Both are fixed, as the
screenshots show.

## Results

SwiftShader (`--use-angle=swiftshader`). Treat timings as relative only. "calls (+shadow)" counts the main
pass plus the sun shadow pass. three.js resets `renderer.info` after the shadow pass, so the gallery resets it by
hand to count both. "x16" means 16 separately built copies rendered together at 640×360 with shadows, which is
how the game uses them (one build per tile, item or craft).

| model | set | tris | meshes | materials | calls (main) | calls (+shadow) | build ms | x16 calls | x16 tris | x16 frame ms |
|---|---|---|---|---|---|---|---|---|---|---|
| plank | current | 244 | 2 | 2 | 2 | 4 | 1.8 | 64 | 7808 | 1.83 |
| plank | **new** | 304 | 1 | 1 | 1 | 2 | 27.9* | 32 | 9728 | 0.39 |
| barrel | current | 3556 | 8 | 7 | 8 | 16 | 5.5 | 256 | 113792 | 3.17 |
| barrel | **new** | 656 | 1 | 1 | 1 | 2 | 0.9 | 32 | 20992 | 0.39 |
| jug | current | 2405 | 7 | 6 | 8 | 15 | 8.2 | 240 | 77040 | 8.08 |
| jug | **new** | 352 | 1 | 1 | 1 | 2 | 0.5 | 32 | 11264 | 9.76* |
| leaf | current | 4464 | 6 | 6 | 6 | 12 | 5.8 | 192 | 142848 | 1.18 |
| leaf | **new** | 1236 | 1 | 1 | 1 | 2 | 2.8 | 32 | 39552 | 0.09 |
| scrap | current | 808 | 3 | 3 | 3 | 6 | 0.8 | 96 | 25856 | 0.99 |
| scrap | **new** | 344 | 1 | 1 | 1 | 2 | 1.4 | 32 | 11008 | 0.16 |
| crate | current | 10260 | 3 | 3 | 3 | 6 | 64.2 | 96 | 328320 | 0.92 |
| crate | **new** | 1856 | 1 | 1 | 1 | 2 | 5.8 | 32 | 59392 | 0.16 |
| sail | current | 22464 | 9 | 9 | 9 | 18 | 201 | 284 | 718752 | 3.68 |
| sail | **new** | 1794 | 2 | 2 | 2 | 4 | 4.1 | 64 | 57408 | 0.53 |
| palm | current | 8996 | 11 | 11 | 11 | 22 | 9.4 | 352 | 287872 | 3.32 |
| palm | **new** | 2952 | 2 | 2 | 2 | 4 | 31.1* | 64 | 94464 | 0.85 |
| lantern | current | 6028 | 8 | 8 | 9 | 15 | 7.1 | 240 | 189440 | 5.10 |
| lantern | **new** | 1048 | 3 | 3 | 4 | 5 | 2.5 | 80 | 32640 | 1.65 |
| deck tile | current | 4620 | 7 | 7 | 7 | 14 | 35.4 | 220 | 147232 | 1.53 |
| deck tile | **new** | 1720 | 1 | 1 | 1 | 2 | 3.4 | 32 | 53400 | 0.08 |
| net | current | 17660 | 5 | 5 | 5 | 10 | 87.4 | 160 | 565120 | 2.00 |
| net | **new** | 1536 | 1 | 1 | 1 | 2 | 1.9 | 32 | 49152 | 0.90 |
| bench | current | 5248 | 3 | 3 | 3 | 6 | 68.7 | 96 | 167936 | 1.18 |
| bench | **new** | 936 | 1 | 1 | 1 | 2 | 3.0 | 32 | 29952 | 0.08 |

\* These are noise. Build ms is the mean of 4 builds and includes GC pauses. In node, the plank builds in about 2 ms
warm and the palm in about 17 ms. The jug x16 frame ms is an outlier: its triangle and call counts are 7× and 7.5× lower.
Build times for the current crafts were similarly spiky (sail 30–200 ms between runs).

**Raft scene** (`?view=scene`: 9 tiles, 6 crafts, 7 floating items, water, shadows, 800×620 viewport):

| | draw calls (main + shadow) | triangles | meshes | materials | frame ms | build ms |
|---|---|---|---|---|---|---|
| current | 271 | 251,208 | 137 | 78 | 6.54 | 612 |
| **new** | **52** | **56,606** | **27** | **5** | **1.45** | 410 |

`renderer.info` after the scene run: programs 8 (current) and 9 (new), textures 7 and 8 (the gallery keeps the
current wood textures alive). The new set adds 0 textures and 4 programs in total.

**In-game check.** I applied the ADOPT steps to a scratch copy of `dist/` and ran the repo's `shoot.py` game probe:
no page errors, no console errors, and floor, items, hands and HUD all intact. The probe's frame average was
586 ms (new) against 1053 ms (current) on SwiftShader. That probe is very noisy and the two runs did not happen
under identical load, so it is only a sanity check.

## Look: verdict from the screenshots

- **Clearly better:** crate (chunky framed box with bevel highlights), barrel (clean alternating staves, proud iron
  hoops), bench, sail (the red centre stripe and patch give it a personality), the palm pot, and the whole-raft
  cohesion in `scene.png`: one palette, one edge treatment.
- **About equal:** leaf bundle and palm fronds read as palm, with more of a "paper craft" feel. The jug reads clearly
  as a milk jug, with a label band and a faceted body.
- **Weaker than current:** the deck tile from directly above has less micro-detail than the textured grain planks.
  The lashings and logs barely show. The net is thinner and less "rope-y". From one angle the plank's broken end
  can read as a fork.

## Decision

Adopt `lowpoly-props.js` for all four builder modules (deck, debris, plastic, crafts). It is a one-file drop-in
with the same contracts. It cuts triangles by about 4.4× and draw calls by about 5× on a typical raft, and
materials from 78 to 5. The only `game.js` change besides the imports is one guard in `disposeGeometry` so shared
materials are not disposed. Later, if raft size grows: instance the deck tile (salvage mode `c` showed 5 calls for
25 tiles).

## Known weaknesses / follow-ups

- No real AO. The vertical gradient is a fake, so contact shadows between parts (crate slats, plank-on-log) rely on
  the shadow map alone.
- The deck needs more top-down interest. Options: darker gaps (paint the side faces darker), visible rope lashings
  over the plank tops, an occasional split plank like the current version.
- The `drift` and `woodDark` deck planks are high-contrast against the pale planks in first person
  (see game probe `08-walked.png`). Tune the tone weights if it looks busy.
- Glass and flame are 2 extra draw calls per lantern, and glass is transparent-sorted. That is fine for a few
  lanterns.
- The scrap rust is painted per facet with a sine noise and can look patchy or "painted" rather than corroded.
- Build time is dominated by JS allocation (Vector3s, per-part geometries). It is fine for one item per spawn. If
  that ever matters, cache one geometry per (type, seed mod N) and clone it. Then `disposeGeometry` must skip
  those too.
