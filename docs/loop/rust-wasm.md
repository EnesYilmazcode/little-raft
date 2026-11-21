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

## Round 3 (2026-11-21, branch claude/loop-perf-202611210648)

Profile (headless Chrome, SwiftShader, CDP CPU profile of 10 s steady solo play, box under 5x contention):

| Hot spot | Measured cost | Verdict |
|---|---|---|
| All per-frame JS (game + three.js + GL calls) | 3.8 ms/frame mean (p50 3.4) under ~5x contention, roughly 1 ms on an idle laptop | **No.** The rest of each frame is GPU time. |
| three.js `setValue` (uniform upload) | 0.26 ms/frame | **No.** Vendor code; only fewer materials or objects reduce it. |
| `uniformMatrix4fv` (native GL) | 0.19 ms/frame | **No.** Native. |
| daynight `segmentStart`, game `updateItems` | 0.06-0.07 ms/frame each | **No.** Far under the 1 ms bar. daynight now refreshes at 10 Hz. |
| wildlife gull/fish sim | KB-level allocation, sub-0.1 ms | **No.** Allocation problem, fixed in JS: cached constants in typed arrays, bit-identical output. |
| audio brown-noise generation (one-time, first key press) | 125 ms, 4.6 MB garbage | **No.** One-shot, fixed in JS: 2 s single-pass loop (34 ms, 2.3 MB). An AudioWorklet would remove it entirely; WASM isn't needed. |

Conclusion: still no WASM. No JS function exceeds 1 ms/frame. The remaining costs are draw calls, shader programs and the GPU,
plus one-time startup work (icons, co-op avatar, shader warm-up), and those were moved off the critical path in JS.
