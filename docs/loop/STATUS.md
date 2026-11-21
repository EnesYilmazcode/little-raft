# Integration status

Updated: 2026-11-21 09:25 UTC, integrator B round 4. PR #5 (round 6) open at 9b3ba49, under review.
Gate at 9b3ba49: 1023/1023 tests, no page errors, hook-only spawn, Esc from inventory stays in play, prompts beside the crosshair,
perf 133 ms / 43 draw calls vs main 912d941 229 ms / 49 (fair probe, median of 3).

Skipped this round (need a rebase by their workers): loop-fidelity-202611210747, loop-perf-202611210720, loop-ux-202611210742, loop-ux-202611210547.
Known flake: art atlas build-time test under heavy machine load.


## Claims (to avoid double merges between integrators)
Integrator B, round 6 (from 09:30 UTC), in worktrees: loop-fidelity-202611210804, -0821; loop-features-202611210814; loop-perf-202611210708;
loop-ux-202611210648, -0742, -0743, -0833; loop-visuals-202611210805. Also gating and merging PR #5.
Integrator B, round 5 (from 09:10 UTC), merging in worktrees; please skip these or coordinate here:
loop-fidelity-202611210804, -0821 (0747 skipped: duplicate shark/needs systems); loop-features-202611210735, -0749, -0753-zfs, -0814;
loop-perf-202611210708; loop-ux-202611210648 (new commits), -0742, -0748, -0833; loop-visuals-202611210748, -0558.
Features-lane integrator (09:30-10:10 UTC) ALREADY MERGED AND PUSHED to raft-master: loop-features-202611210648 (2b73d39b), -0735 (b44f40f2),
-0749 (ffbbe117), -0753-zfs (1ba50d82); integrator B can drop those from its list. It left -0814 (B), -0849/-0847-r2 (C), -0855 (D) to their claimants.
Integrator C, round 5 (from 09:40 UTC), in a worktree: loop-features-202611210831 (new commits), -0847-r2, -0849; loop-perf-202611210847.
Integrator E (formerly logged as C before the name clash; from 09:25 UTC), in a worktree: loop-features-202611210911; loop-perf-202611210823.
Integrator D (from 09:20 UTC), in worktrees: loop-features-202611210855; loop-fidelity-202611210900, -0910, -0914; loop-ux-202611210848, -0852; loop-visuals-202611210843; loop-perf-202611210748, -0859.
Integrator ux-lane (from 09:29 UTC), in a worktree: loop-ux-202611210743 (new round-3 commits). loop-ux-0547 already merged (ead02a0); 0648/0742/0748/0833 left to B, 0848 to D.

Updated: 2026-11-21 09:10 UTC, round 5 (integrator A, alongside integrator B). PR #4 merged into main at 912d941 (raft-master dbf2ca9).
Gate: 983/983 tests, no page errors, hook-only spawn, Esc from inventory keeps the lock with no pause, no centred text.
Perf vs main (pinned quality, median of 3, two interleaved runs): 185/191 vs 195/192 ms, 49-52 vs 51-55 draw calls.
Open PR: next round (raft-master -> main).

Skipped (superseded or not game code): lane-placement, raft-reference. Juicer/gull (loop-features-0831) is back in after its worker finished it.
Known flake: the art atlas "build stays fast" test fails only under heavy machine load; it passes alone.

Previous round:
Updated: 2026-11-21 08:55 UTC, round 4 (integrator B). PR #3 merged into main at 8d21618 (raft-master 29a11fd).
Gate: 910/910 tests, no page errors, hook-only spawn, Esc from inventory keeps the lock with no pause, Esc ending lock with the
build wheel open never pauses, no centred text. Perf vs main 3031d67 with ?pinQuality (median of 3, two interleaved runs):
242 vs 226 ms idle (+7%), 183 vs 180 ms walking (+2%), ~52 draw calls both.
No open PR: raft-master == main; the next one opens when new worker merges land.

Skipped this round (need a rebase by their workers): loop-perf-0720, loop-ux-0547, loop-ux-0743, lane-models (older copy), raft-reference (docs).

Previous round:
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
