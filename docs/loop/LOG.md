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

## Perf round 2, 2026-11-21 (branch `claude/loop-perf-202611210540`, base `origin/claude/raft-master` 7555d67 + round-1 merge)

BEFORE = 9eae7d7: raft-master with the rest of round 1 merged in. That merge also fixed the islands and clouds so
they still drift while sailing and kept their day/night tint, and it made the sun follow the fitted shadow target.
AFTER = c5f3e69. Probe = `tests/e2e/perf_gate.py` from c5f3e69: `?pinQuality`, 600-frame JIT warm-up at a tiny
viewport, a deck walk alternating W/S, and `--swim`. Figures are medians of 2 alternating runs. Draw calls and
triangles count main + shadow passes.

| phase | metric | before | after | Δ |
|---|---|---|---|---|
| idle | draw calls | 136 | 51.5 | -62.1% |
| idle | triangles | 127,304 | 129,318 | +1.6% |
| idle | shadow casters | 169 | 128 | -24.3% |
| idle | geometries | 128 | 63.5 | -50.4% |
| idle | lights | 6 | 2 | -66.7% |
| idle | shader programs | 37 | 36 | -2.7% |
| idle | JS alloc KB/frame | 68.7 | 28.4 | -58.6% |
| idle | avg / p95 frame ms* | 389 / 458 | 262 / 317 | -32.5% / -30.9% |
| walk (deck) | draw calls | 138 | 51.5 | -62.5% |
| walk (deck) | JS alloc KB/frame | 65.7 | 29.3 | -55.4% |
| walk (deck) | avg / p95 frame ms* | 599 / 800 | 261 / 300 | -56.4% / -62.5% |
| hook | draw calls | 146 | 62 | -57.7% |
| hook | JS alloc KB/frame | 87.1 | 51.8 | -40.6% |
| swim | draw calls | 99.5 | 41 | -58.8% |
| swim | JS alloc KB/frame | 111 | 30.8 | -72.3% |
| swim | avg frame ms* | 349 | 136 | -60.9% |
| startup | DOMContentLoaded ms (in-page, 3 runs) | 303 | 87 | -71.3% |
| startup | first contentful paint ms | 328 | 120 | -63.4% |
| startup | raftDebug ready ms (in-page, 3 runs) | 2000 | 1944 | -2.8% |
| startup | transfer KB | 2367 | 2242 | -5.3% |

\*Software GL on a shared box (load 2-21). Treat frame times as direction, not magnitude. Retained heap growth
was under 0.1 MB in every phase. The perf gate on AFTER against BEFORE gives **PASS**, with no page errors.

What landed:
- **Floating items:** one mesh per item, with per-part roughness and metalness from a tiny lookup texture.
  Geometry is pooled as 4 variants per type, and the pools are drawn as InstancedMesh batches split by whether
  they fall inside the shadow box (63 → 18 item draws).
- **Islands and clouds:** two InstancedMeshes driven by proxy groups, so sailing drift and day/night tint still
  work (23 → 2 draws).
- **Merged meshes:**
  - the sail fixture and anchor
  - the deck planks, now one vertex-coloured mesh
  - the hook viewmodel, from 6 materials to 2
- **Day/night:**
  - lantern point lights join the scene only once the first lantern exists, so 4 fewer lights in every lit
    shader at noon
  - visuals are recomputed every 0.1 s of game clock
- **Shader programs:**
  - island models share one program
  - the co-op ping uses 1 program instead of 4
  - a single pass for every transparent DoubleSide material, enforced by `tests/perf-lint.test.mjs`. The fish
    material was re-running program checks every frame.
- **Allocation fixes:**
  - input bindings: 12.9 KB → 0.2 KB per frame
  - gull flight plans are precomputed
  - prompts read a light `raftDebug.hud` getter instead of the 48-key state object
  - the open-dialog check is cached through a MutationObserver
- **Seafloor:**
  - built and JIT-warmed at load; the first dive used to cost a 20 ms, 5 MB hitch
  - the noise is hand-inlined, giving bit-identical heights at 122 KB instead of 1.1 MB per rebuild
  - its shaders are compiled with the scene
- **Startup:**
  - every module now uses one `?build=` specifier; 8 modules had been loading twice as separate instances
  - fonts load without blocking
  - live.js preloads the static module graph, and a test keeps that list in sync
  - the co-op hub, controls tab, underwater fx and diving HUD load lazily
- **Perf gate:**
  - JIT warm-up, so unoptimized code no longer reports false hotspots
  - the walk phase stays on the deck, plus an optional swim phase
  - the debug hook is polled every 20 ms, not once per frame

Regression check (every PNG pair read, plus scripted views of items, islands and clouds by day and night, a
lantern at night, sailing drift, a dive, inventory, pause and hooking): no regressions. A suspected darker leaf
was traced to a different leaf at a different yaw; a fixed-pose grid matches the old build.

Rust/WASM: none again; see `docs/loop/rust-wasm.md`.

Next ideas:
- lazy-load the fishing-cooking subtree (needs a refactor)
- trim the warm-up programs (36)
- shadow casters (128) on small decor
- fewer seafloor instanced draws when diving
- let quality.js also lower the shadow-pass frequency on low-end machines
