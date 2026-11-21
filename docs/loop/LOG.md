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
