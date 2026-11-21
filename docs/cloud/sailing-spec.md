# Sailing lane — design spec / API contract

Lane: sailing and raft movement. All code lives in NEW files; game.js / ocean.js get tiny commented hooks.

## Model ("the world moves, the raft stays at the origin")

The raft group never translates in x/z (player physics, tiles, placement all assume tile (x,z) is at world (2x, 2z)).
Instead the raft has a *virtual* velocity and everything else moves relative to it.

- Wind: `windDir` (radians, compass angle; direction the wind blows TOWARD, vector `(sin a, cos a)` in world x/z),
  `windStr` in 0.55..1 (visual only). The wind never changes (Raft-like, `WIND_SWING = 0`); `windTarget`,
  `windStrTarget`, `windClock` are legacy keys kept for old saves (cleanSailing copies windDir/windStr into them).
- Current: `DRIFT_SPEED = 0.30` m/s along `windDir`: an unsailed raft drifts downwind.
  Floating debris (and a floating hook) drift past the raft at 0.22 m/s along the current too, so they arrive from
  upwind (`sailing.debrisBase(o)`, used by game.js in place of its old fixed +z drift).
- Sail: shared state for all placed `sail` decor: `raised` (bool), `heading` (radians; cloth normal points to
  `(sin h, cos h)`; the raft is pushed along that direction).
- Sail (seabed ground-velocity target) when raised, not anchored, nSails >= 1:
  `off = clamp(heading - windDir, -90 deg, +90 deg)` (no upwind sailing: the best is sideways),
  `G = dir(windDir + off) * DRIFT_SPEED * 1.5 * (0.5 + 0.5 * cos(off))`: 0.45 m/s downwind, 0.225 m/s abeam, continuous. Extra sails do not stack (`sailFactor(n) = 1`). The water-relative
  target is `G - CURRENT`. Motors (engine.js) give a ground target that ignores the wind; the faster of sail and
  motor wins (no stacking), capped at TARGET_CAP.
  The water-relative velocity `vx, vz` eases toward the target with time-constant ~3.5 s (raft inertia).
- Anchor: `anchored` (bool). When anchored the target S is 0 and the raft is fixed to the seabed.
- Paddle (lean): `paddle(dirAngle)` adds an impulse of 0.6 m/s along dirAngle to vx/vz (clamped total |v| ≤ 2.6),
  max once per 0.6 s per player; ignored when anchored.
- Two accumulated offsets (both in metres, float64):
  - `wx, wz` — raft travel relative to the WATER. Advances by `(vx, vz)` when free, by `-CURRENT` when anchored.
    Used for ocean waves (`ocean.uniforms.uFlow`) and for extra debris/swimmer drift.
  - `gx, gz` — raft travel relative to the SEABED (islands). Advances by `(vx, vz) + CURRENT` when free, 0 when anchored.
- Relative flow applied to floating debris on top of its existing baseline drift: `-(dwx, dwz)/dt`
  (i.e. subtract the water-relative raft velocity). Swimming players get the same shift.
- Islands/scenery "drifters" sit at a base position `b`; displayed at `wrap(b - g)` with each axis wrapped into
  [-WRAP, WRAP), WRAP = 130 (past fog far 125). Islands with radius r block the raft: if the raft would get within
  `r + 2.5 + raftRadius` of an island centre, the velocity component toward it is removed ("runs aground").
- Raft heading for UI = direction of total seabed velocity `(vx + Cx, vz + Cz)` when free.

## State object `world.sailing` (saved, synced inside hostState().world)

```js
{ v:1, windDir, windStr, windTarget, windClock, heading, raised, anchored, vx, vz, wx, wz, gx, gz }
```
All numbers finite; `cleanSailing(v)` returns a fresh validated copy or the defaults (`raised:false`,
`anchored:false`, heading 0, wind 0.6 rad, windStr .8, zeros). Old saves without `sailing` → defaults.
Offsets are wrapped modulo 100000 to bound float precision.

## Files

### dist/sailing-core.js — pure, no THREE, no DOM (unit tested in tests/sailing.test.mjs)
```js
export const SAIL = Object.freeze({...constants});
export function defaultSailing()
export function cleanSailing(v)            // validator / migrator, never throws
export function sailFactor(n)
export function sailTarget(state, nSails, out)        // writes {x,z} target water-relative velocity into out
export function stepSailing(state, dt, {nSails, host, rng, blockers}) // mutates state; host=false skips wind wander
     // blockers: optional array of {x,z,r} island positions RELATIVE to raft (for grounding)
     // returns nothing; writes state.lastDx/lastDz? -> NO: use stepSailing(..., out) where out = {dwx,dwz} water delta this step
export function applySailAction(state, a)  // a = {kind:'sail', op:'raise'|'lower'|'toggle'|'anchor'|'unanchor'|'toggleAnchor'|'heading'|'paddle', heading?, angle?}
                                            // validates; returns short text for a notice or ''
export function wrapAxis(v, W)
export function placeUpstream(it, fx, fz)  // rotate a freshly spawned item (spawned upstream of +z flow) so it is upstream of flow (fx,fz)
export function driftedOut(it, fx, fz, R)  // true if item is farther than R from origin and moving away along flow
export function windVector(state, out)
```
No per-call allocation in stepSailing / sailTarget / driftedOut (write into caller `out`).

### dist/sailing-world.js — THREE side
```js
export function createSailing(T, ctx) -> api
ctx = { scene, raft, ocean, camera, getWorld:()=>world, getRole:()=>role, getPhysics:()=>physics,
        action:(a)=>bool /* routes to host */, notice:(text)=>void, canInput:()=>bool, signal /* AbortSignal */ }
api = {
  update(dt, elapsed)   // per frame: steps state (host/solo authoritative; guest dead-reckons), writes ocean uFlow,
                        // moves drifters, carries swimmer, animates sail heading/furl, flags, anchor rope, prompt
  onRaftBuilt()         // after rebuildRaft(): find sail decor groups in raft.children (match world.decor sails by position)
  addDrifter(obj, radius = 0)  // scenery that moves with the seabed offset; radius>0 grounds the raft
  itemFlow(out)         // {x,z} extra m/s to add to every free-floating debris item this frame
  respawned(it)         // call after Object.assign(it, makeItem(id)) to move the spawn upstream of the current flow
  outOfRange(it)        // extra despawn test for flows that are not +z
  interact()            // E pressed: if aiming at sail (toggle raised) or anchor (toggle) → action, return true
  grab()                // R pressed: if aiming at a sail, start steering (sail heading follows camera yaw+PI) → true
  release()             // R released / blur
  apply(a, actor)       // host side of a {kind:'sail'} action
  debug()               // plain snapshot for raftDebug.state.sailing
  dispose()
}
```
Own 3D: a stationary anchor post + coiled rope fixture at the raft's rear-left corner tile (it is in a sailing-owned
group that copies raft position/rotation each frame, NOT a raft child, because rebuildRaft disposes raft children).
A small pennant (wind ribbon) at the top of each sail mast showing the wind direction. All geometry/materials
created once and cached. Sail furl: when lowered the sail cloth meshes (names starting `sail` that are not
`sailTimber`/`sailRope`, or the fallback plane) scale.y → 0.12 toward their top edge; smooth.

### dist/sailing-ui.js — DOM HUD
```js
export function createSailingUI({signal}) -> { update(info), setPrompt(text|null), dispose() }
info = { yaw, windDir, windStr, heading, raised, anchored, speed, travelDir, nSails, running }
```
Small compass badge top-right-ish (below header area), rotates with camera yaw: wind arrow, sail heading tick,
speed text, "Anchored"/"Sail up"/"Drifting". Writes DOM only when quantized values change. Injects its own
`<style id="sailing-ui-style">`. Prompt line `#sailPrompt` at `top: calc(50% + 54px)` centred.

## Hooks into existing files (keep each to one or two lines, marked `// [sailing]`)
game.js: import; create in init(); scenery register; rebuildRaft end; cleanWorld/copyWorld keep `sailing`;
updateItems flow + respawn; frame update; interact(); KeyR keydown/keyup; applyAction; hostState; debug; dispose.
ocean.js: `uFlow` uniform added to wave phase in both shaders + CPU getHeight.
