# Integration loop log

Each round: fetch, merge every claude/raft-* and claude/loop-* branch into claude/raft-master,
test + screenshot after each merge, gate, QA (bugs, detail, perf), push, refresh the PR to main.

## Round 1 — 2026-11-21

Created claude/raft-master from claude/raft-integration (d5419eb).

Merged (tests green and no page errors after each):
- raft-tests (fleet-gate.sh, grade-branches.sh, e2e harness)
- raft-content, content-daynight, content-islands, content-storage, content-wildlife
- raft-tech (sandbox only), raft-building-pieces, raft-controls, raft-onboarding, raft-sailing,
  raft-coop, raft-diving, raft-fishing-cooking (each twice: initial + later pushes)
- loop-ux, loop-features (specs), loop-perf (renderInfo, quality.js not wired yet)

Wiring done during merges:
- controls.js owns keyboard/mouse; building keys (Q/X/R with hammer) run before its early return,
  and mouse look is suppressed while the building wheel is open.
- sailing "hold R at a sail" routed through the controls repair callback.
- diving swim input reads the controls layer (jump/crouch/sprint/interact), not the bypassed keys[].
- Save/net state carries ext (content), pieces (building), sailing together.
- Removed index.html links to onboarding.js/css (lane has not pushed those files; they 404'd).
- shoot.py uses /usr/bin/google-chrome; fleet-gate perf check now calls perf_gate.py with its real CLI
  and a main baseline.

Skipped:
- raft-art: its own tests/art.test.mjs fails on the branch (planks seam check); WIP head.
- raft-progression: head commit has a syntax error in dist/game.js (try without catch).
- raft-reference: 800+ scraped stills of the commercial game; reference material, not game code.
  Kept out of the shipped build.

Measured (swiftshader, shoot.py): main 243 ms/frame avg, raft-master 444 ms. 555 draw calls,
263k triangles, 367 shadow casters. Perf is the main blocker for auto-merge.

QA round 1 (bugs, detail, perf reviewers read the screenshots):
- Fixed the black title screen: the diving seafloor plane started visible above the ocean.
- Fixed steered sails sticking on (now released by the rotate action on any device).
- Fixed hammer R/X also triggering hook repair, sail grab and the co-op point emote.
- Fixed blank icons for sand/clay/ore; fixed the crosshair, which was drawn 13px off centre.
- Open: the recipe list is clipped in the inventory and the lock badge covers icons (cosmetic).
- PR #1 opened. Not auto-merged: perf is outside 5% and the gate's playbot/visual/electron tools don't exist yet.

Perf QA round 1:
- Root cause: four daynight lantern PointLights sat in the scene at intensity 0 and still ran in every lit shader. They are now hidden until dusk and only when lanterns exist (-15%).
- Floating debris/plastic no longer cast shadows; the ocean never received them (-6%).
- shoot.py: 444 -> 361 ms. The remaining gap to main (243) is because shoot.py ends at a different camera pose on each branch. At the same pose the perf reviewer measured parity.
# Little Raft loop log

## 2026-11-21 · loop-features-202611210451 (features)
Base: origin/claude/raft-integration (d5419eb). Branch: claude/loop-features-202611210451.

Features (research in docs/features, specs in docs/specs):
- **Message bottles, logbook, achievements** — rare `bottle` debris with 12 original notes (read in order), 15 achievements awarded by the host with retroactive unlocks for old saves, logbook dialog on L plus a pause-menu button. Files: dist/logbook.js, dist/logbook-ui.js, dist/bottle.js.
- **Receiver, antennas, signal caches** — one receiver per raft, up to 3 spaced antennas sharpen bearing/range; a `cache` buoy drifts to hook range for a big haul; HUD pill + edge marker. State in `world.signal`. Files: dist/signal.js, dist/signal-models.js.
- **Purifier, cups, watering** — cup/saltcup/freshcup items, purifier decor (15 s), watered palm planters grow in 90 s and harvest for leaves (+ chance of wood). State in `world.garden` / `world.purifiers`; old saves seed existing palms ripe. Files: dist/watering.js, dist/purifier-model.js.

Fleet: 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA (13 agents).
Review fixes: last-bottle respawn, sanitized logbook progress on hot-swap fallback, cache parking out of hook reach on long rafts, signal marker DOM churn, phone inventory hotbar overflow, logbook toast overlapping the signal pill.
Checks: `npm test` 61/61 (was 22; npm test now runs tests/*.test.mjs); shoot.py `errors: []`.
Known limits: live two-peer co-op not run (PeerJS broker blocked from the sandbox; co-op reviewed by code). Older builds reject bags holding the new item kinds (mixed-version co-op unsupported; downgrading drops new decor).
Next ideas: nicer receiver model, ripe-palm cue, logbook tab height jump; more building pieces/decorations once the building-pieces lane lands.
# Little Raft improvement loop log

## Perf round 1, 2026-11-21 (branch `claude/loop-perf-202611210451`, base `origin/claude/raft-integration` d5419eb)

Probe: `tests/e2e/perf_gate.py` (new this round). Headless Chrome, SwiftShader, 1280x720, solo spawn,
`?pinQuality`. Draw calls and triangles count both main and shadow passes. Allocation figures come from
the CDP sampling heap profiler, including objects GC has already collected. Each value is the median of
2 alternating runs. BEFORE = 479cef3 (the original game plus debug counters), AFTER = 12df911 (the
hook-physics and nail-head commits landed after that measurement).

| phase | metric | before | after | Δ |
|---|---|---|---|---|
| idle | draw calls | 509 | 103 | -79.8% |
| idle | triangles | 222,501 | 120,566 | -45.8% |
| idle | shadow casters | 314 | 124 | -60.6% |
| idle | meshes | 662 | 168 | -74.6% |
| idle | geometries | 340 | 104 | -69.5% |
| idle | JS alloc KB/frame | 307 | 54.9 | -82.1% |
| idle | retained heap growth MB | 0.583 | 0.089 | -84.7% |
| idle | avg / p95 frame ms* | 906 / 1342 | 298 / 467 | -67.1% / -65.2% |
| walk | draw calls | 384 | 76.5 | -80.1% |
| walk | triangles | 168,816 | 82,727 | -51.0% |
| walk | JS alloc KB/frame | 250 | 46.4 | -81.5% |
| walk | avg / p95 frame ms* | 357 / 900 | 265 / 500 | -25.7% / -44.4% |
| hook | draw calls | 378 | 71.5 | -81.1% |
| hook | triangles | 165,755 | 80,558 | -51.4% |
| hook | JS alloc KB/frame | 213 | 80.7 | -62.0% |
| hook | avg / p95 frame ms* | 165 / 225 | 253 / 408 | +53.0% / +81.4% (noise, see note) |
| startup | solo click → 2nd frame ms | 805 | 422 | -47.5% |
| startup | transfer KB (solo) | 1801 | 1738 | -3.5% |
| startup | DOMContentLoaded ms | 325 | 331 | +1.8% |
| startup | to raftDebug ms | 830 | 1343 | +61.9% (one 1764 ms outlier; unproven) |
| — | shader programs | 10 | 13 | +30% (warm-up compiles all viewmodels up front) |

\*Frame times under software GL on a shared machine (load 10-13 on 4 cores) are noisy. BEFORE's hook
window came right after a very slow idle phase. Structural metrics (calls, triangles, allocation) are
the trustworthy ones. Perf gate on AFTER vs BEFORE: **PASS**.

What landed:
- **Merged meshes:**
  - raft deck: 62 → 7 meshes; lashings lighter and no longer cast shadows
  - leaves, barrels and jugs: vertex-colour merges with cached materials and geometry
  - islands and clouds: 192 meshes → 6, no shadows
  - hands and hook: 59 → 14 meshes; hammer and rod also merged
- **Less tessellation** on lashings, leaves, jug, barrel rivets, hook shank and grip, coil, hammer
  handle and bamboo.
- **Allocation fixes:**
  - three.js `setValueV1i` stores booleans as ints, which keeps the uniform caches unboxed (about
    150 KB/frame)
  - transparent DoubleSide materials use `forceSinglePass`, which stops per-frame program rebuilds
  - ocean sampling no longer allocates and gained `sample()`
  - HookCast and PlayerPhysics no longer allocate per frame
  - game loop scratch objects are reused; the inventory UI keeps a version counter and skips unchanged
    renders
- **Rendering:**
  - adaptive quality (`dist/quality.js`): an EMA steps pixel ratio, then shadow map size, then shadows,
    with hysteresis; the user's preset is the cap
  - shadow camera fitted to the raft
  - the ocean draws after opaque geometry; its shader skips fully faded pixels
  - MSAA only below 1.5 DPR
  - backdrop blur removed from HUD plates
  - only the held viewmodel is attached to the camera
- **Startup:** peerjs loads only for co-op, modulepreload, font `<link>` instead of `@import`, game
  import runs in parallel with version.json, shaders warmed with compileAsync.
- **Bug fixed along the way:** changing the graphics preset mid-game never toggled shadows, because
  flipping `shadowMap.enabled` does not recompile in r170.

Regression check (screenshots read pair by pair, plus hammer, rod, deck close-up, horizon and debris
close-ups): no regressions. The one cosmetic issue found, square nail heads, is fixed.

Rust/WASM: not worth it this round; see `docs/loop/rust-wasm.md`.

Next ideas:
- InstancedMesh pools for floating items
- `shadowMap.autoUpdate=false` with updates only on change
- lazy-build the hammer and rod viewmodels
- shared plank geometry for startup
- test the adaptive step-down visuals
- in-page timing for `toDebugMs`

## 2026-11-21 · integrator round 2
- Merged fleet-tech/procedural-models, water, perf (clean). Another integrator merged the rest of the clean branches in parallel.
- PR #1 review (2 reviewers, comments on the PR). Fixed both must-fix findings:
  - Crafted cup/saltcup/freshcup/purifier/receiver/antenna/seed/research items were dropped by migrateSnapshot on every load, hot-swap and co-op update. items.js now accepts kinds registered from ITEM_INFO; new test round-trips every kind.
  - Pickup feed overlapped the journal chip and the notice feed; it now stacks above the chip, with the notice feed above five rows.
- Also fixed: Escape with the hammer build wheel open opened the pause menu.
- Gate: 533/533, no page errors, hook-only spawn, Esc from inventory OK, perf +0.8% vs main (fair probe), draw calls 148 vs 539.
- Merged PR #1 into main.

## Perf round, 2026-11-21 07:08 UTC

Branch `claude/loop-perf-202611210708`, from `origin/claude/raft-master` 6ab9b24.

**Who ran it:**
- 6 profilers: world, building, environment, alloc, startup, hud+viewmodel.
- 9 optimizers: debris, scenery, deck, decor, viewmodel, hud, startup, alloc, quality.
- 1 regression checker, who read every before/after pair. Pairs are side by side in `r2-regress/cmp/`.
- 1 measurer.

**Probe setup:** headless SwiftShader at 1280x720, load average 2.5–12. perf_probe used 3 interleaved runs per tree. Frame ms is noise.

| Metric | Before | After | Change |
|---|---|---|---|
| perf_probe draw calls, idle (pinQuality + seed) | 148 | 35 | **−76%** |
| perf_probe draw calls, walk | 147 | 35 | −76% |
| perf_probe triangles, idle | 116.2k | 109.2k | −6% |
| perf_gate draw calls, p50 / p95 / max | 136 / 147 / 150 | 32 / 37 / 37 | −76% |
| perf_gate result | FAIL (2 WebGL contexts) | PASS | |
| perf_gate GL object growth | 135 | 1 | −99% |
| JS allocation, idle (KB/frame, CDP sampling) | 134.7 | 87.1 | **−35%** |
| Heap after forced GC at 60 s (MB) | 29.1 | 28.9 | −1% |
| WebGL contexts | 2 | 1 | −50% |
| Live programs at 30 s | 43 | 170 | +295% (shader variants warmed on purpose) |
| Draw calls, night + lantern | 158 | 44 | −72% |
| Draw calls, island ashore | 105 | 32 | −70% |
| Draw calls, underwater (regression checker's dive) | 78 | 23 | −71% |
| Big raft draw calls, spawn / outside | 425 / 509 | 184 / 225 | **−57%** |
| Big raft triangles | 710k | 527k | −26% |
| Big raft materials | 142 | 56 | −61% |
| Big raft shadow casters | 157 | 58 | −63% |
| Placing one decor piece on the big raft | 625–899 ms, +36–53 MB | 1–2 ms, +0.1 MB | **−99.7%** |
| Startup: game.js request start | 1442 ms | 26 ms | −98% (all 103 modules preloaded) |
| Startup: raftDebug ready | 2332 ms | 1837 ms | −21% |
| Startup: modules loaded twice | 5 | 0 | |

The big raft is 49 tiles, 26 decor items and 58 building pieces. The startup rows are medians of 3 interleaved runs taken at load average about 45.

### What changed

- **Floating items:**
  - Models are merged: plastic 2→1, scrap 3→1, wood 2→1, bottle 6→2, signal models down to 2 meshes each.
  - Shapes are cached, 3 per type.
  - New `dist/item-instancer.js` draws one InstancedMesh per geometry and material. It runs its own culling, and picking still uses the hidden source meshes.
  - Result: about 56 item draws drop to about 12.
- **Scenery:** the 12 islands and 24 clouds are each drawn as one InstancedMesh, fed from proxy groups (new `dist/scenery-instances.js`), so sailing drift and day/night are unchanged.
- **Seafloor:** its decor is drawn only underwater.
- **Islands:** coconuts are merged into the palm.
- **Viewmodel:** ported `dist/bake.js`, which bakes hands into one mesh per pose and the hook, hammer and rod into single meshes. Holding the hook went from 47 draw calls to 7.
- **Decor:**
  - One cached model per type; placed copies are clones that share geometry and materials (palm soil and smelter glow stay per instance).
  - Parts are merged by material class, and tessellation is trimmed.
  - Purifier went from 21 meshes to 2.
- **Deck:**
  - Tile parts are cached, and merging is a plain array copy.
  - Timber and fittings use 2 vertex-coloured meshes per chunk, with 4x4-tile chunks on rafts of 26+ tiles.
  - `rebuildRaft` keeps the floor when tiles are unchanged and only adds or removes decor that changed. That is why placing decor no longer rebuilds the raft.
- **HUD:**
  - Item icons now render on the main renderer into an atlas, encoded asynchronously with `toBlob`, and only for the hotbar and bag. This removed the second WebGL context and 19 synchronous `toDataURL` calls.
  - The world redraws at 10 Hz behind menu dialogs.
  - Backdrop blurs are removed.
  - New slim `raftDebug.hud` for the prompt and onboarding pollers.
- **Startup:**
  - Fonts no longer block.
  - The whole static module graph is modulepreloaded, generated by `publish_local.py`, with a `--sync` mode.
  - Every relative specifier is stamped with `?build=`, so no module loads twice.
  - `tests/module-graph.test.mjs` enforces both.
- **Allocation:**
  - `input.update` no longer allocates.
  - three.js fog colour conversion is cached.
  - Wildlife fish and gull constants are precomputed.
  - `ocean.sample` uses scratch storage.
  - The hook-out paths use scratch objects.
- **Quality:**
  - The ladder now steps render scale before turning shadows off; the old 512-map step saved nothing.
  - The ocean has an `OCEAN_LOW` shader at the bottom two levels.
  - Shadows are off underwater.
  - Shader warm-up also compiles the shadows-off and lantern-light variants, so the first lantern and the shadows-off step no longer cause a compile hitch.
- **Sailing:** the anchor winch is merged.
- **Harness:** perf_gate and playbot now click the onboarding title menu. `#solo` is hidden on this build, so the gate had been timing out.

### Regression check

No regressions. Intended differences:
- Dialogs are not blurred.
- Shadows are crisper on fewer casters.
- Net and rope no longer cast shadows.
- Purifier embers flicker together.
- Lowest quality has less fine ripple detail.

### Caveats

- The live program count roughly quadruples because of the warmed variants. This is fine with `KHR_parallel_shader_compile` (ANGLE D3D and Metal), but needs checking on a laptop without it.
- Headless frames are too slow for the quality scaler to step on its own.
- `raftDebug` has no quality setter; the regression checker patched one in for testing.
- The `art.test.mjs` atlas build-time check flakes when the box is loaded.

### Next ideas

- A `raftDebug.quality` setter for probes.
- The grill's PointLight still changes the light count.
- Lower the net rope segment count (about 5k tris).
- Measure decor and deck chunk culling on rafts of 144+ tiles.
- Check whether three.js's `setValueV3f` boxing (8–11 KB/frame) can be avoided.
