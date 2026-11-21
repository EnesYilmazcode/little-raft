# Viewmodel: adoption steps

Drops the single-pass viewmodel layer (`sandbox/viewmodel/viewmodel.js`) into the game and makes a small set of
`dist/hands.js` edits (prepare hook, long sleeve, hammer strike, re-select fix). Line numbers are against
`dist/game.js` (2284 lines), `dist/hands.js` (574 lines) and `dist/live.js` (382 lines) as of main `8d21618`
(merged into `claude/raft-tech`). Every step quotes the exact text it replaces. **Each quoted anchor occurs exactly
once in its file**; `sandbox/viewmodel/adopt_check.py` asserts that and applies the steps to a temp copy of `dist/`.
Some long lines are quoted by their tail only (said so in the step). The edits also live as data in
`sandbox/viewmodel/adopt_edits.py`, which is the source of truth if this page and the script ever disagree (the step
sections below are generated from it).

What changes for the player: tools never clip into walls, hands fall into sail/roof shadows like the deck does (and
keep a readable silhouette there), the right sleeve no longer shows its open end during a throw, the hammer gets a
real strike (cock back, hit down onto the deck, small rebound, view jolt at the impact) instead of a weak copy of the
hook's throw, landing from a jump dips the hands, and re-selecting the item that is being lowered no longer leaves
the hands stuck part way down (a bug still in main). All motion scales with the existing Camera motion slider
(`options.cameraMotion`). FOV-independent framing is **no longer** a change: main's hands.js already undoes the world
FOV itself (`update({fov})`, a fixed 60 degree framing); under the layer it keeps doing so for the layer's own FOV.

## Drift refresh: main 8d21618 vs the 3c62305 base this page was written against

hands.js grew from 425 to 574 lines and game.js from 1780 to 2284. What moved or changed, and what this page does now:

- **hands.js does its own FOV compensation** (`VM_TAN`, `root.scale.set(s, s, 1)` from `update({fov})`, line 428;
  game.js passes `hp.fov = camera.fov`). The layer projects with its own camera, so passing the world FOV would
  resize the hands again. G4 now passes `hp.fov = vm.projCam.fov`, and the layer's default FOV is **60** (was 70),
  the framing hands.js is built for, so `s = 1` and the hands frame exactly like today's dist (lab `rest` vs
  `legacy-rest`: identical).
- **hands.js bakes its parts** into a few vertex-coloured meshes and adds `setLook({skin, shirt})` (game.js 532 and
  548), which recolours its own materials. `vm.prepare` swaps in private material copies, so a recolour after
  `prepare` would no longer show. `viewmodel.js` now gives each copy the **same `color`/`emissive` objects** as its
  source: setLook keeps working, at no per-frame cost. adopt_check boots with a saved non-default Look and asserts
  the drawn hand materials carry it.
- hands.js' own `keyShade` materials have an `onBeforeCompile` + `customProgramCacheKey` ('vmKeyShade'); the layer's
  patch already chains the previous `onBeforeCompile` and folds the previous key into its own, so nothing to do.
- `mountFor` now clones a shared models.js model's materials before `prep` (hands.js 323-333), so the layer's own
  copy is a second line of defence, kept because built-in held models (crafts.js, hook.js, ...) are not flagged
  shared.
- Anchors that changed text: H3 (prep gained a `NoBlending` line), H4 (sleeve is now `const sleeve = seg(...)` and
  baked), H5 (`st` starts with `hookOut`), H9-H13 (right-arm terms rewritten for the rope grip and `hold.arm`/
  `hold.tilt`), H15 (`state` is now the reused `last` object). G3 is split in two (G3 + G3b) because main put
  `setLook` and `attachSpearRepair` between the createHands line and the depth-clear block. G4 anchors on the
  `hp.* = ...; hands.update(hp)` lines that replaced the inline `hands.update({...})`.
- **New step L1**: `dist/live.js` preloads game.js' static import graph from a hand-kept `PRELOAD` list and
  `tests/live-preload.test.mjs` fails when a module is missing, so `viewmodel.js` is added there.
- **Strike retuned** (H10, H12, H13): main's hammer rests lower with its head tilted forward, and the old hit sent it
  below the screen (`hit` shot of the first run). See H13.
- `spear-repair-hooks.js` (new) moves `hands.group.position` for the jab. Under the layer `hands.group` sits inside
  the rig, in the same unscaled camera-space units, so the jab is unchanged.

## What is different from the first version of this page

The first version targeted the old dist (three `createHands` calls, one per tool, wrapped by `holdable()`). Current
dist has **one** hands controller (`createHands(T, {modelFactory})`) that lazily builds a held model for any hotbar
kind (`held-items.js`, with models from `models.js` for carried/placeable kinds) and already does its own swap
(lower/raise), look lag, walk bob and breathing. So:

- `viewmodel.js` has no equip state machine, look sway, walk bob or breathing (hands.js has them; doubling them made
  the hands float). It keeps the rendering (own projection, depth squash, scale toward the eye, shade fill, `anchor`)
  and adds only landing dip, use kick (timed to the strike impact for the hammer) and a charge brace.
- Per-mesh setup is a hook: `createHands(T, {prepare: vm.prepare})`. hands.js calls it for the arms and for every held
  model it mounts later, so models built on first selection (crate, cup, seeds, ...) are covered.
- `vm.prepare` patches **private copies** of materials (sharing their colour objects, see above), so inventory icons
  (`item-icons.js`, own WebGLRenderer) and world copies never draw through the viewmodel projection.

## 1. Add the module

```sh
cp sandbox/viewmodel/viewmodel.js dist/viewmodel.js
```

No imports (it takes `T`, like `hands.js`). No other new files.

## 2. Edits

Apply all of them together (G3 needs H2/H3; H4's long sleeve is only enabled when `prepare` is passed, so hands.js
alone stays safe under the old depth-clear path). `sandbox/viewmodel/hands.js` is exactly `dist/hands.js` + H1-H15
(apart from its `../../dist/held-items.js` import path; regenerate with `python sandbox/viewmodel/adopt_edits.py
--sandbox`), so `cp sandbox/viewmodel/hands.js dist/hands.js` followed by restoring that import line
(`from './held-items.js?build=v3-survival-ae77fa84ac2b'`) is equivalent to H1-H15.

### H1. dist/hands.js lines 3-4

Header usage comment.

```js
//   const hands = createHands(THREE, { modelFactory });  // factory optional, e.g. (k) => getModel(k) (models.js)
//   camera.add(hands.group);                       // camera must be in the scene
```

becomes

```js
//   const hands = createHands(THREE, { modelFactory });  // factory optional, e.g. (k) => getModel(k) (models.js)
//   camera.add(hands.group);                       // camera must be in the scene
//   // or, with the viewmodel layer (viewmodel.js): own FOV, no wall clipping, real shadows, long sleeve
//   const vm = createViewmodel(THREE, { camera }); const hands = createHands(THREE, { modelFactory, prepare: vm.prepare }); vm.attach(hands);
//   options: prepare(obj) per-mesh setup hook (replaces the transparent-queue default), strikeKinds (default
//   ['hammer']): kinds whose click use is a cock-back + downward strike instead of the forward sweep
```

### H2. dist/hands.js line 77

Signature: two optional options. Without them the controller behaves exactly as today (tests and any other caller unaffected).

```js
export function createHands(T, { modelFactory = null } = {}) {
```

becomes

```js
export function createHands(T, { modelFactory = null, prepare = null, strikeKinds = ['hammer'] } = {}) {
```

### H3. dist/hands.js lines 138-147

Per-mesh setup becomes overridable. `prep` is used for the arms (line 366 `prep(lagRoot)`) and for every lazily mounted held model (line 334 `prep(pivot)`, after mountFor has given a shared models.js model its own material copies), so passing `vm.prepare` covers everything. The default path is kept verbatim, including the `NoBlending` line main added.

```js
  // Viewmodel meshes draw in the transparent queue after the camera's depth-clear marker (see game.js),
  // never cast shadows and are never culled. Solid ones skip blending (opaque cost, transparent-queue order).
  const prep = (o) => o.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; c.renderOrder = 1000;
    for (const m of [].concat(c.material)) {
      if (!m.transparent && m.opacity >= 1) m.blending = T.NoBlending;
      m.depthTest = true; m.depthWrite = true; m.transparent = true;
    }
  });
```

becomes

```js
  // Default: viewmodel meshes draw in the transparent queue after a camera depth-clear marker, never cast shadows
  // and are never culled; solid ones skip blending. `prepare` (viewmodel.js vm.prepare) replaces this for every
  // mesh, incl. lazily built models.
  const prep = prepare || ((o) => o.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; c.renderOrder = 1000;
    for (const m of [].concat(c.material)) {
      if (!m.transparent && m.opacity >= 1) m.blending = T.NoBlending;
      m.depthTest = true; m.depthWrite = true; m.transparent = true;
    }
  }));
```

### H4. dist/hands.js line 264

Sleeve (now baked with the cuff into one vertex-coloured mesh on the next line; the `sleeve` binding stays). The throw sweep swings the right forearm up toward the eye and the open end of the sleeve shows as a green club in the upper right. Under the layer the sleeve runs back past the eye, slightly narrower at the end so the hammer strike does not fill the corner. Without `prepare` the old sleeve is kept: a long one would cross the world camera near plane under the depth-clear path.

```js
    const sleeve = seg(frame, sleeveMat, at(0.23), at(0.60), 0.051, 0.070, 14); // sleeve (runs off-screen)
```

becomes

```js
    // sleeve: under the viewmodel layer (prepare) it runs back past the eye, so a swing never shows its open end;
    // the default path keeps the short one (a long sleeve would cross the world camera's near plane)
    const sleeve = seg(frame, sleeveMat, at(0.23), at(prepare ? 1.10 : 0.60), 0.051, prepare ? 0.066 : 0.070, 14);
```

### H5. dist/hands.js line 371

Strike flag in the animation state.

```js
  const st = { hookOut: false, walkW: 0, reelW: 0, outW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, spool: 0, t: 0,
```

becomes

```js
  const st = { hookOut: false, walkW: 0, reelW: 0, outW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, strikeOn: false, spool: 0, t: 0,
```

### H6. dist/hands.js lines 422-423

Re-select fix. Still present in main: picking the item that is being lowered again (1 -> 2 -> 1 fast) leaves `st.lowering` set with `st.shown === st.target`, so `down` freezes at `dip²` until the next swap and the hands stay part-lowered. The fix converts the lowering into a raise from the same height (bisection on `easeOutBack`, monotonic on [0, .59]).

```js
      if (st.dip >= 1) swapNow();
    } else if (st.raise < 1) st.raise = Math.min(1, st.raise + dt / 0.26);
```

becomes

```js
      if (st.dip >= 1) swapNow();
    } else {
      // re-selected the item that was being lowered: raise it again from the current height (no pop, no stuck dip)
      if (st.lowering) { const d = st.dip * st.dip; let lo = 0, hi = 0.59; for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (1 - easeOutBack(m) > d) lo = m; else hi = m; } st.raise = lo; st.lowering = false; }
      if (st.raise < 1) st.raise = Math.min(1, st.raise + dt / 0.26);
    }
```

### H7. dist/hands.js line 458

Strike arm: only a click use (`swing = 1`: build, remove, decor) strikes; a pickup (`swing = .6`, game.js line 1228) keeps the light sweep it has today instead of snapping into the hit pose. Instruments use `.7` and never strike (threshold is `> .7`).

```js
    if (casting > 0 && (st.lastCasting <= 0 || casting > st.lastCasting + 0.25)) st.releaseCharge = Math.max(st.chargeS, charge, 0.35);
```

becomes

```js
    if (casting > 0 && (st.lastCasting <= 0 || casting > st.lastCasting + 0.25)) {
      st.releaseCharge = Math.max(st.chargeS, charge, 0.35);
      st.strikeOn = casting > 0.7;    // a click use (swing 1) strikes; a pickup tap (swing .6) keeps the light sweep
    }
    if (casting <= 0) st.strikeOn = false;
```

### H8. dist/hands.js line 467

Strike curve. Same `casting` input as the throw (`p` = 0 at the click, 1 when done; `swing` falls by `dt * 3` at game.js line 1439, so the impact at p = .36 lands ~120 ms after the click).

```js
    const a = (forward - recoil) * (isHook ? 1 : 0.55);
```

becomes

```js
    const STRIKE = st.strikeOn && strikeKinds.includes(st.shown);
    const a = STRIKE ? 0 : (forward - recoil) * (isHook ? 1 : 0.55);
    // strike curve (hammer): cock back 0-.2, hit .2-.36 (impact ~.36, ~120 ms after the click), rebound, recover .5-1
    const sUp = STRIKE ? smooth(0, 0.2, p) * (1 - smooth(0.2, 0.36, p)) : 0;
    const sHit = STRIKE ? smooth(0.2, 0.36, p) * (1 - smooth(0.5, 1, p)) : 0;
    const sReb = STRIKE ? Math.sin(Math.PI * clamp01((p - 0.36) / 0.22)) : 0;
```

### H9. dist/hands.js line 488

Right arm `rpx` (end of line 488; main's new reel terms precede it, only the tail is quoted): append the strike terms.

```js
 * rW + trem;
```

becomes

```js
 * rW + trem
      + 0.02 * sUp - 0.03 * sHit;
```

### H10. dist/hands.js line 489

Right arm `rpy` (end of line 489; `rIn` is main's new empty-right-hand term). The hit no longer drops the arm (+.01): the lower rest pose already puts the fist at the bottom edge.

```js
 + trem * 0.7 - 0.45 * down - 0.45 * (1 - rIn);
```

becomes

```js
 + trem * 0.7 - 0.45 * down - 0.45 * (1 - rIn)
      + 0.06 * sUp + 0.01 * sHit + 0.012 * sReb;
```

### H11. dist/hands.js line 490

Right arm `rpz`.

```js
    const rpz = 0.04 * ce - 0.20 * a - 0.04 * oW + (0.10 * pullR - 0.05) * rW;
```

becomes

```js
    const rpz = 0.04 * ce - 0.20 * a - 0.04 * oW + (0.10 * pullR - 0.05) * rW + 0.02 * sUp - 0.04 * sHit;
```

### H12. dist/hands.js line 491

Right arm `rrx`. The strike pitches the arm only a little (-.20) and snaps the wrist (H13) so the head lands on the deck without the elbow rising into view.

```js
    const rrx = 0.35 * ce - 0.65 * a + 0.010 * amp * br - 0.15 * oW + 0.30 * pullR * rW + 0.12 * catchDip - 0.5 * down;
```

becomes

```js
    const rrx = 0.35 * ce - 0.65 * a + 0.010 * amp * br - 0.15 * oW + 0.30 * pullR * rW + 0.12 * catchDip - 0.5 * down + 0.20 * sUp - 0.20 * sHit + 0.10 * sReb;
```

### H13. dist/hands.js line 494

Right wrist `rwx`. Retuned for main: the hammer now rests lower (`arm: [.02, -.06, 0]`) with its head already tilted forward (`tilt: .55`, held-items.js line 35), so the old hit (-1.40 wrist, -.08 drop) threw the head below the screen. The cock now also lifts the tilt away (+.75) and the hit is -.60, which puts the head on the deck at the bottom of the view (lab: `scene=use&t=1.13`).

```js
    const rwx = 0.30 * ce - 0.45 * a - 0.10 * oW + 0.22 * pullR * rW - (hold.tilt || 0) * nW;
```

becomes

```js
    const rwx = 0.30 * ce - 0.45 * a - 0.10 * oW + 0.22 * pullR * rW - (hold.tilt || 0) * nW + 0.75 * sUp - 0.60 * sHit;
```

### H14. dist/hands.js line 501

Left arm `lpy` (end of line 501): the free hand dips with the blow.

```js
 + 0.004 * amp * brL - 0.45 * down - 0.45 * (1 - lIn);
```

becomes

```js
 + 0.004 * amp * brL - 0.45 * down - 0.45 * (1 - lIn) - 0.010 * sHit;
```

### H15. dist/hands.js line 522

Debug output (`raftDebug.state.viewmodel.strike`: negative while cocking, positive at the hit; `state` is now the reused `last` object, written field by field). Optional, used by adopt_check.py.

```js
last.chargeEased = ce; last.throw = a;
```

becomes

```js
last.chargeEased = ce; last.throw = a; last.strike = sHit - sUp;
```

### G1. dist/game.js line 12

Import, right after the hands.js import (same `?build=` query as its neighbours; the release script rewrites them together).

```js
import { createHands, isPlaceable } from './hands.js?build=v3-survival-ae77fa84ac2b';
```

becomes

```js
import { createHands, isPlaceable } from './hands.js?build=v3-survival-ae77fa84ac2b';
import { createViewmodel } from './viewmodel.js?build=v3-survival-ae77fa84ac2b';
```

### G2. dist/game.js line 277

State: add `vm = null` to the hands declaration.

```js
  let hands = null, offIconReady = null, clothMat; // one hands controller swaps the held item model per hotbar kind
```

becomes

```js
  let hands = null, vm = null, offIconReady = null, clothMat; // one hands controller swaps the held item model per hotbar kind; vm = viewmodel layer
```

### G3. dist/game.js line 547

`buildViewmodels()`: build the layer first and hand its `prepare` to `createHands`, so the lazily built held models get it too. `fov:60` is the framing main's hands.js is built for (`VM_TAN`, 60 degrees). The `hands.setLook(...)` and `spearRep = attachSpearRepair(...)` lines that follow stay as they are.

```js
    hands = createHands(T, {modelFactory:modelOf}); hands.preload(['hook']); // 3D models from models.js, built-ins as fallback
```

becomes

```js
    // Own-FOV, depth-squashed viewmodel layer (viewmodel.js): one pass, world lighting and shadows, never clips.
    vm = createViewmodel(T, {camera, fov:60});
    hands = createHands(T, {modelFactory:modelOf, prepare:vm.prepare}); hands.preload(['hook']); // 3D models from models.js, built-ins as fallback
```

### G3b. dist/game.js lines 550-557

Same function: delete the depth-clear marker and the `camera.add(hands.group)`; attach instead. Nothing goes into the transparent queue any more and `renderer.state.buffers.depth.setMask` (internal three API) is no longer used.

```js
    // Viewmodels draw last (transparent queue, renderOrder 1000) after a camera-owned marker clears depth, so the
    // world never clips them while fingers and tools still depth-sort correctly against each other.
    const depthClear = new T.Mesh(new T.PlaneGeometry(1e-4, 1e-4), new T.MeshBasicMaterial({colorWrite:false, depthWrite:false, depthTest:false, transparent:true}));
    depthClear.name = 'viewmodelDepthClear'; depthClear.frustumCulled = false; depthClear.castShadow = false; depthClear.receiveShadow = false;
    depthClear.renderOrder = 999; depthClear.position.set(0, 0, -.1);
    depthClear.onBeforeRender = (r, _s, cam) => { if (cam !== camera) return; r.state?.buffers?.depth?.setMask?.(true); r.clearDepth(); };
    camera.add(depthClear);
    camera.add(hands.group);
```

becomes

```js
    vm.attach(hands); // parents hands.group under the layer's rig (a camera child)
```

### G4. dist/game.js lines 1451-1453

`updateCamera()`: hands.js now undoes `hp.fov` in camera x/y itself (`root.scale`, hands.js line 428). Under the layer the hands are projected with `vm.projCam`, so they must be told that FOV, not the world camera's (the world FOV would shrink/stretch them again). Then drive the layer right after `hands.update(hp)` and read the rope anchor through `vm.anchor`, which updates the camera matrices itself. The hands are drawn with their own projection and scaled toward the eye, so `getWorldPosition` on a hand part no longer lands under the visible fist; `vm.anchor` returns the world point on that pixel's ray at the part's true distance. `handPos` feeds the rope, the hook launch origin (`throwOrigin(handPos, ...)`, line 1290), `hook.update({hand:handPos})`, the fishing line tip (`rodTip:() => handPos`, line 518) and `raftDebug.state.hand`; all of them now start at the visible hand (the right fist while the hook is out, main's new `ropeTip`). Only the tail of the long `hp.walking = ...` line is quoted.

```js
 hp.yaw = yaw; hp.pitch = pitch; hp.fov = camera.fov;
    hands.update(hp);
    hands.ropeAnchor().getWorldPosition(handPos); // updates the anchor's parent chain (camera included); render refreshes the rest
```

becomes

```js
 hp.yaw = yaw; hp.pitch = pitch; hp.fov = vm.projCam.fov; // hands frame for the layer's own FOV, not the world camera's
    hands.update(hp);
    vm.update({dt, held:hands.state.held, grounded:physics.grounded, vy:physics.vy, charge:ch, swing, motion});
    vm.anchor(hands.ropeAnchor(), handPos); // hands draw scaled toward the eye: the anchor's on-screen world point (updates the camera chain)
```

### G5. dist/game.js line 1776

Window resize: keep the layer's aspect in step (only the tail of line 1776 is quoted).

```js
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
```

becomes

```js
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vm?.setAspect(camera.aspect); renderer.setSize(innerWidth, innerHeight); });
```

### G6. dist/game.js line 444

Comment only (ocean `renderOrder` note, end of the long `ocean = createOcean(...)` line): the "viewmodels stay at 1000" remark is no longer true.

```js
(viewmodels stay at 1000)
```

becomes

```js
(viewmodels draw in their own front depth slice, viewmodel.js)
```

### L1. dist/live.js line 35

New module in game.js' static import graph: add it to `PRELOAD` (`tests/live-preload.test.mjs` fails otherwise). Alphabetical, between `underwater-fx.js` and `vitals-ui.js`.

```js
'underwater-fx.js',
```

becomes

```js
'underwater-fx.js', 'viewmodel.js',
```


## Things that do not change

- `options.fov` keeps driving only the world camera (`updateCamera()` line 1427). The viewmodel FOV is fixed at 60; a
  "Hands FOV" setting later would be `vm.setFov(value)` from `applyOptions` (line 1310); G4 already hands the new
  value to hands.js.
- `hook.js`, `hammer.js`, `fishing-tool.js`, `held-items.js`, `models.js`, `item-icons.js`, `coop-avatar.js`,
  `spear-repair-hooks.js` need no change. Other callers of `createHands(T)` (tests) keep today's behaviour: no
  `prepare` = transparent-queue setup and short sleeve; the strike is pose-only and applies to the hammer either way.
- The coop avatar (`coop-avatar.js`) has its own held models and is drawn by the world camera; multiplayer sends
  `held` kinds, not hand positions.
- Picking (`pickNdc`, line 880) only intersects world groups, so the scaled hands never interfere with aim.
- The game's own camera bob / footstep bob / landing dip (`controls.camera`, line 1429) stays; the viewmodel motion is
  relative to the camera and sits on top of it.
- Shadows: `quality.js` may turn `sun.castShadow` off (low preset or adaptive step); hands then simply get no
  shadows. The hands never cast shadows (`castShadow = false`), so they never enter the shadow pass.
- Underwater (`underwater-fx.js`): hands at < 1 m get no fog, as before (their shrunk view depth is ~0.12 m instead
  of ~0.8 m, both below the fog's near distance).
- `fishing-cooking.js` line 304 parents a caught fish to the camera (`renderOrder 999`, opaque queue, world
  projection). Today it can be overdrawn by the hands after the depth clear; with the layer the hands are in front
  by depth: same picture. It can still clip into a wall, as today (optional later: `vm.prepare(held)` and parent it to
  `vm.rig` with its position divided by 0.15).
- `warmShaders()` (line 573, `hands.preload(['hammer', 'fishingrod', 'spear'])`) and `warmKinds()` preload through
  `prepare`, so the vm programs are warmed the same way.

## Verify

`python sandbox/viewmodel/adopt_check.py [out_dir]` does all of this headless (brief's chromium, SwiftShader). It
copies `dist/` twice to a temp dir, applies step 1 and every edit to one copy (asserting each anchor matches exactly
once and printing its line), runs `node --check` on every patched file, checks `sandbox/viewmodel/hands.js` is
`dist/hands.js` + H1-H15, runs `node --test tests/*.test.mjs` with `RAFT_DIST` on each copy (incl.
`tests/live-preload.test.mjs`), then boots both copies with a seeded save (hook, hammer, rod, crates, materials) and a
seeded non-default Look, and plays: solo start, full charge, throw, hook out (rope), reel in, hotbar hammer / rod /
crate, a re-select mid-lower (2 then 1 on the first frame the hook is part-lowered), hammer build on the nearest free
spot with the game clock frozen at the cock and at the hit, back to the hook; then a second boot at FOV 100. It prints
JSON and exits non-zero on any failure. `SKIP_TESTS=1` / `SKIP_BASE=1` skip the test comparison / the unpatched boots.

Last runs (main 8d21618; load average 40-70 on 4 cores, so ms timings are meaningless). Full run = tests + both
boots; the patched boots were repeated after the strike retune (`SKIP_TESTS=1 SKIP_BASE=1`), numbers from that run:

| | patched | unpatched |
|---|---|---|
| anchors | 23/23 match exactly once; `node --check` ok on game.js, hands.js, live.js, viewmodel.js | |
| node tests (910, incl. live-preload) | 909/910 | 909/910 (same failure in both: `atlas ... build stays fast`, a timing test, flaky under load) |
| page errors / console errors | none / none (SwiftShader warnings only) | none / none |
| saved Look (shirt #70a7e4, skin #6b3f27) on the drawn hands | yes | yes |
| hook throw, rope, reel | floating, rope from the right fist, back to idle | same |
| re-select mid-lower (dip .148) | settles at dip 0 | **stays at dip .148** (hands stuck part down) |
| hammer build | tile 9 -> 10, strike -0.84 (cock) .. 1.0 (hit), head lands on the deck in view | tile 9 -> 10, sweep only |
| FOV 100 | hands same size as at 75 | same (main already compensates) |
| draw calls / programs at spawn | 54 / 116 | 53 / 118 |

The first full run (before the retune) also failed the re-select check once: the in-page trigger never saw the
part-lowered frame on that run (load spike); the repeat caught it at dip .148 and passed. Draw calls in game vary
with floating debris and birds (both copies are live worlds), so one call either way is noise; the depth-clear
marker goes away.

By hand:

1. `python sandbox/viewmodel/shoot.py` (lab, writes `sandbox/viewmodel/shots/*.png` + `report.json`). The lab now
   frames the hands at `vmfov=60` and passes `fov` to `hands.update` like game.js. `index.html?mode=vm&scene=use&t=1.06`
   / `t=1.13` show the hammer cock / hit; `mode=legacy&scene=use&t=0.9` vs `mode=vm` is the rest framing check.
2. In game: walk nose-first into a wall piece or a decoration and look around: no tool cuts into it.
3. Settings, FOV 60 then 100: hand size on screen does not change (as today).
4. Hotbar 1 -> 2 -> 1 quickly: the hook comes back up and settles (today it can stay part lowered).
5. Charge, throw: rope starts at the left hand's coil, and so does the hook flight; while the hook is out the line
   leaves the right fist.
6. Hammer: place a floor tile. The hammer cocks back, hits down onto the deck with a small jolt, rebounds.
   Pick up an item with the hammer held: light sweep, no snap into the hit pose.
7. Look dialog: change skin tone and shirt: the first-person hands and sleeves follow.
8. Stand under a sail: hands darken with the deck but keep a readable silhouette (`vm.setFill(0, 0)` compares).
9. Open the inventory: item icons look as before (they share models with held items).
10. `npm test`.
