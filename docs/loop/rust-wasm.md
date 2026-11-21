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

## Round 3 (2026-11-21, branch claude/loop-perf-202611210708, on raft-master)

**Profile.** JS time is about 3.0–3.6 ms per frame under SwiftShader. Almost all of it is GL calls and `updateMatrixWorld`; game logic takes under 0.3 ms.
- Wave sampling is about 31 `ocean.sample` calls per frame (about 2k trig ops) and is allocation-free.
- Wildlife allocated 3–6 KB per frame, from constants it recomputed every frame; fixed in JS.
- Seafloor rebuilds take about 1 ms every 16 m.

| Hot spot | Measured cost | Verdict |
|---|---|---|
| Render-list sort (`Array.prototype.sort`, about 4.5 KB per frame of temp arrays) | 3.5 µs per sort | **No.** An in-place insertion sort was 2x slower because the lists are rebuilt in traversal order (46% inversions). WASM can't sort JS objects without marshalling them. |
| Deck merge (`createRaftMesh`) | 0.6–1.9 s on a 49-tile raft | **No.** Fixed in JS: tile parts are cached and the merge is a typed-array `set`. It now takes 25–35 ms, and only on build. |
| Input and wildlife per-frame work | 10–18 KB/frame of allocation, under 0.1 ms CPU | **No.** This was an allocation problem, fixed in JS. |

**Conclusion:** still no WASM. Nothing on the CPU costs more than 1 ms per frame.
