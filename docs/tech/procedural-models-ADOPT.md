# Adopting the low-poly props in `dist/`

Background and numbers: `docs/tech/procedural-models.md`. Prototype: `sandbox/procedural-models/`.

These steps were checked against the current `dist/game.js` (imports on lines 8–16, `mat()` on line 244,
`disposeGeometry` on line 255, `rebuildRaft()` on line 351, `itemModel()` on line 371).

`sandbox/procedural-models/lowpoly-props.js` has no imports. THREE is passed in as `T`, the same way the
current builders work. It exports the four game entry points with the same signatures and return contracts:

| current function (file) | replacement in `lowpoly-props.js` | contract kept |
|---|---|---|
| `createFloor(T, index, getMaterial)` (`dist/deck.js`) | `createFloor(T, index, getMaterial?)` | Returns a `Group` named `raft-floor`. Local x,z are in [-1, 1] and y is in [0, ~0.21]. The walk surface is at `FLOOR_TOP = 0.2`. `userData.{kind:'floor', index, topY, bounds, dispose()}` are set. Output is deterministic per `index`. `getMaterial` is accepted and ignored. `FLOOR_TOP` and `FLOOR_BOUNDS` are exported too. |
| `createDebris(T, type, getMaterial, opts)` (`dist/debris.js`) | same signature, types `wood`/`leaf`/`scrap`/`barrel` | Throws on an unknown type. The root `Group` is untransformed and has one child, `debris-<type>-model`, centred on the origin. The model fits the same xz footprints (1.6/1.75/1.2/1.25). `opts.seed` and `opts.tilt` work as before. The barrel keeps its `barrel-tilt` pivot. `userData.{type, size, localMaterials: []}` are set. |
| `createPlastic(T)` (`dist/plastic.js`) | `createPlastic(T)` | Returns a `Group` named `plastic`, about 0.6 × 0.71 × 0.38 and centred. `userData.{type:'plastic', size, dispose()}` are set. `dispose()` frees geometry only. |
| `createCraft(T, type)` (`dist/crafts.js`) | `createCraft(T, type)`, types `sail`/`palm`/`lantern`/`net`/`bench`/`crate` | Returns `null` for an unknown type. The origin is the floor top centre, and the model builds up from y = 0 inside about 1.7 × 1.7 (the crate's rope handles reach 1.05). `userData.{craftType, size, height}` are set. Glass and flame meshes set `userData.glass = true` and have shadows off. |

One behaviour changes. Materials are now **shared** at module level: 4 in total (`lp-solid`, `lp-cloth`,
`lp-glass`, `lp-glow`), each with `material.userData.shared = true`. The old builders created materials on every
call (crafts, plastic, debris metal), and `disposeGeometry()` disposed them. That has to skip shared materials
(step 3).

## Steps

1. **Add the module.** Copy it verbatim:
   ```sh
   cp sandbox/procedural-models/lowpoly-props.js dist/lowpoly-props.js
   ```

2. **Switch the imports in `dist/game.js`.** Lines 8, 9, 11 and 16 become one import. Use the same `?build=` token
   as the other imports in the file (today `v3-survival-ae77fa84ac2b`; bump it with the release as usual):
   ```js
   // remove:
   import { createFloor } from './deck.js?build=v3-survival-ae77fa84ac2b';
   import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
   import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
   import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
   // add:
   import { createFloor, createDebris, createCraft, createPlastic } from './lowpoly-props.js?build=v3-survival-ae77fa84ac2b';
   ```
   Keep `import { createWoodMaterial } from './wood.js...'` (line 5). `mat()` still uses it for the fallback
   boxes and the island palms. The call sites (`rebuildRaft()` line 353/355 and `itemModel()` line 372/373) do not
   change. They already pass `(T, index, mat)`, `(T, d.type)`, `(T, item.type, mat, {seed:item.id})` and `(T)`.

   You can also adopt in parts: replace only one of the four imports. Each function is independent.

3. **Don't dispose shared materials.** Line 255, `disposeGeometry`:
   ```js
   // before
   ... for (const m of [].concat(c.material || [])) if (!cached.has(m) && m !== clothMat) materials.add(m); ...
   // after
   ... for (const m of [].concat(c.material || [])) if (!cached.has(m) && m !== clothMat && !m.userData?.shared) materials.add(m); ...
   ```
   Without this the game still works, because three.js re-initialises a disposed material the next time it is used.
   But every item pickup and every raft rebuild would recompile the shared programs, which causes a hitch.
   `disposeScene()` (line 1152) may keep disposing everything at teardown. That is correct, since the next
   `mount()` re-uploads.

4. **Optional cleanup.** `dist/deck.js`, `dist/debris.js`, `dist/crafts.js` and `dist/plastic.js` are no longer
   imported by `game.js`. Nothing else in `dist/` imports them (checked with
   `grep -rn "deck.js\|debris.js\|crafts.js\|plastic.js" dist`). Delete them once the release is accepted, or keep
   them for one release as a fallback.

## Verify

- Run `python sandbox/procedural-models/shoot.py`. This renders `shots/compare_*.png`, `shots/grid_*.png` and
  `shots/scene.png`, and prints the stats JSON. In the `scene` stats the new raft should show about 5× fewer draw
  calls and triangles than `current`.
- In the game (`python shoot.py` at the repo root, or `python publish_local.py` and open it), check these:
  - The floor, hover highlight and walking height are unchanged. `FLOOR_TOP` is still 0.2, and the planks sit
    0–7 mm below it as before.
  - Floating items bob, can be picked (raycast against `itemsGroup` children, recursive) and despawn without
    console errors.
  - Placing every decor type (`sail palm lantern net bench crate`) works and `BLOCK_RADIUS` still matches. The
    footprints are unchanged.
  - Hot-swap (`live.js` update) and `dispose()` throw no errors. In devtools, `renderer.info.programs.length`
    stays flat while you pick up items. If it climbs, step 3 is missing.
- Expected in-game cost (SwiftShader, relative): the 3×3 raft with all six crafts and 7 floating items drops
  from 137 to 28 draw calls in the main pass. The shadow pass also roughly halves, and materials drop from 78 to 5.
