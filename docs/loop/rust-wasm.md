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

## Round 2 (2026-11-21, branch claude/loop-perf-202611210540, base claude/raft-master)

New CPU-side candidates arrived with the diving, sailing and wildlife lanes:

| Hot spot | Measured cost | Verdict |
|---|---|---|
| Seafloor patch rebuild (`seafloor.js`, value-noise over 4,225 verts) | 0.9 ms per rebuild warm (0.66 ms after the JS rewrite); runs once per 16 m of travel (every ~5 s when swimming), so ~0.003 ms/frame on average. The first, cold rebuild cost 20 ms and 5 MB of garbage; it now happens at load. | **No.** Far below the 1 ms/frame bar. The real problem was cold JIT plus boxed doubles, which were fixed in JS (bit-identical output). |
| Gull flight planning (`wildlife.js` gullPlan/rnd) | a few KB/frame of boxed doubles, sub-0.1 ms | **No.** Per-seed constants are now precomputed in a Float64Array. |
| Input polling (`input.js`) | 12.9 KB/frame, 6 µs per call | **No.** Fixed by reusing objects (185 B, 1.4 µs). |

JS self time per function is still under 0.2 ms/frame. Frame time is dominated by draw calls and fill rate,
so there is no WASM again this round. Prototype a WASM port only if a lane adds a per-frame simulation of more than 1 ms
(e.g. many-body buoyancy, boids, runtime mesh generation every frame).

## Round 1 (2026-11-21, branch claude/loop-perf-202611210451, older build)

- Ocean wave sampling was about 0.2 ms per frame. The JS rewrite was about 1.8× faster. Verdict: no WASM.
- Hook physics was an allocation problem, not a compute problem. It was fixed in JS.
- More than 95% of frame time was GPU and raster work. Verdict: no WASM.

## Round 2 (2026-11-21, branch claude/loop-perf-202611210548, on raft-integration)

Profiled on headless Chrome with SwiftShader at 1280x720, using the CDP sampling heap profiler plus a node timing of the wave code.

| Hot spot | Measured cost | Verdict |
|---|---|---|
| Ocean `getSlope`/`getHeight` (31 slope + ~33 height calls per frame) | ~1.9k sin/cos pairs, ~0.30 ms/frame in V8, plus 31 small objects | **No.** Rewritten in JS: flat `Float64Array` params and a `sample(x,z,out)` that does height and slope in one pass with no allocation. Results are bit-identical (tests/ocean.test.mjs). Crossing JS↔WASM 64× a frame would cost about as much as it saves. |
| Hook flight and sweep (`hook-physics.js`) | sub-ms; a small object per substep | **No.** Uses scratch fields now. |
| Garbage from three.js uniform upload (`setValueM4`/`V3f`) | 70–110 KB/frame | **No.** The cause was V8 boxing every uniform cache once a boolean landed in one. Fixed with a one-line int coercion in `setValueV1i`. |
| Per-frame cost overall | Draw calls (~500 → ~150 at spawn) and fill dominate | **No.** The win was in merging meshes, instancing, shadow-frustum fitting and adaptive resolution. |

Conclusion: still no WASM. No CPU simulation costs more than 1 ms a frame after the JS fixes.

Revisit if any of these appear:
- per-vertex CPU water deformation;
- buoyancy for many bodies (more than about 200 floating items);
- boids or fish schools;
- runtime procedural mesh generation that takes more than 5 ms per call (today, merging a deck chunk takes about 18 ms for 49 tiles but happens only when building).
