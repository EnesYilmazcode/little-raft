# Integration status

Updated: 2026-11-21 08:10 UTC, round 3 (integrator B, alongside a parallel integrator on raft-master).
PR #2 merged into main at 1636dfe (merge 3031d67). Gate: 816/816, no page errors, hook-only spawn, Esc OK, perf 229 vs 311 ms and 44 vs 148 draw calls.
Review fixes in the round: inventory fits 900px, recipe tracker moved to the bottom-right (it overlapped the compass/Notes), readable Pin button.

Gate update 2026-11-21 (integrator C): full fleet-gate PASS at c7a8293 — unit, playbot, visual, perf and electron all green
(Tab closes the bag, one WebGL context, no DOM growth, deterministic icons, desktop Esc opens pause). Open PR: #3 (round 4).

| Check | State |
|---|---|
| npm test | 688/688 pass (art atlas build-time test flakes under heavy machine load; passes alone) |
| Page errors (shoot.py) | none |
| Fresh spawn: hook only | yes |
| Esc from inventory: no pause, no cursor | yes |
| Centred text on play screen | none (context prompt sits beside the crosshair) |
| Perf vs main 144c94a (fair probe, median of 3) | 216 vs 322 ms/frame; 96 vs 152 GL draw calls |

Merged this round: raft-tests, raft-tech, loop-features-202611210648, fleet-tech icons/perf/procedural-models/water/audio/foliage,
raft-content (+storage), raft-integration, loop-ux-202611210603 (+0451), loop-features-202611210548. lane-world in progress.

Later merged by the parallel integrator: loop-perf-0548/0540 (its bakeScenery was dropped), loop-features-0534 (kiln, animals).
Still skipped (need a rebase onto raft-master by their workers):
- loop-perf-202611210548: parallel copy of round-1 perf; bakes islands/clouds into fixed meshes (breaks sailing drift, diving).
- loop-perf-202611210540: 20 conflicting files; resolution leaves dead references (daynight SL, diving loadFx, plastic creaseGeo).
- loop-visuals-202611210451: based on pre-integration main; its islands.js/sky.js clash with raft-master's.
- loop-ux-202611210547: redoes crafting UX already in 0603; 50 conflicts in game.js/survival-ui.js.
- loop-features-202611210534: 475 commits behind; Seaside Kiln duplicates the smelter (clashing glass item). Puffhens and decor pack worth rebasing.
- raft-reference: docs only.
