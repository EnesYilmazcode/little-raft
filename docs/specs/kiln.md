# Spec: Seaside Kiln (metal bars, glass, bricks)

Source: docs/features/smelter-research.md. Cozy rules: nothing burns, spoils or is lost. An idle kiln never uses wood.
New files: `dist/kiln-core.js` (pure), `dist/kiln.js` (content module), `dist/kiln-model.js` (THREE), `tests/kiln.test.mjs`.
Edits: dist/content.js (import + FEATURES), dist/content-items.js, dist/icons.svg, dist/survival-ui.js (SPRITES), one line in dist/game.js (§9). No `?build=` on imports.

## 1. Items (append to CONTENT_ITEMS in dist/content-items.js)
Via the file's `item(kind, name, icon, placeholder)` helper (maxStack 20, not tools): `kiln` / Seaside Kiln / `icon-kiln` / false · `ingot` / Metal Bar / `icon-ingot` / false · `glass` / Glass Pane / `icon-glass` / false ·
`brick` / Fired Brick / `icon-brick` / false · `glasslamp` / Glass Lantern / `icon-lantern` / true · `sinker` / Line Sinker / `icon-ingot` / true.
Id check: none of these exist in ITEM_INFO, RECIPES, DECOR_TYPES or the islands/diving tables. The diving block in inventory-state.js spreads
after CONTENT_ITEMS and would override a duplicate, but none collide. The other designers must not reuse these six ids. No generic ids such as `lamp`.

## 2. Recipes (append to CONTENT_RECIPES)
| id | output | cost | built with |
|---|---|---|---|
| `kiln` | kiln ×1 | stone 4, clay 4, scrap 1 | `recipe()` helper |
| `glasslamp` | glasslamp ×1 | glass 2, ingot 1, wood 1 | `recipe()` |
| `sinker` | sinker ×1 | ingot 1, stone 1 | `recipe()` |
| `glasscups` | **cup ×3** | glass 1 | hand-written: `Object.freeze({id:'glasscups', name:'Glass Cups', output:Object.freeze({kind:'cup', count:3}), cost:Object.freeze({glass:1})})` |
| `brickplanter` | **palm ×2** | brick 3, leaf 2 | hand-written, `name:'Brick Planters'`, `output:{kind:'palm', count:2}` |

Stone is 4, not the note's 6: an island has 1-4 rocks with 3 uses each, so 4 + 1 studied nearly always fits the first island (docks at 90 s for 180 s).
Smelting is **not** in RECIPES (the kiln does it), so it is never gated, and metalore and sand never need studying.

**Gating decision: the kiln stays research-gated. Do NOT add it to STARTER.** Verified in storage-research.js: `lockedRecipes` and
`researchableKinds` derive from RECIPES. Stone and clay are in no recipe today, so this recipe is what makes them studyable.
Fresh-player path: craft the Research Table (STARTER, wood 6 + scrap 2) → scrap from debris or seafloor → clay from diving (25 % of nodes, open
from the start) → stone from island rocks (first island at 90 s) → study stone, clay, scrap. That unlocks the kiln in about 5 minutes.
It is easy to find: the craft list already shows a locked "Seaside Kiln" row reading "Study Stone + Clay" (storage-research-ui.js annotate()), and the
table labels stone and clay "Unlocks Seaside Kiln". The gate guides rather than hides, and keeps the progression the table already teaches.
Advanced recipes unlock by studying outputs: glass → glasscups; brick + leaf → brickplanter; ingot + stone → sinker; glass + ingot + wood → glasslamp.
Old saves: legacy worlds recompute `ingredientKinds()` and get everything; saves with a storage slice must study stone and clay; an old host's guest has `st.all`.

## 3. Decor and placement
Append `'kiln', 'glasslamp'` to `CONTENT_DECOR` and add `kiln: .45, glasslamp: .12` to `CONTENT_BLOCK_RADIUS`. game.js spreads both, so placement,
the ghost, the build action (one decor per tile, no grill tile) and saving work unchanged. `createCraft(T,'kiln'|'glasslamp')` returns null, so
rebuildRaft falls back to `content.decorModel(type)`; the engine sets the position (tile×2, y .22). game.js never removes decor; entries left
without a kiln (for example after another world loads) are pruned (§5).

## 4. Pure core: dist/kiln-core.js (no imports, DOM, THREE, Date or Math.random)
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
**Entry fields:** `r` input kind or null; `q` queued batches 0..6, counting the current one; `t` seconds into the current batch; `h` 1 when the
current batch is paid for and burning; `f` fuel in batch charges (integer 0..8); `o` tray kind or null; `n` tray count 0..10.
**step:** clamp dt to 0..MAX_DT (NaN → 0). If `q>0 && h===0 && f>0`, then `f--, h=1` (the only place fuel is spent). If `h===1`, add dt to `t`;
when `t >= secs`, set `t=0, h=0, q--, o=out, n++` (plus `r=null` when q hits 0) and return 1. With `q>0` and `f===0` it pauses, keeping t and h.
**cleanEntry**, in order: non-object → null. `r` must be in INPUTS (else null); `q` integer 0..6 (else 0); if `q===0` or `r===null`, set
`q=0, r=null, t=0, h=0`. `h` is 1 only when `raw.h===1` and `q>0`; `t` finite, clamped to 0..secs, and 0 when `h===0`. `f` integer 0..8 (else 0).
`o` must be in OUTPUTS and `n` an integer 0..10; if either is missing or zero, `o=null, n=0`. If `q>0` and `o` differs from `SMELT[r].out`, set
`q=0` (corrupt data; keep the tray). Then `q = min(q, TRAY-n)`. If q, f and n are all 0, return null.
**cleanSlice:** keys match `/^(-?\d{1,2}),(-?\d{1,2})$/` with |x|, |z| ≤ 25; at most MAX_KILNS entries; `r` integer ≥ 0 (else 0). Never throws.
**applyKilnAction:** `a = {kind, x, z, item?}`; `env = {decorAt(x,z), pos(actor)}` (same contract as applyStorageAction). Common checks in order:
`bad` (unknown kind, x/z not an integer within ±25, bag not 28 slots) → `missing` (`decorAt !== 'kiln'`) → `reach` (`hypot(p.x-x*2, p.z-z*2) > REACH`).
- **load** (`item` in INPUTS): `nothing` if the bag has fewer than `need` (text "Need N more metal ore"); `kind` if firing a different input or the
  tray holds another output; `full` if `q===QUEUE` or `q+n+1 > TRAY`. On success remove `need` on a scratch `new bag.constructor(bag.snapshot())`,
  commit its slots into bag.slots, then `q++, r=item`.
- **fuel:** `nowood` if `bag.count('wood') < 1`; `fuelfull` if it does not fit. Success removes 1 wood (selected slot first), `f += PER_WOOD`.
- **take:** `empty` if `n===0`; `bagfull` if nothing fits. Success: `scratch.add(o, n)`, move `n - leftover` (a partial take leaves the rest in the tray).

Everything is checked before anything changes; a refusal changes nothing; every success does `st.r++`.
TEXT: reach 'Step a little closer' · missing 'That spot has no kiln' · kind 'The kiln is busy with something else. Collect or wait first' ·
full 'The kiln is full' · nowood 'You need wood for the fire' · fuelfull 'The firebox is full' · empty 'Nothing ready yet' · bagfull 'Your bag is full'.
Success: load `Loaded ${need} ${name} · ${q} in the kiln` · fuel `Fire stoked · ${f} batches of fuel` · take `+ ${n} ${name}`.

## 5. Module: dist/kiln.js, `createKiln(ctx)`, name `'kiln'`
Add `import { createKiln } from './kiln.js';`, append `createKiln` to the end of FEATURES. **State:** `st = {k:{}, r:0}`. `decorAt` and `posOf` copied from storage-research.js (a guest's position is `ctx.other`).
**serialize()** returns a cached `sliceOf(st)`, rebuilt only when `st.r` changes. Host update bumps `st.r` when a batch starts or finishes, or when a
burning kiln's `Math.round(t*10)` changes: at most 10 per second, against hostState's ~8 snapshots per second.
**load(data, from):** `'net'` returns early if `data?.r === netR`, else `st = cleanSlice(data)` (no pruning; decor may arrive in the same message)
and `dirty = true`. `'save'`/`'restore'`: `st = cleanSlice(data, decorAt)`. `undefined` gives `{k:{}, r:0}`.
**action(a, actor, bag):** false unless `a.kind` starts with `'kiln.'`; otherwise run applyKilnAction and return true. Emit to the actor
`{kind:'loot'}` for take, `{kind:'build'}` for load and fuel, and `{kind:r.reason==='bagfull'?'full':'notice', text}` for refusals.
**update(dt)**, allocation-free (for..in, preallocated arrays, no closures in the loop). Host only (`ctx.role !== 'guest'`): `stepAll(st, dt, onDone)`;
onDone emits `{kind:'loot', text:'The kiln is done: N Glass Pane ready'}` to 'all'; once a second, prune keys whose `decorAt !== 'kiln'`. Then visuals (§6).
**interact(aim):** `target(aim)` copies the storage ray test filtered to `'kiln'` (REACH 3.2, offset ≤ .85, centre raft y + .5); no target → false.
With a target, read `sel` (kind in the selected `ctx.localBag()` slot): input → `ctx.action({kind:'kiln.load', x, z, item:sel})`; wood →
`ctx.action({kind:'kiln.fuel', x, z})`; else tray n > 0 → `ctx.action({kind:'kiln.take', x, z})`; else
`ctx.notice('Hold metal ore, sand or clay to load the kiln')`. Return true in all these cases. A guest never mutates st locally.
**prompt(aim):** null without a target, else `<kbd>E</kbd>` + verb + ` · ` + status. Verb by priority: `Load 2 metal ore` / `Load 2 sand` /
`Load 1 clay`, `Add wood`, `Take 3 Glass Pane`, `Seaside Kiln`. Status joins `Glass Pane 2 queued 45%`, `fuel 3` (or `needs wood` when paused) and
`1 ready` with ` · `. Escape with `ctx.esc`; cache by (key, st.r, sel, pct).
**decorModel(type):** 'kiln' → `model ??= buildKiln(T)`, `dirty = true`, return `model.instance()`. 'glasslamp' → `lamp ??= buildGlassLamp(T)`,
`lamp.instance()`. Otherwise null.
**debug** (`raftDebug.content.kiln`; mutating helpers are host only and return false for a guest): `state()` (slice JSON + `burning:[keys]`),
`spawn(x=0, z=0)` (kiln decor on a free existing tile + `rebuildRaft()`), `give(kind, n=10)` (local bag), `fill(x, z, entry)` (via cleanEntry),
`finish(x, z)` (whole queue to the tray, no fuel, bump r), `run(sec)` (`sec` 1-s steps on every kiln), `clear()`. Unlock recipes with
`raftDebug.content.storage.unlockAll()`. **dispose()** calls `model?.dispose()` and `lamp?.dispose()`.

## 6. Model: dist/kiln-model.js
`buildKiln(T)` returns `{instance(), flicker(time), dispose()}`, with geometry and materials built once and shared (as storage-research-model.js).
Origin at the tile-top centre, footprint ~.9×.9, height ~1.2, facing +z. **6 meshes, at most 4 visible; only the body casts a shadow.**
1. `kilnBody`: one merged vertex-coloured MeshStandardMaterial geometry (roughness .9): stone plinth box .9×.16×.9 (#8d8a82, jittered), clay drum
   cylinder r .4 h .34 (#b8653d), dome hemisphere r .4 y-scale 1.05 (#c9774a), dark mouth box .26×.24×.06 at the front (#2a1a12), back chimney
   r .065 h .38 (#7f4127), 3 logs at the side (#906f48), front-right tray plank .32×.03×.2 (#a97d4c).
2. `kilnGlow`: a plane in the mouth + an ember box; color #ff8a3d, emissive #ff6a1a, intensity 1.8. Visible only while burning.
3. `kilnFlame`: 2 crossed planes .14×.22, MeshBasicMaterial #ffc46a, additive, depthWrite false. Visible only while burning.
4. Tray (only the one matching `o`, only when n > 0): `trayIngot` box .15×.04×.06 #9aa6ad metalness .6; `trayGlass` box .16×.11×.012 #bfe8e4
   opacity .5; `trayBrick` box .15×.05×.07 #b5532f.

`instance()` returns a Group named `'kiln_station'` of new Meshes sharing geometry and materials, with
`userData.kiln = {glow, flame, tray:{ingot, glass, brick}}`. `flicker(time)` touches only shared materials: glow intensity
`1.6+.35*sin(time*9)+.2*sin(time*23)`, flame opacity `.75+.2*sin(time*13)`.
**Visuals in update:** rescan when `dirty` or `ctx.raft.children.length` changed, filling a preallocated array (≤100) with kiln_station groups and
keys `keyOf(round(x/2), round(z/2))` (a scan may allocate). Apply when `st.r !== shownR` or after a rescan: glow and flame `visible = burning(e)`,
pick the tray mesh. Per frame, only while a kiln burns: `model.flicker(clock)` and per instance `flame.scale.y = 1+.15*sin(clock*11+i)`.
`buildGlassLamp(T)`: instance is a Group named **`'craft_lantern'`**, so daynight.js:381 lights it and adds it to the light pool with no daynight
edit. 3 meshes: merged iron post (r .05, h 1.6, #4a4f52) with bracket and cap; `lanternGlass` box .2×.28×.2 at (.3, 1.3, 0), #dff4f0, opacity .3,
emissive #ffd08a, intensity **.9** (wood lantern .6); `lanternGlow` sphere r .07 at (.3, 1.29, 0), emissive #ffb050, intensity **2.2** (wood lantern 1.6).
Clone the 2 emissive materials **per instance**, because daynight records and scales base emissive per material.

## 7. Icons
Add 4 original `<symbol viewBox="0 0 48 48">` symbols to icons.svg in the house style (stroke #153e49 2px; palette #ffbd66 #54a6a4 #bb8650 #fff2cc):
`icon-kiln` (domed kiln, orange mouth, chimney), `icon-ingot` (trapezoid bar with highlight), `icon-glass` (teal pane, 2 shine strokes),
`icon-brick` (terracotta brick with a mortar line). Append `'kiln', 'ingot', 'glass', 'brick'` to `SPRITES` in survival-ui.js (SPRITE_FOR unchanged).

## 8. Co-op and backward compatibility
- **Host authority:** only the host steps timers and applies `kiln.*`; guests send `ctx.action` and render the received slice.
- **Items** go to the acting player's `bag`, so whoever collects gets them.
- **Simultaneous E presses** are validated in order: the second take gets `empty`, the second load is checked against QUEUE and TRAY. No duplication.
- **Old saves** have no `ext.kiln`, so `load(undefined)` gives no kilns; garbage is cleaned (§4). **Old builds** ignore `ext.kiln` and reject bags
  with the new kinds (content-items.js header). **Visits:** `restoreOwnRaft` reloads the guest's own slice with `'restore'`.

## 9. The single game.js edit (the sinker)
In `wearHook` (game.js:726), replace `    s.durability = Math.max(0, before - WEAR_PER_CATCH);` with (toast texts unchanged):
`    s.durability = Math.max(0, before - (bag.count('sinker') > 0 ? 1 : WEAR_PER_CATCH)); // kiln: a Line Sinker in the bag halves hook wear`

## 10. Tests: tests/kiln.test.mjs (node:test, real Bag from inventory-state.js)
1. Recipes: all five new ids are in RECIPES; glasscups gives cup×3, brickplanter palm×2; kiln is not in STARTER.
2. Research path: for an empty state `researchableKinds` includes stone and clay; `learnedFrom(['stone','clay','scrap'])` includes kiln;
   glass unlocks glasscups; brick + leaf unlocks brickplanter.
3. cleanEntry/cleanSlice: garbage, NaN and out-of-range rejected; bad keys and keys beyond ±25 dropped; idle empty → null; tray/queue mismatch
   drops the queue; `q+n` capped at TRAY; decorAt prunes; MAX_KILNS holds; `cleanSlice(undefined)` → `{k:{}, r:0}`.
4. step: fuel spent only when a batch starts; an idle kiln keeps its fuel; no fuel pauses and keeps t; dt 1e6 adds at most 1 s; NaN does
   nothing; glass done after 12 one-second steps; r resets when q hits 0.
5. load: atomic bag change; too few → `nothing`, unchanged; different input or other tray kind → `kind`; QUEUE and TRAY limits → `full`.
6. fuel: +2 charges per wood; cap 8 (`fuelfull` leaves the bag untouched); no wood → `nowood`.
7. take: full take; a partial take into a nearly full bag leaves the rest in the tray; full bag → `bagfull`, unchanged.
8. Guards: `missing`; `reach` from 10 m; `bad` kind, coordinates and bag; every success bumps r.
9. sliceOf rounds t to 0.1, omits idle entries, and survives a JSON round trip through cleanSlice.
10. Module with a fake ctx (as storage-research.test.mjs, T present): `load(undefined)` → empty; `load(d,'net')` with the same r is a no-op; guest
    update never steps, host update steps and emits to 'all'; `storage.*` actions return false; `debug.finish` fills the tray; `decorModel('kiln')`
    is a kiln_station with ≤6 meshes; `decorModel('glasslamp')` is a craft_lantern with a lanternGlow mesh; `decorModel('crate')` is null.
11. Sinker: a grep of game.js finds `bag.count('sinker') > 0 ? 1 : WEAR_PER_CATCH`. Then run `npm test`, shoot.py, `node tests/coop-e2e.mjs`.
