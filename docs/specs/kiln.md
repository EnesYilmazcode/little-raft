# Spec: Seaside Kiln (metal bars, glass, bricks)

Source: docs/features/smelter-research.md. Cozy rules: nothing burns, spoils or is lost. An idle kiln never uses wood.
New files: `dist/kiln-core.js` (pure), `dist/kiln.js` (content module), `dist/kiln-model.js` (THREE), `tests/kiln.test.mjs`.
Edits: dist/content.js (import + FEATURES), dist/content-items.js, dist/icons.svg, dist/survival-ui.js (SPRITES), and one line in dist/game.js (§9).
Imports inside content modules have no `?build=` suffix, like storage-research.js.

## 1. Items (append to CONTENT_ITEMS in dist/content-items.js)
Use the file's `item(kind, name, icon, placeholder)` helper (maxStack 20, not tools):
`kiln` / Seaside Kiln / `icon-kiln` / false · `ingot` / Metal Bar / `icon-ingot` / false · `glass` / Glass Pane / `icon-glass` / false ·
`brick` / Fired Brick / `icon-brick` / false · `glasslamp` / Glass Lantern / `icon-lantern` / true · `sinker` / Line Sinker / `icon-ingot` / true.
Id check: none of these kinds exist yet in ITEM_INFO, RECIPES, DECOR_TYPES or the islands/diving tables. The diving block in inventory-state.js
spreads after CONTENT_ITEMS and would override a duplicate, but none of these six collide. The other two designers must not reuse these six ids.
This feature uses no generic id such as `lamp` or `planter`.

## 2. Recipes (append to CONTENT_RECIPES)
| id | output | cost | built with |
|---|---|---|---|
| `kiln` | kiln ×1 | stone 4, clay 4, scrap 1 | `recipe()` helper |
| `glasslamp` | glasslamp ×1 | glass 2, ingot 1, wood 1 | `recipe()` |
| `sinker` | sinker ×1 | ingot 1, stone 1 | `recipe()` |
| `glasscups` | **cup ×3** | glass 1 | hand-written: `Object.freeze({id:'glasscups', name:'Glass Cups', output:Object.freeze({kind:'cup', count:3}), cost:Object.freeze({glass:1})})` |
| `brickplanter` | **palm ×2** | brick 3, leaf 2 | hand-written, `name:'Brick Planters'`, `output:{kind:'palm', count:2}` |

The research note asked for 6 stone; this spec uses 4. An island has 1-4 rocks with 3 uses each. 4 stone for the kiln plus 1 studied stone
nearly always fits within the first island, which docks at 90 s for 180 s. Smelting is **not** in RECIPES, because the kiln does it. So it is never
gated, and metalore and sand are never studied.

**Gating decision: the kiln stays research-gated. Do NOT add it to STARTER.** I checked storage-research.js. `lockedRecipes` and `researchableKinds`
are derived from RECIPES. Stone and clay appear in no recipe today, so they become studyable as soon as this recipe exists.
A fresh player's path:
1. Craft the Research Table. It is in STARTER (wood 6, scrap 2).
2. Collect scrap from debris or the seafloor.
3. Dive for clay. Clay is 25 % of seafloor nodes, and diving is open from the start.
4. Gather stone from the island rocks. The first island arrives at 90 s.
5. Study stone, clay and scrap at the table.
This unlocks the kiln in about 5 minutes. The step is easy to find. The craft list already shows a locked "Seaside Kiln" row with
"Study Stone + Clay" (storage-research-ui.js annotate()). The table also labels stone and clay "Unlocks Seaside Kiln". The gate guides the player
and does not hide the kiln, so it stays on the progression the table already teaches.
The advanced recipes unlock once you study the kiln's outputs: glass for glasscups, brick and leaf for brickplanter, ingot and stone for sinker,
and glass, ingot and wood for glasslamp.
Old saves:
- Legacy grandfathered worlds recompute `ingredientKinds()` on load and get everything.
- Saves that already have a storage slice must study stone and clay, which is a fair new goal.
- A guest with an old host has `st.all` and can craft everything.
None of this needs a change to the storage code.

## 3. Decor and placement
Append `'kiln', 'glasslamp'` to `CONTENT_DECOR`. Add `kiln: .45, glasslamp: .12` to `CONTENT_BLOCK_RADIUS`. game.js spreads both, so placement, the
ghost, the build action (one decor per tile, no grill tile) and saving all work unchanged.
`createCraft(T,'kiln'|'glasslamp')` returns null, so rebuildRaft falls back to `content.decorModel(type)`. The engine sets the position (tile×2, y .22).
game.js never removes decor. If a kiln entry is left without its decor, for example after another world loads, it is pruned (§5).

## 4. Pure core: dist/kiln-core.js (no imports, no DOM, no THREE, no Date, no Math.random)
```js
export const KILN = Object.freeze({ QUEUE:6, TRAY:10, FUEL_MAX:8, PER_WOOD:2, MAX_DT:1, REACH:3.2, MAX_KILNS:100 });
export const SMELT = Object.freeze({ metalore:{out:'ingot', need:2, secs:18}, sand:{out:'glass', need:2, secs:12}, clay:{out:'brick', need:1, secs:10} });
export const INPUTS = Object.freeze(['metalore','sand','clay']), OUTPUTS = Object.freeze(['ingot','glass','brick']);
export const KILN_ACTIONS = Object.freeze(['kiln.load','kiln.fuel','kiln.take']);
export const keyOf = (x, z) => x + ',' + z;
export const TEXT = Object.freeze({...});  // refusal texts, below
export function blank()                    // {r:null, q:0, t:0, h:0, f:0, o:null, n:0}
export function cleanEntry(raw)            // -> entry | null (invalid, or idle and empty)
export function cleanSlice(data, decorAt)  // -> {k:{key:entry}, r:int}; decorAt optional (x,z)->type: drops non-kiln tiles
export function sliceOf(st)                // -> {v:1, r, k} deep copy, t rounded to 0.1, idle empty entries omitted
export function canLoad(e, input)          // -> null | 'kind' | 'full'
export function addFuel(e)                 // -> true if f + PER_WOOD <= FUEL_MAX (mutates)
export function step(e, dt)                // -> batches finished (0|1). No allocations.
export function stepAll(st, dt, onDone)    // for..in over st.k; onDone(key, e) when a queue empties; -> true if anything changed
export const burning = e => !!e && e.h === 1;
export function progress(e)                // 0..1 of the current batch
export function applyKilnAction(st, a, actor, bag, env) // -> {ok, reason?, text, n?}
```
**Entry fields.** `r` is the input kind or null. `q` is the number of queued batches, 0..6, counting the current one. `t` is the seconds spent on
the current batch. `h` is 1 when the current batch has been paid for and is burning. `f` is fuel in batch charges, an integer 0..8. `o` is the
tray kind or null, and `n` is the tray count, 0..10.

**step.** dt is clamped to 0..MAX_DT, and NaN becomes 0. If `q>0 && h===0 && f>0`, then `f--, h=1`. This is the only place fuel is spent.
If `h===1`, add dt to `t`. When `t >= secs`, set `t=0, h=0, q--, o=out, n++`, and also `r=null` when q reaches 0, then return 1. When `q>0` and
`f===0`, the kiln pauses and keeps t and h.

**cleanEntry.** Rules, in order:
1. A non-object gives null.
2. `r` must be in INPUTS, otherwise null. `q` is an integer 0..6, otherwise 0.
3. If `q===0` or `r===null`, set `q=0, r=null, t=0, h=0`.
4. `h` is 1 only when `raw.h===1` and `q>0`. `t` must be finite and is clamped to 0..secs. When `h===0`, `t=0`.
5. `f` is an integer 0..8, otherwise 0. `o` must be in OUTPUTS, and `n` is an integer 0..10. If either is missing or zero, `o=null, n=0`.
6. If `q>0` and `o` is set to something other than `SMELT[r].out`, set `q=0`. This is corrupt data, and the tray is kept.
7. Set `q = min(q, TRAY-n)`.
8. If `q`, `f` and `n` are all 0, return null.

**cleanSlice.** Keys must match `/^(-?\d{1,2}),(-?\d{1,2})$/` with |x| and |z| ≤ 25. At most MAX_KILNS entries are kept. `r` is an integer ≥ 0,
otherwise 0. It never throws.

**applyKilnAction.** `a = {kind, x, z, item?}`, and `env = {decorAt(x,z), pos(actor)}`, with the same contract as applyStorageAction.
Common checks, in order:
1. `bad`: the kind is unknown, x or z is not an integer within ±25, or the bag is not a 28-slot bag.
2. `missing`: `decorAt !== 'kiln'`.
3. `reach`: `hypot(p.x-x*2, p.z-z*2) > REACH`.

Per verb:
- **load** (`item` in INPUTS). Refusals: `nothing` when the bag has fewer than `need`, with the text "Need N more metal ore". `kind` when the kiln
  is firing a different input or the tray holds another output. `full` when `q===QUEUE` or `q+n+1 > TRAY`. On success, remove `need` on a scratch
  `new bag.constructor(bag.snapshot())`, commit its slots into bag.slots, then `q++, r=item`.
- **fuel**. Refusals: `nowood` when `bag.count('wood') < 1`. `fuelfull` when the wood does not fit. On success, remove 1 wood, from the selected
  slot first, and `f += PER_WOOD`.
- **take**. Refusals: `empty` when `n===0`. `bagfull` when nothing fits. On success, `scratch.add(o, n)` and move `n - leftover`, which may be a
  partial take that leaves the rest in the tray.

Everything is checked before anything changes, and a refusal changes nothing. Every success does `st.r++`.

TEXT:
- reach: 'Step a little closer'
- missing: 'That spot has no kiln'
- kind: 'The kiln is busy with something else. Collect or wait first'
- full: 'The kiln is full'
- nowood: 'You need wood for the fire'
- fuelfull: 'The firebox is full'
- empty: 'Nothing ready yet'
- bagfull: 'Your bag is full'

Success texts:
- load: `Loaded ${need} ${name} · ${q} in the kiln`
- fuel: `Fire stoked · ${f} batches of fuel`
- take: `+ ${n} ${name}`

## 5. Module: dist/kiln.js, `createKiln(ctx)`, name `'kiln'`
Add `import { createKiln } from './kiln.js';` and append `createKiln` to the end of FEATURES (after createDayNight).
**State.** `st = {k:{}, r:0}`. `decorAt` and `posOf` are copied from storage-research.js. A guest's position comes from `ctx.other`.

**serialize()** returns a cached `sliceOf(st)`, rebuilt only when `st.r` changes. The host's update bumps `st.r` when a batch starts or finishes,
or when `Math.round(t*10)` of a burning kiln changes. That is at most 10 times a second, and the snapshot is about 8 per second in hostState.

**load(data, from)**:
- `'net'`: return early if `data?.r === netR`. Otherwise `st = cleanSlice(data)`, without pruning, and set `dirty = true`.
- `'save'` and `'restore'`: `st = cleanSlice(data, decorAt)`.
- `undefined`: `{k:{}, r:0}`.

**action(a, actor, bag)** returns false unless `a.kind` starts with `'kiln.'`. It runs applyKilnAction and returns true. Results are emitted to
the actor: `{kind:'loot'}` for a take, `{kind:'build'}` for a load or fuel, and `{kind:r.reason==='bagfull'?'full':'notice', text}` for a refusal.

**update(dt)** never allocates. It uses for..in loops, preallocated arrays and no closures in the loop.
- Host only (`ctx.role !== 'guest'`): `stepAll(st, dt, onDone)`. onDone emits `{kind:'loot', text:'The kiln is done: N Glass Pane ready'}` to
  'all'. Once a second, prune keys whose `decorAt !== 'kiln'`.
- Then visuals (§6).

**interact(aim).** `target(aim)` is a copy of the storage ray test, filtered to type `'kiln'`: REACH 3.2, offset ≤ .85, centre at raft y + .5.
With no target, return false. With a target, read `sel`, the kind in the selected `ctx.localBag()` slot, and pick:
- an input: `ctx.action({kind:'kiln.load', x, z, item:sel})`
- wood: `ctx.action({kind:'kiln.fuel', x, z})`
- otherwise, if the tray has n > 0: `ctx.action({kind:'kiln.take', x, z})`
- otherwise: `ctx.notice('Hold metal ore, sand or clay to load the kiln')`

Return true in every one of these cases. A guest never mutates st locally.

**prompt(aim)** returns null without a target. Otherwise it returns `<kbd>E</kbd>` + verb + ` · ` + status.
The verb is `Load 2 metal ore`, `Load 2 sand` or `Load 1 clay`, then `Add wood`, then `Take 3 Glass Pane`, then `Seaside Kiln`.
The status joins `Glass Pane 2 queued 45%`, `fuel 3` (or `needs wood` when paused) and `1 ready` with ` · `. Escape it with `ctx.esc`.
Cache the result by (key, st.r, sel, pct).

**decorModel(type).** For 'kiln': `model ??= buildKiln(T)`, then `dirty = true`, then return `model.instance()`.
For 'glasslamp': `lamp ??= buildGlassLamp(T)`, then `lamp.instance()`. Anything else returns null.

**debug** (`raftDebug.content.kiln`). The mutating helpers are host only and return false for a guest.
- `state()`: a JSON copy of the slice plus `burning:[keys]`.
- `spawn(x=0, z=0)`: places kiln decor on a free existing tile, then calls `rebuildRaft()`.
- `give(kind, n=10)`: adds to the local bag.
- `fill(x, z, entry)`: runs `cleanEntry`.
- `finish(x, z)`: moves the whole queue to the tray, with no fuel, and bumps r.
- `run(sec)`: steps every kiln by 1 s, `sec` times.
- `clear()`.

Unlock recipes with `raftDebug.content.storage.unlockAll()`. **dispose()** calls `model?.dispose()` and `lamp?.dispose()`.

## 6. Model: dist/kiln-model.js
`buildKiln(T)` returns `{instance(), flicker(time), dispose()}`. Geometry and materials are built once and shared, as in storage-research-model.js.
The origin is the tile-top centre, the footprint about .9×.9, the height about 1.2, facing +z. **6 meshes, at most 4 visible. Only the body casts a shadow.**
1. `kilnBody`: one merged vertex-coloured MeshStandardMaterial geometry, roughness .9. It contains:
   - a stone plinth box .9×.16×.9 (#8d8a82, jittered)
   - a clay drum cylinder, r .4, h .34 (#b8653d)
   - a dome hemisphere, r .4, y-scale 1.05 (#c9774a)
   - a dark mouth box .26×.24×.06 at the front (#2a1a12)
   - a back chimney, r .065, h .38 (#7f4127)
   - 3 logs at the side (#906f48)
   - a front-right tray plank .32×.03×.2 (#a97d4c)
2. `kilnGlow`: a plane in the mouth and an ember box, with color #ff8a3d, emissive #ff6a1a and emissiveIntensity 1.8. Visible only while burning.
3. `kilnFlame`: 2 crossed planes .14×.22, MeshBasicMaterial #ffc46a, additive, depthWrite false. Visible only while burning.
4. Tray meshes. Only the one matching `o` is shown, and only when n > 0:
   - `trayIngot`: box .15×.04×.06, #9aa6ad, metalness .6
   - `trayGlass`: box .16×.11×.012, #bfe8e4, opacity .5
   - `trayBrick`: box .15×.05×.07, #b5532f

`instance()` returns a Group named `'kiln_station'` with new Meshes that share the geometry and materials, and sets
`userData.kiln = {glow, flame, tray:{ingot, glass, brick}}`.
`flicker(time)` changes only the shared materials: glow intensity `1.6+.35*sin(time*9)+.2*sin(time*23)` and flame opacity `.75+.2*sin(time*13)`.

**Visuals in update:**
- **Rescan** when `dirty` is set or `ctx.raft.children.length` changed. Fill a preallocated array of up to 100 kiln_station groups and their keys
  `keyOf(round(x/2), round(z/2))`. A scan may allocate.
- **Apply** when `st.r !== shownR` or right after a rescan: set the glow and flame `visible = burning(e)` and pick the tray mesh.
- **Per frame**, only while some kiln burns: `model.flicker(clock)`, and per instance `flame.scale.y = 1+.15*sin(clock*11+i)`.

`buildGlassLamp(T)`:
- Its instance is a Group named **`'craft_lantern'`**. daynight.js:381 then lights it and adds it to the light pool, with no daynight edit.
- It has 3 meshes:
  - a merged iron post (r .05, h 1.6, #4a4f52) with a bracket and cap
  - `lanternGlass`: box .2×.28×.2 at (.3, 1.3, 0), #dff4f0, opacity .3, emissive #ffd08a, intensity **.9** (the wood lantern uses .6)
  - `lanternGlow`: sphere r .07 at (.3, 1.29, 0), emissive #ffb050, intensity **2.2** (the wood lantern uses 1.6)
- Clone the 2 emissive materials **for each instance**, because daynight records and scales the base emissive per material.

## 7. Icons
Add 4 original `<symbol viewBox="0 0 48 48">` symbols to icons.svg in the house style: stroke #153e49 at 2px, palette #ffbd66 #54a6a4 #bb8650 #fff2cc.
- `icon-kiln`: a domed kiln with an orange mouth and a chimney
- `icon-ingot`: a trapezoid bar with a highlight
- `icon-glass`: a teal pane with 2 shine strokes
- `icon-brick`: a terracotta brick with a mortar line

Append `'kiln', 'ingot', 'glass', 'brick'` to `SPRITES` in survival-ui.js. SPRITE_FOR needs no change because ITEM_INFO.icon is used.

## 8. Co-op and backward compatibility
- **Host authority.** Only the host steps timers and applies `kiln.*`. Guests send `ctx.action` and render the received slice.
- **Items.** Outputs go to the acting player's `bag`, so whoever collects gets the items.
- **Simultaneous E presses.** Both are validated in order. The second take gets `empty`, and the second load is checked against QUEUE and TRAY.
  Nothing is ever duplicated.
- **Old saves.** They have no `ext.kiln`, so `load(undefined)` gives no kilns. Garbage is cleaned (§4).
- **Old builds.** They ignore `ext.kiln` and reject bags with the new kinds, as the content-items.js header says.
- **Visits.** `restoreOwnRaft` reloads the guest's own slice with `'restore'`.

## 9. The single game.js edit (the sinker)
In `wearHook` (game.js:726), replace `    s.durability = Math.max(0, before - WEAR_PER_CATCH);` with:
`    s.durability = Math.max(0, before - (bag.count('sinker') > 0 ? 1 : WEAR_PER_CATCH)); // kiln: a Line Sinker in the bag halves hook wear`
The toast texts stay the same.

## 10. Tests: tests/kiln.test.mjs (node:test, real Bag from inventory-state.js)
1. Constants and recipes:
   - every new recipe is in RECIPES
   - glasscups gives cup×3 and brickplanter gives palm×2
   - kiln is not in STARTER
2. Research path:
   - for an empty state, `researchableKinds` includes stone and clay
   - `learnedFrom(['stone','clay','scrap'])` includes kiln
   - glass unlocks glasscups, and brick plus leaf unlocks brickplanter
3. cleanEntry and cleanSlice:
   - garbage, NaN and out-of-range values are rejected
   - bad keys and keys beyond ±25 are dropped
   - an idle empty entry gives null
   - a tray/queue mismatch drops the queue
   - `q+n` is capped at TRAY
   - decorAt prunes, and MAX_KILNS holds
   - `cleanSlice(undefined)` gives `{k:{}, r:0}`
4. step:
   - fuel is spent only when a batch starts
   - an idle kiln keeps its fuel
   - with no fuel the kiln pauses and keeps t
   - dt 1e6 adds at most 1 s, and NaN does nothing
   - glass is done after 12 one-second steps
   - r resets when q reaches 0
5. load:
   - the bag change is atomic
   - too few items gives `nothing` and changes nothing
   - a different input gives `kind`, and a tray of another kind gives `kind`
   - the QUEUE and TRAY limits give `full`
6. fuel:
   - +2 charges per wood
   - a cap of 8, where `fuelfull` leaves the bag untouched
   - no wood gives `nowood`
7. take:
   - a full take
   - a partial take into a nearly full bag leaves the rest in the tray
   - a full bag gives `bagfull` and nothing changes
8. Guards:
   - `missing`, and `reach` from 10 m away
   - `bad` for the kind, coordinates and bag
   - every success bumps r
9. sliceOf:
   - rounds t to 0.1 and leaves out idle entries
   - survives a JSON round trip through cleanSlice
10. Module with a fake ctx, as in storage-research.test.mjs, with T present:
    - `load(undefined)` gives an empty slice
    - `load(d,'net')` with the same r is a no-op
    - the guest's update never steps, and the host's update steps and emits to 'all'
    - `storage.*` actions return false
    - `debug.finish` fills the tray
    - `decorModel('kiln')` is a kiln_station with at most 6 meshes
    - `decorModel('glasslamp')` is a craft_lantern with a lanternGlow mesh
    - `decorModel('crate')` is null
11. Sinker: a grep of game.js finds the `bag.count('sinker') > 0 ? 1 : WEAR_PER_CATCH` line.

The builder then runs `npm test`, shoot.py (`errors: []`) and `node tests/coop-e2e.mjs`. Test 4 already fails on the base, so ignore it.
