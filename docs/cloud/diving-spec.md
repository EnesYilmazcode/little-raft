# Diving lane: shared interface spec (lead-owned)

Friendly lean diving for Little Raft. No damage, no drowning. Three.js r170 at
`dist/vendor/three.module.js`; modules receive `T` (the THREE namespace) as an
argument and never import it, so pure parts stay testable in node.
Import paths inside dist use `./name.js` (game.js appends `?build=...`; new
modules may import siblings as plain `./x.js`).

World facts (from game.js / player-physics.js):
- Camera = eye. `physics.{x,y,z,vx,vy,vz,swimming,grounded}`; feet = y - 1.6.
- Water surface world y = `ocean.getHeight(x, z)` (about -0.24 ± waves).
- Raft tiles: `world.tiles` = [[tx,tz],...], each a 2x2 m square centred at (tx*2, tz*2).
  Deck top `deckY()` ≈ 0.2. Raft underside ≈ deckY - 0.45. Underwater eye must stay
  below `deckY - 0.75` while horizontally inside a tile (+0.3 m margin).
- PlayerPhysics lifts anyone inside a tile footprint below deck onto the deck, so
  while diving the dive controller REPLACES `physics.update` (it writes physics
  x/y/z/vx/vy/vz itself) and hands control back at the surface.
- Player must stay within 50 m of origin (MAX_RAFT_DISTANCE); clamp the same.
- Decorative islands: `islands = [{x, z, r}]`, 12 of them at 65–90 m, r ≈ 5.
- Existing scene: `scene.fog = THREE.Fog('#cbd2c0', 25, 125)`, background same colour;
  ocean ShaderMaterial (fog:false, FrontSide) follows the camera.
- Keys: game.js keeps `keys[e.code]`. Space = jump/swim up. New: `KeyC` = dive down.
  (Do NOT use Ctrl: Ctrl+W closes the tab.) `KeyE` already triggers interact() on
  keydown; hold E = gather underwater.
- New item kinds added to inventory-state.js ITEM_INFO: `sand`, `clay`, `metalore`.

## dist/seafloor.js  (pure helpers + THREE builder)
```js
export const FLOOR = { BASE: -11, MIN_DEPTH_UNDER_RAFT: -7, SHALLOWEST: -0.9, CELL: 4, PATCH: 96, SEGMENTS: 64 };
export function seafloorHeight(x, z, islands = []) // deterministic world y, <= FLOOR.SHALLOWEST
export const NODE_TYPES = ['sand','clay','scrap','metalore']   // gatherable
export const NODE_LOOT = { sand:{sand:1}, clay:{clay:1}, scrap:{scrap:1}, metalore:{metalore:1} }
export function nodeAt(cx, cz, islands = [])  // deterministic for integer cell; null or
   // {id:`${cx},${cz}`, type, x, y, z}  (x/z jittered inside cell, y = seafloorHeight)
export function nodeById(id, islands = [])    // parse id -> nodeAt or null (rejects junk)
export function createSeafloor(T, { islands = [] } = {}) -> {
  group,                 // add to scene; contains floor mesh + instanced rocks/seaweed/nodes
  uniforms,              // { uTime, uCaustic (0..1 strength) } shared caustics uniforms
  update(dt, camera, time),   // recentre patch on CELL-snapped camera xz when it moves; sway seaweed
  heightAt(x, z),        // = seafloorHeight(x, z, islands)
  nodesNear(x, y, z, radius) -> [{id,type,x,y,z}]  (only not-gathered ones)
  setGathered(id, on=true), // hide/show a node (regrow handled by caller)
  dispose()
}
```
Seafloor: sandy colour with vertex-colour variation, darker patches; rises smoothly
to SHALLOWEST near islands (within r+40 m); never above -7 within 9 m of origin.
Caustics: MeshStandardMaterial + onBeforeCompile adds a cheap animated
caustic pattern (world xz, uTime) to emissive, scaled by uCaustic and fading
with depth. Decor: instanced rocks, instanced swaying seaweed (crossed planes,
vertex sway in onBeforeCompile). Nodes: one InstancedMesh per node type with a
readable silhouette/colour (sand = pale mound, clay = orange-brown lump,
scrap = bent grey plates, metalore = dark rock with silvery-blue flecks).
Instance capacity fixed; rebuilt only when the patch recentres. Original art only.

## dist/underwater-fx.js
```js
export function createUnderwaterFx(T, { scene, camera, ocean, seafloor = null }) -> {
  update(dt, { underwater, depth, time, lowOxygen, breath01 }), // depth = metres below surface (>=0)
  render(renderer),   // called right after the main renderer.render(scene, camera); draws overlay
  dispose()
}
```
- On entering: saves scene.fog/background; sets Fog(colour, 0.5, ~34) tinted by depth
  (shallow '#2b8a8f' → deep '#0f4450'). Restores the exact saved values on exit.
- Surface-from-below "ceiling": camera-following plane at the local water height,
  BackSide visible, bright rippling cyan with a brighter Snell window overhead.
- ONE cheap overlay shader: fullscreen triangle (ShaderMaterial, depthTest off,
  own Scene/OrthographicCamera, renderer.autoClear handled) adding a slight
  blue-green tint gradient, soft vignette and faint moving light shafts. Fades in
  over ~0.25 s. No render targets, no post-processing passes.
- Bubbles: one THREE.Points (≤ 120 points) around the camera, rising and resetting;
  burst on entry, extra when lowOxygen.
- Drives `seafloor.uniforms.uTime/uCaustic`.
- Must cost ~nothing above water (everything hidden, render() returns early).

## dist/diving-ui.js
```js
export function createDivingUI(doc = document) -> {
  update({ underwater, oxygen01, gather01, gatherLabel, lowOxygen, rising }),
  dispose()
}
```
Injects its own `<style id="divingStyle">` and DOM. Oxygen bar: bottom-centre just
above the hotbar (bottom ~ 96px), ~220 px wide, bubble icon (inline SVG), only
visible underwater or while refilling (fades out when full above water). Low
oxygen (< 25 %): gentle pulse, never red-alarm. `rising` shows a small caption
"Out of breath, floating up" under the bar. Gather ring: a small circular
progress ring around the crosshair + label ("Hold E · Clay") under it, only when
gatherLabel is set. No mid-screen text banners. Friendly palette matching
existing HUD (cream #fff3cf text, teal #096b82, soft shadows).

## dist/diving.js (controller)
```js
export const DIVE = { SPEED: 2.4, FAST: 3.4, VERTICAL: 2.2, BUOYANCY: 0.15, OXY_SECONDS: 45,
  REFILL_RATE: 4, GATHER_SECONDS: 1.0, REACH: 2.8, EYE_FLOOR_CLEAR: 0.6, RAFT_CLEAR: 0.75,
  SURFACE_EXIT: 0.15, MAX_DISTANCE: 50 };
export class DiveBody { ... }   // pure (no THREE/DOM): step(dt, input, env) -> events
export function stepOxygen(o, dt, underwater) -> {oxygen, empty}   // pure
export function createDiving({ T, scene, camera, ocean, islands, getTiles, getDeckY, onGather }) -> {
  move(dt, physics, input) -> boolean   // true = diving handled movement this frame (skip physics.update)
     // input: {forward, strafe, yaw, pitch, up, down, fast, gather}
  update(dt, time),     // fx + ui + gather progress + regrow; call every frame after camera update
  render(renderer),     // overlay; call right after main render
  audioOut(ctx),        // returns a lowpass BiquadFilter (connected to ctx.destination) to
                        // route sounds through; its cutoff drops to ~600 Hz underwater
  onChange(fn),         // fn({underwater, depth}) on enter/exit; also window 'raft:underwater' event
  markGathered(id),     // hide node, regrow after 120 s
  get state()           // {diving, underwater, depth, oxygen, gather, rising}
  dispose()
}
```
Dive entry: physics.swimming && input.down → controller takes over. Underwater,
forward follows camera look (pitch included, Raft-like), Space up, C down, slight
buoyancy; collide with seafloor (eye ≥ floor+0.6) and raft underside. Exit when
eye ≥ waterY - SURFACE_EXIT, rising, not under a tile → physics.swimming = true,
physics.y = waterY + 0.25, physics.vy = 0.5. Oxygen 0 → `rising`: forced ascent
3 m/s ignoring down input until surfaced, then refills (REFILL_RATE × faster).
Gather: hold E aiming at a node within REACH and a 25° cone → progress; on
completion calls onGather(id) (game.js routes it as action {kind:'gather', id}).

## game.js hooks (lead does these)
import + create in init; movePlayer: `if (diving?.move(...)) skip physics.update`;
frame: `diving.update` after updateCamera, `diving.render(renderer)` after render;
applyAction 'gather' (host validates with nodeById + distance + NODE_LOOT);
beep() routes through `diving.audioOut(audio)`; dispose; raftDebug.state.dive.
