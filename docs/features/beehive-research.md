# Beehive, flowers and honey: research

Goal: place a Beehive near Flower Boxes and it slowly fills with honeycomb. E harvests Honey and
Beeswax. The bees are friendly and never sting. Honey and wax then go into a candle, a treat and a recipe.
Line numbers are for branch `claude/loop-features-202611210648` as checked out.

## What exists today
- **No flower anywhere.** The words flower, honey, wax and bee do not occur in game logic. `smelter-model.js:126`
  says "beehive body", but that is only the smelter's kiln shape. The only seed is `seed` "Palm Seed"
  (`content-items.js:12`, `inventory-state.js:44`). It drops from island palms and bushes
  (`islands-layout.js:184-189`) but **nothing consumes it**, because planters are crafted and not planted.
- **Two farming systems, only one live.** `farming.js` and `farming-view.js` (`d.farm = {s,g,w,h}` on the decor
  entry) are imported only by `tests/farming.test.mjs`. game.js never loads them, so **do not copy that pattern.**
  The live system is `watering.js`. Its state is in `world.garden` / `world.purifiers`, keyed `"x,z"`. It is pruned against decor by
  `cleanWatering()` (`watering.js:64`), and the host ticks it once a second: `tick()` at `watering.js:96` is called from
  `game.js:1242`, inside `if (running && role !== 'guest')` at `game.js:1233`. game.js syncs it as top-level `garden`/`purifiers`
  in `hostState()` (`game.js:1214`). Adding a top-level world key would need edits to newWorld/cleanWorld/copyWorld/hostState,
  so use `world.ext` instead (see below).
- **Cooking.** `cooking.js` is the fish-only driftwood grill (`GrillState`, one fish species per slot). Its dishes go into the
  journal basket (`fishing-cooking.js`), not into the bag. The bag-level cooking is the progression grill station in `items.js`. Its recipe
  `cook(station, input, …)` allows **exactly one input** (enforced by `tests/progression.test.mjs:142`). `cookedfish`
  (`items.js:148`) is the only food. Its tip says "the seagull would love a treat", but **no feeding mechanic exists**:
  `wildlife.js` gulls are a closed-form plan of a shared clock with no action or interact.
- **Decor removal does not exist** (only building pieces can be removed, X key). A placed hive stays until the save is reset.

## Placeables: how decor is defined, placed and saved
- Item catalogue: `items.js` `LIST` (`:77-182`, `item()` at `:62`). With `placeable:true` the id lands in `PLACEABLE_IDS`
  (`:188`), and from there in `DECOR_TYPES` (`game.js:61`). `BLOCK_RADII` (`items.js:191`) supplies the collision radius
  (`BLOCK_RADIUS`, `game.js:69`). Tests require a radius for every placeable and no radius for anything else (`progression.test.mjs:120-123`).
- The other route is `content-items.js` `CONTENT_ITEMS` / `CONTENT_RECIPES` / `CONTENT_DECOR` / `CONTENT_BLOCK_RADIUS`,
  merged at `inventory-state.js:33,77` and `game.js:61,69`. Recipes on this route are gated by the Tinker's Desk
  (`storage-research.js` `learnedFrom`, `STARTER` at `:9`). items.js ids are exempt via `setOwnedElsewhere` (`game.js:44`).
- Placing happens in `applyAction` `a.kind==='build'` (`game.js:866-874`). It pushes `{type,x,z,rot?}` into `world.decor`.
  `cleanWorld` (`game.js:171-176`) keeps only `DECOR_TYPES`, one per tile, and only on an existing tile.
- Models: `rebuildRaft()` (`game.js:491`, line `:496`) tries `prog.modelFor`, then `createCraft` (`crafts.js:12`
  builders map), then `createSignalModel`, then **`content.decorModel(type)`**. The ghost preview uses the same chain (`game.js:389`).
  `decorModel(type)` gets **no position**, so a module that wants per-hive visuals has to find its groups in `ctx.raft.children`
  by name and position (`x*2, z*2`), the way daynight does with `craft_lantern` (`daynight.js:411-429`).
- Held pose: `held-items.js:17` `DECOR_KINDS` / `:19` `PLACEABLE_KINDS`. New kinds fall back to a generic model, which is cosmetic only.
- Icons: `item-svg.js:10` `ITEM_ICONS[kind]`. Placeholder icons are allowed (`placeholder:true`). Tests check that every
  non-placeholder icon exists in `icons.svg` (`progression.test.mjs:101-108`).

## Content registry and the timer/sync pattern to use
A new content module, e.g. `dist/bees.js` exporting `createBees(ctx)`, appended to `FEATURES` at `content.js:29`. Hooks it gets for free
(docs/features/content-hooks.md):
- `serialize()`: the host saves it in `world.ext.bees` (`game.js:1023`) and sends it about 8 times a second (`hostState`, `game.js:1214`).
  Cache the result as `storage-research.js:363-367` does, with a revision counter `r`.
- `load(data, from)`: `'save'` at `game.js:401`, `'restore'` at `game.js:1419`, `'net'` at `game.js:1504`. `'net'` must return early when
  nothing changed (`storage-research.js:348-357`). `data === undefined` means an old save or an old host, so use defaults.
- `update(dt)`: runs every frame on every client (`game.js:1231`). Tick only when `ctx.role !== 'guest' && ctx.running`.
  Note that solo play is `role === 'solo'`, not `'host'` (`game.js:1429`). Accumulate whole seconds the way `waterClock` does at `game.js:1242`.
  Clamp offline or hidden-tab catch-up (watering's `MAX_TICK = 60`).
- `action(a, actor, bag)`: host only. It is reached at the tail of `applyAction` (`game.js:910`), and guests reach it through `ctx.action(a)`. Use
  kind `'bees.harvest'` with `{x,z}`. Check reach with `ctx.physics` / `ctx.other` (pattern at `storage-research.js:274`).
  Give the loot atomically (scratch `new bag.constructor(bag.snapshot())`, as in `watering.js` `trade()`).
- `interact(aim)` (E, `game.js:942`, before watering and inventory) and `prompt(aim)` (`game.js:560`). Pick the aimed tile
  as storage-research does (`:279`).

**Proposed state shape** `world.ext.bees = {v:1, r, h:{"x,z":{c, t}}}`:
`c` is whole combs ready (0..`COMB_MAX`=3) and `t` is seconds into the next comb (0..`COMB_SECONDS`).
Prune it against `world.decor` entries of type `beehive` on every load and tick (as watering's `prune`). A missing entry is an empty hive.
Fill rate: `t += dt * min(flowers, 3) / 3`, where `flowers` counts `flowerbox` decor within 2 tiles (Chebyshev) of the hive.
With 0 flowers the hive stays idle and the prompt says "Bees need flowers nearby". With `COMB_SECONDS = 120` and 3 flowers, one comb takes 2 min.
Optional: slow down at night via the daynight phase, which costs extra coupling. Harvest gives `HONEY` and `WAX` per comb
(1 + 1), then `c = 0` and `t` is kept. The flower count is derived from decor and never stored.

## Flower and seed source
- Island bushes: `lootFor('bush', …)` (`islands-layout.js:186`) is a host-only, deterministic hash. Add a third outcome
  (e.g. `hash3 < .3` gives leaf + `flowerseed`, `< .5` gives leaf + seed). **Do not add a new `NODE_KINDS` entry**
  (`islands-layout.js:24`). It changes `layoutFor` and the node indices that the saved `used[]` and co-op gathers rely on,
  so mixed-build co-op would desync. Also update the `LABEL.bush` text (`islands.js:29`) and `tests/islands.test.mjs:122-129`, which
  checks the bush seed rate (120 to 280 of 400). Keep palm seed plus flower seed within that band, or rewrite the assertion.
- Barrels: a small treasure row in `BARREL_LOOT` (`items.js:264-276`), placed in the middle of the treasure rows. This gives a
  non-island source, and it makes `flowerseed` "reachable" for `progression.test.mjs:179-198`. Keep clay as the first treasure row and scrap
  as the last: `rollBarrel(()=>0)` and `rollBarrel(()=>1)` are pinned at `progression.test.mjs:282-283`. The rate test is at `:286`.

## Sinks for honey and wax (original, friendly)
1. **Beeswax Candle**: decor, `{wax:2, rope:1}`. A small glowing jar. To glow at night, `daynight.js` has to accept it:
   the decor count at `:404` (`type === 'lantern'`) and the group name at `:413` (`craft_lantern`). Naming the flame mesh
   `'flame'` or `'candle'` works with `LANTERN_PARTS` at `:242`.
2. **Honey Glazed Fish**: food, a hand recipe `{cookedfish:1, honey:1}`. It cannot be a station recipe because those take a single input.
3. **Honey Biscuit**: grill station recipe `cook('grill','honey',{time:12,fuel:.5})`, which follows the single-input rule.
4. **Wax uses in crafting**: a Waxed Rope repair option, or wax as a cheaper fishing-rod repair (`items.js` REPAIRS). This is optional.
5. Stretch: feed a perched gull a honey treat with E. This needs new interact or action code in `wildlife.js`, and the gull plan is
   clock-derived, so a "happy hop" would need a synced event. Keep it out of the first cut.

## Recommendation
- Put `flowerseed`, `flowerbox` (placeable, `{wood:2, flowerseed:1}`, unlock `discover('flowerseed')`),
  `beehive` (placeable, `{wood:4, rope:2, leaf:2}`, unlock `discover('flowerseed')`), `honey`, `wax`, `candle`
  and the food in **`items.js`**, the single catalogue. That gives tooltips, unlock toasts and progression gating, and it avoids the Tinker's Desk.
  Add radii to `BLOCK_RADII` (hive .35, flowerbox .3, candle .1). In `progression.test.mjs:184-185`, extend the reachability loop as it does for
  fish: `if (have.has('beehive') && have.has('flowerbox')) add 'honey','wax'`. Honey and wax are `recipe:null` "gathered" items.
- Models go in `crafts.js` builders (`:12`: beehive, flowerbox, candle), so `createCraft` names them `craft_<type>`.
  The bees module finds `craft_beehive` groups to show the comb level and a few slow bee sprites (one InstancedMesh, no per-frame allocation).
- Logic goes in a pure, testable `dist/bees.js`: `cleanBees`, `tickBees`, `flowersNear`, `harvest`, plus the content-module factory. It follows
  the content-module contract and is registered in `content.js` FEATURES.
  Tests (`tests/bees.test.mjs`) follow the style of `watering.test.mjs` and `farming.test.mjs`: `node:test`, `assert/strict`, `RAFT_DIST` base URL, `bagWith` helper.
  Cover the fill rate against the flower count, the comb cap, pruning when a hive is gone, junk or old data giving defaults, atomic harvest when the bag is full,
  reach checks, and an unchanged-net-load no-op.

## Risks and backward compatibility
- An **old save** has no `ext.bees`, so `load(undefined)` falls back to defaults. New kinds are additive.
- An **old build loading a new save** drops `beehive`/`flowerbox`/`candle` decor (`game.js:172` filter). Its `migrateSnapshot`
  (`items.js:426`) drops the unknown honey and wax kinds. That loss is accepted, the same as for the earlier lanes.
- **Mixed co-op**: an old guest silently skips the unknown decor and ext slice. A new guest with an old host gets `ext.bees === undefined`,
  so it should show no comb and send no harvest (pattern: `OLD_HOST`, `storage-research.js:15,319`).
- The `ext` budget is 200k chars in total (`content.js:31`). The bees slice is tiny, but keep it bounded (one entry per hive tile).
- Decor cannot be picked up, so a misplaced hive is permanent. Consider adding hive removal later.
- Do not tick in `update()` on guests. Clamp large `dt` (tab hidden) so hives do not jump to full after a pause, or accept that they do.
