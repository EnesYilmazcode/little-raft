# Viewmodel: adoption steps

Drops the single-pass viewmodel layer (`sandbox/viewmodel/viewmodel.js`) into the game and makes a small set of
`dist/hands.js` edits (prepare hook, long sleeve, hammer strike, re-select fix). Line numbers are against `dist/game.js`
(1780 lines) and `dist/hands.js` (425 lines) as of commit `3c62305` (branch `claude/raft-tech`, = current main). Every
step quotes the exact text it replaces. **Each quoted anchor occurs exactly once in its file**;
`sandbox/viewmodel/adopt_check.py` asserts that and applies the steps to a temp copy of `dist/`. Some long lines
are quoted by their tail only (said so in the step). The edits also live as data in `sandbox/viewmodel/adopt_edits.py`,
which is the source of truth if this page and the script ever disagree.

What changes for the player: hands keep a fixed 70 degree framing whatever the FOV slider says (60-100), tools never
clip into walls, hands fall into sail/roof shadows like the deck does (and keep a readable silhouette there), the
right sleeve no longer shows its open end as a green club during a throw, the hammer gets a real strike (cock back,
hit down onto the deck, small rebound, view jolt at the impact) instead of a weak copy of the hook's throw, landing
from a jump dips the hands, and re-selecting the item that is being lowered no longer leaves the hands stuck half way
down (a bug in today's dist). All motion scales with the existing Camera motion slider (`options.cameraMotion`).

## What is different from the first version of this page

The first version targeted the old dist (three `createHands` calls, one per tool, wrapped by `holdable()`). Current
dist has **one** hands controller (`createHands(T, {modelFactory})`) that lazily builds a held model for any hotbar
kind (`held-items.js`, with models from `models.js` for carried/placeable kinds) and already does its own swap
(lower/raise), look lag, walk bob and breathing. So:

- `viewmodel.js` no longer has an equip state machine, look sway, walk bob or breathing (hands.js has them; doubling
  them made the hands float). It keeps the rendering (own projection, depth squash, scale toward the eye, shade
  fill, `anchor`) and adds only landing dip, use kick (timed to the strike impact for the hammer) and a charge brace.
- Per-mesh setup is a hook: `createHands(T, {prepare: vm.prepare})`. hands.js calls it for the arms and for every held
  model it mounts later, so models built on first selection (crate, cup, seeds, ...) are covered.
- `vm.prepare` patches **private copies** of materials. `models.js` shares one material per colour module-wide, and the
  same models render the inventory icons on their own WebGLRenderer (`item-icons.js`); patching the shared material
  would draw those icons (and any other user) through the viewmodel projection. The lab checks this (`worldMatPatched`
  false in every shot: a world crate built from the same `getModel('crate')` keeps its material).
- Judge nice-to-haves: 1 (program cache key) is in `viewmodel.js` (key = `vm|` + previous key + previous
  `onBeforeCompile` source); 2 (re-select pop) moved to hands.js, which owns the swap now, and turned out to be a real
  stuck-dip bug there (H6); 3 (pickup while holding the hammer) is H7: only a click use strikes; 4 (green wedge at
  impact) is fixed by a narrower sleeve end and a strike that snaps the wrist instead of pitching the forearm up.

## 1. Add the module

```sh
cp sandbox/viewmodel/viewmodel.js dist/viewmodel.js
```

No imports (it takes `T`, like `hands.js`). No other new files.

## 2. Edits

Apply all of them together (G3 needs H2/H3; H4's long sleeve is only enabled when `prepare` is passed, so hands.js
alone stays safe under the old depth-clear path). `sandbox/viewmodel/hands.js` is exactly `dist/hands.js` + H1-H15
(apart from its `../../dist/held-items.js` import path), so `cp sandbox/viewmodel/hands.js dist/hands.js` followed by
restoring that import line (`from './held-items.js?build=v3-survival-ae77fa84ac2b'`) is equivalent to H1-H15.

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

### H2. dist/hands.js line 22

Signature: two optional options. Without them the controller behaves exactly as today (tests and any other caller unaffected).

```js
export function createHands(T, { modelFactory = null } = {}) {
```

becomes

```js
export function createHands(T, { modelFactory = null, prepare = null, strikeKinds = ['hammer'] } = {}) {
```

### H3. dist/hands.js lines 50-56

Per-mesh setup becomes overridable. `prep` is used for the arms (line 243 `prep(lagRoot)`) and for every lazily mounted held model (line 215 `prep(pivot)`), so passing `vm.prepare` covers everything.

```js
  // Viewmodel meshes draw in the transparent queue after the camera's depth-clear marker (see game.js),
  // never cast shadows and are never culled.
  const prep = (o) => o.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; c.renderOrder = 1000;
    for (const m of [].concat(c.material)) { m.depthTest = true; m.depthWrite = true; m.transparent = true; }
  });
```

becomes

```js
  // Default: viewmodel meshes draw in the transparent queue after a camera depth-clear marker, never cast shadows
  // and are never culled. `prepare` (viewmodel.js vm.prepare) replaces this for every mesh, incl. lazily built models.
  const prep = prepare || ((o) => o.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; c.renderOrder = 1000;
    for (const m of [].concat(c.material)) { m.depthTest = true; m.depthWrite = true; m.transparent = true; }
  }));
```

### H4. dist/hands.js line 165

Sleeve. The throw sweep swings the right forearm up toward the eye and the open end of the 0.37 m sleeve shows as a green club in the upper right (`19c-throw-legacy.png`). Under the layer the sleeve runs back past the eye (`19-throw-release.png`), slightly narrower at the end so the hammer strike does not fill the corner. Without `prepare` the old sleeve is kept: a long one would cross the world camera near plane under the depth-clear path.

```js
    seg(frame, sleeveMat, at(0.23), at(0.60), 0.051, 0.070, 14);   // sleeve (runs off-screen)
```

becomes

```js
    // sleeve: under the viewmodel layer (prepare) it runs back past the eye, so a swing never shows its open end;
    // the default path keeps the short one (a long sleeve would cross the world camera's near plane)
    seg(frame, sleeveMat, at(0.23), at(prepare ? 1.10 : 0.60), 0.051, prepare ? 0.066 : 0.070, 14);
```

### H5. dist/hands.js line 247

Strike flag in the animation state.

```js
  const st = { walkW: 0, reelW: 0, outW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, spool: 0, t: 0,
```

becomes

```js
  const st = { walkW: 0, reelW: 0, outW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, strikeOn: false, spool: 0, t: 0,
```

### H6. dist/hands.js lines 297-298

Re-select fix (judge nice-to-have 2, which now lives in hands.js because hands.js owns the swap). In today's dist, picking the item that is being lowered again (1 -> 2 -> 1 fast) leaves `st.lowering` set with `st.shown === st.target`, so `down` freezes at `dip²` until the next swap: the hands stay part-lowered (`20c-reselect-legacy.png`; node: dip .263 forever). The fix converts the lowering into a raise from the same height (bisection on `easeOutBack`, monotonic on [0, .59]).

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

### H7. dist/hands.js line 327

Strike arm (judge nice-to-have 3): only a click use (`swing = 1`: build, remove, decor) strikes; a pickup (`swing = .6`, line 938) keeps the light sweep it has today instead of snapping into the hit pose.

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

### H8. dist/hands.js line 336

Strike curve. Same `casting` input as the throw (`p` = 0 at the click, 1 when done; `swing` falls by `dt * 3` at line 1101, so the impact at p = .36 lands ~120 ms after the click).

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

### H9. dist/hands.js line 354

Right arm `rpx` (end of line 354): append the strike terms.

```js
 + 0.008 * oW - 0.008 * rW + trem;
```

becomes

```js
 + 0.008 * oW - 0.008 * rW + trem
      + 0.02 * sUp - 0.03 * sHit;
```

### H10. dist/hands.js line 355

Right arm `rpy` (end of line 355).

```js
 - 0.025 * catchDip + trem * 0.7 - 0.45 * down;
```

becomes

```js
 - 0.025 * catchDip + trem * 0.7 - 0.45 * down
      + 0.05 * sUp - 0.08 * sHit + 0.012 * sReb;
```

### H11. dist/hands.js line 356

Right arm `rpz`.

```js
    const rpz = 0.20 * ce - 0.24 * a + 0.025 * oW - 0.012 * rW * (pull - 0.5);
```

becomes

```js
    const rpz = 0.20 * ce - 0.24 * a + 0.025 * oW - 0.012 * rW * (pull - 0.5) + 0.02 * sUp - 0.04 * sHit;
```

### H12. dist/hands.js line 357

Right arm `rrx`. The strike pitches the arm only a little (-.35) and snaps the wrist hard (H13) so the head lands on the deck without the elbow rising into view.

```js
    const rrx = 0.40 * ce - 0.75 * a + 0.010 * amp * br + 0.10 * oW + 0.12 * catchDip - 0.5 * down;
```

becomes

```js
    const rrx = 0.40 * ce - 0.75 * a + 0.010 * amp * br + 0.10 * oW + 0.12 * catchDip - 0.5 * down + 0.20 * sUp - 0.35 * sHit + 0.10 * sReb;
```

### H13. dist/hands.js line 360

Right wrist `rwx`.

```js
    const rwx = 0.35 * ce - 0.55 * a - 0.10 * oW + 0.06 * rW * Math.sin(t * 18.85);
```

becomes

```js
    const rwx = 0.35 * ce - 0.55 * a - 0.10 * oW + 0.06 * rW * Math.sin(t * 18.85) + 0.30 * sUp - 1.40 * sHit;
```

### H14. dist/hands.js line 366

Left arm `lpy` (end of line 366): the free hand dips with the blow.

```js
 + 0.004 * amp * brL - 0.45 * down - 0.45 * (1 - lIn);
```

becomes

```js
 + 0.004 * amp * brL - 0.45 * down - 0.45 * (1 - lIn) - 0.010 * sHit;
```

### H15. dist/hands.js line 384

Debug output (`raftDebug.state.viewmodel.strike`: negative while cocking, positive at the hit). Optional, used by adopt_check.py.

```js
chargeEased: ce, throw: a,
```

becomes

```js
chargeEased: ce, throw: a, strike: sHit - sUp,
```

### G1. dist/game.js line 11

Import, right after the hands.js import (same `?build=` query as its neighbours; the release script rewrites them together).

```js
import { createHands, isPlaceable } from './hands.js?build=v3-survival-ae77fa84ac2b';
```

becomes

```js
import { createHands, isPlaceable } from './hands.js?build=v3-survival-ae77fa84ac2b';
import { createViewmodel } from './viewmodel.js?build=v3-survival-ae77fa84ac2b';
```

### G2. dist/game.js line 238

State: add `vm = null` to the hands declaration.

```js
  let hands = null, offIconReady = null, clothMat; // one hands controller swaps the held item model per hotbar kind
```

becomes

```js
  let hands = null, vm = null, offIconReady = null, clothMat; // one hands controller swaps the held item model per hotbar kind; vm = viewmodel layer
```

### G3. dist/game.js lines 433-441

`buildViewmodels()`: delete the depth-clear marker and the `camera.add(hands.group)`; build the layer first, hand its `prepare` to `createHands` (so the lazily built held models get it too), then attach. Nothing goes into the transparent queue any more and `renderer.state.buffers.depth.setMask` (internal three API) is no longer used.

```js
    hands = createHands(T, {modelFactory:modelOf}); hands.preload(['hook']); // 3D models from models.js, built-ins as fallback
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
    // Own-FOV, depth-squashed viewmodel layer (viewmodel.js): one pass, world lighting and shadows, never clips.
    vm = createViewmodel(T, {camera, fov:70});
    hands = createHands(T, {modelFactory:modelOf, prepare:vm.prepare}); hands.preload(['hook']); // 3D models from models.js, built-ins as fallback
    vm.attach(hands);
```

### G4. dist/game.js lines 1109-1111

`updateCamera()`: drive the layer right after `hands.update(...)` (the long line ending in the `[fishing-cooking]` comment; only its tail is quoted), before `camera.updateMatrixWorld(true)`, and read the rope anchor through `vm.anchor`. The hands are drawn with their own projection and scaled toward the eye, so `getWorldPosition` on a hand part no longer lands under the visible fist; `vm.anchor` returns the world point on that pixel's ray at the part's true distance. `handPos` feeds the rope (`setRope`), the hook launch origin (`HookCast(... origin:handPos.clone() ...)`, line 990), `hook.update({hand:handPos})`, the fishing line tip (`host.rodTip()` returns `handPos`, used by fishing-cooking.js) and `raftDebug.state.hand`; all of them now start at the visible hand.

```js
casting:swing, walking, hasHookOut:!!castOut(), motion, yaw, pitch}); // [fishing-cooking] rod reel pose from the lane
    camera.updateMatrixWorld(true);
    hands.ropeAnchor().getWorldPosition(handPos);
```

becomes

```js
casting:swing, walking, hasHookOut:!!castOut(), motion, yaw, pitch}); // [fishing-cooking] rod reel pose from the lane
    vm.update({dt, held:hands.state.held, grounded:physics.grounded, vy:physics.vy, charge:ch, swing, motion});
    camera.updateMatrixWorld(true);
    vm.anchor(hands.ropeAnchor(), handPos); // the hands draw scaled toward the eye: map the anchor to its on-screen world point
```

### G5. dist/game.js line 1384

Window resize: keep the layer's aspect in step (only the tail of line 1384 is quoted).

```js
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
```

becomes

```js
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vm?.setAspect(camera.aspect); renderer.setSize(innerWidth, innerHeight); });
```

### G6. dist/game.js line 384

Comment only (ocean `renderOrder` note, end of the long `ocean = createOcean(...)` line): the "viewmodels stay at 1000" remark is no longer true.

```js
(viewmodels stay at 1000)
```

becomes

```js
(viewmodels draw in their own front depth slice, viewmodel.js)
```

## Things that do not change

- `options.fov` keeps driving only the world camera (`updateCamera()` line 1091). The viewmodel FOV is fixed at 70; a
  "Hands FOV" setting later would be `vm.setFov(value)` from `applyOptions` (line 1008).
- `hook.js`, `hammer.js`, `fishing-tool.js`, `held-items.js`, `models.js`, `item-icons.js`, `coop-avatar.js` need no
  change. Other callers of `createHands(T)` (tests) keep today's behaviour: no `prepare` = transparent-queue setup and
  short sleeve; the strike is pose-only and applies to the hammer either way.
- The coop avatar (`coop-avatar.js`) has its own held models and is drawn by the world camera; multiplayer sends
  `held` kinds, not hand positions.
- Picking (`pickNdc`, line 648) only intersects world groups, so the scaled hands never interfere with aim.
- The game's own camera bob / footstep bob (`controls.camera`, line 1093, which already dips the whole view on landing) stays; the viewmodel motion is relative to the camera and sits on top of it.
- Shadows: `quality.js` may turn `sun.castShadow` off (low preset or adaptive step); hands then simply get no
  shadows. The hands never cast shadows (`castShadow = false`), so they never enter the shadow pass.
- Underwater (`underwater-fx.js`): fog is `T.Fog(1, 30)`; hands at < 1 m get none, as before (their shrunk
  view depth is ~0.12 m instead of ~0.8 m, both below `near`). The ceiling (`renderOrder -1e6`, no depth write) and the
  overlay (own scene, drawn after) are unaffected.
- `fishing-cooking.js` line 293 parents a caught fish to the camera (`renderOrder 999`, opaque queue, world
  projection). Today it can be overdrawn by the hands after the depth clear; with the layer the hands are in front
  by depth: same picture. It can still clip into a wall, as today (optional later: `vm.prepare(held)` and parent it to
  `vm.rig` with its position divided by 0.15).
- `warmShaders()` (`hands.preload(['hammer', 'fishingrod'])`) now preloads through `prepare`, so the vm programs are
  warmed the same way.

## Verify

`python sandbox/viewmodel/adopt_check.py [out_dir]` does all of this headless (brief's chromium, SwiftShader). It
copies `dist/` twice to a temp dir, applies step 1 and every edit to one copy (asserting each anchor matches exactly
once and printing its line), checks `sandbox/viewmodel/hands.js` is `dist/hands.js` + H1-H15, runs
`node --test tests/*.test.mjs` with `RAFT_DIST` on each copy, then boots both copies with a seeded save (hook,
hammer, rod, crates, materials) and plays: solo start, full charge, throw, hook out (rope), reel in, hotbar hammer /
rod / crate, a re-select mid-lower (2 then 1 on the first frame the hook is part-lowered), hammer build on the
nearest free spot with the game clock frozen at the cock and at the hit, back to the hook; then a second boot at
FOV 100. It prints JSON and exits non-zero on any failure. Last run (load average ~25, so ms timings are meaningless):

| | patched | unpatched |
|---|---|---|
| anchors | 21/21 match exactly once | |
| node tests | 532/533 | 532/533 (same failure in both: `atlas ... build stays fast`, a timing test, flaky under load) |
| page errors / console errors | none / none | none / none |
| hook throw, rope, reel | floating, rope leaves the coil, back to idle | same |
| re-select mid-lower (dip .148) | settles at dip 0 | **stays at dip .148** (hands stuck half down) |
| hammer build | tile 9 -> 10, strike -0.93 (cock) .. 1.0 (hit) | tile 9 -> 10, sweep only |
| FOV 100 | hands same size as at 75 | hands shrink to the centre, arms stretch |
| draw calls / programs at spawn | 153 / 39 | 150 / 38 |

Draw calls in game vary with floating debris and birds (both copies are live worlds); in the lab, where the scene is
fixed, the layer costs one draw call and one program **less** than today (the depth-clear marker goes away):
`vm` 163 calls / 7 programs vs `legacy` 164 / 8, triangles equal; `vm.update` ~1-1.5 us. The in-game +1 program is
the vm variant of the hand material (`vm|` cache key).

By hand:

1. `python sandbox/viewmodel/shoot.py` (lab, writes `sandbox/viewmodel/shots/*.png` + `report.json`). Look at
   `11-wall-vm` vs `13-wall-naive` (hook in front of a wall 0.17 m from the eye), `14-shade-vm` / `14b` (shade, fill
   on/off), `16-fov100-vm` vs `17-fov100-legacy`, `18-rope-anchor-vm`, `09a/09/09c/09d` (hammer cock, mid, impact,
   recover), `09e-hammer-pickup-tap` (pickup keeps the light sweep), `19-throw-release` vs `19c-throw-legacy`
   (no sleeve club), `20-reselect-mid` / `20b` vs `20c-reselect-legacy` (stuck), `21-crate-point-vm` (a models.js
   held model; the world crate next to it is unchanged).
2. In game: walk nose-first into a wall piece or a decoration and look around: no tool cuts into it.
3. Settings, FOV 60 then 100: hand size on screen does not change.
4. Hotbar 1 -> 2 -> 1 quickly: the hook comes back up and settles (today it can stay half lowered).
5. Charge, throw: rope starts at the left hand's coil, and so does the hook flight.
6. Hammer: place a floor tile. The hammer cocks back, hits down onto the deck with a small jolt, rebounds.
   Pick up an item with the hammer held: light sweep, no snap into the hit pose.
7. Stand under a sail: hands darken with the deck but keep a readable silhouette (`vm.setFill(0, 0)` compares).
8. Open the inventory: item icons (crate, sail, palm, ...) look as before (they share materials with held models).
9. `npm test`.
