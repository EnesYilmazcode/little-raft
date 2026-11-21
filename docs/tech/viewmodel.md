# First-person viewmodel rendering

How to draw the held hands and tools so they never clip into walls, keep their own FOV when the player changes the world FOV, light like the world around them, and move with sway, bob and recoil springs.

Prototype: `sandbox/viewmodel/` (open `index.html?mode=naive|marker|twopass|shader`, extra params `fov`, `vmfov`, `wall=0`, `shade=1`, `still=1`). It imports the real `dist/hands.js` and `dist/hook.js`, so what you see is the game's actual viewmodel. Headless check: `python sandbox/viewmodel/shoot.py <out_dir>`.

## What the game does today

`dist/game.js` `buildViewmodels()` parents every hands group to the world camera and adds a tiny marker mesh at `renderOrder 999` whose `onBeforeRender` calls `renderer.clearDepth()`. All viewmodel materials are forced `transparent` with `renderOrder 1000` so they draw after the marker. It works against walls, but:

1. The hands use the world camera's FOV (`options.fov`). At FOV 95 they shrink and the arms stretch toward the screen corners (compare `marker` and `twopass` in the screenshots below).
2. Every viewmodel material is moved into the transparent queue, which sorts per object back to front and disables any future opaque-only optimizations. Any real transparent world object drawn after renderOrder 1000 (none today) would be lost behind the depth clear.
3. Hands get `receiveShadow = false`, so they stay fully sunlit under the sail.
4. It relies on `renderer.state.buffers.depth.setMask`, an internal API.

## Candidate A: keep the depth-clear marker, single scene

What ships now (`mode=marker`).

```js
const marker = new T.Mesh(new T.PlaneGeometry(1e-4, 1e-4),
  new T.MeshBasicMaterial({colorWrite:false, depthWrite:false, depthTest:false, transparent:true}));
marker.frustumCulled = false; marker.renderOrder = 999; marker.position.z = -.1;
marker.onBeforeRender = (r, _s, cam) => { if (cam !== camera) return; r.state.buffers.depth.setMask(true); r.clearDepth(); };
camera.add(marker);
viewmodelMeshes.forEach(m => { m.renderOrder = 1000; m.material.transparent = true; });
```

| | |
|---|---|
| Cost | Zero extra passes. One extra depth clear (cheap). |
| Own FOV | No. Would need approach C's vertex patch on top. |
| Lighting | Free: same scene, same lights. No shadows on hands. |
| Risk | Internal API, transparent-queue hack, ordering fragility. |

## Candidate B: separate viewmodel scene and camera, two render calls

The classic three.js answer ([forum: rendering a gun on another layer](https://discourse.threejs.org/t/rendering-a-gun-on-another-layer/80805), [always render a mesh on top](https://discourse.threejs.org/t/always-render-an-custom-mesh-on-top/47635)), and the same structure as Bevy's [first-person view model example](https://bevy.org/examples/camera/first-person-view-model/) (world camera 90 degrees, view model camera 70 degrees, light shared across both layers). Flax documents the same split pass with its own projection and "only sunlight" lighting ([Flax: render FPS weapon](https://docs.flaxengine.com/manual/graphics/tutorials/render-fps-weapon.html)).

```js
const vmScene = new T.Scene(), vmCam = new T.PerspectiveCamera(62, aspect, .01, 10);
const vmHemi = new T.HemisphereLight(), vmSun = new T.DirectionalLight();
vmScene.add(vmHemi, vmSun, vmSun.target, rig);         // rig holds hands.group; vmCam stays at the origin
renderer.autoClear = false;

function render() {
  vmHemi.color.copy(hemi.color); vmHemi.groundColor.copy(hemi.groundColor); vmHemi.intensity = hemi.intensity;
  camera.getWorldQuaternion(q).invert();                // world sun direction -> camera space
  vmSun.position.copy(sun.position).sub(sun.target.position).normalize().applyQuaternion(q);
  vmSun.intensity = lerp(vmSun.intensity, sun.intensity * (eyeInShade() ? .25 : 1), dt * 8);
  renderer.clear(); renderer.render(scene, camera);
  renderer.clearDepth(); renderer.render(vmScene, vmCam);
}
```

`eyeInShade()` is a raycast from the eye toward the sun against a short list of occluders (sail, roof), run every 8th frame. It gives a binary dim, not real shadow edges.

| | |
|---|---|
| Cost | Second `render()` call: re-runs scene traversal, sorting and light uniform setup for the small scene. No second shadow pass as long as `vmSun.castShadow` is false. Draw calls unchanged (85 in both modes in the sandbox). |
| Own FOV | Yes, trivially. |
| Lighting | Must be mirrored by hand every frame (sun direction, colors, hemi, time of day, lantern if any). Shadows only via a probe. Fog off (fine for hands). |
| Risk | Light drift when someone changes the world lights and forgets the mirror. `autoClearDepth` between passes only works on the default framebuffer, so a future post-processing chain needs a render-pass rework ([OpenMW notes post-processing wants the viewmodel depth too](https://gitlab.com/OpenMW/openmw/-/issues/6078)). Anything placed in world space at the hand (rope start) needs the projection mapping below. |

## Candidate C: single pass, shrink toward the eye plus own projection in the vertex shader (recommended)

This is how Unreal 5.5+ does it natively: first-person primitives get their own FOV and a "First Person Scale" that pulls them toward the camera, rendered in the same pass with a compressed depth range ([UE first person rendering](https://dev.epicgames.com/documentation/en-us/unreal-engine/first-person-rendering)). In three.js it is a tiny `onBeforeCompile` patch on the hand materials (`mode=shader`):

```js
const vmProjCam = new T.PerspectiveCamera(62, aspect, .01, 200);   // keep aspect in sync on resize
const uniforms = { vmProj:{value:vmProjCam.projectionMatrix}, vmDepth:{value:.02} };
for (const mesh of viewmodelMeshes) {
  mesh.frustumCulled = false;  mesh.receiveShadow = true;  mesh.castShadow = false;
  mesh.material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 vmProj;\nuniform float vmDepth;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        gl_Position = vmProj * mvPosition;                                  // own FOV
        gl_Position.z = mix(-gl_Position.w, gl_Position.z, vmDepth);        // front 2% of depth range`);
  };
  mesh.material.customProgramCacheKey = () => 'viewmodel';
}
rig.scale.setScalar(.3);   // perspective is scale-invariant about the eye: same picture, 0.3x the distance
camera.add(rig);
```

Why it works:

- **Clipping.** Clip-space z is squashed into NDC [-1, -0.96]. With near .05 and far 200, a world surface only reaches that range closer than about 5 cm from the eye, which player collision never allows.
- **Lighting.** `MeshStandardMaterial` lights from `vViewPosition` and view-space normals, which the patch does not touch, so hands get the exact world lights, hemi, tone mapping and time of day with no mirroring code.
- **Shadows.** The hands really exist in world space, so `receiveShadow` gives real sail and roof shadows with soft edges. The 0.3x shrink keeps them inside the player's head, otherwise pressing against a wall would put the hand's true position on the far side and shadow it.
- **Fog.** Fog depth comes from `mvPosition.z`, which the shrink makes tiny, so hands are never fogged.

| | |
|---|---|
| Cost | Zero extra passes, zero extra lights, one extra mat4 multiply per hand vertex. One shader program variant per material type. |
| Own FOV | Yes, a uniform. |
| Lighting | Identical to the world, including real shadows. |
| Risk | The patch string targets `#include <project_vertex>` (stable since r1xx, check on upgrade). Raycasts and `getWorldPosition` on hand parts return shrunk positions. Point lights would light the shrunk position (sun and hemi do not care). |

## Screenshots (headless, SwiftShader, world FOV 95, wall 0.32 m in front of the eye)

| Mode | Result |
|---|---|
| `naive` | Hands entirely hidden behind the wall. |
| `marker` (current game) | Visible, but small with stretched arms at FOV 95. |
| `twopass` | Visible at FOV 62, correct framing. |
| `shader` | Pixel-identical framing to `twopass`. |
| `twopass&shade=1` | Probe dims the whole hand uniformly. |
| `shader&shade=1` | Real sail shadow on hands and hook, matching the ground shadow. |

Frame CPU time in SwiftShader (render call only, 120-frame mean, noisy, software GL): marker 11.5 ms, twopass 11.9 ms, shader 8.2 ms, same 85 draw calls. Treat these as "no regression" rather than real laptop numbers.

## Hand-anchored world effects (rope, hook launch point)

With B or C the hand's on-screen position no longer matches its world position. Map a viewmodel point to the world ray under that pixel:

```js
// p: point in camera space as the viewmodel sees it (for C, divide by the shrink first)
function vmToWorld(p, depth, out) {
  out.copy(p).applyMatrix4(vmProjCam.projectionMatrix);           // viewmodel NDC
  out.z = .5; out.applyMatrix4(camera.projectionMatrixInverse)     // back through the world camera
     .normalize().multiplyScalar(depth).applyMatrix4(camera.matrixWorld);
  return out;
}
```

`depth` is the hand's real distance (about 0.6 m) so the rope starts at the visible fist. `dist/game.js` uses `hookHands.handTip.getWorldPosition(handPos)` today; that line would route through this helper.

## Sway, bob and recoil springs

The sandbox uses one damped spring class, stepped at a fixed 120 Hz so the feel is identical at 30 and 144 fps (pattern also used by the Roblox FE Gun Kit's sway/speed/velocity springs, [devforum](https://devforum.roblox.com/t/fe-gun-kit-camera-sway/2886762)):

```js
class Spring3 {
  constructor(k = 120, c = 14) { this.k = k; this.c = c; this.x = new V3(); this.v = new V3(); this.target = new V3(); this.acc = 0; }
  impulse(v) { this.v.add(v); }
  update(dt) {
    this.acc = Math.min(this.acc + dt, .1);
    while (this.acc >= 1/120) { const h = 1/120; this.acc -= h;
      for (const a of 'xyz') { this.v[a] += (this.k * (this.target[a] - this.x[a]) - this.c * this.v[a]) * h; this.x[a] += this.v[a] * h; } }
    return this.x;
  }
}
sway.target.set(-yawRate * .012, pitchRate * .012, 0);              // hands lag the look
bob.target.set(sin(ph/2) * .012, -abs(sin(ph/2)) * .016, 0);        // figure-eight walk bob
recoil.impulse(new V3(0, .6, 1.6));                                  // on throw / hammer hit
rig.position.set(s.x + b.x, s.y + b.y + r.y * .02, r.z * .04).multiplyScalar(rig.scale.x);
rig.rotation.set(s.y * 2 + r.y * .08, s.x * 2, -s.x * 1.5);
```

Tuning notes: sway k 90 / c 12 (slightly under-damped, reads as weight), bob k 160 / c 18 (follows the walk phase without overshoot), recoil k 220 / c 16 (snappy kick, one small overshoot). Scale all three by `options.cameraMotion` so the existing comfort slider covers them. `hands.js` already does its own per-arm pose animation; the springs move the parent `rig`, so the two compose without fighting.

## Recommendation

Adopt C. It fixes the FOV distortion and the unshaded hands, deletes the transparent-queue hack and the internal depth-mask call, adds no render pass, and needs no light mirroring as the day/night and weather work lands. Implementation in `game.js`: replace the marker block in `buildViewmodels()` with the material patch and `rig.scale.setScalar(.3)`, add a `viewmodelFov` option (default 62), update `vmProjCam.aspect` in the resize handler, route rope start through `vmToWorld`. Keep B as the fallback if a future post-processing chain needs the hands in a separate buffer.
