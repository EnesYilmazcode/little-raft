# Recycler station + junk debris: research

Status: research only (no code). Base tree: `claude/loop-features-202611210749` at 7294e26.
Line numbers are for that commit; grep before relying on them.

## (a) Genre patterns and an original cozy take

Common patterns in ocean/raft survival sandboxes:
- **Junk in the debris stream.** Besides clean resources, the sea carries mixed waste (cans,
  bottles, footwear, nets, crates). You hook it like anything else, but it is not usable as is.
- **Processing station.** A placed machine (recycler, sorter, shredder, "salvage bench") turns
  junk into base materials. Usually one input slot, a progress bar, an output slot.
- **Timed processing.** Seconds per item, queue of a stack, collect output later. Often slower
  than smelting so it feels like a background task.
- **Power or fuel.** Many games burn fuel; some use a crank, a water wheel or later power.
- **Random yields** (loot table per junk) are common, and so is the frustration of RNG on top of RNG.
- **Clean-the-sea framing.** Picking up junk counts toward a "tidy ocean" goal.

Original cozy take for Little Raft ("Tidy Tide"):
- Three junk kinds drift past: **Old Boot**, **Tin Can**, **Sea Jar** (a cloudy glass jar).
  Do not call any of them "bottle": `bottle` is already the logbook's message-bottle debris type.
- **Sorting Tub** (station id e.g. `recycler`): a small wooden tub with a hand crank and three
  little bins. No fuel, no damage. The crank turns by itself while it has input (a friendly
  "it just hums along" machine), so fuel is 0 and the panel hides the fire.
- **Fixed yields, no RNG** (one junk -> one material, which fits StationModel exactly):
  tin can -> 2 scrap; old boot -> 2 plastic (rubber sole; or 1 rope from the laces); sea jar
  -> 2 sand (crushed sea glass). Optional rare treat: every Nth boot has a "lost sock" decor
  item, handled in the action layer, not the model.
- Tip/log copy celebrates tidying: "The sea looks a little cleaner." Counter of tidied junk
  can feed logbook achievements (`dist/logbook.js` `evaluate`) later.
- Economy: junk is a side stream (e.g. 1 in 11 SPAWN_TABLE entries), so it never replaces
  wood/plastic; sea jar -> sand is a gentle alternate source to barrels without skipping the
  smelter (sand still needs the smelter to become glass).

## (b) Code anchors (current tree)

Floating debris
- `dist/game.js:69` `ITEM_TYPES` (wood, leaf, scrap, barrel, plastic, cache); `:71` `SPAWN_TABLE`
  (3 wood : 3 plastic : 3 leaf : 1 scrap : 1 barrel); `:72` `LOOT` per type.
- `dist/game.js:542-543` `makeItem` picks from SPAWN_TABLE; host may swap in a logbook `bottle`.
- `dist/game.js:186-188` `cleanWorld` keeps only `ITEM_TYPES` or `bottle` items (saves and net).
  New junk types must be added to ITEM_TYPES or they vanish on save/load and guest sync.
- `dist/game.js:545-550` `itemModel`: cache -> signal model, bottle -> `createBottle`,
  anything not plastic -> `createDebris`. `dist/debris.js:11` `TYPES` has only 4 types and
  `dist/debris.js:423` **throws** on unknown types, so junk needs its own branch (or new TYPES +
  `FOAM_RADIUS` at `debris.js:420` + material in the cache at `:398`).
- `dist/game.js:879-890` collect action: `LOOT[it.type]` (barrel uses `rollBarrel`), atomic bag
  add, respawn via `makeItem`. `:1294` nets use `lootFits(..., LOOT[it.type])` (coop-rules.js),
  so a LOOT entry is enough for nets too.
- `dist/items.js:291-305` `BARREL_LOOT`, `:347` `rollBarrel(rand, luck)` with pity
  (`:327` `BARREL_PITY`). Junk could optionally appear in the basic pool but need not.
- `dist/models.js:625` `getModel(kind)` (cached clone, `MODEL_ALIASES` at `:606`, builders in
  `B` at `:284`). No boot/can/jar models exist yet; add builders there (palette `:10-17` has
  rust/metal/cork/cloth) and use them from `itemModel`.

What "junk" means today
- Only "invalid input": `dist/items.js:416` (num), `dist/inventory-state.js:96`,
  `dist/fish-journal.js:5`, `dist/seafloor.js:82`, `dist/bees.js:25`. No junk items, no junk
  catches (fishing-rules.js has no loot table). The name is free, but avoid `junk` as an item id
  to keep greps readable; use `oldboot`, `tincan`, `seajar`.

Progression stations
- `dist/items.js:21-32` recipe/unlock schema; `:24` `station: null | 'smelter' | 'grill' |
  'purifier'`; `:60` `cook(station, input, {count, time, fuel})` builds single-input recipes;
  `:199-208` station items (researchtable, grill, smelter); `:214` `STATION_IDS` = category
  'station'; `:218-222` `BLOCK_RADII` (every placeable needs one); `:225` `FUEL_VALUE`
  (wood 1, leaf .5, seaweed .5; plastic never burns); `:381` `stationRecipeFor`.
- `dist/smelter.js:12-156` `StationModel`: generic over `stationId`; `recipeFor` (`:29`) scans
  ITEMS for `recipe.station === stationId` with exactly one cost key; one output kind per input;
  `_reason` (`:85`) only starves when `r.fuel > 0`, so **fuel: 0 recipes run without fuel**.
  snapshot/restore (`:130-155`) validate kinds against ITEMS.
- `dist/progression-hooks.js:20-22` `COOKERS` (derived from recipe.station), `STATIONS`
  (category 'station'), `MODELS` map (smelter/researchtable/grill). `:74-88` `syncStations`
  makes a `StationModel` per placed station decor keyed "x,z"; `:121-137` `prog:insert/fuel/
  take/takeInput` host actions; `:151-160` `openStation` -> `createStationPanel`; `:214-226`
  E-key `stationNear`; `:268` ticks all stations; `:279` `prog:sync` to guest; `:284-287` glow
  via `setSmelterGlow` (only for COOKERS models); `:306-311` `modelFor`.
- `dist/smelter-ui.js:57` `createStationPanel({getStation, getBag, items, fuelValue, ...})`.
  Title = station item name (`:140`). Copy is cooking-specific: "To cook" / "Fuel" headers
  (`:77-78`), flame + fuel bar (`:81`), hints "add fuel", "Cooking ...", "Pick something from
  your bag to cook, then add fuel." (`:107-133`), "No fuel in your bag. Planks burn well." (`:115`).
- `dist/smelter-model.js:116,208,259` model factories; the recycler needs `createRecyclerModel`.

**Verdict: yes, the recycler can be a plain progression station.** Add
`item('recycler', ..., 'station', {placeable:true, recipe: hand({...}), unlock: ...})`, three junk
materials, and recipes via `cook('recycler', input, {count:2, time:12, fuel:0})`. Catch: a
station recipe lives on its OUTPUT item (`recipeFor` scans ITEMS[id].recipe), and each item has
one recipe. `scrap`, `plastic` and `sand` are gathered (recipe null), so `tincan -> scrap` would
make scrap a "crafted" item (changes recipeTable/ITEM_SOURCE/discover semantics). Two options:
(1) dedicated outputs (e.g. `scrapbundle`), clunky; (2) **preferred**: a small frozen
`RECYCLE_YIELDS = {tincan:{scrap:2}, oldboot:{plastic:2}, seajar:{sand:2}}` in items.js plus
`time`, and an `opts.recipes` fallback in `StationModel.recipeFor`/`restore` for the recycler.
The panel and `prog:*` actions already handle any output kind. Test it in smelter.test.mjs.

Panel reuse: pass labels through `createStationPanel` opts (e.g. `{inputLabel:'To sort',
fuel:false, verb:'Sorting'}`) and hide `.st-fire`/fuel chips when the station has no fuel
recipes; keep default copy identical so smelter/grill tests do not change.

Crafting UI and item text
- `dist/inventory-state.js:3,51,53` ITEM_INFO = legacy rows + `infoTable()`; RECIPES include
  `recipeTable()` (hand recipes only, items.js `:402`). New items appear in the craft book
  automatically.
- `dist/craft-book.js:29` `ITEM_TEXT` needs desc+use for every ITEM_INFO kind
  (`tests/survival.test.mjs:544-549`); `:270` `ITEM_SOURCE` add tags ("found floating",
  "sorting tub").
- `dist/item-svg.js:10` `ITEM_ICONS` (48x48 bodies); missing icons fall back to tinted letter
  tiles (`smelter-ui.js:61-66`) and `placeholder:true` in items.js. Add boot/can/jar/recycler.

Tests that constrain the design
- `tests/progression.test.mjs:21` `STATIONS_WITH_RECIPES = {smelter, grill, purifier}`: a
  recipe with `station:'recycler'` fails `:142` until 'recycler' is added there.
- `:143` station recipes must have exactly one cost key; `:144` `time > 0 && fuel >= 0`
  (fuel 0 allowed); `:145` `stationRecipeFor` must return that item.
- `:120,123` placeable <-> `BLOCK_RADII`; `:106` every item needs a tip > 10 chars.
- `:176-198` reachability: raw sources are only wood/leaf/plastic/scrap + BARREL_LOOT kinds;
  junk from debris must be added to that `have` set (or to BARREL_LOOT), else "unreachable items".
- `:174` asserts `TOOL_IDS` exactly; `:231-239` frozen-ness (keep new tables deepFrozen).
- `tests/smelter.test.mjs` covers StationModel; add cases for fuel-0 stations and any yields
  extension. `tests/craft-ux.test.mjs:69` checks ITEM_SOURCE shape.

Co-op and saves
- Station contents are host-only `StationModel`s saved in **localStorage `littleRaft.progression.v1`**
  (`progression-hooks.js:18,95`), not `world.ext`; guests get `prog:sync` snapshots every
  ~0.3 s (`:279`) and render via `stationView` (`:100-106`). A recycler reusing this path is
  synced for free; no content module or ext slice needed.
- Floating junk rides `world.items` (host-authoritative, `syncItems()` after collect); the only
  guards are ITEM_TYPES/cleanWorld and the model branch above.
- Old saves: unknown station snapshot kinds are dropped by `restore` (`smelter.js:144-150`);
  old builds drop unknown item types in `cleanWorld`. Both are safe.

## (c) Risks
1. `createDebris` throws on unknown types (`debris.js:423`): forgetting the itemModel branch
   crashes the item pass for every player. Test it.
2. Name collision: `bottle` is the logbook message bottle (`game.js:543,546,880`). Use `seajar`.
3. Output-to-existing-material problem (scrap/plastic/sand are gathered, recipe null). Needs the
   small yields extension or the test/semantics of `discover` break. Decide in the spec.
4. Panel copy says cook/fuel; a fuel-0 station would show "add fuel" hints unless the panel
   gets options. Keep smelter/grill text unchanged.
5. Glow/indicator: `setSmelterGlow` expects smelter-model node names; the recycler model should
   either export compatible names or skip glow (it is only set for COOKERS).
6. Economy drift: extra scrap/plastic can shortcut nails and floors. Keep junk ~1/11 of spawns
   and times ~10-15 s per item; sea jar -> sand must not bypass the smelter.
7. Reachability and STATIONS_WITH_RECIPES tests must be updated in the same commit.
8. Concurrent work: kiln/smelter, trader, cookpot lanes also touch items.js stations; merge by
   appending, keep `[progression-hook]`-style tags, and re-grep anchors before coding.
