# Spec: Receiver, antennas and signal navigation

Source: docs/features/receiver-navigation-research.md. One builder-day. Cozy: no power, no timers, cache never sinks. New files: `dist/signal.js` (pure), `dist/signal-models.js` (THREE meshes), `tests/signal.test.mjs`. Small hooks only in game.js / inventory-state.js / survival-ui.js / icons.svg. Import new modules with `?build=v3-survival-ae77fa84ac2b`.

## 1. Player flow
1. Craft a **Receiver** and place it on any empty tile (1 per raft). HUD pill appears: `SIGNAL · listening…`.
2. 20 s later a **signal cache** (orange buoy with flag) spawns 45–75 u away; toast "A signal! Something is drifting your way".
3. The pill shows arrow + compass point + distance; the cache drifts toward the raft and stops ~6 u off the deck edge.
4. When it gets close: toast "The signal cache is close: hook it in!". Hook it like any debris -> big haul, toast to both players.
5. Cooldown (90–150 s, "listening…"), then the next cache. Up to 3 **Antennas** placed ≥2 tiles from the receiver sharpen it.

## 2. Items and recipes (dist/inventory-state.js)
- `ITEM_INFO.receiver = {kind:'receiver', name:'Receiver', icon:'icon-compass', maxStack:STACK_SIZE, tool:false, placeholder:true}`
- `ITEM_INFO.antenna = {kind:'antenna', name:'Antenna', icon:'icon-antenna', maxStack:STACK_SIZE, tool:false, placeholder:false}`
- `RECIPES.receiver = recipe('receiver','Receiver',1,{wood:3, scrap:4, plastic:3, rope:2})`
- `RECIPES.antenna = recipe('antenna','Antenna',1,{wood:2, scrap:1, rope:1})`. Append after `crate`. `cache` is NOT a bag item.

## 3. game.js constants
- `DECOR_TYPES` += `'receiver','antenna'`; `BLOCK_RADIUS` += `receiver:.35, antenna:.1`.
- `ITEM_TYPES` += `'cache'` (so cleanWorld keeps it in `items`); `ITEM_NAMES.cache = 'signal cache'`.
- `LOOT.cache = {wood:6, plastic:4, scrap:3, rope:2}` (base; bonus comes from `cacheLoot`). **Not** added to SPAWN_TABLE.

## 4. Placement rules (applyAction `build`, decor branch)
- Before consuming: `if (a.recipe === 'receiver' && world.decor.some(d => d.type === 'receiver'))` -> emit notice
  "Your raft already has a receiver" to actor, return (bag untouched). Ghost may still show; that's fine.
- Antennas: no placement cap. Build toast for antennas: `Antenna placed · signal ${n}/3` where `n = countAntennas(world.decor)`;
  if it does not count: `Antenna placed (put it 2+ tiles from the receiver)`, or plain `Antenna placed` when already at 3.

## 5. `world.signal` shape and validation
`world.signal = null | {cooldown:number, cache:null | {id:int, token:string, x:number, z:number, phase:number, near:boolean}}`
- `null` = no receiver yet. `cache` is the source of truth for the buoy (it survives save; the `items` mirror does not).
- `cleanSignal(v)`: non-object -> `null`. `cooldown` finite -> clamp [0, 600], else 0. `cache` kept only if `isInt(id)`,
  token string length 1..79, x/z finite with `|x|,|z| < 80`; `phase` finite else 0; `near = !!near`. Bad cache -> `cache:null`.
  Always returns a **new** object (deep copy).

## 6. dist/signal.js (pure: no DOM, no THREE, no Date/performance; randomness only via injected `rng`)
```js
export const CACHE_ID = 9000, FIRST_DELAY = 20, MAX_ANTENNAS = 3, NEAR_GAP = 22, STOP_GAP = 6, LIMIT = 78;
export const TIERS = [ // index = antenna count
  {range:45, wobble:25, step:0,  marker:'never', speed:.30, cooldown:150},
  {range:60, wobble:10, step:10, marker:'near',  speed:.35, cooldown:150},   // 'near' = distance < 40
  {range:70, wobble:0,  step:5,  marker:'always',speed:.40, cooldown:120},
  {range:75, wobble:0,  step:1,  marker:'always',speed:.45, cooldown:90, beam:true}];
export function cleanSignal(v)                      // §5
export function countAntennas(decor)                // 0..3: first receiver R; antennas with max(|dx|,|dz|) >= 2, capped at 3; no R -> 0
export function raftCentre(tiles)                   // {x, z, r}: mean of tile*2; r = max hypot(tile*2 - centre) + 1
export function signalTick(world, dt, {rng = Math.random, token, held = new Set()} = {}) // -> events [{kind:'detected'|'near'}]
export function onCacheCollected(world)             // world.signal = {cooldown: TIERS[n].cooldown, cache:null}; drops 'cache' items
export function cacheLoot(antennas, rng)            // {wood:6,plastic:4,scrap:3,rope:2}; antennas>=3 && rng()<.25 -> add rng()<.5 ? {fish:1} : {leaf:2}
export function signalReadout(signal, me, antennas, elapsed) // -> null | readout (below)
export function edgePoint(sx, sy, inFront, w, h, margin = 24) // -> {x, y, edge:boolean}
```
`signalTick` (mutates only `world.signal` and `world.items`; `dt` non-finite or <0 -> 0; `token` defaults to `() => 'sig-' + rng().toString(36).slice(2)`):
1. `hasR` = decor has a receiver. If `!hasR && !world.signal?.cache` -> `world.signal = null`, return `[]`.
2. If `world.signal == null` -> `{cooldown:FIRST_DELAY, cache:null}`.
3. Remove items with `type==='cache'` whose token ≠ `signal.cache?.token` (stale mirrors).
4. No cache: if `hasR`, `cooldown = max(0, cooldown - dt)`; at 0 spawn: `a = rng()*2π`, `d = TIERS[n].range`,
   `x = clamp(C.x + sin(a)*d, ±LIMIT)`, `z = clamp(C.z + cos(a)*d, ±LIMIT)`, `phase = rng()*6`, `near:false`,
   `id:CACHE_ID`, `token:token()`; push event `detected`.
5. Cache present: ensure mirror item `{id, token, type:'cache', x, z, phase}` exists in `world.items` (push if missing — this
   is how load/hot-swap restore it). If `!held.has(token)`: `dist = hypot(C - cache)`; if `dist > C.r + STOP_GAP` move toward C
   by `min(speed*dt, dist - (C.r + STOP_GAP))`. Copy x/z to the mirror item. If `!near && dist <= C.r + NEAR_GAP` -> `near = true`,
   event `near`. (A receiver removed mid-drift: the cache keeps coming; afterwards signal becomes null.)
`signalReadout`: `null` if `!signal`. No cache -> `{listening:true, label:'SIGNAL · listening…'}`. Else with
`dx = cache.x - me.x, dz = cache.z - me.z, dist = hypot`, `wob = TIERS[n].wobble * sin(elapsed*.9 + cache.phase)` (degrees):
- `heading = (deg(atan2(dx, -dz)) + wob + 360) % 360` (0 = −z "N", 90 = +x "E"); `point` = 8-way `N NE E SE S SW W NW`.
- `arrow` (CSS deg, clockwise, 0 = straight ahead) `= wrap180(deg(atan2(dx, -dz)) + wob + deg(me.yaw))` (camera forward is
  (−sin yaw, −cos yaw), i.e. heading −yaw).
- `distText`: step 0 -> `dist > 30 ? 'far' : 'near'`; else `Math.round(dist/step)*step + ' m'`.
- `marker = marker==='always' || (marker==='near' && dist < 40)`; `beam = !!TIERS[n].beam`.
- returns `{listening:false, heading, point, arrow, distance:dist, distText, marker, beam, antennas:n, label:`SIGNAL ${point} · ${distText}`}`.
`edgePoint`: if `inFront` and inside `[margin, w-margin]×[margin, h-margin]` -> as-is, `edge:false`. Else vector
`v = (sx - w/2, sy - h/2)`, negate if `!inFront` (zero vector -> `(0, 1)`), scale so it touches the inset rect, `edge:true`.

## 7. Host tick and actions (game.js)
- frame(), inside `if (running && role !== 'guest')` before the nets block:
  `for (const e of signalTick(world, dt, {token:newToken, held:new Set(caughtList(castOut()).map(c => c.token))}))`
  `emit({kind:'signal', text: e.kind==='detected' ? 'A signal! Something is drifting your way' : 'The signal cache is close: hook it in!'}, 'all');`
  then `syncItems()` if any cache item was added/removed (simplest: when `world.items.length` changed or events non-empty).
- effect(): `kind==='signal'` -> `beep(760)`. updateItems host loop: first line in the loop `if (it.type === 'cache') continue;` (no +z drift, no respawn).
- Nets loop `find`: add `it.type !== 'cache' &&`. In `collect`: `if (it.type === 'cache' && a.net) return;`.
- `collect`: `loot = it.type === 'cache' ? cacheLoot(countAntennas(world.decor), Math.random) : LOOT[it.type]`. On success for a cache:
  splice, **no** `makeItem` push, `onCacheCollected(world)`, `syncItems()`; emit loot text `Signal cache! + …` to actor (also for
  hook catches) and `{kind:'build', text:'Signal cache recovered!'}` to the other side (`actor==='host' ? 'guest' : 'host'`). Bag full: existing path.

## 8. World plumbing
- `newWorld()`: `signal:null`. `cleanWorld()`: return `signal: cleanSignal(v.signal)` (saves and host state). `copyWorld()`: `signal: cleanSignal(w.signal)`. `hostState().world`: add `signal:world.signal`.
- `save()` already spreads `world` (signal persists, `items:[]`); load -> cleanWorld keeps signal -> first host tick re-inserts the
  mirror item. capture()/mount: `liveWorld` keeps it. No other save change.

## 9. Models (dist/signal-models.js) — `export function createSignalModel(T, type)` -> Group | null
Own `MeshStandardMaterial`s (roughness .8; disposeGeometry frees them), castShadow on meshes. Origin = deck/water level.
- **receiver**: wood box .7×.35×.5 `#8c6745` at y .175; screen box .5×.22×.02 `#1f4a52` (emissive `#2f8f86`, .4) at (0,.2,.26);
  knob sphere r .04 `#ffbd66` at (.27,.2,.26); mast cylinder r .02 h .6 `#c0c6c8` at (-.3,.65,-.2); solar fin box .4×.02×.25
  `#2e5f8a` at (.1,.42,-.05), rotation.x −.5.
- **antenna**: base box .3×.08×.3 `#906f48` y .04; pole cylinder r .035/.05 h 2.2 `#906f48` y 1.1; crossbars box w×.03×.03
  `#c0c6c8` at y 1.7/1.9/2.1 with w .6/.45/.3; tip sphere r .06 `#ff8a5c` emissive .6 at y 2.25.
- **cache**: buoy cylinder r .45/.38 h .5 `#f2a33a` y .1; band cylinder r .46 h .1 `#fff3cf` y .15; cone r .2 h .3 `#e0523f` y .5;
  flag pole cylinder r .02 h 1 `#725942` y 1; flag plane .35×.22 `#e0523f` DoubleSide at (.18,1.35,0);
  beam: open cylinder r .12 h 8 `MeshBasicMaterial #fff0b0, transparent, opacity .25, depthWrite:false` y 4.5, `visible=false`,
  `g.userData.beam = beam`.
- rebuildRaft: `detailed = createCraft(T, d.type) ?? createSignalModel(T, d.type)` (inside existing try).
- itemModel: first line `if (item.type === 'cache') return createSignalModel(T, 'cache');`.

## 10. HUD (game.js HUD_CSS + prepareDom, stable nodes like #contextPrompt)
- prepareDom creates (if missing) `<div id="signalReadout" role="status" hidden>` and `<div id="signalMarker" hidden>` on body.
- CSS: `#signalReadout{position:fixed;top:14px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;
  background:rgba(8,22,36,.55);color:#f6ecd6;font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.05em;
  pointer-events:none;z-index:30;white-space:nowrap}` `#signalReadout .sig-arrow{display:inline-block;margin-right:6px}`
  `#signalMarker{position:fixed;left:0;top:0;width:14px;height:14px;margin:-9px 0 0 -9px;border-radius:50%;background:#ffbd66;
  border:2px solid #fff3cf;box-shadow:0 0 8px rgba(255,189,102,.7);pointer-events:none;z-index:29}` `#signalMarker.edge{opacity:.7}`
  `#signalReadout[hidden],#signalMarker[hidden]{display:none}`.
- `updateSignalHud()` called in frame() after updateContext: `n = countAntennas(world.decor)`, `r = signalReadout(world.signal,
  {x:physics.x, z:physics.z, yaw}, n, elapsed)`; keep `lastReadout = r`. Readout visible iff `running && r`; innerHTML
  `<span class="sig-arrow" style="transform:rotate(${Math.round(r.arrow)}deg)">▲</span>` + esc(label), only written when the
  string changes (cache like contextCache). Marker visible iff `running && r?.marker && !uiBlocked()`: project the cache mesh
  position (fallback cache x, ITEM_FLOAT+.6, z) — extend `project()` to also return `inFront` (additive) — then `edgePoint(...,
  innerWidth, innerHeight)`; `style.transform = translate(Xpx,Ypx)`; toggle `.edge`. Cache mesh `userData.beam.visible = !!r?.beam`.
  dispose(): set both nodes `hidden = true`.

## 11. Icons (dist/icons.svg + survival-ui.js)
- Receiver borrows `icon-compass` (already drawn). Add `<symbol id="icon-antenna" viewBox="0 0 48 48">`: brown pole
  `M24 42 V12` stroke `#906f48` w3, three grey bars `#c0c6c8` (y 14/20/26, half-widths 6/9/12), orange tip circle r3 `#ffbd66` at
  (24,10), outline `#153e49` like neighbours. Add `'antenna'` to `SPRITES` in survival-ui.js and `antenna:'antenna',
  receiver:'compass'` to `SPRITE_FOR`.

## 12. raftDebug (read-only)
`state.signal = world.signal ? cleanSignal(world.signal) : null`, `state.antennas = countAntennas(world.decor)`,
`state.signalReadout = lastReadout ? {...lastReadout} : null`. `targets` already lists the cache (type 'cache').

## 13. tests/signal.test.mjs (node:test, import via the `base` pattern of survival.test.mjs; seeded rng `mulberry32`)
1. cleanSignal: null/garbage -> null; clamps cooldown; drops bad cache (token too long, |x|≥80, non-int id); returns a copy.
2. countAntennas: no receiver 0; adjacent antenna 0; diagonal 2 tiles counts; 5 spread antennas -> 3.
3. signalTick: no receiver & no signal -> null, []; receiver -> cooldown 20; after 20 s total `detected` once, one cache item,
   distance from centre == TIERS[n].range (or clamped ≤ 78); same seed -> identical position.
4. Drift: speed per tier; stops at `r + 6`, never inside; `near` emitted exactly once; held token -> no movement.
5. Mirror restore: world.items = [] with signal.cache -> item re-added with same token; stale cache item removed.
6. onCacheCollected: cooldown matches tier (0/1:150, 2:120, 3:90), cache null, no cache items left; next spawn after cooldown.
7. cacheLoot: base for <3 antennas regardless of rng; with 3 and rng→.1 adds bonus; rng→.9 none.
8. signalReadout: target at −z yaw 0 -> point N, arrow 0; +x -> E, arrow 90; yaw π/2 and target −x -> arrow 0; distText per tier
   (far/near, 10, 5, 1); marker rules; wobble 0 for n≥2; listening when no cache.
9. edgePoint: on-screen passthrough; off right clamps to x = w−margin; behind camera flips side.
10. Receiver removed mid-drift: cache keeps drifting; after collect, signal becomes null.

## 14. Backward compatibility and known limitations
- Old saves: no `signal` -> null; nothing changes until a receiver is placed. New fields optional everywhere.
- New guest + old host: signal missing -> no readout. Old guest + new host: drops `signal`, cache item, receiver/antenna decor
  (safe, invisible). **Known limitation (accepted, no Bag redesign):** if an old-build guest's bag snapshot contains
  receiver/antenna, its `snapBag` throws on the unknown kind and the guest bag cannot sync; both players must run the same build.
- Downgrade (old build, new save) drops receiver/antenna decor and resets a bag holding them. Mention in patch notes.

## Implementation notes
- `signalTick` returns right after a spawn (event `detected`, mirror item pushed, no drift in that tick), so the spawn
  distance equals `TIERS[n].range` exactly (or the ±78 clamp). Drift starts on the next tick.
- `near` is checked against the distance *after* this tick's move. A held cache (hook) still gets the `near` check.
- The `!hasR && !cache` early return also removes any stray `cache` items (keeps §3 "stale mirrors" true on the idle path).
- The spawn token is capped to 79 chars so it always passes `cleanSignal` / `cleanWorld`.
- The cache beam mesh has `raycast = () => {}` so the invisible 8 u beam never becomes an aim/pickup target.
- The listening pill shows a neutral `◌` glyph (unrotated) in the `.sig-arrow` slot instead of `▲`, since there is no bearing yet.
- HUD visibility is reconciled every frame against `el.hidden` (only the innerHTML is string-cached), so a hot-swap where
  the old engine's `dispose()` hides the nodes after the new mount has drawn cannot leave the pill hidden.
- Antenna toast: "counts" is decided by comparing `countAntennas` before/after the push; with no receiver on the raft the
  "(put it 2+ tiles from the receiver)" hint is shown.
- cleanWorld item-type check was already extended by the logbook lane (`|| it.type === 'bottle'`); `'cache'` is in ITEM_TYPES, compatible.
