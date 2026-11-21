# Little Raft improvement loop log

## Perf round 2026-11-21 06:00 UTC (branch `claude/loop-perf-202611210548`, from `origin/claude/raft-integration` 8cff3ec)

The earlier perf rounds (`claude/loop-perf-202611210451`, `-0540`) were never merged into raft-integration and conflict heavily with it, so this round redid the work on the newest build.

### Setup

- Fleet:
  - 7 profilers: deck/building, ocean/sky, viewmodel, debris/farming, JS allocation, HUD/DOM, startup/renderer
  - 9 optimizers: viewmodel bake, per-frame allocation, icons and menus, shadows and adaptive quality, startup, environment, deck chunks, crafts instancing, debris
  - 1 regression checker, which read every before/after screenshot pair
  - 1 measurer
- Probe: `tests/e2e/perf_probe.py`
  - Wraps the GL draw calls and records readiness inside the page.
  - Headless SwiftShader, 1280x720, fresh solo game, median of 3 runs, load average about 2.5.
  - Frame times are relative only.

### Fresh solo game

| Metric | Before | After | Change |
|---|---|---|---|
| Draw calls, idle | 476 | 79 | **−83%** |
| Draw calls, walking | 474 | 80 | **−83%** |
| Triangles, idle | 214k | 107k | **−50%** |
| JS allocation, idle (MB/s) | 3.13 | 0.46 | **−85%** |
| JS allocation, walking (MB/s) | 1.21 | 0.57 | −53% |
| JS allocation per frame, CDP sampling (KB) | 322 | 68 | −79% |
| GCs, 5 s idle | 2 | 1 | −50% |
| Heap, live after forced GC, 60 s idle (MB) | 11.1 | 7.0 | −37% |
| `raftDebug` ready (ms) | 366 | 121 | −67% |
| First two frames (ms) | 1636 | 1408 | −14% |
| New game click to running (ms) | 192 | 33 | −83% |
| Programs linked, fresh game | 33 | 12 | −64% |
| Frame time, idle avg (ms, noisy, adaptive on) | 288 | 199 | −31% |

### Built raft (49 tiles, 24 decor)

From the measurer, 3 interleaved runs.

| Metric | Before | After | Change |
|---|---|---|---|
| Draw calls | 1086 | 149 | **−86%** |
| Triangles | 891k | 602k | −32% |
| Allocation per frame (KB) | 2922 | 126 | −96% |
| Heap after GC (MB) | 15.5 | 8.5 | −45% |
| Continue click to running (ms) | 2047 | 1545 | −25% |

### What changed

- **Viewmodel.** Hands, arms, hook, hammer, rod and avatar are baked into a few meshes (`dist/bake.js`); a palette texture keeps each part's roughness and metalness. Holding the hook went from 59 calls to 7.
- **Debris.** Each item is 1–2 vertex-coloured meshes with shared materials, cached per type and variant. Tessellation is lower and only the main mesh casts a shadow. Debris was 65% of the frame.
- **Deck.** Tiles are merged into 8x8-tile chunk meshes with per-tile part caching. Lashings no longer cast shadows. One grain texture is shared and tinted per wood colour.
- **Crafts.** Placed decor is drawn as one InstancedMesh per type and part from cached templates (119 → 35 materials). Thin parts no longer cast shadows and tessellation is trimmed.
- **Environment.**
  - Islands and clouds went from 192 meshes to 3.
  - The ocean draws after the opaque objects, and its shader skips work past the fade distance and the ripple and foam ranges.
  - Wave sampling has no allocations: `Float64Array` params and `ocean.sample()`, bit-identical to before.
- **Shadows and quality.**
  - The shadow camera is fitted to the raft.
  - Presets now set the shadow map: low has none, medium is 1024 PCF, high is 2048 PCFSoft. Medium's default render scale is consistent with the other presets.
  - New `dist/quality.js` adaptive resolution (render scale 1 → 0.6 with hysteresis, shadows at half rate at the bottom step), with a settings toggle and `raftDebug.quality`.
- **Allocations.**
  - three.js `setValueV1i` stores booleans as ints, which stopped V8 boxing every uniform cache.
  - `forceSinglePass` on transparent DoubleSide materials (plastic creases, lantern glass, splash rings).
  - Survival UI and game-loop scratch reuse, no-alloc hook physics, a reflow-free pickup feed.
- **Startup.**
  - Fonts load without blocking.
  - 28 modulepreloads.
  - PeerJS loads on demand.
  - Shaders are warmed with `compileAsync` after the first frame.
- **Icons.** Item icons render lazily in one atlas pass with `toBlob`, starting 2 s into play or when the inventory opens. Before, about 15 synchronous `toDataURL` long tasks ran during startup.
- **Menus.** The world redraws at 10 fps behind pause, settings and help menus.

### Regression check

Every before/after pair was read: title, spawn, hook, inventory icons, pause and settings, horizon, built raft decor, hammer, rod cast, low and high presets, debris close-ups and co-op loading. No regressions were found. Expected differences:

- Shadows are crisper.
- Debris far from the raft no longer self-shadows, because it is outside the fitted shadow box.
- Leaf bundles use 4 cached shapes.

### Rust/WASM

Not worth it again this round; see `docs/loop/rust-wasm.md`.

### Next ideas

- Per-chunk frustum culling is coarser than per tile; consider 4x4 chunks for very large rafts.
- InstancedMesh for floating debris (about 45 → about 10 calls).
- Lazy-build the rod and hammer viewmodels and warm their shaders while idle.
- Revoke the icon blob URLs on re-render.
- The pause-menu "Play together" button could prefetch PeerJS.
- `dist/sky.js` and `dist/waterfx.js` are dead code.
