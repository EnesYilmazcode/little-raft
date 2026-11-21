# Water Tank + Pipes: research

Original Little Raft design: a placeable **Water Tank** (12 cups) feeds a network of thin **pipes** laid on deck
tiles; sprinklers and palm planters on the network get watered from it. Line refs are `dist/` at this branch.

## What exists today

**Rain barrel + sprinkler** (`rain.js`, pure, state is top-level on `world`, not `ext`):
- `world.collectors["x,z"] = {w:0..4 cups, f:0..299 tenths}` (rain.js:3, BARREL_CAP=4 at :8). `world.sprinklers["x,z"] = {w:0..3, s:0..3 spray secs}` (SPRINKLER_CAP=3).
- `sprinkle()` rain.js:71-101: per sprinkler (sorted keys) use its own tank `w>=1`, else the first 4-neighbour barrel
  with `w>=1` (NEIGHBOURS rain.js:17). It waters ONE dry unripe palm in its 8 neighbours: `garden[pk]={water:1, grow}`, `src.w -= 1`, `s=3`.
- `tickRain()` rain.js:104 prunes against decor (`prune` :63), fills barrels, then calls `sprinkle` once per second.
- `fillSprinkler` rain.js:149 (freshcup -> cup, +1 w). Prompts: `rainTarget()` rain.js:166.

**Purifier + palm garden** (`watering.js`, pure):
- `world.purifiers["x,z"] = {t:0..15, ready:0|1}` (:39-46); a ready purifier holds exactly 1 freshcup, `takeWater` (:167) deletes the entry.
- `world.garden["x,z"] = {water:0|1, grow:0..90}` on `palm` decor only (:29-37, :72). Watered = `water===1`; `plantStage()` :85 (2 = ripe; ripe resets water to 0).
- `tick()` :96 grows watered palms, skips scarecrow-pecked keys, and prunes both maps against decor.
- Host clock: game.js:1727 calls `tickWatering(world,1,...)` then `tickRain(world,1,rain)` once a second (host only; runs after `content.update(simDt)` at game.js:1710).
- Garden, purifiers, collectors and sprinklers travel as TOP-LEVEL fields of host state (game.js:1679) and through `cleanWorld` (game.js:224) and `copyWorld` (:231). Guests never tick them.

**Crops / garden beds: not in this tree.** `farming.js` (d.farm on palm, `water` item) and `farming-view.js` are dead code:
game.js does not import them and nothing imports farming-view.js. models.js:404 `cropPlot` is only an unused model. The only
live "crop" is the Palm Planter via `world.garden`. Design the sink list as a table so a future crop type can join it.

## Placement rules

- One decor per tile: `decorBlock()` build-rules.js:41-46 (`occupied` if any decor on x,z); `cleanWorld` keeps the first decor per tile (game.js:206-211).
- `DECOR_TYPES` game.js:78 = core + `CONTENT_DECOR` + `PLACEABLE_IDS` (items.js:309). A new `items.js` entry with `placeable:true` (+ `BLOCK_RADII` items.js:312) becomes decor automatically; model via the module's `decorModel(type)` (game.js:635).
- Host place path game.js:1214-1225 (`decorBlock`, grill, `playerInWay`, `content.placeBlock`). Preview/valid-tile list game.js:1061/1076.
- **There is no decor removal.** Decor only leaves when the shark destroys its tile: `removeTile` shark.js:70-82 drops the decor and deletes garden/purifier entries (not collectors/sprinklers/ext; those prune on the next tick).

## Pipes: decor or overlay? Recommend OVERLAY (world.ext slice, like paint)

As decor a pipe would take the tile, so it could never sit under the planter/sprinkler/tank it feeds, you could never
remove it (no decor removal), and every tile of a run would be lost to decor. Instead:
- Pipe is a plain stackable bag item (`items.js`, NOT `placeable`), so it is not in DECOR_TYPES and the click path reaches
  `content.use(aim, kind)` (game.js:1370). Left click lays a pipe on the aimed deck tile; right click (`content.alt`,
  game.js:1784) lifts it back into the bag (paint precedent: paint.js:226/238). Pipes may share a tile with any decor.
- Tiles are pruned against `world.tiles` like `prunePaint` (paint.js:55, called from paint.js:151) so shark-eaten tiles drop their pipe.
- The Water Tank itself IS decor (`watertank`, placeable, BLOCK_RADII ~0.4): it is a thing you stand next to and press E on.

## Proposed state (world.ext.pipes, host-authoritative)

`{v:1, s:session, r:rev, p:{"x,z":1}, t:{"x,z": w 0..12}}`, p = pipe tiles (cap 400 = MAX_TILES), t = tank cups (only tanks with
w>0; key must hold `watertank` decor). Clean like `cleanBees` (bees.js:26): `isKey` length check, int clamp, prune non-tiles / non-tanks.
Network = BFS over 4-neighbour pipe tiles starting from tiles 4-adjacent to (or under) a tank. A device is connected if it sits ON a
network pipe tile or 4-adjacent to one. Precompute networks only when `r`/decor/tiles change (cache key like zipline.js:336).

Host tick (1 s, in module `update`, MAX_TICK clamp, deterministic sorted order like rain.js):
1. Inflow: each connected-or-adjacent `rainbarrel` with `collectors[k].w>=1` moves 1 cup to the tank (stop at 12); each `purifier` with `ready===1` -> delete entry, +1 cup (purifier then waits for the next salt cup).
2. Outflow, 1 cup per sink: palm with `plantStage<2 && water!==1` -> `garden[k]={water:1, grow:garden[k]?.grow??0}`; sprinkler with `w<SPRINKLER_CAP` -> `w+1` (it then sprays on its own via `sprinkle`).
3. Bump `r` on any change. Writes to garden/collectors/sprinklers/purifiers reach guests through the existing top-level state.
Pour: E with a freshcup at the tank -> action `pipes.pour` -> `swapOne(bag,'freshcup','cup')` (watering.js:128), +1.

## Module, prompts, co-op

- New `dist/pipes.js` (pure top half + `createPipes(ctx)`), import + append to `FEATURES` content.js:69 (after `createPower`).
  Hooks: `update`, `serialize`/`load` (bees.js:167-189 net r/s dedupe), `action` (`pipes.lay|lift|pour`, reach check vs `ctx.other`/`ctx.physics`
  like bees.js:217-228), `interact`, `prompt`, `use`, `alt`, `decorModel('watertank')`, `debug` (place / fastForward / state).
- Prompt: `prompt(aim)` returns `<kbd>E</kbd>Pour in fresh water (5/12)` or a muted status; game.js:753-766 feeds it into
  `contextHtml` -> `raftPrompts` (`promptParts`, content.js:83). With a freshcup held, eatTip yields to an E content prompt (game.js:763).
  Pipe hold prompt: `<kbd>Click</kbd>Lay pipe` / `<kbd>RMB</kbd>Lift pipe`. Not muted, since pipe is not a DECOR_TYPE (game.js:756).
- E order: pickup > shark > wateringTarget (only palm/purifier/barrel/sprinkler, game.js:1016, picked by pickWateringDecor :1003) > building > `content.interact` (game.js:1321-1336). The tank is not a watering type, so content gets E.
- OLD_HOST: guest of a host without the module gets `ext.pipes === undefined` -> `hostHas=false`; prompt/interact/use return
  `'Your friend’s raft doesn’t have pipes yet'` (pattern bees.js:9/112, power.js:12, juicer.js:12). Guest never ticks.

## Save compatibility

- New saves: ext.pipes rides `world.ext` (content.js:113, saved at game.js:1446, `cleanExt` 200k chars, content.js:70). Old saves: undefined -> empty slice.
- Old builds opening a new save: `watertank` decor is dropped by `cleanWorld` (game.js:208); ext is kept as opaque. Unknown bag kinds
  (`pipe`, `watertank`) make old builds reset the bag (content-items.js:4): same accepted risk as every content item.
- No change to the top-level garden/rain shapes, so rain.js/watering.js and their tests stay as-is.

## Rendering / perf

- `rebuildRaft()` game.js:629-650 removes and disposes EVERY raft child (`disposeGeometry` :392), so do not parent pipe meshes to `ctx.raft`.
  Follow zipline.js:343-358: own InstancedMeshes added to `ctx.scene`, copy `raft.position/quaternion` each frame.
- Two InstancedMeshes, shared material: hub (short flat cylinder, <=400) + arm (half-tile box toward each connected neighbour/device, <=1600).
  Rewrite matrices only when the network cache key changes; per frame just copy the raft transform. 2 draw calls total.
- Optional `setColorAt` tint for wet (tank w>0) vs dry networks (paint/building retint precedent, building.js:108-112). Ghost: one translucent hub.
- Tank model: one merged Group in a `*-model.js`; fill level as a scaled inner cylinder (paintRainBarrel style), painted only when near.

## Risks

- Double drain: sprinklers already pull from adjacent barrels (rain.js:76-79); the tank also pulls barrels. Fine, but order it so the tank tops sprinklers rather than both emptying one barrel the same second.
- Tank tick runs in `content.update` (game.js:1710) before the core 1 s tick (:1727); keep its own 1 s clock (bees.js:191-199) and do not call `tickRain`/`tickWatering`.
- Content modules mutate top-level `world.garden` etc.; core prune (watering.js:90, rain.js:63) wipes entries not on matching decor, so only write on valid decor keys.
- `world` is replaced wholesale on guest state and on restore (game.js:2027/1947): always read `ctx.world` live, never cache it.
- Pipes under a tank tile: allow it (overlay), but BFS must treat the tank tile as the source even without a pipe.
- No crop plots exist; do not promise "garden beds" in UI text. Pipe item must not be `placeable` or it becomes decor.

## Recommendation

Ship `watertank` as decor + `pipe` as a non-decor overlay in `world.ext.pipes`, one content module `pipes.js` (+ `pipes-model.js`),
host 1 s tick: barrels/purifiers in, palms/sprinklers out; InstancedMesh rendering in scene space; OLD_HOST guard; no top-level save keys.
