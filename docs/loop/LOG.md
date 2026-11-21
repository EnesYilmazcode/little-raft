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

## 2026-11-21 · loop-fidelity round 1 (Raft fidelity worker)
Base: raft-master 6ab9b24. Research: two web researchers. The wiki hosts were unreachable through WebFetch, so the numbers below come from search snippets of raft.fandom.com.
Claimed and landed (the three biggest gaps: Raft is a survival game and we had no needs and no threat):
- **Survival needs** (`needs.js`, `needs-ui.js`):
  - hunger drains 0.09/s and thirst 0.11/s; at 0, health drops 0.75/s each; health regenerates 0.25/s while fed
  - food: raw fish 12.5 food / -10 water, grilled fish 20, cup of fresh water +40 (cup returned), sea water -15; left click eats or drinks
  - lower-left bars; death card, then respawn at 50/50/50
  - game modes Relaxed / Peaceful / Easy / Normal / Hard (`combat-bus.js` MODES) in Settings → Gameplay. New games default to Normal; old saves load as Relaxed, the original no-needs sandbox. README updated.
- **Shark** (`shark.js`):
  - circles the raft at its extent + 4 m
  - attacks an edge tile every 300 s on Normal (Easy 480, Hard 120); bites it for 12 s, then tears it off (never the last tile, an occupied tile, a grill or a crate)
  - 15 damage during an attack drives it off for 25 s; 150 HP; respawns 180 s after death; bites swimmers for 30 damage every 2.5 s
  - one draw call; host-authoritative, with an 8 Hz pose sent to the guest
- **Wooden spear** (`spear.js`, `spear-model.js`): 8 wood + 3 rope, 20 uses, 5 damage, 2.6 m stab. Hit marker. A kill gives the killer 4 raw shark meat, which grills to Grilled Shark Meat.
Reviews:
- Logic: meat goes to the killer, not the host; a dead player is input-blocked; bite damage uses the engine's own needs; crate tiles are protected from tearing.
- Visuals: the biting shark head-on read as a dome, so it got a snout, jaw and teeth; the death card hides the crosshair.
Gate: 567/567. shoot.py: no page errors. Frame time 280 vs 276 ms (+1.6%), draw calls 149 vs 147.
Open:
- a guest's spear wears even on a hit the host rejects
- hot swap during the death card keeps the player's position
- the spear can be crafted in Relaxed
- shark meat goes to the bag, not floating debris
- the stab motion is subtle
Next gaps to consider: Raft's crafting costs vs ours (hook 2 plank + 2 plastic? check), simple purifier/grill fuel by planks, item durability on the hook, oxygen bar while diving, receiver/antenna story islands, potato/beet crops and the cooking pot.
- Follow-up: merged raft-master 7294e26 (instruments, bees, sky, rain collectors, new hand rig) into this branch. Re-solved the spear hold angles for the new right-hand pose, added shark meat sources to the craft book, and put the spear in the Tools order. 662/662.
- Note for the integrator: `claude/loop-fidelity-202611210714` is a parallel fidelity run that built the same three features (vitals, shark, spear) from an older base. Merge only one of the two.
