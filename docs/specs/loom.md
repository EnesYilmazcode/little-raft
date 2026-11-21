# Spec: Loom and Woven Cloth

Research: [../features/loom-research.md](../features/loom-research.md). Built as a fuel-free progression
`station` like the Sorting Tub (research Option A), so there is no new content module and no `world.ext` slice.
Line numbers are from `dist/` at the time of writing and drift, so grep the quoted names before editing.

## Player story
Once you have twisted your first rope you can build a **Loom**, a little wooden frame with taut warp threads.
Drop palm leaves in (or puff feathers, or seaweed), and the beam rocks by itself while a roll of **Woven Cloth**
grows at the front. You don't need fuel and nothing can go wrong. Cloth gives you comfier versions of things you
already make (a mat, a bed, a sail) and a new string of flags to hang between two little posts.

## Decisions
- Kinds: station `loom` "Loom", material `cloth` "Woven Cloth", decor `bunting` "Sailcloth Bunting". Keep the
  name `cloth`, because the parallel Woven Satchel feature (`satchel {cloth:4, rope:3, leaf:4}`) uses it.
  Whichever lane lands second must reuse the existing `cloth` row and not add a second one.
- Loom: `hand({wood:8, rope:4})`, `unlock: discover('rope')`, stack 5.
- Loom recipes (all `fuel:0`, all in `EXTRA_RECIPES`, never as ITEMS `station:'loom'` recipes, so
  `usesFuel === false` and the fuel slot stays hidden):
  `leaf` x4 -> 1 cloth in 20 s; `feather` x2 -> 1 cloth in 12 s; `seaweed` x3 -> 1 cloth in 25 s. Seaweed is
  optional and can be cut on its own: delete its one row and the panel `none` text that mentions it.
  Kind names checked: `leaf` (items.js:84), `feather` (content-items.js:32), `seaweed` (items.js:107).
- The input slot holds one stack: 20 leaves make 5 cloth (100 s). If 1 to 3 leaves are left over, they stay in
  the slot, the panel shows `idle`, and Take Input gives them back.
- Cloth recipes are new ids with an existing `output.kind`. Every existing recipe stays byte-identical.
- Bunting is one decor tile: two short posts at the tile edges with a sagging strand of 7 triangular flags
  between them. It needs no multi-tile anchoring, so it fits the normal one-decor-per-tile rule.

## Data: dist/items.js
- **Cloth** (after `sand`, about :90-91): `item('cloth', 'Woven Cloth', 'material', { iconTint:'#efe6cf',
  unlock: START, tip:'A soft roll of woven cloth from a Loom. Good for mats, beds, sails and bunting.' })`.
  It has no recipe, like sand, so `recipeTable` and `discover` are unchanged.
- **Bunting** (after `scarecrow`, about :289-291): `item('bunting', 'Sailcloth Bunting', 'decor', {
  placeable:true, iconTint:'#e98a6b', recipe: hand({cloth:2, rope:2, wood:1}), unlock: discover('cloth'),
  tip:'A cheerful string of little cloth flags between two posts. It sways in the breeze.' })`, tag `// [loom]`.
- **Loom** (after `recycler`, about :329-331): `item('loom', 'Loom', 'station', { iconTint:'#c48c55', stack:5,
  placeable:true, recipe: hand({wood:8, rope:4}), unlock: discover('rope'),
  tip:'A small wooden loom that weaves leaves or feathers into cloth. No fuel needed.' })`.
- **BLOCK_RADII** (:341): append `loom: 0.45, bunting: 0.1, // [loom]`.
- **EXTRA_RECIPES** (:369): add the key below. Also update the `stationExtraRecipes` comment to say
  "for 'recycler' and 'loom'".
  `loom: { leaf:{kind:'cloth', in:4, count:1, time:20, fuel:0}, feather:{kind:'cloth', in:2, count:1, time:12,
  fuel:0}, seaweed:{kind:'cloth', in:3, count:1, time:25, fuel:0} }`
- Export `LOOM_RECIPES = EXTRA_RECIPES.loom` for tests. `FUEL_VALUE` stays unchanged, and so do leaf and
  seaweed as fuels elsewhere.

## Data: dist/content-items.js (CONTENT_RECIPES, Tinker's Desk gated)
Append these after `flagpole` (:139), which is the *last* block. Duplicate keys earlier in the file lose, so
don't add them there.
```
// [loom] cloth versions of existing pieces (output kinds already exist; the old recipes stay)
clothrug:  Object.freeze({ id:'clothrug',  name:'Patchwork Mat', output:Object.freeze({ kind:'rug',  count:1 }), cost:Object.freeze({ cloth:2 }) }),
clothbed:  Object.freeze({ id:'clothbed',  name:'Quilted Bed',   output:Object.freeze({ kind:'bed',  count:1 }), cost:Object.freeze({ wood:6, cloth:2, plastic:2, nail:3 }) }),
clothsail: Object.freeze({ id:'clothsail', name:'Cloth Sail',    output:Object.freeze({ kind:'sail', count:1 }), cost:Object.freeze({ wood:8, cloth:4, rope:2, scrap:2 }) }),
```
- `sail` is the items.js kind (items.js:292). `bed` and `rug` are content kinds. The placed pieces look the same
  as the leaf versions; only the card name differs.
- `learnedFrom` (storage-research.js:40) unlocks each recipe once cloth and its other kinds have been seen at
  the desk. Progressed saves are not grandfathered for these, which is intended.
- Don't change CONTENT_ITEMS or CONTENT_DECOR: cloth, loom and bunting are items.js kinds and reach the bag
  through `registerBagKinds`.

## Model: dist/loom-model.js (new, no imports, no textures)
Copy the `mats`/`kit`/`rbox`/`merge` helpers from recycler-model.js, follow docs/MODEL-STYLE.md, and merge one
mesh per material (wood, rope, soft). Use vertex colours and flat shading. Budget: 3000 triangles or fewer at
LOD 0. The model stands on y = 0 at the tile-top origin, like the tub, and fits a 1.0 x 0.8 m footprint about
1.0 m tall.
- `createLoomModel(T)` returns a Group named `loom`:
  - Frame: two A-frame side posts (dark wood `#6b4529`, bevelled rbox) joined by a back cross bar and a low
    footboard.
  - Breast beam at the front (plank `#c48c55`).
  - About 12 warp threads (`#cdb07a`, thin rboxes in one merged rope mesh) running from the back bar to the
    breast beam.
  - A tiny wooden shuttle resting on the footboard.
  - Child Group **`loomBeam`**: the beater bar across the warp, pivoting on the side posts. The tick loop rocks
    it with `rotation.x = Math.sin(time*6)*0.18` while `st.cooking` and eases it back to 0 otherwise.
  - Child Group **`loomBolt`**: a cloth roll (8-segment cylinder, `#efe6cf` with `#d8c6a0` stripe bands from
    `perFace`) under the breast beam. It is visible only while `st.output`.
  - Don't name any node `glow`.
- `createBuntingModel(T)` returns a Group named `craft_bunting`:
  - Two posts 0.9 m tall at x = ±0.42 (dark wood, with a round cap knob).
  - A rope strand made of 8 short segments sagging 0.18 m.
  - 7 triangular flags (two-sided flat triangles in the soft material) alternating `#e98a6b`, `#f2c14e` and
    `#7fb7a8`, all cream-edged.
  - Child Group `buntingFlags`, which a later version may sway. v1 is static.
  - About 400 triangles in 3 meshes.

## Progression wiring: dist/progression-hooks.js
- Import both builders. `MODELS` (:36) gains `loom: createLoomModel, bunting: createBuntingModel`. `modelFor`
  only registers COOKERS, so bunting is just a model. `COOKERS` (:33) picks up the loom by itself through
  `stationExtraRecipes`.
- `PANEL_COPY.loom` (:46): `{ input:'To weave', none:'No palm leaves, feathers or seaweed in your bag.',
  busy:'Weaving', idle:'Put in 4 palm leaves, 2 puff feathers or 3 seaweed.', nothing:'Nothing here to weave.' }`.
- Node cache (:318): add `beam: g.getObjectByName('loomBeam'), bolt: g.getObjectByName('loomBolt')`. Then
  `if (n.beam) n.beam.rotation.x = st?.cooking ? Math.sin(time*6)*.18 : n.beam.rotation.x*.85;` and
  `if (n.bolt) n.bolt.visible = !!st?.output;`
- Prompts come free: `stationPrompt` shows "E Use the Loom", and the near notice is "E: use the Loom".
  Undecor already returns the loom and its contents like the tub (:105-108). Bunting is plain decor.
- Optional take toast (host, on `prog:take` from a loom): `{kind:'loot', text:'Fresh off the loom!'}`.
- Old-host capability:
  - The host adds `loom: 1` to the `prog:sync` payload (:308).
  - `effect()` (:167) sets `remote.loom = !!e.loom`, and `remote.synced = true` on the first sync.
  - Export `OLD_HOST = 'Your friend’s raft doesn’t have a loom yet'` and a method
    `oldHostLacks(recipeId)`. It returns `OLD_HOST` when `isRemote() && remote.synced && !remote.loom` and
    the id is one of `loom, bunting, clothrug, clothbed, clothsail`. Otherwise it returns null.
- **dist/game.js `craft()`** (:1405): after the `craftLocked` line, add
  `const old = prog?.oldHostLacks?.(recipe); if (old) { notice(old, 2400); return false; }`. Without it, an
  old host silently refuses an unknown recipe.

## Craft book, icons, held model
- `craft-book.js`:
  - `CATEGORY_OF` (:14): `loom:'survival', cloth:'materials', bunting:'building'`.
  - `ITEM_TEXT` (:58):
    - `loom {desc:'A little wooden loom with taut warp threads.', use:'Weaves 4 palm leaves, 2 puff feathers
      or 3 seaweed into cloth. No fuel.'}`
    - `cloth {desc:'A soft roll of woven cloth.', use:'Craft a Patchwork Mat, Quilted Bed, Cloth Sail or
      bunting.'}`
    - `bunting {desc:'Little cloth flags on a rope between two posts.', use:'Place it on a deck tile for a
      festive raft.'}`
  - `ITEM_SOURCE` (:435): `cloth: {tag:'loom', how:'Weave palm leaves, puff feathers or seaweed at a Loom.'}`.
- `item-svg.js ITEM_ICONS` (:10): add 48x48 placeholder bodies for `loom` (frame and warp), `cloth` (a rolled
  bolt) and `bunting` (a swag with 3 flags), drawn with the shared navy outline. Keep `placeholder` at its
  default, with no `icon:` and no icons.svg symbol, exactly as recycler.md's build notes say.
- `held-items.js`: add `'bunting'` to `LANE_DECOR` (:32) with `MODEL_KINDS.bunting = createBuntingModel` and
  a size of about 0.24. The loom keeps the generic station held fallback.
- **dist/live.js `PRELOAD`** (:16): add `'loom-model.js' /* [loom] */` next to `recycler-model.js` (:31).

## Saves and co-op
- **Saves:**
  - Loom contents live in the `littleRaft.progression.v1` `stations` snapshot, like the tub, so there is no
    ext migration.
  - New build with an old save: nothing to do.
  - Old build with a new save: `DECOR_TYPES` drops a placed loom or bunting, the bag drops cloth, loom and
    bunting (content-items.js:4 behaviour), and `syncStations` ignores the snapshot. Nothing throws.
- **Co-op:**
  - The host owns every timer. Guests send the existing `prog:insert/take/takeInput` and read `prog:sync`.
    The guest's `stationView` builds `new StationModel('loom', snap)`, and the constructor default supplies
    `LOOM_RECIPES`.
  - The beam and bolt animate from the mirrored `cooking` and `output` flags.
  - A guest of an old host gets the OLD_HOST notice instead of a silent failed craft.

## Tests to update
- **tests/progression.test.mjs:**
  - :21 add `'loom'` to `STATIONS_WITH_RECIPES`. This is harmless and matches the recycler.
  - Reachability loop (:190-196): add `if (have.has('loom') && !have.has('cloth')) { have.add('cloth');
    changed = true; } // [loom] weaving`.
  - The tip, icon and radius checks at :100-122 are met by the rows above.
- **tests/craft-ux.test.mjs:**
  - `sourceOf` (:124-132): this passes through `ITEM_SOURCE.cloth`. Add `assert.equal(CB.sourceOf('cloth',
    recipes).recipe, null)`.
  - Assert that ITEM_TEXT has loom, cloth and bunting, and that the category tabs map to survival,
    materials and building.
- **tests/item-icons.test.mjs:** add a "loom, cloth and bunting have their own icons" test (`ITEM_ICONS.x`),
  in the style of :24.
- **tests/live-preload.test.mjs:** passes once PRELOAD lists `loom-model.js`.
- **tests/recycler.test.mjs** (:104, "smelter and grill unchanged") must stay green.
- **tests/storage-research.test.mjs** compares only `ORIG`, so it needs no change.

## tests/loom.test.mjs (new, modelled on recycler.test.mjs)
1. `ITEMS.loom` is a station with cost `{wood:8, rope:4}`, `discover('rope')`, stack 5 and a radius of 0.45.
   `ITEMS.cloth` is a material with START and no recipe. `ITEMS.bunting` is decor with cost
   `{cloth:2, rope:2, wood:1}` and `discover('cloth')`. All tips are longer than 10 characters.
2. `stationExtraRecipes('loom')` is frozen with keys `leaf, feather, seaweed`. Every row has `kind:'cloth'`,
   `fuel:0` and in/time of 4/20, 2/12 and 3/25.
3. `new StationModel('loom')`:
   - It has `usesFuel === false` and `addFuel('wood', 5) === 0`.
   - It accepts leaf, feather and seaweed, and rejects wood, fish and tincan.
4. Insert 4 leaves and tick 20 s: the output is 1 cloth, the input is empty and `fuelUnits` is 0. With 3 leaves,
   `cooking === false` after 60 s and the output is still null.
5. 20 leaves ticked 100 s give 5 cloth. 2 feathers ticked 12 s give 1 cloth.
6. Snapshot and restore keep the cloth output and the input progress. Junk kinds in the snapshot are dropped.
7. A smelter `StationModel` still has `usesFuel === true` and `recipeFor('leaf') === null`. The recycler
   recipes are unchanged.
8. Merged RECIPES:
   - clothrug, clothbed and clothsail exist, output `rug`, `bed` and `sail`, and have the costs above.
   - The original `rug`, `bed` and `sail` recipes still have their research costs (leaf 4 + rope 2,
     leaf 10/wood 6/plastic 4/nail 3, and wood 10/leaf 20/scrap 3).
9. `learnedFrom(['cloth'])` includes `clothrug`. `learnedFrom(['leaf','rope'])` does not.
10. Models (real three, as in recycler.test):
    - `createLoomModel` has `loomBeam` and `loomBolt` and no `glow`. It has 6 meshes or fewer, 3000 triangles
      or fewer, a bounding-box min y of about 0, and fits inside 1.7 m.
    - `createBuntingModel` has `buntingFlags` and 1200 triangles or fewer.
11. Source greps:
    - progression-hooks.js has `PANEL_COPY` loom 'To weave', `MODELS` loom and bunting, `loom: 1` in
      prog:sync, and `OLD_HOST`.
    - game.js `craft()` calls `oldHostLacks`.
    - live.js PRELOAD lists loom-model.js.
12. Driving `attachProgression` with a fake ctx: as a guest whose sync lacks `loom`, `oldHostLacks('clothbed')`
    returns OLD_HOST and `oldHostLacks('rope')` returns null. After a sync that has `loom: 1`, it returns null.

## QA plan
1. Run `npm test`.
2. With `raftDebug.progression.grant('rope')`: check the unlock toast, build the Loom, and confirm the panel says
   "To weave" and has no fuel row.
3. Put in 8 leaves: the beam rocks, the bolt appears, and after 40 s you can take 2 cloth.
4. Study cloth at the Tinker's Desk, then craft the Patchwork Mat, Quilted Bed and Cloth Sail. The old leaf cards
   still show.
5. Place the bunting and check how it reads at phone width and in the screenshot run.
6. Co-op guest: use the loom. Then join an old-build host and check the notice.
