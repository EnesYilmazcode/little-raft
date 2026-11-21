# Paint + brush research

Feature: a brush tool and a few soft paint colours so players can tint building pieces and deck tiles. This note covers
how the genre handles painting, a cozy take for Little Raft, where the code hooks are, and the risks.

## (a) Genre pattern and a cozy take

How survival and building sandboxes usually handle painting:
- **A brush tool**, crafted early from basic stuff (stick + fibre/rope) and held like any other tool. Left click paints;
  right click (or a wheel) picks a colour.
- **Paint from natural ingredients** (flowers, berries, clay, charcoal, plus a binder like water or resin), made at a
  small station or in the bag. Each colour is its own item and every stroke uses up a little.
- **Targets:** walls, floors, pillars, roofs, sometimes the foundation. Some games paint per face (a wall's inside and
  outside can differ). Most paint the whole piece, which is simpler and reads better at low poly.
- **A colour picker:** a radial or grid of 8 to 16 swatches. Some add patterns (stripes) or a "scrape off" mode that
  returns the piece to raw wood.
- **Persistence:** paint belongs to the piece. Removing the piece drops its paint; a new piece starts as raw wood.

Cozy take for Little Raft (original names, no copying):
- **Brush** (`brush`): 1 wood + 1 rope, made in the bag. No durability loss, or only a token amount.
- **Soft palette of 6**, each made from items the game already has:

| Colour | Made from | Hex idea |
|---|---|---|
| Driftwood (scrape back to raw) | free, always available | none (white tint) |
| Seafoam | 1 leaf + 1 sand | #9fd3c1 |
| Coral | 1 fish + 1 clay | #e9a08c |
| Sunshell | 1 sand + 1 seed | #f1d78d |
| Lagoon | 1 plastic + 1 leaf | #86b3d6 |
| Pebble | 1 stone + 1 clay | #c9c3b8 |

- **One paint-pot item per colour** (`paint_seafoam` ...), stackable to 20. One pot paints about 4 pieces, tracked as a
  charge counter per colour in the module's ext slice. Simpler option: one pot per stroke, and the recipe makes 4 pots.
- **Controls with the brush in hand:** left click paints the aimed piece or deck tile with the current colour. Right
  click (or Q, the hammer-wheel habit) cycles to the next colour you own. A HUD chip shows the swatch and pot count, and
  a ghost outline in the swatch colour marks the target.
- **Whole-piece colour only (v1).** Per-face paint is out of scope: the instanced pieces have no face ids.

## (b) Code anchors

**How pieces are stored and validated**
- `dist/building-pieces.js:4` defines the record `{t,i,j,l,r}`. `PIECES` is at :16, `PIECE_ORDER` at :27 (floor, wall,
  halfwall, window, door, pillar, stairs, roof; foundation is a `tile`). `pieceKey()` at :35 is a unique int per slot.
- `BuildGrid.load` (:89) keeps only `{t,i,j,l,r}`, so an extra field like `p.c` is stripped. `place` (:175) and
  `remove` (:198) bump `grid.version`. `cleanPieces()` (:490) runs in `game.js cleanWorld()` on every save and every
  host snapshot (`game.js:166`).
- `dist/building.js:131`: after each place or remove, `apply()` rewrites `world.pieces` as fresh `{t,i,j,l,r}` objects.
- **Conclusion: paint cannot live on the piece records. Store it in `world.ext.paint`.**

**How pieces are rendered (this decides how tinting works)**
- `building-models.js:5`: each type is ONE merged non-indexed BufferGeometry with a per-vertex `color` attribute
  (`add()` at :32-41). `createPieceMaterial` (:251) is one shared wood material, `vertexColors=true`, colour white.
- `building.js:15`: one `material` for all types. `rebuild()` (:40-56) makes one `InstancedMesh` per type (:47), about
  8 draw calls in total. Instances are filled in `grid.list` order; the mesh is recreated when capacity grows, and
  `m.count` resets on every rebuild.
- **Per-piece tint = per-instance colour, `m.setColorAt(k, color)`:** no extra draw calls or materials. Three r170
  (`vendor/three.module.js:6`) multiplies instance colour x vertex colour x wood map. Precedent: `islands.js:57` sets
  every instance colour up front "(no recompiles later)" and tints at :104; `seafloor.js:259` divides tint by base.
- **Needed change in building.js:** a tint callback (`createBuilding(T, scene, {tintOf})` or `building.setTint(fn)`).
  `rebuild()` then calls `setColorAt(k, tintOf(p) || WHITE)` for every instance, so `instanceColor` exists from the
  start. Also expose `building.retint()`, which rewrites only `instanceColor` and leaves the matrices alone.
- **Gotcha: multiply only darkens brown planks.** Store tint = target/base (values above 1 are fine in the Float32
  `instanceColor`, like the seafloor kelp trick) or choose saturated, lighter targets.
- The ghost (`building.js:20`, `showGhost` :101) can preview paint by setting `ghostMat.color` to the swatch.

**Deck and foundation tiles**
- `game.js:423` `rebuildRaft()` disposes every raft child, then calls `createFloor(T, seed, mat)` per tile (:426).
- `deck.js:135`: each tile is its own group of merged meshes per colour: `floor-planks` (3 plank colours, :204) plus
  logs, log ends, lashings and nails. They use the shared `mat(color)` (`game.js:288`, cached by colour; `TIMBER`
  colours get the wood texture, :60). That is already 5 to 7 draw calls per tile, not instanced.
- **Tinting a tile:** swap the `floor-planks` meshes to a tinted wood material cached per colour (`createWoodMaterial`).
- **Gotcha:** `disposeGeometry` (`game.js:299`) disposes every material not in `materialCache`, so a module's own tint
  materials get disposed on each rebuild. Three re-uploads them on next use, so it works, but wastefully. Better: route
  the tint through a `paintMat(hex)` that inserts into `materialCache`, which is cached forever.
- **Re-applying after a rebuild:** `rebuildRaft` recreates the tiles, so paint must be re-applied each time, and no
  content hook fires after it. Add `content.afterRebuild()` beside `building?.sync(world)` at `game.js:440`
  (preferred), or watch `raft.children` identity in `update`.

**Tools, items and the held model**
- `inventory-state.js:12`: `TOOL_KINDS` is hard-coded as `Set(['hook','hammer','fishingrod'])`; tool `ITEM_INFO`
  entries (:16) have `tool:true, maxStack:1`. Content items come from `content-items.js:9`, where `item()` forces
  `tool:false`. Making the brush a real tool needs a hook in both places.
- **Lower-risk alternative:** keep the brush `tool:false, maxStack:1`, like the cups (`inventory-state.js:39`), which
  have no durability or tool plumbing. It also avoids the hard-coded tool lists at `game.js:128` (`fromCounts`), :1310
  (old-host guest mirror) and `raftDebug.ownedTools` (:1414), which name only hook, hammer and fishingrod.
- **Held model:** `game.js:400-417` `buildViewmodels()` wraps tool models with `createHands(T, model)` (`hands.js:14`)
  and `holdable(model, grip, pose)`; per-kind visibility is at `game.js:965`. A brush needs a procedural model like
  `hammer.js:13` (with `userData.grip`) plus one more hands rig. Add it in `buildViewmodels`: a rig a module builds on
  `ctx.camera` would miss the viewmodel renderOrder/depth setup at :412-416.
- **Icon:** add `<symbol id="icon-brush">` to `dist/icons.svg` (pattern: `icon-hammer` at :296). Pots can share
  `icon-paint`.

**Aiming and picking a target**
- **Pieces:** `building.grid.pick(ox,oy,oz, dx,dy,dz, deckY, reach)` (`building-pieces.js:247`), a cached ray-vs-box
  test that returns the nearest record. Hammer remove mode already uses it (`building.js:82`: camera position + `aim.dir`,
  REACH 7).
- **Deck tiles:** take `aim.point` from `pickNdc` (`game.js:572`, the deck plane), then `Math.round(p.x/2)`,
  `Math.round(p.z/2)` and a `hasTile` check (`game.js:271`; pattern at :866). Prefer the piece when both are hit.
- `contentCtx` (`game.js:328-335`) does **not** expose `building`; add a `get building()` getter.

**Content module hooks (`dist/content.js:1-24`, FEATURES at :31)**
- **Present:** `serialize`/`load(data, from)`, `action(a, actor, bag)` (host-authoritative), `interact` (E), `prompt`,
  `update`, `debug`. Documented in `docs/features/content-hooks.md`.
- **Missing for paint** (each is a one-line `// content hook` in `createContent()` plus game.js):
  - left-click `use(aim, kind)`: `useSelected` (`game.js:851-872`) has no content call; the cup line at :871 is the
    pattern.
  - right-click: `game.js:1120` handles only the hammer.
  - after-rebuild (see deck tiles above).
- **Paint state:** `world.ext.paint = {p:{"wall:1,0,0,1":2, ...}, t:{"0,1":3}, sel:{host:1, guest:2}}` with small
  colour indexes. `serialize()` returns the same object; `load(d,'net')` compares a cheap version number and calls
  `building.retint()` and the tile re-tint only when the data changed.

**Does removing a piece clear its paint? It must.** The record carries no paint, so a stale `world.ext.paint.p[key]`
would hand its colour to a new piece placed in the same slot.
- On the host, prune entries missing from `world.pieces`/`world.tiles` whenever `world.pieces` changes identity
  (`building.js:131` makes a new array on every place or remove). Also prune in `load('save')` so stale keys never
  persist.
- Keying by type + slot (`wall:i,j,l,r`) means a doorway placed where a wall was starts clean. Paint is cheap, so
  removal refunds none.

## (c) Risks

- **Performance.** Pieces stay at about 8 instanced draw calls; `instanceColor` costs nothing extra. Set it for every
  instance in `rebuild()` so the first paint does not force a shader recompile. Deck tiles are already about 6 draw
  calls each and not instanced, so paint must not add materials per tile: use one cached material per (palette colour
  x plank colour), 15 at most, and never clone a material per tile.
- **Shared-material trap.** Never set `material.color` on the shared building or plank material: that repaints every
  piece or every tile on the raft.
- **Save compatibility.**
  - Paint lives only in `world.ext.paint`; `load(undefined)` means no paint. Older builds drop `ext`, so their pieces
    stay unpainted.
  - Paint-pot items make an older build reject the bag snapshot, the same known risk as any new item
    (`content-items.js:4`).
  - Validate keys against `PIECES` with null-prototype objects (`building-pieces.js:29`), clamp colour indexes, and cap
    entries (600 pieces + 400 tiles) to stay well under `EXT_MAX` 200000 (`content.js:32`).
- **Co-op sync.**
  - The guest sends `{kind:'paint', target, c}` via `ctx.action`. The host checks reach, that the target exists and
    that the pot is in the actor's bag (`ctx.actorBag`), then charges, mutates and returns true.
  - ext goes out in full about 8 times a second (`game.js:1062`), so keep the map compact.
  - Guests re-tint on `load(...,'net')` only when the version changes. Never re-tint deck tiles on every message:
    `rebuildRaft` runs on guests only when tiles or decor change (`game.js:1313`).
  - A guest returning to their own raft goes through `load(...,'restore')` (`game.js:1230`), and the tint must follow.
- **Colour readability.** Multiply over brown wood can look muddy. Tune colours in a `shoot.py` screenshot pass at noon
  and at dusk (day/night changes the light).
