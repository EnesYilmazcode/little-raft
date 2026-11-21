# Engine (Little Motor) + Steering Wheel: spec

Research and anchors: `docs/features/engine-research.md` (anchors re-checked against this branch).
Goal: a placeable **Little Motor** pushes the raft along the shared sail heading whatever the wind, and a
**Steering Wheel** is a second grab point for the existing hold-R steering, so a motor raft needs no sail.
Cozy: no damage, no breakdowns, nothing is lost when fuel runs out. The motor simply stops.

## 1. Rules (decided)
- **Motor** (`motor` decor, any raft tile, facing is irrelevant). E toggles it on or off. It pushes **only while on with
  fuel > 0 and not anchored**. With no fuel it does nothing; its prompt and notice say **"Needs fuel"**. No idle push.
- **Fuel**: hold leaf / wood / plastic (selected hotbar slot) and press E on a motor whose tank is not full: 1 item goes in.
  `FUEL = {leaf:20, wood:45, plastic:60}` seconds, tank cap `FUEL_CAP 300`. Refused only when `fuel >= FUEL_CAP - 1`
  ("Tank is full"); overflow is clamped (small waste is fine). Holding fuel with a full tank, or holding anything else: E toggles.
- **Burn**: host only, 1 s of fuel per second for each motor that is on, fuelled and not anchored. At 0 it stays `on`
  (it restarts by itself when fed) and the host emits "A motor ran out of fuel" to all.
- **Push**: `speed = ENGINE_SPEED 0.7 * GAIN[min(n, MAX_MOTORS 4)] * sizeFactor(tiles)`, n = running motors,
  `GAIN = [0, 1, 1.5, 1.8, 2.0]` (diminishing; a 5th+ motor adds nothing but still burns, and its prompt says "Max 4 motors help"),
  `sizeFactor = clamp(sqrt(16 / max(1, tiles)), 0.6, 1)`. Direction = `(sin heading, cos heading)`. Max 1.4 m/s.
- **Total cap**: sail target + engine push is clamped to `SAIL.TARGET_CAP 2.0` m/s (< `V_CLAMP 3`). Paddle and current unchanged.
- **Wheel** (`wheel` decor): hold R while aiming at it = the existing sail steering (same `state.heading`, same STEER_RATE,
  same guest predict/send). E on the wheel toggles **all** motors: any on -> all off, else all on.
- Islands (`dist/islands.js`) keep their own drift timeline. No special casing in v1 (noted for later).

## 2. Items and recipes (`dist/content-items.js`)
- `CONTENT_ITEMS`: `motor: item('motor','Little Motor','icon-repair')`, `wheel: item('wheel','Steering Wheel','icon-repair')`.
- `CONTENT_RECIPES`: `motor: recipe('motor','Little Motor',1,{wood:6, scrap:4, rope:2})`,
  `wheel: recipe('wheel','Steering Wheel',1,{wood:5, rope:2})`. They unlock through research like other recipes
  (`learnedFrom` in storage-research.js :36: all cost kinds seen). Legacy saves get them automatically.
- `CONTENT_DECOR`: add `'motor','wheel'`. `CONTENT_BLOCK_RADIUS`: `motor: .45, wheel: .4`.

## 3. Data: `world.ext.engine` (never `world.sailing`; `cleanSailing` :53-76 whitelists keys)
```
{ v: 1, motors: { "x,z": { on: boolean, fuel: number } } }   // key = motor decor tile ints
```
`cleanEngine(v)`: non-object -> `{v:1, motors:{}}`. Keys must match `/^-?\d+,-?\d+$/`, at most `MAX_ENTRIES 64`
(extra dropped in key order), `on` strict boolean else false, `fuel` finite -> clamp `[0, FUEL_CAP]` and round to 0.1, else 0.
Never throws (try/catch per field, like `cleanSailing`). Entries with no matching `motor` decor are ignored by all
counting functions; the host prunes them when the decor list changes. A motor without an entry = `{on:false, fuel:0}`.

## 4. `dist/engine.js` (new, name `'engine'`)
Pure exports (no THREE, no DOM; tested):
- `ENGINE` frozen constants (above, plus `REACH 2.6`, `OP_GAP 250`, `MAX_TICK 1`, `PROP_SPIN 14`).
- `cleanEngine(v)`; `motorKeys(decor)` -> sorted `"x,z"` of `motor` decor; `wheelSpots(decor, out)` -> raft-local `{x:d.x*2, z:d.z*2}`.
- `runningCount(slice, decor, anchored)` -> motors with on && fuel > 0 && !anchored && in decor.
- `engineSpeed(n, nTiles)`; `enginePush(slice, decor, nTiles, sailing, out)` writes `out.x/out.z` (0 when anchored or n = 0), no allocation.
- `burn(slice, decor, dt, anchored)` -> array of keys that just hit 0 (dt clamped to `[0, MAX_TICK]`).
- `applyEngineAction(slice, a, decor, bag)` -> `{ok, text}`. Ops: `toggle {x,z}`, `all {}`, `fuel {x,z,item}`.
  `fuel` checks `FUEL[item]`, motor decor at x,z, tank not full, then `bag.remove(item,1)` (inventory-state.js :241);
  the host never trusts a guest amount. Texts: "Motor on" / "Motor off" / "Needs fuel" (toggled on at 0 fuel) /
  "Motors on" / "Motors off" / "+45 s fuel" / "Tank is full" / "Not fuel" / "No motors".

Factory `createEngine(ctx)` (content module, `dist/content.js` header :7-23 shape):
- `st = cleanEngine(undefined)`. `load(data, from)`: `st = cleanEngine(data)`; cheap, never touches meshes (guests, 8x/s).
- `serialize()` -> `st`. `action(a, actor, bag)`: handles `a.kind === 'engine'` only; per-actor `OP_GAP` rate limit on
  `toggle`/`all`; `ctx.emit({kind:'notice', text}, actor)`; returns true.
- `update(dt)`: host (role !== 'guest') runs `burn` and prunes; every role spins props: `prop.rotation.z += PROP_SPIN*dt`
  for running motors and bobs the housing (scale.y 1 + .02 sin). Models are found by rescanning `ctx.raft.children` for
  `userData.engine` when the child count changes (key = `round(pos.x/2),round(pos.z/2)`).
- `interact(aim)`: nearest motor/wheel along the view ray within REACH (copy `target()` in storage-research.js :274-293,
  centre y .65 motor / 1.05 wheel). Motor: fuel if holding a FUEL kind (`ctx.localBag()` selected slot) and tank not full,
  else toggle. Wheel: `all`. Sends via `ctx.action({kind:'engine', op, x, z, item})`.
- `prompt(aim)`: motor `<kbd>E</kbd>Add wood (+45 s)` | `<kbd>E</kbd>Start motor · 2:10 fuel` | `<kbd>E</kbd>Stop motor · 2:10 fuel` |
  `<kbd>E</kbd>Start motor · Needs fuel`; wheel `<kbd>E</kbd>Start motors · hold <kbd>R</kbd> to steer` (or Stop).
- `sailPush(sailing, out)`: `enginePush(st, world.decor, world.tiles.length, sailing, out)`; returns true if non-zero.
  **Host and guest compute it from the same synced data** (`ext.engine` + `world.sailing` + `world.decor/tiles`).
- `steerTargets()`: cached `wheelSpots` array (rebuilt when decor length changes; no per-frame allocation).
- `decorModel(type)`: `motor`/`wheel` from `engine-models.js`, `instance()` pattern like `buildResearchTable`.
- `debug` (raftDebug.content.engine): `state()`, `place(type,x,z)` (host, empty tile, then `ctx.rebuildRaft()`),
  `fuel(x,z,sec)`, `set(x,z,on)`, `push()` -> last push + speed.

## 5. `dist/engine-models.js` (new, THREE passed in, few meshes, shared geometry)
- `buildMotor(T, mat)`: housing box .7x.5x.5 (`#6f7f86` scrap grey) on a wood plinth .8x.08x.6; exhaust cylinder r .05 h .35
  on top (dark); shaft box over the +z edge down to y -.1; propeller group `name 'engineProp'` of two crossed blade boxes
  (`#d9b25a`). 5-6 meshes. `userData.engine = 'motor'`, `userData.craftType = 'motor'`.
- `buildWheel(T, mat)`: post cylinder r .07 h 1.0; ring torus r .38 tube .04 at y 1.05 facing +-z; hub cylinder; 2 crossed
  spoke boxes; 4 small handle knobs optional. Wood colors. `userData.engine = 'wheel'`.

## 6. Core change: `dist/sailing-core.js` (exact)
- `SAIL` :8-27 add `TARGET_CAP: 2.0, // sail + engine target cap (m/s)`.
- `stepSailing` doc :108: `opts = {nSails, host, rng, blockers, push}`. After `sailTarget(state, o.nSails, _t);` :138 insert:
```
const p = o.push;
if (p && !state.anchored && fin(p.x) && fin(p.z) && (p.x || p.z)) {
  _t.x += p.x; _t.z += p.z;
  const m2 = _t.x * _t.x + _t.z * _t.z, C = SAIL.TARGET_CAP;
  if (m2 > C * C) { const s = C / Math.sqrt(m2); _t.x *= s; _t.z *= s; }
}
```
  No push = byte-identical old behaviour. Easing, anchor, grounding and offsets stay as they are.

## 7. `dist/sailing-world.js` (wheel grab + push)
- :7 add `WHEEL_Y = 1.05, WHEEL_R = .5`; :12 add `P_WHEEL = 'Steering — look where to go'`.
- :23 `stepOpts` add `push: { x: 0, z: 0 }`. In `update` before `stepSailing` :254:
  `stepOpts.push.x = stepOpts.push.z = 0; ctx.getPush?.(state, stepOpts.push);`. Expose `info.motor = Math.hypot(push)`.
- `updateAim` :203-224: after the anchor test, loop `ctx.steerTargets?.() || []` with the anchor-style sphere test at
  `(x, WHEEL_Y, z)`, radius WHEEL_R -> `aimKind = 3, aimIndex = i` if closer.
- `grab` :303: `if (aimKind !== 1 && aimKind !== 3) return false;` and remember `grabKind = aimKind`.
- `steer` :236: release only if `!ctx.isRunning() || (!sails.length && !(ctx.steerTargets?.()?.length))`.
- `updatePrompt` :228: `if (steering) p = grabKind === 3 ? P_WHEEL : P_STEER`; aimKind 3 shows no sailing prompt
  (the engine module's context prompt covers E and R). `interact` :293-299: aimKind 3 returns false (E goes to content).
- `debug` :331 add `push: {...stepOpts.push}`.

## 8. Other files
- `dist/content.js`: import `createEngine` from `./engine.js?build=…` (same build tag), append to `FEATURES` :30; registry
  :48-60 add `sailPush: (s, out) => !!first('sailPush', s, out)` and `steerTargets: () => first('steerTargets')`;
  document both hooks in the header :7-19.
- `dist/game.js` :364-365 `createSailing` ctx add `getPush: (s, o) => { content?.sailPush(s, o); }`,
  `steerTargets: () => content?.steerTargets() ?? null`. `content` exists first (:361). Nothing else: models come through
  `decorModel` :428, actions through `content.action` :813, E through `content.interact` :844 (after `sailing.interact`
  declines for aimKind 3), R through `sailing.grab()` :1176 (falls back to repair when nothing is aimed).
- `dist/sailing-ui.js` `update` :74-81: mode `motor` when `info.motor > .01` and not anchored:
  label `'Motor · 1.2 m/s'`, or `'Sail + motor · 1.8 m/s'` when the sail is also up. `'none'` only if no sail **and** no motor push.
  The compass heading tick is undimmed while `info.motor > .01`.

## 9. Co-op flow
1. Guest presses E on a motor -> `ctx.action({kind:'engine',op:'fuel',x,z,item:'wood'})` -> host `content.action` ->
   `applyEngineAction` with the **guest's** bag (`actorBag`) -> notice to the guest -> next state (~8x/s) carries `ext.engine`.
2. Guest `load(data,'net')` replaces `st`; its `sailPush` now matches the host's, so dead-reckoning agrees. Fuel burn is
   host-only; a guest sees at most ~0.12 s of push after the tank empties (hidden by `smoothDisplay`, far below SNAP2).
3. Wheel steering = existing sail path: guest predicts and sends `{kind:'sail',op:'heading'}` at 6 Hz; last writer wins.
4. Older hosts drop unknown `engine` actions and decor (quiet degrade); new guests on old hosts see no motors.

## 10. Save compat
Old save: `load(undefined)` -> no motors on, no push. `world.sailing` shape unchanged. Old builds drop `motor`/`wheel`
decor in `cleanWorld` :154 and ignore `ext.engine`. The slice stays tiny (64 entries max, well under `EXT_MAX`).

## 11. Tests: `tests/engine.test.mjs` (pure; import pattern of tests/storage-research.test.mjs)
- `cleanEngine`: undefined/array/garbage -> default; bad keys, NaN/negative/huge fuel, non-boolean `on`, >64 entries; getters that throw.
- `engineSpeed`: n 0..6 -> 0, .7, 1.05, 1.26, 1.4, 1.4; size 9 tiles = 1x, 100 tiles = .6x; monotonic, never above 1.4.
- `enginePush`: points along heading (0, PI/2); zero when anchored, all off, or fuel 0; ignores entries without decor; no allocation (same `out`).
- `burn`: only on+fuelled+unanchored motors; clamps dt; returns keys hitting 0; fuel never negative.
- `applyEngineAction`: toggle/all semantics; fuel removes exactly 1 item, adds FUEL value, clamps to cap, refuses
  full/non-fuel/missing item/no motor without touching the bag.
- `stepSailing` (add to tests/sailing.test.mjs): no `push` = old result; push alone converges to |push|; sail + push clamps at
  2.0; anchored ignores push.
- `createEngine` with a fake ctx: `load(x,'net')` then `sailPush` equals host result; serialize round-trips.

## 12. QA screenshots (copy scratchpad shoot.py; steps via `page.evaluate`)
1. `raftDebug.content.engine.place('motor',1,0)`, `place('wheel',0,1)`; screenshot the deck near both (models, prompt).
2. `fuel(1,0,120); set(1,0,true)`; wait 3 s; screenshot: spinning prop, HUD "Motor · 0.7 m/s"; assert
   `raftDebug.sailing.push` length about .7 and `raftDebug.sailing.speed` rising.
3. Aim at the wheel (`raftDebug.camera`/`project`), hold R, turn yaw; assert `raftDebug.sailing.heading` changes; screenshot P_WHEEL prompt.
4. Drop the anchor -> push 0, burn stops. `fuel(1,0,0)` -> prompt "Needs fuel". Reload page -> state restored from save.
5. `npm test` green.

## 13. Build notes (deviations, as built)
- **Propeller placement**: the prop sits behind the housing at deck height (a fan on a short shaft along +z, spinning in
  the x-y plane) instead of hanging below the deck. A prop at model y -.1 would sit inside the floor tile and never be seen.
- **Wheel height**: the ring is at model y .83, so its centre is about 1.05 above the water line with the .22 deck offset.
  This matches `WHEEL_Y 1.05` (raft-local aim in sailing-world.js) and the engine module's `1.05` target centre.
  The wheel ring turns with the shared heading (`rotation.z = -2 * heading`), which is cosmetic only.
- **Texts beyond §4**: `all` with no fuel in any motor says "Needs fuel". A 65th motor entry says "Too many motors". A fuel item
  missing from the bag says "No wood in your bag" (or leaf/plastic). The wheel prompt with no motors is
  `Hold <kbd>R</kbd> to steer · no motors yet`. The bag is never touched on any refusal.
- **cleanEngine** keeps the first 64 valid keys in **sorted** order, so every peer drops the same extras.
- **Anchor aim** in `updateAim` now also records `best = t`, so a wheel behind the anchor post cannot steal the aim.
  Behaviour without wheels is unchanged.
- `onRaftBuilt` keeps a wheel grab alive on a raft with no sail (it used to drop steering whenever `sails.length === 0`).
- **HUD speed** is ground speed, so the 0.3 m/s current adds to it. One motor heading with the current reads about "Motor · 1.0 m/s".
- **Debug** is at `raftDebug.state.sailing.push` / `.motor` / `.grabKind` (the spec's `raftDebug.sailing`) and `raftDebug.content.engine.*`.
- `tests/storage-research.test.mjs` exact learned lists gain `wheel` (wood + rope), because the new recipe joins the research tree.
