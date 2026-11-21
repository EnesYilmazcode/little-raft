# First-person viewmodel rendering

How to draw the held hands and tools so they never clip into walls, keep their own FOV when the player changes the
world FOV, light like the world around them (including shadows), and move with sway, bob, breathing, equip, charge
and use animation.

**Decision: single pass, own projection + depth squash in the vertex shader, rig scaled toward the eye
(candidate C below), plus a spring-driven motion layer.** Module: `sandbox/viewmodel/viewmodel.js` (drop-in as
`dist/viewmodel.js`). Adoption: [viewmodel-ADOPT.md](viewmodel-ADOPT.md).

Lab: `sandbox/viewmodel/index.html?mode=vm|legacy|naive&scene=idle|walk|charge|swap|use|look|wall|shade|rod|hammer|rope`
(extra: `fov` world FOV, default 75 = game default; `vmfov` default 70; `motion` = `options.cameraMotion`, default .35;
`ocean=0`; `t=<s>` freeze at a time). It imports the real `dist/hands.js`, `hook.js`, `hammer.js`,
`fishing-tool.js`, `ocean.js` and `deck.js`, and wraps the hammer and rod with the same `holdable()` as
`dist/game.js`, so what you see is the game's viewmodel. `legacy` reproduces `buildViewmodels()` as it ships today.
Headless check: `python sandbox/viewmodel/shoot.py` drives each scene on a fixed 60 Hz clock and writes
`sandbox/viewmodel/shots/*.png` + `report.json`.

## What the game does today

`dist/game.js` `buildViewmodels()` (lines 327-344) parents every hands group to the world camera and adds a tiny
marker mesh at `renderOrder 999` whose `onBeforeRender` calls `renderer.clearDepth()`. All viewmodel materials are
forced `transparent` with `renderOrder 1000` so they draw after the marker. It does stop wall clipping, but:

1. The hands use the world camera's FOV (`options.fov`, 60-95). At 95 they shrink to the middle of the screen and
   the arms stretch toward the corners (`17-fov95-legacy.png`).
2. Every viewmodel material is moved into the transparent queue. Any transparent world object drawn after
   renderOrder 1000 would be lost behind the depth clear, and the hands lose early-z.
3. Hands get `receiveShadow = false`, so they stay fully sunlit under a sail (`15-shade-legacy.png`).
4. It relies on `renderer.state.buffers.depth.setMask`, an internal three.js API.
5. Tool swaps are instant visibility flips; there is no view-level sway, breathing or kick (hands.js animates the arms
   relative to the camera, but nothing reacts to look speed, landing or use).

## Candidates

### A. Depth-clear marker, single scene (what ships)
Zero extra passes, but every problem listed above. Own FOV would need C's vertex patch anyway.

### B. Separate viewmodel scene + camera, two render calls
The classic three.js answer ([forum: rendering a gun on another layer](https://discourse.threejs.org/t/rendering-a-gun-on-another-layer/80805)),
same structure as Bevy's [first-person view model example](https://bevy.org/examples/camera/first-person-view-model/) and
[Flax's FPS weapon pass](https://docs.flaxengine.com/manual/graphics/tutorials/render-fps-weapon.html).
`renderer.autoClear = false; render(scene, camera); clearDepth(); render(vmScene, vmCam)`.
Own FOV is trivial, but the lights must be mirrored by hand every frame (sun direction rotated into camera space, hemi
colors, any future day/night or lantern), shadows need a raycast probe that only gives a binary dim, and a future
post-processing chain needs a render-pass rework ([OpenMW notes](https://gitlab.com/OpenMW/openmw/-/issues/6078)).
Second `render()` call re-runs traversal, sorting and light uniform setup.

### C. Single pass, own projection + depth squash + scale toward the eye (chosen)
How Unreal 5.5+ does it natively: first-person primitives get their own FOV and a "First Person Scale" that pulls them
toward the camera, in the same pass with a compressed depth range
([UE first person rendering](https://dev.epicgames.com/documentation/en-us/unreal-engine/first-person-rendering)).
In three.js it is an `onBeforeCompile` patch on the hand and tool materials:

```js
.replace('#include <project_vertex>', `#include <project_vertex>
  gl_Position = vmProj * mvPosition;                              // own FOV (shared uniform, one Matrix4)
  gl_Position.z = mix(-gl_Position.w, gl_Position.z, vmDepth);    // front 2% of the depth range`)
```

and `rig.scale.setScalar(0.15)` on the camera-attached rig.

- **Clipping.** NDC z of the hands lies in [-1, -0.96]. With the world camera's near .05 / far 200, a world surface
  only gets there closer than ~5 cm from the eye; `PlayerPhysics` keeps the eye 0.25 m (BODY_RADIUS) from anything.
- **Lighting.** `MeshStandardMaterial` lights from view-space normals and `vViewPosition`, which the patch does not
  touch, so hands get the exact world sun, hemi, tone mapping and any future time-of-day with no mirroring code.
- **Shadows.** The hands really exist in world space, so `receiveShadow = true` gives real, soft sail/roof shadows
  (`14-shade-vm.png`). Scale 0.15 keeps the whole rig (even the rod tip) within ~0.25 m of the eye, i.e. inside the
  player's collision radius, so the shadow sampled at the hands is the one the player stands in, never the far side
  of a wall. (The salvage used 0.3, which put the hook tip ~0.3 m out: past a wall at the collision limit.)
- **Fog.** Fog depth comes from `mvPosition.z`, which the scale makes tiny, so hands are never fogged.
- **Sorting.** Hands stay in the opaque queue; their tiny view depth sorts them first, so they early-z reject the
  world pixels behind them instead of overdrawing them.
- **Cost.** Zero extra passes, zero extra lights, one extra mat4 multiply per hand vertex, one program variant per
  distinct material setup (cache key `vm|...`).

Risks: the patch targets `#include <project_vertex>` and `#include <common>` (stable for years; re-check on a three
upgrade). `getWorldPosition` on hand parts returns scaled positions, so anything world-space that starts at the hand
must go through `vm.anchor()` (below). Point lights would light the scaled position (sun and hemi do not care).

## Motion layer (all in viewmodel.js, scaled by `options.cameraMotion / .35`)

The rig is `camera > rig (scale .15) > motion > equip > hands.group`. `hands.js` keeps posing each arm inside it, so
nothing fights. All springs are fixed-step 120 Hz damped springs (same feel at 30 and 144 fps).

| Effect | Drive | Tuning |
|---|---|---|
| Look sway | yaw/pitch rate (wrapped), hands lag and roll into turns | spring k 90 c 12 (slightly under-damped = weight), clamp ±0.045 |
| Walk bob | game's `walkPhase`; figure-eight, vertical in phase with the camera bob (`sin(walkPhase)`) | spring k 160 c 18, 14 mm, fades in/out over ~0.2 s |
| Idle breathing | 0.25 Hz, 3 mm + 0.004 rad, muted 70% while walking | on top of hands.js's own 0.22 Hz arm breathing |
| Jump / land | lift 12 mm while airborne; landing impulse from the last airborne `vy` | spring k 140 c 13 |
| Equip swap | lower old tool 0.16 s (smoothstep), switch visibility at the bottom, raise new 0.30 s (easeOutBack) | down: y -0.42, z +0.10, pitch -0.85 rad |
| Charge | brace: hands drop 12 mm and pull 10 mm in; tension shake over the last 30% | on top of hands.js windup + tremble |
| Use kick | rising edge of the game's `swing` timer (throw, hammer, rod cast, pickup) | spring k 220 c 16 |

Swapping fast never shows two tools: the shown tool only changes at the bottom of the lower phase. On spawn the tool
rises from below (shown starts as null).

## Hand-anchored world effects (rope, hook launch point)

With an own projection the fist's world position no longer sits under the fist's pixels. `vm.anchor(obj, out)` maps
it: take obj's camera-space position, project with the viewmodel matrix to NDC, unproject that NDC through the world
camera to a view ray, and place the point at obj's true (unscaled) distance. `game.js` line 736 (rope start and
`throwHook` origin) switches to it; `18-rope-anchor-vm.png` and an in-game run show the rope leaving the coil.

## Results (headless SwiftShader, 960x540, world FOV 75 unless noted)

Shots in `sandbox/viewmodel/shots/` (git-ignored PNGs; regenerate with shoot.py):

| Shot | What it shows |
|---|---|
| `01-idle` | Hook + rope coil at FOV 70 framing, lit by the world sun/hemi |
| `02/03-walk-bob-*` | Opposite ends of the figure-eight bob |
| `04-charge-full` vs `04b-...-legacy` | Same hands.js windup; vm adds a brace and tension shake |
| `05/06/07/08-equip-*` | Hook lowering, hammer rising with overshoot, hammer settled, rod settled |
| `09-use-hammer-kick` vs `09b-...-legacy` | Kick on use. Both show the sleeve end (see weaknesses) |
| `10-look-sway` | 0.9 rad turn in 0.35 s: hands lag and roll |
| `11-wall-vm`, `12-wall-legacy`, `13-wall-naive` | Wall 0.17 m from the eye (closer than physics allows): vm and legacy draw the hook, naive loses it |
| `14-shade-vm` vs `15-shade-legacy` | Under a sail: vm hands are shadowed like the deck; legacy hands glow sunlit |
| `16-fov95-vm` vs `17-fov95-legacy` | World FOV 95: vm hands unchanged; legacy hands tiny with stretched arms |
| `18-rope-anchor-vm` | Rope leaves the left-hand coil through `vm.anchor` |

Perf (`walk` scene, 120 frames after a 30-frame warm-up; `report.json` has the full output). The machine was shared
with the rest of the fleet while this ran, so the millisecond columns swing 2-5x between runs and the GPU-synced
worst case hit tens of seconds; only the structural `renderer.info` columns are stable.

| Mode | CPU `render()` avg ms (run 1 / run 2) | GPU-synced avg ms | calls | triangles | geometries | textures | programs | `vm.update()` |
|---|---|---|---|---|---|---|---|---|
| vm (proposed) | 1.19 / 3.28 | 719 | 169 | 107,440 | 120 | 1 | 5 | 1.05 us |
| legacy (ships) | 2.55 / 2.17 | 840 | 170 | 107,442 | 121 | 1 | 6 | n/a |
| naive | 0.98 / 9.57 | 946 | 169 | 107,440 | 120 | 1 | 4 | n/a |
| vm, no ocean | 7.60 | 520 | 168 | 87,440 | 119 | 1 | 4 | 0.80 us |
| legacy, no ocean | 4.08 | 590 | 169 | 87,442 | 120 | 1 | 5 | n/a |

Reading: the new layer removes one draw call, one geometry and one program (the depth-clear marker and its
MeshBasicMaterial), adds one program variant for the patched hand materials compared with naive, and costs about
1 microsecond of JS per frame for springs/equip/sway. No extra render pass, no extra shadow pass. The ms columns show no
regression beyond noise; they are not usable as absolute numbers (SwiftShader, shared CPU).

## Weaknesses / open items

- The `hands.js` throw sweep (used for the hammer and rod too) swings the right forearm so far that the open end of
  the 0.32 m sleeve shows as a green club for ~0.1 s. Pre-existing (legacy shows it too). ADOPT step 7 lengthens the
  sleeve to run back past the eye, which the new layer clips cleanly; verified in the lab, not shipped.
- The hammer uses the hook's throw sweep as its "swing"; a real overhead hammer strike needs a hands.js pose, not a
  rendering change.
- Shadows on the hands are effectively one shadow-map sample region (the rig is ~0.25 m wide, the sun shadow map has
  ~5 cm texels over ±25 m), so hands go in/out of shade as a whole with a soft edge, not with a sharp line across the
  fingers.
- Point lights (none today) would light the scaled position near the eye.
- Viewmodel FOV is fixed at 70. Not exposed as a setting.
- SwiftShader timings are noisy (other fleet agents share the CPU); treat them as "no regression" only.
