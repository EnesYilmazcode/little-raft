# Foliage: adoption steps

Checked against `dist/` at main `8d21618` (on `claude/raft-tech`; game.js 2284 lines, islands.js 472,
islands-models.js 276, crafts.js 644, daynight.js 729, live.js 382; every dist import, islands.js's included, uses
`?build=v3-survival-ae77fa84ac2b`). `sandbox/foliage/adopt_check.py` reads
this file, applies every edit below to a temporary copy of `dist/` (each `find` must occur exactly once), runs
`node --check` and the test suite on it, boots it headless, visits an island and hot-swaps it through `live.js`.
The edits are machine-read: keep the `#### A<n> · <file>` headings and the `js find` / `js replace` fences intact.

What the adoption gives:

- Island palms and bushes (the gatherable nodes from `islands.js`) are built by `foliage.js`: smooth ringed
  trunks that follow islands.js's own spine, 10-frond crowns with folded leaflets, dry fronds, GPU wind, shadow
  twins. The spent palm is the same palm with every frond dry and drooped.
- Cosmetic undergrowth on each island (ferns and elephant ears round each palm base, a green tuft lawn under the
  palms, pale beach grass on the open sand). No pick, no collision, deterministic from the island seed.
- The raft palm decor sways and gets the same smooth ringed trunk (`crafts.js`).
- Wind strength follows daynight.js weather (`W_WIND`: calm 0.15 -> 0.39, breezy 0.7 -> 0.88, rain 0.5 -> 0.7); the
  canopy tint follows its sun because foliage shares `ocean.uniforms.uSunDir`, which daynight.js rewrites every frame
  (`daynight.js:528`).

Retired since `3c62305` (former A8/A9): the 12 cone-palm background islands are gone. Main now draws 4 distant
islands with `scenery-islands.js` (`game.js:461`), whose bent palms are merged into one static mesh per island with
the rock and sand, so there is no separate palm to swap for `palmFar`. `F.geometry('palmFar')` stays available
but nothing in this adoption uses it.

## 1. New files

- copy: `sandbox/foliage/foliage.js` -> `dist/foliage.js`
- copy: `sandbox/foliage/islands-foliage.js` -> `dist/islands-foliage.js`

Both are copied unchanged and have no imports (the caller passes `T`). `foliage.js` exports `createFoliage(T, opts)`,
`scatter`, `rng`, `shaderVersion` and `FOLIAGE_KINDS`; `islands-foliage.js` exports `foliageIslands(T, F, models, opts)`.

`F` (from `createFoliage`):

| member | use |
| --- | --- |
| `F.update(elapsed, camera, windTarget?)` | once per frame: shared `uTime`, eye position, whole-object LOD; eases `uWindStrength` toward `windTarget` when given |
| `F.swayCraftPalm(group)` | patches a `createCraft(T, 'palm')` group in place (trunk, crown, coconuts, fronds, frondRibs). Works after `preparePlanter` too |
| `F.geometry(kind, opts)` | shared `BufferGeometry`: `palm`, `palmFar`, `palmCard`, `coconuts`, `bush`, `fern`, `broadleaf`, `grass`. Palm opts: `seed`, `height`, `lean`, `points` (explicit spine), `coconuts:false`, `dry`, `frondScale` |
| `F.material(kind, params)` / `F.instanced(kind, geo, placements, params)` | swaying Lambert material / one `InstancedMesh` with shadow twin |
| `F.depth(material)` | swaying `MeshDepthMaterial` twin, also stored on `material.userData.foliageDepth` |
| `F.lod(object, max, min, center)` | object visible only while the eye is in `[min, max)` of `center` |
| `F.dispose()` | disposes every geometry, material and texture F created, and with them their depth twins |

Lifetime rule: a depth twin is disposed by a `dispose` listener on its source material. Anything that disposes the
visible material (`F.dispose`, `disposeGeometry` on `rebuildRaft`, `disposeScene` on a hot swap, islands
`models.dispose`) frees the twin and its program too. Program cache keys are `'foliage' + shaderVersion() + flags`,
where `shaderVersion()` hashes the GLSL and `createFoliage`'s source, so a build that changes the shader never
reuses a stale program left in a reused renderer.

## 2. dist/game.js

#### A1 · dist/game.js · import

```js find
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
```

```js replace
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createFoliage } from './foliage.js?build=v3-survival-ae77fa84ac2b'; // foliage: swaying palms and island plants (docs/tech/foliage.md)
```

#### A2 · dist/game.js · state

```js find
let scene = null, camera = null, renderer = null, quality = null, ocean = null,
```

```js replace
let scene = null, camera = null, renderer = null, quality = null, ocean = null, foliage = null,
```

#### A3 · dist/game.js · create after the ocean (shares the ocean's sun direction, which daynight.js drives)

```js find
ocean.mesh.renderOrder = 10; scene.add(ocean.mesh); ocean.update(elapsed);
```

```js replace
ocean.mesh.renderOrder = 10; scene.add(ocean.mesh); ocean.update(elapsed); foliage = createFoliage(T, {windDir:[1, .35], strength:.4, sunDirUniform:ocean.uniforms.uSunDir});
```

#### A4 · dist/game.js · expose to content modules (islands.js reads `ctx.foliage`)

```js find
get ocean() { return ocean; },
```

```js replace
get ocean() { return ocean; }, get foliage() { return foliage; },
```

#### A5 · dist/game.js · raft palm sways (in `rebuildRaft()`, game.js:612)

```js find
?? createSignalModel(T, d.type) ?? content?.decorModel(d.type, d) ?? null); } catch (e) { console.warn('craft model failed', e); }
```

```js replace
?? createSignalModel(T, d.type) ?? content?.decorModel(d.type, d) ?? null); if (detailed && d.type === 'palm') foliage?.swayCraftPalm(detailed); } catch (e) { console.warn('craft model failed', e); }
```

#### A6 · dist/game.js · weather wind helper (next to the cone `palm()` helper, game.js:601)

```js find
  function palm(parent, x, y, z, s = 1) {
```

```js replace
  function foliageWind() { for (const m of content?.mods || []) if (m.name === 'daynight' && !m.dead) return .25 + .9 * m.wind; return null; } // daynight wind .15 calm, .5 rain, .7 storm
  function palm(parent, x, y, z, s = 1) {
```

#### A7 · dist/game.js · per-frame update (in `frame()`)

```js find
ocean.update(elapsed, camera); sfx.tick
```

```js replace
ocean.update(elapsed, camera); foliage?.update(elapsed, camera, foliageWind()); sfx.tick
```

#### A10 · dist/game.js · `disposeScene()` also collects shadow twins (belt and braces; the dispose listener already frees them)

```js find
if (o.material) for (const m of [].concat(o.material)) mats.add(m);
```

```js replace
if (o.material) for (const m of [].concat(o.material)) mats.add(m);
      if (o.customDepthMaterial) mats.add(o.customDepthMaterial);
```

#### A11 · dist/game.js · `disposeScene()` disposes the foliage kit

```js find
try { ocean?.dispose(); } catch {}
```

```js replace
try { ocean?.dispose(); } catch {}
    try { foliage?.dispose(); } catch {} foliage = null;
```

## 3. dist/islands.js

`islands-foliage.js` swaps the geometry and material objects in `models.geos` / `models.mats` for `palm`,
`palmSpent`, `nuts` and `bush` before islands.js builds its InstancedMeshes, so instance counts, matrices,
instance colours (hover, drained tint), the gather bounce, the spent swap, `pickNode` and `SOLID_R` collision are
untouched. The palm trunk follows the islands spine (`x = PALM_BEND * s^2`, `y = PALM_H * s`), and the coconuts
sit at `(PALM_BEND, PALM_H - .12)`, inside the existing coconut pick sphere. Without `ctx.foliage` (the unit tests'
stub ctx) every line below is a no-op and islands.js builds its own models as before.

#### A12 · dist/islands.js · import

```js find
import { createIslandModels, PALM_H, PALM_BEND } from './islands-models.js?build=v3-survival-ae77fa84ac2b';
```

```js replace
import { createIslandModels, PALM_H, PALM_BEND } from './islands-models.js?build=v3-survival-ae77fa84ac2b';
import { foliageIslands } from './islands-foliage.js?build=v3-survival-ae77fa84ac2b'; // foliage provider (docs/tech/foliage-ADOPT.md)
```

#### A13 · dist/islands.js · swap the vegetation models

```js find
  const models = createIslandModels(T, ctx.ocean);
```

```js replace
  const models = createIslandModels(T, ctx.ocean);
  const fol = ctx.foliage ? foliageIslands(T, ctx.foliage, models, { palmH: PALM_H, palmBend: PALM_BEND, preset: () => ctx.options?.graphics }) : null;
```

#### A14 · dist/islands.js · decor joins the vegetation list (shrinks with the sink, disposed with it), shadow twins attach

```js find
  const veg = [...meshes, ...extra];
```

```js replace
  const veg = [...meshes, ...extra, ...(fol ? fol.meshes : [])];
  if (fol) fol.attach(veg, group);
```

#### A15 · dist/islands.js · decor follows the layout (in `relayout()`, before the bounding spheres are refreshed)

```js find
    for (const m of veg) { m.boundingSphere = null; m.computeBoundingSphere(); }
```

```js replace
    if (fol) fol.relayout(layout, localGround);
    for (const m of veg) { m.boundingSphere = null; m.computeBoundingSphere(); }
```

## 4. dist/crafts.js: smooth ringed trunk for the raft palm

Replaces the 10 stacked `CylinderGeometry` blocks with one smooth-shaded tube along the same curve (same radius
taper, same bark palette, no `K.rnd()` calls so the fronds keep their layout). 342 triangles instead of 960.

#### A16 · dist/crafts.js · trunk

```js find
  // curved, ringed trunk built from overlapping flared segments
  const curve = new T.CatmullRomCurve3([V(0, B + 0.44, 0), V(0.015, B + 0.85, 0.01), V(0.05, B + 1.25, 0.025), V(0.09, B + 1.6, 0.04), V(0.11, B + 1.86, 0.045)]);
  {
    const NS = 10, TR = [];
    const barkA = new T.Color(0x8b6c4a), barkB = new T.Color(0x7a5d3e), barkDark = new T.Color(0x4e3a26), barkLight = new T.Color(0xa88d68);
    for (let i = 0; i < NS; i++) {
      const t0 = i / NS, t1 = (i + 1) / NS;
      const p0 = curve.getPointAt(t0), p1 = curve.getPointAt(t1);
      const len = p0.distanceTo(p1) * 1.1;
      const r0 = 0.09 - 0.032 * t0, r1 = 0.09 - 0.032 * t1;
      const geo = new T.CylinderGeometry(r1 * 0.92, r0 * 1.12, len, 12, 3);
      const base = i % 2 ? barkA : barkB;
      K.paint(geo, (x, y, z, c) => {
        const h = y / len + 0.5, ang = Math.atan2(z, x);
        c.copy(base).lerp(barkDark, Math.pow(1 - h, 3) * 0.7).lerp(barkLight, 0.15 * (0.5 + 0.5 * Math.sin(ang * 6 + i)) * h);
      });
      TR.push(K.along(geo, p0, p1));
    }
    K.addTo(g, TR, K.std(0xffffff, 0.95, 0, { vertexColors: true }), 'trunk');
  }
```

```js replace
  // curved trunk: one smooth-shaded tapered tube with ringed leaf scars, matching the island palms (foliage.js).
  // Each of the 10 bands starts slightly proud and dark, then tapers in and lightens toward the next band.
  const curve = new T.CatmullRomCurve3([V(0, B + 0.44, 0), V(0.015, B + 0.85, 0.01), V(0.05, B + 1.25, 0.025), V(0.09, B + 1.6, 0.04), V(0.11, B + 1.86, 0.045)]);
  {
    const NS = 10, RAD = 9, pos = [], nor = [], col = [], idx = [], rows = [];
    const barkA = new T.Color(0x8b6c4a), barkB = new T.Color(0x7a5d3e), barkDark = new T.Color(0x4e3a26), barkLight = new T.Color(0xa88d68);
    for (let i = 0; i < NS; i++) {
      const tone = 0.95 + 0.1 * (0.5 + 0.5 * Math.sin(i * 2.7 + 1.3)), base = i % 2 ? barkA : barkB;
      rows.push([i / NS, 1.07, barkDark.clone().lerp(base, 0.45).multiplyScalar(tone)]);
      rows.push([(i + 1) / NS - 0.006, 0.95, base.clone().lerp(barkLight, 0.3).multiplyScalar(tone)]);
    }
    const sx = new T.Vector3(), sz = new T.Vector3(), n = new T.Vector3();
    for (const [t, k, c] of rows) {
      const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
      sx.set(1, 0, 0).addScaledVector(tan, -tan.x).normalize(); sz.crossVectors(sx, tan).normalize();
      const r = (0.09 - 0.032 * t) * k * (1 + 0.4 * Math.pow(Math.max(0, 1 - t * 7), 2)); // root flare at the soil
      for (let j = 0; j <= RAD; j++) {
        const a = j / RAD * Math.PI * 2, lit = 0.92 + 0.08 * Math.sin(a * 3 + t * 17);
        n.copy(sx).multiplyScalar(Math.cos(a)).addScaledVector(sz, Math.sin(a));
        pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r); nor.push(n.x, n.y, n.z); col.push(c.r * lit, c.g * lit, c.b * lit);
      }
    }
    for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < RAD; j++) {
      const a = i * (RAD + 1) + j, b = a + RAD + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const trunk = new T.BufferGeometry();
    trunk.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    trunk.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    trunk.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    trunk.setIndex(idx);
    K.addTo(g, trunk, K.std(0xffffff, 0.95, 0, { vertexColors: true }), 'trunk');
  }
```

## 5. dist/live.js: preload the two new modules

`live.js` injects `<link rel=modulepreload>` from a hand-kept `PRELOAD` list, and `tests/live-preload.test.mjs`
asserts that list equals game.js' static import graph. `foliage.js` (imported by game.js) and `islands-foliage.js`
(imported by islands.js) join that graph, so both are added in alphabetical order. The finds do not overlap the
icons adoption's `'item-icons.js', 'item-svg.js',` edit, so the two adoptions apply in either order.

#### A17 · dist/live.js · preload foliage.js (PRELOAD, live.js:24)

```js find
'fishing-v2.js', 'hammer.js',
```

```js replace
'fishing-v2.js', 'foliage.js', 'hammer.js',
```

#### A18 · dist/live.js · preload islands-foliage.js (PRELOAD, live.js:26)

```js find
'inventory-state.js', 'islands-layout.js',
```

```js replace
'inventory-state.js', 'islands-foliage.js', 'islands-layout.js',
```

## 6. Quality tiers

- Shadows: `quality.js` turns `sun.castShadow` off on the `low` preset and on the last ladder step. Foliage depth
  twins then simply never run. On `medium`, island ferns and elephant ears do not cast (grass never does); on
  `high` they do.
- Density: `islands-foliage.js` scales the decor by preset (`low` 0.4, `medium` 0.75, `high` 1). It reads
  `ctx.options.graphics` when an island is laid out, so a preset change applies from the next island.
- Distance: grass shrinks out at 17 to 27 m and is hidden past 34 m from the island centre, ferns 24 to 34 m
  (hidden past 44), elephant ears 28 to 40 m (hidden past 50), bushes 62 to 74 m. Palms never fade.

## 7. Verify

Run `python sandbox/foliage/adopt_check.py`. It prints JSON and writes PNGs to `sandbox/foliage/shots/adopt/`. It
must report every anchor `count: 1`, `node --check` ok, the same test totals patched and unpatched, 0 page errors,
the island visited with gather prompts working, and no program or material growth across hot swaps.

By hand: place a palm decor and watch the fronds flutter while the pot stays still; spawn an island with
`raftDebug.content.islands.spawnNear(1234, 120)` and stand on it with `teleportAshore()`. Gathering a palm three
times swaps it to the dry, drooped crown and hides its coconuts, exactly as before.

### Measured on 8d21618 (2026-11-21, SwiftShader, shared 4-core box)

- Anchors: `A1..A7 A10..A18` all `count: 1`; `node --check` ok on crafts.js, foliage.js, game.js,
  islands-foliage.js, islands.js, live.js.
- `islands_contract.mjs` ok: palm, palmSpent, nuts and bush are foliage-driven with depth twins, trunk within
  0.177 of the islands spine (pick capsule 0.25), palm pick and spent swap identical with and without foliage,
  decor deterministic and density low < medium <= high (grass 36 / 68 / 90), 300 seeds lay out, depth twin
  disposed with its material.
- Tests: unpatched 910 / 909 pass / 1 fail, patched 910 / 909 / 1. The one failure is the same in both
  (`art.test.mjs` atlas build time under box load). `live-preload` passes only with A17/A18;
  `module-specifiers` needed the `./foliage.js?build=...` usage comment in foliage.js unquoted (fixed).
- Browser, base vs patched: 0 page errors, 0 console errors in both; island 1234 has 1 palm, 2 bushes,
  4 rocks, 2 sand; palm pick 0 -> 0, prompt "Gather palm: wood and leaves (3 left)", gathered 3/3 and the
  spent crown swaps in. Programs at boot 102 vs 119 (12 foliage programs); across two live.js hot swaps
  base grows 102 -> 110 -> 116 programs and patched 119 -> 125 -> 128, so the adoption adds no growth of its
  own (main itself grows a little per swap). Draw calls at the island views stay within +-4 of base;
  triangles +3k to +17k (undergrowth).
- Shots (read): `shots/adopt/pair-{raft,palm,spent,raftpalm,afterswap,...}.png`, base left, patched right.
