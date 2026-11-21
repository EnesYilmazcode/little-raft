# Spec: Water Tank and Pipes

Source: docs/features/water-pipes-research.md. Cozy rules: nothing wilts, nothing breaks, and a pipe you lift always comes back to your bag.
A placeable **Water Tank** holds 12 cups. Thin **pipes** laid on deck tiles join it to rain barrels and purifiers (in) and palm planters and sprinklers (out).
This is one content module: pure logic plus the module in new `dist/pipes.js`, visuals in new `dist/pipes-model.js`. **game.js gets no edits**: every hook it needs already exists.
Line refs are `dist/` on `claude/loop-features-202611210926`. New imports use `?build=v3-survival-ae77fa84ac2b`. rain.js and watering.js do not change.

## 1. Items (dist/items.js, dist/craft-book.js)
- After `glidestep` (items.js:288), add the following. The id is `waterpipe`, NOT `pipe`/`pipes`: `pipes` is already the instrument (craft-book.js:21, coop.js:28).
  `item('watertank', 'Water Tank', 'decor', { placeable: true, iconTint: '#b87333', recipe: hand({ wood: 6, plastic: 3, scrap: 2, rope: 1 }), unlock: discover('freshcup', 'scrap'), tip: 'A copper-banded tank for 12 cups. Pipe it to barrels, purifiers, palms and sprinklers.' })`
  `item('waterpipe', 'Water Pipe', 'build', { iconTint: '#c98a4b', recipe: hand({ scrap: 1, plastic: 1 }, 4), unlock: discover('freshcup', 'scrap'), tip: 'Click a deck tile to lay it, right click to lift it back up.' })`
  `waterpipe` must NOT be `placeable`, or it would become a DECOR_TYPE (game.js:78) and take the tile.
- BLOCK_RADII (items.js:326, after the zipline row): `watertank: 0.35, // [pipes]`. The tank becomes decor by itself through `PLACEABLE_IDS` (game.js:78).
- craft-book.js:34: add `watertank: 'survival', waterpipe: 'survival', // [pipes]`. Near :156:
  `watertank: { desc: 'A wooden tank with copper hoops and a little glass window.', use: 'Press E with a fresh cup to pour it in, or with an empty cup to fill it. Pipes carry the water.' }`,
  `waterpipe: { desc: 'Copper pipe on little wooden cleats.', use: 'Lay a line from the tank. Barrels and purifiers next to it fill the tank; palms and sprinklers drink.' }`.

## 2. State: `world.ext.pipes` (host-authoritative)
`{v:1, s:session, r:rev, g:geoRev, p:{"x,z":1}, t:{"x,z":w}}`
- `p`: pipe tiles, at most `MAX_PIPES = 400` (the tile cap). A key is kept only if `world.tiles` holds that tile. A pipe may share its tile with any decor.
- `t`: tank cups, integers 1..`TANK_CAP = 12`. A key is kept only if `world.decor` has a `watertank` there. A missing key means empty, and 0 is deleted.
- `r` bumps on every change (net dedupe, bees.js:167-189). `g` bumps only when the pipe set changes (lay, lift, prune), so the renderer can tell water changes from layout changes.
- `cleanPipes(v, tiles, decor)` works like `cleanBees` (bees.js:26): junk gives the defaults; it checks `isKey` (length ≤ 24 + round trip), clamps ints, and drops entries that are not on a tile or not on a tank.

## 3. Networks (pure, `buildNets(st, world)`)
- Nodes are the pipe tiles plus every tank tile. A tank tile is a node even with no pipe under it, so two touching tanks share a net.
- For each tank key in sorted order that has not been visited yet, flood-fill (BFS) over 4-neighbour nodes. The result is one net `{tanks:[sorted keys], nodes:Set}`.
- A device is any decor of a SOURCE or WATERABLE type. It joins a net when its tile is a node, or when one of its 4 neighbours is a node. If it touches two nets, the first net in sorted order gets it.
  Each net lists `sources` and `sinks` as sorted keys. A net with no tank does not exist: lone pipe runs do nothing.
- Cache: rebuild only when `g`, the tank-key set, or the decor signature changes. The decor signature is a string of `type@x,z` for device and tank types, recomputed only when `decor` identity or length changes (as at zipline.js:336).
  Guests get a new `world` with each state message, so always read `ctx.world` live and never keep `world.garden` (watering.js:90 replaces it every tick).

## 4. Tables (so crops can join later)
```js
export const SOURCES = Object.freeze([ // order = priority inside a net
  { type: 'rainbarrel', has: (w, k, res) => (w.collectors?.[k]?.w ?? 0) >= 1 + res, take: (w, k) => { w.collectors[k].w -= 1; } },
  { type: 'purifier', has: (w, k) => w.purifiers?.[k]?.ready === 1, take: (w, k) => { delete w.purifiers[k]; } }, // the purifier then waits for the next salt cup
]);
export const WATERABLE = Object.freeze([
  { type: 'palm', wants: (w, k) => plantStage(w.garden?.[k]) < 2 && w.garden?.[k]?.water !== 1, give: (w, k) => { (w.garden ??= {})[k] = { water: 1, grow: w.garden[k]?.grow ?? 0 }; } },
  { type: 'sprinkler', wants: (w, k) => (w.sprinklers?.[k]?.w ?? 0) < SPRINKLER_CAP, give: (w, k) => { const m = (w.sprinklers ??= {}); (m[k] ??= { w: 0, s: 0 }).w += 1; } },
]);
```
A future crop adds one WATERABLE row and nothing else. Import `plantStage` from watering.js and `SPRINKLER_CAP` from rain.js.
Writes go only to keys whose decor type matches the row, so the core prunes (watering.js:90, rain.js:63) never wipe them.

## 5. Host tick (`tickPipes(st, world, dt)`, in module `update`, own 1 s clock like bees.js:191-199)
`dt` is floored and clamped to 0..`MAX_TICK = 60`. For each whole second: prune (section 2) and rebuild nets if needed. Then for each net in sorted order:
1. **Inflow**: for each source in table-row order, then key order, if `has` → `take` and add 1 cup to the net's least-full tank (ties go to the lowest key). Each source gives at most 1 cup per second. Stop when every tank in the net is full.
2. **Outflow**: for each sink in WATERABLE row order (palms before sprinklers), then key order, if `wants` and some tank has `w≥1` → `give` and take 1 from the fullest tank (ties go to the lowest key). Each sink gets at most 1 cup per second.
3. If anything changed, bump `r`. Inflow runs before outflow, so a barrel→tank→palm cup moves in one second. The tick makes no toasts.
- **Order relative to the core tick**: `content.update(simDt)` (game.js:1710) runs before the core 1 s block (game.js:1727: `tickWatering`, then `tickRain`/`sprinkle`) in the same frame.
  The two clocks are independent and are not phase-locked, so correctness must not depend on which runs first. Never call `tickRain`/`tickWatering` from this module.
  A ripe palm is never re-watered, because `wants` requires stage < 2. A just-watered palm is skipped, because `water === 1`.
- **Barrel contention rule**: a barrel that is orthogonally next to a sprinkler that is NOT on any net keeps 1 cup in reserve (`res = 1`, so the tank only takes it at `w≥2`). Otherwise `res = 0`.
  A sprinkler on a net is topped up by the tank, and `sprinkle()` uses its own tank first (rain.js:76), so it leaves the barrel to the tank. One barrel can never be emptied by both in one second.
- Cups that a purifier drains into the tank become tank water. The salt cup was already used up at load (watering.js:163), the same as when you drink it. Say so in the craft-book `use` line if it confuses QA.

## 6. Actions (host, `action(a, actor, bag)`, kinds `pipes.lay|lift|pour|fill`)
Common checks: `x,z` must be ints. The pose is `actor === 'guest' ? ctx.other : ctx.physics` (bees.js:217-228). The tile centre must be within `REACH (3) + HOST_SLACK (2)`. Failures change nothing and `emit` `{kind:'notice', text}` to the actor only.
- `lay`: the tile is in `world.tiles` (else `notile`), has no pipe (`haspipe`), the pipe count is below 400 (`cap`), and `bag.remove('waterpipe',1)` works (`noitem`). Then `p[k]=1`, `g++`, `r++`.
- `lift`: a pipe is there (`nopipe`). Check bag room on a snapshot copy first (`full` → the pipe stays). Then `bag.add('waterpipe',1)`, delete `p[k]`, `g++`, `r++`. Lifting always refunds.
- `pour`: `watertank` decor is at k (`notarget`), `w < 12` (`tankfull`), and `swapOne(bag,'freshcup','cup')` (watering.js:128) works (`nocup`/`full`). Then `w+1`.
- `fill`: tank there, `w ≥ 1` (`tankempty`), and `swapOne(bag,'cup','freshcup')` works. Then `w-1`. Emit `{kind:'loot', text:'+ 1 cup of fresh water'}`.
- Texts: notile "Lay pipes on the deck" · haspipe "There is already a pipe here" · cap "That is a lot of pipe" · noitem "You need a water pipe" · nopipe "No pipe there" · full "Your bag is full" ·
  tankfull "The tank is full" · tankempty "The tank is empty" · nocup "You need a cup" · notarget "Nothing to use that on".

## 7. Client hooks and prompts
- `use(aim, kind)` / `alt(aim, kind)`: only for `kind === 'waterpipe'` (the click path reaches game.js:1370, and right click reaches game.js:1784). The tile is `Math.round(aim.point.x/2), Math.round(aim.point.z/2)`.
  Check locally first, so the player gets a notice without a round trip. Then `ctx.action({kind:'pipes.lay'|'pipes.lift', x, z})`. Return true whenever a pipe is held, so the click never falls through.
- `interact(aim)` (E, game.js:1334): find the nearest `watertank` along the aim within REACH, the same as bees `target()`. Act on the selected slot's kind: `freshcup` → pour, `cup` → fill, otherwise show the status notice. Return true.
  E order: pickup > shark > watering decor (game.js:1333) > building > content. A palm or barrel picked by `pickWateringDecor` (game.js:1003) right next to the tank wins E. This is accepted.
- `prompt(aim)`. N is the tank's `w`. The first match wins, and every string is static:
  | held / aim | prompt |
  |---|---|
  | waterpipe, deck tile with no pipe | `<kbd>Click</kbd>Lay pipe (n left) · Right click lifts` |
  | waterpipe, tile with a pipe | `<kbd>Right click</kbd>Lift pipe` |
  | waterpipe, no deck tile | `Water pipe: point at the deck` |
  | tank + freshcup, N<12 | `<kbd>E</kbd>Pour in fresh water (N/12)` (this beats eatTip, game.js:763) |
  | tank + freshcup, N=12 | `Water tank: full (12/12)` |
  | tank + cup, N≥1 | `<kbd>E</kbd>Fill cup (N/12)` |
  | tank + cup, N=0 | `Water tank: empty · pipe in a rain barrel or purifier` |
  | tank + saltcup | `Water tank: N/12 · fresh water only` |
  | tank, anything else | `Water tank: N/12 · feeding K` (K = sinks on its net), or `Water tank: N/12 · not piped to anything` |
- Guest of an old host (`hostHas === false`, see section 10): prompt, interact, use and alt return or notice `OLD_HOST = 'Your friend’s raft doesn’t have pipes yet'`.

## 8. Rendering (dist/pipes-model.js, given THREE, imports only merge-geo.js)
- Pure `pipeLayout(st, decor, nets)` in pipes.js gives `{joints:[[x,z,kind]], arms:[[x,z,dir,start,len]]}`. The mask bits are 1:+x 2:+z 4:-x 8:-z.
  A bit is set when that neighbour is a pipe, a tank, or a device on the same net. Joint kind by mask: 0 or 1 bit `cap`, 2 opposite bits `straight`, 2 adjacent bits `elbow`, 3 bits `tee`, 4 bits `cross`.
  Arms: one arm per set bit, from the centre to the tile edge (start 0, len 1 m). A tank or device tile that touches a net pipe gets one arm from its edge inward (start 1, len .62), so the pipe meets the model.
- `createPipeMeshes(T)` returns two InstancedMeshes that share one `MeshStandardMaterial({vertexColors:true, metalness:.4, roughness:.55, flatShading:true})`, with `DynamicDrawUsage` and `frustumCulled = false` (as at zipline-model.js:73).
  - `pipe_joints` (max 400): one merged geometry made of a wooden cleat (box .22 × .04 × .22, #8a6a45, y .02) and a copper hub (6-sided cylinder r .055 h .09, #b87333, y .075).
    The per-instance scale shows the fitting: cap .8, straight .7 (it reads as a clamp), elbow 1.0, tee 1.15, cross 1.25.
  - `pipe_arms` (max 2000): an open 6-sided copper cylinder, r .035, laid along +X over 0..1, at y .075. It is rotated by `dir`×90°, and scaled on X by `len`.
  - Optional instance colours: white on a wet net (a tank has `w > 0`), `#a9b8b0` (dull verdigris) on a dry one.
- The module adds both meshes to `ctx.scene`, NOT `ctx.raft`, because rebuildRaft (game.js:629) disposes raft children. Each frame it copies only `raft.position/quaternion` onto them (zipline.js:347-351).
  The y offset is `deckY() - raft.position.y`. It rewrites matrices only when the layout key `g|decorSig|wetMask` changes. That is 2 draw calls, and there is no per-frame allocation.
- `createWaterTank(T)` returns the Group `craft_watertank` (`userData.craftType = 'watertank'`, `height 1.05`). Everything fits in .75 × .75 × 1.1 m.
  It has: 4 wooden legs (.06, h .12); a 10-sided body made of a wood-stave cylinder (r .3, h .78, #9c7649); 2 copper hoops (tori, R .305, #b87333) at y .3 and .78; a flat-shaded copper cone lid; and a short spigot pipe at y .15 facing +X.
  The **level window** is a dark backing strip (.09 × .6) on the front at z .302, behind a glass plane (opacity .35). `tankLevel` is a box inside it (#7fc4dc, emissive #2a6f8a .3) with y scale `max(.001, w/12)` and its base at the bottom.
  Add 3 small tick marks beside it. `paintTank(g, w)` caches the value on `g.userData.sig`. Return the model from `decorModel('watertank')`. Find tank groups by scanning `ctx.raft.children` for that name (bees.js scanHives), and paint them only when `w` changes.
- Ghost: the placement ghost comes free through `content.decorModel` (game.js:465). For pipes, show one translucent joint at the aimed tile while a pipe is held (green if a pipe can be laid there, red if not).

## 9. Module wiring (dist/content.js)
- After content.js:67, add `import { createPipes } from './pipes.js?build=v3-survival-ae77fa84ac2b'; // [pipes]`. In `FEATURES` (content.js:69), insert `createPipes` right after `createPower`.
- Module hooks: `name:'pipes'`, `update`, `load`, `serialize` (cached by `r`), `action`, `interact`, `prompt`, `use`, `alt`, `decorModel`, `dispose` (remove and dispose both meshes and their geometry and material), and `debug`.
- `debug` (it appears as `raftDebug.content.pipes`): `state()`, `nets()` (tanks, nodes, sources, sinks), `place(type,x,z)` (host QA: a tank on a free tile), `lay(x,z)`, `fill(key,w)`, and `fastForward(s)`.

## 10. Co-op, OLD_HOST and saves
- The host owns `st`. Guests never tick and only render. `load(data,'net')` dedupes on `r`/`s` (bees.js:167-189). `data === undefined` from the net sets `hostHas = false`.
- Changes to garden, collectors, sprinklers and purifiers reach guests through the existing top-level host state (game.js:1679). Nothing new goes on the wire.
- Saves: the slice rides `world.ext` (content.js:113, `cleanExt` 200k chars). The worst case of 400 pipes plus tanks is about 6k chars. Old saves have `undefined` → an empty slice. `load(data,'save')` cleans the slice against the current tiles and decor.
- When the shark eats a tile (shark.js:18), the pipe and the tank's cups drop at the next host prune. Rollback: older builds drop the `watertank` decor (game.js:208), keep ext as opaque, and reset a bag that holds the new kinds (content-items.js:4). This is the same accepted risk as other content items. Say so in the PR.

## 11. tests/pipes.test.mjs (node:test, assert/strict, `RAFT_DIST` base, `bagWith` as at bees.test.mjs:16)
1. `cleanPipes`: junk gives the defaults. Bad keys, non-tiles, non-tank `t` keys and `w` of 0 are dropped. `w` above 12 is clamped. More than 400 pipes are cut to 400.
2. `buildNets`: tank+pipe chain; two tanks joined by pipe share one net; a diagonal pipe does not join; a device under a pipe or 4-adjacent joins, but a diagonal one does not; a lone pipe run with no tank gives no net; a tank-adjacent palm with no pipe joins.
3. Inflow: a barrel with w 3 gives 1 cup per second; a ready purifier entry is deleted and gives +1; the tank stops at 12 and the barrel keeps the rest; the least-full tank gets the cup.
4. Outflow: the dry palm becomes `{water:1, grow:kept}`; a ripe palm and a wet palm stay deepEqual; palms go before sprinklers; a sprinkler stops at 3; one cup per sink per second; the cup comes from the fullest tank.
5. Contention: a barrel next to an un-netted sprinkler keeps 1 cup. Running `tickPipes` then `tickRain` for 20 s never takes a barrel below 0, and the total water (barrel + tank + sprinkler + watered palms) is conserved.
6. Order independence: running pipes-then-core and core-then-pipes for 60 s both end with no ripe palm re-watered and with collectors that are never negative.
7. Actions: `lay` removes 1 pipe from the bag, bumps `g`, and refuses notile/haspipe/noitem/far; `lift` refunds and refuses with a full bag, leaving the pipe in place; `pour`/`fill` swap the cups and refuse at 12 / 0 with the bag snapshot unchanged.
8. `WATERABLE`: adding a test row `{type:'crate', …}` makes a crate a sink with no other change.
9. Prompts: each row of section 7, plus OLD_HOST with `load(undefined,'net')` as a guest.
10. `pipeLayout`: the masks give cap, straight, elbow, tee and cross, and there are device arms; the layout key is unchanged after a pure water change.
11. Model with the vendored THREE: `craft_watertank` fits its box; `paintTank(g, 6)` gives `tankLevel` a y scale of .5; both InstancedMeshes keep their array identity across two rebuilds.
12. Items: `waterpipe` is not in PLACEABLE_IDS, and `watertank` is; the recipe for 4 pipes crafts.
Run `npm test` and shoot.py. The `errors` list must be empty.

## 12. Files
New: `dist/pipes.js`, `dist/pipes-model.js`, `tests/pipes.test.mjs`. Edited: `dist/items.js:288,:326`, `dist/craft-book.js:34,:156`, `dist/content.js:67,:69`.
Not touched: game.js, rain.js, watering.js, farming.js, coop.js, and INDEX.md (the lead adds the line).

## Build notes
- **Change from the spec: purifiers do NOT feed tanks.** Taking a ready purifier's cup into a tank would make a cup the player put in vanish from where they left it, and players must never lose items. `SOURCES` holds only the `rainbarrel` row. The table stays open: a future source adds one row and nothing else. Because of this, the tank tip, the craft-book `use` line and the empty-tank prompt say "rain barrel" only (`Water tank: empty · pipe in a rain barrel`). Test 3 checks that a ready purifier next to the tank keeps its `{t:15, ready:1}` entry.
- **Unlock**: `discover('freshcup', 'scrap')` fails the progression catalogue tests, because `freshcup` is a core inventory kind and not an items.js item (an unknown ref, and the item is unreachable). Both items use `discover('plastic', 'scrap')` instead; those are the recipe's own materials.
- **live.js**: `pipes-model.js` and `pipes.js` were added to `PRELOAD`, because tests/live-preload.test.mjs requires it. The FEATURES order is `… createBees, createPower, createPipes, createJuicer …`, and `createCookpot` stays last.
- **Pure API** (pipes.js): `cleanPipes`, `prunePipes`, `buildNets(st, world, tables?)`, `decorSig`, `newNetCache(tables?)`/`netsFor`, `tickPipes(st, world, dt, cache?)`, `pipeAction(st, world, a, bag, pose)`, `promptText(view)`, `pipeLayout(st, decor, nets)`, `jointKind(mask)`.
  `tables` defaults to `{sources: SOURCES, sinks: WATERABLE}`. Tests pass an extra WATERABLE row there, because the exported arrays are frozen.
  Layout tuples carry a trailing wet flag (`[x,z,kind,wet]`, `[x,z,dir,start,len,wet]`). A device stub arm (`start 1, len .62`) covers the radial range .38..1 m.
- **Extra refusal**: `far` ("Try a spot a little closer") is used when the actor is beyond `REACH + HOST_SLACK`, and on the client beyond `REACH + .5`. Host and client also refuse a non-int `x,z` (`notarget`).
- **Prompt note**: with a salt cup held at the tank, the core `Drink (-5 water)` eat tip still wins (game.js gives way to content prompts only when they start with `<kbd>E</kbd>`). This is the existing rule and game.js is not touched. The module prompt still returns `Water tank: N/12 · fresh water only`.
- **Model tweaks**: the hoops sit at y .17 and .86 (spec: .3 and .78) so that they do not cross the level window. The body material uses metalness 0 so that the staves do not go black. The spigot is shortened so the tank fits .75 m. The ghost is a brighter green (#5dff8f, opacity .7).
- **Co-op / saves**: as specced. The host owns `world.ext.pipes`, guests only render, `load(…,'net')` dedupes on `r`/`s`, and `undefined` from the net sets OLD_HOST. Old saves load as an empty slice. Rollback risk as in section 10: an older build drops `watertank` decor and resets a bag that holds the new kinds.
- **Lift always refunds**: room is checked on a snapshot copy first. With a full bag the pipe stays down and the player gets "Your bag is full". The refund is the same `waterpipe` item.
- **QA**: `raftDebug.content.pipes` has `state`, `nets`, `place(type,x,z)` (watertank / rainbarrel / palm / sprinkler / purifier), `lay`, `fill`, `fastForward`, plus `prompt()`, `layout()` and `target()`.
  The close-up script at scratchpad r4/pipes/pipes_shot.py does the following:
  - places a barrel, a tank, 2 palms and a sprinkler, and lays a run with 2 tees and an elbow;
  - checks every tank prompt;
  - pours with E;
  - lays and lifts a pipe with real left and right clicks;
  - runs the flow.
