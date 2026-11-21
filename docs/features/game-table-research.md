# Driftwood game table: research

Goal: a craftable decor table on the deck where the two co-op players, or one player and a friendly gull, play two classic public-domain games: **draughts** (checkers) and **noughts and crosses**. Pieces sit on the table in 3D. Play happens in a 2D board dialog opened with E. Nothing is lost by losing. Every name and line of text here is original.

## What exists (checked in this tree, mid-merge, so line numbers may move a few lines)
- **Registry:** a module is appended to `FEATURES` (`dist/content.js:49`). Decor, items and recipes go in `dist/content-items.js` (`CONTENT_ITEMS` :9, `CONTENT_RECIPES` :63, `CONTENT_DECOR` / `CONTENT_BLOCK_RADIUS` :105-106). Craft-book text goes next to `kiln:` (`dist/craft-book.js:116`). The icon goes in `dist/icons.svg` plus `SPRITES` (`dist/survival-ui.js:22`).
- **The station to copy is `dist/kiln.js`:**
  - `target(aim)` (:27-47): the nearest decor of the type within `REACH` 3.2 m whose centre is within 0.85 m of the aim ray. It falls back to the camera forward direction.
  - `prompt` keeps a cache (:116-133). `interact` sends `ctx.action` (:135-143). The host-only `action` validates through the core and answers with `ctx.emit(..., actor)` (:145-151).
  - `serialize` is cached on rev `r` (:50-54). `load('net')` returns early when `r` is unchanged (:55-64). Once a second, slices for removed decor are pruned (:102-111).
  - It rescans `ctx.raft.children` for its groups when `children.length` changes (:67-89), because `rebuildRaft()` recreates every decor group.
  - Range checks use `posOf(actor)`: `ctx.other` for the guest, `ctx.physics` for the host (:21).
- **Dialog to copy is `dist/trader-ui.js`:**
  - Styling: a `<dialog>` wood frame (`#b48d55 → #8a663a` with a `#3e2a17` border), an inner panel `#3a2716eb`, text `#fff2cc` (:9-45).
  - Lifecycle: `showModal`. E or Tab closes it, and keydown calls `stopPropagation` (:128). On close it calls `api.requestLock()` (:118-122). `dispose` aborts the listeners without asking for the pointer lock back (:141).
  - The trader module lazy-imports the UI, calls `ctx.releaseLock()` first, and re-checks `ctx.uiOpen()` before opening (`trader.js:200-208`). It also closes the dialog when the player walks out of reach (`trader.js:130-134`).
  - `uiBlocked()` already counts any open `dialog` (`game.js:332-333`), so movement and clicks pause on their own. `logbook-ui.js` and `storage-research-ui.js` (`body.lr-sr-open`) follow the same pattern.
- **Engine order for E:** `content.interact(currentAim())` runs before `prog.interact` and the inventory (`game.js:1136`). Left click on deck goes to the held tool first: the hook charges and the hammer builds (`game.js:1144-1172`). `content.use` only gets kinds that nothing else handles. The contentCtx is at `game.js:397-410` and has **no achievement hook**.
- **Achievements** are a fixed list in `dist/logbook.js:27-38` (15 entries). `evaluate()` is at :72-101, and the host-only `award(ev)` is at `game.js:947`. Tests pin the count to 15 (`tests/logbook.test.mjs:22,24`), and so does `totals:{notes:12, achievements:15}` (`game.js:1932`).
- **Not in this tree:** the map table and crew tasks. `grep -rln "crew task|mapTable" dist` finds nothing, and the brief's raft-master list is ahead of this checkout. Treat them as conditional (see Achievements).

## Games (rules in our own words; v1 scope is exact)
**Draughts "Shells & Pebbles"**
- **Board:** 8×8. Only the 32 dark squares are used. Each side starts with 12 pieces on its first three rows. Shells (light) always move first.
- **Moving:** a plain piece steps one square diagonally *forward* onto an empty square.
- **Capturing:** a plain piece captures by jumping diagonally *forward* over an adjacent enemy piece onto an empty square just beyond it. The jumped piece is removed.
- **Forced capture: YES.** If any capture exists for your side, you must make one. You may pick *which* capture; the longest one is not required.
- **Multi-jump: YES.** After a capture, if the same piece can capture again, it must keep jumping with that piece. The turn stays with you, and `j` holds the jumping piece.
- **Kings: YES.**
  - A piece that reaches the far row is crowned. Crowning ends the turn, even mid-jump.
  - A king steps or jumps one square diagonally in **any** of the four directions. There are no long-range "flying" kings.
- **Win:** the other side has no pieces left, or no legal move on its turn.
- **Draw ("Calm seas"):** 40 plies in a row with no capture and no crowning. Either player can also offer a draw, and the other accepts it in the dialog. Against the gull, the gull always accepts.
- **Resign:** either player can resign ("Shake hands") at any time.

**Noughts and crosses "Knots & Hoops"**: a 3×3 grid. Players take turns placing a mark. Three marks in a row, column or diagonal wins. A full grid is a draw. The first move alternates between rounds at the same table.

**Not in v1:** a dice-free race game. It needs its own rules, art and AI for little gain. If players ask for more, "Four in a Row" (a 7×6 board where pieces drop to the lowest free cell) reuses the same state and UI shape.

## Seating, turns and the gull AI
- **Start:** open the dialog and pick a game and an opponent: **Crewmate** (enabled only when `ctx.role` is not solo and the other player is connected), **Gull, Easy** (the default) or **Gull, Clever**. The player who starts a game takes side 0 (Shells or Knots, moves first). The opponent takes side 1. Seats are stored as `['host'|'guest', 'host'|'guest'|'ai']`. In the next round at the same table, the sides swap.
- **Turns:** the host accepts `game.move` only from the actor seated on the side to move.
- **Spectating:** anyone else who opens the dialog sees the board read-only and can press "Rematch" after a game ends. If a seated guest disconnects, the game stays saved, and the host may "Take the seat" or reset the table.
- **Gull AI** is pure and lives in the core. It runs on the host in `update()` after a 0.7-1.2 s "thinking" delay, with no allocations while it waits.
  - **Draughts:** the gull tries every legal move, including whole jump chains, and scores each one:
    - +10 for each piece it captures.
    - +6 for crowning.
    - −8 if the opponent can capture right after (a 2-ply check).
    - +1 for moving toward the centre or forward.

    Clever plays the best move and breaks ties at random. Easy plays a random legal move 35% of the time.
  - **Noughts and crosses:** win if it can, else block, else centre, else a corner, else any free cell. Easy plays a random cell 35% of the time, so it can be beaten. Clever never loses, which is fine for this game.

## Interaction model (recommendation: 2D dialog primary, 3D for show)
- **E on the aimed table** opens the board dialog `#lrGame`, using the trader-ui lifecycle and wood styling:
  - **Board:** a CSS grid of `<button>` squares with `aria-label`s ("c3, your shell").
  - **Moving:** click your piece, then a highlighted target. Arrow keys plus Enter work too, and so does touch.
  - **Status line:** "Your turn", "Crewmate's turn" or "Gull is thinking…". It also shows the win count and Rematch / Resign / Draw buttons.
  - **Closing:** Esc or E closes the dialog. It also closes when you walk more than 3.2 m away.
- **The prompt** reads `E Play at the game table · your turn` and caches per `r` the way the kiln does.
- **Why not click squares in 3D:**
  - Left click already belongs to the held tool: the hook charges and the hammer builds (`game.js:1144-1172`).
  - Squares on an about 0.8 m top are about 10 cm wide, so first-person aim is fiddly.
  - It would need a ray pick every frame, and it would not work for touch or keyboard users.
- **What 3D still does:** the pieces mirror the synced state, so the other player sees the game from across the deck. The last move slides over 0.25 s, and a captured piece sinks into the table.

## State shape (`world.ext.gametable`, in `dist/gametable-core.js`; pure, node:test)
`{v:1, r, t:{"x,z": {g:'d'|'n', b, p, s:[a0,a1], j, w, q, n, last:[from,to], round}}, wins:{host, guest, ai}}`
- **`b` (board string):** draughts uses 32 chars (`.` empty, `a`/`A` shell or shell king, `b`/`B` pebble or pebble king). Noughts and crosses uses 9 chars (`.`, `x`, `o`).
- **Other fields:**
  - `p`: the side to move (0 or 1).
  - `j`: the square of the piece in the middle of a jump, or −1.
  - `w`: −1 while playing, 0 or 1 for the winner, 2 for a draw.
  - `q`: the quiet-ply counter.
  - `n`: the move counter. Actions carry `n`, so a stale guest click is ignored.
- **`cleanSlice(data, decorAt)`** does this:
  - Drops entries whose key is not a `gametable` decor.
  - Drops boards with the wrong length or characters, and seats that are not one of the three values.
  - Clamps the numbers. An unknown `v` becomes empty.
  - An old save gets `load(undefined)` and starts with no games.
- **Core exports:** `newGame`, `legalMoves(state)` (forced capture applied), `applyMove`, `outcome`, `gullMove(state, rnd, clever)`, `applyGameAction(st, a, actor, env)`, `cleanSlice`.
- **Tests** (`tests/gametable.test.mjs`):
  - Draughts: forced capture filters out plain steps; a double jump keeps the turn; crowning ends a jump; a king captures backward; no moves means a loss; the 40-ply draw.
  - Noughts and crosses: all 8 lines win; the gull takes a win before a block and blocks a fork-free threat.
  - Actions: a wrong actor, a stale `n` and an out-of-reach player are refused.
  - `cleanSlice` handles garbage.

## Co-op sync and save
- **Host-authoritative.** The actions are `game.start {x,z,g,vs}`, `game.move {x,z,from,to,n}`, `game.resign`, `game.draw`, `game.rematch` and `game.seat`. Each is checked for reach (3.2 m from `posOf(actor)`), turn and seat. The host emits `notice`/`build` events to the actor and a `loot` event to all when a game is won ("Pebbles win! Good game").
- **What guests do:** guests only call `ctx.action`. Their selected square is local UI state; the board never changes until the host state arrives. State arrives through `hostState.ext` at about 8 Hz, and `load('net')` returns early when `r` is unchanged.
- **Size:** `serialize()` returns a cached object rebuilt only when `r` changes. A 100-table cap keeps it far under `EXT_MAX` (`content.js:50`).
- **Save:** games in progress, seats and wins are saved through `world.ext`. A gull game continues after a reload.

## Model and draw calls (`dist/gametable-model.js`)
- **Table:** a driftwood top on four legs, plus a board inlay of 64 vertex-coloured squares (light driftwood and dark tar-stained wood) and a 3×3 rope grid on the other half of the top or on the flip side. It is one merged geometry (`mergeParts` like `kiln-model.js:6-22`): **1 draw** per table.
- **Pieces:** each table group holds 4 `InstancedMesh`es: shells (capacity 24; a king is a second stacked instance), pebbles (24), knots (5) and hoops (5). Hidden meshes use `count = 0` or `visible = false`, so a draughts table costs 3 draws and an empty table costs 1. Geometry and materials are built once and shared, and `instance()` returns a new group.
- **Updates:** matrices are rewritten only when `r` or `shown` changes, using one scratch `Matrix4`, with no per-frame allocations except the 0.25 s slide of the last moved piece.
- **Placement:** the tabletop is at about 0.8 m and faces the decor `rot`. The block radius is 0.45. The table uses placement rotation (`d.rot`), so the sides face along its local ±z.

## Item, recipe and achievement
- **Item and recipe:** `gametable` ("Driftwood Game Table", `{wood: 6, rope: 1, stone: 2}`, where the stone becomes the pebbles), icon `gametable`. Add a craft-book line ("A low table with a board inlay." / "Press E to play draughts or noughts and crosses.").
- **Achievement "Good Game"** (first win against a crewmate or the gull; a draw does not count). This needs two edits outside the registry:
  - In `logbook.js`, add `a('game1','Good Game','Win a game at the Driftwood Game Table.','compass')` and `case 'game1': return ev.kind === 'gamewin';`.
  - In `contentCtx` (`game.js:403`), add a tiny anchored line: `award: ev => award(ev)`.
  - Then bump 15 to 16 in `tests/logbook.test.mjs:22,24` and `game.js:1932`.

  The module calls `ctx.award?.({kind:'gamewin'})` on the host. If crew tasks merge later, also mark a "Play a game together" task there through whatever hook that lane exposes, guarded with `?.`.
- **Debug (`raftDebug.content.gametable`):** `spawn(x, z)`, `start(x, z, g, vs)`, `move(x, z, from, to)`, `gull(x, z)` (forces the AI move now), `setBoard(x, z, b, p)`, `state()`.
