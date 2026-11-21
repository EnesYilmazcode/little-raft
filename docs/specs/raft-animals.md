# Spec: raft animals v1 (the Puffhen)

Source: docs/features/raft-animals-research.md. v1 has the Puffhen only (no Mossling, no hatching). Cozy rules: animals never get hungry, never leave and never die.
Feeding only speeds them up. One builder. Files: `dist/animals-core.js` (pure), `dist/animals.js` (module), `dist/animals-models.js` (THREE geometry),
`dist/animals-ui.js` (rename dialog), `tests/animals.test.mjs`. Content imports have no `?build=` suffix, like their neighbours in dist/content.js.

## 1. Ids (checked against parallel features)
New kinds: `puffegg`, `feather`, `nestbox`, `cushion`. New recipes: `nestbox`, `cushion`, `egglamp`. Icons: `icon-egg`, `icon-feather`, `icon-nest`, `icon-cushion`.
None of these clash with smelter (`kiln`, `glass`, `ingot`, `brick`, `glasslamp`, `sinker`), the decor pack (`rug`/mat, `pennant`, `fern`, `chime`, `hammock`, `pots`, `sign`)
or round 1 (`cup`, `saltcup`, `freshcup`, `purifier`, `receiver`, `antenna`, `bottle`). Ext key and module name: `animals`. Action prefix: `animals.`.

## 2. Items, recipes, decor (dist/content-items.js, append only)
- `CONTENT_ITEMS`: `puffegg: item('puffegg','Puff Egg','icon-egg',false)`, `feather: item('feather','Puff Feather','icon-feather',false)`,
  `nestbox: item('nestbox','Nest Box','icon-nest',false)`, `cushion: item('cushion','Feather Cushion','icon-cushion',false)`.
- `CONTENT_RECIPES`: `nestbox: recipe('nestbox','Nest Box',1,{wood:3, leaf:2, rope:1})`, `cushion: recipe('cushion','Feather Cushion',1,{feather:3, leaf:2})`, and one
  hand-frozen recipe, because `recipe()` sets kind = id and the egg recipe outputs an existing kind:
  `egglamp: Object.freeze({id:'egglamp', name:'Egg Lantern', output:Object.freeze({kind:'lantern', count:1}), cost:Object.freeze({puffegg:1, wood:2})})`.
  Egg Lantern is the egg sink. It is a lantern with no scrap (the normal lantern is wood 2 + scrap 2), it uses `Bag.craft` as is (`dist/inventory-state.js:356`
  grants `output.kind`), and the survival UI already reads `r.output.kind` (`dist/survival-ui.js:100-111`). Hatching is deferred: it would need a chick growth stage and a second spawn path.
  Builder check: `grep -n "RECIPES\[" dist/*.js`. Nothing may assume `ITEM_INFO[recipeId]` exists. storage-research `nameOf` falls back to `RECIPES[k].name`, which is fine.
- `CONTENT_DECOR`: append `'nestbox','cushion'`. `CONTENT_BLOCK_RADIUS`: `nestbox:.35, cushion:.3`. Placement, ghost, build and save then work with no game.js change.
- Icons (original art, `<symbol viewBox="0 0 48 48">` in dist/icons.svg): a cream egg with a speckle (`icon-egg`), a curved quill feather (`icon-feather`), a woven box with straw
  on top (`icon-nest`) and a plump square pillow with a tuft (`icon-cushion`). Add `'egg','feather','nest','cushion'` to `SPRITES`. In `SPRITE_FOR` add
  `puffegg:'egg', feather:'feather', nestbox:'nest', cushion:'cushion'`. Check that `normalise` maps those keys and add entries only if it does not.

## 3. Research gating
`STARTER` (`dist/storage-research.js:11`) is a frozen list. Append `'nestbox'` to it in one edit, so a brand-new player can craft a box without a Research Table.
Without this the box would need wood, leaf and rope studied first, which is reachable but hides the feature.
`cushion` unlocks once `feather` is studied (leaf is usually already seen), and `egglamp` once `puffegg` is studied (with wood). This needs no code: `learnedFrom` does it.
Legacy progressed worlds learn every recipe (`storage-research.js:121`), which includes these. The storage-research tests read `STARTER` symbolically, so they stay green.

## 4. Pure core: dist/animals-core.js (no DOM, no THREE, no imports, no Math.random or Date unless an rng is passed in)
```js
export const MAX_ANIMALS = 4, BEAT = 7, HOME_EVERY = 8, RANGE = 3, HOP_T = 1.8, HOP_START = .4, JITTER = .5, TILE = 2;
export const EGG_BASE = 240, EGG_CONTENT = 80, HEART_CUT = .03, MAX_HEARTS = 10, EGG_CAP = 3, FEATHER_CAP = 3, FEATHER_CHANCE = .35;
export const CONTENT_ADD = 180, CONTENT_MAX = 360, FULL_AT = 300, BOND_CD = 60, PET_FEATHER_CD = 120, PET_FEATHER_HEARTS = 5;
export const LURE_MIN = 20, LURE_MAX = 40, LURE_COST = [['seed',1],['leaf',3]], NAME_MAX = 14, REACH = 3.2;
export const NAMES = Object.freeze(['Biscuit','Dumpling','Pip','Marlo','Sprout','Tuffet','Nib','Clover','Bun','Pebble','Waffle','Moppet']);
export function rnd(seed, n)                  // nth output of mulberry32(seed). Copy mb()/rnd() from dist/wildlife.js:17-23 so the core stays import-free.
export function cleanName(v)                  // -> string or '' (invalid)
export function cleanAnimals(v, decor)        // -> state (section 7). decor may be null (skip home pruning)
export function buildGraph(tiles, decor, pieces, hasGrill)  // -> graph
export function homeDist(graph, homeIdx, out) // BFS from home through free cells only. Int8Array, -1 = unreachable or > RANGE
export function plan(seed, beat, graph, dist, homeIdx, out) // fills out, no allocations
export function pose(out, graph, seed, beat, u, p)          // p.{x,z,yaw,hop,moving} at u seconds into the beat (raft-local metres)
export function eggPeriod(a)                  // (a.content > 0 ? EGG_CONTENT : EGG_BASE) * (1 - HEART_CUT * a.hearts)
export function tick(state, dt, rng)          // host. dt clamped to 0..60. -> {laid:[ids], arrived:[ids]}
export function feed(state, id, food, bag, t), pet(state, id, t), collect(state, x, z, bag), lure(state, x, z, bag, t, rng), rename(state, id, name)
```
**Graph.** The nodes are the unique `world.tiles` cells that either have no decor or hold a `nestbox`. A cell is not a node if `hasGrill(x,z)` is true or it has a
level-0 `stairs` piece. Nodes are sorted by (x, z) and are each marked `free` or `box`. `nb` is an Int16Array(n*4), filled with -1, in the fixed direction order
`+x, -x, +z, -z`. Two cells are linked when both are nodes and no level-0 `wall`/`halfwall`/`window` edge piece separates them (a `door` lets birds through).
Edge `{i,j,l:0}` with `r:0` lies between (i,j) and (i,j-1), and with `r:1` between (i,j) and (i-1,j) (`building-pieces.js:3`). Build a `Set` of edge keys once per build.
`graph = {n, x:Int16Array, z:Int16Array, box:Uint8Array, nb, index:Map("x,z"->i)}`.
**dist.** BFS from `homeIdx`, expanding only into `free` nodes, and only up to depth RANGE. A bird therefore never walks through another nest box and stays within 3 cells of home.
**plan(seed, beat, ...).** The bird's cell at the start of beat `b` is found by replaying from `b0 = b - b % HOME_EVERY`, starting at home, through beats b0..b-1.
That is at most 7 replays and needs no stored state. Every 8th beat starts at home, so a late joiner or a changed graph converges.
For one beat `k` from cell `c`, with `r(j) = rnd(seed, k*8 + j)`:
- If `k % HOME_EVERY === HOME_EVERY - 1`, it is a **home** beat. Follow the BFS gradient (the first neighbour in nb order whose dist is `d-1`) until you reach home. That is at most 3 hops.
- Else, if `r(0) < .35`, it is an **idle** beat with 0 hops. The idle pose is `floor(r(1)*3)`: 0 peck, 1 preen, 2 look around.
- Otherwise it is a **hop** beat with `1 + floor(r(2)*3)` hops. Hop h goes to the neighbour `nb[c*4 + floor(r(3+h)*4) % 4]`. If that is -1, not free, or its dist is -1, try
  the next three directions in order. If none fits, the beat stops there (short beat).
`out = {kind, idle, n, cells:Int16Array(4), yaw0}`. `cells[0]` is the start cell. `yaw0 = r(7)*2π` is used while idle.
**pose.** Each cell has a point: free cells use the centre `TILE*x, TILE*z` plus a jitter `(rnd(seed, k*8+4+h)-.5)*2*JITTER` per axis (seeded by beat and hop).
The home cell point is the exact box centre. Hop h runs from `HOP_START + h*HOP_T` to `+HOP_T`. Inside it, smoothstep moves the bird from point h to point h+1,
and `p.hop = |sin(π*3*f)|` (three small hops per cell). The yaw faces the travel direction, otherwise the last yaw (or `yaw0` on an idle beat). `p.moving` says whether a hop is in progress.

**Production (`tick`, host only).** For each animal: `content = max(0, content - dt)`. While `eggs < EGG_CAP`, `prod += dt`, and when `prod >= eggPeriod(a)` it lays:
`eggs++`, `prod = 0`, and if `rng() < FEATHER_CHANCE` then `feather = min(FEATHER_CAP, feather+1)`. While the box is full, `prod` holds at the period, so
emptying a full box lays again at once. For each lure with `t >= at` (and fewer than MAX_ANIMALS animals) it spawns
`{id:'p'+state.next++, kind:'puffhen', name:NAMES[floor(rng()*12)], seed:floor(rng()*2**32)>>>0, home, born:t, hearts:0, content:0, prod:0, eggs:0, feather:0, bondAt:-1e9, featherAt:-1e9}`
and removes the lure. `rng` is called a fixed number of times per event, so seeded tests are exact.
**Actions** return `{ok:true, text, kind:'loot'|'build'|'notice'}` or `{ok:false, reason, text}`. A failed action changes nothing. Bag gains use scratch-then-commit,
as in the purifier spec (`new bag.constructor(bag.snapshot())`).
- `lure`: the tile must be a `nestbox` with no resident and no lure there, and animals plus lures must be fewer than 4. It takes `seed`×1, or else `leaf`×3, and sets `at = t + LURE_MIN + rng()*(LURE_MAX-LURE_MIN)`.
  Reasons: `notarget|busy|cap|nofood`. Fresh players have leaves, so the feature works before the first island.
- `feed(food)`: food is `'seed'` or `'leaf'`, and the bag must have one. It refuses `full` when `content >= FULL_AT`. Otherwise `content = min(CONTENT_MAX, content + CONTENT_ADD)`, and it adds a heart if `t - bondAt >= BOND_CD`.
- `pet`: if `t - bondAt >= BOND_CD`, then `hearts = min(10, hearts+1)` and `bondAt = t`. If also `hearts >= 5 && t - featherAt >= 120`, then `feather = min(cap, feather+1)` and `featherAt = t`. A pet always returns ok (a pet during the cooldown gives no heart).
- `collect`: moves eggs, then feathers, into the bag. Anything that does not fit stays in the box (reason `full` if nothing moved).
- `rename`: `cleanName` must be non-empty (otherwise reason `badname`).
**cleanName.** `String(v).normalize('NFC')`. Strip `\p{Cc}\p{Cf}`, collapse whitespace to one space, trim, then cap to 14 code points with `Array.from`. Render it only through `esc`.

## 5. Module: dist/animals.js, `createAnimals(ctx)` appended to FEATURES (dist/content.js)
- **Clock.** `st.t` is the animal clock in seconds and is saved. On the host, `update(dt)` does `st.t += dt` only while `ctx.running`, then calls `tick(st, dt, Math.random)` once per
  frame. A guest advances its local `clock += dt`, and on each `load(d,'net')` it snaps `clock = d.t` when `|d.t - clock| > 2`, as wildlife does (`wildlife.js:340-345`). For each animal,
  `beat = floor((clock - born)/BEAT)` and `u = (clock - born) % BEAT`. When `beat` changes, run `plan()` into that animal's preallocated `out`. No positions are ever sent.
- **Graph refresh.** Rebuild graph and dist when the refs or lengths of `world.tiles`, `world.decor` or `world.pieces` change (the `refreshPerches` pattern, `wildlife.js:235-240`),
  and also every 2 s when a grill signature changes. That signature is the sum over tiles of `hasGrill(x,z) ? (x*73856093 ^ z*19349663) : 0`, a number with no allocation.
  After a rebuild, re-plan every animal. A bird whose home is not in the graph sits still at the box position.
- **hasGrill (the one game.js edit).** In `contentCtx` (`dist/game.js:334`), change the anchor `uiOpen: () => uiBlocked(),` to
  `uiOpen: () => uiBlocked(), hasGrill: (x, z) => !!fc?.hasGrill(x, z),`. In the module, call it as `ctx.hasGrill?.(x, z) ?? false`. On guests, fc shows the host's broadcast grills.
- **Render** (raft frame → world): `v.set(px, FLOOR_Y + .08*p.hop (+.18 on the home cell), pz).applyMatrix4(raft.matrixWorld)`, and the quaternion is raft.quaternion × yawY.
  Squash: while `p.moving`, `sy = 1 - .12*cos(2π*3f)` and `sxz = 1/sqrt(sy)`. While idle, a peck is a pitch nod `sin(t*9)*.35` at 0.6 s every ~2.3 s (`rnd` phase).
  A local squish after E is `sy = 1 - .25*e^(-8s)`. An arrival is a 2 s descent from y+6 with a wing-flutter scale wobble.
  Store the last world positions in a Float32Array(12) for picking. All scratch Vector3, Quaternion and Matrix4 objects are module-level. Hide unused instances with a zero matrix.
- **Eggs in the box:** an instanced mesh of 12 instances (3 per box). Each one sits at the box tile plus a fixed slot offset, shown while `i < eggs`. Use the same raft transform.
- **Floating heart:** one small mesh (count 1, reused). It rises 0.6 m and fades over 1.2 s above the bird that was just petted or fed. Local only.
- **interact(aim) / prompt(aim):** an analytic ray test (pattern `islands.js:255`) against bird spheres (r .24, centre at +.18 m) and nest-box spheres (r .4 at deck +.3) within REACH. The nearest hit wins.
  - Bird, with seed or leaf selected (`localBag().selected?.kind`): `animals.feed {id, food}` · prompt `<kbd>E</kbd>Feed ${esc(name)} (Palm Seed)`. When content ≥ 300: `${name} is full and happy`.
  - Bird, otherwise: `animals.pet {id}` · prompt `<kbd>E</kbd>Pet ${esc(name)} ♥ ${hearts}`. Add ` · content` while content > 0.
  - Box with eggs or feathers: `animals.collect {x,z}` · prompt `<kbd>E</kbd>Collect 2 eggs, 1 feather`.
  - Box with no resident or lure: `animals.lure {x,z}` · prompt `<kbd>E</kbd>Scatter seeds to lure a Puffhen` (or `(3 leaves)`). With no food: `Nest Box · needs 1 Palm Seed or 3 Leaves`. At the cap: `Nest Box · the raft has 4 Puffhens`.
  - Box with a lure pending: `Nest Box · a Puffhen is on its way…` (consumes E).
  - Box with a resident and nothing waiting: it opens the rename dialog · prompt `<kbd>E</kbd>Rename ${esc(name)}`.
  - E plays the squish and heart at once, locally. The guest waits on `guestWaiting`-like readiness: if `ctx.role==='guest'` and no host state has arrived yet, it shows a notice and does nothing.
- **action(a, actor, bag):** the prefix guard `a.kind.slice(0,8) !== 'animals.'` → return false. A guest returns true without changes (authority is on the host).
  The host validates types (finite ints for x/z, a string id ≤ 8, food in the set, name ≤ 64 raw chars). Reach: the actor pose (`actor==='guest' ? ctx.other : ctx.physics`) must be within
  `REACH + 1.5` m of the host-computed bird position or box centre. Then it calls the core function, `bump()`s the revision on success, and emits as in section 6.
- **serialize():** host only (a guest returns undefined). It returns a cached object `{v:1, r, t, next, list, lures}`, rebuilt only when `r` changes or 5 s have passed
  (timers are rounded to whole seconds). `t` is written in place on every call, rounded to 0.1. **load(d, from):** `'save'`/`'restore'` → `st = cleanAnimals(d, ctx.world.decor)`.
  `'net'`: if `d.r === lastR`, only the clock snap. Otherwise `cleanAnimals(d, null)` and re-plan. It never builds geometry (the instanced meshes are built once).
- **decorModel(type):** `'nestbox'` → `nestBoxModel(T)` and `'cushion'` → `cushionModel(T)` (from animals-models.js). Otherwise null.
- **dispose():** remove the group and dispose the geometry, materials and dialog.

## 6. Effects, toasts, sound
Host emits, sent to the actor unless noted: lure ok `{kind:'build', text:'You scatter seeds… listen for a chirp'}`. Arrival goes to `'all'`: `{kind:'build', text:'A Puffhen settled in! Say hi to ${name}'}`
(plain text: `updateContext` already runs `esc(noticeText)`, `game.js:487`, so toasts must not pre-escape). Feed ok `{kind:'loot', text:'${name} gobbles it up · content'}`. Pet with a heart:
`{kind:'notice', text:'${name} ♥ ${h}'}`, and a pet during the cooldown sends no toast. A pet feather adds ` · a feather drifts into the nest`. Collect `{kind:'loot', text:'+2 Puff Egg, +1 Puff Feather'}`.
Full `{kind:'full', text:'Your bag is full'}`. Rename `{kind:'notice', text:'Renamed to ${name}'}`. Failures use kind `notice` with the reason text. A lay sends no toast (the egg simply appears).
Sound: `effect()` already beeps for each kind. There is no new audio event in v1.

## 7. Save and backward compatibility
`world.ext.animals = {v:1, r, t, next, list:[{id, kind:'puffhen', name, seed, home:[x,z], born, hearts, content, prod, eggs, feather, bondAt, featherAt}], lures:[{home:[x,z], at}]}`.
- `cleanAnimals`: a non-object → `{v:1, r:0, t:0, next:1, list:[], lures:[]}`, so `load(undefined)` for old saves works. Each entry needs `kind==='puffhen'`, an id matching `/^p\d{1,6}$/`,
  a seed that is a uint32 (otherwise derived from the id), and `home` as two ints. The name is cleaned (empty → a NAMES entry picked by the seed). Clamp `t` to 0..1e9,
  `born ≤ t`, `hearts` int 0..10, `content` 0..360, `prod` 0..240, `eggs` 0..3, `feather` 0..3, and `bondAt`/`featherAt` ≤ t. Dedupe by id and by home, a lure on a
  resident's home is dropped, list plus lures are capped at 4, `at` is clamped to t..t+40, and `next` > the highest id number.
  With `decor` given, drop entries and lures whose home is not a `nestbox` in decor. The host re-runs this home pruning in `update` whenever the decor ref changes.
- New bag kinds make old builds reset a bag that holds them (`content-items.js:4`). This is the accepted risk earlier kinds took too. The new decor types are dropped by old builds' `cleanWorld`.

## 8. Co-op rules
Only the host mutates `st`. Guests render from the last host state plus their own clock and send `animals.lure|feed|pet|collect|name`. A guest's rename dialog closes right away, and the new
name arrives with the next state. The wander uses only the synced inputs `tiles`/`decor`/`pieces`/grills, the seed, `born` and the clock. While a guest visits, its own raft's animals are restored
through `'restore'`. Payload: at most 4 entries of about 110 bytes, sent only when changed in content (r), and the 8 Hz `hostState` cost stays small.

## 9. Models: dist/animals-models.js (wildlife-models style: copy `tri/part/merge/ball` from wildlife-models.js, one vertex-coloured Lambert material)
- `puffhenGeometry(T)`, origin at the feet, nose +z, about 0.35 m tall. It has a round cream-white body ball (0.17 × 0.15 × 0.17 at y .17), a warm-brown back cap,
  a head ball merged in front-top, two big dark eyes with white glints, a small orange cone beak, a 3-feather crest tuft (thin cones), stubby wing ovals on the sides,
  a fan tail and two orange stub feet. Merge it all into ONE geometry.
- Draw calls: puffhen InstancedMesh(4) + egg InstancedMesh(12, `eggGeometry`: a stretched cream ball with speckle colours) + heart Mesh(1, extruded or flat 2-ball+cone heart, unlit
  pink `MeshBasicMaterial` with transparent opacity) = **3**. The decor models are part of the raft rebuild and are not counted.
- `nestBoxModel(T)`: a 0.7 m woven crate (slatted box sides, a straw-ring rim, a small roof slant on one side), returned as a Group of 1–2 meshes. `cushionModel(T)`: a 0.6 m flat rounded pillow with 4 corner tufts and a centre button.

## 10. Rename dialog: dist/animals-ui.js (copy the storage-research-ui style, its own `<dialog id="lrAnimals">`)
It holds a heading `Name your Puffhen`, an `<input maxlength="14" autocomplete="off" spellcheck="false">` pre-filled through `.value` (never innerHTML), and Save and Cancel buttons.
`open(id, name)` calls `ctx.releaseLock()` and `showModal()`, then focuses and selects the input. The game's keydown listeners already skip input targets and `uiBlocked()` (`dialog[open]`).
In addition, `dlg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key==='Enter') { e.preventDefault(); save(); } })` and the same for `keyup`, so WASD, E, digits and Tab never leak.
`cancel` → close. On close: `ctx.requestLock?.()` if running. Save sends `ctx.action({kind:'animals.name', id, name: input.value})`. The text is never parsed as HTML.

## 11. Debug: `raftDebug.content.animals` (host only for mutators)
`spawn(x?,z?)`: places a `nestbox` decor on the given tile or the first free tile (`world.decor.push` + `ctx.rebuildRaft()`) and adds a resident at once. Returns the id.
`ff(sec)`: advances the clock and ticks in 1 s steps (max 3600). `arrive()`: sets every lure's `at = t`. `list()`: a deep copy of `st.list`. `plan(id)`: `{beat, kind, cells, pos:[x,y,z]}`.
`give()`: adds 3 puffegg and 3 feather to the local bag. `rename(id, name)` and `openRename(id)`. `graph()`: `{n, edges}`.

## 12. Tests: tests/animals.test.mjs (node:test)
1. cleanName: control, bidi, whitespace, 14 code points with emoji, non-string, empty → ''.
2. cleanAnimals: undefined → empty; junk entries dropped; clamps; dedupe by id and home; cap 4; home pruning against decor; `next` repaired.
3. buildGraph: decor cells excluded except nestbox; a wall blocks, a door passes, a halfwall and a window block; edge axis mapping for r:0 and r:1; level 1 pieces ignored; hasGrill and stairs excluded.
4. homeDist: depth ≤ 3; no path through another box.
5. plan: deterministic (same inputs → same out); every hop is a graph neighbour with dist ≠ -1; a home beat ends at home; beat b%8==0 starts at home; a cell with no neighbours → idle.
6. pose: continuous across hop boundaries; the position at u=0 of beat b+1 equals the end of beat b; no NaN.
7. tick: base 240 s egg, 80 s content, hearts cut the period by 3% each; egg cap 3 holds prod; a seeded rng gives an exact feather count; lure spawns at `at`; the cap is respected.
8. Actions: lure (seed first, then 3 leaf, nofood, busy, cap); feed (content add, full refuse, heart cooldown); pet (cooldown, feather at ≥5 hearts every 120 s); collect (partial when full); failures change nothing.
9. Recipes: `RECIPES.egglamp.output.kind === 'lantern'`; `nestbox` is in STARTER; `cushion`/`egglamp` unlock via learnedFrom with feather/puffegg seen.
10. The module with a stub ctx: guest `action` returns true without changes; serialize is cached by r; `load(undefined,'save')` is ok.
Also run: `npm test`, shoot.py (`errors: []`), and `node tests/coop-e2e.mjs` (ignore test 4). A Playwright pass: spawn via debug, `ff(300)`, collect eggs, craft Egg Lantern and Feather Cushion, and rename with "<b>x" (it shows literally).

## Implementation notes
Built as specified. Where the code forced or favoured a small change:
- **Jitter per axis.** The spec gives one seed index per hop (`k*8+4+h`) but a point needs two values. x uses `rnd(seed, k*8+4+h)` and z uses `rnd(seed ^ 0x5bd1e995, k*8+4+h)`.
- **Plan start point.** To keep `pose` continuous across beats, `plan` carries the landing point of the last hop through the replay. `out` also gets `beat`, `sx`, `sz` (the start point), and `pose` also returns `f` (hop fraction) and `lift` (0..1, 1 = on the box, used for the +.18 m).
- **Arrival.** During the 2 s descent the bird stays over its box. The wander starts once it lands.
- **cleanName.** Whitespace (including tab/newline, which are `Cc`) is turned into spaces before `\p{Cc}\p{Cf}` are stripped, so `"a\tb"` becomes `"a b"` and not `"ab"`. A non-string returns `''`.
- **Pet feather.** A pet feather is given only while `feather < FEATHER_CAP`, so a full nest does not use up the 120 s feather timer.
- **Clock.** On the host, `st.t` and `tick` advance only while `ctx.running` (the pause menu freezes the birds). Guests always advance their local clock.
- **serialize.** `born` is rounded to 0.1 s, like `t`, not to whole seconds, so a guest's wander stays in phase with the host. The other timers are rounded to whole seconds.
- **Reach.** The distance is measured on xz (`ctx.other.y` may be null). The lure/collect `notarget` check (the tile is a `nestbox`) lives in the module, because the core has no decor.
- **Idle frames.** With no animals, the module skips graph upkeep and rendering and hides the two instanced meshes. Without this, the co-op e2e "2b smooth motion" check got noticeably flakier under swiftshader.
- **Rename dialog.** It also stops `keypress`. The input sets `text-transform:none` because a global style uppercases inputs. Escape closes the dialog natively.
- **Extra debug helpers:** `lures()`, `state()`, `pick()` (current target and prompt), `closeRename()`, `clock`.
