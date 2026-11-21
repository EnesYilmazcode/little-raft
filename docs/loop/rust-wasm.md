# Rust → WASM: candidates and decisions

Rule: port a hot spot only when a profile shows it costs real frame time **and** a
prototype beats the optimized JS. No new npm deps; a WASM build would ship as a
prebuilt `.wasm` in dist/.

## Round 1 (2026-11-21, branch claude/loop-perf-202611210451)

Profile (headless Chrome, SwiftShader, 1280x720, solo spawn):

| Hot spot | Measured cost | Verdict |
|---|---|---|
| Ocean wave sampling (`ocean.js` getHeight/getSlope) | ~156 calls/frame × ~1.4 µs ≈ 0.2 ms/frame | **No.** Below the 0.5 ms bar; JS rewrite (flat Float64Array, inlined Gerstner) made it ~1.8× faster and bit-identical. JS↔WASM call overhead per sample would eat most of any gain. |
| Hook physics (`hook-physics.js` _sweep/_isCaught) | a few KB/frame of allocation, sub-ms CPU | **No.** Allocation problem, fixed in JS. |
| All game JS per frame | ~5 ms/frame total script under SwiftShader; >95% of frame time is GPU/raster ("(program)") | **No.** The bottleneck is draw calls, triangles and fill rate, not JS compute. |

Conclusion: no WASM this round. The wins are in fewer draw calls (geometry merging,
shared materials), fewer shadow casters, cheaper fragments and adaptive resolution.

Revisit if: a CPU-side simulation appears (e.g. many-body water/buoyancy, crowd of
fish, pathfinding, procedural mesh generation at runtime) that costs >1 ms/frame
after JS optimization.

## Round 202611210748 (branch claude/loop-perf-202611210748, base raft-master 7294e26)

CPU profile (CDP Profiler 200 µs, 320x180 and 640x360, idle + perf_gate play cycle):

| Hot spot | Measured cost | Verdict |
|---|---|---|
| Gulls (`wildlife.js` updateGulls/gullPlan) | ~0.2 ms/frame | **No.** Wing-matrix cache in JS cut it to ~0.02 ms. |
| Fish schools | ~0.015 ms/frame | **No.** Fixed layout now precomputed once. |
| Ocean getHeight/sample | 0.03-0.04 ms/frame | **No.** Already allocation-free. |
| three.js updateMatrix/updateMatrixWorld | ~0.2 ms/frame | **No.** Engine code; cut ~30% of calls by freezing static parts. |
| All game logic in frame() | ~1 ms of a 150-560 ms SwiftShader frame (95-97% GPU) | **No.** |

The largest JS costs were DOM/layout (tooltip forced layout, onboarding/prompts deep state copies),
fixed in JS. Startup's longest task is synchronous world build in `mount()` (~1.3 s: debris variants,
raft floor, islands, viewmodels); that is geometry construction, which a WASM port would not help
much (it ends in three.js BufferGeometry objects either way). Deferring/caching it is the better path.

Conclusion: still no WASM. Revisit with the same >1 ms/frame bar.
