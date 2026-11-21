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
