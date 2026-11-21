# Research: Rain Collector + Sprinkler

Read-only research for builders. Line numbers are from branch `claude/loop-features-202611210648`.

## 1. The genre mechanic, in our own words
Survival raft games often have a passive water station. It is an open basin or funnel on the deck that fills
with fresh water while it rains, so players get drinkable water without running a stove. A second
device takes water from a store and wets nearby crop plots on a timer, so growing crops becomes an
automated loop. Little Raft is cozy (no thirst, no wilting), so we only keep the *convenience*.
- **Rain Barrel** (working name): a placeable tub with a leaf funnel. During `rain` it fills by itself,
  up to a few cups of fresh water. Clicking it with an empty `cup` gives a `freshcup`. It is a second
  way to get fresh water, besides the purifier.
- **Sprinkler** (working name): a placeable spinning-arm head with its own small tank. You fill it
  with fresh cups, or it draws from an adjacent barrel. When a palm planter in range is dry and not
  ripe, it waters it on its own and uses one unit. Nothing is ever lost and nothing punishes the player.
All names and art must be our own: procedural THREE models in the style of `purifier-model.js`, plus new icons.svg symbols.

## 2. Weather query (dist/daynight.js)
- `WEATHERS` is at :8. Segments come from the pure functions `weatherIndex(seed,i)` :62, `segmentIndexAt` :77 and
  `weatherAt(seed, clock, out)` :93-103. `weatherAt` fills `{weather, weatherNext, blend, rain 0..1, wind, cloud}`, and `rain` blends over 25 s (:86-91).
- Live state lives inside the module closure. `W` is at :287 and is refreshed each frame in `applyVisuals` :457-458.
  The module returns only `{name, update, serialize, load, dispose, debug, get wind()}` (:654). It has no rain getter.
- `debug.setWeather(w)` (:632) pins only the closure `W`. A rain check written as pure `weatherAt(world.ext.daynight…)` would
  ignore the pin, so QA could not force rain. `debug.state().rain` works, but debug is not a gameplay API.
- `world.ext.daynight = {v, clock, seed}` is written only by `syncWorldInventories` (game.js:1023, on save every 3 s)
  and by `hostState` (:1214). It is stale between saves, so do not use it as the per-second source on the host.
- In opt-out mode (`createDayNightOff`, :264-270) no weather runs at all, and `kept` holds a frozen clock.
- **Hook to add (1 line):** expose `get rain() { return W.rain; }, get weather() { return W.weather; }` next to `get wind()` at :654.
  game.js can then read it through `content.mods.find(m => m.name === 'daynight' && !m.dead)?.rain ?? 0`. Today nothing
  uses `content.mods` like this. A cleaner way is a `ctx`-free helper: add `rain()` to the registry in content.js:47-61.
  It honours pins and opt-out (opt-out gives `undefined`, so 0).

## 3. Watering / garden state (dist/watering.js, docs/specs/purifier-watering.md)
- This is the live system. `world.garden["x,z"] = {water:0|1, grow:0..90}` and `world.purifiers["x,z"] = {t:0..15, ready:0|1}`,
  in whole integer seconds. Maps are keyed by tile and are never stored on decor objects (spec section 3).
- `cleanWatering(v, decor, {seedMissing})` :63-75 validates keys with `KEY_RE` and prunes entries whose tile is not the right decor type (`cleanMap` :50-58).
  `copyWatering` :77. `tick(world, dt)` :90-111 is host-only, prunes first, and returns `{grown, ripe, done}`.
- `water(world,key,bag)` :170-180: a palm is "watered" when `garden[key].water===1`. It refuses `ripe` (stage 2) and `watered`.
  Growth uses up the water at ripeness (:100). **A sprinkler waters exactly by setting `garden[key] = {water:1, grow:e?.grow??0}`**
  when `plantStage(e) < 2 && e?.water !== 1`. Put that in a pure helper (e.g. `sprinkle(world)`) so `water()`'s rules are not duplicated.
- **dist/farming.js / farming-view.js are dormant.** They keep `d.farm` on palm decor entries. game.js never imports them,
  and `cleanWorld` rebuilds every decor entry as `{type,x,z,rot}` only (game.js:171-176), so `d.farm` would be dropped anyway.
  inventory-state.js:44-47 confirms that palms run on the watering lane. **Target `world.garden`, not `d.farm`.**

## 4. Engine hook points (dist/game.js)
| Line | What | Change for this feature |
|---|---|---|
| 33-34 | watering / purifier-model imports | import new pure module + model fns |
| 61 | `DECOR_TYPES` (literal list + CONTENT_DECOR + PLACEABLE_IDS) | append `'raincatcher','sprinkler'` (like `'purifier'`) |
| 69 | `BLOCK_RADIUS` | e.g. `raincatcher:.35, sprinkler:.12` |
| 157 | `newWorld()` | `collectors:{}, sprinklers:{}` |
| 186 | `cleanWorld` tail `...cleanWatering(v, decor, {seedMissing:true})` | add `...cleanRain(v, decor)` (missing map gives `{}`) |
| 189-194 | `copyWorld` `...copyWatering(w)` | add `...copyRain(w)` |
| 270 | `wateringGroups` (tileKey to group) | register new types too |
| 389 | ghost model factory `k==='purifier' ? createPurifier(T) : …` | add new models |
| 493-497 | `rebuildRaft` model choice + `wateringGroups.set` for palm/purifier | extend the type checks |
| 686-698 | `pickWateringDecor` (ray + deck-point fallback filtered to palm/purifier :697) | extend filter |
| 700-724 | `wateringTarget(aim)` prompt/click/E routing | add barrel/sprinkler branches |
| 726-731 | `updateWateringVisuals` (paint by craftType) | paint fill level / spin arm |
| 793-808 | `applyWatering` host validation (reach, int tiles) | reuse for new action kinds via `WATER_ACTIONS`-style list |
| 945, 971 | E `interact()` and cup `useSelected()` lanes | the existing cup routing already covers held cups |
| 1214 | `hostState().world` sends `garden, purifiers` | add `collectors, sprinklers` |
| 1242 | host 1 Hz `tickWatering(world,1)` | after it: `tickRain(world, 1, rainNow())` then sprinkle |
| 1492-1504 | guest `state`: `cleanWorld(data.world)`, rebuild only if `[tiles,decor]` changed | free sync, no rebuild on ticks |
| 1643, 1666 | `raftDebug.state.watering`, `wateringTargets` | add QA views |
Items/recipes: add rows to `ITEM_INFO` and `RECIPES` in inventory-state.js:40-43 and :80-81, the same way `purifier` was added.
`registerBagKinds(ITEM_INFO)` (:50) keeps them through `migrateSnapshot`. items.js `ITEMS` (with `placeable:true`, :153-179) is the
alternative path (PLACEABLE_IDS/BLOCK_RADII flow into :61/:69 automatically), but purifier did not use it. Stay consistent with purifier.
Craft-book blurbs live in dist/craft-book.js:55. The content registry (content.js, CONTENT_DECOR in content-items.js:24) is a third way,
with save in `world.ext[name]` through serialize/load. It suits self-contained modules, but this feature mutates `world.garden`, so the core lane fits better.

## 5. Proposed state shapes
- `world.collectors["x,z"] = {w:0..CAP}`: integer cups stored, CAP≈3. Optionally `f:0..FILL_SECONDS` seconds of accumulated rain.
- `world.sprinklers["x,z"] = {w:0..CAP_S}`. Radius in tiles (Chebyshev 1, i.e. the 8 neighbours) is a constant, not saved state.
- Both are pruned against decor type like `cleanMap`. Integers only, no timestamps, no rng in tick (determinism test style).
- Fill rate: `f += rain` per second (rain 0..1 already blends), and +1 cup per ~40 rain-seconds. A rain segment is 180-360 s,
  so one shower is about 4-9 cups, capped. A slow "dew" trickle during calm is optional, so the feature still works when day/night is opted out.

## 6. Co-op (coop.js, coop-delta.js, coop-rules.js)
- The host is authoritative. Guests send `{type:'action', a}` (game.js:754-760). The host runs `applyAction` (:820), which dispatches
  `WATER_ACTIONS` to `applyWatering`, and replies with `emit(e, actor)`.
- World maps ride inside `hostState()` about every 120 ms (:1245). coop-delta.js diffs plain objects per key (`$d` removed keys,
  :1-13), so small tile-keyed maps cost almost nothing. The guest's `cleanWorld` re-validates, so an older host (no maps) gives `{}`.
- Weather is already the same on both peers (same seed+clock, docs/features/daynight.md:184-185). Only the host ticks, so no extra sync is needed.
- An old-build guest drops unknown decor types (`DECOR_TYPES.includes`, :172) and unknown world keys. That is harmless, because the visuals just do not appear.

## 7. Save backward-compat patterns seen
- A missing map becomes `{}` (cleanWatering). `seedMissing` (`!hasOwn(v,'garden')`) migrates pre-feature saves. Not needed here.
- Older builds silently drop new decor types, new world keys and new bag kinds (migrateSnapshot drops unknown kinds). That loss only
  happens on rollback, which matches the existing lanes.
- Never add fields to decor entries: cleanWorld strips them (:175), and it would trigger a guest `rebuildRaft` every tick (:1496).

## 8. Tests style (tests/watering.test.mjs, farming.test.mjs)
`node --test`, `node:assert/strict`, dist resolved via `RAFT_DIST` env or `../dist/`. Bags come from `new Bag({slots, selected})` (`bagFrom`, `fullBag`),
and worlds are literal objects (`mkWorld`). The cases cover: clean on bad input, clamping, prune on removed decor, tick timing with floored and clamped dt,
refusals leave the bag and world unchanged (deepEqual snapshots), full bag, determinism (two worlds, same ticks, deepEqual), the ITEM_INFO/RECIPES
rows, and the model has named meshes and paints state (THREE from `dist/vendor/three.module.js`). Mirror these in `tests/rain.test.mjs`.

## 9. Risks
1. **Weather source.** Pure `weatherAt` on stale `world.ext` ignores `setWeather` pins and lags up to 3 s. Use the live module getter.
2. **Double watering rules.** A sprinkler must reuse `plantStage`/`water` semantics. It must never water ripe palms (that would block the
   `water=0` invariant at :36) or drain tanks on already-wet palms.
3. **Order in the 1 Hz tick.** Sprinkle after `tickWatering`, so a palm that just ripened is not re-watered. `tick` prunes the maps, and the new maps must prune too.
4. **Pick/prompt filters** are hard-coded to `'palm'||'purifier'` in four places (:497, :697, :705, :728). Missing one gives an unclickable barrel.
5. **Scope creep into farming.js.** Wiring the dormant `d.farm` system would conflict with world.garden. Leave it alone.
6. **Item name clash.** `water` (placeholder "Cup of Fresh Water", :47) already exists. Output `freshcup`, not `water`.
7. **Perf.** Barrels need no per-frame allocation. A sprinkler spin should be a visual-only per-frame rotation, and rain particles stay the daynight module's job.

## 10. Recommendation
Build it as a core watering-lane extension, not a content module: a new pure `dist/rain.js` with `cleanRain`/`copyRain`/`tickRain(world, dt, rain)`/
`sprinkle(world)`/`fillFromCollector`/`fillSprinkler`, plus `dist/rain-model.js`. Add a 1-line `get rain()` getter to daynight.js:654 and a
`rain()` passthrough in content.js. game.js changes are one-liners at the rows in section 4. Keep `world.collectors`/`world.sprinklers` tile-keyed
maps, host-ticked at 1 Hz. The sprinkler draws from its own tank first, then from an orthogonally adjacent barrel. Write the spec as
`docs/specs/rain-sprinkler.md` and add it to docs/specs/INDEX.md.
