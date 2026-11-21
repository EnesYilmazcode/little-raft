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

## 2026-11-21 · loop-features-202611210548 (features)
Base: origin/claude/raft-master (5cbc67b; raft-integration lacked the round-1 features). Branch: claude/loop-features-202611210548.
Skipped as covered elsewhere: raft animals, kiln/smelter, decor signs (concurrent loop-features-202611210534).

Features (research in docs/features, specs in docs/specs):
- **Bed + sleep through the night**: Bed decor (6 wood + 4 leaf, research). E at dusk/night to lie down; when everyone is in bed (host, plus guest if connected) the screen fades and the host skips the clock to morning (new host-only `daynight.skipTo` action). In-bed state is never saved. The guest's fade follows synced `ext.sleep`. Files: dist/sleep.js, dist/sleep-model.js.
- **Little Motor + Steering Wheel**: the motor (wood/scrap/rope) is toggled with E and fuelled with leaf/wood/plastic (20/45/60 s, 300 s cap). It pushes 0.7 m/s along the heading with diminishing returns up to 4 motors, sail + motor capped at 2 m/s, and stops when anchored. The wheel is a new hold-R steering point that works without a sail, and E on it toggles all motors. State in `world.ext.engine`; guests compute the same push from synced data. Files: dist/engine.js, dist/engine-models.js; small hook in sailing-core `stepSailing(opts.push)`.
- **Paint + brush**: Paint Brush (stack 1, not a tool) and 5 pot colours (4 pots per craft, 1 pot per piece). Driftwood scrapes a piece back for free. Left click paints a building piece or deck tile, right click changes colour. State in `world.ext.paint` with a rev counter; stale keys are pruned when pieces or tiles change. Pieces are tinted through instance colours and deck planks through cached materials, so painting adds no draw calls. Files: dist/paint.js, dist/brush-model.js.

Fleet: 3 researchers, 3 designers, 3 builders, 3 reviewers, 1 visual QA (13 agents).
Review/QA fixes: content `prompt()` text was hidden by prompts.css, so all three modules now also feed raftPrompts; those providers step aside for pickup/connecting prompts. Also fixed: sleep teleport after a world swap, dawn-edge "Good morning" without a skip, the fade not covering the compass, wheel/sail grab release rules, motor models lost after a same-count rebuild, the "Anchored" HUD without a sail, per-frame allocations, letter-box icons for bed/motor/wheel (new SVG icons + test), the onboarding panel covering the compass label, and the journal chip over the phone hotbar.
Checks: `npm test` 397/397 (was 342); shoot.py `errors: []`. Solo and loopback two-page co-op sleep probes ran clean.
Known limits: no lying pose on the partner's avatar; E while lying and aiming at a sail toggles the sail; motor prompt ignores walls in between; other content modules' `prompt()` text (chests, research table) is still hidden. A general game.js bridge to raftPrompts is the follow-up. No gamepad colour cycling.
Next ideas: general content-prompt bridge, a lying pose over the network, a "well rested" speed perk (needs a speedMul in PlayerPhysics), decor removal so motors and beds can be moved.
