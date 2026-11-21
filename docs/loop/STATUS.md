# Integration status

Updated: 2026-11-21, round 2 (integrator B, working alongside a parallel integrator on raft-master).
PR #1 (claude/raft-master -> main): gate passed, merged with a merge commit. A fresh PR is open for the next round.

| Check | State |
|---|---|
| npm test | 533/533 pass |
| Page errors (shoot.py) | none |
| Fresh spawn: hook only | yes |
| Esc from inventory: no pause, no cursor | yes |
| Esc from the hammer build wheel | closes the wheel only (fixed this round) |
| Centred text on play screen | none |
| Perf vs main (fair probe, same pose, median of 3) | 372 vs 369 ms/frame (+0.8%); 148 vs 539 GL draw calls |

Perf method: the shoot.py camera pose differs per branch, so the gate now uses a probe that starts a fresh solo game,
touches no input, waits 3 s, and counts WebGL draw calls per frame with an init-script hook (works on main, which has no renderInfo).

Still unmerged (conflicts with raft-master; for the next round): loop-ux-*, loop-features-*, loop-perf-*, loop-visuals-202611210451,
raft-integration (37 newer commits), lane-models, lane-placement, lane-world, raft-reference (docs only).

Open nits from review: Notes panel sits 5px from the bag edge; islands cast shadows (consider off at low/medium);
"Stretch your legs" hint wraps one word; host allocates a Set per frame at game.js heldTokens path.
