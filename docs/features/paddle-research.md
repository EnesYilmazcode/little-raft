# Paddle: research

Status: research only. Branch `claude/loop-features-202611210943-r3`. Line numbers are for this tree.

## 1. Reference and our version

**In Raft.** The paddle is an early crafted tool that wears out with use. You stand at the edge of the raft and each
click is one stroke that moves the raft slowly the way you face. Players use it to reach islands, wrecks and loot
before they have a sail, and later to make small steering corrections. It is slow and tiring, and that is on purpose:
the sail and the engine are the real upgrades.

**Little Raft (our own design).** A held **Driftwood Paddle** (tool, stack 1, wears like the hook).
- Hold LMB while you stand on the deck within about 1.2 m of an open tile side. You stroke once every 0.8 s for as
  long as you hold the button. A single click makes one stroke. Clicking faster gives nothing extra.
- **Direction: the camera's horizontal facing.** It is easy to read: look at the island and paddle. "Opposite to
  the side you paddle on" fights mouse-look and is confusing on a 1-tile raft. The side you stand on only picks
  which way the blade swings and where the splash lands.
- Each stroke adds a small velocity impulse on the host. It adds to sails and motors. A co-op partner's strokes
  stack, up to a slightly higher cap.
- Splash drops and rings at the blade, plus the existing wet-stroke sound. The peer sees the splash and hears it.
- Muted prompt reasons: not at an edge, anchored, swimming, worn out.

## 2. How Little Raft hosts it

### PRIOR ART: read this first
- `sailing-core.js:19` already has `PADDLE_IMPULSE 0.25, PADDLE_CAP 0.9, PADDLE_COOLDOWN 0.8`. The
  `applySailAction` case `'paddle'` (`:190-199`) adds `sin/cos(angle)*0.25` to `vx/vz` and refuses the stroke when
  anchored or while `state.paddleClock > 0`. It caps speed at `max(PADDLE_CAP, current speed)`, so a stroke can steer
  or slow a fast raft but never push it faster. `paddleClock` counts down in `stepSailing` (`:120`), runs only at
  runtime, and `cleanSailing` drops it. Tests: `tests/sailing.test.mjs:47,266-282` (`:268` assumes 0.25).
  **No caller exists on this branch** (`docs/cloud/sailing.md:39,138`, `docs/loop/research/fidelity-r2b-world.md:11`).
- **The unmerged branch `origin/claude/loop-fidelity-202611210821` (from `wip-fid-paddle-202611210821`) already
  ships a paddle.** Commits f0e4e710, 9df4e031, 07cdee7c and 2a96f50e add an `items.js` item `paddle` (durability
  60, wood 4 + rope 2 + plastic 2, repair wood 2 + rope 1), `dist/paddle.js` (pure rules plus `attachPaddle` glue),
  `paddle-model.js`, a `hands.update({paddle})` stroke and `tests/paddle.test.mjs`, and they raise `PADDLE_CAP` to 1.1.
  `docs/loop/STATUS.md:13-16` shows that integrator B has claimed -0821, and `docs/loop/LOG.md:1069` records it as
  pending. **It is in neither `origin/claude/raft-master` nor `origin/main`.** Building a second paddle risks
  duplicate item ids and merge conflicts. Either build on that code (see `git show 07cdee7c:dist/paddle.js`) or wait
  until B decides. The parts that would be new here are hold-to-repeat, per-actor cooldown, co-op stacking, the
  peer splash, and the stand-near-edge test.

### Sailing integration (world moves, raft stays at origin)
- `stepSailing` (`sailing-core.js:116-176`): velocity eases toward the sail target plus `opts.push`. The engine
  push is capped by `TARGET_CAP 2.0` (`:151-155`). Easing uses `TAU_UP 4` and `TAU_DOWN 3` (`:158-160`), so **a
  paddle impulse decays**. With 0.25 every 0.8 s and τ = 3 s: decay per stroke e^(-0.8/3) = 0.766, and the peak would
  be 0.25/0.234 ≈ 1.07 m/s, so the 0.9 cap is always the binding limit (about 0.8 m/s average solo). For comparison,
  one motor gives 0.7 m/s (`engine.js:85-92`, `docs/specs/engine.md:16`). **A paddle that beats a fuelled motor is
  wrong.** Proposal: solo cap 0.55, and 0.8 when two distinct actors stroked in the last 2 s. Keep the impulse at
  0.2 to 0.25.
- Blockers (`:165-176`) already ground the raft against scenery islands (`sailing-world.js:94-99`), so strokes
  cannot shove it through land.
- The motor push alternative is `content.sailPush(sailing, out)` (`content.js:21,161`, wired at
  `game.js:501` → `sailing-world.js:267`). It must come from synced data on both peers. An impulse through the
  existing `op:'paddle'` is simpler, and it is authoritative on the host.
- Sail actions: `game.js:1198` routes `a.kind === 'sail'` to `sailing.apply(a, actor)` (`sailing-world.js:329-340`).
  `LIMITED_OPS` / `OP_GAP 250` (`:10,12`) rate-limit only the toggles, not `paddle`.

### Co-op authority
- `action()` (`game.js:1110-1116`): a guest sends `{type:'action', a}`, and the host runs `applyAction`
  (`:1191`, which returns early on a guest at `:1192`). `content.action(a, actor, bag)` runs at `:1334`, after the
  sail branch, so a content module must use its own kind (for example `paddle.stroke`) and then call the sail op
  itself, or game.js must get a hook before `:1198` (as -0821 did).
- The host sends `world.sailing` in `hostState()` (`game.js:1734-1737`) every 120 ms (`:1788`). The guest steps
  `stepSailing` with `host:false` and smooths its display (`sailing-world.js:262-268,292-301`). A guest stroke
  therefore shows up within one round trip plus 120 ms, and the motion eases in rather than snapping.
- `state.paddleClock` is **shared across actors**, so a partner's stroke inside 0.8 s is dropped. For stacking, move
  the cooldown to a per-actor map on the host (like `lastOp`, `sailing-world.js:331-334`) and keep only the cap in
  core.

### Item, durability, repair
- Tools live in `items.js` (`item(...)` at `:66-71`; hook `:152`, durability 50; spade `:188`; glidehandle `:194`).
  Wear is `wearPerUse(kind)` = 100/durability (`:510`), and `toolRole` / `actsAs` is at `:516`. Content items
  (`content-items.js:7`) are always `tool:false`, so a paddle with durability must go in `items.js`.
- Repair: `REPAIRS` (`items.js:356-364`) has an entry per tool. The R key (`game.js:1362-1364`) and the
  `'repair'` action (`:1305-1309`) only fix hook-role slots (`isHookSlot`, `:170`; `coop-rules.js:87`). A paddle
  needs either an R branch like the spade's (`:1363`) or no repair at all. Wear is applied on the host, as hook wear
  is at `game.js:1187`.

### Input (LMB hold)
- `controls.useDown` (`game.js:1938`) → `useSelected(pickCenter())` (`:1394`). Only the hook charges
  (`beginCharge`/`releaseCharge` `:1426-1436`, `CHARGE_MS 900` `:96`). `useDown` fires once per press, so
  **hold-to-repeat** has to poll `controls.input.down('use')` each frame (the same API reads `interact` at
  `:1539`). Content LMB hook: `content?.use(aim, kind)` (`:1423`), which runs after the engine tools.

### Viewmodel and peer avatar
- `held-items.js`: `TOOL_KINDS` (`:33`), `HOLD` poses (`:40-65`, spear `:48` `rx -1.32`), and the mesh switch in
  `buildItemModel` (`:243-265`). `hands.js` takes `update({casting,…})` (`:11,432-497`). The spear jab
  (`spear-repair-hooks.js:12,30-42`) shows the pattern: a 0.32 s lunge set on `hands.group.position` plus
  sliding `userData.model`. Per-frame wiring is at `game.js:1603-1616` (`swing`, `hp` reused, no allocation).
- Peer: `pose().held` (`game.js:241`) → `friend.userData.setHeld(other.held)` (`:1629`). `coop-avatar.js:232`
  animates `throwAge`. A paddle stroke can reuse it or add a short `strokeAge`.

### Splash and sound
- `waterfx.js` `splash(x, y, z, strength)` (`:127`, pool of 48 drops and 8 rings). The game instance is `sharkFx`
  (`game.js:514`). The content ctx has no splash, so either pass one in or create a module-local
  `createWaterEffects(T)`. `coop-fx.js` has no splash.
- `audio.js:332-340` `swim` is already a "paddle stroke: wet swirl" sound (gain `:35`). `splash` is at `:322`.
  For the peer, use `emit({kind:'notice', sound:'swim'}, 'all')` (`game.js:1135`; paddleboard does this at
  `paddleboard.js:109,200`). To get a positioned splash, use `content.effect(e)` (`game.js:1129`).

### Edges
- `world.tiles` is `[x,z]` on a 2 m grid (`hasTile`, `game.js:369`). The raft does not rotate with the heading, so
  tile coordinates are raft-local metres.
- Reuse `nearestTile(tiles, x, z, out)` (`paddleboard-core.js:63-73`; `TILE 2`, `HALF 1`, `:19`). The player
  is on the deck when `p.grounded && nearestTile(p).d === 0` (`paddleboard.js:39`). Near an edge means probing the
  four points `p ± 1.2 m` along x and z, and at least one probe must have `d > 0` (water). This is stricter and
  fairer than -0821's "tile has an open side" (`paddle.js onEdgeTile`), which lets you paddle from 1.9 m inside
  the tile. Upper floors: require `p.y` near deck height, since `world.pieces` floors exist.

### Paddleboard (avoid overlap)
- The Driftboard (`docs/specs/paddleboard.md`, `paddleboard*.js`) is a separate rideable board. LMB with
  `driftboard` launches it (`paddleboard.js:169-177`). Riding owns movement through `content.ride` (`game.js:1539`).
  The raft paddle must do nothing while `content.riding()` is true.
- Reuse: the `swim` sound and the stroke model (`paddleboard-core.js:20,191`, `sin(PI*ph)` thrust). The paddle
  mesh in `paddleboard-model.js:56-61` is merged into `shared`, so it would have to be exported for a held model.

## 3. Risks
- **Duplicate feature:** the -0821 paddle is pending with integrator B. Coordinate before writing code.
- **Anchored:** core already refuses (`sailing-core.js:191`). Show a muted "Raise the anchor" prompt and apply no wear.
- **Islands do not respond to raft motion.** Dockable islands (`islands.js`) follow a scripted path (`pathAt`,
  `islands-layout.js:118-130`; `APPROACH 25 / DOCK 180 / DOCK_CAP 600 / DEPART 30`, `:8`) relative to the raft and
  ignore `world.sailing`. Paddling cannot "reach" them. Only the decorative scenery islands (`game.js:490`) drift
  with the seabed offset. Do not promise "paddle to the island" in tips unless islands.js gains seabed anchoring.
- **Speed caps:** keep the solo paddle below a motor (proposal above). `TARGET_CAP 2.0` and `V_CLAMP 3` stay as they
  are. `PADDLE_CAP` only limits what paddling adds.
- **Co-op:** a guest only sends `{op:'paddle', angle, slot}`. The host checks the slot (it must be a paddle with
  durability > 0), the guest's own pose (`other`, at the edge, not swimming), a finite angle and a per-actor cooldown,
  and then wears the paddle. Strokes that are refused do not wear.
- **Spam:** a local gate at 0.85 s (just over the host's 0.8 s, as -0821 does) plus the host per-actor clock.
  Holding the button just repeats.
- **Motion sickness:** the raft is fixed at the origin and the world slides past, so the camera has no jerk. Keep
  the viewmodel stroke small. Scale any camera nudge by `options.cameraMotion` (`game.js:1596,1604`), and do not
  roll the camera per stroke.
- **Perf:** allocate nothing per frame, reuse scratch objects, and keep the splash pool shared.
