# Viewmodel: adoption steps

Drops the single-pass viewmodel layer from `sandbox/viewmodel/viewmodel.js` into the game. Line numbers are against
`dist/game.js` and `dist/hands.js` as of commit `745f663` (branch `claude/raft-tech`). Re-check them with the quoted
code if the file has moved; every step quotes the code it replaces.

What changes for the player: hands keep a fixed 70 degree framing whatever the FOV slider says, tools never clip
into walls, hands fall into sail/roof shadows like the deck does, the held tool lowers and raises on hotbar swaps,
and the hands sway behind the look, bob with the walk, breathe at idle, brace while charging, kick on use and dip on
landing. All of it scales with the existing Camera motion slider (`options.cameraMotion`).

## 1. Add the module

```sh
cp sandbox/viewmodel/viewmodel.js dist/viewmodel.js
```

It has no imports (it takes `T` as a parameter, like `hands.js`). No other new files.

## 2. Import (dist/game.js, after line 10)

Line 10 today:

```js
import { createHands } from './hands.js?build=v3-survival-ae77fa84ac2b';
```

Add right after it, using the same build query as its neighbours (the release script rewrites all of them together):

```js
import { createViewmodel } from './viewmodel.js?build=v3-survival-ae77fa84ac2b';
```

## 3. State (dist/game.js line 183)

```js
  let hookHands = null, hammerHands = null, rodHands = null, rodModel = null, rodTip = null, clothMat;
```

becomes

```js
  let hookHands = null, hammerHands = null, rodHands = null, rodModel = null, rodTip = null, clothMat, vm = null;
```

## 4. buildViewmodels() (dist/game.js lines 327-344)

Keep lines 328-332 (the three `createHands` calls and `rodModel`/`rodTip`). Delete lines 333-343: the two comment
lines, the whole `depthClear` block (`const depthClear = ...` through `camera.add(depthClear);`) and the
`for (const h of [hookHands, hammerHands, rodHands]) { h.group.traverse(...renderOrder = 1000...); ... camera.add(h.group); }`
loop. Put this in their place:

```js
    // Own-FOV, depth-squashed viewmodel layer (dist/viewmodel.js): one pass, world lighting and shadows, never clips.
    vm = createViewmodel(T, {camera, fov:70});
    vm.add('hook', hookHands); vm.add('hammer', hammerHands); vm.add('fishingrod', rodHands);
```

`vm.add` parents each hands group under the viewmodel rig (itself a camera child), sets `frustumCulled = false`,
`castShadow = false`, `receiveShadow = true`, and patches the materials. It no longer moves anything into the
transparent queue and no longer uses `renderer.state.buffers.depth.setMask`.

## 5. updateCamera() (dist/game.js lines 723-737)

Lines 726-728 set visibility directly:

```js
    hookHands.group.visible = running && kind === 'hook';
    hammerHands.group.visible = running && kind === 'hammer';
    rodHands.group.visible = running && kind === 'fishingrod';
```

Replace those three lines with one call. Visibility now belongs to `vm`, which holds the old tool until it is lowered:

```js
    vm.update({dt, kind:running ? kind : null, yaw, pitch, walking, walkPhase, grounded:physics.grounded, vy:physics.vy, charge:ch, swing, motion});
```

Lines 729-734 (`if (hookHands.group.visible) hookHands.update(...)` and the two others) stay as they are. They still
test `group.visible`, which `vm.update` has just set, so only the hands on screen animate.

Line 736:

```js
    (kind === 'fishingrod' ? rodTip : hookHands.handTip).getWorldPosition(handPos);
```

becomes

```js
    vm.anchor(kind === 'fishingrod' ? rodTip : hookHands.handTip, handPos);
```

This matters: the hands are drawn with their own projection and scaled toward the eye, so `getWorldPosition` on a
hand part no longer lands under the visible fist. `vm.anchor` returns the world point on the pixel ray under the
part, at its real (unscaled) distance, so the rope (`setRope`) and the hook launch origin (`throwHook`, line 660,
`origin:handPos.clone()`) start at the visible hand. Line 735 (`camera.updateMatrixWorld(true)`) must stay before it.

## 6. Resize (dist/game.js line 915)

```js
  on(window, 'resize', () => { if (!camera) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
```

Add `vm?.setAspect(camera.aspect);` after `camera.updateProjectionMatrix();`.

## 7. Optional: longer sleeve (dist/hands.js line 126)

The throw/hammer sweep in `hands.js update()` swings the right forearm so far forward that the open end of the
0.32 m sleeve shows as a green club in the upper right (it happens today too, see `09b-use-hammer-kick-legacy.png`).
Running the sleeve back past the eye hides it. The old depth-clear path could not do this safely (the sleeve
would have pierced the camera near plane); the new layer clips it cleanly behind the eye.

```js
    seg(frame, sleeveMat, at(0.24), at(0.56), 0.044, 0.060, 14);   // sleeve (runs off-screen)
```

becomes

```js
    seg(frame, sleeveMat, at(0.24), at(1.10), 0.044, 0.078, 14);   // sleeve (runs back past the eye)
```

## Things that do not change

- `options.fov` keeps driving only the world camera (`updateCamera()` line 714). The viewmodel FOV is fixed at 70.
  If a "Hands FOV" setting is wanted later: `vm.setFov(value)` in the `createSettings` `onChange` at line 1183.
- `hands.js`, `hook.js`, `hammer.js`, `fishing-tool.js` need no change (step 7 is cosmetic).
- Picking (`pickNdc`, line 467) only intersects `itemsGroup`, so the scaled hands never interfere with aim.
- The game's own camera bob (line 716) stays; the viewmodel bob is relative to the camera and sits on top of it.
- `graphics:'low'` turns the shadow map off (line 1183); hands then simply get no shadows, as before.

## Verify

Steps 1-6 were applied verbatim to `dist/game.js` in the prototype worktree and the real game was run headless
(solo start, charge, throw, hotbar scroll): no page or console errors, hook framed as in the lab, rope leaving the
left-hand coil. The edit was then reverted; `dist/` is untouched on this branch.


1. `python sandbox/viewmodel/shoot.py` (writes `sandbox/viewmodel/shots/*.png`, prints JSON). Look at
   `11-wall-vm.png` (hook drawn in front of a wall 0.17 m from the eye), `14-shade-vm.png` (hands shadowed under
   the sail), `16-fov95-vm.png` vs `17-fov95-legacy.png` (no stretched arms at FOV 95), `18-rope-anchor-vm.png`
   (rope leaves the coil).
2. In game: place a blocking decor item (anything with a `BLOCK_RADIUS`, see line 366), walk nose-first into it and look
   around: no tool should cut into it. Also stand at the raft edge and look straight down at the deck.
3. Settings, FOV 60 then 95: hand size on screen must not change.
4. Scroll the hotbar hook -> hammer -> rod: the old tool drops out (0.16 s), the new one rises with a small
   overshoot (0.3 s). Scroll fast: it never shows two tools at once.
5. Charge a throw, release: rope must start at the left hand's coil; the hook flight starts there too.
6. Stand under a sail: hands darken with the deck around you.
7. `npm test` (no test touches `buildViewmodels`, but run it anyway).
8. Cost check: the patched hand materials compile into their own program (cache key `vm|...`), and the depth-clear
   marker's program goes away. In the lab that is 5 programs with the new layer vs 6 with the marker; draw calls drop
   by one (the marker).
