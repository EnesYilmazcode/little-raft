# Spec: water purifier, cups and watering

Source: docs/features/purifier-watering-research.md. Cozy rules: no thirst, no wilting, nothing is ever lost. Fresh water has one use: it makes Palm Planters grow so you can harvest them.
Logic goes in the new `dist/watering.js` (pure) and `dist/purifier-model.js` (THREE visuals). game.js, inventory-state.js and icons.svg get only small hooks. New modules are imported with `?build=v3-survival-ae77fa84ac2b`.

## 1. Items and recipes (dist/inventory-state.js)
Add to `ITEM_INFO` (`tool:false`, `placeholder:false`, kind / name / icon / maxStack): `cup` / Cup / `icon-cup` / 5, `saltcup` / Cup of Sea Water / `icon-saltcup` / 5,
`freshcup` / Cup of Fresh Water / `icon-freshcup` / 5, and `purifier` / Water Purifier / `icon-purifier` / STACK_SIZE.
Add to `RECIPES`: `cup: recipe('cup','Cup',1,{plastic:1})` and `purifier: recipe('purifier','Water Purifier',1,{wood:2, scrap:2, plastic:1})`.
`saltcup` and `freshcup` have no recipe. Add four `<symbol viewBox="0 0 48 48">` to dist/icons.svg, all original art: a tapered cup outline (`icon-cup`), the same cup with a grey-green
fill and a wave line (`icon-saltcup`), the same cup with a clear blue fill and a droplet (`icon-freshcup`), and a pot on three legs with a steam curl (`icon-purifier`).
If the builder runs out of time, a symbol may borrow `icon-barrel` and set `placeholder:true`.

## 2. Placeable decor (dist/game.js constants)
Append `'purifier'` to `DECOR_TYPES`, so placement, the ghost, build and save work through the existing checks. Add `purifier:.3` to `BLOCK_RADIUS`.

## 3. State: `world.garden` and `world.purifiers`
Both maps are keyed `"x,z"` (tile ints, matching `/^-?\d+,-?\d+$/`). Values hold integer seconds only, never timestamps.
- `garden[key] = {water:0|1, grow:0..90}`. A missing entry means dry, stage 0. The stage is `grow>=90 ? 2 : grow>=45 ? 1 : 0`.
  An entry with `water:0, grow:0` is deleted. A ripe entry always has `water:0`, because ripening uses up the water.
- `purifiers[key] = {t:0..15, ready:0|1}`. A missing entry means empty. `ready:1` forces `t:15`.
- A key is valid only if `world.decor` has a `palm` at that tile (garden) or a `purifier` at that tile (purifiers).
  Otherwise the entry is removed. This check runs in `cleanWorld` and on every tick, so removed or replaced decor never leaves stale timers.
- Hooks in game.js, one line each: in `newWorld()` add `garden:{}, purifiers:{}`. In the `cleanWorld()` return add `...cleanWatering(v, decor)`
  (a missing or invalid map becomes `{}`, so old saves load). In `copyWorld()` add `...copyWatering(w)`. In `hostState().world` add `garden:world.garden, purifiers:world.purifiers`.
- Do not put timers on decor objects. The guest's rebuild check `JSON.stringify([tiles, decor])` stays unchanged, so ticking never calls `rebuildRaft()`.

## 4. Pure module dist/watering.js (no DOM, no THREE, no imports, no Date/Math.random)
```js
export const PURIFY_SECONDS = 15, GROW_SECONDS = 90, STAGE_SECONDS = 45, MAX_TICK = 60;
export const FILL_REACH = 6, USE_REACH = 3, HOST_SLACK = 2;          // metres (horizontal)
export const HARVEST = {leaf:2}, BONUS = {wood:1}, BONUS_CHANCE = .25;
export const WATER_ACTIONS = Object.freeze(['fillCup','loadPurifier','takeWater','waterPlant','harvestPlant']);
export const tileKey = (x, z) => x + ',' + z;
export function cleanWatering(v, decor)      // -> {garden, purifiers}; validates and prunes as in section 3
export function copyWatering(w)               // -> deep copies {garden, purifiers}; missing -> {}
export function plantStage(entry)             // -> 0|1|2
export function tick(world, dt)               // dt floored and clamped to 0..MAX_TICK; mutates world.garden and world.purifiers
                                              // -> {grown:[keys whose stage changed], ripe:[keys that just reached 2], done:[purifier keys just ready]}
export function fillCup(world, bag)                      // cup -> saltcup
export function loadPurifier(world, key, bag)            // saltcup consumed (the cup stays in the purifier); creates {t:0, ready:0}
export function takeWater(world, key, bag)               // ready purifier -> +1 freshcup; deletes the entry
export function water(world, key, bag)                   // freshcup -> cup; garden[key].water = 1
export function harvest(world, key, bag, rng = Math.random) // ripe -> +2 leaf, +1 wood if rng() < .25; deletes the entry
```
- `tick` adds `dt` to `grow` only on garden entries where `water===1 && grow<90`. When `grow` reaches 90 it sets `water=0`. It adds `dt` to `t` on purifier entries where `ready===0`. At 15 it sets `ready=1`. It never uses rng, and it prunes as in section 3.
- Each action returns `{ok:true, kind:'loot'|'build', text}` or `{ok:false, reason, text}`. The reasons are `nocup|notarget|busy|notready|watered|ripe|notripe|full`. `text` is the toast (section 7). An action that fails changes nothing.
- Bag changes are atomic, and the module never imports Bag. Helper `swapOne(bag, from, to)`: if the selected slot is `from`
  with count 1, replace that slot with `{kind:to, count:1}`. Otherwise use a scratch copy, `s = new bag.constructor(bag.snapshot())`,
  then `s.remove(from,1)` and `s.add(to,1)===0`, and copy `s.slots` into `bag.slots`. If that fails, return reason `full`.
  Gains such as harvest and takeWater use the same scratch-then-commit pattern. A full bag leaves the plant ripe or the water ready.
- `harvest` calls `rng()` exactly once, and only after it has checked that the plant is ripe, so seeded tests are deterministic.
- `water` refuses `watered` (already wet) and `ripe` (harvest first). This way two co-op players never waste two cups.
- `loadPurifier` refuses `busy` when an entry already exists. `takeWater` refuses `notready` while `t<15`. The target checks check `world.decor` for the right type at `key`, else they return `notarget`.

## 5. Host actions (applyAction in game.js)
Add one line before the `'wear'` comment: `if (WATER_ACTIONS.includes(a.kind)) { applyWatering(a, actor, bag); return; }`.
Next to `wearHook`, add `applyWatering(a, actor, bag)`. It:
1. Gets the actor's pose: `actor==='guest' ? other : physics`. If there is none, it ignores the action.
2. For `fillCup` (`{x,z}` as finite world metres): rejects if `|x|,|z|>=120`, if `hasTile(round(x/2), round(z/2))`, or if
   `hypot(x-pose.x, z-pose.z) > FILL_REACH+HOST_SLACK`. Then it calls `fillCup(world, bag)`.
3. For the other kinds (`{x,z}` as tile ints): rejects anything that is not an int, and rejects a tile centre `(x*2, z*2)` farther than
   `USE_REACH+HOST_SLACK` from the pose. It calls the matching function with `tileKey(x,z)`, and calls `harvest` with the mount's seeded `rand`.
4. Calls `emit({kind:r.ok ? r.kind : (r.reason==='full' ? 'full' : 'notice'), text:r.text}, actor)`. Nothing is broadcast to `'all'`, because the visuals already sync through hostState.

## 6. Client routing (aim, interact, useSelected)
- `pickNdc`: also cast `ray` against `[...wateringGroups.values()]` (recursive). Walk up to the ancestor that has `userData.tileKey`.
  Add `decor:{key, type, x, z}` to the returned aim, or `null` when there is no hit within 6 m along the ray. If there is no hit, fall back to the deck-plane point's tile when it holds a palm or purifier.
- Add `wateringTarget(aim)` in game.js. It returns `null` or `{prompt, click, e, why}`, where `click`/`e` are actions or `null`, and `why`
  is the notice shown when a click does nothing. It reads `selectedKind()`, `localBag()`, `world.garden` and `world.purifiers`.
  Targets more than `USE_REACH` from the player are ignored. With a `cup`, an aim point on open water within `FILL_REACH` gives `click={kind:'fillCup',x,z}`. If the water is too far, `why` is 'Try a spot a little closer'.
- `frame()`: after `pickTarget = ...`, add `waterAim = pickTarget ? null : wateringTarget(frameAim);`.
- `interact()` (E): after the debris branch and before `openInventory()`, add
  `const w = wateringTarget(currentAim()); if (w?.e) { if (guestWaiting()) {...same notice...} action(w.e); swing = .6; return; }`.
  Other lanes that also check E go in the same spot, each with its own line. Debris pickup always comes first.
- `useSelected()`: after the fishingrod branch, add `if (kind==='cup'||kind==='saltcup'||kind==='freshcup') { const w = wateringTarget(aim); if (w?.click) { swing = 1; action(w.click); } else notice(w?.why ?? WHY[kind]); return; }`.
  `WHY = {cup:'Point at the sea to scoop water', saltcup:'Pour it into a water purifier', freshcup:'Point at a palm planter'}`.

Each case below is aim + held item → prompt [click / E]. A `-` means none. Clicks only route here while a cup kind is held (above).
- sea in reach + `cup` → `<kbd>Click</kbd>Scoop sea water` [fillCup / -]
- empty purifier + `saltcup` → `<kbd>E</kbd>Pour in sea water` [loadPurifier / loadPurifier]
- empty purifier + anything else → `Purifier: needs a cup of sea water` [- / -]
- purifying → `Purifying… Ns`, with N = 15 - t [- / -]
- ready purifier + any item → `<kbd>E</kbd>Take fresh water` [takeWater if a cup kind is held / takeWater]
- dry palm + `freshcup` → `<kbd>Click</kbd>Water the planter` [waterPlant / waterPlant]
- dry palm + `saltcup` → `Plants want fresh water` [- / -]
- dry palm + anything else → `Palm planter: needs fresh water` [- / -]
- watered palm → `Growing… (watered)` [- / -]
- ripe palm + any item → `<kbd>E</kbd>Harvest palm` [harvestPlant if a cup kind is held / harvestPlant]
`updateContext`: add `else if (waterAim?.prompt) html = waterAim.prompt;` right after the `pickTarget` line. Every prompt is static text, so it needs no `esc`.

## 7. Toast text (returned by watering.js)
fillCup "Scooped a cup of sea water" · loadPurifier "The purifier is bubbling away" · takeWater "+ 1 cup of fresh water" · water "The planter drinks it up" ·
harvest "+ 2 palm leaf" or "+ 2 palm leaf · 1 wood" · full "Your bag is full" · nocup "You need a cup" · busy "It is already purifying" · notready "Almost ready…" ·
watered "Already watered" · ripe "Harvest it first" · notripe "Still growing" · notarget "Nothing to use that on".
Host tick, ripe: `emit({kind:'notice', text:'A palm is ready to harvest'}, 'all')`. At most one per tick, and none while a notice is already showing.

## 8. Host tick location
Inside `if (running && role !== 'guest') {` in `frame()`, after the nets block: `waterClock += dt; if (waterClock >= 1) { waterClock -= 1; const r = tickWatering(world, 1); if (r.ripe.length) emit(...); }`.
Import it as `tick as tickWatering`. `waterClock` is a `let` beside `netClock`. It is not captured, so a hot-swap costs at most 1 s. Growth counts only while the host is running, so growth pauses when the game is closed or paused. Saves already include both maps (`{...world}`).

## 9. Visuals (dist/purifier-model.js, imports nothing; it is given THREE)
`export function createPurifier(T)` returns a Group named `craft_purifier` with `userData.craftType='purifier'`. Its origin is the floor top,
it sits inside about 0.75 x 0.55, and it is about 0.75 tall. Every mesh casts and receives shadows except the steam. Its own geometries and materials are created per call:
- `purifierBase`: box .7 x .04 x .5 at y .02, wood colour #9c7649. `purifierLegs`: 3 steel cylinders (r .022, h .42, #76838a, metalness .7, roughness .45) on radius .2 at 90°/210°/330°, centre y .23. `purifierRing`: torus (R .2, tube .018) lying flat at y .44.
- `fireTray`: cylinder r .17 h .04 at y .1, #3b3430. `embers`: 5 icosahedra r .035 on the tray, emissive #ff7a2a, hidden unless purifying.
- `pot`: open cylinder (top r .2, bottom r .17, h .22, `openEnded`, DoubleSide) centred at y .55, copper #b87333, metalness .6. `potWater`: disc r .185 at y .62, #5f8fa0, hidden while empty.
- `spout`: TubeGeometry (r .018) along a QuadraticBezier from (0.14,.66,0) over (0.32,.78,0) to (0.42,.42,0), steel. `shelf`: box .18 x .03 x .18 at (0.42,.3,0), wood, on a steel rod down to the base.
- `cup`: open cylinder (r .06 / .05, h .1) at (0.42,.37,0), off-white #e8e2d0, shown while loaded or ready. `cupWater`: disc r .055 at y .41, #9ad7f0 with emissive #2a6f8a .3, shown only when ready.
- `steam`: 3 spheres r .05, white, transparent, depthWrite false, named `steam0..2`.
`export function paintPurifier(g, entry, elapsed)` sets: empty: embers, potWater, cup and steam off. Purifying: embers flicker
(emissiveIntensity .8 + .4*sin(elapsed*9 + i)), potWater on, cup on, and each steam puff gets phase = (elapsed*.45 + i/3) % 1,
y = .7 + phase*.5, x = sin(phase*6+i)*.04, opacity .45*(1-phase). Ready: embers and steam off, potWater on, cup and cupWater on.
It caches the static part with `g.userData.sig = entry ? (entry.ready ? 'r' : 'b') : 'e'`. Only steam and embers are animated every frame.
Planter stages, still in purifier-model.js:
- `export function preparePlanter(T, g)`. Run it once, right after `createCraft(T,'palm')`. It makes a Group `plantPivot` at (0, .49, 0)
  and moves the meshes named `trunk, crown, coconuts, fronds, frondRibs` into it (`mesh.position.y -= .49`). If they are missing (fallback palm), it is a no-op.
- `export function paintPlanter(g, stage, wet)`: pivot scale .7 for stage 0, .85 for stage 1, 1 for stage 2. `coconuts.visible = stage===2`.
  The `soil` material colour is #2e1f14 when wet and #4a3322 when dry. It returns early when `${stage}|${wet}` equals `g.userData.sig`.
game.js hooks: add a `wateringGroups = new Map()`, cleared at the top of `rebuildRaft()`. In the decor loop, use
`detailed = d.type==='purifier' ? createPurifier(T) : createCraft(T, d.type)`. After `raft.add(detailed)`, palms and purifiers get
`userData.tileKey` and go into the map, and palms run `preparePlanter`. `updateWateringVisuals()` is called every frame after
`updateItems(dt)`, for every role. For each map entry it calls `paintPlanter(g, plantStage(world.garden[k]), world.garden[k]?.water===1)`
or `paintPurifier(g, world.purifiers[k], elapsed)`. It never calls `rebuildRaft`. The player's hands show no model for cups in v1.

## 10. raftDebug (read-only)
In `state`, add `watering:{garden:copy, purifiers:copy, target:waterAim ? {prompt:waterAim.prompt, click:waterAim.click?.kind ?? null, e:waterAim.e?.kind ?? null} : null}`.
Add a getter `wateringTargets` that lists `{key, type, x, z, stage|null, water|null, t|null, ready|null, distance, screen:project(x*2, .9, z*2)}`
for every palm and purifier, so screenshot tests can aim. Keep `state.tool` unchanged: cups report `'none'`.

## 11. tests/watering.test.mjs (node:test; import via `new URL('watering.js', base)` like survival.test.mjs)
1. `cleanWatering`: missing, null or array input gives `{garden:{}, purifiers:{}}`. Bad keys, non-int fields and negative or oversize values are dropped or clamped.
   Entries whose tile has no palm or purifier are removed, including a garden key that points at a purifier.
2. Ripe entries are normalised to `water:0`. A purifier with `ready:1` gets `t:15`. `{water:0, grow:0}` entries are deleted.
3. `tick`: a dry planter does not grow. A watered one reaches stage 1 at 45 s and stage 2 at 90 s, then `water` is 0, and `ripe` lists the key once. `dt` 0.9 counts as 0, and `dt` 1e6 is clamped to 60.
4. `tick` prunes the entries of decor removed from `world.decor`.
5. Purifier: load then 14 x tick(1) gives not ready, the 15th tick gives `done:[key]`, then takeWater gives a freshcup and deletes the entry.
6. Refusals with an unchanged bag snapshot: fill without a cup, load while busy, take before ready, water while already watered, water while ripe, harvest while not ripe.
7. `swapOne` keeps the item in hand: a selected single cup becomes a saltcup in the same slot. A stack of 3 cups in a full bag gives `full` and no change.
8. Harvest with `rng=()=>.1` gives +2 leaf and +1 wood. With `rng=()=>.9` it gives leaves only. A full bag gives `full`, the plant stays ripe, and rng is called once per attempt.
9. Determinism: two identical worlds with the same tick sequence end up `deepEqual`.
10. Recipes and ITEM_INFO: `cup` and `purifier` craft from their costs. `new Bag` accepts a snapshot holding all four new kinds.
11. purifier-model with the vendored THREE: `createPurifier` has the named meshes listed above. `paintPurifier` toggles `embers`/`cupWater` per state. `preparePlanter(createCraft(T,'palm'))` creates `plantPivot`, and `paintPlanter(g,2,true)` shows the coconuts.
Run `npm test` and shoot.py. The `errors` list must be empty.

## 12. Backward compatibility and co-op
- Old saves have no `garden`/`purifiers`, so both become `{}`. Every existing palm starts dry at stage 0. It looks a little smaller (pivot .7) until it is watered and grown. That is the only visible change.
- Host-authoritative: only the host ticks and validates. Guests get both maps through `hostState` → `cleanWorld`, which prunes them against the same snapshot's decor. The 400-tile cap bounds the payload.
- Hot-swap: both maps live in `world`, so `capture()`/`mount` carry them across. In-flight purifying and growth continue.
- **Known limitation:** older builds reject a bag that holds an unknown kind. `Bag` throws, and `snapBag` returns `null`. An older build that loads this save,
  or an older guest that receives a snapshot, resets that bag if it holds `cup`, `saltcup`, `freshcup` or `purifier`. Mixed-version co-op is unsupported,
  and the `?build=` suffix keeps peers on the same modules. Say this in the PR.
- Parallel lanes: the receiver lane (`'cache'` debris, `world.signal`) and the notes/achievements lane (`'bottle'` debris, `world.notes`/`world.achievements`)
  touch the same functions. This lane adds only its own lines: a spread in `cleanWorld`/`copyWorld`, named keys in `newWorld`/`hostState`,
  one `WATER_ACTIONS` line in `applyAction`, one line each in `interact`/`useSelected`/`updateContext`/`frame`. It never edits `ITEM_TYPES`, `SPAWN_TABLE` or `LOOT`.
  An achievements lane may read `world.garden`, or hook into harvest results, without this module knowing about it.
- The farming lane may reuse `freshcup` and `water()`/`tick()`. Its keys must not collide with palm tiles.
