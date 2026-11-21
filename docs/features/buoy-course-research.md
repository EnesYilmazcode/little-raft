# Buoy ring course: research

Status: research only, no code changed. Line numbers are for `HEAD` (77b1cb6). `dist/game.js` has merge-conflict blocks
in the working tree right now, so search for the quoted anchors rather than trusting the numbers.

## Genre conventions (time trials and checkpoint races in sandbox games)
- A start marker you walk up to. Starting is instant and so is a retry, often with a 3-2-1 countdown.
- You can see **only the next gate or two**. The next gate is bright, cleared gates fade, and an arrow or beam points to the next one.
- Each gate gives a chime whose pitch rises through the course, and the finish gets a bigger flourish.
- The timer sits top-centre, with the gate count and your best time next to it. After a finish you see the new best and a small leaderboard.
- Gates have to be taken in order. A missed gate never fails the run. You just can't advance until you go back for it.
- Some games add par times or medal tiers, and many add ghosts. We skip ghosts, as the brief allows.
- **Our cozy take:** nothing to lose, no penalties and no fail state. You can stop a run any time, and the next try is one E press away.

## What exists today (verified)
- **Swimming.** Swim speed is 2.1 m/s (`player-physics.js:10`) times `MOVE_MUL.swim` (`:41`, `:135`). The cookpot swim buff writes
  `MOVE_MUL` (`cookpot.js:173`). `WATER_ENTER`/`EXIT_HYST` are at `:20-21`, and eye height is waterY + 0.45 (`:22`). Holding jump near
  a tile auto-clambers you aboard (`:191`). If you get more than 50 m from the nearest tile you snap back to the deck
  (`MAX_RAFT_DISTANCE`, `:38`, `_safety` at `:218`).
- **Diving is faster than swimming.** `DIVE.SPEED` is 2.4 and `FAST` is 3.4 (`diving.js:21`), scaled by `diveMods` (dive gear fins).
  `diving.move` replaces surface physics while you dive (game.js:1258). A shallow dive through a gate is a fun skill trick, so we allow it.
- **Waves.** `ocean.getHeight(x, z)` (`ocean.js:308`) already includes the sailing `uFlow` offset. `getSlope(x, z, t, e, out)` (`:328`) and
  a combined height+slope call (`:337-344`) take a reused `out` object, so bobbing 12 buoys costs about 36 cheap wave sums per frame.
- **Frame of reference.** The raft never moves in x/z. It sits at the origin with no yaw (game.js:421, `sailing-world.js:3`), and while sailing
  the world drifts past it. **Positions relative to the raft are world positions.** A swimmer **within 10 m** of the origin stays with the raft. Beyond
  that, the swimmer is carried with the drifting world (`LEASH = 10`, `sailing-world.js:276`). Buoys tied to the raft would then slide
  away from a far swimmer, so a run needs the raft to be still: `world.sailing` lowered or anchored (`sailing-core.js:88`, `:152`).
- **Things in or near the water.** The signal cache is a `world.items` entry with `x/z` capped at 80 m (`signal.js:24-32`), drifted by the host.
  The fish trap (branch `loop-features-202611210735`, not merged) is edge-tile decor that hangs off the deck. It is checked with
  `placeBlock()` and `isEdgeTile` (`fish-trap.js:96`, `:267`). Treasure (Sandy Secrets) lives on islands only. Nothing yet keeps raft-relative props out in open water.
- **HUD.** The signal pill is `#signalReadout` at fixed `top:14px`, centred (game.js:99, created at :376, updated at :724). Its text is only
  rewritten when it changes. The buff chip is `ensureChip()`/`hud()` in `cookpot.js:133-153`: lazy DOM, one `<style>`, text updated once per second.
- **Audio.** `EVENTS` has no chime (`audio.js:23`). `sfx.note(i, step, s)` with `i = 'bells'` and `step` from 0 to 7 (D pentatonic) is a clean rising
  chime. Game.js wraps it as `note` (game.js:283), but `contentCtx` does not expose it. `emit({sound})` plays any EVENT
  through `effect()` (game.js:928-938), and when the emit carries text it also shows a notice.
- **Names.** Co-op reads `localStorage['little-raft-name']`, at most 16 chars, defaulting to "Brother" (`coop.js:34`). The peer's name is
  `coop.remote.name` (`coop.js:234`). `contentCtx` has `other` (the peer's pose, including `swimming`) but no names (game.js:397-408).
- **Hooks that are not merged yet.** Crew tasks count host events through `observe(ev, actor)` (`tasks.js:1-4`, rules
  `tasks-rules.js:18+`, branch `loop-features-202611210749`). Logbook achievements are `ACHIEVEMENTS`/`evaluate` (`logbook.js:27`, `:73`).
- **Shark.** It hunts swimmers within 25 m (`shark.js:23`, `HUNT_RANGE`). A course puts players in the water for a long time, so keep every gate within about 20 m of the deck.

## Our design
- **Course Kit** (`coursekit`, new item) crafts the placeable decor **Start Flag** (`courseflag`). It is a pole with a pennant and a little
  wooden **course board** on the same model. Recipe sketch (existing ids only): `plastic: 4, rope: 3, wood: 3`. One flag per raft.
  The first flag owns the course. An optional extra decor, `scoreboard` (`wood: 3, scrap: 1`), shows the top 3 elsewhere on deck.
- **Placement UX (v1, simplest robust approach).** You don't place rings by hand. The flag has two aim targets, like the sail and the wheel:
  the **pole** (E: start or stop a run) and the **board** (E: cycle the course). Four preset shapes are generated from the raft's bounding
  box (`world.tiles`, 2 m tiles), with every gate at least 4 m clear of the hull and no more than 20 m from the nearest tile:
  `Loop` has 6 gates on an ellipse around the raft. `Sprint` has 4 gates out and back off the flag's side. `Zigzag` has 6 alternating gates along one side.
  `Figure 8` has 8 gates around two lobes.
  The host generates the gate list when the shape changes and stores it, so a tile added later doesn't shift a course mid-run.
- **Manual rings (v1.5, optional).** A `Custom` shape. While swimming, hold the kit (or a cheap `ringbuoy` item) and press E to drop a gate at
  your own position, facing your swim direction, up to 8 gates. This avoids raycasting onto moving waves, which keeps it robust. Clear the course from the board.
- **Visibility.** Gates show while a run is live, and for about 20 s after you look at the board, so the sea stays clean. They hide while the
  raft moves (sailing speed > 0.15 m/s), because buoys towed by the raft would look wrong.

## Gate detection (segment-plane crossing, local player)
- Gate `i` is stored relative to the raft as `{x, z, yaw}` (rounded to 0.1 m). From those we derive the normal `n = (sin yaw, cos yaw)`,
  the tangent `t = (n.z, -n.x)`, an inner radius `R = 1.5` m and a centre y of `getHeight(x, z)`.
- Each frame, keep the previous position `p0` and take the current position `p1` from `physics.x/y/z`, after `afterMove`. Let `d0 = (p0 - c)·n` and `d1 = (p1 - c)·n`.
  It is a hit when `d0 < 0 <= d1`, which means the gate only counts in its own direction. Then `s = d0 / (d0 - d1)`, `q = lerp(p0, p1, s)`, `|(q - c)·t| <= R`,
  and `q.y` (the eye) must lie between waterY - 1.6 and waterY + 1.4. That allows a shallow dive but not swimming deep underneath.
- Only the **next** gate is tested. It's O(1), you can't skip gates, and a missed gate just stays lit. If `|p1 - p0| > 3` m, skip the test,
  because that was a teleport (clamber, `_safety` snap, restore).
- The pure maths goes in `dist/course-core.js`: `makeCourse(shape, tiles)`, `crossGate(p0, p1, gate, waterY)`, `cleanCourse(v)` and
  `addBest()`. Tests go in `tests/course.test.mjs`: crossings, wrong direction, a crossing that grazes the edge, teleports, shape bounds and malformed saves.

## Timer rules
- Press E on the pole and a 3-2-1 countdown plays ('ui' sound). GO starts the timer, then you dive in. The clock is the sum of game `dt`
  (frames are capped, so a slow frame can't add time unfairly). Display rounds to 0.1 s, and the stored time is whole milliseconds.
- The **finish** is the last gate. On `Loop` and `Figure 8` that's gate 0 again. On `Sprint` it's a gate next to the flag.
- A run **stops quietly, with no penalty**, when you press E on the pole again, when you stand on the deck for more than 2 s after the first gate,
  when the raft starts moving, when the timer passes 10 min, or when the course changes. The text says "Run stopped", never "failed".
- The start is refused (gentle notice) while the sail is raised and the anchor is up: "Lower the sail or drop anchor to race".
- **Mode**: `swim`, or `board` when the parallel paddleboard feature reports you aboard, for example through a flag that feature exposes.
  Each shape keeps a separate best list per mode. Buffs (meal swim buff, dive fins) are allowed. That's cozy, and we don't track it.

## Saving best times and co-op
- The slice is `world.ext.course = {v:1, shape, gates:[[x,z,yaw]...], custom:[...], best:{"loop:swim":[[name, ms], ...top 5]}, r}`. `r` bumps
  on every change, so `load(_, 'net')` only rebuilds when it changes. Old saves load as `load(undefined)`, which means no flag and no course. `cleanCourse` clamps
  coordinates to ±40, caps gates at 8 per shape and best lists at 5 rows, and trims names to 16 chars.
- **Host-authoritative actions**: `course.shape` (from the board), `course.gate` (custom drop), `course.clear` and `course.finish {shape, mode, ms, name}`.
  The host checks that the shape and gate count match and that `ms` is at least the path length / 4.5 m/s * 1000, which rejects impossible times. It then inserts
  the row, keeps each player's best once per list, and emits to everyone: "Mia finished Loop in 41.3 s · new best!" (`sound:'catch'`).
- **Detection and the timer are local to each player** (smooth physics, no network round trip), and both players can race at once on the same gates.
  The gate highlight is per player. The name comes from `localStorage['little-raft-name']`, read the same way as `coop.js:34`, with "Sailor" when solo.
- Guests never write the slice. They send `ctx.action({kind:'course.finish', ...})` and see the result in `hostState` ext.

## Models and draw calls
- The gates are **one `InstancedMesh`** (TorusGeometry r=1.5, tube .1, 8x24 segs, max 8). Pending gates are white, the next gate is warm orange, and cleared gates are faint
  (`instanceColor`). Each gate has a float collar: **a second `InstancedMesh`** of 2 small floats per gate (16 instances). One extra mesh
  is a soft vertical beam over the next gate. That's **3 draw calls** in total, with no shadows, built once in `create()` and drawn while visible.
- Bobbing: for each gate, every frame, y = getHeight(x, z) + .6 (half the ring above water), with a small tilt from the shared `getSlope` out.
  Gates are set with `setMatrixAt` from a reused Object3D and Vector3. `needsUpdate` is only set while visible.
- The flag and scoreboard use `decorModel('courseflag' | 'scoreboard')` with merged geometry (`merge-geo.js`). The board uses a 256x128
  `CanvasTexture` that is redrawn only when `r` or the shape changes.
- HUD: a `cbTimer` pill at `top:48px`, centred under `#signalReadout`, built lazily like `cookpot.js:133`. It reads "Ring 3/6 · 0:24.3 · best 0:41.3",
  and its textContent is only written when the tenth of a second changes. For the 3-2-1 countdown, the same pill gets a larger font.
- Audio: on each gate, `note('bells', min(i, 7))`, local only. The finish gets `emit` 'catch', and a stop gets 'ui'.

## Integration points
- `dist/content.js` imports `createCourse` into `FEATURES` (`content.js:49` in the working tree; cookpot stays last). `dist/content-items.js` gets `coursekit`, `courseflag`,
  `scoreboard` in `CONTENT_ITEMS`/`CONTENT_RECIPES`/`CONTENT_DECOR` (`:63`, `:105`) plus `CONTENT_BLOCK_RADIUS`. The icons are `icon-coursekit` and
  `icon-flag` in `icons.svg` and `SPRITES` in `survival-ui.js`.
- Module hooks: `update(dt)` handles bob, detection and HUD (game.js:1455). `afterMove` gives p1 after physics (game.js:1269). `interact`/`prompt` cover pole and board
  (game.js:1136, :713). `action` is host-only (game.js:1102). `decorModel` is called at game.js:589. Read the sailing state from `ctx.world.sailing` (`raised`, `anchored`,
  `vx/vz`).
- **A small edit to game.js (one line in `contentCtx`, game.js:397):** add `note: (i, n, s) => note(i, n, s)` for the chime. Optionally add
  `get peerName() { return coop?.remote?.name ?? null; }`. Without it, falling back to `emit({sound:'ui'})` per gate works, but it plays the same sound for every gate.
- If merged, add crew task `T('race', 'Finish a buoy course', 1, {rope:1}, e => e.kind === 'race' ? 1 : 0, 'courseflag')`, and the host calls
  `observe({kind:'race'}, actor)` on finish. Logbook: achievement `ringrunner` ("Finish every course shape").
- Paddleboard: the only contract we need is "is the local player on a board, and where is it". Detection uses that position instead of `physics`.
- QA `debug` (as `raftDebug.content.course`): `shape(name)`, `gates()`, `start()`, `teleportThrough(i)`, `finish(ms, name)`, `state()`.
