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
