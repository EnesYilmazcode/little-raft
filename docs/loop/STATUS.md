# Integration status

Updated: 2026-11-21, round 1.
PR: #1 (claude/raft-master -> main), open, not auto-merged.

| Check | State |
|---|---|
| npm test | 263/263 pass |
| Page errors (shoot.py) | none |
| Fresh spawn: hook only | yes |
| Esc from inventory: no pause, no cursor | yes |
| Centred text on play screen | none (the prompt sits 22px right of the crosshair) |
| fleet-gate | unit passes; playbot/visual/electron tools missing (infra) |
| Perf vs main | FAIL: ~444 ms/frame vs 243 ms (swiftshader), 555 draw calls |

Skipped branches: raft-art (own test fails), raft-progression (syntax error), raft-reference (not game code).

Next: land perf fixes (shadow casters, seafloor and lane geometry), rerun the gate, retry art/progression.
