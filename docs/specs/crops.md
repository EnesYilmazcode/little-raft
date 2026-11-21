# Crop variety: Garden Bed + 3 crops (spec)

Research: docs/features/crops-research.md (anchors re-checked). Cozy rules: crops never wilt or die; a dry bed
pauses and keeps its progress; every harvest gives the seed back. Names, text and art are original.

## Files
- `dist/crops-rules.js`: pure (no DOM, THREE, clock or rng). Tables, clean/tick/plant/water/harvest, tested.
- `dist/crops-models.js`: `createGardenBed(T)` plus `paintBed(group, entry)` (soil tone, stage meshes).
- `dist/crops.js`: content module `name: 'crops'`, appended to FEATURES (dist/content.js:47), shaped like dist/bees.js.
- Data edits: dist/items.js, dist/content-items.js, dist/islands-layout.js, dist/craft-book.js, dist/item-svg.js.
- `tests/crops.test.mjs` (new), one line in tests/progression.test.mjs. Do **not** touch world.garden,
  dist/watering.js, dist/farming*.js or dist/rain.js (cleanWatering deletes non-palm keys, watering.js:72, 97).

## Crops (CROPS table in crops-rules.js)
| id | seed kind | grow T (watered s) | harvest | output use |
|---|---|---|---|---|
| `flax` Sea Flax | `flaxseed` | 120 | 2 `fibre` + 1 seed | Fibre Rope: 1 fibre -> 1 rope |
| `bell` Blushbell | `bellseed` | 150 | 2 `petal` + 1 seed | Blush Paint: 2 petal -> 4 Coral paint pots |
| `tuber` Sweet Tuber | `tuberseed` | 180 | 2 `tuber` + 1 seed | eat raw, or grill -> `roasttuber` |
- Stages: `stage(e) = g >= T ? 2 : g >= T/2 ? 1 : 0` (sprout, leafy, ripe), as plantStage (dist/watering.js:85).
- Moisture: `w` is the seconds of water left, from 0 to `WET_MAX = 60`. One fresh cup sets `w = 60`. While
  `ctx.rain() > .2` (dist/content.js:99), every bed is held at `w = 60`. A tick advances `g` only while `w > 0`,
  decrementing w. So flax needs 2 cups, tuber 3, or a rain shower. At `g >= T`, `g` clamps and `w` stops draining.
- Bee bonus: +1 produce when a `beehive` decor lies within `FLOWER_RANGE` (2, Chebyshev; dist/bees.js:7) of the
  bed. Import FLOWER_RANGE from bees.js. There is no rng, so harvests are deterministic.

## State: `world.ext.crops`
`{v:1, r:rev, s:session, b:{"x,z":{c:'flax'|'bell'|'tuber', g:int 0..T, w:int 0..60}}}`. An empty bed has no key.
- `cleanCrops(data, decor)` drops keys whose decor is not `gardenbed`, unknown `c` and junk numbers (clamps).
  `load(undefined)` gives `{v:1, r:0, b:{}}`. It never throws on old saves or garbage.
- The host prunes every tick: a picked-up bed loses its crop, with no seed refund (matches palms).
- Host `update(dt)`: accumulate dt and tick whole seconds (cap `MAX_TICK = 60`). Bump `r` only when a `g`/`w`
  value changed. `serialize()` is cached on `r` like bees.js:180.
- `load(data,'net')`: return early when `data.r === netR && data.s === netS` (as dist/bees.js:167-176), else clean.
  The view repaints a bed only when its signature `c + stage + (w>0)` changes. Meshes are never rebuilt per net tick.

## Garden Bed (placeable, items.js)
- `item('gardenbed','Garden Bed','decor',{placeable:true, iconTint:'#7a5a3a', recipe:hand({wood:4, sand:2, leaf:2}),
  unlock:discover('sand'), tip:'A planter box of soft soil. Plant a seed, water it with a fresh cup or let the rain do it.'})`
- `BLOCK_RADII.gardenbed = 0.45` (dist/items.js:243). It joins DECOR_TYPES via PLACEABLE_IDS (dist/game.js:75).
  The grill-tile block is already generic for DECOR_TYPES (dist/game.js:982, 997, 1130), so nothing to add.
- Model: `crops.decorModel('gardenbed')` returns `createGardenBed(T)`. bees.js:230 shows that items.js placeables get
  their models this way. The model is a low plank box (0.9 x 0.9 x 0.28 m) with a soil top. Dry soil is
  `#9a7552`, wet soil is `#5e4330` with a slight sheen (roughness .55 vs .95). There are 2 plant slots per crop.
  Flax: blue-green stalks (ripe: pale-blue flowers). Bell: rosette (ripe: pink drooping bells). Tuber: leafy
  mound (ripe: orange root). Scale 0.35/0.7/1. Cache geometry and materials; never allocate in update().

## Interaction (E only; prompts via content prompt(), already bridged to raftPrompts at game.js:735, 743)
Target: the aim point's tile (`Math.round(p/2)`) holds a `gardenbed` decor within `REACH = 3` m.
`pickWateringDecor` ignores beds (game.js:934), so the E order reaches `content.interact` (game.js:1238-1239).
| bed state | held | prompt | E sends |
|---|---|---|---|
| empty | a crop seed | `E Plant Sea Flax` | `crops.plant {x,z,seed}` |
| empty | other | `Garden Bed: plant a crop seed` | notice only |
| growing, w=0 | `freshcup` | `E Water the bed` | `crops.water {x,z}` |
| growing, w=0 | other | `Sea Flax 40% · dry, needs fresh water` | notice |
| growing, w>0 | any | `Sea Flax 40% · watered` (or `· rain`) | notice |
| ripe | any | `E Harvest Sea Flax` | `crops.harvest {x,z}` |
- **Drink trap.** A left click with a freshcup still drinks it (game.js:1252-1255), because `useSelected` runs
  `startEat` before `content.use`. So watering is E only and the prompt shows only E. Freshcup ITEM_TEXT
  `use` (craft-book.js:69) becomes "Water a palm planter, or press E on a garden bed." No game.js change.
- Old host (no ext.crops ever seen): prompt and notice `Your friend's raft doesn't grow crops yet` (bees OLD_HOST).

## Host actions (`action(a, actor, bag)`, prefix `crops.`)
- The reach check is copied from bees.js:216: `pose = actor === 'guest' ? ctx.other : ctx.physics`, and the
  action fails if `hypot(x*2-pose.x, z*2-pose.z) > REACH + HOST_SLACK` (2). Also validate isInt x/z, that the decor
  is a gardenbed, and that the seed kind is in CROPS. Return true for every `crops.*` (handled), even a rejection.
- plant: the bed must be empty and the bag must remove 1 seed. Set `b[k] = {c, g:0, w:0}`, or `w:60` when raining.
- water: the bed must hold an unripe, dry crop, and `swapOne(bag,'freshcup','cup')` must succeed
  (dist/watering.js:127, imported). Then `w = 60`.
- harvest: the crop must be ripe. Try the add into a bag snapshot first (atomic, like swapOne). If the bag is full,
  emit `notice 'Your bag is full'` and keep the crop. On success, delete the key and
  `emit({kind:'loot', text, loot:{fibre:2|3, flaxseed:1}}, actor)` so the pickup feed shows icons (game.js:1022).
- Every success does `st.r++`. Guests send `ctx.action(...)` and get the result through the 8 Hz ext state.

## New kinds (8): every boilerplate entry
| kind | name | items.js category / recipe / unlock |
|---|---|---|
| `flaxseed` | Sea Flax Seed | material, no recipe (bush + barrel) |
| `bellseed` | Blushbell Seed | material, no recipe |
| `tuberseed` | Sweet Tuber Eye | material, no recipe |
| `fibre` | Flax Fibre | material (harvest) |
| `petal` | Blushbell Petals | material (harvest) |
| `tuber` | Sweet Tuber | food (harvest) |
| `roasttuber` | Roast Tuber | food, `cook('grill','tuber',{time:15, fuel:.5})`, `atStation('grill')` (as items.js:181) |
| `gardenbed` | Garden Bed | decor, see above |
For **each** kind, the entries needed are:
1. An items.js `item(...)` with a tip over 10 characters. Leave `icon` unset (so placeholder:true) and set an
   `iconTint`. Group them under a `// [crops]` comment.
2. craft-book.js `ITEM_TEXT[k] = {desc, use}` (survival.test.mjs:533-560).
3. craft-book.js `ITEM_SOURCE[k] = {tag, how}` (317). Seeds: `'bushes, barrels'`. Produce: `'garden bed'`.
   roasttuber: `'grill'`.
4. item-svg.js `ITEM_ICONS[k]`: a small original SVG in the flowerseed style (item-svg.js:280). Add nothing to
   icons.svg or SPRITES, because the kinds stay placeholders (item-icons.test.mjs:13).
5. A model or held fallback (models.test.mjs:48-57). The held-items.js generic fallback covers material/food
   kinds; check it for every kind in tests/crops.test.mjs.
- craft-book `CATEGORY_OF`: `gardenbed: 'survival'` (the content rows output rope/paint_coral, already mapped).
- vitals: crops.js calls `addFood('tuber',{food:8, water:2})` and `addFood('roasttuber',{food:25, water:0})` at module
  load (dist/vitals.js:39), so a click eats them. Tips say "+8 food" / "+25 food".

## Output routes (least invasive, justified)
- **Fibre Rope** is a `CONTENT_RECIPES` row:
  `fibrerope: {id:'fibrerope', name:'Fibre Rope', output:{kind:'rope', count:1}, cost:{fibre:1}}`.
  This is the same shape as `glasscups` and `egglamp` (dist/content-items.js:60, 65). `recipeTable()` always
  outputs `kind: id` (items.js:430-442), so an items.js row cannot make rope, and a schema `output` option would
  touch every progression test. The cost is Tinker's Desk gating (dist/storage-research.js:29-56): the player
  must show fibre at the desk once. That is acceptable because the desk is a STARTER recipe (wood 6, scrap 2),
  and every paint pot and kiln extra already learns this way. Legacy progressed worlds auto-learn it on load
  (storage-research.js:127). The fibre tip says: "Show it at a Tinker's Desk to learn Fibre Rope."
- **Blush Paint**: paint exists on master (dist/paint.js:10-16; pots in content-items.js:70-74). Add
  `blushpaint: {id:'blushpaint', name:'Blush Paint', output:{kind:'paint_coral', count:4}, cost:{petal:2}}`.
  It reuses the Coral pot (#e9a08c, pink), which avoids a new palette entry and any paint.js or paint-test churn.
  It is learned at the desk the same way.
- **Roast Tuber**: the items.js station recipe on the progression grill (dist/progression-hooks.js:31-33). It is
  not the fishing-cooking.js grill, and there is no cookpot on master.

## Seed sources (odds)
- Bush (dist/islands-layout.js:186). Only the 0.2-0.5 band (palm `seed`) is split:
  `h<.2 flowerseed | <.38 seed | <.42 flaxseed | <.46 bellseed | <.5 tuberseed | else leaf only`. The total seed
  rate and the flower rate are unchanged, so tests/islands.test.mjs:122-131 still passes untouched.
- Barrel: add 3 treasure rows `{kind, min:1, max:1, weight:1, pool:'treasure'}` after flowerseed (items.js:334).
  The treasure total goes from 102 to 105. Update the odds comment (items.js:313-318) by re-deriving the plain
  rates. Run `node --test tests/progression.test.mjs` (pity and gap test ~307-362). BARREL_PITY is unchanged,
  and seeds are never pity-forced.
- Fix the stale `seed` ITEM_SOURCE "barrels" text (craft-book.js:325) to `'palms, bushes'`. Also drop the
  duplicate `flowerseed` ITEM_SOURCE key (318 vs 343; the later one wins).

## Optional (stretch, not v1)
- Sprinkler: rain.js:84-93 only waters `palm` neighbours, and it is pinned by tests/rain.test.mjs. A later
  `rain.js` change could also feed adjacent dry beds (`w = 60`, 1 tank unit). The bed tip says
  "rain and cups" so nobody expects it now.
- A click-to-water `cupTarget` content hook before `startEat` (game.js:1252).

## Tests: tests/crops.test.mjs (node --test, pure rules plus a module with a fake ctx)
- cleanCrops: undefined/garbage gives defaults; non-bed keys, bad `c` and out-of-range g/w are dropped or clamped.
- tick: dry pauses (g is unchanged for 600 s), wet advances and drains w, a ripe bed stops at T, MAX_TICK clamps,
  and rain holds w=60. Stage boundaries for each crop.
- plant/water/harvest: wrong seed, occupied bed, no freshcup (bag unchanged), freshcup goes to cup, and a full bag
  keeps the crop. The harvest yield is 2 + seed, or 3 + seed with a beehive at Chebyshev 2 but not 3.
- Module: guest out of reach is rejected (state is unchanged, returns true). `load(net)` with the same r/s keeps the
  identical state object. A changed r re-cleans. `load(undefined)` gives an empty state.
- Catalogue: all 8 kinds are in ITEM_INFO, ITEM_TEXT (desc+use), ITEM_SOURCE, ITEM_ICONS, and have a model or
  held fallback. `fibrerope` and `blushpaint` are in RECIPES. `isEdible('tuber')`. BLOCK_RADII.gardenbed. Bush loot
  gives each crop seed for some seed in 0..399.
- progression.test.mjs reachability loop: add a `// [crops]` line, `if (have.has('gardenbed') && have.has(s))`,
  that adds that crop's produce, in the bees style (line 191). Then run the whole `npm test`.

## QA plan (shoot.py copy with raftDebug steps)
- Host-only `raftDebug.content.crops` helpers: `place(x,z)`, `plant(x,z,c)`, `setGrow(x,z,g,w)`, `list()`.
- Shot 1: 9 beds (each crop at stage 0, 1, 2) in daylight; every stage reads differently.
- Shot 2: the same crop wet vs dry, side by side. The soil must be clearly darker when wet.
- Shot 3: aim at a ripe bed, check the `E Harvest` prompt is visible, press E, and check the pickup feed rows and
  that the bed is empty.
- Shot 4: aim at a dry bed holding a freshcup and check the `E Water the bed` prompt. After E, check the cup is
  empty and the soil is wet.
- Co-op loopback (coop-loopback.js): the guest plants and harvests, the host sees the change within 1 s, and the
  guest at 8 m is rejected.
- Rain: `daynight` rain forced on means every dry bed turns wet within 1 s.

## Build notes
- Files: dist/crops-rules.js (pure rules), dist/crops-models.js (bed + 9 shared stage geometries, 2 soil
  materials), dist/crops.js (module), tests/crops.test.mjs. Hooks as listed above, plus three the spec missed:
- **Rain getter.** `ctx.rain` did not exist (content.js:99 is the registry's `rain()`, not on ctx). Added one
  contentCtx line in game.js: `rain: () => content?.rain() ?? 0`. crops.js reads `ctx.rain?.()` and falls back to 0.
- **Prompts.** A held freshcup or tuber is edible, so game.js shows its `LMB Drink/Eat` tip before any content
  prompt and `content.prompt` is never reached. crops.js registers its own `raftPrompts.provide({id:'crops',
  priority:1})` that computes the bed prompt from `ctx.aim()` and steps aside for pickups, the guest waiting
  prompt, swimming and open UI. E still works because the E order reaches `content.interact` regardless.
- **Barrel odds.** Adding 3 weight-1 rows raised the treasure total to 105 and shifted every rng threshold, which
  broke the seeded pity gap test (copper ore worst gap 16 > 15). Instead scrap (the last filler row) goes 30 -> 27:
  the total stays 102, every pick before scrap is bit-identical and pity behaviour is unchanged. Plain rate per
  crop seed .01 (~.005 with pity), scrap .26.
- Target: nearest bed along the view ray (like bees), falling back to the aim point's tile; both within REACH.
- `tests/survival.test.mjs` pins the Materials tab order; `fibrerope` and `blushpaint` were added after the paints.
  `dist/live.js` PRELOAD lists the three new files (tests/live-preload.test.mjs).
- Duplicate ITEM_SOURCE keys: the earlier `flowerseed`, `honey` and `wax` rows were dropped (the later ones
  already won, so nothing visible changes).
- Debug (host QA): `raftDebug.content.crops.{place, plant, setGrow, list, state, fastForward, grid, stand, hold}`.
- Not done (still stretch): sprinkler feeding beds, click-to-water. Harvest also notifies 'A garden bed is ready
  to harvest' once when a crop ripens.
