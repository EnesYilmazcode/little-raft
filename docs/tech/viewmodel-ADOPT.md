# Viewmodel: adoption steps

Drops the single-pass viewmodel layer from `sandbox/viewmodel/viewmodel.js` into the game, plus a small `hands.js`
update (hammer strike pose, longer sleeve). Line numbers are against `dist/game.js` and `dist/hands.js` as of commit
`745f663` (branch `claude/raft-tech`; `dist/` unchanged on `fleet-tech/viewmodel`). Re-check them with the quoted code
if the file has moved; every step quotes the code it replaces. Apply all seven steps together: step 7's long sleeve
would pierce the camera near plane under the old depth-clear path.

What changes for the player: hands keep a fixed 70 degree framing whatever the FOV slider says, tools never clip
into walls, hands fall into sail/roof shadows like the deck does, the held tool lowers and raises on hotbar swaps,
and the hands sway behind the look, bob with the walk, breathe at idle, brace while charging, kick on use and dip on
landing. The hammer gets its own strike (cock back, hit down, small rebound) instead of the hook's throw sweep, the
right sleeve no longer shows its open end as a green club during a throw, the hook stays on screen at full charge, and
hands/tools keep a readable silhouette in shade. All motion scales with the existing Camera motion slider
(`options.cameraMotion`).

## 1. Add the module

```sh
cp sandbox/viewmodel/viewmodel.js dist/viewmodel.js
```

It has no imports (it takes `T` as a parameter, like `hands.js`). No other new files. (`dist/hands.js` is edited in
step 7.)

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

Keep lines 328-332 (the three `createHands` calls and `rodModel`/`rodTip`), but give the hammer the strike pose
(step 7). Line 330:

```js
    hammerHands = createHands(T, holdable(hammer, hammer.userData.grip, {ry:Math.PI / 2, rz:.2, scale:.6}));
```

becomes

```js
    hammerHands = createHands(T, holdable(hammer, hammer.userData.grip, {ry:Math.PI / 2, rz:.2, scale:.6}), {use:'strike'});
```

Delete lines 333-343: the two comment
lines, the whole `depthClear` block (`const depthClear = ...` through `camera.add(depthClear);`) and the
`for (const h of [hookHands, hammerHands, rodHands]) { h.group.traverse(...renderOrder = 1000...); ... camera.add(h.group); }`
loop. Put this in their place:

```js
    // Own-FOV, depth-squashed viewmodel layer (dist/viewmodel.js): one pass, world lighting and shadows, never clips.
    vm = createViewmodel(T, {camera, fov:70});
    vm.add('hook', hookHands); vm.add('hammer', hammerHands, {use:'strike'}); vm.add('fishingrod', rodHands);
```

`{use:'strike'}` on `vm.add` times the hammer's view kick to the strike impact (a downward jolt ~0.12 s after the
click, read off the game's `swing` timer, which falls by `dt * 3` at line 723) instead of the throw recoil. `vm.add` parents each hands group under the viewmodel rig (itself a camera child), sets `frustumCulled = false`,
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

## 7. hands.js: hammer strike + longer sleeve (dist/hands.js)

`sandbox/viewmodel/hands.js` is `dist/hands.js` with exactly the edits below (`diff -u dist/hands.js
sandbox/viewmodel/hands.js` shows nothing else), so either copy it over (`cp sandbox/viewmodel/hands.js dist/hands.js`)
or apply the edits by hand. The API stays backward compatible: the third argument is optional and defaults to the
current throw behaviour, so the hook and rod are untouched apart from the sleeve.

**7a. Sleeve (line 126).** The throw sweep swings the right forearm up toward the eye, and the open end of the 0.32 m
sleeve showed as a green club in the upper right (today too: `09b-use-hammer-kick-legacy.png`,
`19c-throw-legacy.png`). Running the sleeve back past the eye turns it into an arm that leaves the frame
(`19b-throw-follow.png`). The new layer clips it cleanly behind the eye.

```js
    seg(frame, sleeveMat, at(0.24), at(0.56), 0.044, 0.060, 14);   // sleeve (runs off-screen)
```

becomes

```js
    seg(frame, sleeveMat, at(0.24), at(1.10), 0.044, 0.078, 14);   // sleeve (runs back past the eye: no open end on screen in a swing)
```

**7b. Signature (line 14).**

```js
export function createHands(T, hookModel) {
```

becomes

```js
export function createHands(T, hookModel, { use = 'throw' } = {}) {
  const STRIKE = use === 'strike';      // 'throw' (hook, rod): forward sweep; 'strike': short cock-back + downward hit
```

Optionally add a usage line to the header comment after line 5:
`//   const hammerHands = createHands(THREE, hammerModel, { use: 'strike' });   // hammer strike instead of the throw`.

**7c. Strike curve (line 223).** Same `casting` input as the throw (`p` = 0 at the click, 1 when done; the game's
`swing` runs 1 -> 0 in 0.33 s, a pickup starts it at .6 so a pickup is a short tap from the hit pose):

```js
    const a = forward - recoil;                                // throw sweep (+1 = full forward)
```

becomes

```js
    const a = STRIKE ? 0 : forward - recoil;                   // throw sweep (+1 = full forward)
    // strike curve (hammer): cock back 0-.2, hit .2-.36 (impact ~.36, ~120 ms after the click), rebound, recover .5-1
    const sUp = STRIKE && casting > 0 ? smooth(0, 0.2, p) * (1 - smooth(0.2, 0.36, p)) : 0;
    const sHit = STRIKE && casting > 0 ? smooth(0.2, 0.36, p) * (1 - smooth(0.5, 1, p)) : 0;
    const sReb = STRIKE && casting > 0 ? Math.sin(Math.PI * clamp01((p - 0.36) / 0.22)) : 0;
```

**7d. Right arm (lines 243-246 and 249)**: append the strike terms. Each line keeps its current text and gains the
tail shown after `...`:

```js
    const rpx = 0.10 * ce ... - 0.008 * rW + trem
      + 0.02 * sUp - 0.03 * sHit;
    const rpy = -0.10 * ce ... - 0.025 * catchDip + trem * 0.7
      + 0.05 * sUp - 0.065 * sHit + 0.012 * sReb;
    const rpz = 0.20 * ce ... - 0.012 * rW * (pull - 0.5) + 0.02 * sUp - 0.04 * sHit;
    const rrx = 0.40 * ce ... + 0.12 * catchDip + 0.20 * sUp - 0.70 * sHit + 0.10 * sReb;
    const rwx = 0.35 * ce ... + 0.06 * rW * Math.sin(t * 18.85) + 0.30 * sUp - 1.05 * sHit;
```

(`rpx`/`rpy` lose their trailing `;` before the new line.) Cock: fist up and back, hammer head tipped back over the
wrist (`09a-hammer-cock.png`). Hit: fist down and forward, wrist snaps the head down onto the deck
(`09c-hammer-impact.png`). Rebound: a small lift right after impact, then the arm eases back to rest.

**7e. Left arm brace (line 255)**: append `- 0.010 * sHit` to `lpy` (before the `;`), so the coil hand dips with the
blow.

**7f. Debug output (line 277)**: in the `Object.assign(last, {...})` call add `strike: sHit - sUp,` after `throw: a,`
(optional; useful for tests: negative while cocking, positive at the hit).

## Things that do not change

- `options.fov` keeps driving only the world camera (`updateCamera()` line 714). The viewmodel FOV is fixed at 70.
  If a "Hands FOV" setting is wanted later: `vm.setFov(value)` in the `createSettings` `onChange` at line 1183.
- `hook.js`, `hammer.js`, `fishing-tool.js` need no change. `hands.js` changes only as in step 7; other callers of
  `createHands(T, model)` keep the throw.
- Picking (`pickNdc`, line 467) only intersects `itemsGroup`, so the scaled hands never interfere with aim.
- The game's own camera bob (line 716) stays; the viewmodel bob is relative to the camera and sits on top of it.
- `graphics:'low'` turns the shadow map off (line 1183); hands then simply get no shadows, as before.

## Verify

Steps 1-7 were applied verbatim to a scratch copy of `dist/` (a script asserting every quoted line, then the edits) and
the real game was run headless: solo start, hotbar to the hammer, build a floor tile (strike plays: cock, then the
head lands on the deck, frame-stepped), hotbar back to the hook, full charge (whole hook on screen), throw (rope from
the coil). No page errors; the only console errors are two 404s that the unpatched game logs too. `dist/` is
untouched on this branch.

1. `python sandbox/viewmodel/shoot.py` (writes `sandbox/viewmodel/shots/*.png`, prints JSON). Look at
   `11-wall-vm.png` (hook drawn in front of a wall 0.17 m from the eye), `14-shade-vm.png` (hands shadowed under
   the sail, still readable thanks to the fill; `14b-shade-vm-nofill.png` is the same without it), `16-fov95-vm.png`
   vs `17-fov95-legacy.png` (no stretched arms at FOV 95), `18-rope-anchor-vm.png` (rope leaves the coil),
   `09a/09/09c/09d-*` (hammer cock, mid, impact, recover), `19-throw-release.png` / `19b-throw-follow.png` vs
   `19c-throw-legacy.png` (sleeve runs off-screen instead of ending in a club), `04-charge-full.png` (hook fully on
   screen at full charge).
2. In game: place a blocking decor item (anything with a `BLOCK_RADIUS`, see line 366), walk nose-first into it and look
   around: no tool should cut into it. Also stand at the raft edge and look straight down at the deck.
3. Settings, FOV 60 then 95: hand size on screen must not change.
4. Scroll the hotbar hook -> hammer -> rod: the old tool drops out (0.16 s), the new one rises with a small
   overshoot (0.3 s). Scroll fast: it never shows two tools at once.
5. Charge a throw, release: rope must start at the left hand's coil; the hook flight starts there too. At full
   charge the whole hook stays on screen; during the throw the right sleeve runs off the top-right edge.
5b. Hammer: place a floor tile. The hammer cocks back, hits down onto the deck with a small jolt, rebounds, settles.
6. Stand under a sail: hands darken with the deck around you but keep a readable silhouette (`vm.setFill(0, 0)` in
   the console turns the fill off for comparison).
7. `npm test` (no test touches `buildViewmodels`, but run it anyway).
8. Cost check: the patched hand materials compile into their own program (cache key `vm|...`), and the depth-clear
   marker's program goes away. In the lab that is 5 programs with the new layer vs 6 with the marker; draw calls drop
   by one (the marker).
