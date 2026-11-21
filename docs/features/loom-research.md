# Loom and Woven Cloth: research

Feature: a placeable **Loom** that slowly weaves **Woven Cloth** (`cloth`) from soft materials. Cloth then feeds a
few recipes, and the parallel Woven Satchel feature uses it too (docs/features/satchel-research.md:4,132 already
says `cloth`). **No `cloth` kind exists today.** `grep "'cloth'\|cloth:"` finds only material and model names
(materials.js:28, avatar.js:219, coop-avatar.js:40), so `cloth` is free and we keep that name.

## 1. Raft's Loom (reference only)

WebSearch could not confirm Raft's Loom: three searches returned only other games' looms and a mobile clone.
From memory, **unverified**:
- Raft's Loom is an early wooden station. Soft plant material (palm leaves, later other fibres) goes in, and it
  weaves a cloth or thatch material on a timer, with no fuel. You collect the result by hand.
- Raft uses the woven material for comfort and sailing items: beds, sails and hammock-style decor.
- Other games share a pattern: N fibre become 1 cloth over seconds to minutes, no fuel. Stardew takes 1 wool and
  4 h; LEGO Fortnite takes 5 thread; Palia takes 5 thread and 10 min.

Takeaway: fuel-free, one input stack and a short timer. It plays like the Sorting Tub, not like the kiln.

## 2. Existing code to reuse

**Option A (recommended): a slot-panel station like the Sorting Tub.** Everything below already exists.
- **dist/items.js**
  - `LIST` holds the catalogue (:80-332), with stations at :320-330. The `recycler` entry (:329) is category
    `'station'`, `hand({wood:6, rope:2, nail:3})`, `discover('nail')`.
  - `EXTRA_RECIPES` (:369) and `stationExtraRecipes(id)` (:377) hold fuel-free recipes as
    `{inputKind: {kind, in, count, time, fuel:0}}`. The `in` field lets 4 leaves become 1 cloth.
  - Every placeable needs a `BLOCK_RADII` entry (:341; recycler at :353).
- **dist/smelter.js**: `StationModel.recipeFor()` (:31-44) reads ITEMS station recipes first, then the extra
  recipes. `usesFuel` (:50) is false only when no ITEMS recipe names the station. So keep every loom recipe in
  `EXTRA_RECIPES`; smelter-ui.js:110 then hides the fuel slot. (Leaf and seaweed are fuels in `FUEL_VALUE` :380,
  which doesn't matter here.)
- **dist/progression-hooks.js**
  - `COOKERS` (:33) picks up stations with extra recipes automatically; `STATIONS` is at :35.
  - Add a `loom` entry to `MODELS` (:36) and a `PANEL_COPY.loom` (:46), e.g. `{input:'To weave', busy:'Weaving'}`.
  - Host-authoritative `prog:insert/take/takeInput` actions already exist in `apply()` (:132-162). Guests send
    them with `ctx.action`, and the host mirrors back through `prog:sync`.
  - `stationPrompt` (:185) shows "E Use the Loom" for free, and undecor already works (:105-108).
  - Animation goes in the tick node cache (:315-318): rock a beam while `st.cooking`.
- **dist/recycler-model.js** is the model template. It has named animated children (`recyclerCrank`,
  `recyclerPile`); the loom would use e.g. `loomBeam` and a `loomBolt` cloth roll shown when there is output.

**Option B: a content module like the kiln**, if we want "hold leaves and press E" with no panel.
- **Registry**: `dist/content.js` gives the module shape (:7-51) and `FEATURES` (:94). Insert the loom before
  `createCookpot`, which stays last.
- **docs/features/content-hooks.md**: the hook table covers `serialize`, `load(data,'save'|'net'|'restore')`,
  host-only `action`, `interact` and `prompt`. Old saves call `load(undefined)`. The host sends `serialize`
  about 8 times a second, so it must be cheap.
- **dist/kiln-core.js**: pure rules (`blank`, `cleanEntry`, `cleanSlice` :47, `sliceOf` :69, `canLoad`, `step`).
  `applyKilnAction` (:132) validates first, commits a scratch bag and bumps `st.r`.
- **dist/kiln.js**:
  - `target(aim)` ray pick (:27) and `load()` with a net `r` short-circuit (:55);
  - a 1 s prune of tiles with no kiln (:99-111) and a cached `prompt` (:116);
  - `interact` sends `kiln.*` (:135), and `action` handles it (:145);
  - undecor hooks (:193-198) and `debug.run/finish` (:154-188).
- **dist/cookpot.js / cookpot-core.js** use the same pattern with `pot.*`. **dist/juicer.js** is the timer-less
  version: pure `blend()` at :47, and the juicer is category `decor`, not `station` (items.js:256).
- **What Option B needs**: a `world.ext.loom` slice `{v, r, k:{"x,z":{r,q,t,o,n}}}`, plus entries in
  `CONTENT_ITEMS`, `CONTENT_RECIPES`, `CONTENT_DECOR` and `CONTENT_BLOCK_RADIUS` (content-items.js:9, :78, :143,
  :144).

**Item kinds and gating**
- **Inputs**:
  - `leaf` (items.js:84): START, about 3 in 11 drifting items, plus palms.
  - `feather` (content-items.js:32): scarce. animals-core.js:6 sets `FEATHER_CHANCE = .35` per egg cycle and
    `FEATHER_CAP = 3`; petting gives one every 120 s at 5 or more hearts (:7).
  - `seaweed` (items.js:107): barrels only, and already used as fuel, goat food (animals-core.js:18) and a cookpot
    ingredient (cookpot-core.js:6).
  - `rope` (items.js:131) is `hand({leaf:2})`.
- **Two unlock systems**:
  - items.js entries use `unlock` (discover, research or station), handled by progression.js and the Research
    Table. game.js:509 `setOwnedElsewhere` hands them to that system.
  - Other `CONTENT_RECIPES` ids are gated by the Tinker's Desk. `learnedFrom` (storage-research.js:40) unlocks a
    recipe once all its cost kinds have been seen there. `craftLocked` is at :392, and game.js:1234 makes the
    host refuse locked crafts.
- **Where things go**: `cloth` and `loom` in items.js. Alternate cloth recipes go in CONTENT_RECIPES under a new
  id with the same `output.kind`. Precedents: `egglamp`→`lantern`, `glasscups`→`cup`, `brickplanter`→`palm`
  (content-items.js:105-110).
- **Merge order** (inventory-state.js:72-90): legacy, then `...CONTENT_RECIPES`, then `...recipeTable()`, so
  items.js wins. CONTENT_RECIPES already has duplicate keys (motor, wheel, bed, brush, paint_* at :80-88 and again
  at :113-121). The last copy wins, so don't edit the first one by mistake.

**Power hook (optional).** power.js speeds up no station today. A content-module loom could call
`peer.peek('power')` (content.js:126-127) with the pure `servingBattery(st, decor, x, z)` (power.js:80) and
weave 1.5x faster near a charged battery. `tickPower` (:83-109) drains only lights, so the loom would use no
charge unless power.js changes. Option A has no peer access, so leave this for v2.

**Model style** (docs/MODEL-STYLE.md):
- Build from code with bevelled `rbox` parts, one merged mesh per material, and vertex colours.
- Colours: dark wood `#6b4529` frame, plank `#c48c55` beams, rope `#cdb07a` warp, cloth `#efe6cf`/`#d8c6a0` bolt.
- Placeable budget is 3000 triangles or fewer at LOD 0. Fit inside 1.7 x 1.7 m and stand on y = 0.

## 3. Where cloth fits today

These leaf and rope recipes suit cloth. Keep all of them as they are and add cloth versions alongside:
`sail` (items.js:292, `{wood:10, leaf:20, scrap:3}`), Simple Bed `bed` (content-items.js:115,
`{leaf:10, wood:6, plastic:4, nail:3}`), Woven Deck Mat `rug` (:90, `{leaf:4, rope:2}`), `hammock` (:94),
`pennant` (:91), `flagpole` (cloth flag, :139), `cushion` (:109, `{feather:3, leaf:2}`) and `scarecrow`
(items.js:289).

**Balance anchor: 1 cloth = 4 leaves and 20 s** (about 2 rope's worth of leaves, plus a wait). 2 feathers make 1
cloth in 12 s as a luxury path. Seaweed is optional (3 for 1 in 25 s); it competes with goats and soup, so it
could be dropped.

| id (new) | output | cost | compared with the old recipe | gating |
|---|---|---|---|---|
| `loom` (items.js station) | Loom | `{wood:8, rope:4}` | new | `discover('rope')`, early like the drum |
| `clothsail` | `sail` | `{wood:8, cloth:4, rope:2, scrap:2}` | about 24 leaves' worth, but 2 less wood, 1 less scrap and no 20-leaf hoard | Tinker's Desk |
| `clothbed` "Quilted Bed" | `bed` | `{wood:6, cloth:2, plastic:2, nail:3}` | 8 leaves' worth instead of 10 leaves; 2 less plastic | Tinker's Desk |
| `clothrug` "Patchwork Mat" | `rug` | `{cloth:2}` | same leaf cost (8), one ingredient | Tinker's Desk |
| `bunting` "Sailcloth Bunting" | new decor | `{cloth:2, rope:2, wood:1}` | new | `discover('cloth')` |

`satchel` belongs to the parallel feature (`{cloth:4, rope:3, leaf:4}`). Bunting needs a model, `BLOCK_RADII` and
icons. If scope is tight, ship the loom, cloth and the three alternate recipes only.

## 4. Risks and checklist

- **Saves and world.ext**:
  - Option A keeps station contents in localStorage `littleRaft.progression.v1` (`stations`,
    progression-hooks.js:111-115), like the smelter. There is no ext migration, and guest-hosted visits keep
    nothing, which is existing behaviour.
  - Option B's `world.ext.loom` `cleanSlice` must accept `undefined` and junk, prune tiles that no longer hold a
    loom, and stay small: `EXT_MAX` (content.js:98) allows 200k characters for all of ext. Old builds drop
    unknown ext keys.
  - On either option, old builds reject an unknown `cloth` kind in bag snapshots (content-items.js:4), while new
    builds keep it (`registerBagKinds`, items.js:604).
- **Co-op**:
  - The host owns the timers, and guests only send actions (`prog:*`, or `loom.*` in Option B).
  - `loom.*` handling must check reach and `decorAt` the way `applyKilnAction` does.
  - `load(data,'net')` must skip work when `r` is unchanged (kiln.js:56-60), and an old host should get an
    `OLD_HOST` notice (juicer.js:11).
- **Prompts**:
  - Option A gets one from progression-hooks.js:185.
  - Option B actionable prompts are `'<kbd>E</kbd>Weave 4 palm leaves · …'`. Info-only lines start with an empty
    `'<kbd></kbd>'` (storm.js:365-367), so `promptParts` (content.js:111) shows a muted row that stays out of
    the feed.
  - Cache the string the way kiln.js:119 does.
- **Tests that enumerate items and recipes**:
  - **tests/progression.test.mjs**:
    - :100-122 needs a tip over 10 characters, an `icon-*` and a radius on every ITEMS entry.
    - :126-158 checks references. `STATIONS_WITH_RECIPES` (:21, :142) needs `loom` only if an ITEMS recipe uses
      `station:'loom'`.
    - :180-205 is reachability: cloth made only through `EXTRA_RECIPES` is unreachable there. Add
      `if (have.has('loom')) have.add('cloth')`, like the juicer line at :195.
    - :207 and :220 check the info and recipe tables.
  - **tests/craft-ux.test.mjs:124-132**: `sourceOf` needs `ITEM_SOURCE.cloth` (craft-book.js:435). Also add
    `ITEM_TEXT.cloth/loom` (:58) and a `CATEGORY_OF` tab (:14).
  - **tests/storage-research.test.mjs:22-27** compares only `ORIG`, so new content recipes are safe.
  - **Icons**: tests/item-icons.test.mjs:12-24 plus the `ITEM_ICONS.x` checks in the recycler, armor and axe tests.
    Placeholder icons need `ITEM_ICONS.cloth`/`.loom` in item-svg.js:10.
  - **tests/recycler.test.mjs** is the template for a `loom.test.mjs`; keep its "smelter and grill unchanged"
    check (:104) green.
- **live.js `PRELOAD`** (:16): add every new static import (`loom-model.js`, plus `loom.js` for Option B).
  tests/live-preload.test.mjs requires it to equal game.js' static import graph; see recycler at :31.
- **survival-ui.js `SPRITES`** (:24) and **icons.svg** matter only for `placeholder:false`. Prefer placeholder art
  from item-svg.js (the default when the items.js entry has no `icon`). If a real `icon-cloth` symbol is added,
  add both the symbol and `'cloth'` to `SPRITES`, or item-icons.test fails.
- **Undecor**: Option A is covered. Option B needs `beforeUndecor`, `undecorLoot` and `afterUndecor`, or `loom`
  in `NO_UNDECOR` (content.js:97).
- **Alternate recipes**:
  - A second recipe with the same `output.kind` shows as a second card, and `sourceOf` picks the first one
    (craft-book.js:504).
  - Progressed saves don't auto-unlock them: `stateFrom` (storage-research.js:118-133) grandfathers only saves
    with no learned list, so cloth must still be studied at the desk.
