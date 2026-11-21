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

## Perf round 2026-11-21 06:00 UTC (branch `claude/loop-perf-202611210548`, from `origin/claude/raft-integration` 8cff3ec)

The earlier perf rounds (`claude/loop-perf-202611210451`, `-0540`) were never merged into raft-integration and conflict heavily with it, so this round redid the work on the newest build.

### Setup

- Fleet:
  - 7 profilers: deck/building, ocean/sky, viewmodel, debris/farming, JS allocation, HUD/DOM, startup/renderer
  - 9 optimizers: viewmodel bake, per-frame allocation, icons and menus, shadows and adaptive quality, startup, environment, deck chunks, crafts instancing, debris
  - 1 regression checker, which read every before/after screenshot pair
  - 1 measurer
- Probe: `tests/e2e/perf_probe.py`
  - Wraps the GL draw calls and records readiness inside the page.
  - Headless SwiftShader, 1280x720, fresh solo game, median of 3 runs, load average about 2.5.
  - Frame times are relative only.

### Fresh solo game

| Metric | Before | After | Change |
|---|---|---|---|
| Draw calls, idle | 476 | 79 | **−83%** |
| Draw calls, walking | 474 | 80 | **−83%** |
| Triangles, idle | 214k | 107k | **−50%** |
| JS allocation, idle (MB/s) | 3.13 | 0.46 | **−85%** |
| JS allocation, walking (MB/s) | 1.21 | 0.57 | −53% |
| JS allocation per frame, CDP sampling (KB) | 322 | 68 | −79% |
| GCs, 5 s idle | 2 | 1 | −50% |
| Heap, live after forced GC, 60 s idle (MB) | 11.1 | 7.0 | −37% |
| `raftDebug` ready (ms) | 366 | 121 | −67% |
| First two frames (ms) | 1636 | 1408 | −14% |
| New game click to running (ms) | 192 | 33 | −83% |
| Programs linked, fresh game | 33 | 12 | −64% |
| Frame time, idle avg (ms, noisy, adaptive on) | 288 | 199 | −31% |

### Built raft (49 tiles, 24 decor)

From the measurer, 3 interleaved runs.

| Metric | Before | After | Change |
|---|---|---|---|
| Draw calls | 1086 | 149 | **−86%** |
| Triangles | 891k | 602k | −32% |
| Allocation per frame (KB) | 2922 | 126 | −96% |
| Heap after GC (MB) | 15.5 | 8.5 | −45% |
| Continue click to running (ms) | 2047 | 1545 | −25% |

### What changed

- **Viewmodel.** Hands, arms, hook, hammer, rod and avatar are baked into a few meshes (`dist/bake.js`); a palette texture keeps each part's roughness and metalness. Holding the hook went from 59 calls to 7.
- **Debris.** Each item is 1–2 vertex-coloured meshes with shared materials, cached per type and variant. Tessellation is lower and only the main mesh casts a shadow. Debris was 65% of the frame.
- **Deck.** Tiles are merged into 8x8-tile chunk meshes with per-tile part caching. Lashings no longer cast shadows. One grain texture is shared and tinted per wood colour.
- **Crafts.** Placed decor is drawn as one InstancedMesh per type and part from cached templates (119 → 35 materials). Thin parts no longer cast shadows and tessellation is trimmed.
- **Environment.**
  - Islands and clouds went from 192 meshes to 3.
  - The ocean draws after the opaque objects, and its shader skips work past the fade distance and the ripple and foam ranges.
  - Wave sampling has no allocations: `Float64Array` params and `ocean.sample()`, bit-identical to before.
- **Shadows and quality.**
  - The shadow camera is fitted to the raft.
  - Presets now set the shadow map: low has none, medium is 1024 PCF, high is 2048 PCFSoft. Medium's default render scale is consistent with the other presets.
  - New `dist/quality.js` adaptive resolution (render scale 1 → 0.6 with hysteresis, shadows at half rate at the bottom step), with a settings toggle and `raftDebug.quality`.
- **Allocations.**
  - three.js `setValueV1i` stores booleans as ints, which stopped V8 boxing every uniform cache.
  - `forceSinglePass` on transparent DoubleSide materials (plastic creases, lantern glass, splash rings).
  - Survival UI and game-loop scratch reuse, no-alloc hook physics, a reflow-free pickup feed.
- **Startup.**
  - Fonts load without blocking.
  - 28 modulepreloads.
  - PeerJS loads on demand.
  - Shaders are warmed with `compileAsync` after the first frame.
- **Icons.** Item icons render lazily in one atlas pass with `toBlob`, starting 2 s into play or when the inventory opens. Before, about 15 synchronous `toDataURL` long tasks ran during startup.
- **Menus.** The world redraws at 10 fps behind pause, settings and help menus.

### Regression check

Every before/after pair was read: title, spawn, hook, inventory icons, pause and settings, horizon, built raft decor, hammer, rod cast, low and high presets, debris close-ups and co-op loading. No regressions were found. Expected differences:

- Shadows are crisper.
- Debris far from the raft no longer self-shadows, because it is outside the fitted shadow box.
- Leaf bundles use 4 cached shapes.

### Rust/WASM

Not worth it again this round; see `docs/loop/rust-wasm.md`.

### Next ideas

- Per-chunk frustum culling is coarser than per tile; consider 4x4 chunks for very large rafts.
- InstancedMesh for floating debris (about 45 → about 10 calls).
- Lazy-build the rod and hammer viewmodels and warm their shaders while idle.
- Revoke the icon blob URLs on re-render.
- The pause-menu "Play together" button could prefetch PeerJS.
- `dist/sky.js` and `dist/waterfx.js` are dead code.


## 2026-11-21 · loop-features-202611210534 (features, round 2)
Base: origin/claude/raft-master (7555d67) with round 1 (loop-features-202611210451) merged in (conflicts in game.js/index.html/inventory-state.js resolved; all lanes + round 1 coexist).
All three features are content-registry modules (dist/content.js FEATURES), state in world.ext[name].
- **Seaside Kiln** (`kiln`) — research-gated station (stone 4, clay 4, scrap 1) smelting metal ore → Metal Bar, sand → Glass Pane, clay → Fired Brick with wood fuel; recipes Glass Lantern (lit at night), Line Sinker (halves hook wear; one game.js line in wearHook), Glass Cups ×3, Brick Planters ×2. Files: kiln.js, kiln-core.js, kiln-model.js.
- **Puffhen raft animals** (`animals`) — starter Nest Box lured with a palm seed (or 3 leaves); hens wander deterministically on the host clock (no positions sent), lay Puff Eggs (+ feathers), can be fed, petted (hearts) and renamed; Feather Cushion decor and Egg Lantern recipe. Files: animals.js, animals-core.js, animals-models.js, animals-ui.js. game.js: contentCtx.hasGrill.
- **Decor pack + signboards** (`decorpack`) — Woven Deck Mat, Wind Pennant, Hanging Fern Post, Shell Chime, Rope Hammock, Clay Pot Trio (first clay use) and a writable Signboard (3×18 chars, cleaned, CanvasTexture cache); quarter-turn rotation with E. Files: decor-pack.js, decor-pack-models.js, signs-core.js, signs-ui.js. game.js: decorModel(type, d).
Fleet: 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA (13 agents).
Review fixes: kiln guest revision skip for old hosts; sign text lone surrogates + huge input, sign dialog lifecycle on dispose; puffhen rename reach, guest clock slew, graph rebuild churn, dialog leak; storage-research tests made robust to new recipes; icons for sand/stone/clay/ore/pots/sign/chime; hammock pillow, cushion tufts.
Checks: npm test 342/342; shoot.py errors []; coop-e2e (loopback) all pass except test 4 middle-click ping (fails on base too); sign write/turn verified host↔guest over loopback.
Known limits: decor collision is a centre circle (fern/hammock posts walkable); doorway clipping of hens; glass lantern glass looks pale at night; mat/fern/hammock borrow icons.
## claude/loop-visuals-202611210451 (visuals, round 1)
Base: origin/claude/raft-integration (d5419eb). Fleet: critic, 7 builders, art judge, perf checker.
- Accepted: bright tropical sky dome with wispy clouds and cyan horizon fog (sky.js wired in); warm sun + blue hemisphere fill, shadow camera actually applied; deep blue ocean with softer foam; weathered olive-tan deck, 3-4 boards per tile; rocky sand-shelf islands with palms (islands.js, merged geometry; renamed scenery-islands.js on merge into raft-master, where islands.js is the content lane); light canvas hotbar/inventory in tan wood frame.
- Rejected by judge: chunky teal hook + right-hand-only viewmodel (hand did not grip the handle, toy-like block) - reverted.
- Perf: PASS. shoot.py median 195.8 -> 202.3 ms (noise); spawn probe 304 -> 289 ms, draws ~524 -> ~382.
- Next: hook/hand grip redo (thinner head, own colour), dark board gaps + per-board tone, near-foam decal lines, pale far-water band, cumulus near horizon, island sand pancake edges, pause menu still navy, selected-slot highlight.
# Little Raft improvement loop log

## Round 1: claude/loop-ux-202611210451 (base: origin/claude/raft-integration d5419eb)

Fleet: 8 subsystem bug hunters, 2 independent adversarial verifiers per bug report (16), 7 fixers each with regression tests, 1 new-player UX reviewer reading screenshots, and 1 crafting UX builder.

### Fixed (confirmed by both verifiers)
- **Cursor (CUR-1..5, LIVE-5):**
  - Esc from the inventory or crafting relocks straight into play. The activation pre-check is gone.
  - SecurityError and WrongDocumentError are treated as temporary, so the game no longer sticks in drag-look forever.
  - The resume hint can be clicked.
  - Closing Help or Crew from the pause menu returns to the pause menu.
  - Held-Esc key repeat no longer reopens the pause menu.
  - Electron: `before-input-event` swallows Esc while a panel is open, then closes it and relocks via `executeJavaScript(code, true)`. Panel state reaches the shell through `window.raftShell` and console sentinels.
- **No centred popups (HUD-1/2, INV-2/3, CRA-1):**
  - All notices go to an edge stack at the bottom-left, which stays visible while the bag is open.
  - Prompts, the throw meter and the resume hint moved to the edges.
- **Crafting UX:**
  - Category tabs with craftable-count badges.
  - Cached 3D item icons rendered from the real meshes.
  - Owned/needed rows shown in green or red.
  - A detail card with a Craft button: click crafts one; holding repeats faster and faster, with a fill bar and a +N counter.
  - Tooltips anchored beside the hovered element.
- **Inventory (INV-1/4/5/6):**
  - Closing on the backdrop needs both the press and the release on it.
  - E closes the bag.
  - Tab and the arrow keys navigate inside the bag.
  - The right-click hint is corrected, and refused placements show a reason.
- **HUD and audio (HUD-3..6, UX-1):**
  - Help text contrast fixed.
  - The sound toggle is saved.
  - Ocean audio is wired in, replacing the beeps.
  - Drag-look follows the sensitivity setting.
  - A first-run hint chain was added.
- **Movement and building (MOV-1..4):**
  - Climbing onto the raft beside a prop no longer leaves you inside it.
  - A 0.12 s jump buffer was added.
  - The world bound and tile cap now apply to the ghost, with a notice.
  - Building reach is limited to 6 m.
- **Hook (HOOK-1/2/4/5):**
  - R repairs the worn hook.
  - The hook stops on deck tiles.
  - The dead condition widget was removed, along with a stale test.
- **Net and co-op (CRA-3/4/5, HOOK-3):**
  - The net picks the first item that fits the bag.
  - The guest's held tokens are protected on the host.
  - The bench collider matches its mesh.
- **Fishing (FISH-1..5):**
  - Releasing the mouse never fires a tool switched to mid-press.
  - A distinct rod icon.
  - A real bobber.
  - A cast can be reeled in or cancelled, with a prompt.
  - The fish count is written.
- **Live, save and co-op (LIVE-1/2/3/6):**
  - Hidden tabs no longer drop co-op, thanks to a heartbeat, visibility messages and a 20 s timeout.
  - Network and save timers run on wall-clock time.
  - The game saves on hide and on pagehide.
  - The live loader knows the boot build and protocol.
  - A save revision guard stops two tabs clobbering each other's saves.

### Not fixed or refuted
- LIVE-4: refuted, because the crew button is hidden during play.
- MOV-5: the walkable surface doesn't follow raft tilt. Design-level, deferred.

### Checks
- `npm test`: 98 pass, 0 fail. It now runs `tests/*.test.mjs`.
- `python shoot.py dist <out>`: no page errors, and Esc from the inventory does not open the pause menu.
- Pointer-lock probe with real headless pointer lock: relocks after Esc from the inventory using Playwright keys, after the shell escape, after injected SecurityError and WrongDocumentError, after clicking the hint, and through the pause → Help → Esc path.

### Open for next round
- A raw CDP held-Esc sequence (rawKeyDown with autoRepeat, then keyUp) from the open inventory requests the lock but ends unlocked with the hint showing. Playwright keyboard events pass. Next round should establish whether real OS key input behaves like the raw path.
- In plain Chrome, Esc from the pause menu still needs one click to relock. The Electron shell covers it.
- The inventory and pause panels are still centred modals (UX-2/UX-8). Consider docked or side-sheet layouts.
- Title screen copy and the pause menu styling (UX-7/UX-8).

## Round 2: claude/loop-ux-202611210603 (base: origin/claude/raft-integration 8cff3ec + round 1 merged)

The round-1 branch had never landed in integration, so it was merged first (399253e). A parallel session had pushed a different merge to claude/loop-ux-202611210547, so this round uses its own branch name.

Fleet: 8 subsystem hunters (lock, craft, build, hook, survival, net, input, hud), 1 new-player UX reviewer reading screenshots, and 1 crafting UX builder. Every findings file went to 2 adversarial verifiers (18 in all), and 8 fixers each added regression tests.

### Fixed (confirmed by both verifiers)
- **Cursor and lock (LOCK-1..4):**
  - In real Chrome, Esc from the inventory, pause or crew granted the lock and then lost it. Playwright's key events hid this because they carry no native key code.
  - The Escape keyup now calls preventDefault, and the relock is deferred.
  - A failed relock no longer leaves a hidden cursor with no prompt.
  - Holding Esc opens pause.
  - Drag-look mode keeps its cursor.
  - New e2e test `tests/e2e/esc-relock.py` uses raw CDP Esc with native code 27. It fails before the fix and passes after.
- **Crafting:**
  - Craftable recipes sort first.
  - Ingredient sources are shown ("found floating", "craft it ›" jumps to the recipe).
  - A pinned recipe tracker on the HUD edge.
  - Owned/needed chips on every recipe row and in the tooltips; the slot tooltip says "stack".
  - Readable hammer and rod icons, and 3D icons for cup, seed and water.
  - The ×N count and "hold: up to N" respect free bag space.
  - The first open picks a ready recipe.
  - Holding to craft ends on "Crafted N" instead of grey "Missing materials".
  - Feed rows use the same 3D icons.
- **No centred popups (HUD-1..6, UX-2, UX-7):**
  - The live-update toast goes to the feed; before play it sits bottom-left.
  - The feed docks into lanes inside the open bag and the pause rail, so it never covers buttons.
  - Feed width is capped left of the hotbar.
  - The bag's top edge is pinned, so tabs no longer jump.
  - Guide keycaps and the title brand are readable.
- **Controls (INPUT-1..4):**
  - Held W/Shift survive opening and closing a panel.
  - A spike filter replaces the ±200 look clamp, so fast flicks are kept.
  - Physics substeps, giving the same speed and jump at any fps.
  - The wheel works over the hotbar in drag-look.
- **Building (BUILD-1..5, UX-1):**
  - Pieces can't be placed on a player.
  - The planter ghost shows the empty pot.
  - Sail and lantern footprints and colliders match the models.
  - Shift+wheel fine rotation works, and R rotate appears in the prompt and the guide.
  - X with the hammer removes a piece for about half its cost back.
  - The edge prompt shows cost and refusal reasons.
- **Hook and farming (HOOK-1/2/5, SURV-2/3/4):**
  - With a full bag the catch stays on the hook in the water, instead of teleporting back out to sea.
  - The hook can be thrown while swimming.
  - A catch survives a deck landing.
  - Empty planters dry out.
  - Harvest loot shows in the feed with icons.
  - Clear notes when a farm action fails.
- **Save and co-op (NET-1..5):**
  - A tab idle on the title no longer gets save-blocked; save status shows inline on the title.
  - A failed hot-swap keeps the desktop Esc hooks.
  - The first hook to claim an item keeps it.
  - A guest leaving no longer races the host's autosave.
  - New game resets the hints.

### Not fixed or refuted
- HOOK-4 (the rod lands a fish on its own after a bite): refuted, because it is intended.
- SURV-1 (solo pause doesn't freeze farming or drift): design question. Verifier B says freezing would have to cover the whole simulation.
- HOOK-3: a duplicate of NET-3.

### Checks
- `npm test`: 216 pass, 0 fail.
- `python shoot.py dist <out>`: no errors. After Esc from the inventory the game is locked, with no pause and no relock class.
- `tests/e2e/esc-relock.py`: PASS.

### Open for next round
- Removing a floor tile someone stands on drops them into the sea; it should be blocked.
- Pause-menu buttons don't respond to normal Playwright clicks (only JS clicks), and "Save and quit" shows a hover highlight while Resume has focus. Confirm whether real mouse clicks work.
- The hold-to-craft progress is still a bar, not a ring.
- Electron was not run here. The desktop Esc path was checked only by reading the code.
- The machine was heavily loaded, so shoot.py frame times are not comparable between runs.


## 2026-11-21 · integrator A, round 2/3
Two integrator sessions are running on claude/raft-master; each merges the other's pushes before pushing.
- Merged loop-visuals-202611210451 (driftwood palette, scenery-islands.js, sky.follow() tracks day/night) and resolved it
  against the other integrator's raft-integration merge: one sky-sync path (sky.follow), the visuals palette on the 10-slot
  hotbar, combined ocean foam (soft crest + raft/item collars), single-tap wood bump with driftwood values.
- Verified at 0ebcf17: npm test 628/628, shoot.py errors [], fresh spawn hook only, Esc from inventory: no pause, pointer stays locked.
- Under heavy machine load (4 merge agents), the art "atlas build stays fast" timing test and stock shoot.py time out on
  untouched bases too; both pass once load drops.
- Next: lane agents merging the newest loop-features/perf/ux/visuals/fidelity and raft-content/tests/integration + lane-placement.
- Still skipped: raft-reference (scraped commercial-game stills). Farming (farming.js) is merged but not reachable in play:
  it and the watering lane drive the same palm planter; it needs a design decision.
## 2026-11-21 · loop-features-202611210703 (features)
Base: origin/claude/raft-master (6ab9b24, includes progression/items.js). Branch: claude/loop-features-202611210703.
Not redone this round (done in other branches or already on master): bed/sleep, motor/wheel, paint (loop-features-202611210548, whose code is not yet on master); animals, kiln, signs (0534); instruments, rain barrel, beehive (0648); binoculars and smelter (already on master).

Features (research in docs/features, specs in docs/specs):
- **Character customisation (Look)**:
  - Shirt, trousers, skin and hair palettes, plus 5 hats: straw (today's), none, and beanie, bucket hat and flower crown, which unlock from logbook achievements.
  - The Look dialog has a 2D SVG preview and opens from the pause menu and the title/onboarding menu.
  - First-person hands and sleeves now match the body; this fixes the old green sleeve.
  - Co-op: the look is sent in hello plus a `k:'look'` event, validated, and throttled to 1 rebuild per 300 ms. The remote body is re-baked only when the look changes.
  - Stored per browser in `little-raft-look-v1`, never in the world.
  - Files: dist/look.js, dist/look-ui.js.
- **Seashell Finder + Little Spade + buried treasure ("Sandy Secrets")**:
  - Each island has 1–2 buried bundles at spots from a seeded stream, so `layoutFor` is unchanged.
  - The finder shows a ring HUD, beeps faster as you get close, and has a glowing bead.
  - E with the spade digs. The host checks reach, using the guest's position for guest digs.
  - Loot comes from existing items, with a 15% keepsake ingot; an empty dig gives 1 sand.
  - The spade wears out and R repairs it.
  - State is `world.ext.treasure {v, seed, dug[]}` and resets when the island changes.
  - Files: dist/treasure.js, treasure-rules.js, treasure-models.js; `islandNow()` accessor in islands.js.
- **Map table + sea chart**:
  - The map table is an items.js placeable; copper unlocks it.
  - E opens a parchment canvas chart (-z up, 150 m to 10 km): raft and heading, sailed trail, charted islands with generated names and visited/gathered ticks, the signal wedge, and up to 8 pins.
  - Set course reuses the sail heading action.
  - State `world.ext.maptable` is about 3.6 KB at most. Only the host records islands and the trail; guests send validated pin actions.
  - Files: dist/maptable.js, maptable-ui.js, maptable-model.js; content.js passes `{peek}` to modules.

Fleet: 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA (13 agents).
Review/QA fixes:
- Look: a flood of partner look messages could force a rebuild each time (now throttled); the in-memory look is sent when storage is blocked; hats are rechecked after a world swap; `hands.setLook(null)` threw.
- Treasure: host dig cooldown in a hidden tab, the finder bead glow, hole colour, per-frame HUD strings; a guest end-to-end dig test was added.
- Map table: the "Course set" text was hidden behind the modal and now shows in the dialog; km/m edge text.
- Pickup feed: blank icons for model-less items, long notes overlapping the hotbar, journal chip over the phone hotbar.
Checks: `npm test` 571/571 (was 549 at base); shoot.py `errors: []`. Loopback co-op probes for look and treasure.
Process notes: one intermediate commit (3d365c8) had a broken game.js, fixed in the next commit (86488d7). Two commits carry another agent's hunk because the git index is shared.
Known limits: chart labels overlap near the raft; the treasure chest is a plain box; the phone inventory needs scrolling to reach its hotbar row; empty digs give sand fast (tune?); no live two-browser test of a guest digging.
Next ideas: merge loop-features-202611210548 (sleep/motor/paint) into master; a general content-prompt bridge to raftPrompts; message-bottle loot in treasure; nicer chest model.

## 2026-11-21 · loop-fidelity-202611210714 (raft fidelity, round 1)
Base: origin/claude/raft-master (d356103). Branch: claude/loop-fidelity-202611210714.
Research: docs/loop/research/fidelity-r1-survival.md and fidelity-r1-shark.md. The wiki hosts were DNS-blocked, so the numbers come from search summaries.

Claimed gaps (the three largest: none of these existed before):
- **Hunger, thirst, health**: dist/vitals.js and dist/vitals-ui.js. Hunger drains 0.09/s and thirst 0.11/s, x1.5 while sprinting or swimming. Each empty bar costs 0.75 HP/s. Health regenerates 0.25 HP/s while both bars are above 0.
  - Click with food or a cup to eat or drink. Raw fish is salty; a salt cup costs 5 water; grilled fish +35; a fresh cup +40 and gives the cup back.
  - The bars sit in the lower left with a low-health vignette.
  - At 0 HP you pass out and wake at the raft centre with 100 HP and 75 food/water, keeping the inventory (gentle mode).
  - Vitals are saved. A guest eats through the host's 'eat' action and 'ate' effect.
- **Shark**: dist/shark.js and dist/shark-model.js.
  - It circles at the raft's edge + 6 m. Every 300 s it attacks a random unarmored edge tile: 20 damage every 2 s against 100 HP per tile. A broken tile takes its decor, pieces, grill and crate contents with it; the last tile is never removed.
  - It hunts swimmers within 25 m (30 damage every 3.5 s).
  - 150 HP. 15 damage within one attack repels it. Harvest the body with E for 4 shark meat and 1 shark head; it respawns 180 s after looting.
  - Co-op: the host is authoritative, and the guest gets a compact pose plus tileHp.
- **Spear and foundation repair**: dist/spear.js, repair.js, spear-model.js and spear-repair-hooks.js.
  - Wooden spear: 8 planks + 3 rope, 5 damage, 20 uses. Metal spear: 6 planks + 2 rope + 2 ingots + 1 bolt, 10 damage, 40 uses.
  - LMB thrust with a 0.7 s cooldown and 2.8 m reach. Only hits wear the spear.
  - Hammer on a damaged tile: 1 plank restores 50 HP.
  - Raw shark meat grills into Grilled Shark Meat (+30 food).

Fleet: 2 researchers, 3 builders (worktrees), 2 reviewers.
Review fixes:
- one damaged-tile overlay instead of two
- crate contents cleared with their broken tile
- the guest spear-hit rate limit now sits under the spear cooldown
- fainting reels in the fishing line and ends a dive; opening a menu cancels eating
- HUD overlaps fixed at 600 px wide; the faint overlay sits above the checklist
- shoot.py waits 60 s for the page to load
Checks: npm test 488/488 (was 456); shoot.py `errors: []`. Frame time 293-317 ms on a loaded machine (base 297); 129 draw calls (+9), 97 shadow casters (no change).
Known limits:
- A guest spear thrust the host rejects still wears the spear.
- The spear's hit test ignores the deck, so you can hit the shark through the planks.
- Spearing a circling shark resets its attack timer.
- The tileArmor contract exists (world.tileArmor) but no armor item yet.
- Eating has no hand animation.
Next gaps to consider: foundation armor item; starter raft 2x2 + Raft hook/foundation costs; crop plots (potato/beet); simple purifier fuel and timings (30 s per cup); shark bait.

## 2026-11-21 · integrator round 3
- Clean merges: raft-tests, raft-tech, loop-features-202611210648, fleet-tech icons/perf/procedural-models/water/audio/foliage.
- One subagent per conflicting branch in its own worktree: merged raft-integration (10-slot hotbar, throw ring, ocean foam, offline fonts),
  raft-content, loop-ux-202611210603 (bag keys, craftable-first sort, ingredient sources, pinned tracker), loop-features-202611210548 (paint, sleep, engine).
  Skipped loop-perf-0548/0540, loop-visuals-0451, loop-ux-0547, loop-features-0534 (see STATUS).
- Fixed after the merges: honey/wax/flower-seed sources, context prompt moved beside the crosshair, held-item and sprite-list conflicts with the beehive/instrument lanes.
- Perf probe now compares against the current main (144c94a): 216 vs 322 ms, 96 vs 152 draw calls.
- PR #2 merged into main (3031d67). Review fixes: inventory width at 900px, recipe tracker overlap, Pin button contrast. Reviewer low-priority notes left open: per-frame allocations in rain.js rainTarget and the physics substep input, sky.dispose() missing on hot swap, passive wheel listener.
## Round 2: claude/loop-ux-202611210547 (base: origin/claude/raft-integration 7d19797 + round 1 merged in e4c3aee)

Fleet:
- 4 subsystem hunters: cursor/Electron, crafting/backpack, menus/settings, tools/viewmodel.
- 2 adversarial verifiers per hunter report (8).
- 5 fixers.
- 1 new-player UX reviewer, reading screenshots.
- 1 crafting UX builder.
- 1 merge agent.

### Merge
Round 1 was merged into raft-integration, keeping both sides:
- integration's dark translucent restyle, menus, pickup feed and hands viewmodel;
- loop-ux's lock rules, edge notices and crafting features.

The two item-icon modules became one shared cache.

### Fixed (each confirmed by both verifiers)
- **Cursor (CUR2-1..5)**, found with real X11 keys in headful Chrome:
  - A relock made inside the Esc keyup was granted and then dropped by Chrome's Escape key-release shortcut. The relock is now deferred 250 ms, with guards.
  - Chrome sometimes eats the Esc in locked play. Any lock loss the page didn't cause now opens the pause menu if the window is focused.
  - Electron:
    - on an eaten-Esc keyUp, `raftShell.escapedLock()` runs with a gesture;
    - on window focus, `raftShell.focusRelock()` relocks after alt-tab, but only if play was locked and nothing is open;
    - a gesture retry covers the Escape cooldown;
    - the extra key-release round trip is gone.
  - In the desktop app, Esc while holding a stack in the bag now puts the stack back first.
- **Menus (MEN2-1..5):**
  - The ambience slider is wired up, with its gain after the swell.
  - The title help button no longer shows Resume or Quit, and quit-to-title is a no-op on the title screen.
  - The shell Escape goes through settings' stepwise routing.
  - The default renderScale is now 0.85.
  - The Audio tab has a Sound toggle.
- **Tools (TOOL2-1..5):**
  - A cancelled hand swap rises back instead of staying half-lowered.
  - A pose override waits for its own item.
  - models.js is wired into held items and icons, with a fallback.
  - Rod prompts no longer invite a losing click.
  - Switching slots pulls the hook back, ported from lane-bugs 53426f0.
- **Crafting (CRA2-1..6 + builder):**
  - The crafting panel no longer jumps between tabs.
  - Esc or a backdrop click while holding a stack puts it back.
  - A stack picked up with the keyboard sits on its slot.
  - No overflow between 861 and 923 px.
  - The icon fallback is shared with the pickup feed.
  - Tooltips show on focus.
  - Inline ingredient counts.
  - Craftable recipes sort first.
  - A pinned-recipe tracker sits at the top-right edge.
  - Shift crafts the maximum.
  - Tools craft one at a time.
  - The bag opens on the first ready recipe the player doesn't own yet.
  - Counts read "have X · need Y".
  - Clicking an ingredient jumps to its recipe.
  - A slot flashes after crafting.
- **UX (UX2-2/3/6/7/8):**
  - Help shows in the pause side panel.
  - Action prompts are in the edge stack.
  - The hint chain teaches look → walk → throw → bag → slots.
  - Key and reel wording is unified.
  - The throw meter has a gradient fill and a full-power cue.
  - One palette and font across all menus.
  - Segmented preset picker.
  - Title: a legible logo and a single "Play together" button.

### Checks
- `npm test`: 166 pass, 0 fail.
- `python shoot.py dist <out>`: no page or console errors. The pause menu is a left rail; the bag shows inline counts.
- `python tests/e2e/escape_lock.py`: the Esc-from-inventory relock and locked-play Esc → pause pass with native key codes, 3/3 in my run and 5/5 in the fixer's. The fixer measured HEAD before the fix at 0/5.
- XTest real-key trials: 15/15, from the fixer.

### Open for next round
- None of the Electron main.cjs paths have ever run. They have only been reasoned from source and checked in a node sim. A real desktop run is needed.
- The focus relock also fires when the player returns by clicking the title bar or taskbar, which is debatable.
- Play together is still a separate centred dialog.
- The Hammer and Fishing Rod icons are still dim on their tiles.


## 2026-11-21 · loop-features-202611210722 (features, round 3)
Base: origin/claude/raft-master (6ab9b24, already holding round 1) + round 2 (loop-features-202611210534) merged in (re-based 3-way merge; kiln metal now uses master's `metalingot`/`glass`/`brick`; decor-pack rotation kept via `userData.ownRot`). raft-integration (newer timestamp) was skipped as base: it is a divergent line 558 commits behind master without the lanes.
Avoided features already taken by other loop-features runs (paint, sleep, motor/wheel, beehive, rain barrel, instruments, treasure, map table, customise).
- **Diving gear** (`divegear`) — Puff-Feather Fins (swim ×1.3), Breath Jug (45→75 s air), Seaglass Goggles (fog ×1.53, lighter vignette, lens frame overlay), Tide Scraper (gather ×0.6); works while in the bag. New shared registry hook `content.diveMods(out)` → diving.js `getMods`; underwater-fx `fogMul`/`uVig`.
- **Cooking pot & meals** (`cookpot`, last in FEATURES) — clay/stone/scrap pot, Driftwood Bowls, 6 meals from fish/seaweed/eggs/seeds/fresh water giving one timed per-player buff (swim, walk/jump, breath, reel, night vision, all-round). MOVE_MUL (player-physics) and HOOK_MUL (hook-physics) multipliers; buffs `{host, guest}` host-owned, applied locally.
- **Pim's Barge** (`trader`) — visiting trade barge (first at 4 min, then every 10–14 min) docking at the bow; Bright Shell currency, 6 seeded offers per visit, Shell Wreath plan (plan-gated recipe) and rare Glass Float decor; trade dialog.
Fleet: 1 merge agent, 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA (14 agents).
Review/QA fixes: diveMods per-frame allocation; rain hidden underwater; night-vision floor restored after buff/without daynight; guest wore-off toast; stale net flag after leaving; wreath craft row locked until plan; trade dialog per-frame string; Tinker's Desk heading wrap in Tools tab; goggles lenses on portrait phones; "Move closer to Pim" wording.
Checks: npm test 609/609; shoot2.py errors []; coop2 loopback: only base failures (3 join feed, 6 remote hook); guest buff isolation and guest trade verified over loopback.
Harness note: master's title menu hides #solo/#welcomeCrew, so shoot.py and tests/coop-e2e.mjs time out as written; patched copies click via JS.
Known limits: barge has no collision (you can swim through it); held meal steals E from grill/stations (prompt says Eat); leftover guest buff can pass to the next guest until reload; journal chip overlaps hotbar slot 1 on phones (master); pale seabed fade band (pre-existing).
## 2026-11-21 · integrator C, round 2
- Merged into raft-master: content-islands, fishing-cooking, building-pieces, content (+wildlife, storage, daynight), sailing,
  onboarding (tracker and left-aligned title menu now loaded from index.html), loop-features-0451 (logbook, signal caches,
  purifier), coop, diving, loop-ux-0451, loop-perf-0451, then raft-progression and raft-art (subagent). All kept both intents:
  sailing drift + diving hide-above survive the merged scenery (each island/cloud group is baked on its own), the coop rejoin
  path survives the heartbeat rewrite, fishing-cooking grills block placement, day/night offsets the sun from the shadow-fitted target.
- Progression and the content "Research Table" both gated recipes: progression owns its catalogue, the content table
  (renamed Tinker's Desk) teaches the rest. raft-art stays opt-in behind ?art=1 (doubles frame time under SwiftShader).
- QA (bugs, detail, perf reviewers read the screenshots): Notes panel no longer covers the compass or dialogs; journal close relocks;
  fish toasts, piece chip and sail prompt no longer centred; Esc on the piece wheel no longer pauses; wood bump map dropped (no visible change, ~-20% CPU).
- Gate fixes: Tab closes the bag again (playbot), item icons render through the game's WebGL context (budget: 1 context),
  recipe lock badges are built before the first bag open (DOM growth 109 -> 4), desktop shell opens pause on the Esc keyUp
  when Chromium ate the keyDown that ended pointer lock (electron check), icon encode is synchronous under the deterministic clock (visual check).
- Full fleet gate PASS at c7a8293 (unit, playbot, visual, perf, electron). Electron is now installed in node_modules.
- PR #3 (round 4) is the open PR from raft-master; integrator B merged #2 at 1636dfe meanwhile.

## 2026-11-21 · integrator B, round 3/4
- Clean merges into raft-master: loop-perf-0708, raft-tech, raft-tests, fleet-tech audio/foliage/icons/perf/procedural-models/water.
- Five lane merges in separate worktrees, each rebased onto the parallel integrator's pushes before landing:
  - integration: raft-integration + lane-placement (10-slot hotbar 1-0, ring charge crosshair, foam collars, red "nofloor" ghost, offline fonts).
  - content: raft-content, loop-fidelity-0714 (spear, shark meat, vitals), loop-visuals-0548. debris.js kept as the single-mesh version.
  - features: loop-features-0703 (finder, spade, map table), 0534 (kiln makes progression metalingot/glass/brick, decor pack, puffhens), 0548.
  - perf: loop-perf-0648, 0540 and 0548 hand-ported by cherry-pick; 0720 skipped (old base, rewrites sky/islands/title).
  - ux: loop-ux-0648, 0603 (hand port), 0748; 0547 and 0743 skipped (stale, 0743 would pause on any lock loss).
- Fixes during merges: undefined farmPlot call (game crashed holding a seed), 21 unstamped imports, spear/metalspear appended to co-op HELD (19-20) with avatar models, lazy co-op avatar unioned with partner Look.
- PR #2 reviews (2 reviewers, comments on #2). Fixed: Esc that ends pointer lock with the build wheel open no longer pauses
  (window-capture pointerlockchange marks the press handled); hand skin back to warm tan (pink came from b > g tone factors);
  treasure and binocular readouts moved off screen centre; duplicate craft-book keys; treasure debug select uses 10 slots; dead charge-bar CSS.
  HOTBAR_SIZE in items.js and the onboarding slot hint were already fixed by the parallel integrator.
- Perf: the unpinned probe looked +16% because the adaptive quality controller steps down later (still at pixel ratio 1 vs 0.85 at sample time);
  with ?pinQuality: 242 vs 226 ms idle (+7%), 183 vs 180 ms walking (+2%), draw calls equal (~52). JS self time is ~2% of the frame; the rest is SwiftShader raster.
- Gate passed; PR #3 merged into main (8d21618).
- Open nits: "Discover at a Tinker's Desk" ::before header shows above the detail card when locked rows are scrolled out of view;
  co-op HELD lacks metalhook/sharkmeat/brush/decor kinds; content.js EXT_MAX drops all world.ext at once when exceeded;
  per-frame stroke closure in hands.update; adaptive quality starts later after New game (check for an extra reset on that path).

## Perf round 3, 2026-11-21 (branch `claude/loop-perf-202611210648`, base `origin/claude/raft-master` 8cfdbcd)

Fleet: 6 profilers (draw calls, allocations, DOM, startup/contexts, heap/GL leaks, GPU pipeline), 11 optimizers,
1 regression checker (read every shoot.py pair plus close-ups of the anchor, gull, deck shadows, locked recipes and dusk/night), 1 measurer.
Files owned by the unmerged `loop-perf-202611210548` branch (ocean, debris, plastic, deck, crafts, hands, bake, item-icons rewrite)
were left alone. Two of the `loop-perf-202611210540` commits applied cleanly and were cherry-picked (input bindings, controls tabs).

Numbers. The perf gate runs with quality pinned (`?pinQuality`, new default) so builds compare at the same tier, alternating B/A/B/A,
SwiftShader 640x360, load average 6-17. Means of 2 runs:

| area | metric | before | after | change |
|---|---|---|---|---|
| gate | draw calls mean / p95 | 152.3 / 161 | 142.1 / 152 | -6.7% / -5.6% |
| gate | shadow-pass draws mean | 10.0 | 7.1 | -29% |
| gate | triangles mean | 113.5k | 118.0k | +3.9% (random debris mix + fitted shadow box; not a model change) |
| gate | DOM growth (elements) | 40 / 27 | -4 / 2 | about -100% |
| gate | script ms/frame | 3.5 | 3.0 | -14% (noisy) |
| gate | hitches | 0 | 0 | 0 |
| gate | result (new accounting) | pass | pass | — |
| alloc | KB/frame idle / walk / hook / inventory | 126 / 91 / 103 / 85 | 111 / 72 / 73 / 67 | -12% / -20% / -30% / -21% |
| alloc | timer KB/s walk / hook / inventory | 50 / 29 / 54 | 29 / 22 / 39 | -41% / -23% / -28% |
| startup | nav → raftDebug ready (median of 6) | 597 ms | 528 ms | -11.5% |
| startup | mount end | 1234 ms | 1070 ms | -13.3% |
| startup | JS requests / decoded KB | 108 / 2764 | 103 / 2725 | -4.6% / -1.4% |
| startup | WebGL contexts at title | 2 | 1 | -50% |
| startup | solo createCoop | 328 ms | 4 ms | -99% |
| shaders | programs at spawn | 38 | 35 | -8% |
| shaders | shadows-off switch relinks | 9 (≈1 s frame on SwiftShader) | 0 | -100% |
| first key | brown-noise build | 125 ms, 4.6 MB garbage | 34 ms, 2.3 MB | -73% / -50% |

What landed:
- Rendering:
  - anchor post, crank and arm merged; drum and coil no longer cast shadows
  - grill smoke hidden while no puff is alive
  - gull body 424 → 164 triangles
  - shadow camera fitted to the raft at init
- Allocation:
  - input bindings read in place (cherry-picked)
  - wildlife constants cached in typed arrays (output bit-identical over 36k frames)
  - daynight sky, palette and sun refreshed at 10 Hz of game clock
  - game.js reuses scratch objects for held tokens, hook params, rope points and signal options; forced camera matrix update dropped
  - coop-fx returns early when no ping is alive
  - `raftDebug.hud` light view for the prompts and onboarding polls
- Startup:
  - item icons warmed after gameplay starts; icon renderer kept 60 s so it isn't re-created
  - co-op remote avatar built on first peer hello
  - diving shaders warmed at idle
  - every module import carries the build stamp: 5 modules no longer load twice, and the split module state bug is gone (new test)
  - shorter crossfaded noise loop
- Adaptive quality:
  - frames over 250 ms are clamped instead of ignored, so very slow machines now step down
  - stops stepping up after 3 reverts at a level
  - pixel ratio set once per change
  - no-shadow shaders warmed only when the scaler is one step from shadows off, so fast machines keep 35 programs
- DOM:
  - craft-list lock badge and research hint drawn with CSS pseudo-elements
  - onboarding skips unchanged writes and places Notes once per bag open
- Perf gate:
  - starts from the visible title button
  - heap late half budgeted on JS objects only (V8 compiled code excluded)
  - GL objects counted per context, freed on context loss
  - context budget is now peak simultaneous contexts
  - quality pinned by default

Regression check: PASS (no page errors, same console warnings; only expected differences: drum shadow gone, gull head slightly
more faceted). Rust/WASM: no; no JS function is over 1 ms/frame (see `docs/loop/rust-wasm.md`).

Left for later:
- render icons with the main renderer, which needs the item-icons rewrite branch
- bake each scenery island into one mesh (on the 0548 branch)
- `tests/coop-e2e.mjs` clicks the hidden `#welcomeCrew` and no longer runs
- slow bounded GL buffer creep (+52 buffers over minutes 2-8 of play)
- "Discover at a Tinker's Desk" heading squeezed to 3 px (pre-existing UI bug)
- `ocean.sampleAt` to remove double-argument boxing in `updateItems`

## 2026-11-21 · loop-features-202611210648 (features)
Base: origin/claude/raft-master (8cfdbcd). Branch: claude/loop-features-202611210648.

Features (research in docs/features, specs in docs/specs):
- **Rain Barrel + Sprinkler**: the barrel fills during rain (1 fresh cup per 30 s, with a slow dew trickle as a fallback), and E fills a cup at it. The sprinkler waters one dry, unripe palm per second in the 8 tiles around it, from its own tank or from a barrel beside it. State is in `world.collectors` / `world.sprinklers`, which old saves load as {}. New `get rain()` in daynight. Files: dist/rain.js, rain-model.js.
- **Instruments**: three held instruments, Tide Drum, Reed Pipes and Bell Bars. LMB or RT plays; camera pitch picks one of 8 D-pentatonic notes. New `audio.note()` on the effects bus (50 ms gap, 10-voice cap). Co-op sends a transient `inst` message with validation, rate limits and distance falloff; HELD enum appended. Files: dist/instruments.js, instrument-models.js.
- **Beehive + Flower Box**: honey and beeswax for a Beeswax Candle (night glow) and Honey Glazed Fish. Combs fill from flower boxes within 2 tiles, up to 3 combs. Flower seed comes from island bushes and treasure barrels. State in `world.ext.bees`, with an OLD_HOST guard. Files: dist/bees.js, bees-model.js.

Fleet: 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA, 1 QA fixer (14 agents).
Review fixes:
- The candle's night light blew the deck out.
- Hidden sprinkler spray stole the aim; pip materials leaked on raft rebuild.
- The instrument prompt hid the pickup and swim prompts; the rate limit ran before validation; note sprites are now pooled.
QA found that every content-module and watering prompt (round 1 purifier, storage, grill, plus this round's) went into the CSS-hidden `#contextPrompt` and leaked status lines into the notice feed. They now go through `raftPrompts.provide` via `promptFromHtml`.
Checks: `npm test` 568/568 (was 533); shoot.py `errors: []`.
Known limits: live two-peer co-op not run (co-op reviewed by code and unit tests). Mixed-version co-op unsupported (older builds drop the new decor and reset bags holding new kinds). Removing a barrel, sprinkler or hive with the hammer discards its contents. Fishing labels over 48 characters get cut off.
Next ideas: hammer pickup that refunds contents, a placeable music stand, flower variety, sprinkler range ring while aiming.

## claude/loop-visuals-202611210648 (visuals, round 2)
Base: origin/claude/raft-master (d56c3ef). Fleet: critic, 6 builders (sky, water, materials, hands-and-items, UI, models), art judge, perf checker (10 agents).
- Accepted (judge: all 6 clearly better):
  - sky.js dome wired in and driven by a new 9th daynight palette column (blue zenith, pale cyan horizon, white wispy clouds); mesh clouds hidden.
  - ocean shader: saturated blue, crisp horizon with a pale far band, sharp glints, foam only near the raft.
  - deck: weathered grey-tan per-board tones, dark gap underlay, worn wood texture; deck meshes 7 -> 5.
  - held hook rebuilt as a stick with a white bottle grip and orange plastic claws; fingers wrap the grip.
  - warm wood-and-parchment HUD, inventory, pause menu and quest card.
  - scenery islands: sand shelf, rocks, lumpy canopy, leaning palms (same draw calls).
- Judge fixes: solid slot numbers, outlined slot icons, warmer sand and boards.
- Perf: first A/B FAILED (deck +78%, horizon +36%). Cause: the plank texture's bump map and 4x aniso after the new board UVs, plus the sky's second fbm. Fixed (no bump, 2x aniso, one-octave detail).
- Re-measured ABAB with the seeded probe:
  - horizon 236 -> 232 ms
  - deck 433 -> 410 ms
  - draw calls 154 -> 140
  - PASS
- npm test 532/532.
- Next:
  - hotbar/inventory hook icon still shows the old steel gaff; icons need painted look with dark outlines
  - square foundation tiles instead of long planks
  - contact foam ring around the raft, more cyan near water
  - bigger islands with cliffs
  - coop-fx.js remote hook still steel
  - thumb blob on the hook grip
  - faint banding in the pause panel
- Integrator merge into raft-master: only the orange-claw hook (hook.js) was taken; sky, daynight, ocean, deck, wood, islands, hands and HUD were stale parallel copies of work already on raft-master, so raft-master kept its versions (sky stays driven by daynight via sky.follow).

## 2026-11-21 · integrator round 5 (integrator A)
- Merged into raft-master: fleet-tech procedural-models/foliage/audio/perf/water/icons, loop-perf-0708, loop-features-0648, raft-tech, raft-content, raft-tests, lane-models, loop-perf-0648 (daynight refresh at 10 Hz, late no-shadow warm, idle dive warm), loop-perf-0720 (ghost hold after place, Shift+R 15° steps; Alt+R now turns backwards), loop-features-0703, loop-ux-0603/0648 remainders (bee item sources, title save line), loop-features-0831 (juicer, gull, building pack; restored after the earlier revert once the branch was finished).
- Skipped: lane-placement (old placement model, superseded), raft-reference (third-party reference frames, not game code).
- PR #2 review (2 reviewers, comments on the PR). Fixed: items.js still had an 8-slot hotbar, so slots 9/0 reset on load and for co-op guests; red off-deck ghost said "Place"; slot 9/0 onboarding hint; pickup feed covered the vitals panel; vitals panel overlapped the 10-slot hotbar below 1100px; resume hint forced next to the crosshair by an !important rule; sky noise texture leaked on hot swap.
- Gate at dbf2ca9: 983/983, no page errors, hook-only spawn, Esc from inventory keeps the lock with no pause, no centred text. Perf vs main (pinned, median of 3, interleaved): 185/191 vs 195/192 ms, 49-52 vs 51-55 draw calls.
- Merged PR #4 into main (912d941).

## 2026-11-21 · loop-features-202611210648 (features)
Base: origin/claude/raft-master (8cfdbcd). Branch: claude/loop-features-202611210648.

Features (research in docs/features, specs in docs/specs):
- **Rain Barrel + Sprinkler**: the barrel fills during rain (1 fresh cup per 30 s, with a slow dew trickle as a fallback), and E fills a cup at it. The sprinkler waters one dry, unripe palm per second in the 8 tiles around it, from its own tank or from a barrel beside it. State is in `world.collectors` / `world.sprinklers`, which old saves load as {}. New `get rain()` in daynight. Files: dist/rain.js, rain-model.js.
- **Instruments**: three held instruments, Tide Drum, Reed Pipes and Bell Bars. LMB or RT plays; camera pitch picks one of 8 D-pentatonic notes. New `audio.note()` on the effects bus (50 ms gap, 10-voice cap). Co-op sends a transient `inst` message with validation, rate limits and distance falloff; HELD enum appended. Files: dist/instruments.js, instrument-models.js.
- **Beehive + Flower Box**: honey and beeswax for a Beeswax Candle (night glow) and Honey Glazed Fish. Combs fill from flower boxes within 2 tiles, up to 3 combs. Flower seed comes from island bushes and treasure barrels. State in `world.ext.bees`, with an OLD_HOST guard. Files: dist/bees.js, bees-model.js.

Fleet: 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA, 1 QA fixer (14 agents).
Review fixes:
- The candle's night light blew the deck out.
- Hidden sprinkler spray stole the aim; pip materials leaked on raft rebuild.
- The instrument prompt hid the pickup and swim prompts; the rate limit ran before validation; note sprites are now pooled.
QA found that every content-module and watering prompt (round 1 purifier, storage, grill, plus this round's) went into the CSS-hidden `#contextPrompt` and leaked status lines into the notice feed. They now go through `raftPrompts.provide` via `promptFromHtml`.
Checks: `npm test` 568/568 (was 533); shoot.py `errors: []`.
Known limits: live two-peer co-op not run (co-op reviewed by code and unit tests). Mixed-version co-op unsupported (older builds drop the new decor and reset bags holding new kinds). Removing a barrel, sprinkler or hive with the hammer discards its contents. Fishing labels over 48 characters get cut off.
Next ideas: hammer pickup that refunds contents, a placeable music stand, flower variety, sprinkler range ring while aiming.

## loop-ux round 5: claude/loop-ux-202611210748 (base: origin/claude/raft-master 7294e26)
Merged the unmerged round-4 branch (loop-ux-202611210648: steady recipe order and panel height, hold counter, tooltips beside their element) first. Fleet of 7 subsystem hunters, a new-player screenshot reviewer, 2 adversarial verifiers per cluster (14), and 7 fixers, each fix with a regression test.

Fixed (confirmed by both verifiers unless noted):
- **Cursor and lock:** Chrome's post-Esc SecurityError no longer counts toward drag-look fallback. The cursor stays visible in drag-look after a panel closes. `relock` is cleared on blur so the away hint shows. `acceptFirstMouse` is set in Electron. Desktop Esc now closes the hammer build wheel and keeps the lock: `raftShell.closeBuildWheel()` is called from `raftEscape`.
- **Controls:** keys held through a panel resume when it closes, with no false press edge. A sub-frame Space tap jumps. Mouse flicks over 300px go through the look spike filter instead of being dropped. The fish journal closes on physical KeyJ.
- **Build wheel:** holding Q no longer flickers it open and shut. While it is open, digits, the mouse wheel and E are swallowed. WASD still works, which is intended. R is consumed only for pieces that rotate.
- **Fishing:** a rod charge or reel hold is released on blur and lock loss, so there is no stale full-power cast. E follows the prompt order. Gamepad RT uses fishing v2. Clicking during the post-catch linger recasts. Grills don't cook on the title screen.
- **HUD:** the crosshair prompt follows the fishing stage and grill, rain and content prompts. The dive label, binoculars readout and reel bar moved out of screen centre into the crosshair-side column. The three bottom-left feeds are now one stack. Notes and achievements show once, and the toast queue is FIFO. The help text gives the right bag-close keys.
- **Inventory:** a metal hook is repaired with R. A cast retracts when its hook leaves the slot. Barrel pity counters advance only when the loot is taken, and nets back off for 6s after a refused roll.
- **Crafting (Raft-like):**
  - Layout: a vertical category column, a tall scrolling recipe list with a fade, and a detail pane (big icon, used-for, have/need rows, Craft) above a 10-column backpack. The panel is the same size on every tab.
  - Locked recipes: recipes locked behind the Tinker's Desk show as locked with the full reason, instead of "Ready" while the host refuses them.
  - Crafting and icons: a click crafts exactly 1, and a hold repeats after 800ms with a fill. The receiver has a real icon. Tooltips never jump to the top-left or cover the Craft button.
  - Build costs and categories: costs show per-material have/need using bag names. Cup and purifier are in Survival.
- Refuted: Tab-to-close bag (Tab moves focus by design; help text fixed).

Gate: npm test 695/695. `tests/art.test.mjs` "atlas build stays fast" is load-sensitive: it fails sometimes with ~20 agents on 4 cores and passes alone. shoot.py: no page errors; Esc from inventory leaves the game locked with no pause; Esc closes the settings panel first.

Open / next:
- Gamepad build menu (Pad12) lists decor and emits an unhandled `buildPick`.
- Rebinding UI is not mounted in settings; several keys bypass input-map.
- Two Invert Y settings.
- Ctrl+W crouch-walk closes the browser tab.
- Pieces and decor don't check each other for overlap.
- The host does no reach check on piece and unpiece.
- Fish journal chip overlaps the hotbar at 390px.
- Grill progress is lost on tab discard.
- Icon style still swaps from flat SVG to 3D mid-session.
## 2026-11-21 · loop-features-202611210735 (features)
Base: origin/claude/raft-master (c96002e), plus the two round-1 commits that missed the master merge (the prompt fix).
Branch: claude/loop-features-202611210735.

Features (research in docs/features, specs in docs/specs):
- **Fish Trap**:
  - Placed on edge tiles only, via a new `placeBlock` content hook. A woven creel hangs off the raft edge into the water.
  - Catches a fish every 240 s, or every 150 s with seaweed bait (5 charges). Catches use `rollCatch` on a seeded host RNG; up to 3 fish.
  - E collects all-or-nothing into the bag and the collector's journal (`recordTrapCatch`).
  - Tails poke above the rim when the trap holds fish; a seaweed tuft shows when baited.
  - State in `world.ext.fishtrap`. Files: dist/fish-trap.js, fish-trap-model.js.
- **Power**:
  - Wind Turbine, Battery, String Lights and Lamp Post. Turbines beside a battery charge it from the daynight wind; lights within 3 tiles glow and drain it at night.
  - Only the charge is synced (`world.ext.power`); each peer works out lit state itself.
  - No new PointLights: the Lamp Post shares the lantern pool lights, and new `night` getter and per-light lit flag in daynight.
  - Files: dist/power.js, power-model.js.
- **Display Shelf + Trophy Stand**:
  - E puts or takes the held item in the aimed slot, through atomic host actions with `expect`.
  - Items are fitted to the slot: tools stand upright, long items lie flat.
  - The stand mounts a cosmetic trophy of a fish species from your journal, with a plaque.
  - State in `world.ext.display`. Shared per-kind model templates; 48-model cap. Files: dist/display.js, display-model.js.

## 2026-11-21 · loop-features-202611210831 (features)
Base: origin/claude/raft-master (1636dfe). Branch: claude/loop-features-202611210831.
Round 2 (loop-features-202611210735) is not in raft-master yet. It conflicts with raft-master's own content-prompt routing and the vitals lane, so it needs an integrator merge.

Features (research in docs/features, specs in docs/specs):
- **Juicer and smoothies**: berries come from island bushes (25% of plain-leaf picks; seed and flower rates unchanged), and coconuts from ripe palm planters. E on the Juicer blends 1 fresh cup and 2 fruit into a berry, coconut or island smoothie. It is host-checked and all-or-nothing. The drinks feed vitals and give the cup back. Also: a `honeyfish` FOOD row (it could not be eaten before), an `isDrink` cue, and an E content prompt now beats the eat hint. Files: dist/juicer.js, juicer-model.js.
- **Companion Gull**: on a Gull Perch, treats on a 90 s visit schedule (3 points to move in). Rest, loop and follow modes run on the host clock; only the clock is synced. Pet and name it, with a heart burst. Finds go into a 3-slot tray, collected all-or-nothing. The rename dialog is shared with the Puffhen. State is in `world.ext.gull`. Files: dist/gull.js, gull-models.js.
- **Building pack**:
  - Railing (1.2 m collision so a bobbing jump can't clear it), Hatch and Gate (E toggles, `o:1` only while open, so closed records are unchanged), and Ladder (MoveFeel climb with a virtual ground in preStep).
  - The host `piecetoggle` checks `expect`, reach and occupancy, and is rate-limited.
  - The open variants are instanced meshes.

Fleet: 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA, 1 QA fixer (14 agents).

Review fixes:
- Fish trap:
  - Fish can still be collected from a trap that no longer sits on an edge.
  - The waiting percent no longer goes over 100.
  - The bob animation is skipped off-screen.
- Power: old-host prompts on lights; slimmer wooden turbine; brighter powered bulbs and darker unpowered ones; battery charge gauge on the top face.
- Display: items fitted to slots, using instanced-mesh bounds; plaque textures stay alive while shown.

QA regression fixed: round 1's game-aim provider hid the placement hint while holding a crate or bench. Place mode now shows the hint, with the aim prompt stacked below it.
Also fixed:
- muted status prompts get a dark pill
- the caught-fish viewmodel also expires on wall-clock time
- new tests/syntax.test.mjs runs `node --check` on every dist module, after a broken game.js passed `npm test`

Checks: `npm test` 605/605 (was 568); shoot.py `errors: []`.
Known limits:
- Live two-peer co-op not run; mixed-version co-op is unsupported.
- Decor still cannot be removed (a refund helper exists for shelves).
- Trap catches don't count toward fish achievements.
- The trap's placement ghost doesn't face the water.
Next ideas: decor pickup with refunds, achievement hooks for content modules, flower variety, power for the receiver and purifier.

- Follow-up: the electron check caught an uncaught `isReady` TypeError (three r170 compileAsync polling a material disposed
  mid-compile); patched the vendored three with the upstream-style guard. Full fleet-gate PASS at dbf2ca9 (983 tests,
  hook-only spawn, Esc from inventory keeps the lock, no page errors, shoot.py 159 vs 156 ms on main = +2%).
  PR #4 merged dbf2ca9 into main. PR #5 (round 6) is the open PR now.

## 2026-11-21 · loop-fidelity-202611210914 (raft fidelity, worker B round 2)
Base: raft-master 3247525. Two fidelity routines are running in parallel. Worker A's 0714/0804/0821 rounds landed first, so worker B's round 1 (`claude/loop-fidelity-202611210747`: needs, shark, spear) is superseded and should NOT be merged.
- Round 2 built crops + gull raids + scarecrow, bed, drowning and fuel parity on the 0747 base. Crops and fuel duplicate worker A's 0804/0821, so only the pieces raft-master lacks were ported onto its vitals API.
Landed:
- **Simple Bed (extends sleep.js; one 'bed' kind):**
  - recipe 10 leaf, 6 wood, 4 plastic, 3 nails
  - a slept night gives +40 health, -20 food, -20 water (vitals.adjust; health floor 1)
  - the last bed you lay in or placed is home: wake there at 25/50/50; if it is gone, wake at the raft centre with RESPAWN
  - no lying down while swimming; the co-op prompt shows "1/2 sleeping"
- **Drowning:**
  - breath 33 s, halved at 0 food or water; empty air underwater costs 3.5 HP/s (every 0.5 s, cause 'drown')
  - waking up resets the dive
  - the faint overlay names the cause
  - Breath Jug now gives 55 s
Checks: npm test 1029/1029. Headless bed run: night prompt, sleep to morning, faint then wake in bed at 25/50/50; no page errors.
Not covered in the browser: drowning (SwiftShader time is too slow; unit-tested) and the bed-gone fallback (unit-tested).
Open for worker A: gull crop raids + scarecrow (built on work3 against the old needs API; not ported). raft-master has no game modes, so sleep and drowning effects always apply.

## 2026-11-21 · loop-features-202611210749 (features)
Base: origin/claude/raft-master (7294e26). Merging rounds 0548/0703 into the base hit 10 conflicting files, so that is left to the integrator. Not redone: everything listed in rounds 0548/0703 plus the other branches' diving gear, trader, cookpot, fish trap, power chain and display shelf.

Features (research in docs/features, specs in docs/specs):
- **Junk debris + Sorting Tub**: `oldboot`, `tincan` and `seajar` are about 1 in 11 floating spawns (re-rolled in makeItem, so the spawn table is unchanged). Hooks and nets collect them. The Sorting Tub is a fuel-free progression station (6 wood, 2 rope, 3 nail, unlocked after nails) that sorts tin into 2 scrap, boot into 2 plastic and jar into 2 sand. It reuses StationModel through a `stationExtraRecipes` fallback, so the smelter and grill are unchanged. The tub has a crank animation and an output pile. Files: dist/recycler-model.js plus hooks in items.js, smelter.js, smelter-ui.js, progression-hooks.js and models.js.
- **Daily crew tasks**: 3 tasks a day from a pool of 16, picked from (seed, day) and skipping tasks whose prerequisites are missing. Counting is host-only, through a new `observe(ev, actor)` content hook placed after every successful action. Small rewards, an all-three bonus and a streak with a best. Each player claims their own reward, unclaimed rewards carry over as `owed`, and the day falls back to a play-time clock when day/night is off. The logbook has a "Tasks" tab and there is a Task Board decor. Files: dist/tasks.js, tasks-rules.js, tasks-model.js.
- **Little Camera + photo album + Photo Frame**: click to snap. The capture hides hands and ghosts, crops to 256x144 and saves a JPEG to IndexedDB, falling back to localStorage and then memory. The album holds 24 photos and refuses new shots when full. P opens the album (also from the pause menu). The Photo Frame decor shows a chosen photo; the owner sends the JPEG once over co-op, the message is validated and capped at 24k chars, and image data never goes in saves. Files: dist/camera.js, photo-store.js, photo-album-ui.js, camera-models.js, photo-frame.js.
- Also fixed on the base: holding a seed threw a ReferenceError every frame, because `farmPlot` is undefined at game.js:1158.

Fleet: 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA (13 agents).
Review/QA fixes:
- **Station take (serious):** the recycler change had made "take output" also empty the smelter/grill input, which could also duplicate items.
- **Pickup feed:** icons for placeholder items were missing.
- **Station node lookups:** were repeated every frame.
- **Tasks:** solo games owed rewards to the empty guest seat; a guest briefly showed stale tasks; the Claim button re-armed early.
- **Camera:** pose was hidden behind the hotbar; the flash was barely visible; a hung save could lock the camera; co-op photo asks were slow; moved frames left stale entries in the save.
- **Phone layout:** the journal chip overlapped the hotbar, and the bag hotbar row was clipped.

Checks: `npm test` 660/660; shoot.py `errors: []`. A two-tab loopback co-op run of the photo frame passed.
Known limits:
- An intermittent three.js `compileAsync` "isReady" error comes from warmShaders in game.js (existing).
- One headless run produced a solid-teal photo (not reproduced), and once only 3 of 4 snaps were saved.
- Capture while diving is unverified.
- Junk items get 3D icons while the new stations have flat icons (mixed styles).
Next ideas: merge rounds 0548/0703/0749 into master; look into the warmShaders race; snap/save reliability; a richer camera model.

## 2026-11-21 · integrator B round 4 (alongside the parallel integrator, which shipped PRs #3 and #4)
- Clean merges: loop-fidelity-202611210821, raft-tech, fleet-tech perf/water. Sky dome now disposed on hot swap.
- One subagent per conflicting branch, each pushing straight to raft-master after tests, shoot.py and perf:
  - merged loop-features-202611210722 (diving gear, Pim's trader barge, cooking pot) and 0648; loop-ux-202611210743 (menu restyle, help panel, sound settings);
    loop-perf-202611210708 (partial: quality ladder, fog cache, cached models) and 0648; loop-visuals-202611210648 (new held hook only).
  - skipped loop-fidelity-202611210747 (second copy of vitals/shark with a different save format; its game-mode and death card would need porting),
    loop-perf-202611210720 (stale), loop-ux-202611210742 (redoes lock rows, still being pushed). raft-integration was already in.
- Gate at 9b3ba49: 1023/1023, no page errors, hook-only spawn, Esc OK, perf 133 ms / 43 calls (main 912d941: 229 ms / 49 calls).
- Recurring flake: tests/art.test.mjs atlas build-time (<1500 ms) fails under machine load (load avg > 15); passes alone.

## 2026-11-21 · loop-features-202611210814 (features, round 4)
Base: origin/claude/raft-master (77b1cb6) + round 3 branch (rounds 1–3) merged in; master did not yet hold round 2, it comes with this merge. Avoided features other loop runs already covered (shelf, fish trap, wind power, crew tasks, camera, recycler, fireworks, zipline, scarecrow, treasure, map table, customise…).
- **Driftboard paddleboard** (`paddleboard`) — craft, launch from the deck edge, ride at ~3.6 m/s (4.5 sprint) with mouse steering, tethered under 45 m, tie/pick up/drift home, co-op riders visible. Adds the zipline-compatible `ride`/`riding` content hook (byte-identical to loop-features-202611210753-zfs) + extra rideIn fields in game.js.
- **Driftwood Game Table** (`gametable`) — draughts (forced captures, multi-jumps, kings) and noughts & crosses vs the crewmate or the Gull AI (Easy/Clever minimax); 2D board dialog + instanced 3D pieces; host-authoritative moves with stale-move counter.
- **Buoy ring course** (`buoycourse`) — Start Flag with course board, four preset shapes, countdown, ring crossing detection (swim and board bands), timer pill, bell per ring (contentCtx `note`), top-5 scoreboard per shape/mode with host-validated finishes.
Fleet: merge agent, 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA (14 agents).
Fixes: icons.svg was invalid XML on master (unclosed sprinkler symbol) — closed; course timer now on the movement clock and generous host min-time; game table save validation, gull/dialog after table removal, instanced buffer leak; driftboard orphaned guest ride, held Space after UI, per-frame scan; course flag answers E while riding (FEATURES order); X pieces no longer inherit the close-button style; course beam no longer blinds riders; phone timer pill clear of compass; riding prompt wording.
Checks: npm test 835/835; shoot2.py errors []; coop2 loopback base failures only (3, 4, 6; 2b flaky under load); loopback verified guest board, guest draughts moves, guest course finish.
Observed: master now shows health/hunger/thirst vitals bars — a design change from the original "no damage, no hunger" brief made in another lane; not touched here.
Known limits: held driftboard viewmodel is a plain box; noughts winning line not highlighted; chest/trader/sleep take E before the board while riding.

## 2026-11-21 · loop-features-202611210753-zfs (features)

Base: `origin/claude/raft-master` 7294e26. `raft-integration` was newer by commit time but 685 commits behind master; merging it gave 6 conflicts (held-items, ocean, settings, sky, survival-ui, survival tests), so that is left to the integrator. The branch name has a `-zfs` suffix because a parallel session pushed `loop-features-202611210749` first.

Features (research, spec, build, review for each; then one visual QA pass and one polish pass):
- **Scarecrow + gentle gulls** (`dist/scarecrow.js`, `scarecrow-model.js`; spec `docs/specs/scarecrow.md`). Gulls 0–2 sometimes land on a watered palm planter and pause its growth (it never goes backwards). The host decides pecks, with one pecking gull per raft and a 90 s cooldown per planter. E shoos the gull through `raftPrompts`, and harvest/water E still work. A Scarecrow protects palms within 4.5 m, and gulls sit on its hat. `world.ext.scarecrow` is only sent over the network; an old host turns the feature off.
- **Sky Rockets** (`dist/fireworks.js`, `fireworks-model.js`; spec `docs/specs/fireworks.md`). A placeable rocket; E lights it through a host action, then fuse, rise, and a sphere, ring or willow burst. One pooled Points draw call, a hemi sky flash at night, whistle/pop/crackle sounds, and the `firework1` achievement. Old peers get `sound:'none'` and no notice. New `content.effect` and `content.night` hooks.
- **Ziplines** (`dist/zipline.js`, `zipline-model.js`; spec `docs/specs/zipline.md`). Glide Post and Low Glide Post decor, and a Glide Handle. E on two posts strings a line (4–16 m, rope cost scales with length, blocked by building pieces). Riding uses gravity, drag and input, Space lets go, and you hop off at the end. `world.ext.zipline` holds the lines. Co-op: `HELD[17]=glidehandle`, and pose flag bit 8 means riding (the partner hangs with arms up).

Review fixes:
- The shoo prompt was invisible because `#contextPrompt` is hidden.
- The sky flash drifted on dispose and flickered on back-to-back bursts.
- You could mount a zipline mid-clamber.
- Riders passed through walls built across a line.
- Ropes ignored the raft's tilt.

Visual QA (`docs/cloud/qa-round-zfs.md`, shots in `docs/cloud/shots/zfs/`) fixed 9 issues:
- Real held models for the new placeables (and candle, beehive, flower box).
- Bolder, bigger bursts and a willow that droops.
- The gull no longer clips the palm.
- A chunkier rocket.
- A hanging ride pose, and the ride stops 1.3 m before the end post.
- A 1.15x scarecrow.
- A distinct low-post icon.

Checks: `npm test` 680/680, and shoot.py plus the feature capture scripts ran with no page errors.

Open for next round:
- **Hidden prompts:** watering, purifier and other content prompts that go through `updateContext` never show, because `#contextPrompt` is `display:none`. They need `raftPrompts` providers.
- **Mixed icons:** bags mix flat SVG and 3D-rendered icons.
- **Gold willow:** the willow core still looks warm-white up close.
- **Not exercised:** the two-browser co-op e2e for all three features was not run.
- **Island sand:** `islands.afterMove` still runs during a ride.

## 2026-11-21 · integrator D: loop-ux-202611210848, loop-ux-202611210852
- Skipped claude/loop-ux-202611210848: its new work is loop-ux-202611210833 (plus loop-ux-0648 commits) with an older raft-master merged in; both are claimed by integrator B, and it conflicts in 16 files.
- Merged claude/loop-ux-202611210852 with no content change: its only new commit merges loop-ux-202611210748, which raft-master already has; kept raft-master's side.
- Gate after merging raft-master: 1138/1138 tests, no page errors, hook-only spawn, Esc from inventory keeps the lock with no pause, no centred text; 166 ms/frame, 37 draw calls.

## 2026-11-21 · integrator F (scheduled run, 09:34 UTC)
- Merged loop-features-202611210926 (biofuel and power-hookup specs, research notes; docs only). npm test 1270/1270.
- Skipped loop-visuals-202611210548: 1624 commits behind, conflicts in sky.js and hands.js, and baking the sky once would freeze
  the daynight-driven sky on raft-master.
- Still skipped: loop-perf-0720, loop-fidelity-0747 (large stale branches, need worker rebases). Everything else with new commits
  is claimed by integrators B-E in STATUS.md, so this run left those and PR #5 (gated by B) alone.
- Screenshot gate tool unavailable here (no Python playwright); not a blocker for a docs-only merge.

## 2026-11-21 · integrator D: loop-fidelity-202611210900, -0910, -0914; loop-features-202611210855
- Merged loop-fidelity-202611210914: Simple Bed (Raft recipe, sleep effect on vitals, home-bed respawn) and Raft breath (33 s, halved when starving) with drowning damage.
- Merged loop-features-202611210855: docs only, research notes and specs for zipline, night light (hand lantern, firefly jar) and crops.
- Skipped loop-fidelity-202611210900: it is loop-fidelity-202611210821 (paddle, stone axe) merged with raft-master, and integrator B claimed -0821.
- Skipped loop-fidelity-202611210910: conflicts in 11 dist files, and its edge collection nets (nets.js, world.nets) replace raft-master's decor net collection. Needs a rebase by its worker. It also brings crops, foundation armor, a 2x2 start and Raft costs.
- Gate after merging raft-master: 1277/1277 tests, no page errors, hook-only spawn, Esc from inventory keeps the lock with no pause, no centred text, 198 ms/frame, 46 draw calls. Kept the raft-master zipline spec over the older one in -0855.
- Juicer: open hopper funnel.
- Gull:
  - prototype-key treats
  - junk timestamps that blocked treats forever
  - a rebuild after dispose
  - culling
  - its own slimmer wing and a neck
- Building:
  - The new thin-wall sweep froze players sliding along walls at low fps; it was rewritten.
  - A guest no longer drops off the ladder on every pieces resend.
  - The hatch prompt now beats the eat hint.
  - A double press can no longer re-toggle.
- QA fixes:
  - The pickup feed covered the new vitals panel; the pickup and notice feeds are lifted above it.
  - One post per railing corner.
  - Lighter hatch underside.
  - Shaped gull finds.

Checks: `npm test` 857/857 (was 816); shoot.py `errors: []`.
Known limits:
- Live two-peer co-op not run; mixed-version co-op is unsupported.
- Stepping backward off a ladder top drops a storey.
- A ladder placed under a painted hatch loses the tint.
Note for the owner: raft-master now has hunger/thirst/health, sharks and a spear (the "fidelity" lane). The README still says "No hunger or damage".
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

## 2026-11-21 · integrator round 6 (integrator A)
- Merged clean: loop-perf-0823, loop-features-0831 (finished juicer), raft-tech.
- Lane agents (respecting STATUS.md claims by integrators B/C/D): features 0648, 0735 (power, fish trap, display shelf), 0749 (camera/album, crew tasks, recycler, photo frame, task board), 0753-zfs (scarecrow, fireworks, zipline); visuals 0558 (record only, stale copy), 0748 (crisp horizon, deck water, hand shading), 0843 (outlined icons, notes card). Fixed along the way: bake.js baked the fishing rod's instanced guide rings at unit size.
- Skipped: loop-perf-0720 (stale rewritten copy of work already in raft-master), loop-fidelity-0747 (second needs/shark system next to vitals), loop-ux-0743 (needs worker rebase onto the wood crafting panel). loop-fidelity-0804 is resolved and tested on merge/loop-fidelity-0804 for its claimant (B).
- PR #5 review (2 reviewers, comments on the PR). Fixed: juicer hopper never added to the model; string lights turned on the point-light pool (19 shader links mid-game); photo frame cast 9 shadows; picking up a linked glide post dropped its rope (posts now refuse pickup); misleading "Empty it first" text. The photo album's exit-lock fix had already landed.
- Gate at fd3724d: 1398/1398, no page errors, hook-only spawn, Esc from inventory keeps the lock with no pause. Perf vs main: 99-103 vs 185-197 ms, 45-49 vs 46-52 draw calls.
- Merged PR #5 into main (c3a29df).

## Integrator B, round 6 (09:30-10:00 UTC)
- Merges (one subagent each, tests + shoot after each): loop-fidelity-0804/-0821 (only commits another integrator had not taken), loop-ux-0648 via -0833 (most of 0833 was a stale copy; took build rules, crate/desk keyboard nav, chip/lock wording, logbook back-to-pause), loop-visuals-0805 (partial, menu restyle dropped), loop-perf-0708 (docs). features-0814 was already merged by another integrator.
- Skipped, need a worker rebase: loop-ux-0742, loop-ux-0743 (23 conflicting files each).
- PR #5 reviews posted (code + visual). Fixed: junk pickups now drawn by the item batch with no shadows; content first() skips modules without the hook (no per-frame arrays); look and album panels release the lock via exitLock; duplicate craft-book key; fish-trap tails cast no shadow; compass, vitals and journal chip hidden while the bag is open.
- Not bugs: the pause-menu double highlight is a headless stale-cursor hover. esc-relock.py is out of date (uses #newGame and #crewButton).
- Gate at fd3724d: 1402/1402, no errors, hook-only spawn, Esc OK, perf 126/96 vs 255/159 ms, draws 51/45 vs 50/50. A merged it into main (c3a29df); PR #6 open.


## 2026-11-21 · :00 integrator round (08:35-10:10 UTC)
- Merged into raft-master: raft-tech, raft-integration, loop-perf-0648/-0823, loop-ux-0742 (partial: new-game grill reset, cup rename, title sim freeze, icon-models), loop-ux-0748, loop-visuals-0748, loop-features-0831/-0847-r2/-0849, loop-perf-0847.
- Skipped, need a worker rebase: loop-perf-0708, loop-perf-0720, loop-ux-0743, loop-ux-0848, loop-visuals-0843, loop-fidelity-0747.
- PR #2 review (2 reviewers, comments posted). Must-fix: crafting threw "justMade is not defined" (undeclared assignment brought back by a merge); fixed in survival-ui.js and checked with a craft probe.
- Fixed: the bag's Requires list showed only one ingredient because an empty 88px feed lane squeezed the detail pane.
- Not changed: reviewer asked to centre the crosshair prompt; the gate requires no centred text, so it stays beside the crosshair.
- Gate at fd3724d: 1402/1402, no page errors, hook-only spawn, Esc from bag keeps lock and no pause, perf 138 vs 141 ms/frame, 49 vs 51 draw calls. Merged PR #5 into main (c3a29df). PR #6 open.
- Open nits: hookableItems/updateNotices allocate per frame (game.js hook update, updateNotices); tooltip on the detail icon covers the Requires rows.

## 2026-11-21 · integrator B: PR #5 (round 6) merged
- Reviews on PR #5: juicer hopper was a new shadow caster (fixed); floating junk (sea jars, tin cans) drew as separate meshes,
  pushing draw calls +10-14% over main (now drawn through the instanced item batch; the parallel integrator landed the same fix).
- Perf probe is now seeded (Math.random replaced by a fixed PRNG in an init script), so draw-call counts are repeatable (main: 53.0 on every run).
- Gate at fd3724d: 1402/1402, no page errors, hook-only spawn, Esc OK, 135 vs 225 ms, 50.8 vs 53.0 calls. Merged as c3a29df.
- Open, pre-existing: in the browser, Esc with the hammer build wheel open closes the wheel but leaves the cursor free (Chrome needs a click
  to relock after a user exit). Fix idea: have the wheel release the lock itself, like the inventory does.
## 2026-11-21 · loop-features-202611210847-r2 (features)

Base: `origin/claude/raft-master` 4ee6b16 (910 tests green). Note: master now carries vitals (hunger/thirst/hp) and sharks, which goes against the friendly brief. This round left them alone.

Features (research, spec, build, review for each; then visual QA and a polish pass):
- **Pick up placed items** (`dist/decor-pickup.js`; spec `docs/specs/decor-pickup.md`).
  - Hold X with the hammer. Building pieces still win; otherwise the aimed decor gets a red see-through ghost and the build card names it. Release X sends `{kind:'undecor',x,z,t}`.
  - The host gives back the item itself plus its contents through a scratch bag. It refuses when the item is busy (mid-cook, ripe palm, ready purifier, comb in the hive, motor on, someone in the bed or seat, hen in the nest) or when the bag is full. Items are never lost: a purifying purifier returns its salt cup.
  - New content hooks: `beforeUndecor`, `undecorLoot` and `afterUndecor`, plus a matching set in progression. `caps:{undecor:1}` lets a guest detect an old host.
- **Flagpole + flag designer** (`dist/flags*.js`; spec `docs/specs/raft-flag.md`).
  - The designer offers 8 colours, 6 patterns, 8 original emblems and an emblem colour. The pole flies downwind with a shader wave.
  - Saved as `world.ext.flags` per tile, with one cached texture per design. Guests send `flag.set` and the host checks it.
- **Sitting** (`dist/sitting*.js`; spec `docs/specs/sitting.md`).
  - Bench has 2 seats, Feather Cushion 1 low seat. Look is clamped to ±100°, and the view eases down on sit.
  - WASD, Space or E stands you up; while seated, the sit module gets first claim on E.
  - The host picks seats and stores them in `ext.sit`. Co-op pose bit 16 means seated, and the partner avatar now has knees.
  - New achievement `sit1` "Sit a While". `content.ride` is a shared first-wins hook, the same shape as the zipline branch.

Review fixes:
- Flag pointed crosswind.
- The flag dialog outlived its pole.
- A flag texture leaked.
- E while seated could also start sleeping.
- A stale aim could pick up a different item.

QA: `docs/cloud/qa-round-r2.md`, shots in `docs/cloud/shots/r2/`. It found the existing Wind Pennant flying 90° off the wind; that is fixed too.

Checks: `npm test` 954/954.

Merge notes for the integrator:
- `coop.js` flag math now lives in `poseFlags`/`readFlags`. Add the zipline's bit 8 there.
- `content.ride` is identical on both branches, so keep one copy.
- logbook achievement counts add up (`firework1` + `sit1`).

Open for next round:
- No gamepad binding for remove.
- An intermittent three.js warm-up error, `reading 'isReady'`, existed before this round.
- `cleanWorld` keeps decor on integer tiles only.
- Locked recipes still say "Ready to craft".
