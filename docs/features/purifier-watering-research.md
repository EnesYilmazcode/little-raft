# Water purifier, cups and watering: research note

Scope: a cozy, no-thirst take on "turn sea water into fresh water". Fresh water has one job:
watering Palm Planters so they grow and can be harvested for palm leaves (now and then wood).
Line numbers refer to the tree at commit 670fd9d.

## 1. How the survival-raft genre usually does it (general patterns)
- **Container first.** The first water tool is a cheap cup, often made from a few plastic or
  leaf scraps. You scoop sea water by using the cup on the ocean, so you get a "salt" cup.
  Later, bigger containers (a canteen or bottle) hold several servings and show a fill level.
- **Purifier as a station.** It is a small placeable device: a pot or still over a fire.
  You put in salt water, add fuel (planks, leaves, later better fuel), wait a while
  (10-60 s of real time), then take out fresh water. Advanced tiers process more per batch,
  run on better fuel, or work without fuel (solar or rain catchers).
- **Fuel as a sink.** Fuel mostly exists to soak up common resources. The station often stops
  when fuel runs out, and it shows that with a visible flame or smoke.
- **Crops need water.** Planters or plots take a seed. A plant grows only while watered, or it
  grows slower or wilts when dry. You water it by using a fresh-water container on it, and
  rain or sprinklers do this automatically later on. Salt water is refused, or it hurts the plant.
- **Harvest loop.** A ripe plant shows it visually (fruit appears). Interacting gives the yield
  and resets the plant to an earlier stage, so it needs watering again.
- **Feedback.** Steam on the purifier, darker wet soil, growth stages, a pour or splash sound.

## 2. What we keep and what we drop for Little Raft
| Genre mechanic | Little Raft version |
|---|---|
| Thirst meter | **Dropped.** Water is only for plants (and maybe decoration later). |
| Cup (salt/fresh) | Keep: `cup` (empty), `saltcup` and `freshcup` as plain item kinds. |
| Canteen | Later. It needs per-slot fill metadata, but `Bag` only allows `durability` on tools. |
| Purifier and fuel | Keep the station. **No fuel in v1** (no "it went out" failures). Optional stretch: 1 leaf of kindling per batch. |
| Plant wilting or death | **Dropped.** A dry planter just pauses. It never loses progress. |
| Harvest yields | Keep. Ripe palm gives leaves and sometimes wood. Its fronds and coconuts show ripeness. |
| Rain or sprinklers | Leave for the weather lane later (rain could set `water=1`). |

## 3. Recommended numbers (balanced against current recipes)
Current economy (dist/inventory-state.js:44-55; game.js:31): a debris pickup gives 2 wood or
1 leaf or 1 plastic, and a barrel gives 3 wood, 2 leaves, 1 scrap and 1 plastic. Rope costs 2
leaves, a Palm Planter 2 wood + 3 leaves, a Lantern 2 wood + 2 scrap, the Hook 1 wood + 2 plastic.
- **Cup**: recipe `{plastic: 1}` makes 1 cup, maxStack 5. It is cheap, like the hook.
  Salt and fresh cups also stack to 5.
- **Water Purifier** (decor `purifier`): recipe `{wood: 2, scrap: 2, plastic: 1}`, which is a
  little more than a lantern.
- **Purify**: one salt cup in, wait **15 s**, one fresh cup out. Capacity is 1 cup in v1, and
  maybe 3 for a later tier. Use E or click on the purifier to load it or collect.
- **Fill**: use a selected `cup` on the ocean within `FISH_REACH`, or closer (6 m feels
  better), to get a `saltcup`.
- **Watering**: use a `freshcup` on a palm planter. The planter gets `water: 1` and the cup goes
  back as an empty `cup`. One watering covers one full growth cycle.
- **Growth**: a watered planter needs **90 s** of host time to ripen (stage 0, then 1 at 45 s,
  then 2 at 90 s). Time is counted only while watered. Ripening uses up the water.
- **Harvest** (E on a ripe palm): **+2 leaf**, and 25% chance of **+1 wood**. The plant resets to stage 0 and dry.
  That is about 1.3 leaves a minute per planter for little work. Debris picking stays faster,
  and a planter (3 leaves) pays itself back in 2 cycles.
- **Full bag**: an atomic add like `collect` (game.js:556-561). If full, the plant stays ripe.

## 4. Integration points (small hooks; logic in new `dist/watering.js`)
Pure module `dist/watering.js` (no DOM/THREE): `GROW_SECONDS`, `PURIFY_SECONDS`, `HARVEST`,
`cleanGarden(v, decor)`, `tickGarden(garden, decor, dt)` (returns the planters that changed stage),
`water(garden, key)`, `harvest(garden, key, rand)`, `tickPurifiers(...)`. Tests go in
`tests/watering.test.mjs`.

dist/inventory-state.js
- L13-29 `ITEM_INFO`: add `cup`, `saltcup` and `freshcup` (not tools, so no durability; borrowed
  icon `icon-barrel` with placeholder:true, or new `<symbol>`s in dist/icons.svg next to L130/L162), plus `purifier`.
- L44-55 `RECIPES`: add `cup` and `purifier`. The survival UI lists recipes on its own
  (dist/survival-ui.js:106). Salt and fresh cups need no recipe.

dist/game.js
- L27 `DECOR_TYPES`: add `'purifier'`. Placement, ghost, build and the debug mode then work
  through the existing `DECOR_TYPES.includes` checks (L502, L509, L572, L630, L809, L1097).
- L35 `BLOCK_RADIUS`: add `purifier: .3`. L114 `newWorld()`: add `garden:{}` and `purifiers:{}`.
- L117-141 `cleanWorld()`: validate `garden` and `purifiers` (keys `"x,z"` that point at a
  palm or purifier decor; integer fields only). Default to `{}` when missing, which is how old
  saves load. Note that decor is rebuilt as `{type,x,z}` at L131, so extra decor fields are
  dropped.
- L142-145 `copyWorld()`: deep-copy the two new maps.
- L346-360 and dist/crafts.js:309 `buildPalm`: show the stage by scaling or hiding the named
  `fronds`/`coconuts` meshes. Show watered soil with the `soil` mesh tinted darker. Add a
  `purifier` builder in crafts.js (L12 builders map, L8 header comment), for example a small
  pot on a scrap stand with a steam puff.
- L539-596 `applyAction()`: add `fillCup`, `waterPlant`, `loadPurifier`, `takePurifier`
  and `harvestPalm`. The host validates reach, the tile key, the decor type and bag counts,
  then emits a toast.
- L613-623 `interact()` (E): when no debris is targeted, check for a palm or purifier under the
  aim before opening the inventory.
- L626-640 `useSelected()`: if `cup` is selected, aim at the water as for fishing (L637-638).
  If `freshcup` or `saltcup` is selected, aim at a planter or purifier tile.
- L814-818 `hostState()`: add `garden` and `purifiers` to `world`.
- L831-836 frame loop, host only (next to the nets): `tickGarden` and `tickPurifiers` on a
  0.5-1 s clock.
- L1016 guest change check: **do not put timers in `decor`**. This line compares
  `JSON.stringify([tiles, decor])`, so a ticking timer would call `rebuildRaft()` every
  0.12 s. Store whole seconds in separate maps. Update only the planter visuals when a
  stage changes, or add a cheap `gardenStage` diff.

## 5. Co-op and save notes
- **Host-authoritative.** All timers run only on the host (frame loop, `role !== 'guest'`).
  Guests send actions, and the host clamps and validates them. Timestamps are not trusted.
  Use seconds of progress, not `Date.now()`, so a save/load pauses growth instead of jumping.
- **Shared plants, separate bags.** Either player can water or harvest. The harvest goes into
  the bag of the player who did it (`actorBag(actor)`). Before watering, check that the plant
  is not already watered so two players do not waste two cups.
- **Old saves.** Missing `garden`/`purifiers` default to `{}`. Existing palms start at stage
  0 and dry, so nothing changes for old players.
- **Rollback hazard.** `snapBag` (L72) turns an unknown item kind into `null`, which resets the
  whole bag. If an older build loads a save (or a guest snapshot) that holds `cup`/`freshcup`,
  it drops that inventory. Ship the new kinds in one release and say in the PR that old
  builds cannot read them. Mixed-version co-op is unsupported, and the `?build=` suffix
  makes both peers load the same modules.
- **Snapshot size.** At most one garden key per palm (400 tiles max), so 8 Hz is fine.
- **Hot-swap (live.js).** The new maps live in `world`, so `capture()`/`mount` carry them over.
  An in-flight purify finishes after a remount.
- **Farming lane overlap.** The crop-plots lane will also need "water" and "grow" ideas. Keep
  `watering.js` generic (keyed tile → `{water, grow, stage}`) so crop plots can reuse
  `water()`/`tickGarden()`. Agree on a shared `freshcup` item instead of each lane making a
  second water item.

## 6. Test ideas
Bad garden keys are dropped. Growth pauses when dry. Harvest gives +2 leaf, and wood on a seeded
roll. A full bag keeps the plant ripe. The purifier makes 1 fresh cup in 15 s. Old saves load.
