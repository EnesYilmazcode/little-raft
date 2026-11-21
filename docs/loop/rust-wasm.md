# Rust → WASM: candidates and decisions

Rule: port a hot spot only when a profile shows it costs real frame time **and** a
prototype beats the optimized JS. No new npm deps; a WASM build would ship as a
prebuilt `.wasm` in dist/.

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
