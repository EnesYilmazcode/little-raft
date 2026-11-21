# Spec: Driftwood Game Table (draughts + noughts and crosses, Gull AI)

Source: docs/features/game-table-research.md (rules there are binding unless changed here). Cozy: losing costs nothing, no rewards beyond a win tally.
New files: `dist/gametable-core.js` (pure), `dist/gametable.js` (content module), `dist/gametable-model.js` (THREE), `dist/gametable-ui.js` (DOM),
`tests/gametable.test.mjs`. Edits (small, appended, re-read before each Edit; other builders touch the same files): dist/content.js, dist/content-items.js,
dist/craft-book.js, dist/icons.svg, dist/survival-ui.js. **No game.js edit. No logbook/achievement change** (do not touch logbook.js or its tests).
Ids owned by this feature (parallel paddleboard/buoy designers must not reuse): item/decor/recipe `gametable`, icon `icon-gametable` / sprite `gametable`,
ext key `gametable`, action prefix `gt.`, dialog `#lrGame`, CSS prefix `lr-gt-`, style id `lr-gt-style`, model group name `game_table`. Verified free (grep of dist/tests).

## 1. Item, recipe, decor, gating
- content-items.js: `gametable: item('gametable', 'Driftwood Game Table', 'icon-gametable', false),` (after the cookpot line, comment `// game table (gametable.js)`).
- `CONTENT_RECIPES`: `gametable: recipe('gametable', 'Driftwood Game Table', 1, { wood: 6, rope: 1, stone: 2 }),`
- Append `'gametable'` to `CONTENT_DECOR` and `gametable: .45` to `CONTENT_BLOCK_RADIUS`. game.js then handles placement, ghost, rotation (`d.rot`,
  applied by rebuildRaft as `rotation.y` because the instance does not set `userData.ownRot`), saving. `content.decorModel('gametable')` supplies the mesh.
- **Gating: research-gated, NOT in STARTER.** `learnedFrom` unlocks it once wood, rope and stone are seen at the Tinker's Desk. Reachability for a fresh
  player: wood (hook), rope (STARTER recipe), stone (island rocks, first island ~90 s, the same stone the kiln path already teaches). The locked craft row
  reads "Study …" via storage-research-ui annotate() with no extra work. Legacy saves recompute `ingredientKinds()` and get it. Test this (§9).
- craft-book.js, after the last round-2 entry: `gametable: { desc: 'A low driftwood table with a board inlay.', use: 'Press E to play draughts or noughts and crosses.' },`
- icons.svg: one original `<symbol id="icon-gametable" viewBox="0 0 48 48">` in house style (stroke #153e49 2px; #bb8650 table top on two legs, a 3×3
  checker patch #fff2cc/#54a6a4 on top, one #ffbd66 round piece). Append `'gametable'` to `SPRITES` in survival-ui.js (SPRITE_FOR unchanged).
- content.js: import `createGameTable` from `./gametable.js` with the same `?build=` suffix the neighbouring imports use; insert it into FEATURES right
  before `createCookpot` (cookpot stays last).

## 2. Pure core: dist/gametable-core.js (no imports, no DOM/THREE/Date/Math.random; deterministic given `rnd`)
```js
export const GT = Object.freeze({ REACH:3.2, MAX_TABLES:100, QUIET_DRAW:40, EASY_SLIP:.35, THINK_MIN:.7, THINK_MAX:1.2 });
export const keyOf = (x, z) => x + ',' + z;
export const sqRC = i => [i >> 2, 2 * (i & 3) + (1 - ((i >> 2) & 1))];   // draughts square 0..31 -> [row, col]; dark squares have (r+c) odd
export const rcSq = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 || ((r + c) & 1) === 0) ? -1 : r * 4 + (c >> 1);
export function newGame(g, seats, lv, round = 0)   // g 'd'|'n'; seats ['host'|'guest', 'host'|'guest'|'ai']; lv 0 easy / 1 clever
export function legalMoves(gm)                     // -> [{f, t, c}] (c = captured square or -1; noughts: f = -1, c = -1)
export function applyMove(gm, m)                   // -> NEW game object (input untouched); caller has checked legality
export function outcome(gm)                        // -> -1 playing | 0 | 1 winner side | 2 draw (computed, also stored as gm.w)
export function chains(gm)                         // draughts: every full turn as [hop, hop…] (DFS over jumps), for the AI
export function gullMove(gm, rnd, clever)          // -> [hop…] (draughts chain) or [{f:-1,t,c:-1}] (noughts); [] if no move
export function applyGameAction(st, a, actor, env) // -> {ok, reason?, text, win?}; mutates st only on success
export function cleanGame(raw) / cleanSlice(data, decorAt) / sliceOf(st)
```
**Game object:** `{g, b, p, s:[a0,a1], lv, j, w, q, n, last:[f,t], round}` exactly as the research: `b` 32 chars (`.` `a` `A` `b` `B`) or 9 chars (`.` `x` `o`);
side 0 = Shells `a` / Knots `x` (moves first), side 1 = Pebbles `b` / Hoops `o`. Shells start on squares 0-11 (rows 0-2) and move toward row 7;
Pebbles start on 20-31 and move toward row 0. `last` is `[-1,-1]` at start. `n` counts applied hops/placements from 0.
**Draughts rules** (research §Games): plain pieces step/jump forward only, kings one square any diagonal; forced capture (any capture, not the longest);
while `j >= 0` only captures by the piece on `j` are legal, and `p` does not change; after a jump, if that piece can jump again set `j = t`, else `j = -1`
and switch `p`. Reaching the far row crowns (`a→A` at row 7, `b→B` at row 0) and **ends the turn even mid-chain**. `q` resets to 0 on any capture
or crowning, else `q++` per completed turn; `q >= 40` → draw. After switching `p`, if the side to move has no pieces or no legal move, the mover wins.
**Noughts:** place on an empty cell; 8 lines (3 rows, 3 cols, 2 diagonals) → mover wins; full board with no line → draw. `applyMove` always sets
`last = [m.f, m.t]`, `n++`, and `w = outcome(next)`.
**Gull AI** (`rnd` returns [0,1); tests pass a fixed sequence):
- Draughts: score each chain from `chains(gm)`: `+10` per capture, `+6` if it crowns, `−8` if after the chain the opponent has any capture,
  `+1` if the end square is in cols 2-5 or advances the piece. Clever: max score, ties → `list[floor(rnd()*k)]` over tied chains in generation order.
  Easy: with `rnd() < EASY_SLIP` a uniformly random chain, else the Clever choice (consume rnd in that fixed order so seeds are reproducible).
- Noughts: Clever = full minimax (score win +10−depth, loss −10+depth), ties broken by `rnd` → never loses. Easy: take a winning cell if one exists,
  else with `rnd() < EASY_SLIP` a random empty cell, else block a threat, else centre, else a random free corner, else first free cell.
**applyGameAction(st, a, actor, env)**, `env = {decorAt(x,z), pos(actor), crew()}` (`crew()` true when the other human is connected). Checks in order,
returning `{ok:false, reason, text}` and changing nothing: `bad` (kind not in GT actions, x/z not integers within ±25, actor not 'host'|'guest')
→ `missing` (`decorAt(x,z) !== 'gametable'`) → `reach` (`hypot(p.x - 2x, p.z - 2z) > REACH`, or no pos) → `stale` (a game exists and `a.n !== gm.n`;
`gt.start` on an empty table ignores n) → per action:
- `gt.start {x,z,g,vs,n}` (`g` 'd'|'n', `vs` 'crew'|'easy'|'clever'): `busy` unless there is no game, the game is over (`w !== -1`), the actor is seated,
  or a seated human other than the actor is disconnected (`!crew()`, "take the seat"). `vs:'crew'` needs `crew()` else `nocrew`. Seats
  `[actor, vs==='crew' ? other(actor) : 'ai']`, `lv = vs==='clever' ? 1 : 0`, `round = 0`. Cap: a new key beyond MAX_TABLES → `full`.
- `gt.move {x,z,f,t,n}`: `over` if `w !== -1`; `turn` if `gm.s[gm.p] !== actor`; `illegal` unless some `legalMoves` entry has the same f and t (that
  entry, with its c, is applied).
- `gt.resign {x,z,n}`: `over` if finished; `seat` unless the actor is seated. Sets `w` to the other side,
  `n++`, `last` unchanged.
- `gt.rematch {x,z,n}`: `playing` while `w === -1`. Anyone in reach. `newGame(g, [s[1], s[0]], lv, round + 1)` (sides swap, so first move alternates).
Every success does `st.r++`, and when the result ends a game with `w` 0/1 bumps `st.wins[gm.s[w]]` (draws count nothing) and returns `win:{side, who}`.
TEXT (original): `busy` 'A game is under way here', `nocrew` 'Your crewmate is not aboard', `turn` 'Not your turn yet', `illegal` 'That piece can\'t go there',
`over` 'This game is over: press Rematch', `seat` 'You are watching this game', `playing` 'Finish or resign this game first', `stale` 'The board just changed',
`reach` 'Step a little closer to the table', `missing` 'That spot has no game table', `full` 'Too many game tables', `bad` 'That move made no sense'.
**cleanSlice(data, decorAt):** non-object or `v !== 1` → `{v:1, r:0, t:{}, wins:{host:0, guest:0, ai:0}}`. Keys `/^(-?\d{1,2}),(-?\d{1,2})$/` with |x|,|z| ≤ 25,
max 100, `decorAt` (optional) drops non-tables. `cleanGame`: `g` in d/n; `b` exact length and charset (draughts also ≤ 12 per colour); `s` two valid seat
values, `s[0] !== 'ai'`; `lv` 0/1; `p` 0/1; `j` −1 or a square holding a piece of side `p` (else −1); `w` −1..2; `q` 0..40; `n`, `round` integers
0..1e6; `last` two ints in −1..31; `w` recomputed with `outcome` when −1 (a corrupt finished board ends cleanly). Bad game → dropped. `r`, wins:
integers ≥ 0, else 0. Never throws. `sliceOf` = JSON-safe deep copy.

## 3. Module: dist/gametable.js, `createGameTable(ctx)`, name `'gametable'`
State `st = cleanSlice(undefined)`. `decorAt`, `posOf` (guest → `ctx.other`, host → `ctx.physics`) and `target(aim)` copied from kiln.js with type
`'gametable'`, REACH 3.2, ray offset ≤ .85, centre y raft + .8. `env.crew = () => ctx.role === 'host' && !!ctx.other`. Local actor id `me = ctx.role === 'guest' ? 'guest' : 'host'` (solo acts as host).
- **serialize()** cached on (st, st.r). **load(data, from):** `'net'`: early return when `data?.r === netR`, else `st = cleanSlice(data)` (no decor pruning;
  decor may arrive later), `netR = data?.r ?? -2`, `dirty = true`. Save/restore: `st = cleanSlice(data, decorAt)`, `netR = -1`. Also resets AI timers and local UI selection.
- **action(a, actor):** false unless `a.kind` starts with `'gt.'`; guest returns true without acting. Run applyGameAction; success → `ctx.emit({kind:'build',
  text})` to actor (start 'Shells & Pebbles: Shells to move' / 'Knots & Hoops: Knots to move'; moves emit nothing); refusal → `{kind:'notice'}` to actor
  except `stale` (silent). A finished game emits `{kind:'loot', text}` to 'all': '<Winner> win! Good game' with winner 'Shells'/'Pebbles'/'Knots'/'Hoops',
  or 'Calm seas: a draw'.
- **update(dt)**, allocation-free in the steady state. Host: once a second prune keys whose decor is gone (`st.r++` if any). AI: scan `for..in st.t`
  for the first game with `w === -1 && s[p] === 'ai'`; if its key/n differs from `aiKey/aiN`, set them and `aiWait = THINK_MIN + rnd*(THINK_MAX-THINK_MIN)`;
  count down; at 0 call `gullMove(gm, Math.random, lv === 1)` and apply every hop in order through `applyMove` (stop early if a hop is not legal), set
  `last = [first.f, final.t]`, emit the result like a human move, `st.r++` once. Then visuals (§5), then UI: `ui?.tick()`; if the UI is open and the
  local player is beyond REACH + .3 of its table or the table is gone, `ui.close()`.
- **prompt(aim):** `<kbd>E</kbd>` + 'Play at the game table' + ' · ' + status (`your turn` / `crewmate's turn` / `gull is thinking` / `game over` /
  `pick a game`), escaped, cached by (key, st.r, st).
- **interact(aim):** no target → false. Else open the UI for that key (`openUI(key)`), return true. Guests open it too (UI is local, actions go via `ctx.action`).
- **openUI** = the trader pattern: `disposed`/`uiFailed` guards, `ctx.releaseLock()` first, lazy `import('./gametable-ui.js')` once, and after load re-check
  `!disposed && !ctx.uiOpen() && inReach(key)` before `open(key)`.
- **UI api:** `{ esc, game:() => st.t[uiKey] ?? null, rev:() => st.r, me:() => me, crewOn:() => ctx.role !== 'solo' && !!ctx.other, legal:gm => legalMoves(gm),
  wins:() => st.wins, running:() => !!ctx.running, requestLock:() => ctx.requestLock?.(), send:a => ctx.action({...a, x, z, n:game?.n ?? 0}) }`.
- **debug** (`raftDebug.content.gametable`; mutators host-only, return false for a guest): `spawn(x=0,z=0)` (decor on a free existing tile + rebuildRaft),
  `start(x,z,g='d',vs='easy')`, `move(x,z,f,t)` (as host actor; bypasses reach only), `gull(x,z)` (AI moves now), `setBoard(x,z,b,p=0)` (cleanGame-validated,
  `w` recomputed), `state()` (JSON copy + `aiKey`, `aiWait`, `uiOpen`), `clear()`. **dispose():** `disposed = true`, `ui?.dispose()`, `model?.dispose()`.

## 4. Dialog: dist/gametable-ui.js, `createGameTableUI(api)` (copy trader-ui.js lifecycle and wood styling)
- One `<dialog id="lrGame" class="lr-gt">`, style tag `lr-gt-style`; trader frame colours (`#b48d55→#8a663a`, border `#3e2a17`, panel `#3a2716eb`,
  text `#fff2cc`). Removes any stale `#lrGame` on create. **All dynamic text goes through `textContent` or `api.esc`** (seat names, notices).
- Layout: head (icon-gametable, title 'Driftwood Game Table', `aria-live="polite"` status line, ✕); **setup panel** (shown when no game or `w !== -1`):
  two game toggle buttons 'Shells & Pebbles' / 'Knots & Hoops' (aria-pressed), opponent buttons 'Crewmate' (disabled unless `crewOn()`), 'Gull · Easy'
  (default), 'Gull · Clever', and Start (`send({kind:'gt.start', g, vs})`); **board**; **footer**: tally 'You 2 · Crewmate 1 · Gull 3' (own seat first),
  'Shake hands' (resign; only when seated and playing), 'Rematch' (only when over), hint '<kbd>E</kbd> or <kbd>Esc</kbd> to close'.
- **Board:** built once per game type: draughts = 64 `<button>`s in an 8×8 CSS grid (light squares `aria-disabled="true"`, inert to clicks), noughts =
  9 buttons. Oriented so the viewer's side is at the bottom (flip when the viewer holds side 1; spectators see side 0 at the bottom). Square size
  `min(48px, calc((100vw - 72px) / 8))`; noughts cells `min(96px, calc((100vw - 72px) / 3))`; `touch-action:manipulation`. Pieces are CSS circles
  (shell #fff2cc, pebble #5d6a70, king gets a gold ring); X/O as glyphs. `aria-label` like 'c3, your shell king' / 'b2, empty' / 'centre, hoop'.
- **Moves:** local `sel` (−1). Click/Enter on own piece when it is your turn → `sel` and highlight the `to` squares of `api.legal(gm)` from it (forced
  captures make other pieces unselectable; while `j >= 0` sel is locked to `j`). Click a highlighted target → `send({kind:'gt.move', f:sel, t})`, keep
  `sel` (the host state decides; on a new `n` with `j >= 0`, `sel = j`, else −1). Noughts: click an empty cell → `send({kind:'gt.move', f:-1, t})`. Never
  change the shown board locally. Last move squares get a soft outline.
- **Keyboard:** roving tabindex over board cells; arrows move the cursor one cell (clamped, in screen orientation), Enter/Space activate; Tab moves
  between controls normally. keydown: `stopPropagation()` always; `KeyE` (non-repeat) closes; `cancel` (Esc) → preventDefault + close; wheel stops
  propagation. So no key reaches the game while open.
- **Focus:** on open focus the cursor cell (own piece that can move, else first cell) or Start when setup is shown; after any button click focus stays in the
  dialog (blur the button, focus the wrap if the button disappeared). On close (not dispose) `if (api.running()) api.requestLock()`.
- **tick():** compares numbers only (`rev`, `gm?.n`, `sel`, `cursor`, `crewOn`, `me`) and repaints on change (class toggles/textContent on the persistent
  buttons). Status: 'Your turn' / 'Keep jumping!' (j ≥ 0) / 'Crewmate's turn' / 'Gull is thinking…' / 'Shells win!' etc / 'Calm seas: a draw' / 'Watching'.
- **Phone (`max-width:560px`):** width `calc(100vw - 32px)`, footer wraps, hint hidden, buttons ≥ 40px tall. `prefers-reduced-motion` disables transitions.
- Returns `{open(key), close(), tick(), isOpen(), dispose()}`; `dispose` aborts listeners (AbortController), closes and removes without requestLock.

## 5. Model: dist/gametable-model.js, `buildGameTable(T)` → `{instance(), place(group, gm, slide), dispose()}`
- Table: one merged vertex-coloured geometry (`mergeParts` as kiln-model.js): driftwood top .9×.06×.9 at y .78 (#a98457), 4 legs .06×.76, board inlay
  of 64 squares .08 m (#d8bf94 / #4a3423) raised 2 mm. A rope 3×3 grid (4 thin boxes, #d9c08a) is a second shared mesh `gtGrid`, visible only for noughts.
  Origin at tile-top centre; side 0 sits at local +z (row 0 nearest +z): square (r,c) at `x = (c-3.5)*.08, z = (3.5-r)*.08`; noughts cell k at
  `x = ((k%3)-1)*.2, z = (1-floor(k/3))*.2` (row 0 nearest +z).
- Pieces: per instance 4 `InstancedMesh`es sharing geometry/material: shells (cylinder r .03 h .015, #f3e6cc, capacity 24, a king is a second stacked
  instance), pebbles (#59656b, 24), knots (cross of two boxes, #c58a4a, 5), hoops (torus r .06, #54a6a4, 5). `count = 0` hides a set; empty table =
  1 draw, draughts = 3, noughts = 4. Only the table casts shadows.
- `instance()` returns a Group named `'game_table'` with `userData.gt = {shell, pebble, knot, hoop, grid}`. `place` writes matrices with one module-scratch
  `Matrix4`/`Vector3`, sets counts, `instanceMatrix.needsUpdate = true`.
- Module visuals: rescan `ctx.raft.children` for `game_table` groups when `dirty` or `children.length` changes (preallocated ≤ 100 arrays, key from
  round(pos/2)); re-place a group only when `st.r` changed or after a rescan. The last moved piece (`last[1]`) slides from `last[0]` over .25 s when
  `n` changed since the last placement on that group (one matrix write per frame while sliding; nothing else per frame).

## 6. Co-op and saves
Host-authoritative: guests only call `ctx.action`; reach, seat, turn and `n` are checked on the host; the AI runs only on the host. A guest's selection is
local UI state. `world.ext.gametable` saves games, seats and wins; a gull game resumes after reload; old saves get `load(undefined)`; guests of an
older host receive no slice (`netR = -2` path → empty). A guest leaving mid-game leaves the game saved; the host can 'take the seat' via Start.
Size: 100 tables × ~120 chars ≪ EXT_MAX.

## 7. Tests: tests/gametable.test.mjs (node:test; RAFT_DIST base like kiln.test.mjs)
1. Recipe/item/decor present; `gametable` not in STARTER; `learnedFrom(['wood','rope','stone'])` includes it; empty state `researchableKinds` includes stone.
2. Index helpers: `sqRC`/`rcSq` round-trip all 32; light squares → −1. `newGame('d')` has 12 a, 12 b, p 0, n 0; `newGame('n')` 9 dots.
3. Draughts: opening has 7 legal steps; a capture available filters out all steps; plain pieces cannot move/capture backward; a king captures backward;
   double jump keeps `p` and sets `j`, and only that piece may move; crowning mid-chain ends the turn; no pieces / blocked side loses; 40 quiet turns draw;
   applyMove leaves its input untouched.
4. Noughts: each of the 8 lines wins; full board draw; move on a taken cell is illegal.
5. AI: deterministic for a fixed rnd sequence; Clever takes the capture worth most and avoids a square that hangs a piece; Easy slip path picks
   from the full list; noughts Clever wins before blocking, blocks a threat, and never loses across all replies (exhaustive play vs every human line);
   gullMove returns [] when no move.
6. Actions: wrong actor (`turn`), spectator resign (`seat`), stale `n`, out of reach, missing table, `nocrew`, `busy`, `over`, rematch swaps seats and
   alternates first mover, wins tally (draw adds nothing), every success bumps r, refusals change nothing (deep-equal before/after).
7. cleanSlice: garbage, wrong `v`, bad keys, wrong board lengths/chars, bad seats, too many pieces, `j` without a piece, NaN numbers; cap 100; decorAt prunes; JSON round-trip.
8. Module with a fake ctx (T present): guest `action` returns true without mutating; `load(d,'net')` with the same r is a no-op; host AI moves after
   `update(1.3)` and not after `update(.5)`; prune after a decor removal; `decorModel('gametable')` is a `game_table` group with 4 InstancedMeshes;
   `decorModel('crate')` null; prompt escapes and caches.
9. Static: survival-ui SPRITES has 'gametable'; icons.svg has `id="icon-gametable"`; content.js FEATURES includes createGameTable; gametable-ui.js
   contains `stopPropagation` and `requestLock`. Then run `npm test`, shoot2.py (errors []), coop2.mjs (only known failures 3 and 6).

## Implementation notes
Built as specified; deviations and small additions:
- **Seats after a gull rematch.** `gt.rematch` swaps seats, so a gull game's next round has `s = ['ai', 'host']` (the gull moves first, as the research asks). `cleanGame` therefore accepts `s[0] === 'ai'` and instead requires two different seat values (never `['ai','ai']` or the same human twice). Otherwise a saved rematch game against the gull would be dropped on reload.
- **Actions on an empty table.** `gt.move`, `gt.resign` and `gt.rematch` on a table with no game return `bad` (the spec names no reason for this case).
- **Outcome order (draughts).** "The side to move has no pieces or no move → the mover wins" is checked before the 40-turn quiet draw.
- **Extra core exports:** `KINDS`, `TEXT`, `SIDE_NAMES`, `GAME_NAMES`, `startText(g)`, `resultText(gm)` and `tally(st, gm)` (the module uses `tally` for the gull's moves). `applyGameAction` also returns `over` (the new `w`). The noughts minimax keeps a module-level memo keyed by board string. This is still pure and deterministic, and it makes the exhaustive "never loses" test fast.
- **Success texts.** Resign emits 'You shook hands: good game' (build) to the actor. Rematch emits the start text ('Knots & Hoops: Knots to move'). A finished game (move, resign or gull move) emits the loot line to all.
- **Model slide.** A sliding king moves its two stacked instances, so it costs 2 matrix writes per frame. A noughts placement drops in from 8 cm above instead of sliding.
- **Dialog.** The setup panel is also shown during play when a seated human other than the viewer is not connected, so the host can "take the seat" through Start. The status reads 'Your crewmate left: start a new game'. Noughts cells flip for a side-1 viewer just like the draughts board. Their labels use the screen position ('top left', 'centre'…). X and O are drawn in CSS, not as font glyphs. The UI also has `reset()`, which `load()` calls.
- **Debug extras:** `open(x, z)` and `close()`, used for QA and co-op tests.
- `ITEM_SOURCE` needed no entry: the table is crafted, so `sourceOf` describes its recipe. `tests/survival.test.mjs` does not hard-code the sprite or tab lists.
