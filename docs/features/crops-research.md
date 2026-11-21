# Crop variety (Garden Bed + 3 crops): research

Round: loop-features-202611210855. Base: origin/claude/raft-master 16aedaa. Anchors checked against this tree.

## (a) Genre patterns

Survival raft and island games usually handle farming like this:
- **Plots.** Small plots hold 1 plant and large plots hold 2 to 4. Plots are crafted build pieces, and the
  bigger ones cost more rope and planks.
- **Distinct growth times.** Staple crops grow in a few minutes. Slower crops pay more or give a crafting
  material. The usual set is a vegetable, a fruit or berry, and a fibre plant.
- **Seeds from exploring.** They come from island bushes and trees, from floating loot barrels, and back from
  the harvest. The return rate is high enough that you never get stuck.
- **Watering.** A cup or can is used by hand, rain waters crops for free, and a sprinkler automates it later.
  In the harsher games a plot left dry wilts or dies.
- **Harvest feeds other systems.** Vegetables go to the grill or pot, fibre goes into rope or cloth, and
  coloured plants go into dye.
- **Pests.** Birds steal ripe crops; the counter is a scarecrow or shooing them off.

### Cozy take for Little Raft (original names)

- **No wilting and no death.** A dry crop pauses and keeps its progress forever. This matches watering.js,
  where growth only advances while `water === 1` (dist/watering.js:103).
- **No pests.** Instead, a bed within beehive flower range (`FLOWER_RANGE = 2`, dist/bees.js:7) gets +1 yield,
  because bees help it along.
- **Rain waters every bed for free** while `content.rain() > .2` (dist/content.js:99).
- **Seeds always come back.** Every harvest returns at least 1 seed, so a crop can never be lost.
- **Garden Bed.** One tile holds one crop. There is already a 2-slot `cropPlot` model at dist/models.js:404
  (models.test.mjs:43), so the bed can show 2 plants from one seed. A 1x2 "long bed" could come later.

| Crop (seed kind) | Watered grow | Harvest | Feeds |
|---|---|---|---|
| Sea Flax (`flaxseed`) | ~120 s | 2 `fibre` + seed | A second rope recipe: 1 fibre -> 1 rope. Leaf rope costs 2 leaf (dist/items.js:114) |
| Blushbell (`bellseed`) | ~150 s | 2 `petal` + seed | A paint-pot recipe, for example Coral without clay or a new pink (paint_* in dist/content-items.js:68-72, dist/paint.js:16) |
| Sweet Tuber (`tuberseed`) | ~180 s | 2 `tuber` + seed | Raw edible. On the progression grill `cook('grill','tuber')` gives `roasttuber` (as cookedfish, dist/items.js:179) |

The palm planter is 90 s (dist/watering.js:5), so these times stay in the same easy band. Each crop has 3
stages, like `plantStage` (dist/watering.js:85).

## (b) Code anchors

**Live palm farming is dist/watering.js** (imported at dist/game.js:38).
- dist/farming.js and dist/farming-view.js are **not used by the game**. Nothing in game.js imports them.
  Only tests load them (tests/farming.test.mjs, survival-r2.test.mjs:8, build-r2.test.mjs:12), and those
  tests pin them, so leave both files alone.
- inventory-state.js:49-52 keeps the old kinds `seed` and `water` in the Bag for saves.

**world.garden**
- Shape `{"x,z": {water:0|1, grow:0..90}}` (dist/watering.js:3, 29-37).
- `cleanWatering` **drops every key whose decor is not `'palm'`** (dist/watering.js:72). It runs on load
  (dist/game.js:219) and on **every host tick** through `prune()` (dist/watering.js:90-97).
- So Garden Bed state goes in **`world.ext.crops`** through a content module, not in world.garden.
- Reusable: `swapOne(bag,'freshcup','cup')` (dist/watering.js:127) pours a cup, returns the empty one.

**game.js palm wiring**
- `pickWateringDecor` is hard-coded to palm, purifier, rainbarrel and sprinkler (dist/game.js:924-936).
- `wateringTarget` builds the prompt and actions (938-963). Visuals are at 965-974.
- Host apply is `applyWatering` (1049-1062), dispatched at 1196.
- The 1 Hz host tick runs `tickWatering` and `tickRain` (1617).
- Net state carries garden and purifiers (1572). raftDebug lists them at 2115 and 2154-2157.

**Input trap**
- `useSelected` treats `freshcup` as edible and drinks it unless `wateringTarget` returns a click
  (dist/game.js:1252-1255). `content.use()` only runs later (1274), and the drink tip appears unless
  `waterAim.click` is set (723).
  So **a left click with a fresh cup on a bed drinks the water**.
- E is safe (`interact()`: wateringTarget, then content.interact, 1238-1239). Water beds with E, or add a
  content `cupTarget` hook before `startEat`.

**Rain and sprinkler** (on master: dist/rain.js, imported at dist/game.js:40)
- `sprinkle()` waters only neighbours of type `'palm'` (dist/rain.js:84-93).
- v1: rain + E-cups only. Sprinkler support belongs in rain.js (pinned by tests/rain.test.mjs).

**Seeds**
- `lootFor('bush')` (dist/islands-layout.js:186) gives flowerseed when h < .2 and `seed` (Palm Seed) when
  h < .5. The last palm gather also gives `seed` (185).
- tests/islands.test.mjs:122-131 pins the palm rows exactly and requires bush seed rate 120-280/400 and
  flower rate 40-130/400. Carve crop seeds **out of** the .2-.5 band; do not widen it.
- `seed` is a placeholder kind (dist/content-items.js:13). Its only other use is `paint_sunshell` (70).
- craft-book.js:325 says seeds come from "barrels", but BARREL_LOOT has no `seed` row.
- Barrels: the `BARREL_LOOT` treasure pool (dist/items.js:320-333) through `rollBarrel` (375), called at
  dist/game.js:1103.
- flowerseed (weight 6) is the template. New rows dilute clay, stone and ore and invalidate the odds comment
  ("treasure total 102", dist/items.js:313-318).
- Pity (`BARREL_PITY`, 355) protects the smelter pace. Re-run the pity and gap test
  (tests/progression.test.mjs ~310) and keep crop-seed weights small or use one shared row.

**Items, recipes and unlocks**
- The craft UI lists `RECIPES` (dist/survival-ui.js:166). inventory-state.js merges three sources in order:
  legacy rows, then `CONTENT_RECIPES`, then items.js `recipeTable()`. The items.js rows win.
- `CONTENT_RECIPES` that are not in the catalogue are **gated by Tinker's Desk research**
  (dist/storage-research.js:29-56; `setOwnedElsewhere` at dist/game.js:464).
- **Recommendation:** put the seeds, the bed and the outputs in **dist/items.js** with
  `discover('flaxseed')` and similar, the same way bees added flowerseed, flowerbox and beehive
  (dist/items.js:99-104, 195-203). Placeables join DECOR_TYPES through `PLACEABLE_IDS` (dist/game.js:75).
- **The fibre-to-rope recipe needs its own id.** `recipeTable()` always outputs `kind: id`
  (dist/items.js:430-442), so items.js cannot express it. There are two options:
  - (a) Add it as a `CONTENT_RECIPES` row with output rope, following `glasscups` and `brickplanter`
    (dist/content-items.js:55-56). The desk then teaches it once fibre has been seen.
  - (b) Add an optional `output` field to the items.js schema. This touches the progression tests.
- The grill cook recipe is `cook('grill','tuber',{time,fuel})` with `unlock: atStation('grill')`, like
  dist/items.js:179-185. The station model is in dist/progression-hooks.js:31-33.
- Not the fishing-cooking.js driftwood grill (fish species only, `fc:cook` :153). **No cookpot/juicer on master** (reverted 7190097).
- Edible crops: `addFood(kind,{food,water})` (dist/vitals.js:39; FOOD table at 26). For example tuber
  {food:8, water:2} and roasttuber {food:25}.

**Tests every new kind must pass**
- progression.test.mjs:100-111: each item needs a name, a tip longer than 10 characters and an `icon-*`. A
  non-placeholder icon must be in icons.svg.
- progression.test.mjs:126-199: every reference must be a real item, a station recipe has a single input,
  and **everything must be reachable from START**. Seeds must drop somewhere and the bed must unlock by
  discover(seed).
- survival.test.mjs:533-560: every RECIPES entry lands in a CraftBook tab, and **every ITEM_INFO kind needs
  `ITEM_TEXT[k].desc` and `.use`** (dist/craft-book.js:35). Add `ITEM_SOURCE` rows too (317).
- models.test.mjs:48-57: every bag kind needs a model or a held fallback.
- item-icons.test.mjs:13: non-placeholder icons must be in icons.svg and in `SPRITES`
  (dist/survival-ui.js:22). Easiest is a placeholder icon in item-svg.js `ITEM_ICONS`, as flowerseed does
  (dist/item-svg.js:280).

**Content module and co-op**
- Module shape is documented at dist/content.js:7-29, and FEATURES is at 46. Copy dist/bees.js, which has a
  pure top half and tests.
- `load('net')` skips unchanged rev/signature (dist/bees.js:167-176). Repaint plant meshes only when the
  revision changes.
- Harvest emits `kind:'loot', loot:{...}` so the pickup feed shows icons (dist/game.js:1022).
- Prompts: content `prompt()` is already bridged to raftPrompts (dist/game.js:735, 743), so no separate
  provider is needed. It ranks below `waterAim` and above the fc grill.
- Proposed slice, owned by the host and synced via `ext` in the state message (dist/game.js:1572):
  `world.ext.crops = {v:1, r:rev, b:{"x,z":{c:'flax', g:0..T, w:0|1}}}`.
- Guest actions: `ctx.action({kind:'crops.plant'|'crops.water'|'crops.harvest', x, z, seed?})`. The host
  checks reach the way applyWatering does (USE_REACH + HOST_SLACK).
- Old host: notice like bees `OLD_HOST` (dist/bees.js:8). Prune beds whose decor is gone; `load(undefined)` -> empty.

## (c) Risks

1. **world.garden pruning.** Bed state stored there is deleted within 1 s (dist/watering.js:72, 97).
   Use world.ext.
2. **Clicking a fresh cup drinks it** (dist/game.js:1252). Use E-to-water or a new useSelected hook, and say
   which in the prompt.
3. **Barrel and bush odds drift.** It affects smelter pacing (dist/items.js:313) and the islands.test.mjs
   seed-rate bounds.
4. **Boilerplate fan-out.** About 8 new kinds are planned: 3 seeds, fibre, petal, tuber, roasttuber and
   gardenbed. Each needs items.js, craft-book ITEM_TEXT and ITEM_SOURCE, item-svg, and a model or fallback.
   A missing entry fails the survival, models or progression tests.
5. **Fibre rope is gated.** As a CONTENT_RECIPES row it is hidden until the desk has seen fibre
   (dist/storage-research.js:29). Say so in the fibre tip, or extend the items.js schema.
6. **Co-op version skew.** Old builds reject unknown bag kinds and reset the bag (dist/content-items.js:4).
   Gate actions with an old-host notice.
7. **Sprinkler expectations.** Players will expect sprinklers to water beds. State "rain and cups" in the
   bed tip, and leave the rain.js:84-93 extension for later.
8. **Placement.** Add a `BLOCK_RADII` entry for the bed (dist/items.js:240), and keep beds off grill tiles
   (`fc.hasGrill`, dist/game.js:982).
9. **Originality.** farming.js:3 names the commercial game in a comment. Keep all new names, text and art
   original.
