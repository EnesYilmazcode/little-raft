# Farming spec (crop plots, seeds, growth, watering, harvest, birds)

Scope: how Raft (Redbeet Interactive) presents farming, studied from reference stills only, and what Little Raft should change. This is an internal study. Nothing here is an asset to copy. The change list recommends mechanics and feel, not Raft's look.

Method: every frame was opened and inspected. Colours are the median of a 7x7 patch (3x3 for small features), sampled with Pillow and numpy, and given with image and pixel coordinates. Screen positions are % of the 960x540 frame. Frame names are `<videoid>_<mmss>.jpg` (for example `_0600` = 06:00 = 360 s). Scratch crops are in the session scratchpad under `farming/`.

## 1. Images examined

YouTube frames, `references/raft/farming/yt/` (all 960x540, one video, Dle8DwL05lw):
`_0000` (intro card), `_0120` (sprinkler recipe), `_0240` (empty plots row), `_0350` (scarecrow recipe, storage), `_0450` (holding a harvested beet), `_0600` (planted + watering), `_0700` (scarecrow recipe, plots with sprouts), `_0800` (sprouts), `_0900` (mature, harvest prompt, night), `_1000` (placement ghost of a hex plot), `_1130` (hex plots with seedlings), `_1230` (pineapple and watermelon fruiting), `_1330` (empty hex plots at night), `_1440` (large plot recipe, mango seed), `_1550` (deck overview, scarecrow), `_1650` (large tree plots), `_1750` (large plots with trees), `_1850` (outro card).

Wiki stills, `references/raft/stills/wiki-items/`:
`crop-plot-comparison.jpg`, `crop-plot-small-potatoes.jpg`, `crop-plot-medium-planted.jpg`, `crop-plot-small-wall.jpg`, `crop-hanging.jpg`, `crop-plot-{small,medium,large}-icon.jpg`, `crop-potato.jpg`, `crop-beet.jpg`. The wiki-items `SOURCES.md` notes also say that Raft waters crops with a cup, has no watering can, and has a sprinkler.

Little Raft code: `dist/game.js`, `dist/inventory-state.js`, `dist/crafts.js`, `dist/survival-ui.js`. Branch `origin/wip/fleet/farming` (commits 2768081 and 02bbd0c) was read with `git show` and `git diff` only.

## 2. Observations / spec

### Plots and slots
- **C1. Several plot sizes, each with a fixed number of slots.** The comparison sheet shows four families. Small is a rectangle with 3 slots (the "advanced" variant has 4). Medium is a hexagon with 2 slots (the advanced square has 4). Large holds 1 tree. A small variant also mounts on walls. Evidence: `crop-plot-comparison.jpg` (captions and visible mounds), `crop-plot-small-potatoes.jpg` (3 mounds), `_1000` (hex ghost with 2 mounds), `_1650`/`_1750` (large log-framed plot, 1 tree each).
- **C2. Plot footprint is about one deck tile wide.** In `_0240`, six small plots stand in a row on the raft edge, each about 140 to 150 px wide (15% of the frame), against neighbouring deck tiles of about 150 px. In `crop-plot-comparison.jpg` (top left), a small plot is about 85x58 px on a tile grid with about 52 px pitch, so roughly 1.6 x 1.1 tiles. That size is approximate (the image is top-down but scaled).
- **C3. The rim stands well above the soil.** The plot is a wooden box. In `_0600` the soil sits about 25% of the box's visible height below the rim, and the box front is about 18% of frame height at 1.5 to 2 m. Measured soil colour, empty and dry: `#5d4a43` (`_0240` 430,250) and `#5a463d` (`_0240` 560,250).
- **C4. The placement ghost previews the slots.** The ghost is a flat, bright translucent green with the slot mounds modelled in. It covers about 35% of frame width at close range. A rotate hint sits centred at about 82% height ("press or hold to rotate smoothly"). Evidence: `_1000`.
- **C5. A plot is one recipe in a FOOD/WATER category,** next to sprinkler and scarecrow. The category list in `_0350`/`_0700` reads: containers, bucket, purifiers, grills, cookingpot, cropplots (3 icons), grass plot, sprinkler, scarecrow, healing salve. Large plot recipe (`_1440`): plank 10, rope 4, nail 6, hinge 1, described as "Lets you grow trees".

### Seeds and planting
- **C6. A seed is a held item, planted into a free slot.** Seeds stack in the hotbar (`_1130`: two seed stacks of 13 to 15, with dotted icons). A fruit seed's tooltip reads "Add water to get a mango tree. Fits in a large crop plot" (`_1440`). Some crops are their own seed: the wiki titles `crop-potato.jpg` and `crop-beet.jpg` "(seed and crop)".
- **C7. A just-planted seed is barely readable.** In `_0600` (middle plot) each seed is a green dot of about 6 px, 0.6% of frame width, coloured `#59694d` (538,283) and `#70825c` (446,343) on soil `#614b3f` (520,320). In `crop-plot-small-potatoes.jpg` the first shoots are about 25 px on a 681 px still (3.7%).

### Watering
- **C8. Water is carried in a drink container and poured with a prompt.** With a filled bottle in hand and the crosshair on a plot (`_0600`), the centre prompt reads "[E] WATER CROPS". The bottom hint row reads "[LMB] DRINK · [RMB] POUR LIQUID · [X] REMOVE". The bottle viewmodel fills the bottom-right, about 10% of frame width and 45% of frame height.
- **C9. Watering is per slot and shows as dark soil around the plant.** In `_0600` (left plot) each watered slot has a dark ring mound of about 40 px radius, roughly 18% of the plot width. Ring colour is `#2e282a` (225,228) against dry soil `#614b3f`, so about 47% lower luminance. The wiki still repeats this: wet mound `#3c3834` (345,165) against dry soil `#645143` (230,140), in `crop-plot-small-potatoes.jpg`. The unwatered middle plot in `_0600` shows no rings. The signal is the contrast between dark and light soil, not a puddle or icon.

### Growth stages and timing
- **C10. Five readable states.** (1) Empty soil (`_0240`). (2) Seed dot (`_0600` middle). (3) Watered seed with dark mound (`_0600` left). (4) Sprout, 2 to 6 paired leaves on a thin stem, about 100 px tall at 1.5 m, about 45% of plot depth; leaf `#285e3c` (`_0800` 355,262), with a visible orange root nub. (5) Mature: a bushy crown (beet, `_0900`, leaf `#203820` at night) or visible fruit (`_1230`: pineapple fruit `#70713b` at 58,285, watermelon leaf `#598f66` at 690,325). Mature plants are about 2x the sprout's width.
- **C11. Timing (from video timestamps, likely edited).** Seeds are planted and watered at 06:00 (`_0600`). Sprouts are up at 08:00 (`_0800`, +120 s). The harvest prompt appears at 09:00 (`_0900`, +180 s). For hex plots, seedlings show at 11:30 (`_1130`) and fruit at 12:30 (`_1230`, +60 s). The video is a tutorial and probably skips time. Raft crops take several in-game minutes per stage (from memory, unverified).
- **C12. The plant has a whole shape at every stage.** No progress bar or percentage is shown on screen in any frame. Stage is read from the plant model alone (`_0600`, `_0800`, `_0900`, `_1130`, `_1230`).

### Harvest
- **C13. Harvest is the E prompt when looking at a mature plant.** `_0900` shows "[E] HARVEST" centred above the crosshair. Measured positions: key cap at (480,218), which is 50% x and 40% y. The label is at 44% y. The crosshair is at 50%, so the prompt sits about 52 px (9.6% of height) above it. The bottom hint row is at 81.5% (key) and 84.6% (label) height, as in `_0600`, `_0450` and `_0240`.
- **C14. The harvested crop is food, held and eaten from the hotbar.** `_0450`: a beet in hand, "[LMB] EAT", hotbar stacks of 20 beets and 20 potatoes. Harvest returns the crop plus seeds, sometimes more than one, so a farm can expand (from memory, unverified).

### Birds and protection
- **C15. Birds threaten crops and a scarecrow counters them.** Scarecrow tooltip: "Keeps seagulls away from your crop plots". Recipe: plank 5, palm leaf 3, nail 3, plastic 3 (`_0700`, `_0350`). Scarecrows stand on posts near plots, about 30% of frame height at 4 to 5 m (`_1130`, `_1230`, `_1330`, `_1550`). No gull appears in any frame. From memory, unverified: gulls land on plots with growing crops, peck and destroy them, and fly off when hit. A scarecrow keeps them away within a radius.
- **C16. An automatic watering device exists.** Sprinkler tooltip: "Waters your crops automatically. Seems to be missing a battery though." Recipe: plastic 12, scrap 2, bolt 2, circuit board 1 (`_0120`). The wiki-items SOURCES row `sprinkler-layout.jpg` describes coverage over several plots (image not opened, not in the requested set).

### Variants
- **C17. Vertical and hanging planters exist.** `crop-plot-small-wall.jpg` shows small plots mounted on walls, stacked up to 6 high in the comparison sheet. `crop-hanging.jpg` shows a rope-hung bowl planter. Both are late-game space savers.

## 3. Little Raft today

**main / `dist/` (what ships): no farming at all.** `grep -i 'crop|plot|seed|farm|harvest|grow|bird|gull' dist/*.js` finds only PRNG `seed` variables (`crafts.js:36`, `game.js:69`, `hammer.js:20`, `wood.js:5`, `debris.js:12`) and unrelated words.
- The nearest thing is a decorative **Palm Planter**: item `inventory-state.js:24`, recipe `{wood:2, leaf:3}` at `inventory-state.js:50`. It is a `DECOR_TYPES` member (`game.js:27`), always shown fully grown. The detailed model is `buildPalm` (`crafts.js:309`, terracotta pot plus palm, about 2.25 m tall). The fallback is `game.js:346`/`:359`.
- There are no hunger or thirst stats. There is no fresh water, cup or container item. Fish is the only food-like item (`inventory-state.js:19`). Seeds have no source: `LOOT` at `game.js:31` drops only wood, leaf, scrap and plastic.
- Interaction: E (`interact`, `game.js:613`) picks up debris or opens the bag. Left click (`useSelected`, `game.js:626`) places decor, builds or fishes.
- Context prompt: `#contextPrompt` is styled in `game.js:48` at `top: calc(50% + 26px)`, centred, so it sits just **below** the crosshair. Raft's sits about 9.6% of height **above** it (C13). Both work. Little Raft has no secondary hint row.
- Placement ghost: a flat `BoxGeometry(1.9, .13, 1.9)` at opacity .55, colour `#b6ffd0` (`game.js:294`). It does not show the item's shape (compare C4).

**Branch `origin/wip/fleet/farming` (unmerged, about 520 added lines):**
- `dist/farming.js` holds the pure rules. A placed Palm Planter now starts as a dry SEEDLING. It has 4 stages (Seedling, Sprout, Young palm, Palm). `STAGE_SECONDS = 50` and `WATER_SECONDS = 90` (one cup is 90 s of growth, so two cups take it from seedling to mature in 150 s of wet time). Growth happens only while the soil is wet. `HARVEST = {leaf:3, seed:1}`. Ops are plant, water, harvest and fill. The rules are host-authoritative and persisted as `d.farm = {s,g,w,h}`. Legacy saves load as mature.
- New items: `seed` (Palm Seed), `cup` (Filter Cup, recipe `{plastic:2, leaf:1}`), and `water` (Cup of Fresh Water: a cup filled by clicking the sea next to the raft). Barrels also drop `seed:1` (patched `LOOT` in `game.js`).
- `dist/farming-view.js` draws a pot, dry soil `#b58e62` or wet soil `#4b3324`, a puddle disc (`CircleGeometry(.3)`) when wet, and a cone-leaf palm per stage (heights .14, .32, .8 and 1.6 m). Plants sway. Aiming steps back along the ray to pot height.
- `game.js` changes: left click plants or waters, E harvests. `promptFor` adds a percentage, for example "Sprout 37%: dry soil, needs fresh water". Growth uses a wall clock, capped at 5 s per frame. The guest diff ignores `farm` so growth ticks do not rebuild the raft. A test suite is in `tests/farming.test.mjs`.
- Gaps against the reference: one plant per planter, so no slots (C1). The only crop is a palm, which yields materials and no new kind of item. Harvest gives exactly 1 seed back, so the farm cannot grow, and barrels (1 in 11 spawns) are the only other seed source. Wetness shows as a puddle plus a soil colour swap rather than per-slot dark soil (C9). Plant and water use click while harvest uses E, which does not match C8/C13 (E for all three). There are no birds and no scarecrow (C15).

## 4. Ranked change list

1. **#1 Land the farming core from `wip/fleet/farming`.** (`dist/farming.js`, `dist/farming-view.js`, `dist/game.js`, `dist/inventory-state.js`, `tests/farming.test.mjs`: rebase onto main and keep the host-authoritative rules, the wall-clock tick and the legacy-save "mature" default.) Impact H, effort M.
2. **#2 Multi-slot crop boxes beside the tree planter.** Add a new `cropbox` decor of 1 tile with 3 slots in a row (C1, C2). `farming.js`: change `d.farm` to `{slots:[{s,g,w}...]}`. `farming-view.js`: place a slot at the nearest aim point. Keep the Palm Planter as the 1-slot "tree" plot. Style it as Little Raft's own plank crate, not Raft's box. Impact H, effort M.
3. **#3 Per-slot wet soil instead of a puddle.** `farming-view.js`: drop the `puddle` mesh. Darken only that slot's soil disc (radius about 18% of plot width) to about 50% of dry luminance (reference range: dry `#5d4a43` to `#645143`, wet `#2e282a` to `#3c3834`), and let it fade back over the last 10 s of `w` (C9). Impact H, effort S.
4. **#4 One key for the obvious plot action.** In `game.js` `interact()`, call `farmUse(aim, true)` first and resolve with `plotAction`: holding a seed and aiming at an empty slot plants, holding water and aiming at a dry slot waters, aiming at a ripe plant harvests. Keep left click as an alias. The prompt reads "[E] Plant / Water / Harvest" (C8, C13). Impact H, effort S.
5. **#5 Seed economy that can grow.** In `farming.js` change `HARVEST` to give 1 to 2 seeds (mean about 1.4) plus produce. Keep barrel seeds in `LOOT` (`game.js:31`) and add a rare floating "seed pod" debris type to `SPAWN_TABLE` (`game.js:30`), so a player can reach 3 plots in about 15 minutes. Impact H, effort S.
6. **#6 A real crop, not only palms.** Add one quick vegetable-like crop of Little Raft's own invention (3 stages, about 60 s per wet stage) that yields an edible or useful item: for example, a fibre plant that yields 2 rope-equivalents, which ties into the `rope` recipe (`inventory-state.js:45`), since Little Raft has no hunger. Impact M, effort M.
7. **#7 Readable seedling stage.** The `palm-0` model and the new crop's stage 0 should reach at least 1.5% of screen width at 2 m (Raft's 0.6% dot, C7, is too small). Add a brighter tip colour. Impact M, effort S.
8. **#8 No percentage in the prompt by default.** `farming.js promptFor`: use the stage name plus a state ("Sprout · needs water", "Growing"). Show the % only when the player is close and holding water, since Raft relies on the model alone (C12). Impact L, effort S.
9. **#9 Birds that peck crops.** New `dist/birds.js`, host-side. Every 90 to 150 s, if there is a growing slot and no scarecrow within 6 tiles, a gull glides in, lands on the slot for 12 s, then removes one growth stage. Hitting it, or clicking with any tool within 3 m, scares it off. Sync the gull in the world snapshot. Give it its own silhouette and colours (C15). Impact M, effort L.
10. **#10 Scarecrow decor.** Add it to `DECOR_TYPES` (`game.js:27`), `ITEM_INFO` and `RECIPES` (`inventory-state.js`, about `{wood:4, leaf:2, plastic:2}`), with an original model in `crafts.js` (about 2.2 m). It protects within a 6-tile radius, shown as a faint ring when held (C15). Impact M, effort M.
11. **#11 Shape-aware placement ghost.** In `game.js:294`, when holding a planter or crop box, use the decor's own geometry (or a simplified version) in the ghost material, with slot discs visible (C4). Impact L, effort S.
12. **#12 Bottom hint row for the held item.** Add a second line under `#contextPrompt` (`game.js:48`), about 82% from the top, listing secondary actions, for example "[Click] Pour · [E] Water" (C8, C13). Impact L, effort S.
13. **#13 Rename and clarify water.** "Filter Cup" filling from the sea is a deliberate simplification. Keep it, but have the prompt say why, for example "Cup's leaf filter makes it fresh". Optionally make one cup water all 3 slots of a box, so 3-slot boxes do not triple the chores. Impact L, effort S.
14. **#14 Later: automatic watering.** A scrap-heavy sprinkler decor that sets `w = WATER_SECONDS` on slots within 1 tile every 60 s (C16). Impact L, effort M.

## 5. Open questions / UNSURE

- Real growth durations in Raft are unknown. The video timing (C11) is probably edited. Treat the WIP 50 s per stage as a tuning start and test it in play.
- Whether Raft's water lasts until the crop is grown, or must be repeated, is not shown. The frames show one watering, then later stages without visible re-watering (`_0600` to `_0800`), but that comes from an edited video. Little Raft's 90 s per cup is a design choice.
- No gull is visible in any frame. All bird behaviour (C15) beyond the scarecrow tooltip is from memory and unverified.
- Seed return per harvest in Raft is from memory, unverified.
- Plot footprint in tiles (C2) is approximate, measured on a scaled top-down wiki image.
- `sprinkler-layout.jpg` and the seed icons in wiki-items were not opened (they fall outside the requested crop-* set).
- Whether the WIP branch should be landed as is or rebased onto the newer main (the branch base differs from current `dist/` build tags) needs a decision by whoever integrates it.
