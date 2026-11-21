# Adopting the low-poly props in `dist/` (retargeted to current main)

Background: `docs/tech/procedural-models.md`. Prototype: `sandbox/procedural-models/`. Checked against the current
`dist/` (game.js is 1,780 lines, build token `v3-survival-ae77fa84ac2b`) by `sandbox/procedural-models/adopt_check.py`,
which applies every step below to a temp copy of `dist/`, asserts that each anchor matches exactly once on the quoted
line, boots both builds headless, places decor and builds a tile, and compares draw calls. Nothing in the repo's
`dist/` is changed.

## What changed since the first ADOPT

The old doc targeted a dist where every builder made its own materials and the deck was one group per tile. Main has
moved on:

| area | current main | effect on this adoption |
|---|---|---|
| deck | `deck.js createRaftMesh()` merges **all** tiles into ~7 meshes (game.js 494). The `?art` lane textures the planks/logs/rope through `mat()` → `materials.js materialForColor` (game.js 321–328). | The deck is no longer a draw-call problem, and the lowpoly floor ignores `getMaterial`, so it would switch the art lane's textured deck off. **Do not adopt the floor.** |
| floating debris + jug | `debris.js` is 1–3 meshes per item, materials via `mat()` (art lane textures them). Floating items skip the shadow pass (`syncItems`, game.js 533). | Saving is 1–2 calls per item and it would bypass the art lane. **Do not adopt.** |
| crafts | `crafts.js` still builds 3–11 meshes and 750–22k triangles per craft, with **per-call materials**, and is **not** touched by the art lane (it never calls `mat()`). | The one place lowpoly still wins clearly. **Adopt `createCraft` only.** |
| `disposeGeometry` | already skips `material.userData.shared` (game.js 335). | Old step 3 is obsolete. |
| other lanes read craft parts by name | `sailing-world.js` furls `sailCloth` and turns `pennant` (lines 10, 121–131); `daynight.js` ramps `lanternGlow`/`flame`/`lanternGlass`/`candle` emissive at night and puts a point light on `lanternGlow` (242, 413–428); `purifier-model.js` pivots `trunk`/`crown`/`coconuts`/`fronds`/`frondRibs`, toggles `coconuts` and recolours `soil` per planter (69–92, called from game.js 497 and 728). | `lowpoly-props.js createCraft` now keeps those names: sail = `sailSolid` + `sailCloth` + `pennant`; lantern = `lanternSolid` + `lanternGlow` (shared emissive material); palm = `palmSolid` + `trunk` (trunk, crown, frond ribs) + `coconuts` + `fronds` + `soil` (its own material, the only per-instance one). |
| placement ghosts | `placement.js` 91 disposes every material of the ghost model. | Would dispose the shared `lp-*` materials each time a ghost is built (programs recompile, hitch). Step 3 adds a one-line guard. |
| icons / held items | `item-icons.js` and `held-items.js` render from `models.js getModel` (provider set via survival-ui.js 376 / game.js 1754 and hands.js `modelFactory`, game.js 433). `crafts.js` is only their fallback (item-icons.js 13 + 79, held-items.js 15 + 175 + 182). | Icons and the held decor already come from `models.js`, a third style; this adoption does not change them. Leave both imports on `crafts.js`. |
| `materials.js` art lane | gated by `?art`; never touches crafts. | No interaction for crafts-only. |

## Recommended: lowpoly crafts on the `low` preset only (`adopt_check.py --mode tier`)

The detailed `crafts.js` models look as good as or better than lowpoly in first person, so they stay the default.
The `low` graphics preset (settings.js line 18, shadows off) gets the cheaper set. Do step 1 and step 3 of the
crafts-only steps below, then, instead of step 2:

- **`dist/game.js` line 12**, replace the one import with both builders and a switch:
  ```js
  // before (line 12)
  import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
  // after (one line)
  import { createCraft as createDetailedCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b'; import { createCraft as createLowCraft } from './lowpoly-props.js?build=v3-survival-ae77fa84ac2b'; let lowProps = false; const createCraft = (T, k) => (lowProps ? createLowCraft : createDetailedCraft)(T, k); // procedural-models: low preset uses lowpoly crafts
  ```
- **`dist/game.js` line 1010** (in `applyOptions`), rebuild the raft when the preset crosses low:
  ```js
  // before
  if (quality && quality.info.preset !== next.graphics) quality.setCap(next.graphics);
  // after
  if (quality && quality.info.preset !== next.graphics) quality.setCap(next.graphics); if ((next.graphics === 'low') !== lowProps) { lowProps = next.graphics === 'low'; if (scene) rebuildRaft(); }
  ```
  `createSettings` calls `onChange` once on creation (settings.js line 371), so a saved `low` preset applies at
  boot. The automatic quality scaler (quality.js) does not change the preset, so it never swaps models mid-game.
  A placement ghost already cached in placement.js keeps the builder it was made with. That is harmless, because
  ghosts are tinted.

## Steps: crafts only, always (`adopt_check.py --mode crafts`)

1. **Add the module.** `cp sandbox/procedural-models/lowpoly-props.js dist/lowpoly-props.js`. It has no imports;
   THREE is passed in. Exports: `createCraft`, `createDebris`, `createPlastic`, `createFloor`, `createRaftMesh`,
   `FLOOR_TOP`, `FLOOR_BOUNDS`, `lowpoly`, `PALETTE`, `createProp`, `PROP_NAMES`.

2. **`dist/game.js` line 12**, switch the craft import (same `?build=` token as the rest of the file):
   ```js
   // before (line 12)
   import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
   // after
   import { createCraft } from './lowpoly-props.js?build=v3-survival-ae77fa84ac2b';
   ```
   Call sites do not change: the ghost factory (line 389) and `rebuildRaft()` (line 496) both call
   `createCraft(T, d.type)` after `prog?.modelFor` (smelter/research/grill) and before `createSignalModel` /
   `content?.decorModel`, and both rely on `null` for unknown types, which lowpoly keeps. Purifier, receiver,
   antenna and the content decor keep their own builders.

3. **`dist/placement.js` line 91**, don't dispose shared materials when a ghost is made:
   ```js
   // before
   for (const m of [].concat(o.material)) if (m !== mat) m.dispose();
   // after
   for (const m of [].concat(o.material)) if (m !== mat && !m.userData.shared) m.dispose();
   ```
   Without it the game still works (three re-initialises a disposed material on next use), but the first ghost of
   each craft kind recompiles the `lp-*` programs under every placed craft.

4. **Leave the rest alone.** Keep `crafts.js` (item-icons.js line 13 and held-items.js line 15 import it as a
   fallback, `tests/watering.test.mjs` line 12 tests it, `sandbox/icons/main.js` imports it). Keep `deck.js`,
   `debris.js`, `plastic.js` and their imports on game.js lines 9, 10, 46. `disposeGeometry` (line 335) needs no
   change.

5. **Verify.** `python sandbox/procedural-models/adopt_check.py --tests` (anchors, `node --check`, both builds in
   the game, `node --test tests/*.test.mjs` on both, plus `tests/watering.test.mjs`'s planter-stage test re-run
   against the lowpoly palm). Screenshots land in `sandbox/procedural-models/shots/adopt/` (gitignored).

## Optional: the full set (not recommended)

`python sandbox/procedural-models/adopt_check.py --mode full` also applies:

- game.js line 9 `import { createRaftMesh, createFloor } from './deck.js?build=…';` → `./lowpoly-props.js?build=…`
- game.js line 10 `import { createDebris } from './debris.js?build=…';` → `./lowpoly-props.js?build=…`
- game.js line 46 `import { createPlastic } from './plastic.js?build=…';` → `./lowpoly-props.js?build=…`
- game.js line 520, art hook on scrap: `if (o.isMesh && o.material.vertexColors) {` → add `&& !o.material.userData.shared`
- game.js line 521, art hook on the jug: `if (b) {` (after `getObjectByName('jugBody');`) → `if (b && !b.material.userData.shared) {`

Lines 520/521 are mandatory in this mode: without them every floating scrap/jug under `?art` disposes `lp-solid`.
Why not recommended: the deck is already merged (the saving is a few calls), the lowpoly deck is flatter than the
textured deck up close (see the research doc), and debris/deck would drop out of the art lane's texture pass.

## Numbers

See "Retarget to current main" in `docs/tech/procedural-models.md` for the side-by-side shots and the per-model
table, and `sandbox/procedural-models/shots/adopt/report-crafts.json` for the latest probe run.
