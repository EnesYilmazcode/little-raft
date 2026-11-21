# Foliage: adoption steps

Checked against `dist/` as it is on `claude/raft-tech` and `main` (identical `dist/`; game.js imports use
`?build=v3-survival-ae77fa84ac2b`). Re-verified 2026-11-21 after the improver pass: every search string below
still occurs exactly once in `dist/game.js`, and the line numbers are current.
The work is one new file and four small edits to `dist/game.js`. `dist/crafts.js` does not change.

## 1. Add the module

Copy `sandbox/foliage/foliage.js` to `dist/foliage.js` without changes. It has no imports: the caller passes
`T`, as with `crafts.js` and `ocean.js`. It exports:

- `createFoliage(T, { windDir = [1, .35], strength = .4, lambert = true, sunDir = [-15, 28, 12] })` returns `F`
- `scatter({ count, radius, seed, minDist, accept, heightAt, avoid, scale })` returns a list of placements
- `rng(seed)`
- `FOLIAGE_KINDS`

`F` exposes:

| member | use |
| --- | --- |
| `F.update(elapsed, camera)` | once per frame. Writes the shared `uTime` and eye position, and runs the whole-object LOD toggles |
| `F.swayCraftPalm(group)` | patches a `createCraft(T, 'palm')` group in place. Only trunk, crown, coconuts, fronds and ribs sway; pot and base stay rigid |
| `F.geometry(kind, opts)` | returns a shared `BufferGeometry`. `kind` is one of `palm`, `palmFar`, `palmCard`, `bush`, `fern`, `broadleaf`, `grass` |
| `F.instanced(kind, geo, placements, params = {})` | returns one `InstancedMesh` with sway, shadows, a per-instance tint and a matching `customDepthMaterial`. `params` overrides the material params, e.g. `{dither: [from, to]}` for the LOD crossfade |
| `F.lod(object, maxDist, minDist = 0, center = object.position)` | shows the object only while the camera is within `[min, max)` of `center` |
| `F.patch(material, params)` / `F.depth(material)` | low level: add wind to any Lambert or Standard material |
| `F.wind.uWindStrength.value` | 0 to 1. A weather system can drive it |
| `F.wind.uSunDir.value` | normalised sun direction for the canopy translucency tint. `createFoliage(T, {sunDir})` sets it; the default is game.js `sun.position` (-15, 28, 12). A day/night cycle can copy the sun direction into it |
| `F.dispose()` | disposes every geometry, material and texture that `F` created |

## 2. dist/game.js edits

**a) Import.** Add after line 11 (`import { createCraft } ...`):

```js
import { createFoliage } from './foliage.js?build=v3-survival-ae77fa84ac2b';
```

**b) State and creation.** Line 182 declares `let scene = null, camera = null, renderer = null, ocean = null, ...`.
Add `foliage = null` to that list. Then add this right after the `ocean = createOcean(...)` statement on line 290.
The wind direction matches the ocean's dominant wave (`WAVES[0]` in ocean.js):

```js
foliage = createFoliage(T, {windDir:[1, .35], strength:.4});
```

**c) Raft palm sways.** In `rebuildRaft()`, line 355 currently reads:

```js
let detailed = null; try { detailed = createCraft(T, d.type); } catch (e) { console.warn('craft model failed', e); }
```

Change it to:

```js
let detailed = null; try { detailed = createCraft(T, d.type); if (detailed && d.type === 'palm') foliage.swayCraftPalm(detailed); } catch (e) { console.warn('craft model failed', e); }
```

**d) Per-frame update.** In `frame()`, line 825 is `ocean.update(elapsed, camera);`. Add this after it:

```js
foliage.update(elapsed, camera);
```

**e) Dispose the shadow twins.** `swayCraftPalm` gives five meshes a `customDepthMaterial`. Without this edit, each
`rebuildRaft()` leaks five small materials per palm. Line 255, `disposeGeometry`, currently has:

```js
for (const m of [].concat(c.material || []))
```

Change it to:

```js
for (const m of [].concat(c.material || [], c.customDepthMaterial || []))
```

In `disposeScene()` (line 1164, `try { ocean?.dispose(); } catch {}`), add after it:

```js
try { foliage?.dispose(); } catch {}
```

### Optional: background islands

The 12 decorative islands (line 300) use the cone-leaf `palm()` helper. To make them match, build one
`palmFar` geometry and place one plain mesh per island. Each costs about 600 triangles and one draw call,
which is cheaper than the current 7 cones plus the trunk:

```js
// new line directly before the `for (let i = 0; i < 12; i++)` island loop on line 300:
const farPalm = foliage.geometry('palmFar', {seed:7, lean:.5}), farMat = foliage.material('palmFar', farPalm.userData.foliage);
// inside that loop, replace `palm(g, 0, 1, 0, 1.4);` with (sits on top of the 3.4 m green hill):
{ const pm = new T.Mesh(farPalm, farMat); pm.position.y = 4.3; pm.scale.setScalar(1.1); pm.rotation.y = a; g.add(pm); }
```

`foliage.material` is also exported on `F`. Distant palms do not need shadows. These plain meshes sit at 65 to
90 m, past the crossfade band, so they do not need the `dither` param.

## 3. How an islands module uses it

`sandbox/foliage/island.js` is the reference consumer. It follows the plan in `docs/features/islands.md`
(seeded sand dome, palms, bushes and rocks):

```js
// once per scene, shared by every island
const kit = createFoliageKit(T, foliage);   // 2 palm variants + far LODs, 3 bushes, fern, broadleaf, 2 grasses
// per island (seeded, so co-op peers build the same island from one number)
const island = buildIsland(T, foliage, kit, {seed, radius:7, x, z, density:1});
scene.add(island);
// island.userData.heightAt(x, z) gives the walkable height; island.userData.palms gives gather targets
```

For `dist/islands.js`, copy `createFoliageKit` and the scatter block of `buildIsland` (the code after the
`rocks` block). Keep these rules:

1. Build the kit geometries once. Each island holds only `InstancedMesh`es, roughly 8 to 11 per island
   (2 palms, 2 far palms, 3 bushes, fern, broadleaf, 2 grasses). The meshes share the kit geometries, so
   when an island leaves, call `mesh.dispose()` on each InstancedMesh and dispose its materials with
   `m.material.dispose(); m.customDepthMaterial.dispose()`. Never dispose the kit geometries.
2. Register LOD with the island root's position as the centre, as `buildIsland` does. The current code
   moves the island along z while it drifts. `F.lod` keeps a reference to that position vector, so LOD
   follows the island for free. For the palm crossfade, give the near and far palm meshes complementary
   `dither` ranges and overlapping `F.lod` ranges, exactly as `buildIsland` does:
   `F.instanced(kind, geo, set, {dither:[L + 5, L - 5]})` with `F.lod(near, L + 5)`, and
   `F.instanced('palmFar', farGeo, set, {dither:[L - 5, L + 5]})` with `F.lod(far, 1e9, L - 5)`. The ramp
   uses the distance to the mesh origin, so the InstancedMeshes must be children of the island root at its
   origin (they are in `buildIsland`).
3. Gathering a palm, for example drooping fronds after 3 gathers, means editing that instance:
   `mesh.setMatrixAt(i, ...)` to swap it out, or `setColorAt(i, dryColor)` followed by
   `instanceColor.needsUpdate = true`. The placements list in `island.userData.palms` maps index i to an
   instance.
4. Island ground height: `buildIsland` now defaults to `top: 0.35`, the value in `docs/features/islands.md`
   (branch `wip/feature/islands`). `heightAt(x, z)` returns that dome, so plants and the player share it.
5. Grass recipe: copy `GRASS` (260 tufts, 8 blades, width 1.5, spread 1.7) with `createFoliageKit`. Lower
   `count` first on weak hardware; it is the largest fill cost when the player stands on the island.

## 4. Verify

These exact replacements, including the optional one, were applied by script to a copy of `dist/`
(each search string occurs exactly once in the current `game.js`). That copy was loaded headless with a palm
pre-placed in `decor` (save key `little-raft-v1`), then `#solo` was clicked. Result on 2026-11-21: `running`
true, 0 page errors and 0 console errors, 17 programs, 5 meshes with a `customDepthMaterial` (the craft palm),
12 far-palm meshes on the background islands, and the raft palm renders with the smooth ringed trunk.

1. Run `python sandbox/foliage/shoot.py`. It should report 0 page errors and write PNGs to `sandbox/foliage/shots/`.
2. In game, place a palm decor and stand next to it. The fronds should flutter and the trunk should lean
   gently downwind, while the pot stays still. The shadow on the deck moves with the fronds.
3. Check `renderer.info.programs.length` before and after placing the first palm. It should grow by at most
   about 5: three colour variants (vertex-coloured trunk, plain Standard parts, double-sided fronds) plus two
   depth variants. A second palm adds 0, because programs are shared through `customProgramCacheKey`.
4. Low graphics, with shadows off, still sways. The depth twin is simply unused.
