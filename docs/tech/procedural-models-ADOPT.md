# Adopting the low-poly props in `dist/` (retargeted to current main)

Background: `docs/tech/procedural-models.md`. Prototype: `sandbox/procedural-models/`. Checked against `dist/` at main
`8d21618` (game.js is 2,284 lines, build token `v3-survival-ae77fa84ac2b`) by `sandbox/procedural-models/adopt_check.py`,
which applies every step below to a temp copy of `dist/`, asserts that each anchor matches exactly once on the quoted
line, boots both builds headless, places decor and builds a tile, and compares draw calls. Nothing in the repo's
`dist/` is changed.

## Drift refresh (main 8d21618, previously written against 3c62305)

- Anchors moved: the craft import is now game.js **line 13**, the ghost dispose line is placement.js **line 147**, the
  `applyOptions` preset line is game.js **line 1312**. Their text is unchanged.
- New mandatory step: `dist/live.js` preloads game.js' static import graph from a hand-kept `PRELOAD` list, and
  `tests/live-preload.test.mjs` fails when a statically imported module is missing from it. `lowpoly-props.js`
  becomes a static import, so it is added there (step 4 below). `crafts.js` stays in the graph (held-items.js and
  item-icons.js import it), so nothing is removed.
- `crafts.js` changed its lantern: it is now a waist-high post lantern (group scaled 0.65, ~1.2 m) with its
  feet-to-crook span centred on the origin, and `placement.js FOOTPRINT` was refitted to the models' real bounds
  (sail `[.8, .76]`, lantern `[.59, .37]`; crate, sail and lantern also collide with that rect). `lowpoly-props.js`
  now matches: its lantern is scaled 0.65 and centred the same way, baked into the geometry so daynight.js'
  bounding-sphere light position (`g.position + lanternGlow.geometry.boundingSphere.center`, daynight.js 449-452)
  stays on the flame. Bounds, lowpoly vs crafts.js: lantern x ±.38 z ±.24 h 1.24 vs ±.38 ±.24 1.23; sail ±.83 ±.75 vs
  ±.82 ±.75; bench .70 vs .72 half width; crate ±.53 ±.43 vs ±.49 ±.42 (4 cm wider than its collision rect; harmless).
- `crafts.js` also stopped thin parts (rope, nails, pennant, ...) casting shadows (`THIN`). lowpoly merges each craft
  into 2-5 meshes per material, so there is no per-part switch to copy; its shadow-pass cost is already lower.
- Floating debris and the jug are now drawn **instanced** by `debris.js createItemBatch` (pooled geometry, game.js
  11, 637, 644). lowpoly `createDebris`/`createPlastic` do not pool, so the optional full set no longer swaps them
  (it would lose instancing and its import would drop `createItemBatch`). Full mode is now crafts + deck.
- Name contracts re-checked against the current readers and unchanged: sailing-world.js 11 + 133-134 (`sailCloth`,
  `pennant`), daynight.js 256 + 437-452 (`lanternGlow`/`flame`/`lanternGlass`/`candle` in `craft_lantern`; main also
  reads `craft_candle`, which lowpoly does not build), purifier-model.js 72 + 89-92 (`trunk`, `crown`, `coconuts`,
  `fronds`, `frondRibs`, `soil`).

## What changed since the first ADOPT

The old doc targeted a dist where every builder made its own materials and the deck was one group per tile. Main has
moved on:

| area | current main | effect on this adoption |
|---|---|---|
| deck | `deck.js createRaftMesh()` merges **all** tiles into ~7 meshes (game.js 494). The `?art` lane textures the planks/logs/rope through `mat()` → `materials.js materialForColor` (game.js 321–328). | The deck is no longer a draw-call problem, and the lowpoly floor ignores `getMaterial`, so it would switch the art lane's textured deck off. **Do not adopt the floor.** |
| floating debris + jug | `debris.js` is 1–3 meshes per item, materials via `mat()` (art lane textures them). Floating items skip the shadow pass (`syncItems`, game.js 533). | Saving is 1–2 calls per item and it would bypass the art lane. **Do not adopt.** |
| crafts | `crafts.js` still builds 3–11 meshes and 750–22k triangles per craft, with **per-call materials**, and is **not** touched by the art lane (it never calls `mat()`). | The one place lowpoly still wins clearly. **Adopt `createCraft` only.** |
| `disposeGeometry` | already skips `material.userData.shared` (game.js 385). | Old step 3 is obsolete. |
| other lanes read craft parts by name | `sailing-world.js` furls `sailCloth` and turns `pennant` (lines 10, 121–131); `daynight.js` ramps `lanternGlow`/`flame`/`lanternGlass`/`candle` emissive at night and puts a point light on `lanternGlow` (242, 413–428); `purifier-model.js` pivots `trunk`/`crown`/`coconuts`/`fronds`/`frondRibs`, toggles `coconuts` and recolours `soil` per planter (69–92, called from game.js 497 and 728). | `lowpoly-props.js createCraft` now keeps those names: sail = `sailSolid` + `sailCloth` + `pennant`; lantern = `lanternSolid` + `lanternGlow` (shared emissive material); palm = `palmSolid` + `trunk` (trunk, crown, frond ribs) + `coconuts` + `fronds` + `soil` (its own material, the only per-instance one). |
| placement ghosts | `placement.js` 147 disposes every material of the ghost model. | Would dispose the shared `lp-*` materials each time a ghost is built (programs recompile, hitch). Step 3 adds a one-line guard. |
| icons / held items | `item-icons.js` and `held-items.js` render from `models.js getModel` (provider set via survival-ui.js 460 and hands.js `modelFactory`, game.js 547). `crafts.js` is only their fallback (item-icons.js 14 + 97, held-items.js 16 + 270 + 277). | Icons and the held decor already come from `models.js`, a third style; this adoption does not change them. Leave both imports on `crafts.js`. |
| `materials.js` art lane | gated by `?art`; never touches crafts. | No interaction for crafts-only. |

## Recommended: lowpoly crafts on the `low` preset only (`adopt_check.py --mode tier`)

The detailed `crafts.js` models look as good as or better than lowpoly in first person, so they stay the default.
The `low` graphics preset (settings.js line 29 `PRESETS.low`, shadows off) gets the cheaper set. Do steps 1, 3 and 4
of the crafts-only steps below, then, instead of step 2:

- **`dist/game.js` line 13**, replace the one import with both builders and a switch:
  ```js
  // before (line 13)
  import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
  // after (one line)
  import { createCraft as createDetailedCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b'; import { createCraft as createLowCraft } from './lowpoly-props.js?build=v3-survival-ae77fa84ac2b'; let lowProps = false; const createCraft = (T, k) => (lowProps ? createLowCraft : createDetailedCraft)(T, k); // procedural-models: low preset uses lowpoly crafts
  ```
- **`dist/game.js` line 1312** (in `applyOptions`, line 1310), rebuild the raft when the preset crosses low:
  ```js
  // before
  if (quality && quality.info.preset !== next.graphics) quality.setCap(next.graphics);
  // after
  if (quality && quality.info.preset !== next.graphics) quality.setCap(next.graphics); if ((next.graphics === 'low') !== lowProps) { lowProps = next.graphics === 'low'; if (scene) rebuildRaft(); }
  ```
  `createSettings` calls `onChange` once on creation (settings.js line 413), so a saved `low` preset applies at
  boot. The automatic quality scaler (quality.js) does not change the preset, so it never swaps models mid-game.
  A placement ghost already cached in placement.js keeps the builder it was made with. That is harmless, because
  ghosts are tinted.

## Steps: crafts only, always (`adopt_check.py --mode crafts`)

1. **Add the module.** `cp sandbox/procedural-models/lowpoly-props.js dist/lowpoly-props.js`. It has no imports;
   THREE is passed in. Exports: `createCraft`, `createDebris`, `createPlastic`, `createFloor`, `createRaftMesh`,
   `FLOOR_TOP`, `FLOOR_BOUNDS`, `lowpoly`, `PALETTE`, `createProp`, `PROP_NAMES`.

2. **`dist/game.js` line 13**, switch the craft import (same `?build=` token as the rest of the file):
   ```js
   // before (line 13)
   import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
   // after
   import { createCraft } from './lowpoly-props.js?build=v3-survival-ae77fa84ac2b';
   ```
   Call sites do not change: the ghost factory (line 449) and `rebuildRaft()` (line 612) both call
   `createCraft(T, d.type)` after `prog?.modelFor` (smelter/research/grill) and before `createSignalModel` /
   `content?.decorModel`, and both rely on `null` for unknown types, which lowpoly keeps. Purifier, receiver,
   antenna and the content decor keep their own builders.

3. **`dist/placement.js` line 147**, don't dispose shared materials when a ghost is made:
   ```js
   // before
   for (const m of [].concat(o.material)) if (m !== mat) m.dispose();
   // after
   for (const m of [].concat(o.material)) if (m !== mat && !m.userData.shared) m.dispose();
   ```
   Without it the game still works (three re-initialises a disposed material on next use), but the first ghost of
   each craft kind recompiles the `lp-*` programs under every placed craft. (`ghosts.preload`/`ghosts.warm`, new in
   main, build ghosts ahead through the same `model()` path, so the guard covers them too.)

4. **`dist/live.js` line 28**, add the new module to the `PRELOAD` list (alphabetical; `tests/live-preload.test.mjs`
   checks the list equals game.js' static import graph):
   ```js
   // before (part of line 28)
   'look-ui.js', 'look.js',
   // after
   'look-ui.js', 'look.js', 'lowpoly-props.js',
   ```

5. **Leave the rest alone.** Keep `crafts.js` (item-icons.js line 14 and held-items.js line 16 import it as a
   fallback, `tests/watering.test.mjs` line 12 tests it, `sandbox/icons/main.js` imports it). Keep `deck.js`,
   `debris.js`, `plastic.js` and their imports on game.js lines 10, 11, 54. `disposeGeometry` (line 385) needs no
   change.

6. **Verify.** `python sandbox/procedural-models/adopt_check.py --tests` (anchors, `node --check`, both builds in
   the game, `node --test tests/*.test.mjs` on both, plus `tests/watering.test.mjs`'s planter-stage test re-run
   against the lowpoly palm). Screenshots land in `sandbox/procedural-models/shots/adopt/` (gitignored).
   The test run includes `tests/live-preload.test.mjs`, which fails if step 4 is skipped.

   Last run, main 8d21618, crafts mode (SwiftShader, load average 40-70, so frame ms are meaningless):

   | | stock | patched |
   |---|---|---|
   | anchors (`--mode crafts` / `tier` / `full`) | | 3/3, 4/4, 5/5 match once on the quoted line; `node --check` ok |
   | node tests | 909/910 | 925/926 (incl. the lowpoly planter re-run and live-preload) |
   | failing test | `atlas ... build stays fast` (timing) | the same one, nothing new |
   | page errors | none | none |
   | placed sail/palm/lantern/net/bench/crate + 1 tile | all, tiles 9 -> 10 | all, tiles 9 -> 10 |
   | contracts (sailCloth, pennant, lanternGlow emissive, palm pivot/soil/coconuts) | ok | ok |
   | draw calls / triangles, decor view | 73 / 175k | 57 / 141k |
   | draw calls / triangles, back view | 67 / 120k | 48 / 86k |

## Optional: the full set (not recommended)

`python sandbox/procedural-models/adopt_check.py --mode full` also applies:

- game.js line 10 `import { createRaftMesh, createFloor } from './deck.js?build=…';` → `./lowpoly-props.js?build=…`
- live.js line 21-22: drop `'deck.js', ` from `PRELOAD` (deck.js leaves the static graph once game.js stops importing it)

Debris and the jug are no longer part of it (main draws them instanced through `debris.js createItemBatch`, which
lowpoly does not provide). Why not recommended: the deck is already merged (the saving is a few calls), the lowpoly
deck is flatter than the textured deck up close (see the research doc), it drops out of the art lane's texture pass,
and lowpoly `createRaftMesh(T, tiles, getMaterial)` ignores the two extra arguments game.js 610 now passes (the paint
lane's per-tile tint and `woodMat`), so painted deck tiles would lose their colour.

## Numbers

See "Retarget to current main" in `docs/tech/procedural-models.md` for the side-by-side shots and the per-model
table, and `sandbox/procedural-models/shots/adopt/report-crafts.json` for the latest probe run.
