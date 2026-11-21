# Adopting the new water (tier A)

Checked against `dist/` at `claude/raft-tech` 745f663. You replace one file and add 5 lines to
`dist/game.js`. No new files, no new imports, and no change to any physics consumer.

Short version, from the repo root:

```sh
cp sandbox/water/water.js dist/ocean.js
git apply sandbox/water/adopt-game.diff   # steps 2 and 3 below; verified with git apply --check
```

## 1. Replace `dist/ocean.js`

```sh
cp sandbox/water/water.js dist/ocean.js
```

`water.js` exports `createOcean(T, options)`, which is `createWater(T, { tier: 'a', ...options })`.
It keeps the contract that `dist/game.js` already uses:

| used in game.js                                     | old ocean.js | new                                                                   |
|-----------------------------------------------------|--------------|-----------------------------------------------------------------------|
| `createOcean(T, {sunDirection, skyColor, fadeNear, fadeFar})` | yes | same options                                               |
| `ocean.uniforms.uDeep/uShallow/uZenith.value.set()` (line 290) | yes | same uniform names; new defaults already equal these values |
| `ocean.mesh` (`receiveShadow`, `scene.add`, `.position.y`)     | yes | same; `position.y` is still -.24                             |
| `ocean.update(elapsed[, camera])` (lines 290, 825)  | yes | same; now also re-centres the plane on the camera, snapped to the grid, so it can never be outrun |
| `ocean.getHeight(x, z)` (lines 687, 698, 707, 766, 776) | yes | **bit-identical** (`node sandbox/water/parity.mjs`)             |
| `ocean.getSlope(x, z[, t, e])` (lines 707, 765)     | yes | bit-identical                                                         |
| `ocean.dispose()` (line 1164)                       | yes | same; also frees the SDF texture                                      |

New methods (all optional to call): `setRaft`, `setRaftPose`, `setFloaters`, `footprint(object3d)`,
`setBobber(position | null)`, and `setAmp(a)`. The ocean uniforms `uFloaters` and `uRaft` (vec3) from
earlier drafts of this file are gone (now `uFloatA`/`uFloatB` and a vec4 `uRaft`); `game.js` never used them.

The import line stays as it is:

```js
import { createOcean } from './ocean.js?build=v3-survival-ae77fa84ac2b';
```

`publish_local.py` rewrites every `./x.js?build=` query when it promotes a candidate, so do not
hand-edit the build string.

Physics dependents, checked and needing no change:

- `dist/hook-physics.js`: flat `WATER_Y = 0.05`; never reads the ocean.
- `dist/player-physics.js`: gets `waterY` from `ocean.getHeight` (game.js line 687), which is
  unchanged.
- `dist/debris.js`: its `height()` is debris mesh shaping, not water.
- `dist/waterfx.js` and `dist/sky.js` are not imported by `game.js`. Leave them alone.

## 2. Tell the ocean where the raft is (`dist/game.js`, `rebuildRaft()`, line 353)

After the `world.tiles.forEach(... createFloor ...)` line, add:

```js
    ocean?.setRaft?.(world.tiles);
```

`rebuildRaft()` runs from `init()` (after the ocean is created at line 290), after every build
action (line 579), and after host and guest world syncs (lines 949 and 1025), so the foam always
matches the deck. The bake takes about 2 to 9 ms for 7 to 400 tiles and runs only on those
events. The raft group never moves in x/z (it only bobs and tilts), so the pose stays (0, 0, 0).

## 3. Feed floating items and the hook bobber (`dist/game.js`, `updateItems()`)

Next to `const itemMeshes = new Map();` (line 376), add:

```js
  const floaters = []; // capsule footprints [x, z, r, hx, hz] fed to the ocean for contact foam
```

At the end of `updateItems(dt)`, right after the `for (const it of world.items) { ... m.rotation.set(...); }`
loop closes (after line 768) and before the function's closing brace, add:

```js
    floaters.length = 0; for (const m of itemMeshes.values()) if (m.visible) floaters.push(ocean.footprint?.(m) ?? [m.position.x, m.position.z, .35]);
    ocean.setFloaters?.(floaters, camera.position.x, camera.position.z);
    ocean.setBobber?.(hookMesh?.visible ? hookMesh.position : null);
```

`footprint(m)` measures the item model's local bounding box once (cached in `m.userData`) and
returns a reused `[x, z, r, hx, hz]` capsule: the long horizontal side, turned by the mesh's current
rotation and scale, so a plank gets an elongated band of foam and a jug a small round one. It
assumes `itemsGroup` is untransformed, which it is (line 292). `setFloaters` keeps the 16 items
nearest the camera. Footprints plus the pick cost about 0.02 to 0.1 ms a frame with 30 items. It runs
on host and guest, because it uses the mesh positions that both already update.

`setBobber` gets the hook mesh from the previous frame (`updateHook` runs right after
`updateItems`, line 830), which is invisible at this scale. The ocean decides "on the water" itself
(within .25 m of `getHeight`), so the flying and reeled-in hook get no foam. While it floats it gets a
small collar and ripple rings, plus one splash ring from the moment it lands.

## 4. Verify

1. `node sandbox/water/parity.mjs` should print `"ok":true`.
2. Patch a copy of `dist`, then shoot it and the original:
   `python sandbox/water/shoot_game.py <patched_dist> /tmp/w new` and
   `python sandbox/water/shoot_game.py dist /tmp/w cur`. Expect no errors. Expect
   `new-down.png` to show white collars and lace rings around the raft edge and every item,
   shaded water (not foam) in the plank gaps, and a glittering sun path.
3. In the game: build a floor tile. The foam band should move to the new edge right away. Swim
   (fall off). The swim test still uses the same `getHeight`, so nothing changes.
4. Run the existing checks (`check_game.py`, `check_survival.py`). They do not touch the
   ocean API beyond what is listed above.

## Optional follow-ups

- Rough weather: call `ocean.setAmp(a)` (1 = today's sea, 2.6 = the lab's rough sea). It scales the
  GPU waves and the CPU `getHeight`/`getSlope` table together, so the raft, swimmer and items stay on
  the drawn surface. Never set `ocean.uniforms.uAmp.value` alone. To ease into a storm, call it every
  frame with a lerped value; it is a 4-element loop.
- Graphics "low": `ocean.uniforms.uFoamStart.value = 1` removes the Jacobian part of the crest
  lace. Tall crests still get a little from the height term. Contact foam stays.
