# Adopting the perf fixes in dist/

Everything below is also in one patch, `sandbox/perf/adopt.patch`, made against the current `dist/` (game.js
build `v3-survival-ae77fa84ac2b`). `git apply --check sandbox/perf/adopt.patch` passes on this branch.
Line numbers refer to the unpatched files. Steps 1 to 6 are independent; apply any subset in any order, but steps 3
and 4 both need step 1 (the import), and step 4 needs `fitShadow()` from step 5 or the call removed.

Measured on the real game: 9-tile raft at spawn, 1280x720, frozen seeded scene, SwiftShader. Full numbers and method are in
`docs/tech/perf.md`. Patched vs stock on the fresh raft: **draw calls 542 -> 253 (-53%)**, main-thread `renderer.render` time -41%,
renderer-process CPU -36%, SwiftShader raster CPU -37%. The frozen-scene screenshots match pixel for pixel (0.0% of pixels
off by more than 8/255). On a 49-tile raft: calls -65% (1026 -> 362).

## 0. Files to add

| new file | source | what |
|---|---|---|
| `dist/merge.js` | copy `sandbox/perf/merge.js` verbatim | `mergeMeshesByMaterial(T, roots, {name, relativeTo})` and `createStaticBatch(T, name)`. No imports; takes `T` like every other dist module. Unit tests: `node --test sandbox/perf/merge.test.mjs`. |
| `dist/perf-overlay.js` (optional, step 7) | copy `sandbox/perf/perf-overlay.js` verbatim | F3 perf panel + opt-in dynamic resolution. |

## 1. Import (game.js line 17)

After `import { createSurvivalUI } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';` add:

```js
import { mergeMeshesByMaterial, createStaticBatch } from './merge.js?build=v3-survival-ae77fa84ac2b';
import { createPerfOverlay } from './perf-overlay.js?build=v3-survival-ae77fa84ac2b'; // only with step 7
```

Keep the `?build=` value identical to the other imports. live.js rewrites `game.js?build=`, and the child imports
carry their own literal query.

## 2. Floating items do not cast shadows (game.js lines 371-374, `itemModel`)

**Why:** the ocean is a `ShaderMaterial` with `lights:false` (dist/ocean.js `createOcean`). It never samples the
shadow map, so `ocean.mesh.receiveShadow = true` (game.js line 290) does nothing, and a floating item's shadow lands
nowhere. Items never rest on the deck: they are picked up into the bag. Each item is 2 to 8 meshes, all
`castShadow = true` (debris.js `mesh()`, plastic.js). **Gain: -163 draw calls per frame with 30 items (-30%), zero visual change.**

Replace the body of `itemModel`:

```js
  function itemModel(item) {
    let g;
    if (item.type !== 'plastic') g = createDebris(T, item.type, mat, {seed:item.id});
    else { const jug = createPlastic(T); g = new T.Group(); jug.rotation.set(Math.PI / 2, 0, .4 + (item.id % 5) * .5); jug.position.y = .05; jug.scale.setScalar(.85); g.add(jug); }
    g.traverse(o => { if (o.isMesh) o.castShadow = false; }); // nothing out at sea receives shadows: skip ~160 shadow draws
    return g;
  }
```

If a later water pass makes the ocean receive shadows, revert this step and step 5 together.

## 3. Bake static scenery (game.js lines 300-301, in `init()`)

**Why:** 12 islands (10 meshes each) and 24 clouds (3 meshes each) are 192 separate objects that never move.
**Gain: -44 draw calls at the spawn view (more when looking toward more islands). Geometry is unchanged, so they look identical.** They lose
per-island frustum culling, but the baked meshes are about 25k triangles in total.

Replace the two `for` lines with:

```js
    const scenery = []; // islands and clouds never move: bake ~190 meshes into one mesh per material (perf)
    for (let i = 0; i < 12; i++) { const g = new T.Group(), a = i * 2.4, d = 65 + rand() * 25; g.position.set(Math.sin(a) * d, -.1, Math.cos(a) * d); cylinder(3, 5, .8, '#e6d7a3', 0, 0, 0, g); sphere(3.4, '#4f9b72', 0, 1.4, 0, g); palm(g, 0, 1, 0, 1.4); scenery.push(g); }
    for (let i = 0; i < 24; i++) { const g = new T.Group(); for (let j = 0; j < 3; j++) sphere(1.3 + j * .35, '#e7f9eb', j * 1.4, Math.sin(j) * .5, 0, g); g.position.set((rand() - .5) * 170, 17 + rand() * 8, (rand() - .5) * 170); g.scale.y = .5; scenery.push(g); }
    for (const m of mergeMeshesByMaterial(T, scenery, {name:'scenery'})) scene.add(m);
    for (const g of scenery) g.traverse(c => c.geometry?.dispose());
```

The `rand()` call order is unchanged, so the islands and clouds land where they did before.
`disposeScene()` still disposes the baked geometries because they are in the scene.

## 4. One growable deck batch instead of 7 meshes per tile (game.js lines 182, 291, 351-353)

**Why:** `createFloor` (deck.js) returns 5 to 7 meshes per tile: 2-3 plank colours, logs, log ends, lashings and nails.
A 9-tile raft is 62 draw calls plus about 50 in the shadow pass, and a 49-tile raft is about 340 plus 290. On top of that,
`rebuildRaft()` currently **regenerates every tile's procedural geometry on every build or decor placement**
(ExtrudeGeometry per plank). That costs about 6 ms CPU per tile: roughly 300 ms of main-thread hitch at 49 tiles
(node, `process.cpuUsage`). The batch keeps one mesh per material for the whole deck and only builds tiles that are new.
**Gain: -82 draw calls at 9 tiles, and several hundred at 49 tiles. Placing a floor or decoration no longer rebuilds
existing tiles, so a 49-tile hitch drops from about 300 ms to about 10 ms. Looks identical: same geometry, same materials.**

Line 182: add `deckBatch` to the scene `let` list:

```js
  let scene = null, camera = null, renderer = null, ocean = null, raft, deckBatch, itemsGroup, ghost, rope, ropeAttr, hookMesh, friend, player, sun;
```

Line 291, after `raft = new T.Group(); ... scene.add(raft);` add:

```js
    deckBatch = createStaticBatch(T, 'raft-deck'); raft.add(deckBatch.group); // all floor tiles, one mesh per material (perf)
```

Lines 352-353 in `rebuildRaft()`: replace the first two statements with:

```js
    for (const c of [...raft.children]) if (c !== deckBatch.group) { raft.remove(c); disposeGeometry(c); }
    // Floor tiles are baked into the deck batch once; a rebuild only builds tiles that are new. If a tile vanished
    // (e.g. a guest received a different raft), start over.
    const key = ([x, z]) => x + ',' + z, want = new Set(world.tiles.map(key));
    if ([...deckBatch.keys].some(k => !want.has(k))) deckBatch.clear();
    const fresh = world.tiles.filter(t => !deckBatch.keys.has(key(t)));
    deckBatch.add(fresh.map(([x, z]) => { const g = createFloor(T, x * 719 + z * 311, mat); g.position.set(x * 2, 0, z * 2); return g; }), fresh.map(key));
    fitShadow();
```

Decor (`createCraft` and the fallback boxes) stays as separate meshes. Nothing raycasts deck meshes: aiming uses
the `plane` at deck height (game.js `pickNdc`), and physics uses `world.tiles`.

## 5. Fit the sun's shadow camera to the raft (new function before `rebuildRaft`, game.js line 351)

**Why:** the shadow camera is a fixed ±25 m box (game.js line 289), so every caster within 25 m (items, palms, the
whole deck underside) is drawn into a 1024² map whose only visible receivers are the deck, the decor and the avatars.
Fitting it to the raft culls the casters out at sea and keeps about the old texel density with a 512² map while the
raft is small. **Gain: -144 shadow draw calls on its own (overlaps step 2 when both are applied) and a 4x smaller
shadow map. Deck shadows get slightly crisper: 2.7 cm per texel instead of 4.9 cm.**

```js
  // The sun's shadow only lands on the deck, decor and avatars (the ocean shader ignores lights), so fit the
  // shadow camera to the raft and size the map to keep roughly the old texel density.
  function fitShadow() {
    const r = Math.max(1, ...world.tiles.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z)))) * 2 + 5, size = r > 14 ? 1024 : 512;
    Object.assign(sun.shadow.camera, {left:-r, right:r, top:r, bottom:-r}); sun.shadow.camera.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  }
```

It is called from step 4's `rebuildRaft()`. Without step 4, call `fitShadow()` as the last line of `rebuildRaft()`.
The +5 m margin covers a 3.8 m sail's shadow at this sun elevation (about 56 degrees). The camera stays centred on the
origin like today, because the raft is always built around tile (0,0).

## 6. Drop the wood bump map (wood.js line 16)

**Why:** the deck covers a third to all of the screen, and each plank pixel samples the bump map 3 extra times (the
derivative), through the colour map's `anisotropy = 4` sampler. At `bumpScale: .018` the result cannot be seen. With and
without the bump map, frozen-scene screenshots differ by 0.01 mean (0-255) and **no pixel by more than 8/255**,
both at the spawn view and looking straight down at the deck from standing height (`shoot.py --look 400`).
**Gain: -34% SwiftShader raster CPU at spawn, -40% looking down. This is the largest single pixel cost found.**

```js
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 // No bumpMap: at bumpScale .018 it changed no pixel by more than 8/255 even looking straight down at the deck, but its
 // 3 extra taps per pixel were ~1/3 of the deck's shading cost (docs/tech/perf.md).
 return new T.MeshStandardMaterial({map:texture,roughness:.86,metalness:0});
```

If art wants the grain relief kept for a future close-up use, there is a conservative alternative: keep the bump map
but give it its own sampler (`const bump = texture.clone(); bump.anisotropy = 1;` and `bumpMap:bump`). That measured -20%
raster at the spawn view, also pixel-identical. Making the relief actually visible would mean raising `bumpScale`,
which is a look change and an art decision.

## 7. Optional: perf overlay and dynamic resolution (game.js lines 61, 820, 842, 1171, 1182-1183)

`createPerfOverlay` is hidden by default and costs two `performance.now()` calls per frame. F3 (or `?perf` in the
URL) shows fps, p95 frame time, main-thread ms, draw calls and triangles including the shadow pass, live
geometries, textures and programs, and the pixel ratio. `?dynres` turns on the dynamic-resolution controller.
It lowers the pixel ratio in 0.15 steps (minimum 0.6) after 1 s over budget, and raises it by 0.1 after 4 s
comfortably under, with the budget taken from the display's measured refresh interval.

```js
// line 61
  let disposed = false, active = false, rafId = 0, perf = null;
// line 820, first line of frame()
    perf?.begin();
// line 842, after renderer.render(scene, camera);
    perf?.end();
// line 1171, in dispose(), after settingsController?.destroy()
    try { perf?.dispose(); } catch {}
// lines 1182-1183: create it after init(), and let the settings cap feed it
    perf = createPerfOverlay({renderer, maxPixelRatio:1.3, dynamic:/[?&]dynres\b/.test(location.search)}); // F3 or ?perf shows it
    settingsController = createSettings({onChange:next => { options = next; if (renderer) { const cap = next.graphics === 'high' ? 1.7 : next.graphics === 'low' ? 1 : 1.3; renderer.setPixelRatio(Math.min(devicePixelRatio, cap)); perf?.setMaxPixelRatio(cap); renderer.shadowMap.enabled = next.graphics !== 'low'; } }, onPause:clearInput, onResume:() => requestLock()});
```

Note: the overlay sets `renderer.info.autoReset = false` and resets in `begin()`, so `renderer.info` then counts the
shadow pass too. Stock three resets it after the shadow pass, which hides about 40% of the real draw calls.
To make dynamic resolution a player-facing option later, add `'auto'` to `GRAPHICS` in settings.js and call
`perf.setDynamic(next.graphics === 'auto')` in `onChange`.

## Not recommended (measured, rejected)

- **Shadow map at 10 Hz** (`shadowMap.autoUpdate = false`): -100 calls, but deck shadows visibly step while the raft
  rocks, and step 5 gets most of the gain without that artefact.
- **Anisotropy 1 on the colour map:** -25% raster, but planks blur at grazing angles (deck diff 0.76, visible on
  the far planks). It could become a `graphics:'low'` option.
- **Lower default pixel ratio:** the biggest raster lever (0.75 gives -28%), but it softens the image. Use step 7's
  dynamic resolution instead of a lower fixed cap.

## How to verify

1. `git apply sandbox/perf/adopt.patch` (or apply the steps by hand), then `node --test tests/survival.test.mjs`
   (22 pass) and `node --test sandbox/perf/merge.test.mjs` (3 pass).
2. `python sandbox/perf/verify_adopt.py` profiles the stock and a patched copy of `dist/` side by side and writes
   `sandbox/perf/results-patched.json` plus `shots/game-stock-baseline.png` / `shots/game-patched-baseline.png`. Add
   `--big` for a 49-tile raft with 12 decorations (`results-patched-big.json`). Expect calls to drop by about half.
   `python sandbox/perf/imgdiff.py shots/game-stock-baseline.png shots/game-patched-baseline.png` should report a deck diff
   below 1 (0-255 scale; 0 is identical).
3. In a browser: `dist/index.html?perf` and press F3. At spawn, calls should read about 250 (stock: about 540 with
   the shadow pass counted). Build a floor with the hammer: there should be no hitch, and calls should stay flat
   (the deck is still 7 meshes). Place a sail: its shadow should fall on the deck as before.
4. Play together: the guest's raft rebuilds through the same `rebuildRaft()`. Joining a host with a different raft
   clears the batch (`deckBatch.clear()`) and rebuilds it.
