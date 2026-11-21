# Spec: paint + brush for building pieces

Source: docs/features/paint-research.md. Cozy rules: paint is cosmetic and cheap, scraping back to raw wood is free, and nothing else is ever lost.
New files: `dist/paint.js` (content module `name:'paint'`; pure helpers exported for tests, THREE only through `ctx.T`), `dist/brush-model.js` (procedural THREE model),
`tests/paint.test.mjs`. Everything else gets small hooks. New imports use `?build=v3-survival-ae77fa84ac2b`. Whole-piece colour only, no per-face paint (v1).

## 1. Palette (exported `PALETTE`, the index is what we store)
| idx | id | Name | Hex | Pot recipe (makes 4 pots) |
|---|---|---|---|---|
| 0 | driftwood | Driftwood (scrape back to raw wood) | none | free, needs no pot |
| 1 | seafoam | Seafoam | `#9fd3c1` | 1 leaf + 1 sand |
| 2 | coral | Coral | `#e9a08c` | 2 clay |
| 3 | sunshell | Sunshell | `#f1d78d` | 1 sand + 1 seed |
| 4 | lagoon | Lagoon | `#86b3d6` | 1 plastic + 1 leaf |
| 5 | pebble | Pebble | `#c9c3b8` | 1 stone + 1 clay |
One pot paints one piece or tile. Each recipe makes 4 pots, so there are no charge counters and bags only ever hold plain stacks.
Re-painting a target the same colour is refused with "Already Seafoam" and costs nothing. Driftwood deletes the entry and refunds nothing.

## 2. Items and recipes (dist/content-items.js)
- Give `item()` an optional 5th parameter: `item(kind, name, icon, placeholder = true, max = S)` with `maxStack: max`. Existing calls stay the same.
- `brush: item('brush','Paint Brush','icon-brush',false,1)` has `tool:false`, like the cups (inventory-state.js:39), so `TOOL_KINDS`, durability and the
  hard-coded tool lists (game.js:128, :1310, :1414) stay untouched.
- `paint_seafoam` ... `paint_pebble`: `item('paint_<id>', '<Name> Paint', 'icon-paint-<id>', false)`, stack 20. They are not decor: not in `CONTENT_DECOR`.
- `CONTENT_RECIPES`: `brush: recipe('brush','Paint Brush',1,{wood:2, rope:1})` and the 5 pot recipes from section 1 with count 4 (the crafter already adds
  `r.output.count`, inventory-state.js:356).
- Research gating needs no change: `learnedFrom` (storage-research.js:36) re-derives learned recipes from the seen ingredients on every load. The brush
  unlocks once wood and rope are researched, and an old save that already researched them unlocks it right away.

## 3. State: `world.ext.paint = {v:1, rev, m}`
- `m` is a null-prototype map from key to colour idx 1..5 (0 is never stored).
  - Piece key: `pieceKeyOf(p) = p.t+':'+p.i+','+p.j+','+p.l+','+p.r`, for example `"wall:1,0,0,1"`. The type comes first, so a doorway built where a wall
    stood starts clean.
  - Deck or foundation tile key: `tileKeyOf(x, z) = x+','+z`.
- `rev` is a non-negative integer that the host bumps on every change, including a prune.
- `cleanPaint(raw)` returns `{v:1, rev:0, m:{}}` for `undefined` or junk, and never throws.
  - It keeps only keys matching `/^(floor|wall|halfwall|window|door|pillar|stairs|roof):(-?\d{1,2}),(-?\d{1,2}),([0-5]),([0-3])$/` (with `|i|,|j| <= 26`,
    as `MAX_IJ` in building-pieces.js:10) or `/^(-?\d{1,4}),(-?\d{1,4})$/`. Types are checked through a null-prototype set, so `__proto__` is dropped.
  - Values must be integers 1..5. `rev` is clamped to an integer between 0 and 1e9. The map is capped at 1000 entries (600 pieces + 400 tiles, about
    25 KB, well under `EXT_MAX`).
- `prunePaint(state, pieces, tiles)` deletes every key whose piece `{t,i,j,l,r}` is not in `pieces` or whose tile is not in `tiles`, and returns the removed count.
- Pruning runs only on the host (`ctx.role !== 'guest'`): in `load(d,'save')` and `load(d,'restore')` after the clean, and in `update()` when
  `world.pieces !== seenPieces || world.tiles !== seenTiles` (building.js:131 replaces the array on every place or remove). A prune that removes anything bumps `rev`.
- `serialize()` returns the live state object, with no copy and no allocation.
- `load(d, from)`:
  - `'net'`: if `d?.rev === netRev`, return right away (the 8x/s cheap path). Otherwise `state = cleanPaint(d)`, set `netRev = state.rev` and call
    `applyTint()`. An old host without this module sends `undefined`, which clears paint on the guest's view.
  - `'save'` and `'restore'`: clean, prune, set `netRev = -1` and call `applyTint()`. A restored own raft can share a rev number with the host's world, so these
    loads always re-tint.

## 4. Host action `{kind:'paint', k:<key>, c:0..5}` (module `action(a, actor, bag)`)
- Return false unless `a.kind === 'paint'`. Otherwise always return true, and reply with `ctx.emit({kind:'notice', text}, actor)` on refusal.
- Checks, in order: (1) the actor's bag has a `brush` ("Make a paint brush first"); (2) `k` passes the key regex and the target exists in `world.pieces` /
  `world.tiles` (silent); (3) `c` is an integer 0..5; (4) `m[k] === c`, or `c === 0` with no entry: "Already <Name>"; (5) `c > 0` and
  `bag.remove('paint_'+id, 1)` fails: "Out of <Name> paint"; (6) the entry cap is reached: "That's a lot of paint!".
- On success, set `m[k] = c` (or delete the entry when `c` is 0), bump `rev`, call `applyTint()` and emit "Painted <Name>". Like `building.apply`, no reach check.

## 5. Client: aim, click, colour cycle, prompt
- The module keeps a local, unsaved `colour` (starts at 0). `nextColour(cur, counts)` returns the next idx in 1..5 order, then 0, skipping colours whose
  `counts['paint_'+id]` is 0. Driftwood is always available, and with no pots the result stays 0. When `use()` finds that the selected colour has no pots
  left, it switches `colour` to `nextColour` and shows a notice.
- `target(aim)` runs with brush in hand and nothing else open, and is cached per frame as `{key, name}` or null.
  - Piece: `ctx.building.grid.pick(cam.x,cam.y,cam.z, aim.dir.x,aim.dir.y,aim.dir.z, ctx.deckY(), 7)` (building-pieces.js:247).
  - Tile, only if no piece was hit: `x = Math.round(aim.point.x/2)`, `z = Math.round(aim.point.z/2)`, kept if `world.tiles` has it and `aim.point` lies within
    7 of the camera.
- `use(aim, kind)`: if `kind !== 'brush'`, return false. Otherwise send `ctx.action({kind:'paint', k, c:colour})` when there is a target, or
  `ctx.notice('Point the brush at a wall, floor or deck')`, and return true.
- `alt(aim, kind)`, on right click: if `kind !== 'brush'`, return false. Otherwise cycle `colour`, show a notice with the new colour and its pot count, tint
  the brush tip and return true.
- Q is not used: it is the `drop` binding (input-map.js:53) and the hammer wheel (building.js:142). Gamepad colour cycling is out of scope.
- `prompt(aim)`, only with the brush held. Names go through `ctx.esc`, and the swatch is an inline-styled 0.8em circle with a constant hex from `PALETTE`.
  - With a target: `<kbd>Click</kbd> Paint <piece name> <span class="swatch" style="background:#hex"></span><Name> (n) · <kbd>Right click</kbd> Colour`.
  - Without one: `Brush: <Name> (n) · <kbd>Right click</kbd> Colour`.
- Preview: `update()` runs after `building.update` (game.js:1053 vs :1079), so it calls `ctx.building.preview(rec, hex)` for a piece target. The building
  ghost then shows in the swatch colour (white for Driftwood) for one frame.

## 6. Tinting
- **Pieces (dist/building.js):**
  - `createBuilding(T, scene)` gains `let tintOf = null`, plus `setTint(fn)` (stores fn and calls retint), `retint()` and `preview(p, hex)`, which runs
    `showGhost(p, tmp.set(hex))`. The shared `material.color` is never set.
  - In `rebuild()`, after each `setMatrixAt(k, ...)`, call `m.setColorAt(k, tintOf?.(p) || WHITE)` (`WHITE = new T.Color(1,1,1)`). Every new InstancedMesh
    therefore gets `instanceColor` before its first draw: no shader recompile, and the default stays white, so the base colours are kept.
  - `retint()` walks `grid.list` in the same order as rebuild, with per-type counters, rewrites only the colours and sets `instanceColor.needsUpdate = true`.
- **Piece tint maths (paint.js, once at start):** `PIECE_TINT[c] = new T.Color(hex)` divided per channel by `new T.Color('#ba8a54')` (the average plank
  colour), each channel capped at 4. Values above 1 are fine in the Float32 instanceColor, like the seafloor.js kelp trick, and beams and posts stay darker
  shades of the same colour. `tintOf(p)` returns `PIECE_TINT[m[pieceKeyOf(p)]] ?? null` and runs only in rebuild and retint.
- **Deck tiles:**
  - In deck.js:204, change the planks line to tag each plank mesh with its base colour:
    `for (const [color, list] of byColor) add(merge(T, list), mat(color), 'floor-planks').userData.color = color;`
  - game.js adds `woodMat(hex)`, which caches `createWoodMaterial(T, hex)` in `materialCache` under the key `'wood:'+hex`. It is cached forever, so
    `disposeGeometry` skips it. Expose it as `ctx.woodMat`.
  - `tintTiles()` walks `ctx.raft.children` with `userData.kind === 'floor'`, keyed by `Math.round(g.position.x/2)` and `Math.round(g.position.z/2)`.
  - For each `floor-planks` mesh, keep `userData.paintBase ??= mesh.material`, then set
    `mesh.material = c ? ctx.woodMat(mix(userData.color, PALETTE[c].hex, .8)) : userData.paintBase`. That makes at most 5 x 3 = 15 materials. Logs,
    lashings and nails keep their colours.
- `applyTint()` runs `ctx.building?.setTint(tintOf)` the first time and `retint()` after that, then `tintTiles()`. It runs only on a rev change (sections 3
  and 4) and from the new `afterRebuild()` hook, because `rebuildRaft` recreates every tile. On guests, `rebuildRaft` runs only when tiles or decor change
  (game.js:1313), and pieces re-tint themselves through `tintOf` in `rebuild()`.

## 7. Brush viewmodel and icons
- `dist/brush-model.js` exports `createBrush(T)`, procedural in the style of hammer.js:13, about 0.55 tall along +Y, with the root re-centred on its bounding
  box: a tapered wood handle (CylinderGeometry, `#b98a58`, 8 sides), a tin ferrule (`#b9c2c4`, metalness .3), a bristle block (BoxGeometry .09 x .12 x .04,
  `#e8dcc0`) and a slightly smaller tip box at its end with its OWN `MeshStandardMaterial` (`userData.tip`). `userData.grip` is a Vector3 at the handle middle.
- game.js `buildViewmodels()` (:400): `brushModel = createBrush(T); brushHands = createHands(T, holdable(brushModel, brushModel.userData.grip,
  {rx:-.25, ry:Math.PI/2, rz:.35, scale:.55}))`, and add `brushHands` to the hands loop at :412. At :965 set `brushHands.group.visible = running &&
  kind === 'brush'` and update it like `hammerHands` (`casting:swing`).
- `contentCtx` exposes `get brush()`. The module sets `brush.userData.tip.material.color` to the swatch (raw-wood `#c69860` for Driftwood) whenever `colour`
  changes.
- icons.svg, beside `icon-hammer` (:296), original art with the usual `#153e49` 2px stroke: `icon-brush` (a diagonal `#bb8650` handle, a grey band, a
  cream bristle fan) and `icon-paint-<id>` x5 (one small tin pot, cream rim ellipse and body, with a drip in that colour's hex; same paths, only the fill changes).

## 8. Engine hooks (each line marked `// content hook`)
- **content.js:**
  - Import `createPaint` from `./paint.js` and append it to `FEATURES`.
  - In `createContent()`, add `use: (aim, kind) => !!first('use', aim, kind)`, `alt: (aim, kind) => !!first('alt', aim, kind)` and
    `afterRebuild() { for (const m of mods) call(m, 'afterRebuild'); }`.
  - Document `use`, `alt`, `afterRebuild` and the new ctx members (`building`, `brush`, `woodMat`) in the header.
- **game.js:**
  - `contentCtx` (:328): add `get building() { return building; }`, `get brush() { return brushModel; }` and `woodMat: c => woodMat(c)`.
  - `useSelected` (:851), just before the cup line: `if (content?.use(aim, kind)) { swing = 1; return; }`.
  - `pointerdown` (:1120), after the hammer line:
    `if (e.button === 2 && running && !uiBlocked() && content?.alt(isLocked() ? pickCenter() : currentAim(), heldKind())) return;`
  - `rebuildRaft()` (:440), after `building?.sync(world)`: `content?.afterRebuild();`.
- **docs/features/content-hooks.md:** add rows for `use`, `alt` and `afterRebuild`.

## 9. Co-op and save compatibility
- The guest sends paint through `ctx.action`, and the host validates it and charges the guest's bag (the `bag` argument). Paint travels in `ext` (~8/s), and
  the guest re-tints only when rev changes. A guest visiting an old host gets `undefined`, sees no paint, and its clicks are ignored.
- An old save has no `ext.paint`, so it loads with no paint. An older build drops `ext` and shows raw wood. Brush or pot items in a bag make an older build
  reject that bag snapshot, the known risk for every new item (content-items.js:4).
- Removing a piece or tile drops its paint at the next host `update()` prune. A save made in between is pruned again on load.

## 10. Debug (`raftDebug.content.paint`)
- `state()` returns a copy of `{v, rev, m}`. `colour` is a getter, with `setColour(i)` to change it. `tint(key)` returns the applied hex or null, and
  `materials()` returns the woodMat cache size.
- `grant()`, host only and for QA: adds 1 brush and 4 of each pot to the local bag. `paint(key, c)` runs the host action as the local actor and returns a boolean.
- `demo()`, host only: sets `world.pieces` to walls on the 4 edges of tile 0,0, 4 pillars, one floor at l=1 and one roof, then calls `ctx.building.sync(world)`.
  It paints those and a row of tiles through colours 1..5, and returns the keys.
- `dropPiece(key)`, host only: removes that record from `world.pieces` as a new array and calls `ctx.building.sync(world)`, to exercise the prune.

## 11. Tests: tests/paint.test.mjs (node --test, import dist/paint.js, no DOM)
- **Key building:** `pieceKeyOf({t:'wall',i:1,j:0,l:0,r:1}) === 'wall:1,0,0,1'` and `tileKeyOf(-2,3) === '-2,3'`. The regexes accept and reject edge cases:
  `foundation:`, `i=27`, `l=6`, a float and `__proto__`.
- **cleanPaint:** `undefined`, `null`, an array or a string give the defaults with a null-prototype map; bad values (0, 6, 1.5, '2') and the 1001st entry
  are dropped; a negative or float `rev` is clamped; clean(clean(x)) deep-equals clean(x).
- **prunePaint:** removes a stale wall and a stale tile and keeps live ones; a door at a former wall slot does not inherit; it returns the count.
- **action** (fake ctx + Bag): charges 1 pot; refuses without a brush or with no pot; Driftwood is free and deletes the entry; a same-colour repaint
  charges nothing; rev bumps only on a change; a guest actor's bag is the one charged.
- **nextColour:** skips empty colours, wraps through 0, and stays 0 with no pots.
- **load:** `'net'` with the same rev does not call `applyTint` (spy on a fake building); a new rev re-tints; `'save'` prunes.
- **Recipes:** every pot recipe exists with count 4; the brush has `maxStack 1` and `tool false`; every icon id is present in icons.svg (read the file text).

## 12. QA screenshot plan
- Copy the scratchpad shoot.py to a new probe script. Start solo, then call `raftDebug.content.paint.grant()`, then `.demo()`. Use `swimAt` or a camera pose
  4 m off the raft looking at tile 0,0, and wait 2 frames.
- Shots: (1) noon, painted pieces and a row of tinted deck planks; (2) the same view at dusk (set the time through the day/night debug) for readability;
  (3) first person with the brush held, tip in Coral; (4) the prompt with the swatch, aimed at a wall; (5) the ghost preview in Lagoon.
- Assert in the report: `renderInfo.calls` within +2 of the same scene before `demo()` paints; `programs` unchanged after painting; `materials() <= 15`;
  after `dropPiece` on one painted wall and one host frame, `state().m` no longer has that key.
- Tune a hex or the mix factor only if the noon shot looks muddy, and record the change in this spec.

## 13. Build notes (deviations found while building)
- **`ctx.aim()`**: `update()` has no aim argument, so `contentCtx` also exposes `aim: () => frameAim` for the per-frame target and ghost preview.
- **Tint cap 8, not 4**: Lagoon's blue needs about 7.5x the plank average in linear light; at 4 it rendered teal. `TINT_CAP = 8` in paint.js.
- **Cap before charge**: check (6) "That's a lot of paint!" runs before the pot is removed, so a refused paint never eats a pot.
- **Texts**: a Driftwood success says "Scraped back to raw wood"; the Driftwood count shows as "free".
- **Visible prompt**: prompts.css hides `#contextPrompt`, so `prompt(aim)` (with the swatch) is never seen. The module also registers
  `raftPrompts.provide({id:'paint'})`: "LMB Paint wall · Coral (3)" + "RMB Colour". The swatch circle only lives in the hidden HTML.
- **Icons**: survival-ui.js only draws sprite ids in its `SPRITES` set, so `brush` and `paint-<id>` were added there. Pot icons got a wide
  label band in the paint colour (the drip alone was too small to tell colours apart in the hotbar).
- **Brush pose**: `{rx:-.25, ry:.35, rz:.35, scale:.6}` shows the flat bristle face; the tip box is .094 x .05 x .044 over the bristle end.
- **use() when out of the colour**: it switches to `nextColour` with a notice and does not paint on that click.
- **retint()** rebuilds instead when the grid version is newer than the instance buffers.
- **Research test**: tests/storage-research.test.mjs now expects `brush` in the wood + rope unlocks.
- **QA (headless, swiftshader)**: same scene painted vs scraped back: calls 602/602 (and 556/556 in a second run), programs 19/19 (20/20);
  `materials()` 14; `dropPiece('wall:0,1,0,0')` pruned the key on the next frame. Sunshell walls read khaki in shade; left as is.
