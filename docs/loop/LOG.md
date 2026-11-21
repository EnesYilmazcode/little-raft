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

## Round 3: claude/loop-ux-202611210743 (base: origin/claude/raft-master e8b7251 + round 2 merged in ead02a0)

Fleet:
- 3 hunters: cursor/focus with real X11 input, other-lane panels, crafting with the new items.
- 2 adversarial verifiers per hunter report, 6 in total.
- 3 fixers.
- 1 new-player UX reviewer, reading screenshots.
- 1 crafting UX builder.
- 1 merge agent.

### Merge
Round 2 was merged into raft-master, which had absorbed a parallel UX round (loop-ux-202611210603).
- Crafting features were kept once, with raft-master's extras folded in: research gating, fittingTimes and source tags.
- raft-master had moved prompts and the throw meter beside the crosshair. Because of the owner's rule, they were docked back in the bottom-left stack.
- 4 more panels now call `exitPointerLock` through `exitLock`.

### Fixed (each confirmed by both verifiers)
- **Cursor (CUR3-1..4).** Tested with real XTest input in headful Chrome.
  - When Chrome eats the Esc, a second Esc no longer closes the pause menu to a free cursor. The menu stays open with Resume focused and "Click Resume or press Enter"; if a relock is refused after closing, the menu reopens. Before → after: 5/8 free → 8/8 ok, and 4/4 free → 8/8 ok.
  - The page-release mark is event-based, and an unlock that arrives while a panel is open never pauses: 7/7 bad → 3/3 ok.
  - Quit needs a second click, and clicks are ignored for 400 ms after the menu opens. Clicking the empty area of the pause screen resumes. The quit button used to sit under the cursor: 5/5 accidental quits → 0/15.
  - The logbook opened from pause returns to pause: 5/5 free → 5/5 ok.
  - Alt-tab was confirmed fine in real Chrome (11/11). The round 2 suspicion was a Playwright artifact.
- **Crafting (CRA3-1..5, plus the builder):**
  - Tinker's Desk locks now reach the bag: badges, opening pick, a disabled Craft button and the tracker.
  - A hold stops when nothing is crafted.
  - The storage-research row CSS conflict is removed, and keyboard order follows the visual order.
  - Station and instrument 3D icons are cached; flat drawings cover the rest, so there are no blank tiles.
  - Framed and rim-lit icons; locked rows show "Unlock: …".
  - A search box, a ready pulse and a "Ready to craft" notice.
  - New Music tab; the Sail sits under Tools.
  - Naming is unified to "plank".
  - The Craft button is simplified, and Tab closes the bag.
- **Panels and tutorial (PAN3-1..6, UX3-1/2/3/4/8):**
  - Feed rows are capped to the stack width, and nothing draws over the hotbar.
  - #lrFeed is removed, and onboarding ticks flash in the checklist row.
  - The binoculars readout is docked in the edge stack.
  - One notice per catch.
  - The build chip is aligned to the measured 10-slot hotbar.
  - The hint chain defers to the onboarding tracker.
  - The feed is hidden over panels and capped at 3 rows.
  - The right column is compact at 900px.
  - The logbook is a left side panel.
  - E and Tab close the station panels, which now use the shared palette.

### Checks
- `npm test`: 720 pass, 0 fail.
- `python tests/e2e/escape_lock.py --trials 2`: inv, locked and pause each 2/2.
- `shoot.py`: no page errors.

### Open for next round
- None of the Electron paths have been run, on any OS.
- The fish journal and the station panels are still centred modals; they pause the game.
- The water item is unobtainable, and both water items are named "Cup of Fresh Water".
- A long "Unlock:" reason is cut off in the recipe list row.
