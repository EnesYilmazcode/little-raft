# Spec: Companion Gull and Perch

Source: docs/features/companion-gull-research.md. Cozy rules: the gull never bites, never leaves for good and never needs feeding. Place a **Perch**, offer grilled fish
to the gull that visits it, and after a few treats it moves in. It rests, flies short loops, sometimes follows a player, brings small finds to a woven tray, and can be named and petted.
One gull per raft. One builder. New files: `dist/gull.js` (pure helpers at the top, `createGull(ctx)` below, bees layout), `dist/gull-models.js` (given THREE, imports nothing),
`tests/gull.test.mjs`. New imports carry `?build=v3-survival-ae77fa84ac2b`. Ext key, module name and action prefix: `gull` / `gull.`.

## 1. Item and recipe (dist/items.js)
| id | name | category | recipe | unlock |
|---|---|---|---|---|
| `perch` | Gull Perch | decor, `placeable:true`, `iconTint:'#c9a46a'` | `hand({wood:3, rope:2, leaf:1})` | `discover('cookedfish')` |
- Row after the candle row (`items.js:203-205`), tagged `// [gull]`. Tip: "A driftwood perch with a woven tray. Seagulls like a good lookout."
- `BLOCK_RADII` (`items.js:243`): add `perch: 0.2`. `PLACEABLE_IDS` → `DECOR_TYPES` picks it up, no game.js edit. Wild gulls never land on it: `perchesFrom` (`wildlife.js:69-86`) skips decor not in `PERCH_TOP`.
- craft-book.js: `perch: 'survival'` in the category map (`:23-28`); ITEM_TEXT (`:96-101`) `perch: {desc:'A tall perch with a woven tray.', use:'Offer grilled fish to a visiting gull; it may move in.'}`.
- item-svg.js (`:279+` block): original icon, a T-shaped post with a small basket tray and a gull silhouette on top.

## 2. State: `world.ext.gull` (host-authoritative)
```
{ v:1, r, t,              // revision (int), host gull clock in s (1 decimal)
  seed,                   // uint32, 0 until the host first loads (then Math.random in the module, never in helpers)
  pts:0..2, treatAt,      // befriend points before moving in; t of the last treat
  moved:bool, home:[x,z]|null, name:'',
  hearts:0..10, bondAt,   // t of the last heart gain (pet or treat after moving in)
  finds:['wood',..], fw, n, // tray (max 3 kinds from LOOT); fw = whole seconds of find work; n = finds made (rnd index)
  pops }                  // int, bumped on every pet/treat; drives the heart burst on every client
```
`cleanGull(v, decor)`: junk/array/undefined → defaults. Ints clamped, floats to 0.1, `name = cleanName(name)` (import from animals-core.js), finds filtered to LOOT kinds and cut to 3.
`home` is kept only if `decor` has a `perch` at that tile. If `moved && !home` and any perch exists, `home = firstPerch(decor)` (lowest x, then z). The tray survives a lost perch.
`target(st, decor)` = `home` if set, else `firstPerch(decor)` (the perch the visitor uses before moving in). Other perches say `Perch · the gull lives on another perch`.

## 3. Pure rules (top of dist/gull.js; no DOM, no THREE, no Date, no Math.random)
```js
export const VISIT = 90, ARRIVE = 20, DESCEND = 4, STAY = 42, LEAVE = 4, TREAT_CD = 15, BOND_CD = 60, MOVE_IN = 3, MAX_HEARTS = 10;
export const FIND_BASE = 240, FIND_CUT = .04, TRAY_MAX = 3, MAX_TICK = 60, BEAT = 10, BLEND = 1.5, REACH = 3.2, HOST_SLACK = 2;
export const TREATS = Object.freeze({cookedfish:1, honeyfish:2});          // honeyfish is the favourite: counts double
export const LOOT = Object.freeze([['wood',45], ['plastic',30], ['rope',15], ['seed',10]]);
export const OLD_HOST = 'Your friend’s raft doesn’t have a gull perch yet';
export function cleanGull(v, decor); export function firstPerch(decor); export function target(st, decor);
export function visitPhase(t)          // pre-move-in, p = t mod VISIT: 'away' [0,20), 'descend' [20,24), 'perched' [24,66), 'leave' [66,70), 'away' [70,90)
export function modeAt(seed, t)        // moved: beat = floor(t/BEAT), h = rnd(seed, beat): h<.6 'rest', h<.9 'loop', else 'follow'; beat 0 is always 'rest'
export function treat(st, food, bag)   // -> {ok, reason:'notreat'|'away'|'cooldown'|'nofood', moved?:bool, text}
export function pet(st)                // -> {ok, gained:bool, text}
export function tickGull(st, decor, dt)// dt floored, clamped 0..MAX_TICK, applied 1 s at a time -> {found:[kinds]}
export function collect(st, bag)       // -> {ok, kind:'loot', text, loot} | {ok:false, reason:'empty'|'full', text}
export function rename(st, name)       // -> {ok} ; '' after cleanName → {ok:false}
```
**Befriending.** Before moving in, a gull visits the target perch on the fixed schedule of `visitPhase` (only the host clock matters, so both clients agree).
`treat` needs `TREATS[food]`, the gull `perched` (host checks `visitPhase(t)` and `visitPhase(t - HOST_SLACK)`, so a lagging guest still lands it), `t - treatAt >= TREAT_CD`,
and `bag.remove(food,1)`. It adds the points; at `pts >= MOVE_IN` set `moved = true, pts = 0, home = target`, default name `GULL_NAMES[floor(rnd(seed,7)*8)]`
from `['Skipper','Gully','Squall','Salty','Wren','Captain','Puffin','Breeze']`. So 3 grilled fish, or honeyfish + 1 grilled fish. No vitals change; never call `consume()`.
After moving in, `treat` needs mode `rest` (same slack rule) and `t - bondAt >= BOND_CD`: hearts += points (cap 10), `bondAt = t`. On cooldown: `"<name> is full. Try again soon"`, nothing taken.
`pet`: mode `rest` (slack rule), always bumps `pops`; gains 1 heart only when `t - bondAt >= BOND_CD`. Every success bumps `r` and `pops`.
**Finds.** Only when `moved && home && finds.length < TRAY_MAX`: `fw += 1` per second; at `fw >= round(FIND_BASE * (1 - FIND_CUT * hearts))` (240 s, down to 144 s at 10 hearts)
push `pick(LOOT, rnd(seed, n))`, `n++`, `fw = 0`. A full tray stops the timer (fw stays 0). The host emits `{kind:'notice', text:'<name> brought you <FIND_TEXT[k]>'}` to `'all'`,
`FIND_TEXT = {wood:'some driftwood', plastic:'a scrap of plastic', rope:'a bit of rope', seed:'a seed'}`.
**Collect** is all-or-nothing as `bees.harvest`: scratch `new bag.constructor(bag.snapshot())`, add each find (1 each), copy slots back only if every add returns 0, then `finds = []`.
Texts: ok `"+ 1 wood · 1 rope"` with `loot:{wood:1, rope:1}`; full `"Your bag is full"`; empty `"The tray is empty"`.

## 4. Module `createGull(ctx)` (name `'gull'`)
- `load(data, from)`: `'save'`/`'restore'` → `st = cleanGull(data, decor)`; host with `seed === 0` draws one. `'net'` → skip when `data?.r === netR` (and the clock is snapped anyway, below);
  `hostHasGull = data !== undefined` (bees pattern, `bees.js:167-176`). If `data.pops > lastPops` and this is not the first net load, start the heart burst.
- `serialize()`: host only, cached on `r` and refreshed every 5 s for `t` (copy `animals.js:363-370`).
- `update(dt)`: host advances `st.t += dt` only while `ctx.running && ctx.role !== 'guest'`, and calls `tickGull` once per whole second; every 1 Hz tick also re-runs the prune/rehome.
  Guest: `clock += dt`; on each net message copy animals' `snap()` (`animals.js:367-371`): hard snap past 2 s, else ease 15% per message; first message snaps. Then render (section 5).
- `target(aim)`: ray-sphere on the gull's last world pos (r .3) and on each perch (centre y .7, r .45), copy `sphere()`/`pick()` from `animals.js:235-259`, within `REACH`.
- `prompt(aim)` (escape the name with `esc()` as animals do). Old host → `OLD_HOST`. Holding a treat at a reachable gull/perch:
  - not moved: perched → `<kbd>E</kbd>Offer fish (pts/3)`; away → `Perch · wait for a gull to visit`; cooldown → `The gull is still munching`.
  - moved: rest → `<kbd>E</kbd>Offer fish to <name>`; flying → `<name> is out flying`.
  - Not holding a treat: gull resting → `<kbd>E</kbd>Pet <name>`; perch with finds → `<kbd>E</kbd>Collect finds (n)`; perch, empty tray → `<kbd>E</kbd>Name <name> · finds 0/3`;
    not moved, perched → `A visiting gull eyes you hopefully · bring grilled fish`.
- `interact(aim)`: mirrors the prompt and sends `gull.treat {x,z,food}`, `gull.pet {x,z}`, `gull.collect {x,z}`, or opens the rename dialog. Old host → `ctx.notice(OLD_HOST, 2400)`.
  A treat is only sent while the selected kind is in `TREATS` (`heldFood` pattern, `animals.js:260`). Gull hit beats perch hit; collect beats name.
- `action(a, actor, bag)`: claim `gull.*`. `x,z` ints equal to `target(st, decor)`; distance with `near(actor, x, z)` (copy `animals.js:330`, `REACH + HOST_SLACK`).
  `gull.name {name}` needs `moved` and the same distance. On ok bump `r`, emit `{kind:r.kind ?? 'notice', text}` to the actor; failures `'full'` or `'notice'`. Host pops hearts for its own and the guest's success.
- `decorModel(type)`: `perch` → `createPerch(T)`, else null (reaches the `game.js:591` chain and the ghost at `:428`).
- `debug`: `{state, fastForward(sec), befriend()}` (befriend = host-only move-in for QA).

## 5. Animation (both clients; the only synced input is the clock `t`)
Pure `gullPose(st, perch, t, follow, out)` fills `{x,y,z,yaw,pitch,roll,flap,fold,tuck,vis}` in raft-local metres. `perch` = `{x:2*hx, y:.22 + PERCH_Y, z:2*hz}` (`PERCH_Y = 1.12`).
- **Visiting** (not moved): `away` → `vis=false`. `descend`: lerp from a sky point 10 m out, 6 m up (bearing `rnd(seed, cycle)`) to the perch with `smooth()`; `leave` the reverse. `perched` = rest pose.
- **Rest**: copy the perched branch of `gullPlan` (`wildlife.js:166-171`): hop every 2.3 s, `fold = 1 - .1*hop`, `tuck = 0`, yaw drifts with `rnd(seed, beat)`.
- **Loop**: u = time in beat, `s = smooth(min(1, u/BLEND, (BEAT-u)/BLEND))`; circle radius 3.5, 2.5 m above the perch, `a = rnd(seed,beat)*2π + 1.1u`;
  pos = lerp(perch, circle, s); yaw = tangent; roll = -.35 s; `flap = s * sin(14u)`, `fold = 1 - s`, `tuck = s`. Every beat starts and ends on the perch, so beats need no cross-blend.
- **Follow**: who = `rnd(seed, beat*3+1) < .5 ? 'host' : 'guest'`; each client maps that to `ctx.physics` or `ctx.other` (if `ctx.other` is missing, the one player). Target = that player
  in raft-local coords (one `invert` of `raft.matrixWorld` per frame into a scratch Matrix4) + (.35, 1.9, 0) with a bob `.08 sin(3u)`. Same s-blend as loop. Target over 12 m from the perch → loop.
  Live poses can differ by a few cm between clients; that is accepted (research risk 3).
- **Moved, no home**: always loop around the raft centre at radius 6, 5 m up.
- **Mesh**: one `Mesh(gullBodyGeometry(T))` + two `Mesh(gullWingGeometry(T))` from `wildlife-models.js:50-74`, `matrixAutoUpdate = false`, in their own Group added to `ctx.scene`,
  world pose via animals' `toWorld`/`raftQuat` (`animals.js:124-146`). Material: copy `gullMat` (`wildlife.js:328-336`) with `uniform float tuck` replacing the attribute and
  cache key `'gull-companion-legs'`. Wings: copy `setWing` math (`wildlife.js:407-414`) composing into each wing's `.matrix`. All Vector3/Quaternion/Matrix4/Euler preallocated in `build()`.
- **Heart burst**: three `Mesh(heartGeometry(T))` (`animals-models.js:87`) sharing one `MeshBasicMaterial({color:0xff7d9c, transparent:true, depthWrite:false})`, renderOrder 3.
  Over 1.2 s (`HEART_T`, as `animals.js:188-197`): rise `.4 + .6k` above the gull, fan out `x = (i-1) * .22k`, billboard to the camera, fade after k = .7. Local wall clock; no state.
- **Tray**: `paintPerch(g, finds)` sets `find0..2` visible and recolours each slot's own material from `FIND_COLOR` (`wood #9c7649, plastic #4fb3d9, rope #d8c08a, seed #7a9a3a`);
  `g.userData.sig = finds.join()` early return. Perch groups found like bees' hive map (rebuild only when raft children change).

## 6. Model: `createPerch(T)` in dist/gull-models.js
Group `craft_perch`, origin at the floor top, about .5 x 1.25 x .5. A round base plate (cylinder r .22 h .05, #7a5a36); a driftwood post (cylinder r .045, 1.1 tall, #a88457, slight lean .04);
a crossbar at the top (cylinder r .03, length .4, rotated to horizontal, #b89466) where the gull stands at y 1.12; at y .6 a short arm holding a **woven tray**: an open cylinder
r .16 h .06 (#c9a46a) with a darker rim torus (#8e6c3e) and a flat bottom disc. Three slot meshes `find0..find2` (small boxes .07 x .04 x .05, own Lambert materials) sit in the tray,
hidden by default. Static parts merged into one vertex-coloured mesh (as bees-model.js). No transparent materials, so no `forceSinglePass` concerns.

## 7. Naming: generalise the rename dialog (dist/animals-ui.js)
`createAnimalsUI(ctx, {title = 'Name your Puffhen', kind = 'animals.name', label = 'Puffhen name', domId = 'lrAnimals'} = {})`. The title/aria-label are set with
`textContent`/`setAttribute` (never innerHTML); `save()` sends `{kind, id, name}`; the dialog id becomes `domId`. CSS selectors `#lrAnimals …` become `dialog.lr-an …`, so the style is
shared and a second dialog does not remove the first (`:21` removes `#${domId}` only). Animals call it unchanged. Gull lazy-imports it as `animals.js:306-316` does with
`{title:'Name your gull', kind:'gull.name', label:'Gull name', domId:'lrGull'}` and calls `ui.open('gull', st.name)`; the gull action ignores `id`.

## 8. Prompt order (dist/game.js:715, the one game.js edit, tagged `// content hook`)
Holding `cookedfish` sets `eatTip`, which is checked before `content.prompt` (`:717`), so "LMB Eat" would hide "E Offer fish" (E itself already reaches `content.interact` at `:1143`).
Replace line 715 with:
`else if (eatTip) { if ((contextHtml = content?.prompt(frameAim) ?? null)?.startsWith('<kbd>E</kbd>')) html = contextHtml; else { contextHtml = null; html = '<kbd>Click</kbd>' + esc(eatTip.label); } } // content hook: an E action beats the eat hint`
The content provider (priority 1) then beats the game-context eat tip (priority 0) in `#lrPrompt`. Non-E content hints still yield to the eat hint, as today.

## 9. Co-op and compatibility
- Host-only rules and validation; guests get `ext.gull` in every host state (`game.js:1456`) and render from `clock` alone: no positions, modes or poses are sent.
- **OLD_HOST**: a new guest on an old host gets `data === undefined` → no gull drawn, every perch prompt is `OLD_HOST`, nothing is sent. An old host drops the perch decor anyway.
- Old guest on a new host: `cleanWorld` drops the unknown decor (`game.js:186`) and ignores the slice. Mixed-version co-op is unsupported; say so in the PR.
- Old save → `cleanGull(undefined)` defaults. Old build loading a new save drops perches; `ext.gull` survives via `cleanExt`, and the new build rehomes when a perch returns.
  An old build sees an unknown `perch` bag kind (`content-items.js:4`): same accepted risk as bees. Slice is under 300 chars.

## 10. Hook lines (all tagged `[gull]`)
`dist/items.js:205` perch row, `:243` radius · `dist/content.js:43` import `createGull`, `:47` append to `FEATURES` · `dist/craft-book.js:23-28`, `:96-101` · `dist/item-svg.js:279+` icon ·
`dist/animals-ui.js:17-28,35` options (section 7) · `dist/game.js:715` (section 8). New: `dist/gull.js`, `dist/gull-models.js`, `tests/gull.test.mjs`.

## 11. tests/gull.test.mjs (node:test, assert/strict, `RAFT_DIST` base, Bag from inventory-state.js, `bagWith` helper)
1. `cleanGull`: undefined/null/array/string → defaults; floats, negatives, hearts 99, 5 finds, unknown find kinds, bad names are clamped/cleaned; `home` on a non-perch tile → null; rehome to `firstPerch`.
2. `visitPhase` boundaries (19.9 away, 24 perched, 65.9 perched, 66 leave); `modeAt` deterministic, beat 0 rest, mix over 1000 beats within 60/30/10 ± 5%.
3. Treats: away → `away`, nothing taken; 3 grilled fish over 3 visits → moved, home set, name from the list; honeyfish + grilled → moved; second treat within 15 s → `cooldown`; non-treat → `notreat`.
4. After move-in: treat on bond cooldown keeps the fish; pet always bumps `pops`, hearts only every 60 s, cap 10.
5. Finds: 240 ticks → 1 find, not after 239; 10 hearts → 144 s; cap 3 stops `fw`; `dt` 1e6 clamped to 60; kinds only from LOOT; same seed → same kinds.
6. Collect: 3 finds land and the tray empties; full bag → `full`, bag snapshot and tray unchanged; empty → `empty`.
7. Module: action rejects non-int/wrong tile/out of reach (state and bag unchanged); `gull.name` cleans and rejects ''; `load(undefined,'net')` → OLD_HOST prompt;
   identical net data twice is a no-op; `gullPose` equal for host `t` and guest `clock` after snap.
8. Prompt: with a cookedfish selected and the gull perched, `prompt` returns `<kbd>E</kbd>Offer fish (0/3)`; the name is escaped (`<b>` comes back as `&lt;b&gt;`).
9. Model: `createPerch` has `find0..2`, fits .6 x 1.3 x .6; `paintPerch(g, ['wood','rope'])` shows two slots. animals-ui: no test change needed (DOM only).
Also: `tests/progression.test.mjs` passes (complete entry + radius); keep `?build=` stamps (`tests/module-specifiers.test.mjs`). Run `npm test` and shoot.py; `errors` must be empty.
