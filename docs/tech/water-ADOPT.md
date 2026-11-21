# Adopting the new water (tier A)

Checked against `dist/` at `claude/raft-tech` 20fed47 (`game.js` 1780 lines, sailing, day/night, diving,
islands, wildlife, `quality.js`). You replace one file and add 9 lines to `dist/game.js`. No new files, no
new imports, and no change to any physics consumer.

Short version, from the repo root:

```sh
cp sandbox/water/water.js dist/ocean.js
git apply sandbox/water/adopt-game.diff   # steps 2 to 5 below; git apply --check passes on this dist
node sandbox/water/parity.mjs             # must print "ok":true
```

## 1. Replace `dist/ocean.js`

`water.js` exports `createOcean(T, options)`, which is `createWater(T, { tier: 'a', ...options })`. It keeps
everything the current `dist/ocean.js` offers, checked by `parity.mjs` (it fails if any key of the old
object or of `old.uniforms` is missing):

| contract (users in dist) | new |
|---|---|
| `createOcean(T, {sunDirection, skyColor, fadeNear, fadeFar})` (game.js 384) | same options |
| `uniforms.uDeep/uShallow/uZenith/uSky/uSunColor/uFadeNear/uFadeFar` (game.js 384, materials.js `applyOceanLook`) | same names |
| `uniforms.uSky/uZenith/uDeep/uShallow/uSunDir/uSunColor/uFadeFar/uFoam` retinted every frame by daynight.js | same names; the deck shadow and the backlit tint follow `uSunDir` (see below) |
| `uniforms.uFlow` (vec2) written each frame by sailing-world.js | same: waves, `getHeight` and the drifting detail (ripples, glitter, lace, colour patches) all use it, exactly as dist |
| `uniforms.uTime/uSky/uSunDir/uFadeNear/uFadeFar/uShallow/uDeep/uSunColor/uFoam` shared by the lagoon (islands-models.js) | same names and types |
| `material.vertexShader` reused by the lagoon (islands-models.js) | still self-contained; see "Lagoon" below |
| `mesh` (`renderOrder = 10`, `scene.add`, `position.y`, `.visible` toggled by diving.js) | same; `position.y` is still -.24 |
| `update(t[, camera])` (game.js 384, 1222) | same; also re-centres the plane on the camera, snapped to the grid |
| `getHeight(x, z)` (game.js, coop-fx, diving, underwater-fx, fishing-v2, islands, wildlife) | **bit-identical**, with any `uFlow` |
| `getSlope(x, z[, t, e, out])` | bit-identical, incl. the `out` form |
| `sample(x, z, out?, t?, e?)` (game.js `updateRaft`, `updateItems`) | bit-identical |
| `dispose()` (game.js 1719) | same; also frees the three textures |

`parity.mjs` compares 100,800 points over 36 time steps and four `uFlow` offsets (0, small, ~1000 m and
near the +-65536 wrap): worst difference 0. The CPU wave code is the current dist code (flat table, no
allocation); `setAmp` only rescales its amplitude columns.

New methods (all optional): `setRaft`, `setRaftPose`, `setFloaters`, `footprint(object3d)`,
`setBobber(position | null)`, `setAmp(a)`, `setQuality(preset)`.

The import line stays as it is (`publish_local.py` rewrites the `?build=` query; do not hand-edit it):

```js
import { createOcean } from './ocean.js?build=v3-survival-ae77fa84ac2b';
```

Physics and render dependents, checked, needing no change:

- `hook-physics.js` (flat `WATER_Y`), `player-physics.js` (gets `waterY` from `getHeight`), `debris.js`
  (`height()` is mesh shaping).
- `diving.js` / `underwater-fx.js`: read `getHeight` only, and hide `ocean.mesh` while the camera is
  underwater (the fx draws its own ceiling). The new material is front-side like the old one, so if the fx
  fails and diving gives the surface back, the view from below is the same as today (culled).
- `daynight.js`: copies its originals of the 8 ocean uniforms at start and restores them on dispose; all
  exist with the same types.
- `sailing-world.js`: writes `uniforms.uFlow` only. The raft group never moves in x/z or turns (the world
  and the water move past it), so the raft SDF stays at the origin; `setRaftPose` (step 4) costs nothing.
- `islands.js`, `wildlife.js`, `coop-fx.js`, `fishing-v2.js`: `getHeight` / `mesh.position.y` only.

### Day/night: moving sun

`daynight.js` rewrites `uSunDir` every frame (sun by day, moon by night). The water reads it in
`mesh.onBeforeRender`, after every system has written its uniforms: it renormalises it, derives the
horizontal sun direction for the backlit crest tint, and re-bakes the fake deck shadow once the light has
turned by 1.5 degrees (every ~5 s of a 20 minute day, plus once when the light swaps to the moon). The re-bake
stamps the shadow channel only, within 1.5 m of each tile: ~0.3 ms for the starter raft.

### Lagoon (islands-models.js)

The lagoon is a `ShaderMaterial` built from `ocean.material.vertexShader` with only its own uniforms and no
defines. The water's vertex shader keeps that working: the ocean's own material has the define
`WATER_OCEAN`; without it the waves use amplitude 1 (instead of `uAmp`) and the vertex skips the raft
texture, so the lagoon rides on the same default sea as today.

## 2. Tell the ocean where the raft is (`rebuildRaft()`, line 494)

After `raft.add(createRaftMesh(...))`:

```js
    ocean?.setRaft?.(world.tiles); // water: contact foam + deck shadow follow the deck
```

`rebuildRaft()` runs from `init()` (line 407, after the ocean exists), after every build action (877), on
world load (1420) and on guest world syncs (1505).

## 3. Graphics preset (`init()` line 384 and `applyOptions()` line 1010)

```js
    ocean.setQuality?.(options.graphics); // after createOcean
    ocean?.setQuality?.(next.graphics);   // in applyOptions, after quality.setCap
```

`quality.js` has user presets `low / medium / high` and an adaptive ladder inside each (pixel ratio, shadow
map size, shadows on/off). Water mapping:

| preset | water |
|---|---|
| high, medium | full tier A |
| low | `WATER_LOW`: no crest lace, no glitter (constant sun path), 2 of 5 ripple normals. Contact foam, deck shadow, item lace and colour stay |

`setQuality` recompiles the shader, so it is tied to the user preset (a menu action), not to the adaptive
ladder that steps every few seconds; the ladder's pixel-ratio steps already scale the water's cost, which is
all per pixel.

## 4. Raft pose (`updateRaft()`, after the tilt lines)

```js
    ocean.setRaftPose?.(raft.position.x, raft.position.z, raft.rotation.y); // water: returns at once while the raft only bobs
```

Today it always returns at once (x, z and yaw never change). If a future sailing pass turns or moves the raft
group, the foam and shadow follow: a move only updates a uniform, a turn re-bakes the shadow once per degree.

## 5. Floating items and bobbers (`updateItems()`)

Next to `const itemMeshes = new Map();` (line 524):

```js
  const floaters = []; let fcBobber; // water: capsule footprints [x, z, r, hx, hz] for contact foam; the rod bobber of fishing-v2
```

At the end of `updateItems(dt)`, after the item loop:

```js
    floaters.length = 0; for (const m of itemMeshes.values()) if (m.visible) floaters.push(ocean.footprint?.(m) ?? [m.position.x, m.position.z, .35]);
    if (fcBobber === undefined) fcBobber = scene.getObjectByName('fcBobber') ?? null;
    ocean.setBobber?.(bobber?.visible ? bobber.position : hookMesh?.visible ? hookMesh.position : fcBobber?.visible && fcBobber.parent ? fcBobber.position : null);
    ocean.setFloaters?.(floaters, camera.position.x, camera.position.z);
```

Items drift with `sailFlow` in world space, so their foam follows them. Three things can float on a line: the
game's rod float (`bobber`), the scrap hook (`hookMesh`), and fishing-v2's `fcBobber` (looked up once by
name). The ocean decides "on the water" itself (within .25 m of `getHeight`), so a flying or reeled hook gets
no foam. Positions are from the previous frame (`updateHook` and `fc.update` run after), which does not show.
Footprints plus stamping cost about 0.02 to 0.1 ms a frame with 30 items.

## 6. Verify

1. `node sandbox/water/parity.mjs` prints `"ok":true`.
2. `python sandbox/water/shoot_game.py cur <out>` and `python sandbox/water/shoot_game.py new <out>` (`new`
   copies `dist/` to a temp dir, drops in `water.js` and applies the diff). Expect no errors. Compare
   `*-down` (collar, lace and shaded plank gaps at the raft edge, lace around items), `*-cast`,
   `*-noon / -dusk / -night` (the deck shadow moves with the sun; at night the sea follows the palette),
   `*-under / -under-up` (identical: the fx hides the ocean), `*-sail` (no seams, foam stays on the raft
   while the water drifts). `gpuCpuMs` should be within ~10% of `cur`.
3. `npm test`: same result patched and unpatched (see `docs/tech/water.md` for the last run).

## Optional follow-ups

- Rough weather: `ocean.setAmp(a)` scales the GPU waves and the CPU tables together (never set
  `uniforms.uAmp` alone). `daynight.js` has a wind value per weather that could drive it. The lagoon would
  stay at amplitude 1, so pass `uAmp` through to it first (one shared uniform in islands-models.js plus
  defining `WATER_OCEAN` there).
- The lagoon does not share `uFlow`, so while sailing its waves are offset from the sea's (an existing
  dist issue, unchanged by this). Sharing `uFlow: shared('uFlow', new T.Vector2())` in
  `islands-models.js` fixes it.
- Wake lace for wildlife at the surface (dolphin, turtle): pass their meshes through `footprint` into the
  same `floaters` list.
