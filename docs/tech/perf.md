# Performance: measurements and ranked findings

Topic owner: perf prototyper (engine-tech fleet). Prototype and tools: `sandbox/perf/`. Drop-in steps:
`docs/tech/perf-ADOPT.md` (patch: `sandbox/perf/adopt.patch`).

**Summary.** The game spends its frame in two places: draw-call submission on the main thread, and the
pixel shading of the textured, bump-mapped deck. About half of the draw calls do nothing visible. Floating items cast
shadows onto an ocean that cannot receive them. Static islands, clouds and deck tiles are drawn piece by piece.
The shadow camera covers 50 x 50 m of mostly open sea. Fixing those, plus dropping a wood bump map that turns out to be invisible,
cuts draw calls by 53% on a fresh raft (65% on a 49-tile raft), main-thread `renderer.render` time by about 40%,
renderer-process CPU by 21-36% and SwiftShader raster CPU by 37-40% (fresh raft / 49-tile raft). In frozen-scene screenshots the result is pixel-identical on the fresh raft
and 0.36% of pixels differ on the big raft, all at deck shadow edges. A second, hidden cost
is a hitch: `rebuildRaft()` regenerates every tile's procedural geometry whenever anything is built, about 300 ms
of CPU on a 49-tile raft. The adopt patch makes rebuilds incremental.

**With the other topics.** After procedural-models' low-poly props (which already cut draw calls from 542 to 188), the
patch still halves them (188 -> 99 on the fresh raft, 273 -> 124 on the 49-tile raft) and still removes the rebuild
hitch (the low-poly `createFloor` costs as much CPU as the old one). Its pixel-cost win does not carry over: that came
from the old textured, bump-mapped deck. Water and viewmodel do not change any of this. Order, conflicts and numbers:
`docs/tech/perf-ADOPT.md` section 8.

## How it was measured

`python sandbox/perf/shoot.py` runs the REAL `dist/` game in headless Chromium (SwiftShader, 1280x720, pixel ratio 1)
and injects `sandbox/perf/probe.js` before the game loads. No dist file is modified. The probe does the following:

- **Captures the game's renderer** through `Scene.prototype.onBeforeRender` (three's `render` is an instance
  property, so it cannot be patched on the prototype), then wraps `renderer.render`.
- **Counts the shadow pass.** three r170 calls `shadowMap.render()` *before* `info.reset()`, so the stock
  `renderer.info.render.calls` hides every shadow draw. The probe sets `info.autoReset = false` and resets before
  each frame. All draw-call numbers below include the shadow pass. The stock counter would show 326 instead of 542 at spawn.
- **Makes the scene deterministic.** `Math.random` is seeded (three's uuid generation gets its own stream, so builds
  that create a different number of objects still spawn the same sea). `performance.now()` is replaced by a frame clock
  that stops 40 frames after Play. Every scenario therefore renders the same frozen scene, and the same build
  screenshots pixel-identically run to run (checked: baseline vs baseline-2 is 0.00 mean diff).
- **Measures with CPU time, not wall time.** The machine was shared with other agents at load average 30 to 45 on
  4 cores, so wall-clock frame times swung by 2-3x and are not reported. `shoot.py` reads `/proc/<pid>/stat` for every
  Chromium process it started and reports CPU ms per frame for the **renderer** process (JS, three.js and WebGL
  command encoding) and the **GPU process**, where SwiftShader rasterises on the CPU, so it stands in for GPU cost.
  Each frame ends with `gl.finish()` and a 1-pixel `readPixels`, so frames do not pipeline.
- **submit ms** is the median main-thread time inside `renderer.render` without the GPU sync. It is still a wall-clock
  number, so it is noisy under load, but it is the closest proxy for what a real GPU machine spends on the CPU side.
- **Profiles JS with CDP.** `Profiler` sampling at 200 us and `HeapProfiler` sampling during 4 s of play.

Run-to-run noise of the CPU-time numbers on this machine is about ±5% (baseline 1366 to 1414 GPU ms/frame, renderer
22 to 24 ms). Treat differences under 5% as noise. SwiftShader numbers are relative only. A real GPU is roughly
100x faster at raster, so on real hardware the **draw-call / submit** column matters most and the raster column
shows where fill-rate goes on weak integrated GPUs.

## What is in a frame (fresh 9-tile raft, 30 floating items, hook in hand)

| owner | objects | meshes | shadow casters | vertex indices drawn | materials |
|---|---|---|---|---|---|
| camera(viewmodels) | 1 | 60 | 0 | 54,882 | 14 |
| ocean | 1 | 1 | 0 | 60,000 | 1 |
| raft (deck tiles + decor) | 1 | 62 | 53 | 123,876 | 7 |
| floating items | 1 | 163 | 163 | 232,584 | 83 |
| islands | 12 | 120 | 24 | 7,200 | 5 |
| clouds | 24 | 72 | 0 | 17,280 | 1 |
| **total** | | 478 | 240 | 495,822 | 111 |

main pass only: 326 calls; with shadow pass: 542

The main pass is 326 calls and the shadow pass 216 (542 total). Shadow casters are 163 item meshes, 53 deck meshes
and 24 island meshes; the hands and the ocean do not cast.
Observations:

1. **Floating items cause 163 of the 216 shadow draws, and nobody sees those shadows.** The ocean is a
   `ShaderMaterial` with `lights:false` (dist/ocean.js), so `ocean.mesh.receiveShadow = true` (game.js:290) has no
   effect. Items carry 83 distinct materials, because every plastic jug and every metal part of a barrel or scrap gets
   its own `MeshStandardMaterial`.
2. **The deck is 62 meshes for 9 tiles.** `createFloor` already merges within a tile (one mesh per material), but not
   across tiles. A 49-tile raft is about 340 deck meshes, about 630 draws with shadows.
3. **Islands and clouds are 192 static meshes.** Most clouds are off-screen and culled, but the ones in view still cost a draw each.
4. **The hook viewmodel is 60 meshes** (hands.js builds each finger from segments). These are animated, so they cannot be baked
   like the rest. See follow-ups.
5. **Programs: 10, textures: 7 to 8.** Shader variety is fine. Each timber colour gets its own 128x512 canvas texture
   (wood.js). That is wasteful but small.

## Where the time goes

**Pixels (SwiftShader GPU-process CPU, 1375 ms/frame at baseline).** Bisection by hiding one owner at a time:
hiding the raft drops raster CPU from 1414 to 531 ms (-62%). In the earlier live-clock diagnostic runs, hiding
the ocean, the items or the viewmodel each changed it by less than 10%. The deck covers about a third of the screen with `MeshStandardMaterial` + colour map +
bump map + PCF-soft shadow receive + fog. Inside that cost:

- the **bump map**: removing it saves 34% at the spawn view and 40% looking straight down at the deck (1755 to 1061 ms),
  and changes no pixel by more than 8/255 in either view (`bumpScale` .018 is too small to show). It samples the texture
  3 extra times per pixel, through the colour map's `anisotropy = 4` sampler. Giving it its own `anisotropy = 1` sampler
  instead saves 15-20%.
- **anisotropic filtering** on both maps: setting 1 everywhere saves 28%, but planks blur at grazing angles
  (deck diff 0.76).
- **shadow receiving** on the deck: about 7% (live-clock diagnostic run). **The shadow pass**: turning shadows fully off saves only 6% of raster.
- **resolution**: pixel ratio 0.75 saves 31%. Raster scales with pixels as expected.

**Main thread (renderer process 22-24 ms CPU/frame, submit about 6-8 ms median).** The CDP profile (live-clock run, 4 s)
shows the main thread idle about 97% of the time (it waits on the GPU process). Of the JS that runs, nearly all is three.js per-object
work: `projectObject`, `setProgram`, uniform uploads (`copyArray`, `setValueM4`), `renderBufferDirect`. That cost
scales with draw calls. Game logic (`frame()` minus render) is about 1 ms per frame. The heaviest game function is
the CPU Gerstner `displace` (ocean.js), used by `getHeight`/`getSlope` for 30 items and the raft, at well under 0.5 ms.

**Allocations: not a problem.** Heap sampling shows 28-85 KB/s allocated (frozen and live runs), 87% of it attributed to `(IDLE_EXTERNAL)`
(browser internals). GC took 0.5% of the window. The per-frame `new Set`, spread `Math.max(...)`, `getSlope` objects
and `clone()` calls in game.js are real but small. Rewriting them would add risk for no measurable gain, so this
was not done.

**Hitches: `rebuildRaft()` rebuilds everything.** Every build, decor placement or network world change disposes and
regenerates all tiles (`createFloor`: ExtrudeGeometry per plank, about 6 ms CPU per tile in node), so about 50 ms at 9
tiles and about 300 ms at 49 tiles. A naive full re-merge would add about 1 ms per tile on top. The adopt
patch's `createStaticBatch` appends only new tiles, so placing anything costs about one tile of work.

## Fixes, one at a time (live A/B on the real game)

Each row is a fresh page with the fix applied to the live scene by `sandbox/perf/fixes.js`, same frozen scene, 12 measured
frames. Δ is against the baseline row. Screenshots are `sandbox/perf/shots/game-<scenario>.png`. "pixel diff" is
`imgdiff.py` against the baseline screenshot: mean absolute difference over the deck strip (0-255), and the share of
pixels off by more than 8/255.

| scenario | draw calls | Δ calls | triangles | submit ms (median) | renderer CPU ms/frame | GPU-process (SwiftShader) CPU ms/frame | Δ raster | pixel diff deck / changed px |
|---|---|---|---|---|---|---|---|---|
| baseline | 542 | +0 | 259k | 5.8 | 23.6 | 1414 | +0% | 0.0 / 0.0% |
| baseline-2 | 542 | +0 | 259k | 7.9 | 24.1 | 1398 | -1% | 0.0 / 0.0% |
| items-no-shadow | 379 | -163 | 181k | 7.2 | 20.5 | 1320 | -7% | 0.0 / 0.0% |
| shadow-fit | 398 | -144 | 190k | 7 | 24.5 | 1364 | -4% | 0.02 / 0.03% |
| shadow-10hz | 452 | -90 | 212k | 5.6 | 20.5 | 1346 | -5% | 0.0 / 0.0% |
| merge-scenery | 498 | -44 | 265k | 6.6 | 20.5 | 1354 | -4% | 0.0 / 0.0% |
| merge-raft | 460 | -82 | 273k | 6.3 | 21.4 | 1399 | -1% | 0.0 / 0.0% |
| wood-bump-aniso1 | 542 | +0 | 259k | 8.1 | 21.4 | 1201 | -15% | 0.0 / 0.0% |
| wood-aniso-1 | 542 | +0 | 259k | 7.6 | 17.7 | 1024 | -28% | 0.76 / 0.1% |
| wood-no-bump | 542 | +0 | 259k | 7.5 | 15.9 | 930 | -34% | 0.01 / 0.0% |
| dpr-0.75 | 542 | +0 | 259k | 6.5 | 16.4 | 980 | -31% | 2.84 / 5.49% |
| shadows-off | 326 | -216 | 146k | 6.9 | 21.4 | 1326 | -6% | 0.0 / 0.0% |
| hide-raft | 447 | -95 | 196k | 7.7 | 14.1 | 531 | -62% | 66.06 / 29.97% |
| all-safe | 253 | -289 | 202k | 4.8 | 15.5 | 1096 | -23% | 0.02 / 0.03% |

## The adopt patch, measured end to end

`python sandbox/perf/verify_adopt.py [--big]` copies `dist/`, applies `adopt.patch` and profiles stock vs patched.
The fresh raft is 9 tiles. The big raft is 49 tiles with 12 decorations (sails, palms, lanterns, nets, benches, crates), loaded from a save.

**Fresh 9-tile raft**

| build | draw calls | triangles | submit ms | renderer CPU ms/frame | GPU-process CPU ms/frame |
|---|---|---|---|---|---|
| stock dist | 542 | 259k | 8.5 | 23.6 | 1421 |
| patched dist | 253 | 202k | 5 | 15.0 | 889 |
| **change** | -53% | -22% | -41% | -36% | -37% |

pixel diff stock vs patched: deck 0.01, full 0.0, changed pixels 0.0%

**49-tile raft, 12 decorations**

| build | draw calls | triangles | submit ms | renderer CPU ms/frame | GPU-process CPU ms/frame |
|---|---|---|---|---|---|
| stock dist | 1026 | 685k | 10 | 24.1 | 3167 |
| patched dist | 362 | 721k | 6 | 19.1 | 1892 |
| **change** | -65% | +5% | -40% | -21% | -40% |

pixel diff stock vs patched: deck 0.22, full 0.09, changed pixels 0.36%

Screenshots: `shots/game-stock-baseline.png` / `shots/game-patched-baseline.png` and
`shots/game-stock-big-baseline.png` / `shots/game-patched-big-baseline.png`. I read all four. On the fresh raft they
are pixel-identical. On the big raft the only differences are the sail and palm shadow edges on the deck. The
512² fitted map is 4.3 cm per texel there against 4.9 cm before, so the edges are marginally crisper.

**Re-measured after the follow-up fixes** (scenery no longer casts shadows, the deck batch grows in place):
fresh raft 542 -> 251 calls, 49-tile raft 1026 -> 360, same screenshots. On top of procedural-models: 188 -> 99 and
273 -> 124 (`docs/tech/perf-ADOPT.md` section 8).

## Playtest of the patched game

`python sandbox/perf/playtest.py --dist <patched copy>` plays the real game headless with a seeded bag (hook, hammer,
sail, lantern, crate, palm, wood, plastic): three hook throws, floor tiles with the hammer, the four decorations, three
live.js hot swaps, then one more floor on the remounted engine. Run on the patched `dist/` and on
`combine.py pm vm perf water` (all four topics), with stock as reference:

| | patched dist | pm + vm + perf + water | stock |
|---|---|---|---|
| floors built by clicking, decor placed | 4 + 4 | 4 + 4 | 8 + 4 |
| geometries while building 4 floors | 306 flat | 177 flat | +7 per tile (each tile keeps its own meshes) |
| deck meshes | 7 | 1 | 7 per tile |
| deck built tile by tile == deck a fresh mount builds | yes (vertex sums identical) | yes | n/a |
| geometries / textures / programs after swaps 1-3 | 248/8/11, 247/8/11, 247/8/11 | 96/5/9, 95/5/9, 95/5/9 | 399/8/11 x3 |
| old-engine geometries left undisposed after a swap | none | none | none |
| page errors | none | none | none |

Screenshots (`play-<tag>-*.png`, read): deck, decor and sail shadows look the same as stock; the floor built after a
swap joins the deck seamlessly. Two things this found that are not caused by the patch:

- **live.js can mount two engines.** `check()` only sets `state.updating` inside `swap()`, after
  `await fetchManifest()`. Two overlapping checks (the 6 s poll plus a manual `raftLive.check()`, or the poll plus the
  `visibilitychange` reschedule) both pass the guard and both swap: one new engine is orphaned, keeps rendering into
  the same canvas and is never disposed (+170 geometries and +8 textures per occurrence; seen on stock too). The fix
  is a `checking` flag set before the first `await` in `check()`. playtest.py now lets the poll do the swaps.
- **The hook lands about 4.5 m out headless**, so the items (7+ m away) are never caught, on stock too: SwiftShader
  runs at 1-3 s per frame here and the game clamps `dt` to 50 ms, which shortens the throw. So pickup was not exercised here; the 30 items the
  patched `itemModel` builds at start render without errors, and pickup does not touch any patched code.
- With water's new ocean in, the open water between the old raft and a separately built row of tiles shows a bright
  white foam slab (`play-all-final-2-floors.png`). The same build without perf (`combine.py pm vm water`) shows it
  too, so it comes from the water topic's raft SDF foam, not from the deck batch.
- The JS heap grows by 10-40 MB per hot swap on stock and patched alike (probably the new `game.js?build=` module
  per swap, which the page never unloads). Not a GPU leak; worth a look by whoever owns live.js.

## Ranked findings

| # | finding | fix | gain | looks | effort |
|---|---|---|---|---|---|
| 1 | Wood bump map samples 3 extra taps per deck pixel through a 4x anisotropic sampler, and has no visible effect | drop `bumpMap` (adopted). Conservative alternative: its own `anisotropy=1` sampler, -15-20%. | -34% raster (-40% looking down) | none: 0 px > 8/255 | 1 line, wood.js |
| 2 | Floating items cast shadows onto an ocean that ignores lights | `castShadow = false` in `itemModel` | -163 calls (-30%) | none | 3 lines |
| 3 | Shadow camera covers ±25 m of sea | fit to the raft, 512² map while the raft is under 14 m | -144 calls on its own | deck shadows slightly crisper | 6 lines |
| 4 | Deck is 7 meshes per tile, and every build regenerates every tile | `createStaticBatch`: one mesh per material, incremental | -82 calls at 9 tiles, several hundred at 49; 300 ms hitch down to about 10 ms | none | merge.js + 8 lines |
| 5 | 192 static island/cloud meshes | `mergeMeshesByMaterial` once at init | -44 calls at the spawn view | none | 4 lines |
| 6 | No way to see any of this in game, and stock `renderer.info` hides the shadow pass | `perf-overlay.js` (F3), dynamic resolution behind `?dynres` | 0.75 pixel ratio = -28% raster when it kicks in | softer only while over budget | optional |

Rejected after measuring: shadow map at 10 Hz (-100 calls, but deck shadows step while the raft rocks; #3 gets most
of it without the artefact), anisotropy 1 on the colour map (planks blur, deck diff 0.76), a lower fixed pixel-ratio cap
(use #6's dynamic control instead). `all-safe` in the table is the runtime version of the patch with the
conservative bump sampler instead of dropping the bump map: -289 calls and -23% raster. The adopt patch measured above goes further.

## Instancing vs merging vs BatchedMesh (synthetic lab)

`sandbox/perf/synthetic.html` (salvaged, now with the overlay) draws a raft plus 240 floating supplies three ways:
`?mode=naive|instanced|batched`. Its conclusion holds for the real game. `InstancedMesh` only pays off when many
copies share one geometry. The real game's debris is procedurally unique per seed (debris.js `createDebris(.., {seed})`),
and deck tiles are unique per position (`createFloor(T, x * 719 + z * 311)`), so instancing them would mean giving up
that variety. Static merging keeps every vertex and needs no per-frame work. `BatchedMesh` (r170) can draw unique moving
geometries in one call where `WEBGL_multi_draw` exists. It is the right tool for floating items if 30 items ever
grow to hundreds, but it needs the 83 per-item materials folded into a few shared ones first.

## In-game overlay proposal

`sandbox/perf/perf-overlay.js` (adopt step 7). The API is `createPerfOverlay({renderer, maxPixelRatio, minPixelRatio, dynamic, key})`
→ `{begin(), end(), setDynamic(v), setMaxPixelRatio(v), pixelRatio, el, dispose()}`.

- When hidden it costs two `performance.now()` calls, two EMA updates and one `info.reset()` per frame: no DOM writes and no allocations.
  When shown it does one `textContent` write every 500 ms.
- It shows fps and frame ms from rAF gaps (what the player feels), p95 over 120 frames, main-thread ms between
  `begin` and `end`, draw calls and triangles **including the shadow pass**, live geometries, textures and programs (leak watch:
  they should stay flat while playing), heap MB, pixel ratio and shadow mode.
- **Dynamic resolution** works with hysteresis. The budget is the display's own refresh interval, measured as a slowly
  forgetting minimum rAF gap, so 60, 120 and 144 Hz screens all work. After 1 s with the frame EMA over 1.25x budget it drops the pixel
  ratio by 0.15 (floor 0.6). After 4 s under 1.08x budget it raises it by 0.1, never above the settings cap. The
  synthetic lab runs it live with `?dpr=auto`.

## Follow-ups not done here

- **Viewmodel draw calls** (60 meshes for the hook hands): skin the fingers, or merge the rigid segments per bone.
  This is hands.js work; the viewmodel topic's adopt keeps the 60 meshes, so it is still open there. Not touched here
  to avoid two topics editing hands.js at once.
- **Leaf debris is 4.5k triangles per item** (debris.js `buildLeaf`), and items have 83 unique materials. Solved by
  procedural-models: its items share 3 materials and are 1-2 meshes each, so nothing is left to do in perf.
- **One wood texture, tinted**, instead of 15 canvases (wood.js). This saves uploads and memory, but the grain strokes
  are alpha-blended over the base colour, so a tinted version would look slightly different. Art call.
- **Merged meshes lose per-object frustum culling.** On the big raft the patched build draws about 5% more triangles
  (the whole deck is always drawn) while issuing 65% fewer calls. That is the right trade at these sizes. Past about
  15x15 tiles, chunk the deck batch (one `createStaticBatch` per 4x4 tiles).

## Weaknesses of this study

- All timings come from SwiftShader on a heavily shared 4-core box. CPU-time accounting removes most of the load
  noise (repeat baselines agree within about 3%), but raster ratios on a real GPU will differ. On a discrete GPU the
  bump and anisotropy savings may be small, while the draw-call savings carry over directly.
- The frozen-clock method measures one camera pose (spawn, looking forward) plus one look-down pose. Views toward
  more islands or a crowded sea are not covered.
- Wall-clock `submit ms` is still affected by preemption. Read it as a direction, not a precise number.
- The runtime A/B (`fixes.js`) patches the live scene from outside. The adopt patch was verified separately, end to
  end, on a patched copy of `dist/`. `playtest.py` then played it headless (hammer floors, decor, hook, hot swaps; see
  below). Multiplayer rebuilds (guest receiving a different raft, `deckBatch.clear()`) were still only checked by
  code reading.
- A static 404 (favicon) shows in both stock and patched runs. It is not from this work.
