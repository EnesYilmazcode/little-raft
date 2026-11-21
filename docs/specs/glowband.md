# Spec: the Glowband (hands-free headlamp)

Source: docs/features/headlamp-research.md. Cozy rules hold: no battery, no durability, never breaks, never drains. It works while it is in your bag (no equip slot), like diving gear.
Hard rule: **no scene light is ever added, removed or made invisible because of the Glowband.** It borrows a daynight pool PointLight that is already in the scene, so the lit-shader program keys never change.
Line numbers refer to the current tree.

## 1. Ids and files
New kind `glowband` ("Glowband"), recipe `glowband`, icon `icon-glowband`. New input action `headlamp`. New pose flag bit `32` (`LAMP_FLAG`). localStorage key `little-raft-glowband`.
Module name `glowband` (content registry). No world fields, no `world.ext` slice, no new action kinds, no HELD entry, no new npm deps.

| File | Change |
|---|---|
| dist/glowband.js | new: pure helpers + `createGlowband(ctx)` content module (sections 3-4) |
| dist/glowband-model.js | new: `glowbandParts(T, glowMat)` for the remote avatar (section 6) |
| dist/content-items.js | item after `scraper` (53), recipe after `scraper` (126) |
| dist/content.js | import; `FEATURES` (94): insert `createGlowband` **immediately before** `createDayNight`; registry method `glowLit()` next to `diveMods` (172) |
| dist/daynight.js | `createDayNight(ctx, peer = null)` (307); lamp slot in the pool loop (663-673); `state().lampLit` (775) (section 5) |
| dist/input-map.js | `ACTIONS` after `pause` (27): `{ id: 'headlamp', label: 'Glowband lamp', group: 'Actions', kind: 'button' }`; `DEFAULT_BINDINGS` after `pause` (52): `headlamp: b(['KeyF'], ['Pad13'])` |
| dist/controls.js | `onAction` (41-42): `else if (id === 'headlamp') emit('little-raft-action', {id});` |
| dist/game.js | 1969: legacy fallback `if (!controls && e.code === 'KeyF' && !e.repeat) dispatchEvent(new CustomEvent('little-raft-action', {detail:{id:'headlamp'}}));`; 2193 `local()` gains `lamp:!!content?.glowLit?.(),` |
| dist/coop.js | `LAMP_FLAG = 32`; `poseFlags` (31) `\| (l.lamp ? 32 : 0)`; `onPose` (142) adds `lamp:!!(f & LAMP_FLAG)` to the buffered pose; `renderRemote` (179) passes `lamp:L.lamp`. `readFlags` stays unchanged (zipline/sitting tests deep-equal its shape) |
| dist/coop-avatar.js | mount lamp parts on `P.head` after each bake (29, 308); `update` reads `s.lamp`; dispose (section 6) |
| dist/survival-ui.js | `SPRITES` (25) + `'glowband'` |
| dist/icons.svg | `<symbol id="icon-glowband" viewBox="0 0 48 48">` after `icon-scraper` (668): original art, a rope headband loop seen at 3/4 with a round seaglass bulb at the front and three short warm rays |
| dist/craft-book.js | category (49) `glowband:'tools'`; desc (191) `glowband: { desc: 'A rope headband with a little seaglass bulb.', use: 'Works from your bag: press F to light the spot you look at. Charged by sunshine, glows all night.' }` |
| tests/glowband.test.mjs | new (section 9) |

**Key check (done):** `KeyF` is bound nowhere (grep of dist/*.js: taken are A C D E G I J L N P Q R S W X Z, Tab, Space, Digits, Shift, Escape). `Pad13` (D-pad Down) appears only in input-map.js's name table; Pad12 is `buildMenu`. `new ActionMap().conflicts()` must stay `[]`.

## 2. Item, recipe, gating (dist/content-items.js)
- Item: `glowband: Object.freeze({ kind: 'glowband', name: 'Glowband', icon: 'icon-glowband', maxStack: 1, tool: false, placeholder: false })` (same shape as goggles, 52).
- Recipe: `glowband: recipe('glowband', 'Glowband', 1, { glass: 1, copperingot: 1, rope: 2 })`. Cheaper than Binoculars (items.js:183-184) and String Lights `{glass 2, copperingot 1, rope 2}` (items.js:268).
- No `STARTER` edit: it unlocks through `learnedFrom` once glass, copperingot and rope are studied, the same tier as Binoculars. A bag with two Glowbands is fine: ownership is `count > 0`.

## 3. Pure helpers: dist/glowband.js (exports, no DOM at import, no allocations per call)
```js
export const LAMP_KEY = 'little-raft-glowband';
export const LAMP_COLOR = '#fff1d6', LAMP_PEAK = 2.2, LAMP_RANGE = 3.5;   // POOL_PEAK 2.8 / POOL_RANGE 4.5 for lanterns
export const AIM_MIN = 1.5, AIM_MAX = 4, AIM_DEFAULT = 3, UW_DIST = 3;   // metres along the view ray
export const PULL_BACK = 0.35, LIFT = 0.3;                              // off the surface: back toward the eye, then up (raft-local)
export const SMOOTH_TAU = 0.08, SNAP_D = 1.5, EASE_S = 0.15;            // hit-point smoothing, snap jump, on/off ease
export const NIGHT_A = 0.15, NIGHT_B = 1, UW_A = 1.5, UW_B = 4;          // night gate (same edges as daynight poolI, 597); underwater depth gate
export const UW_FOG = 1.25;                                             // dive-mods fog multiplier while lit underwater
export const YIELD_R = 2.5;                                             // 'low' only: lamp yields if a lit lantern is this close to its spot
export function readPref(store)           // '0' -> false; anything else, missing or throwing -> true (default on once owned)
export function writePref(store, on)      // store.setItem(LAMP_KEY, on ? '1' : '0') in try/catch; never throws
export function aimDistance(eye, point, underwater)  // underwater -> UW_DIST; no point -> AIM_DEFAULT; else clamp(|point-eye|, AIM_MIN, AIM_MAX)
export function lampTarget(eye, dir, dist, out)      // out = eye + dir*(dist - PULL_BACK); dir assumed unit; returns out
export function lampGain(nf, underwater, depth)      // max(smooth(NIGHT_A,NIGHT_B,nf), underwater ? smooth(UW_A,UW_B,depth) : 0); NaN -> 0
export function smoothStep(cur, target, dt)          // in place: |target-cur| > SNAP_D -> copy; else cur += (target-cur)*(1-exp(-dt/SMOOTH_TAU))
```
`smooth(a,b,v)` is the same smoothstep as daynight.js:21. `eye/point/dir/out/cur/target` are `{x,y,z}` (THREE.Vector3 in the module, plain objects in tests).

## 4. Module: createGlowband(ctx) (content module `glowband`)
- **State.** `owned` (bool), `on` = `readPref(localStorage)` once at create (guarded `typeof localStorage`), `ease` 0..1, `wasLit`, scratch vectors, and the public object
  `lamp = {owned:false, on:false, gain:0, x:0, y:0, z:0}` (one object, mutated in place; x/y/z are **raft-local**). `link(env)` keeps `env` for `env.night()`.
- **Ownership every frame**, not on a 0.25 s poll: `owned = (ctx.localBag?.()?.count('glowband') ?? 0) > 0` (bag count is a slot scan; try/catch → false). This is what makes the warm-up work (section 5).
- **Toggle.** `window` listener for `little-raft-action` with `detail.id === 'headlamp'`: ignore unless `ctx.running && !ctx.uiOpen()`. Not owned → `ctx.notice('Craft a Glowband to use the lamp', 1600)`.
  Owned → `on = !on`, `writePref`, `ctx.play('ui', .5)`, `ctx.notice(on ? 'Glowband on' : 'Glowband off', 1200)`. Removed in `dispose`.
- **update(dt).** `ease` moves toward `(owned && on) ? 1 : 0` at `dt / EASE_S`. Underwater = camera below `ocean.getHeight(cam.x, cam.z) - 0.05` (daynight.js:629 test); `depth` = that height minus `cam.y`.
  `lamp.gain = ease * lampGain(env?.night() ?? 0, uw, depth)`. If `gain > 0` and `ctx.raft`: `eye = camera.position`; `dir` = unit `(aim.point - eye)` when `ctx.aim()?.point` exists and not underwater, else `camera.getWorldDirection`;
  `lampTarget(eye, dir, aimDistance(eye, point, uw), tw)`; `ctx.raft.worldToLocal(tw)`; `tw.y += LIFT`; then if `!wasLit` copy, else `smoothStep(lampLocal, tw, dt)`. `wasLit = gain > 0`. Write `lamp.owned/on/gain/x/y/z`.
- **Smoothing on a tilting deck (decision).** `ctx.aim().point` is a ray hit on the flat deck-height plane (game.js pickNdc, `plane.constant = -deckY()`), so it moves with every wave bob and tilt.
  Smoothing runs in **raft-local space** and daynight converts back with `raft.localToWorld` every frame (5). The raft's own roll, pitch and bob therefore carry the pool exactly with zero lag, the 80 ms damping only
  removes view and plane-hit jitter, and `LIFT` is "up" in deck space so the light never sinks into a tilted plank. Off the raft (island, swimming) the raft-local frame still works: drift lag is at most raft speed × 80 ms (< 0.2 m in a 3.5 m soft pool).
  Looking up at the sky (no plane hit) falls back to `AIM_DEFAULT` along the view; a jump of more than `SNAP_D` snaps instead of sliding across the deck.
- **diveMods(m).** `if (lamp.gain > 0 && underwater) m.fog *= UW_FOG` (stacks with goggles, diving-gear-core.js:25-34). By day near the surface the gain is 0, so no bonus there; the night or depth gate gives both light and fog.
- **debug** (`raftDebug.content.glowband`): `give()` (host only, like diving-gear.js:67: adds 1, returns added), `toggle()`, `set(on)`, `state()` → `{owned, on, gain, x, y, z, underwater}`.
- **dispose.** Remove the listener and set `lamp.gain = 0`. There is nothing to remove from the scene.

## 5. daynight.js: the borrowed pool light
- **Lookup.** `createDayNight(ctx, peer = null)`. `lampSrc()` caches `peer?.('glowband')` and re-resolves when it is null or `.dead`, on the 0.5 s rank tick only. It returns `mod.lamp` or null. Existing tests call `createDayNight(ctx)` and keep passing.
- **Forced into the scene (decision).** Before `sizePool()` (663): `if (!poolWanted && lamp?.owned) poolWanted = true;`. Owning a Glowband turns the pool on exactly like the first lantern (487), whether the lamp is on or off, by day or night.
  Then the light count changes only with the graphics preset, as before. Toggling, day/night and going underwater only change `intensity`, `position`, `color` and `distance`, which are all uniforms.
- **Warmed before first use (decision).** Glowband sits before daynight in `FEATURES` and reads ownership every frame. So in the frame the item enters the bag (craft, pickup, load), glowband sees `owned`, daynight attaches the pool in the same `content.update` (game.js:1832),
  and `warmKinds()` (game.js:1854, later in that frame) sees the new kind `glowband` and runs `compileAsync(scene, camera)` with the pool lights already attached. On a save load, the first frame's `warmKinds` covers every bag kind after the attach (the earlier `warmShaders`, game.js:2560, ran before it).
  No extra compile call is added. Pin it in a test (9.4): own → pool attached in the same `update`, before any toggle.
- **Slot rule.** `lampWins = lamp && lamp.gain > 0 && raft && poolOn > 0`. **On 'low' (`poolOn === 1`) only:** if `poolPick[0] >= 0 && poolI > 0` and that lantern's world position lies within `YIELD_R` of the lamp's world spot,
  then `lampWins = false`. The spot is already lit, so the lantern keeps the only light and the lamp adds nothing. Otherwise the lamp wins and lanterns fall back to their emissive glow, the same look as lanterns beyond the cap today.
  On medium/high the lamp always takes slot 0 and lanterns fill slots 1..poolOn-1 from `poolPick[0..]`. This is the nearest-to-the-player rule: the lamp spot is always within 4 m of the eye, so it is the closest pool candidate.
- **Loop (663-673).** `off = lampWins ? 1 : 0`. For `i = 0`, when `lampWins`: `l.position.set(lamp.x, lamp.y, lamp.z); raft.localToWorld(l.position); l.color.copy(LAMP_C); l.distance = LAMP_RANGE; l.intensity = LAMP_PEAK * lamp.gain * hand0; lampLit = 1; poolLit++`. There is no flicker.
  Other slots use `k = poolPick[i - off]` and set `l.distance = POOL_RANGE` (restoring it after a lamp handoff), otherwise as today. The lamp ignores `poolI`: it lights by day underwater.
- **Handoff fade.** `slot0Owner` (-2 none, -1 lamp, k lantern) and `hand0` 0..1. When slot 0 changes owner **to or from the lamp**, set `hand0 = 0`, then `hand0 = min(1, hand0 + dt / 0.15)`. A lantern intensity in slot 0 is also multiplied by `hand0`.
  Lantern-to-lantern re-ranks stay as today (instant).
- `state()` gains `lampLit` (0/1). `LAMP_C = new T.Color(LAMP_COLOR)` is built once. update() still allocates nothing.

## 6. Partner view: glowband-model.js + coop-avatar.js (no lights)
- `glowbandParts(T, glowMat)` → `{group, cone, geos, mats}`. The group, mounted on the head pivot at the head centre, holds three meshes (3 draw calls, only while a partner is shown):
  band `TorusGeometry(0.175, 0.012, 4, 20)` rotated flat, rope colour `#c9a76a` (MeshStandardMaterial, flatShading); bulb `SphereGeometry(0.035, 8, 6)` at `(0, 0.09, 0.17)` using `glowMat`;
  cone `ConeGeometry(0.8, 3.5, 12, 1, true)` translated so the apex sits at the bulb and it opens along +Z (head forward), with `MeshBasicMaterial({color: LAMP_COLOR, transparent: true, opacity: 0, blending: T.AdditiveBlending,
  depthWrite: false, side: T.DoubleSide, toneMapped: false, fog: true})` (cooking.js:306 flame style). `cone.renderOrder = 6`, `frustumCulled = false`. All meshes have `castShadow = receiveShadow = false`.
- coop-avatar.js: build lazily on the first `s.lamp === true` (solo games never build it), using `mat().glow` (41). Add it to `P.head` **after** `bakeAvatar`, like `holder` on the right arm (141, 309), so it is never baked. Re-add it in `setLook` after line 308.
- **Warm without a recompile hitch.** The group starts `visible = true` with cone opacity 0 and bulb emissive 0. `cone.onAfterRender` sets `warm = true` once and is then cleared. Until `warm`, the parts stay visible but dark; after that, `group.visible = !!s.lamp`.
  On: cone opacity eases to `0.10`, bulb `emissiveIntensity` to `1.6`, both by `damp(…, 8, dt)`. The cone follows head pitch for free through `P.head.rotation.x` (275).
- Dispose: the parts' geos/mats join `geos`/`mats`, and `glowMat` stays shared.
- **Not in v1:** a partner's lamp never lights your deck (no second pool slot).

## 7. Co-op
- Purely local, plus one pose bit. coop.js `local()` sends `lamp = glowLit()`, which is `lamp.owned && lamp.on`, so the partner sees the band glowing even by day, where it is faint and additive. This is cosmetic and nothing is host-authoritative.
- A guest's Glowband, pref and light work like the host's (its own bag via `localBag`). `poseFlags` change → the snapshot key changes → it is sent at the next 15 Hz tick (coop.js:160-163).
- **Old peers** ignore bit 32 (coop.js:30). They see no lamp and nothing breaks. A new peer with an old partner gets `f & 32 === 0`, so it sees no lamp.

## 8. Save and compatibility
- No new world fields and no `world.ext.glowband`. The item lives in the bag, so existing inventory snapshots save it. Old saves have none and need no migration.
- On/off is a per-player browser pref: `localStorage['little-raft-glowband'] = '1' | '0'`. It is read once at create and written on toggle, all in try/catch. It defaults to on, so a fresh Glowband lights at the first dusk. Blocked storage just means "on" each session.
- A glowband save opened by an older build: it rejects a bag snapshot with the unknown kind and starts a fresh bag (content-items.js:4). This is the same accepted forward risk earlier kinds took. Note this in the changelog.

## 9. Tests: tests/glowband.test.mjs (node:test, same base-URL import pattern as tests/goats.test.mjs)
1. Prefs: `readPref` default true, `'0'` → false, `'1'` → true, a throwing store → true; `writePref` writes '1'/'0' and swallows a throwing `setItem`.
2. `aimDistance`: clamps 0.4 → 1.5, 9 → 4, no point → 3, underwater → 3. `lampTarget` lands `dist - 0.35` along the unit dir. `lampGain`: 0 at nf 0 on deck, 1 at nf 1, 0 at depth 1 by day, 1 at depth 4 underwater by day, NaN → 0.
3. `smoothStep`: converges (after 0.5 s of 1/60 steps within 1e-3), a jump > 1.5 m snaps in one call, it allocates nothing (same object back).
4. daynight + stub glowband via `createDayNight(ctx, name => name === 'glowband' ? fake : null)` (stubCtx from tests/daynight.test.mjs, graphics 'medium'): no lantern and `fake.lamp.owned = false` → 0 point lights;
   `owned = true, gain = 0` → 2 point lights in that same update, before any toggle; toggling gain 0 ↔ 1 for 200 updates, plus 100 phases of a full day, never changes the PointLight count.
5. Slot rule: night, medium, 1 lantern + lamp → slot 0 at the lamp spot (`distance 3.5`, colour `#fff1d6`), slot 1 the lantern (`distance 4.5`); `lampLit 1`, `poolLit 2`.
   On low: lamp far from the lantern → the lamp takes the light; lamp spot within 2.5 m of the lantern → the lantern keeps it (`lampLit 0`). By day on deck (gain 0) every intensity is 0. The lamp lights by day when `gain > 0` (underwater).
6. Raft-local: rotate and translate the stub raft between updates; the slot 0 world position equals `raft.localToWorld(lamp xyz)` (no lag).
7. Module with a stub ctx (bag with `count`, raft Object3D, camera, ocean `getHeight`): not owned → `owned:false`, a toggle shows the craft notice; owned → `lamp.owned` in the same `update`; toggle flips `on` and writes the pref;
   underwater with gain > 0 → `diveMods` fog ×1.25 (stacks with goggles 46/30 when composed through `createContent`); `glowLit()` false when off; guest `give()` returns 0; dispose removes the listener (a later toggle changes nothing).
8. Co-op: `poseFlags({lamp:true}) === 32`, `poseFlags({swimming:true, grounded:true, reeling:true}) === 7` (unchanged), `readFlags(32 | 2)` deep-equals the old 5-key shape (old peers ignore it); tests/zipline and tests/sitting stay green untouched.
9. Input: `ACTIONS` includes `headlamp` (group Actions); `new ActionMap().bindingsFor('headlamp')` is `{keys:['KeyF'], pad:['Pad13']}`; `conflicts()` is `[]`. A stored rebind of `headlamp` to `KeyH` survives a reload.
10. Items: `CONTENT_ITEMS.glowband` has `maxStack 1, tool false`; the recipe costs `{glass:1, copperingot:1, rope:2}`; `learnedFrom(['glass','copperingot','rope'])` includes it; craft-book category is 'tools'.
11. Model: `glowbandParts` builds 3 meshes, the cone material is additive with `depthWrite false`, and the geometry is finite. The remote avatar given `s.lamp` builds parts once and never again after `setLook`, and the parts are re-mounted on the new head.
Also run `npm test`, shoot.py (`errors: []`), `node tests/coop-e2e.mjs` (ignore test 4), and a Playwright pass: `raftDebug.content.glowband.give()`, night via `daynight.setPhase(.82)`, press F twice,
check `daynight.state().lampLit` and that `renderer.info.programs.length` is unchanged across 20 toggles; dive to 5 m by day and see the lamp light up; then have the guest toggle and see the cone on the host.
