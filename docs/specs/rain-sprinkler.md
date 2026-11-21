# Spec: Rain Barrel and Sprinkler

Source: docs/features/rain-sprinkler-research.md. Cozy rules: no thirst, no wilting, nothing is ever lost. This adds a second, passive source of fresh water and a way to water Palm Planters on their own.
This is an extension of the watering lane (docs/specs/purifier-watering.md). It is not a content module. Logic goes in the new pure `dist/rain.js`, and visuals go in the new `dist/rain-model.js`.
game.js, daynight.js, content.js, inventory-state.js, craft-book.js and icons.svg get only small hooks. New modules are imported with `?build=v3-survival-ae77fa84ac2b`. Line numbers below are from branch `claude/loop-features-202611210648`.

## 1. Items, recipes and research gating
- Add two `ITEM_INFO` rows in inventory-state.js, after `purifier` (:43): `rainbarrel` / Rain Barrel / `icon-rainbarrel` / STACK_SIZE, and `sprinkler` / Sprinkler / `icon-sprinkler` / STACK_SIZE (`tool:false, placeholder:false`).
- Add two `RECIPES` rows after `purifier` (:81): `rainbarrel: recipe('rainbarrel','Rain Barrel',1,{wood:3, leaf:2, plastic:1})` and `sprinkler: recipe('sprinkler','Sprinkler',1,{scrap:2, plastic:2, rope:1})`.
- The ids `rainbarrel` and `sprinkler` are new. Do not use `water`, which is the dormant placeholder kind (:47), or `barrel`, which is a debris type. The barrel gives out the existing `freshcup`.
- Research gating needs no new code. The storage-research table already gates every `RECIPES` id that is not in `STARTER` (storage-research.js:11, :40-48), and `learnedFrom` runs again on load (:132).
  The barrel unlocks once wood, leaf and plastic have been researched. The sprinkler also needs rope, so it comes later. Legacy grandfathered worlds (:127) get both at once. Do not add either id to `STARTER`.
- Add craft-book.js blurbs next to :55. `rainbarrel: {desc:'A tub with a leaf funnel that catches the rain.', use:'Fills by itself in the rain. Hold an empty cup and press E.'}` and
  `sprinkler: {desc:'A little spinning head with its own tank.', use:'Waters nearby palm planters for you. Fill it with fresh water, or put it next to a rain barrel.'}`.
- Add two original `<symbol viewBox="0 0 48 48">` to dist/icons.svg after `icon-purifier` (:362). `icon-rainbarrel` is a banded tub with a leaf funnel and three falling drops. `icon-sprinkler` is a post with a two-arm head and a fan of spray arcs.
  Add both to the `SPRITES` set in survival-ui.js:22 only if that set is used to pick these icons. If time runs out, borrow `icon-barrel` / `icon-freshcup` and set `placeholder:true`.

## 2. Placeable decor (dist/game.js)
- :61 `DECOR_TYPES`: append `'rainbarrel', 'sprinkler'` after `'purifier'`. :69 `BLOCK_RADIUS`: add `rainbarrel:.3, sprinkler:.12`.
- Footprint: one deck tile each, like the purifier. The barrel fits in 0.6 x 0.6 m and is about 0.8 m tall. The sprinkler fits in 0.36 x 0.36 m and is about 0.6 m tall. Placement, ghost, rotation, hammer removal and save already work through the decor lane.

## 3. State: `world.collectors` and `world.sprinklers`
Both maps are keyed `"x,z"` (tile ints, `/^-?\d+,-?\d+$/`). Values are integers only, with no timestamps.
- `collectors[key] = {w:0..4, f:0..299}`. `w` is the number of stored cups (`BARREL_CAP = 4`). `f` is rain progress in tenths of rain-seconds toward the next cup.
- `sprinklers[key] = {w:0..3, s:0..3}`. `w` is units in the tank (`SPRINKLER_CAP = 3`). `s` counts the spray seconds left. It is visual only, and it is set to 3 each time the sprinkler waters a palm.
- A missing entry means empty. An entry that is all zeros is deleted, which keeps the co-op payload small. At `w===BARREL_CAP`, `f` is forced to 0.
- A key is valid only if `world.decor` has a `rainbarrel` (collectors) or a `sprinkler` (sprinklers) on that tile. Otherwise the entry is pruned, in `cleanRain` and at the start of every `tickRain`.
- Never put fields on decor entries. `cleanWorld` strips them (:175), and they would make guests call `rebuildRaft()` on every state message (:1495).

## 4. Pure module dist/rain.js (no DOM, no THREE, no Date or Math.random)
It imports only `swapOne, plantStage, tileKey` from `./watering.js?build=…`.
```js
export const BARREL_CAP = 4, SPRINKLER_CAP = 3, TENTHS_PER_CUP = 300, DEW_TENTHS = 1, SPRAY_SECONDS = 3, MAX_TICK = 60;
export const RAIN_ACTIONS = Object.freeze(['takeRain', 'fillSprinkler']);
export function cleanRain(v, decor)          // -> {collectors, sprinklers}; missing/null/array map -> {}; clamps ints; prunes per section 3
export function copyRain(w)                  // -> deep copies of both maps; missing -> {}
export function tickRain(world, dt, rain)    // host only; mutates both maps and world.garden; -> {filled:[barrel keys that just reached cap], watered:[palm keys]}
export function sprinkle(world)              // one sprinkler pass (called by tickRain); -> [palm keys watered]
export function takeRain(world, key, bag)    // barrel w>=1, selected/any 'cup' -> freshcup via swapOne; w -= 1
export function fillSprinkler(world, key, bag) // freshcup -> cup via swapOne; w += 1; refuses 'tankfull' at cap
export function rainTarget(world, d, kind, raining) // -> {prompt, click, e, why} for a barrel/sprinkler aim (section 6); pure, so it can be tested
```
Tick rules. `dt` is floored and clamped to 0..MAX_TICK, and the loop runs once per whole second. `rain` is a 0..1 number; anything that is not a finite number counts as 0.
1. Prune both maps.
2. Fill: per second, `add = max(DEW_TENTHS, round(rain*10))`. Full rain adds 10, so one cup takes 30 s. In calm weather the dew adds 1, so one cup takes 300 s. The dew means it still works with `?daynight=off`.
   For every barrel tile in decor where `w < cap`, set `f += add`. While `f >= 300`, do `f -= 300, w += 1`. A barrel created by the tick from a missing entry starts at `{w:0, f:0}`. When it reaches cap, set `f = 0` and push the key to `filled`.
3. Spray: decrement `s` on every sprinkler where `s > 0`.
4. `sprinkle`. Visit sprinklers in sorted key order. A sprinkler's source is its own tank if `w>=1`. Otherwise it uses the first orthogonal neighbour, checked in the order (x+1,z) (x-1,z) (x,z+1) (x,z-1), that is a barrel with `w>=1`.
   With a source, take the first palm in its 8 neighbours (Chebyshev 1), in sorted key order, where `plantStage(garden[k]) < 2 && garden[k]?.water !== 1`. Set
   `garden[k] = {water:1, grow:garden[k]?.grow ?? 0}`, take 1 from the source, and set `s = SPRAY_SECONDS`. That is at most one palm per sprinkler per second. It never touches ripe or already-wet palms, and it never uses rng.
Action results use the watering shape: `{ok:true, kind:'loot', text}` or `{ok:false, reason, text}`, with reasons `nocup|notarget|empty|tankfull|full|freshonly` (`full` means the bag is full). A failed action changes nothing. The target check returns `notarget` when the decor type at `key` is wrong.
`takeRain` needs an empty `cup`. It refuses `freshonly` for `saltcup` or `freshcup`. `fillSprinkler` needs a `freshcup`, and it refuses `freshonly` for `saltcup`.

## 5. Weather hook (rain source, host only)
- daynight.js:654: add `get rain() { return W.rain; }` beside `get wind()`. The opt-out module (:264-270) has no getter, so reading it gives `undefined`, which counts as 0.
- content.js:61: add `rain() { const m = mods.find(m => m.name === 'daynight' && !m.dead); const r = m?.rain; return Number.isFinite(r) ? r : 0; },` to the returned registry.
  It reads the live closure `W`, so `raftDebug.content.daynight.setWeather('rain')` pins work in QA. Do not use the stale `world.ext.daynight`.

## 6. Interaction and prompts (game.js)
- :697 `pickWateringDecor` fallback filter: also accept `rainbarrel` and `sprinkler`. :497: register both types in `wateringGroups` (do not call `preparePlanter` on them).
- :700 `wateringTarget`: inside the `USE_REACH` branch, first line: `if (d.type === 'rainbarrel' || d.type === 'sprinkler') return rainTarget(world, d, kind, (content?.rain() ?? 0) > .2);`.
  The cup click lane in `useSelected` (:971) and the E lane in `interact` (:945) then route it with no new lines. `updateContext` (:559) already shows `waterAim.prompt`.
- `rainTarget` table: aim + held item → prompt [click / E]. `N` is the current `w`. All the text is static, so it needs no `esc`.
  - barrel w>=1 + `cup` → `<kbd>E</kbd>Fill cup (N/4)` [takeRain / takeRain]
  - barrel w>=1 + `saltcup`/`freshcup` → `Rain barrel: N/4 · needs an empty cup` [- / -]
  - barrel w>=1 + anything else → `Rain barrel: N/4 cups · hold a cup` [- / -]
  - barrel w===0 → `Rain barrel: filling in the rain…` when it is raining, else `Rain barrel: empty · fills when it rains` [- / -]
  - sprinkler w<3 + `freshcup` → `<kbd>E</kbd>Fill sprinkler (N/3)` [fillSprinkler / fillSprinkler]
  - sprinkler w===3 → `Sprinkler: full (3/3)` [- / -]
  - sprinkler with an adjacent barrel that is not empty → `Sprinkler: N/3 · drawing from the rain barrel` [- / -]
  - sprinkler otherwise → `Sprinkler: N/3 · add fresh water` [- / -]
  For no-op entries, `why` equals the prompt.
- Toasts: takeRain "+ 1 cup of rain water" · fillSprinkler "The sprinkler tank gurgles" · empty "The barrel is empty" · tankfull "The sprinkler is full" · full "Your bag is full" ·
  nocup "You need a cup" · freshonly "Fresh water only" (sprinkler) / "Use an empty cup" (barrel) · notarget "Nothing to use that on". The tick makes no toasts.

## 7. Host actions and co-op
- game.js:911: add `if (RAIN_ACTIONS.includes(a.kind)) { applyRain(a, actor, bag); return; }` after the `WATER_ACTIONS` line. Add `applyRain` next to `applyWatering` (:794). It is the same as the tile branch there:
  the actor pose is `guest ? other : physics`; reject non-int `x,z`, and reject a tile centre farther than `USE_REACH + HOST_SLACK` from the pose. Then call `takeRain`/`fillSprinkler` with `tileKey(x,z)` and `emit` the result to the actor only.
- :1242 host 1 Hz tick: right after `tickWatering(world, 1)` in the same block, add `tickRain(world, 1, content?.rain() ?? 0);`. It runs after growth, so a palm that just ripened is never re-watered.
- :1214 `hostState().world`: add `collectors:world.collectors, sprinklers:world.sprinklers`. coop-delta diffs these per key. The guest's `cleanWorld` re-validates them against the same snapshot's decor.
  An old host sends no maps, so the guest gets `{}` and its actions are ignored. Guests never tick. Weather is the same on both peers, so the guest's "filling" prompt matches the host.

## 8. Save and backward compatibility
- :157 `newWorld()`: add `collectors:{}, sprinklers:{}`. :187 `cleanWorld`: add `...cleanRain(v, decor)` after `cleanWatering`. :193 `copyWorld`: add `...copyRain(w)`.
- Old saves have neither map, so both become `{}`. No seeding is needed. Saves already include the maps through `{...world}`. Hot-swap carries them in `world`.
- Rollback: older builds drop the new decor types and world keys, and they reset a bag that holds `rainbarrel`/`sprinkler`. This is the same known limitation as the purifier spec, section 12. Say so in the PR.

## 9. Visuals: dist/rain-model.js (imports nothing; it is given THREE)
The origin is the floor top. Every mesh casts and receives shadows except the water, the pips and the spray. Each call creates its own geometries and materials. Groups set `userData.craftType` and `userData.height`.
- `createRainBarrel(T)` returns the Group `craft_rainbarrel`. `barrelBody`: open cylinder, r .26 top / .23 bottom, h .52, centred at y .28, 12 radial segments, wood #9c7649, DoubleSide. `barrelFloor`: disc at y .03.
  `barrelHoops`: 2 steel tori (R .25, tube .012, #76838a) at y .12 and .44. `barrelFunnel`: open cone, r .34 top / .2 bottom, h .18, at y .63, leaf green #6f9a4a, flatShading, DoubleSide.
  `barrelWater`: disc r .22, #7fc4dc with emissive #2a6f8a .25, y = .06 + .44*(w/4), hidden at w=0. `barrelPips`: 4 small boxes (.05 x .05 x .02) in a column on the front at y .14/.24/.34/.44.
  Lit pips use #9ad7f0 with emissive .6, and unlit pips use #4a3a2a, so the fill reads from 6 m away. `barrelRipple`: a ring (r .08 to .1) on the water, shown only while raining.
- `paintRainBarrel(g, entry, raining, elapsed)`: the static part is cached with `sig = (entry?.w ?? 0) + '|' + raining`. Only the ripple animates (scale 1 + (elapsed*1.2 % 1)*1.4, opacity fades).
- `createSprinkler(T)` returns the Group `craft_sprinkler`. `sprinklerTank`: cylinder r .14 h .2 at y .1, copper #b87333, metalness .6. `sprinklerPips`: 3 boxes on the tank front, the same colours as the barrel pips.
  `sprinklerPipe`: steel cylinder r .02, from y .2 to .52. `sprinklerHead`: a Group at y .54 holding a hub sphere (r .035) and 2 arms (box .26 x .018 x .018) with bent tips.
  `spray`: `T.Points` with 24 points, size .05, #cfefff, transparent, opacity .8, depthWrite false, `frustumCulled = false`, hidden by default.
- `paintSprinkler(g, entry, elapsed, inView)`: pips are cached by `sig = entry?.w ?? 0`. When `entry?.s > 0`, `sprinklerHead.rotation.y = elapsed*6`.
  Only if `inView` too, `spray.visible = true` and the 24 positions are rewritten in place on the existing Float32Array (no allocation). For point i, the angle is `elapsed*6 + i*2π/24`,
  the phase is `(elapsed*1.5 + i/24) % 1`, the radius is `phase*.9`, and `y = .56 + phase*.35 - phase²*.6`. Set `needsUpdate = true`. When it is not active or not in view, the spray is hidden and the head is still.
- game.js hooks: in the ghost factory at :389 and in `rebuildRaft` at :496, before `createPurifier`, add `k === 'rainbarrel' ? createRainBarrel(T) : k === 'sprinkler' ? createSprinkler(T) : …`.
  In `updateWateringVisuals` (:726), branch on `craftType`. `inView` comes from one module-level `T.Frustum` that is set from `camera.projectionMatrix × matrixWorldInverse` once per call, using `intersectsSphere` with a reused Sphere of r 1.2 at the group's world position.
  Never call `rebuildRaft` from these.

## 10. raftDebug (read-only)
- :1643: beside `watering`, add `rain:{...copyRain(world), rain:content?.rain() ?? 0}`. :1667 `wateringTargets`: include both new types, with an extra `w` (or null) and `s` (or null) on each row.

## 11. Files
New: `dist/rain.js`, `dist/rain-model.js`, `tests/rain.test.mjs`. Edited: `dist/game.js` (one import line after :34, plus the lines cited in sections 2 and 6-10), `dist/daynight.js:654`, `dist/content.js:61`,
`dist/inventory-state.js:43,:81`, `dist/craft-book.js:55`, `dist/icons.svg:362`, and `docs/specs/INDEX.md`. Do not touch farming.js, `ITEM_TYPES`, `SPAWN_TABLE` or `LOOT`.

## 12. tests/rain.test.mjs (node:test, node:assert/strict, dist from `RAFT_DIST` or `../dist/`)
1. `cleanRain`: missing, null or array input gives `{collectors:{}, sprinklers:{}}`. Bad keys and non-int values are dropped. Out-of-range values are clamped. Entries on the wrong decor type are pruned. All-zero entries are deleted.
2. Fill: with `rain=1`, 29 x tick(1) gives w 0, and the 30th gives w 1. With `rain=0`, 300 ticks give 1 cup (dew). NaN or undefined rain counts as 0. The barrel caps at 4 with `f=0`, and `filled` lists the key once. `dt` .9 counts as 0, and 1e6 is clamped to 60.
3. Prune: removing the barrel from decor removes its entry on the next tick.
4. `takeRain`: an empty cup in the selected slot becomes a freshcup in the same slot, and w goes down. Refusals leave the bag snapshot and world unchanged: empty barrel, no cup, saltcup, and a full bag with a stack of 3 cups.
5. `fillSprinkler`: freshcup becomes cup, and w goes up. It refuses at 3/3 and refuses a saltcup.
6. `sprinkle`: it waters one dry adjacent palm per tick, in sorted order, from its own tank first. With an empty tank it draws from an orthogonal barrel, but not a diagonal one. It skips ripe and wet palms, and their garden entries stay deepEqual.
   It skips palms 2 tiles away. With no source nothing changes. `s` is set to 3 and then counts down.
7. Order: a palm that ripens in `tickWatering` is not re-watered by the `tickRain` that follows in the same second.
8. Determinism: two identical worlds with the same tick and rain sequence end up `deepEqual`.
9. `rainTarget` returns the exact prompts from section 6 for each row, including `click`/`e` kinds.
10. ITEM_INFO and RECIPES: both craft from their costs. `new Bag` accepts a snapshot holding both kinds. The storage-research `learnedFrom(['wood','leaf','plastic'])` includes `rainbarrel` and not `sprinkler`.
11. The content registry's `rain()` returns 0 with no daynight module and 0 for the opt-out module.
12. rain-model with the vendored THREE: both groups have the named meshes and fit their footprints (barrel ≤ .7 x .7 x .85, sprinkler ≤ .4 x .4 x .65). `paintRainBarrel` with w 2 lights 2 pips and places the water at the expected y.
    `paintSprinkler` with `s:0` or `inView:false` hides the spray. With `s:2, inView:true` it shows the spray, and two calls at the same elapsed give the same positions with the same array identity.
Run `npm test` and shoot.py. The `errors` list must be empty.

## Build notes
- Built as specified. New: `dist/rain.js`, `dist/rain-model.js`, `tests/rain.test.mjs` (14 tests). Hooks: game.js (import line, DECOR_TYPES, BLOCK_RADIUS, newWorld/cleanWorld/copyWorld, ghost + rebuildRaft factories, wateringGroups, pickWateringDecor, wateringTarget, updateWateringVisuals with one shared Frustum, applyRain + dispatch, 1 Hz host tick, hostState maps, raftDebug `state.rain` and `wateringTargets` w/s), daynight.js `get rain()`, content.js `rain()`, inventory-state.js (2 ITEM_INFO + 2 RECIPES rows), craft-book.js (blurbs + `survival` tab), icons.svg (2 new symbols), survival-ui.js `SPRITES` (+2 ids, since that set picks the icons). items.js and item-svg.js were not needed: the icons are real sprites, so `placeholder:false`.
- Clean rules: a field that is not an integer number counts as 0 (so `{w:'x'}` or `{w:1.5}` drops out as an all-zero entry). Integers out of range are clamped.
- `takeRain` refusal order: `notarget`, `empty`, then a held salt/fresh cup gives `freshonly`, no empty cup anywhere gives `nocup` (or `freshonly` when the bag only has filled cups), then `full`. `fillSprinkler`: `notarget`, `tankfull`, `freshonly` (saltcup held, or no freshcup but a saltcup), `nocup`, then `full`.
- The sprinkler model has 2 crossed arms (each a .26 box), so its head reads as a cross from above and still fits the .36 m footprint. The spray is plain square points (no texture), so it stays allocation-free and testable in node.
- QA script: `closeup.py` seeds a save with a barrel, a sprinkler and 4 palms, presses Continue, pins noon + rain through `raftDebug.content.daynight`, and aims with `raftDebug.aim`. Under swiftshader, game time runs much slower than wall time, so the 1 Hz tick only advances a little per screenshot.
- Rollback limitation (same as purifier section 12): older builds drop the new decor and world keys and reset a bag holding `rainbarrel`/`sprinkler`.
