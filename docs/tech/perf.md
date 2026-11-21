# Performance on current main: measurements and ranked findings

Topic owner: perf (engine-tech fleet). Tools: `sandbox/perf/`. Drop-in steps: `docs/tech/perf-ADOPT.md`
(patch: `sandbox/perf/adopt.patch`, generated from exact anchors by `make_adopt.py`). Re-profiled on
`claude/raft-tech` at main **before 8d21618** (game.js 1780 lines: islands, wildlife, sailing, diving, day/night,
co-op, quality.js tiers, merged deck). **Base labels:** every frame-cost number (poses, bisection, A/B tables) is from
that base. Main then moved to **8d21618** (game.js 2284 lines; ocean.js foam system; live.js PRELOAD; wood.js without
the bump map). The adopt patch, its anchors, the rebuild-CPU table, the node tests, the perf gate, the race check and
the playtest were redone on 8d21618 and are labelled so.

**Summary.** Main already took the first study's draw-call fixes: a fresh raft now draws **153** times per frame with
the shadow pass counted (it was 542), a 49-tile raft with 12 decorations 251 (was 1026). Draw calls are no longer the
problem anywhere in the game: the content island adds 10, wildlife 3, sailing 7, night and underwater fewer than day.
What is left is pixels and hitches:

1. **The raft's pixels are 57% of the frame's raster at spawn and 80% on a 49-tile raft** (hiding it). Inside that:
   **MSAA is 35% of the whole frame** (same frame without it), and the plank **bump map, though sampled through an
   isotropic twin since 892db6d, is still 14%** (11% on the big raft, 18% once MSAA is off) while changing no pixel by
   more than 8/255. Main 8d21618 has since dropped the bump map (wood.js cites this study); adopt step 4 makes the
   `low` preset drop MSAA.
2. **The ocean is 24%** of raster at spawn (water topic's area; nothing proposed here).
3. **Every build rebuilds the whole raft**: `rebuildRaft()` regenerates every deck tile and every decoration model
   on every floor, decoration, synced world change and save load: ~510 ms of CPU on a 49-tile raft with 12
   decorations (node, loaded box; ~500 ms on 8d21618 too), seconds of wall clock in the headless game. Adopt step 1
   makes it incremental: one tile (19-33 ms) or one model, and nothing at all for the deck when only decor changes.
4. **live.js can mount two engines** when two update checks overlap (reproduced: 2 render loops left running).
   Adopt step 3 is a one-line fix.

The adopt patch, measured end to end on a temp copy of dist (`verify_adopt.py`), is in "The adopt patch, measured".

## How it was measured

Same method as the first study, on the real `dist/` with nothing in it modified:
`python sandbox/perf/shoot.py` runs the game headless (Chromium + SwiftShader, 1280x720, pixel ratio 1) with
`sandbox/perf/probe.js` injected before load. The probe seeds `Math.random` (three's uuids get their own stream),
replaces `performance.now()` with a frame clock that stops 40 frames after Play (a frozen, repeatable scene), and wraps
the renderer. CPU cost is read from `/proc/<pid>/stat` for every Chromium process the run started: **GPU-process CPU
ms per frame** is SwiftShader rasterising (it stands in for GPU cost; relative only), **renderer CPU** is JS, three.js
and WebGL command encoding. Each measured frame ends with `gl.finish()` and a 1-pixel `readPixels`. The box was shared
with other agents at load average 30-50 on 4 cores, so wall-clock times are not reported as costs.

New in this round:
- **Draws per owner and pass.** The probe wraps `renderer.renderBufferDirect`, which every draw goes through (main
  pass, shadow pass, and extra passes such as diving's underwater overlay), and attributes each draw to the scene child
  that owns it. `draws` in the tables below are these counts; they equal `renderer.info.render.calls` (main resets info
  by hand before render now, so it counts the shadow pass too).
- **Poses** (`--pose`): `spawn`; `island` (raftDebug.content.islands.spawnNear, camera on deck facing it); `night`
  (daynight.setPhase(0.85), clear, frozen); `sailing` (save with `world.sailing.raised`, world run 6 s first);
  `underwater` (swimAt, hold C 2.5 s, look along the seafloor); `--big` loads a 49-tile raft with 12 decorations
  (2 sails, 2 palms, 2 lanterns, 2 nets, 2 benches, 2 crates). Setup steps that need game time run the clock on at a
  quarter pixel ratio (`P.advance`), then freeze it again.
- **One-page A/B** (`--multi`): every fix or diagnostic is applied, measured, screenshotted and undone in the same
  page, then `baseline-2` re-measures the untouched scene. baseline vs baseline-2 is the run's noise: +1% at spawn,
  +0% island, +2% night, +7% on the 49-tile raft by day, +5-7% underwater and sailing. Differences inside that are
  not findings.
- `--noaa` creates the game's context without MSAA (an init script overrides `getContext` for `#world`).
- Look checks: `imgdiff.py` mean absolute difference over the deck strip (0-255) and the share of pixels off by more
  than 8/255, on frozen-scene screenshots (baseline vs baseline-2 is 0.00).

## What is in a frame now

Fresh 9-tile raft at spawn, 30 floating supplies, hook in hand (`shoot.py --multi`, `tables.py --owners`):

| owner | main pass | shadow pass |
|---|---|---|
| floating items (30) | 61 | 0 (main: `castShadow = false`) |
| viewmodels (hands + hook) | 48 | 0 |
| 12 far islands (baked) | 15 | 0 |
| raft deck (`raft-floors`, merged) | 7 | 5 |
| 24 clouds (baked) | 8 | 0 |
| sailing fixture (anchor, steering) | 0 | 4 |
| wildlife (instanced gulls, fish) | 3 | 0 |
| ocean, smoke | 2 | 0 |
| **total** | **144** | **9** |

153 draws, 113k triangles, 38 programs, 15 textures, 161 geometries. On the 49-tile raft the decorations add 102
draws (palms 11 + 22 shadow, lanterns 16 + 6, sails 3 + 20, benches, crates, nets) for 251 in all; triangles go to
470k (the deck alone is 487k vertices, non-indexed, at 49 tiles; a sail model is 67k vertices) and the shadow pass
draws 207k of them.

### Poses

| pose | draws (shadow) | triangles | submit ms | renderer CPU ms/frame | GPU-process CPU ms/frame |
|---|---|---|---|---|---|
| spawn, 9 tiles | 153 (9) | 113k | 3.3 | 15.0 | 1127 |
| content island docked, 9 tiles | 121 (11) | 103k | 3.8 | 17.8 | 811 |
| underwater, 9 tiles | 72 (9) | 65k | 2.3 | 31.9 | 385 |
| spawn, 49 tiles + 12 decorations | 251 (73) | 470k | 10 / 3.9 | 28.3 | 2569 |
| night (lantern lights on), 49 tiles | 238 (58) | 461k | 4.6 | 30.0 | 2519 |
| sailing, 49 tiles | 250 (71) | 470k | 3.7 | 25.6 | 2506 |

- **Island**: the island itself is 10 draws (7 instanced vegetation/rock/sand meshes + 2 in the shadow pass, plus the
  lagoon); hiding it changes raster by +3% (noise). Its view simply has less deck on screen than spawn.
- **Night** costs the same as day: stars, moon and the lantern pool lights are cheap next to the deck; the shadow pass
  loses 15 draws.
- **Sailing** renders the same as the parked big raft (the drifting islands and clouds are the same baked meshes).
  Main-thread game logic while sailing on the big raft measured 1.4-10 ms per frame in live runs (load-dominated).
- **Underwater** is the cheapest pose: the ocean surface is hidden, the seafloor is 8 instanced draws and the overlay
  pass 1. Nothing to fix.

## Where the time goes (spawn, 9 tiles; bisection and fixes in one page)

| scenario | draws (shadow) | GPU-process CPU ms/frame | Δ raster | pixel diff deck / changed px |
|---|---|---|---|---|
| baseline | 153 (9) | 1127 | | |
| hide raft (deck) | 141 (4) | 479 | **-57%** | diagnostic |
| no MSAA (`--noaa`, separate page) | 153 (9) | 729 | **-35%** | 1.14 / 2.4% (edges) |
| hide ocean | 152 (9) | 856 | -24% | diagnostic |
| pixel ratio 0.85 (a quality.js level) | 153 (9) | 961 | -15% | 2.17 / 3.6% |
| **wood without bump map** | 153 (9) | 974 | **-14%** | **0.01 / 0.0%** |
| hide floating items | 92 (9) | 1046 | -7% | diagnostic |
| hide viewmodels | 105 (9) | 1078 | -4% | diagnostic |
| shadows off | 144 (0) | 1120 | -1% | 0.00 / 0.0% (nothing visible is shadowed at spawn) |
| 512 shadow map | 153 (9) | 1128 | 0% | 0.00 / 0.0% |
| hide far islands + clouds | 130 (9) | 1157 | +3% | diagnostic |
| no fog | 153 (9) | 1223 | +9% (recompiled programs; noise) | sky only |
| no MSAA + no bump | 153 (9) | 595 | **-47%** | 1.15 / 2.4% |
| baseline-2 | 153 (9) | 1142 | +1% | 0.00 |

49-tile raft (noise +7%): hide raft -80%, wood without bump -11%, lantern pool lights out of the scene -7% (night pose:
-6%, noise +2%), 512 shadow map -7% (noise), shadows off -5%.

Main thread at spawn: renderer-process CPU 15 ms/frame, median `renderer.render` submit 3.3 ms, game logic
(`frame()` minus render) 1.3-1.6 ms. The CDP profile shows the main thread waiting on the GPU process most of the time;
of the JS that runs, nothing stands out (the old per-object three.js overhead went with the draw calls). Per-frame
uploads are ~17 KB (`bufferData` from three's `projectObject`, dynamic attributes). `raftDebug.state`, the big
diagnostic getter, is read every 100 ms by prompts.js and every 250 ms by onboarding.js: 0.015 ms per read at spawn,
1.6 ms on the sailing big raft under load, i.e. well under 1% of the main thread. Not worth a change.

## Hitches: every build rebuilds the raft

`rebuildRaft()` (game.js 491) disposes every child of the raft and builds the deck (`createRaftMesh` over every tile)
and every decoration model again. It runs on every floor, every decoration, every guest world update that changed tiles
or decor, every load and every hot swap. `node sandbox/perf/floorcost.mjs` (process CPU time; load average ~40, so
roughly 2x a quiet machine):

| raft | stock deck rebuild | 12 decoration models | patched: one new tile | patched: decoration placed |
|---|---|---|---|---|
| 9 tiles (old base / 8d21618) | 57 / 53 ms | 308 / 253 ms (first build) | 13 / 10 ms | 0 ms deck work |
| 25 tiles | 277 / 183 ms | 206 / 176 ms | 33 / 12 ms | 0 ms |
| 49 tiles | 309 / 319 ms | 205 / 183 ms | 33 / 19 ms | 0 ms |

Per decoration model (`createCraft`, 5-run average): sail 46 ms (67k vertices), palm 18 ms, net 16 ms, crate 12 ms,
bench 11 ms, lantern 6 ms. The patched deck is vertex-for-vertex the stock one (`sameGeometry: true`,
`deck-cache.test.mjs`). In the game, `playtest.py --big` (5x5 raft, 8 decorations, clicks with the hammer and
placing decor; wall-clock handler time on the loaded box, compare only stock against patched):

| click handler ms | stock dist | patched dist |
|---|---|---|
| 4 floors | 2995, 1153, 545, 1352 | 61, 123, 630, 294 |
| sail, lantern, crate, palm | 7565, 3820, 462, 2058 | 513, 795, 24, 40 |

Adopt step 1 keeps each tile's generated geometry (CPU only; +0.3 MB of JS per tile, 14.8 MB at 49 tiles, GPU memory
unchanged), returns the same deck group while the tile list is unchanged, and keeps a decoration's model while its
save entry is unchanged (sailing, watering, daynight and progression re-find their models after a rebuild, so they
work unchanged: perf-ADOPT.md step 1).

## Old findings, now

| first-study finding | status on main | in this patch |
|---|---|---|
| floating items cast shadows nobody sees | **done**: `syncItems` sets `castShadow = false` | - |
| shadow camera covers ±25 m of sea | **done**: `fitShadow()` fits the box to the raft (8-25 m), re-fitted on rebuild | - |
| 512² map while the raft is small | **obsolete**: quality.js picks 1024/512 per level; 512 measured 0% at spawn | - |
| 192 static island/cloud meshes | **done**: `bakeGroup`/`mergeStatic`, non-casting, still drift with sailing | - |
| deck is 7 meshes per tile | **done**: deck.js `createRaftMesh` merges all tiles (7 meshes) | - |
| every build regenerates every tile | **still applies**, and decor models are rebuilt too | step 1 (deck-cache.js + decor reuse) |
| wood bump map, 3 taps per pixel | **done on 8d21618**: isotropic twin first (892db6d, the bump still cost -14% here), then dropped | (was step 4 on the old base) |
| `renderer.info` hides the shadow pass | **done**: game.js resets info by hand before render | - |
| dynamic resolution (`?dynres` overlay) | **done better** by quality.js (pixel ratio, shadow map size, shadows off; backoff) | old controller removed |
| F3 perf overlay | **still useful**, not on main | step 2, reads `quality.describe()` |
| live.js double mount | **still present** (`live_race.py`: 2 swaps, 2 render loops) | step 3 (one line) |
| shadow map at 10 Hz | rejected then, still not needed (shadows off is -1% at spawn) | - |
| anisotropy 1 on the colour map | rejected (planks blur) | - |
| 60-mesh hook viewmodel | **still open**: 48 draws for hands + hook (viewmodel topic) | - |
| leaf debris 4.5k triangles, 83 item materials | **obsolete**: items are 61 draws for 30 items, 14 materials | - |
| JS heap +10-40 MB per hot swap | **still there**: +26-32 MB per swap in the playtests, stock and patched alike (old `game.js?build=` modules stay loaded) | - |
| `merge.js` / `createStaticBatch`, `combine.py` | **obsolete** (main merges the deck and scenery itself; the other topics' old ADOPT quotes no longer apply) | deleted |

## Ranked findings (current main)

| # | finding | evidence | fix | gain | looks | where |
|---|---|---|---|---|---|---|
| 1 | Full raft rebuild on every build / decor / synced change / load | 309 ms deck + 205 ms decor CPU at 49 tiles; click handlers 0.5-7.6 s headless | incremental deck + decor reuse | one tile (33 ms) or one model; 0 deck work for decor | identical | step 1 |
| 2 | MSAA on every `devicePixelRatio < 1.5` screen | -35% raster without it | `low` preset creates the context without MSAA | -35% on `low` | edge aliasing on `low` | step 4 |
| 3 | Plank bump map still sampled (through the twin) | -14% spawn, -11% big, -18% no-MSAA | drop it | as measured | 0 px > 8/255 | **done on 8d21618** |
| 4 | live.js double mount on overlapping checks | 2 swaps, 2 render loops | re-test `state.updating` after the await | no orphaned engine | none | step 3 |
| 5 | Ocean is 24% of raster | hide-ocean | water topic | - | - | water |
| 6 | Lantern pool lights stay in the scene by day | -7% big raft by day (noise 7%), -6% at night | out of the scene while dark (three caches both program variants) | small | none | proposal for daynight (contradicts its `P2-1` test) |
| 7 | Item icons use a second WebGL context | perf gate on the old base: `webglContexts 2 > budget 1` | 8d21618 releases it after 60 s idle and the gate budgets a peak of 2 live contexts | - | - | **handled on 8d21618** |
| 8 | Viewmodel is 48 draws | per-owner draws | merge rigid segments per bone | ~40 draws | none | viewmodel topic |

## The adopt patch, measured

`python sandbox/perf/verify_adopt.py` (temp copy of dist; stock vs patched):

RESULTS_PLACEHOLDER

## The perf gate (tests/e2e/perf_gate.py)

On the old base the gate could not boot (its `#solo` locator timed out behind the title menu), failed
`webglContexts 2 > 1` on stock (item-icons.js's own renderer) and still budgeted ~550 draws while main drew 147.
8d21618 fixed all three: it boots through `harness.START_SELECTORS`, budgets the icon context as a peak of 2 live
contexts, and recalibrated draws to p50 165 / p95 178 / max 185. Stock vs patched on 8d21618: see "The adopt patch,
measured". The Python audits in `tests/audit/` still click `#solo` with a locator; `verify_adopt.py` runs copies with a
JS click.

## Weaknesses of this study

- SwiftShader on a shared 4-core box at load 30-50. CPU-time accounting removes most of it, but the noise is +1% at
  spawn and up to +7% on the big raft and in the sailing and underwater poses. Raster ratios on a real GPU will
  differ: MSAA and texture taps are far cheaper there; the rebuild hitch and the race are hardware-independent.
- Wall-clock times (click handlers, `raftDebug.state`) are only comparable within one run.
- Co-op rebuilds (a guest receiving a different raft) were checked by code reading and by the deck-cache unit test
  that removes and reorders tiles, not by a two-browser session.
