# Engine (motor) + steering wheel: research

Feature (2) of this round. Research only; the spec goes in `docs/specs/engine.md`.

## 1. How the genre usually does it

Ocean-survival raft games tend to add a powered stage after the sail:

- **Motor**: a crafted, placed deck fixture (metal parts plus a "mechanical" part). It burns a fuel item
  from an internal tank (fill it by hand, several units) and pushes the raft at a fixed speed along the raft's
  heading, **whatever the wind**. Players use it to reach a target the wind won't carry them to.
- **Several motors per raft size**: one motor only moves a small raft. Bigger rafts need more motors
  (roughly one per N foundation tiles). With too few the raft crawls or doesn't move, and the HUD says why.
- **Steering wheel**: a separate station. Standing at it (grab or use) and turning sets the raft heading, and
  every motor pushes along that heading. Some games also let the wheel toggle all motors on or off and
  raise or lower sails from the same place.
- **On/off toggle** per motor (interact), plus a direction toggle (forward/reverse) in some games.
- Fuel runs out, the motor stops, and you refill it. Some games put a slow-burn, low-power fuel early and a better one later.

### Cozy take for Little Raft (original)

- **"Puttering motor"** (name TBD in spec, e.g. *Little Motor*): a small wooden-and-scrap box with a stubby
  propeller over the edge. Recipe from existing kinds, e.g. `{ wood: 6, scrap: 4, rope: 2 }`.
- **Forgiving fuel**: a motor *always* runs: unfuelled it putters at a **slow idle push** (about 0.35 m/s).
  Feeding it (E with leaf / wood / plastic selected, or any of those in the bag) gives **"warm" time**: full push
  for a while. Suggested values: leaf 20 s, wood 45 s, plastic 60 s, tank cap 300 s. Nothing is lost or
  broken when it runs dry. It only drops back to idle. No damage, no overheating, no breakdowns.
- **Wind-independent push** along a shared heading. Push target per motor about 0.6 m/s with a diminishing bonus
  for extra motors, and a raft-size factor so one motor on a 40-tile raft feels slow but still works
  (no hard "won't move").
- **Steering wheel**: a placed station (`wheel` decor). It reuses the existing *hold R and turn* sail-steering
  grab, aimed at the wheel instead of a mast. E at the wheel toggles **all** motors on or off. E at a single motor
  toggles that motor.
- **Speed sanity**: the engine target adds to the sail target, then the total water-relative target is
  clamped (suggest `ENGINE_CAP` about 1.6 m/s, combined cap about 2.0 m/s, still under `V_CLAMP: 3`).
  Anchored means zero push, same as the sail.

## 2. Code anchors (this repo)

### Sailing core: velocity, heading, wind, anchor (`dist/sailing-core.js`)
- `SAIL` constants :8-27. `SAIL_SPEED 1.3`, `CURRENT_Z 0.30`, `TAU_UP 4 / TAU_DOWN 3` easing, `PADDLE_CAP .9`,
  `V_CLAMP 3` :20, `MAX_SAILS 3`.
- `DEFAULTS` / state keys :29-32 (`heading, raised, anchored, vx, vz, wx, wz, gx, gz`, wind fields).
- `cleanSailing` :53-76 **rebuilds the object from known keys only**. Any new key on `world.sailing`
  (for example `engineOn`) must be added here, or it is dropped on every save, load and net snapshot.
- `sailFactor` :79-82, `sailTarget(state, nSails, out)` :85-96. Push = `dir(heading)*SAIL_SPEED*windStr*cos(h-wind)*f`.
  This is where wind dependence lives. An engine target is `dir(heading)*k` with no `cos` term.
- `stepSailing(state, dt, opts, out)` :111-167 is **the per-frame integration**. The host does wind wander :121-135.
  Velocity eases to `sailTarget` :138-142, the anchor freezes the raft against the seabed :144-145, island grounding strips
  velocity toward `opts.blockers` :149-160, and the offsets integrate :161-166.
  **Main hook point**: add `opts.push = {x,z}` (or `opts.engine`) and sum it into `_t` after `sailTarget`
  (skip it when `state.anchored`), then clamp the magnitude. The change stays pure and unit-testable in `tests/sailing.test.mjs`.
- `applySailAction` :170-195 has the ops `raise/lower/toggle/anchor/unanchor/toggleAnchor/heading/paddle`. `heading` :179
  is what steering sends. Paddle :182-192 is the existing "extra push with cap" pattern to imitate.

### Sailing world: per frame, steering grab, host apply (`dist/sailing-world.js`)
- `createSailing(T, ctx)` :17. `stepOpts = {nSails, host, rng, blockers}` :23 is where a push would be passed.
- `ensureState` :76-82 (`world.sailing` replaced with `cleanSailing` if malformed). `countSails` :83-87 counts
  `decor.type==='sail'`. Count motors the same way, or let the content module do it.
- `onRaftBuilt` :106-151 computes the raft footprint (`raftR`, bbox) from tiles :111-119, which can feed the raft-size factor.
  It finds sail groups by `userData.craftType` and decor x/z :121-145 and places the anchor post at the back-left tile :146-149.
- **Steering grab, which already exists**: `grab()` :300-306 (R pressed while `aimKind===1`, a sail) stores
  `grabYaw/grabHeading`. `steer(dt)` :234-243 turns `heading` toward `grabHeading + (yaw - grabYaw)` at
  `STEER_RATE 1.6` rad/s. The host applies it locally :240. A guest predicts, then sends `{kind:'sail',op:'heading'}`
  at 6 Hz :241-244. `release()` :307-312. Prompt strings `P_STEER` etc. :12-13. Aim tests (mast ray, anchor sphere) are
  in `updateAim` :203-224. A wheel is a third `aimKind` here, or `grab()` gains an "aim at wheel" alternative.
- `update(dt)` :247-274 calls `steer`, then `stepSailing` :254, then the flow, display smoothing and drifters.
  Guests run the same step with `host:false` and ease toward host snapshots in `smoothDisplay` :277-286. So **guests
  must compute the same push** from synced data, or they rubber-band.
- `interact()` :293-299 (E on a sail or anchor). `apply(a, actor)` :314-327 is the host side, with an `OP_GAP` 250 ms
  per-actor rate limit on toggles :316-320.
- `debug()` :328-334 is exposed as `raftDebug.sailing`.

### HUD (`dist/sailing-ui.js`)
- `update(info)` :54-84. The label modes `none/anchor/up/drift` with speed :74-81 would need a "Motor" mode or suffix.
  The compass sail tick :68-72 can double as the heading tick. `setPrompt` :86-92 is one shared prompt line.

### game.js wiring
- `DECOR_TYPES` :44 and `BLOCK_RADIUS` :52 spread `CONTENT_DECOR` / `CONTENT_BLOCK_RADIUS` (`dist/content-items.js` :24-25).
  Items and recipes go in `CONTENT_ITEMS` / `CONTENT_RECIPES` :9-21 (`recipe(id,name,count,cost)`).
- Decor validation in `cleanWorld` :154 drops unknown types. Older builds drop `motor`/`wheel` decor (acceptable).
- `rebuildRaft` :424-442 picks the model with `createPurifier ?? createCraft ?? createSignalModel ?? content.decorModel(type)` :428.
  It is placed at `(x*2, .22, z*2)` :429. It rebuilds `blockList` :439, then calls `sailing.onRaftBuilt()` :441.
  `dist/crafts.js` :12 holds the builders map (sail/palm/...), and models tag `userData.craftType`.
- Placement: `placementFor` :656 / candidates :663 allow one decor per tile on an existing tile. Build action :772-779
  takes the item from the bag and pushes `{type,x,z}`. **There is no decor removal anywhere**, so placed motors are permanent.
- `createSailing(...)` ctx :364-365. `applyAction` routes `a.kind==='sail'` :735. `interact()` :834-848 order is
  pickup, then `sailing.interact()` :836, then `content.interact(aim)` :844, then grill and watering, then the inventory.
  **A content-module wheel or motor is reached only after sailing declines.**
- Keys: KeyE :1175, KeyR :1176 (`sailing.grab()` else repair), keyup R :1180 release, blur release :1183.
  The controls bridge `repair:()=>{if(!sailing?.grab())repair()}` and `release` :1189. In `dist/controls.js` :36/:41, `rotate`
  calls repair (grab) on down and `release` on up for every device.
- Per frame: `sailing.update` :1071, then `content.update(dt)` :1079 (an engine module's push lags one frame, which is fine).
- Net: `hostState()` :1061-1062 sends `world.sailing` and `ext: content.serialize()` about 8 times a second. On the guest, the `state` handler
  :1298-1312 runs `cleanWorld` (so `cleanSailing`), then `content.load(w.ext,'net')`.
- `contentCtx` :328-335 has **no sailing getter**. A content module cannot read `world.sailing` heading or anchor except
  through `ctx.world.sailing` (that works, it is a plain object). It cannot inject a push or claim the R grab without a new hook.

### Content module shape
- `dist/content.js` :7-23 hooks: `update, serialize, load(data,from), action(a,actor,bag), interact(aim), prompt(aim),
  decorModel(type), debug`. `FEATURES` :30. Docs: `docs/features/content-hooks.md`.
- Examples: `dist/storage-research.js` (placed station plus E interaction plus ext state), `dist/signal.js`, `dist/watering.js`.

### Spec and islands
- `docs/cloud/sailing-spec.md` :5-31 covers the model ("world moves, raft stays at origin"). **It is stale**: it says SAIL_SPEED 1.7,
  sailFactor 0.3, paddle 0.6/2.6. The code is the source of truth (1.3, 0.1, 0.25/0.9).
- Scenery islands in game.js :359 are registered as drifters with radius 6 (:365). They block the raft via grounding.
- The content islands (`dist/islands.js` :1-2) run **their own drift/dock timeline** and do not read `world.sailing`.
  The motor cannot reach or leave them faster. Docking (`ISLAND.DOCK`, extended while a player is near, :176-177)
  is unaffected, but a raft motoring away while "docked" looks odd. Suggest no special casing for v1 and noting it in the spec.

## 3. Recommended shape (for the spec writer)

1. Pure `dist/engine-core.js`: `engineTarget(n, tiles, fuelOn, heading)` plus constants plus `cleanEngine`. Unit tests.
2. Content module `dist/engine.js` (`name:'engine'`): `world.ext.engine = {on:bool, fuel:{"x,z":seconds}}`, decor
   `motor` and `wheel` via `CONTENT_DECOR`, `decorModel`, `interact` (E on motor = feed fuel or toggle, E on wheel = toggle all),
   `prompt`, `action({kind:'engine',op})` host-only, burning fuel in `update` on the host only.
3. A minimal core hook: `stepSailing` reads `opts.push`, and `sailing-world` exposes `setPush(x,z)` (or reads
   `world.ext.engine` through a provided function). Guests compute the push from synced ext plus `world.sailing.heading`,
   so dead-reckoning matches. The wheel steers the **existing `state.heading`** (one heading for sail and motor; the sail cloth
   turns with it, which reads as "the raft turns").
4. Wheel steering: extend `sailing-world` `updateAim`/`grab` with a pluggable extra grab target (for example `ctx.steerTargets()`
   returning wheel positions), so all the predict-and-send guest logic is reused rather than duplicated.

## 4. Risks

- **Co-op**: the push must be derived only from synced state (`world.sailing` plus `ext.engine`). Burn fuel on the host only,
  and let guests read the `on` flag and fuel>0. If the guest's push diverges, `smoothDisplay` hides small errors but snaps past
  6 m (`SNAP2 36`). Rate-limit toggles like `OP_GAP`. Two players steering means last-writer-wins, the same as the sail today
  (the host re-bases its grab when a guest sends a heading :323-325).
- **Save compat**: `cleanSailing` whitelists keys. Keep engine state in `world.ext.engine` (old saves get `load(undefined)`,
  defaults off). Older builds drop unknown decor types and `ext` keys, and that degrades quietly.
- **Speed exploits**: sail (max 1.56 at 3 sails), engine, paddle and current all stack. Clamp the summed target (not
  only per source), and keep it below `V_CLAMP 3` and the debris range. Fast travel could outrun debris respawn (`outOfRange`,
  `ITEM_MARGIN 26`) or island grounding (grounding removes velocity toward a blocker, so it still holds at any speed).
  Cap the motor count at about 4 (diminishing returns), like `MAX_SAILS`.
- **Fuel dupes**: feeding must use host-side `bag.remove` (`dist/inventory-state.js` :241) through `action(a, actor, bag)`. Never
  trust a guest-sent amount.
- **Phone / touch controls**: there is no touch UI in `dist/` today (keyboard/mouse and gamepad only; `controls.js` maps
  `rotate` to hold-to-steer for every device). Hold-R-and-turn steering needs look input, which works on a pad. For
  later phone support, the wheel should also accept discrete "turn left/right" taps or E-cycles with ±15° steps.
  Keep the action protocol (`op:'heading'` with an absolute angle) device-agnostic.
- **Input conflicts**: R is already sail-grab-else-hook-repair. Adding a wheel target must keep "pickup wins, sail
  next" ordering in `interact()` :836 and must not break hook repair when the player aims at nothing.
- **Placement**: decor cannot be removed, so a misplaced motor is permanent. Consider allowing a motor on any tile
  (direction-free: the push follows the heading, not the motor's facing) so placement never matters.
