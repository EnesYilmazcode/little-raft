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
  - `?view=fp`: the same raft from first-person eye height (top) and a close top-down (bottom), current | new
  - `?view=hero&names=a,b,c`: 520 px close-ups, current above new
  - `?view=stats`: per-model cost
  - `?view=spin`: live turntable
- `shoot.py` is the headless check. Run it from the repo root with `python sandbox/procedural-models/shoot.py
  [view...]`. It writes `shots/{grid_0,grid_1,compare_0,compare_1,scene,fp,hero_0,hero_1}.png` and `shots/stats.json`. The PNGs are
  gitignored, so regenerate them locally.
- `deck-study.*` is the earlier salvage experiment on the deck tile (bake+merge, grid AO, instancing), kept for
  reference. Its numbers are in `shots/deck-study-stats.json`.

## Retarget to current main (read this first)

Everything below this section was measured against the **old** dist. Main has since gained its own model and
texture work, so the question changed from "lowpoly vs the old builders" to "does lowpoly still beat what main
ships now?". Short answer: **only for the crafts, only on cost, and as an option rather than a clear upgrade.**

What main has now:
- `deck.js createRaftMesh()` merges the whole raft floor into ~7 meshes, and the `?art` lane (`materials.js` +
  `textures.js`/`texgen/`) textures the deck, debris and jug through game.js `mat()`.
- `debris.js` / `plastic.js` items are 1–3 meshes, and floating items skip the shadow pass.
- `models.js` is main's own low-poly kit (docs/MODEL-STYLE.md). It feeds held items (hands.js) and HUD icons
  (item-icons.js), but not the world props.
- `crafts.js` is unchanged in cost: 3–11 meshes and up to 22k triangles per craft, per-call materials, and the art
  lane never touches it. Other lanes now read named craft parts (sailing furls `sailCloth`, day/night ramps
  `lanternGlow`, watering pivots the palm `trunk` and recolours `soil`).

`?view=compare4` (`shots/compare4_0.png`, `compare4_1.png`) puts current dist, current dist with `?art`, `models.js`
and lowpoly side by side. "c" = draw calls including the shadow pass, prop only:

| prop | current dist | models.js | lowpoly |
|---|---|---|---|
| plank | 244 t, 2 m, 4 c | 564 t, 2 m, 4 c | 260 t, 1 m, 2 c |
| barrel | 2,404 t, 2 m, 4 c | 844 t, 2 m, 4 c | 624 t, 1 m, 2 c |
| jug | 973 t, 2 m, 4 c | 464 t, 1 m, 2 c | 312 t, 1 m, 2 c |
| leaf | 1,280 t, 1 m, 2 c | 720 t, 2 m, 4 c | 1,224 t, 1 m, 2 c |
| scrap | 808 t, 3 m, 6 c | 396 t, 2 m, 4 c | 296 t, 1 m, 2 c |
| deck tile | 3,428 t, 7 m, 14 c (merged across the raft in game) | 2,060 t, 3 m, 6 c | 1,428 t, 1 m, 2 c |
| crate | 10,260 t, 3 m, 6 c | 2,712 t, 3 m, 6 c | 1,712 t, 1 m, 2 c |
| sail | 22,464 t, 9 m, 18 c | 737 t, 3 m, 6 c | 1,714 t, 3 m, 6 c |
| palm | 8,996 t, 11 m, 22 c | 4,676 t, 3 m, 6 c | 2,724 t, 5 m, 10 c |
| lantern | 6,028 t, 8 m, 14 c | 1,492 t, 5 m, 10 c | 950 t, 2 m, 3 c |
| net | 17,660 t, 5 m, 10 c | 2,628 t, 3 m, 6 c | 1,452 t, 1 m, 2 c |
| bench | 5,248 t, 3 m, 6 c | 1,576 t, 2 m, 4 c | 828 t, 1 m, 2 c |

The lowpoly sail and palm went from 2 to 3 and 5 meshes in this retarget, because they now keep the named parts
the sailing and watering lanes animate.

**Look, judged from the shots.** In turntable close-ups the current crafts hold up well: metal-cornered crate, round
lashed mast, smooth ringed palm trunk. Lowpoly is a coherent sidegrade, not an upgrade. In first person (the game
probe below) the current sail yard and mast read richer than the flat octagonal lowpoly spars. The lowpoly palm's
fronds are larger and droop over the neighbouring tiles. Lowpoly's crate, bench and lantern are about equal. The
`?art` deck and textured debris are better than the vertex-coloured lowpoly deck and debris, and adopting lowpoly
there would switch the art lane off for them. `models.js` is the most efficient for the sail, but its net (upright
frame) and palm (a sapling, no deck base) are different objects, made for icons and hands rather than world props.

**In-game, crafts only** (`adopt_check.py`, seeded Math.random so both builds get the same debris, 3×3 raft,
place sail/palm/lantern/net/bench/crate with real clicks, hammer one tile; renderer.info and a WebGL draw*() hook
agree within 3 calls):

| frame | stock calls / tris | lowpoly crafts calls / tris |
|---|---|---|
| spawn, sail ghost showing | 157 / 151,511 | 145 / 110,043 |
| all 6 decor + 10 tiles, facing the sail | 167 / 219,484 | 132 / 118,296 (−21% / −46%) |
| same, facing the palm | 121 / 190,370 | 84 / 93,562 (−31% / −51%) |

Programs went 54 → 56 (`lp-solid`, `lp-glow`). Geometries 331 → 281. There were 0 page errors on both builds, and
every cross-lane contract held. SwiftShader frame times at load ~25 were noise (1.6–2.1 s per frame on both) and
are not evidence either way.

**Low preset, tier mode** (`adopt_check.py --mode tier`: both builds on `graphics: 'low'`, so there is no shadow
pass): 120 → 111 calls and 129,668 → 90,166 triangles facing the sail; 75 → 63 calls and 101,522 → 65,432
triangles facing the palm. With no shadow pass the call saving halves, and most of what is left is triangles
(−30 to −36%). The patched build's placed crafts were the lowpoly ones (`sailSolid` present), with 0 errors and all
contracts intact.

**Decision (supersedes the one below).** Do not adopt the deck, debris or jug. For crafts, the saving is real but
moderate: 35 draw calls and ~100k triangles on a raft with all six crafts, about 6 calls and 12k triangles per
craft. The look is a sidegrade. Two ways to take it, both in `procedural-models-ADOPT.md` and both checked by
`adopt_check.py`:
- `--mode crafts`: always use lowpoly crafts (one import and one placement.js guard).
- `--mode tier`: use lowpoly crafts only on the `low` graphics preset. Detailed crafts stay the default, and weak
  machines get the cheap set.

The tier option is the recommended one, because it keeps the better-looking default. Be clear about its size,
though: on `low` it saves about 10 calls and a third of the triangles on a fully decorated raft. That is worth having
on weak GPUs, but it is not a headline win. Skipping the adoption entirely is a defensible call too. If the team would rather have one model source, the real follow-up is to make `models.js` the
world-prop builder (names and footprints matched to crafts.js), not to add lowpoly as a third style.

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
share 3 materials (`lp-solid`, `lp-cloth`, `lp-glow`).

| Kit piece | What it does |
|---|---|
| `box(w,h,d,bevel)` | Chamfered box, 44 tris. The bevel strips are flagged so they can be painted 10% lighter. That "toy edge" highlight does most of the charm work. |
| `lathe`, `cyl`, `cone`, `ico`, `torus`, `tube` | Low-segment primitives (6–10 radial, 3–4 for rope). The lathe gets a phase offset so a flat faces the camera. |
| `blade(len, wid, {fold, droop, serrate})` | V-folded leaf strip. Used for pinnate leaflets on the palm and the leaf bundle. |
| `sheet(w, d, nx, nz, fn)` | Deformable grid. Used for sail canvas, corrugated scrap and the pennant. |
| `jitter(g, amt, seed)` | Offsets each vertex by a hash of its own position, so coincident vertices move together and solids stay watertight with no welding pass. |
| `parts().add(geo, colour, {at, rot, from/to, jitter, tint, paint})` | Transforms, then paints vertex colours **per quad** (pairs of consecutive triangles). Each facet gets a small hash-based brightness variation (`tint`). The `paint(colour, centroid, normal)` hook handles end grain, stave stripes, labels, rust and leaf gradients. |
| `add(..., {vpaint, twist, alpha, occlude})` | `vpaint(colour, vertex, normal)` paints per vertex, so colour blends across facets (scrap rust, plank weathering, lantern glow). `twist: n` shades rope quads in a 3-step spiral so tubes and tori read as laid rope. `alpha` makes RGBA vertex colours. `occlude` marks a part as a contact-AO occluder (chamfered boxes are by default). |
| `parts().build({y0, y1, lo, contact, radius})` | Merges to one non-indexed geometry with flat normals (parts added with `smooth: true`, like the sail canvas, get averaged normals instead) and drops zero-area triangles (lathe/cone caps collapse onto the axis), then bakes AO into the vertex colours: **contact AO** (each vertex is darkened by other parts' oriented boxes that lie in front of its normal, cosine-weighted, quadratic falloff over `radius`), plus a vertical gradient and darker down-facing faces. Contact AO costs O(verts × occluders), about 2–4 ms per object. |
| `materials` | `lp-solid` (vertex colours), `lp-cloth` (double-sided) and `lp-glow` (unlit, transparent via vertex alpha: lantern candle, flame and glowing panes in one mesh). All are flagged `userData.shared`. |
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

SwiftShader (`--use-angle=swiftshader`). Treat timings as relative only; the last run was on a machine with load
average ~35 on 4 cores, so build ms and frame ms are especially noisy. "calls (+shadow)" counts the main pass plus
the sun shadow pass (the gallery resets `renderer.info` by hand so both are counted). "x16" means 16 separately
built copies rendered together at 640×360 with shadows, which is how the game uses them.

| model | set | tris | meshes | materials | calls (main) | calls (+shadow) | x16 calls | x16 tris |
|---|---|---|---|---|---|---|---|---|
| plank | current | 244 | 2 | 2 | 2 | 4 | 64 | 7808 |
| plank | **new** | 260 | 1 | 1 | 1 | 2 | 32 | 8320 |
| barrel | current | 3556 | 8 | 7 | 8 | 16 | 256 | 113792 |
| barrel | **new** | 624 | 1 | 1 | 1 | 2 | 32 | 19968 |
| jug | current | 2405 | 7 | 6 | 8 | 15 | 240 | 77040 |
| jug | **new** | 312 | 1 | 1 | 1 | 2 | 32 | 9984 |
| leaf | current | 4464 | 6 | 6 | 6 | 12 | 192 | 142848 |
| leaf | **new** | 1224 | 1 | 1 | 1 | 2 | 32 | 39168 |
| scrap | current | 808 | 3 | 3 | 3 | 6 | 96 | 25856 |
| scrap | **new** | 296 | 1 | 1 | 1 | 2 | 32 | 9472 |
| crate | current | 10260 | 3 | 3 | 3 | 6 | 96 | 328320 |
| crate | **new** | 1712 | 1 | 1 | 1 | 2 | 32 | 54784 |
| sail | current | 22464 | 9 | 9 | 9 | 18 | 284 | 718752 |
| sail | **new** | 1714 | 2 | 2 | 2 | 4 | 64 | 54848 |
| palm | current | 8996 | 11 | 11 | 11 | 22 | 352 | 287872 |
| palm | **new** | 2724 | 2 | 2 | 2 | 4 | 64 | 87168 |
| lantern | current | 6028 | 8 | 8 | 9 | 15 | 240 | 189440 |
| lantern | **new** | 950 | 2 | 2 | 2 | 3 | 48 | 29152 |
| deck tile | current | 4620 | 7 | 7 | 7 | 14 | 220 | 147232 |
| deck tile | **new** | 1524 | 1 | 1 | 1 | 2 | 32 | 49504 |
| net | current | 17660 | 5 | 5 | 5 | 10 | 160 | 565120 |
| net | **new** | 1452 | 1 | 1 | 1 | 2 | 32 | 46464 |
| bench | current | 5248 | 3 | 3 | 3 | 6 | 96 | 167936 |
| bench | **new** | 828 | 1 | 1 | 1 | 2 | 32 | 26496 |

Build time (node, warm, median of 20 seeds, noisy): deck ~7–10 ms, crate ~5–14 ms, palm ~5–10 ms, net ~3–7 ms,
lantern ~2 ms. Contact AO adds roughly 2–4 ms to the bigger objects. That is fine for one build per tile, item or
craft.

**Raft scene** (`?view=scene`: 9 tiles, 6 crafts, 7 floating items, water, shadows, 800×620 viewport):

| | draw calls (main + shadow) | triangles | meshes | materials |
|---|---|---|---|---|
| current | 271 | 251,208 | 137 | 78 |
| **new** | **50** | **51,596** | **26** | **4** (3 shared `lp-*` + water) |

Frame ms on the loaded machine was 5.79 (current) vs 1.44 (new). The new set adds 0 textures.

**In-game check.** I applied the ADOPT steps to a scratch copy of `dist/` and ran the repo's `shoot.py` game probe
(launch line changed to the brief's `executable_path`). There were no page errors and no console errors besides
SwiftShader ReadPixels notices. Floor, floating items, hands and HUD were all intact. The probe's frame average was 489 ms
(new) against 957 ms (current), back to back on the same loaded machine. That is a sanity check only.

## Look: verdict from the screenshots

- **Clearly better:** crate (chunky framed box, weathered grey-brown slats that separate from the deck, contact AO where slats meet the frame), barrel,
  bench, sail, palm pot, scrap (rust now creeps in from the torn edges and pools in the corrugation valleys
  instead of looking like painted patches), and the cohesion of the whole raft in `scene.png`.
- **About equal:** leaf bundle and palm fronds ("paper craft" palm). Jug. Plank: the broken end is now three
  touching splinters that taper to points, so it no longer reads as a fork from the end-on angle.
- **Deck:** calmer. Each plank is a blend on a woodMid→woodLight ramp (both slightly desaturated so the deck is
  less orange in first person) with its own value offset and a rare weathered or older board, instead of the old
  light/dark/grey barcode. About half the planks are two narrower boards of different tone, which gives eye-level
  views a second strip of value. Gaps are tighter and get contact AO on their sides. Rope lashings
  wrap over the edge planks and one middle plank at each log, so the log lines read from above and from first person.
  Faint grain slivers and the occasional split add top-down interest. In-game (`08-walked`, `02-spawn`) it reads as
  one warm deck. It still has less micro-detail than the textured current planks up close.
- **Net:** sturdy barked log frame (6.5 cm logs, end grain, the z logs lie on the x logs), cork floats on the
  corner lashings, and much more rope-like netting. Thick laid rope with spiral shading, strands sag into the middle, tie over the
  frame poles and have knots at every crossing. It is a little irregular, like a loose fishing net rather than the
  current tidy grid.
- **Lantern:** glass and flame are one unlit, translucent mesh (vertex alpha). The panes glow warm and brightest at
  flame height. It is 2 draw calls + 1 shadow, down from 4 + 1. In daylight the panes read as frosted rather than
  clear glass.

## Decision (old dist, superseded by "Retarget to current main")

Adopt `lowpoly-props.js` for all four builder modules (deck, debris, plastic, crafts). It is a one-file drop-in
with the same contracts. It cuts triangles by about 5× and draw calls by about 5.4× on a typical raft, and
scene materials from 78 to 4 (the 3 shared `lp-*` materials plus the water). The only `game.js` change besides the imports is one guard in `disposeGeometry` so shared
materials are not disposed. Later, if raft size grows: instance the deck tile (salvage mode `c` showed 5 calls for
25 tiles).

- **Polish pass (after review):** the sail canvas is smooth-shaded with no per-facet tint (7×12 sheet), so it
  reads as one bellied cloth instead of grey triangles. The crate slats are weathered grey-brown and the frame
  dark, so a crate stands out from the deck. The palm pot is plain terracotta (the "cream band" was the whole
  body row of the lathe, which made the pot look grey). Cost: scene triangles 50,218 → 51,596 (+2.7%, from the
  two-strip planks, partly offset by dropping ~3–7% zero-area cap triangles per mesh); calls, meshes and
  materials unchanged. The judge's game probe on a patched scratch dist gave the same results as before:
  0 errors, all 6 decor placed, build 9 → 10, 187 GL draws at spawn, 129 after decor and build (old 547 / 476),
  and programs flat at 12.

## Known weaknesses / follow-ups

- Contact AO uses oriented boxes of chamfered-box parts and of parts flagged `occlude` (logs, net poles). Curved
  parts (tubes, lathes) do not occlude, so rope does not darken what it sits on. It is a bake, so it does not
  cover contact between separate objects (a crate on the deck relies on the shadow map).
- The deck up close still has less micro-detail than the textured current planks. Instancing the deck would make
  a richer shared plank cheap.
- The net strands kink slightly at the knots and where they go over the frame (3-sided tubes on a Catmull-Rom
  path). It reads as rope, but it is less tidy than the current grid.
- The lantern panes look frosted in daylight. There is no see-through to a dark interior like the current lantern.
- Build time is dominated by JS allocation (Vector3s, per-part geometries). It is fine for one item per spawn. If
  that ever matters, cache one geometry per (type, seed mod N) and clone it. Then `disposeGeometry` must skip
  those too.
