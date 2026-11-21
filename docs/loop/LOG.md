# Little Raft improvement loop log

Rounds 1-2 of the perf loop ran on the raft-master line (branches `claude/loop-perf-202611210451` and
`claude/loop-perf-202611210540`); their logs are in `docs/loop/LOG.md` on that line. This file covers rounds on the
`claude/raft-integration` line.

## Perf round 3, 2026-11-21 (branch `claude/loop-perf-202611210720`, base `origin/claude/raft-integration` e8b732c)

`raft-integration` (07:18) was the newest of master, integration and main. It has diverged from `raft-master`, so
this round profiled it fresh and ported the round-1/2 fixes that apply here.

BEFORE = 326457a: integration plus the perf probe and a renderInfo that counts both passes. AFTER = 5eb1fb8, plus
the sleeve revert noted below. The probe is `tests/e2e/perf_gate.py` from 5eb1fb8: `?pinQuality` (pins this line's
adaptive resolution), a JIT warm-up that runs until one item respawn, a deck walk, and `--swim`. Values are medians
of 2 alternating runs; the startup rows are medians of 3 in-page runs.

| phase | metric | before | after | Δ |
|---|---|---|---|---|
| idle | draw calls | 83 | 22.5 | -72.9% |
| idle | triangles | 105,693 | 75,065 | -29.0% |
| idle | shadow casters | 96 | 73 | -24.0% |
| idle | geometries | 121 | 51.5 | -57.4% |
| idle | JS alloc KB/frame | 70.6 | 12.8 | -81.8% |
| idle | avg / p95 frame ms* | 425 / 592 | 287 / 350 | -32.5% / -40.8% |
| walk | draw calls | 76.5 | 21.5 | -71.9% |
| walk | JS alloc KB/frame | 62.4 | 14.0 | -77.6% |
| walk | avg / p95 frame ms* | 432 / 600 | 272 / 342 | -37.1% / -43.1% |
| hook | draw calls | 107 | 22 | -79.4% |
| hook | triangles | 110,360 | 73,175 | -33.7% |
| hook | JS alloc KB/frame | 102.8 | 37.2 | -63.8% |
| swim | draw calls | 37 | 12.5 | -66.2% |
| swim | JS alloc KB/frame | 54.8 | 25.2 | -54.0% |
| startup | raftDebug ready ms (in-page) | 2538 | 2229 | -12.2% |
| startup | new game → 2nd frame ms | 757 | 496 | -34.5% |
| startup | transfer KB / requests (solo) | 1997 / 37 | 1902 / 34 | -4.8% / -8.1% |

\*Software GL with a load average of 3-13 on 4 cores; swim frame time and DCL/FCP changed within noise. Shader
programs (15) and lights (2) are unchanged. Retained heap growth stays near 0. The perf gate on AFTER against
BEFORE gives **PASS**. AFTER has no page errors; BEFORE threw `reading 'isReady'` in 2 runs.

What landed:
- **Floating items:**
  - plastic jugs are one shared vertex-coloured mesh with the creases baked in (6 → 1 draws per jug)
  - leaf and barrel triangles are halved
  - items are drawn as one InstancedMesh per variant, with per-instance view culling and hidden proxies for picking
- **Merged meshes:**
  - deck: timber plus fittings (13 → 3 draws in both passes)
  - hook (world, held and icon): 18 → 2 vertex-coloured meshes, fewer segments, no shadow
- **Ported allocation fixes:**
  - ocean sampling, `sample()`, and shader early-outs
  - allocation-free HookCast and PlayerPhysics (bit-identical, including a V8-exact hypot)
  - hook params and rope points reused
  - item respawn done in place (`respawnItem`), which keeps `updateItems` optimized
  - pointer UI compares a bit signature; the hands update args are reused
  - the three.js boolean-uniform patch
- **Startup:**
  - `farming.js` was loading twice; a lint now blocks bare relative imports
  - `icons.svg` is fetched once
  - PeerJS loads lazily
  - live.js imports game.js in parallel with version.json and preloads the module graph
  - shaders compile before the loop starts; the icon pump is held for 1 s after a new game
- **Perf gate:** warms up until an item respawns, and starts with `#newGame`. Lint tests cover transparent
  DoubleSide materials and bare imports.

Rejected after measuring:
- A three.js `for…in` → cached-keys patch for WebGLBindingStates. The reported deopt loop could not be
  reproduced, with 0 bailouts and no time change, so the vendor stays as is.
- An opaque material sort. It saved no `diffuse` re-uploads, because light directions dominate `uniform3f`.
- Merging the sleeve into the forearm (reverted). It moved the sleeve onto the skin material, changing its
  roughness and tint for 2 draws.

Regression check (every pair read: shoot.py views, item and deck close-ups, hook, icons, farming, Play together,
hooking): no blocking regressions. One known transient: a new item's hotbar icon can appear up to about 1 s later
right after starting a game.

Rust/WASM: no candidate. The JS self time is about 0.6-0.7 ms/frame in total; see `docs/loop/rust-wasm.md`.
