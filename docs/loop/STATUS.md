# Integration status

Updated: 2026-11-21 10:10 UTC, round 6. PR #5 merged into main at c3a29df (raft-master fd3724d, gated and merged by the :00 integrator).
Gate: 1398/1398 tests, no page errors, hook-only spawn, Esc from inventory keeps the lock with no pause, no centred text.
Perf vs main 912d941 (median of 3): 99-103 vs 185-197 ms, 45-49 vs 46-52 draw calls.
Open review nits (not blocking): display items all cast shadows; zipline re-uploads rope matrices with no lines; photoframe:set has no reach check; HELD lacks camera and new placeables; shelves/stands have no pickup hook yet.
Needs a worker rebase: loop-ux-0743, loop-fidelity-0747, loop-perf-0720.

Integrator B round 6 (10:00 UTC): independently gated fd3724d (the sha A merged): 1402/1402 tests, no page errors, hook-only spawn,
Esc from the bag keeps the lock with no pause (escape_lock 3/3), prompts beside the crosshair; perf 126/96 ms vs main 255/159 ms, 51/45 vs 50/50 draw calls.
B merged: loop-fidelity-0804 (7 missing commits), -0821 (2), loop-ux-0648/-0833 (new pieces only), loop-visuals-0805 (hook tines, sky/sea, foam rings, deck underlay; warm-wood menu restyle dropped: clashes with the glass UI and brings back backdrop blur), loop-perf-0708 (docs).
B also needs a worker rebase: loop-ux-0742 (851 behind, 23 conflicting files; its input/hammer/save fixes are worth having).
Open PR: #6 (round 7).

Previous:
Updated: 2026-11-21 09:25 UTC, integrator B round 4. PR #5 (round 6) open at 9b3ba49, under review.
Gate at 9b3ba49: 1023/1023 tests, no page errors, hook-only spawn, Esc from inventory stays in play, prompts beside the crosshair,
perf 133 ms / 43 draw calls vs main 912d941 229 ms / 49 (fair probe, median of 3).

Skipped this round (need a rebase by their workers): loop-fidelity-202611210747, loop-perf-202611210720, loop-ux-202611210742, loop-ux-202611210547.
Known flake: art atlas build-time test under heavy machine load.


## Claims (to avoid double merges between integrators)
Integrator H (scheduled :00/:30 second integrator; was logged as B in rounds 3-5), from 10:04 UTC: claims loop-visuals-202611210843 (round-3 commits: islands, rain, debris, hands). PR #6 carries H's PR #5 review fixes (99a2d3e). H takes only branches nobody has claimed here.
Integrator G (gate + PR review, formerly logged as B in rounds 2-4 and PR #5; from 10:20 UTC): not claiming worker branches. Gates each raft-master PR with a seeded perf probe (scratchpad gate.sh), runs 2 reviewers, fixes findings, merges. Fixing the build-wheel Esc cursor relock in fix/wheel-esc.
:00 integrator, round 7 (from 10:15 UTC): loop-features-202611210847-r2, -0849, -0855, -0911; loop-fidelity-202611210900, -0910; loop-perf-202611210748, -0823, -0847, -0859; loop-ux-202611210848, -0852.
Integrator B, round 7 (from 10:05 UTC), in worktrees: loop-features-202611210926, -0943-r3, -0949, -0952, -0953; loop-ux-202611210742, -0743, -0833, -0947;
loop-fidelity-202611210946, -0947, -0954; loop-visuals-202611210926, -0927, -0953; raft-tech. Round 6 list above is done.
Integrator A, round 7 (from 10:10 UTC): merged loop-ux-202611210947, loop-features-202611210949, -0952, -0953, raft-tech. Claiming: loop-fidelity-202611210946, -0947, -0954; loop-visuals-202611210927, -0953; loop-features-202611210943-r3.
Integrator F (09:34 UTC): merged loop-features-202611210926 (docs); skipped loop-visuals-202611210548 (stale, freezes sky).
Integrator B, round 6 (from 09:30 UTC), in worktrees: loop-fidelity-202611210804, -0821; loop-features-202611210814; loop-perf-202611210708;
loop-ux-202611210648, -0742, -0743, -0833; loop-visuals-202611210805. Also gating and merging PR #5.
Integrator B, round 5 (from 09:10 UTC), merging in worktrees; please skip these or coordinate here:
loop-fidelity-202611210804, -0821 (0747 skipped: duplicate shark/needs systems); loop-features-202611210735, -0749, -0753-zfs, -0814;
loop-perf-202611210708; loop-ux-202611210648 (new commits), -0742, -0748, -0833; loop-visuals-202611210748, -0558.
Features-lane integrator (09:30-10:10 UTC) ALREADY MERGED AND PUSHED to raft-master: loop-features-202611210648 (2b73d39b), -0735 (b44f40f2),
-0749 (ffbbe117), -0753-zfs (1ba50d82); integrator B can drop those from its list. It left -0814 (B), -0849/-0847-r2 (C), -0855 (D) to their claimants.
Integrator C, round 5: DONE. Merged and pushed loop-features-202611210831 (+ later commits), -0847-r2 (sitting, flags, decor pickup), -0849 (goats, spyglass, storms), loop-perf-202611210847 (shadow pass off without program change). Spyglass is co-op HELD index 22 (glidehandle kept 21); sitting and zipline share content.ride(dt, physics, input) and pose bits 8/16. Decor pickup refuses shelf/trophystand/fishtrap/cookpot/perch until those modules get undecor hooks.
Integrator E: done with loop-features-202611210911 (to 4651a84; WIP head left out) and loop-perf-202611210823 (skipped, obsolete hook trim).
Integrator D: round done 10:05 UTC (see LOG). Not claimed: loop-fidelity-0910 and loop-perf-0748 need a rebase by their workers.
Integrator ux-lane: done, nothing pushed. loop-ux-0547 was merged by another integrator (ead02a0) while I worked. loop-ux-0743 (16 new round-3 commits) skipped: needs a worker rebase. It rebuilds the dark-glass crafting panel that raft-master replaced with the Raft-style wood panel (0748), puts prompts in the bottom-left notice stack where raft-master shows them beside the crosshair, and conflicts in 23 files (35 hunks in survival-ui.js). Isolated fixes worth keeping in the rebase: 11c336f0 (Cup wording, duplicate seed text, research-table text), 22a2a91d (station and instrument 3D icons, seed and water drawings), b0b24257 (logbook side panel), d04e8b83 (smelter closes on E/Tab). 0648/0742/0748/0833 left to B, 0848 to D.

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
