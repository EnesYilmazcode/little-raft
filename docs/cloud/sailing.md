# Sailing lane: raft movement, sail, anchor, wind

Branch: `claude/raft-sailing`. A lean, Raft-like sailing system. Almost all of it lives in new files. The existing
files get small hooks, each marked `// [sailing]`. The design contract is in [sailing-spec.md](sailing-spec.md).

## What it does

- **The world moves, the raft stays put.** The raft group never moves in x/z, because tiles, player physics and
  placement all assume tile (x, z) sits at (2x, 2z). Instead the raft has a virtual velocity, and the ocean waves,
  debris, islands and clouds move relative to it. Players and placed items therefore stay on the raft by construction.
- **Current.** A constant 0.30 m/s current points toward +z, the same way as the existing debris drift.
  - An unanchored raft without a sail drifts with the current. Islands slide past slowly.
  - Waves and debris are carried by the water, so they keep their old relative motion.
- **Wind.** The wind has a direction and a strength between 0.55 and 1. The host wanders it slowly:
  - Every 70–140 s it picks a new target within ±60° of the current wind, kept within ±100° of the current so the two roughly agree.
  - The direction turns at no more than 0.05 rad/s.
  - The wind is shown in-world by the sail's own red pennant, which now points downwind. A small compass badge
    (top right) shows the wind arrow, the sail heading, speed, and a state label ("Sail up · 1.4 m/s", "Drifting",
    "Anchored", "No sail — craft one").
- **Sail.** This uses the existing craftable `sail` decor.
  - **E** on a sail raises or lowers it. Lowered, it furls into a canvas roll under the yard.
  - **Hold R** at a sail to steer it: the sail turns with your look, starting from where it was (no snap), rate-limited.
  - Push = 1.3 m/s × wind strength × max(0, cos(sail heading − wind)) × (1 + 0.1 per extra sail, up to 3).
    You can sail up to 90° off the wind. You cannot sail into it. As in Raft, extra sails barely help.
  - The velocity eases in with a 4 s time constant and out with 3 s, so the raft feels heavy.
  - The cloth billows with how well the sail is trimmed.
  - Top speed is about 1.56 m/s. Swimming is 2.1 m/s, so a swimmer can always catch up.
- **Anchor.** There is a stationary anchor fixture at the raft's rear-left corner: a post, an arm with a crank drum,
  and a rope with an iron anchor. **E** drops or raises it.
  - Anchored, the raft holds still and debris and waves stream past at the current speed.
  - The anchor is a built-in fixture, not a craftable item. That avoids touching the recipe and inventory files other lanes own.
- **Islands** have a radius. The raft runs aground instead of sailing through them, and the stop distance grows with the raft's size.
  - Islands and clouds wrap at ±150 m, which is past the fog.
  - Island positions depend only on the shared seabed offset, so host and guest see the same islands.
- **Debris** gets the sail-relative flow added to its baseline drift.
  - When sailing exists, the old +z despawn box is replaced by a flow-aware test measured from the raft centre.
  - Respawns are rotated upstream around the raft centre. A unit test covers several raft shapes and 24 flow directions.
  - The floating hook drifts with the water. A swimmer more than 10 m from the raft is carried by the water.
- **Paddle:** the core model supports a `paddle` op (0.25 m/s nudge, 0.8 s cooldown, capped at 0.9 m/s), but nothing
  in the UI triggers it yet.

## Files

| File | Role |
|---|---|
| `dist/sailing-core.js` | Pure model with no THREE or DOM: constants, `cleanSailing` (validator and migrator), `stepSailing` (no allocations), `applySailAction`, wrap and upstream helpers |
| `dist/sailing-world.js` | THREE side: steps the state, writes the ocean `uFlow`, moves drifters, animates the sails (furl, billow, steer, pennant), anchor fixture, aiming, prompts, co-op prediction and smoothing |
| `dist/sailing-ui.js` | Compass badge and `#sailPrompt`. Writes to the DOM only when a value changes. Each instance owns its own style element, so hot reload is safe |
| `tests/sailing.test.mjs` | 15 unit tests |
| `docs/cloud/shoot_sailing.py`, `docs/cloud/shoot_sailing_more.py` | Headless screenshot and state probes |

## State, saves and co-op

- **State.** It lives in `world.sailing`: `{v, windDir, windStr, windTarget, windStrTarget, windClock, heading, raised,
  anchored, vx, vz, wx, wz, gx, gz}`. `wx/wz` is raft travel relative to the water (feeds the waves) and `gx/gz` is
  travel relative to the seabed (feeds the islands).
- **Wrapping.** `wx/wz` wrap at 65536 and `gx/gz` at 105000, a multiple of the island wrap.
- **Saves.** The state is saved with the world.
  - `cleanWorld` validates it on load, on guest snapshots and on hot-reload transfer.
  - Old saves get defaults: sail lowered, not anchored.
  - The old build simply drops the key.
- **Co-op.**
  - The host is authoritative and sends `world.sailing` inside `hostState()` about 8 times a second.
  - Guests send `{kind:'sail', op}` actions:
    - Explicit ops: raise, lower, anchor, unanchor.
    - A throttled heading while steering.
    - Toggle ops are limited to one per actor per 250 ms. Notices go back to the acting player through `emit`.
  - The guest dead-reckons both the sailing state and debris between snapshots, and blends its displayed offsets
    toward the host's (snapping only if more than 6 m off).
  - A guest heading that arrives while the host is steering takes over the host's grab point.
- **Mixed versions** don't throw. An old host ignores `sail` actions.

## Hooks into existing files

All are marked `// [sailing]`.

**`dist/game.js`**
1. Imports `createSailing` and `cleanSailing`.
2. `cleanWorld` and `copyWorld` keep `sailing: cleanSailing(...)`.
3. State: `let sailing`, `scenery[]`, `sailFlow`, `aimNdc`, plus `getAimNdc()`, which gives the same aim point as `currentAim`.
4. `init()`:
   - islands are pushed to `scenery` with radius 6, clouds with radius 0
   - `createSailing(T, ctx)` is created inside try/catch, then `addDrifter` runs for each scenery entry
5. `rebuildRaft()` ends with `sailing?.onRaftBuilt()`.
6. `updateItems()`:
   - calls `sailing.itemFlow(sailFlow)` and adds the flow to debris
   - when sailing exists, `outOfRange` replaces the +z despawn box, and `respawned(it)` runs after `makeItem`
   - the guest dead-reckons debris
7. `updateHook()`: a floating hook drifts with `sailFlow`.
8. `frame()`: `sailing.update(dt, elapsed)` runs right after `updateRaft`.
9. `interact()`: if no pick-up target is aimed at, `sailing.interact()` handles E.
10. Keys:
    - R keydown: `!sailing?.grab()` gates `repair()`
    - R keyup and window blur call `sailing.release()`
11. `applyAction`: `{kind:'sail'}` goes to `sailing.apply`, and the returned notice is sent with `emit(..., actor)`.
12. `hostState().world.sailing`.
13. `raftDebug.state.sailing`.
14. `dispose()` calls `sailing.dispose()`.
15. One help-guide line about sailing.

**`dist/ocean.js`**
- A `uniform vec2 uFlow` is added to the wave phase in the vertex shader and to the CPU `getHeight`.
- The fragment shader uses `mod(uFlow, 512.)` for ripple and foam detail, which keeps the hash noise precise.

**`package.json`**
- The test script also runs `tests/sailing.test.mjs`.

## Test results

- `npm test`: **37 pass, 0 fail** (22 existing and 15 sailing).
- Headless runs with `CHROME_PATH=/opt/pw-browsers/chromium python3.13 docs/cloud/shoot_sailing_more.py dist <out>`
  had no page errors. The only console messages are SwiftShader "GPU stall due to ReadPixels" warnings.
- Perf, from a node micro-benchmark with real THREE, 3 sails, 36 drifters and 100k frames:
  - about 2.6–3.1 µs per `update()`
  - heap growth after GC about 0
  - DOM writes only on change
  - the fixture adds about 14 small meshes (about 250 triangles)
- Fleet: researcher, designer, 3 builders (core, world, UI), break-it reviewer, perf reviewer, co-op/save reviewer,
  visual QA, fixer and visual polish, 11 subagents in total. Their findings were fixed, including furl geometry, island
  placement shared across peers, grounding by raft size, the respawn loop on long rafts, hot-reload CSS loss,
  E/R conflicts with pick-up, guest smoothing and per-frame allocations.

## Screenshots (`docs/cloud/shots/sailing/`)

- `31-sail-from-side.png`: sail raised and billowing, compass, prompt
- `42-steer-turned.png`: steering with hold R
- `52-furled-from-side.png`: sail lowered into a roll on the yard, pennant pointing downwind, anchor post in view
- `62-anchor-rope-down.png`, `65-anchor-close.png`: anchored state and anchor fixture
- `66-compass-zoom.png`: compass badge
- `20-islands-t0.png` → `21-islands-t20.png`: islands drifting past over 20 s; `22-debris-a.png`: debris flow

## Known limits and follow-ups

- **Lighting.** The clouds and islands are the existing simple meshes. Visual QA flagged the clouds as dark from below
  and the islands as uniform. That is world-art scope, which belongs to the world and islands lanes.
- **Ocean wraps.** The ripple and foam detail pattern shifts every 512 m of water travel, and the big waves jump
  every 65 km. Both are rare and subtle.
- **Paddle.** No paddle input is wired yet. A paddle item belongs with the hotbar and crafting lanes.
- **Spawning on tiles.** On wide or L-shaped rafts, a rotated debris spawn can land on a tile. It is immediately
  respawned by the existing `hasTile` check.
