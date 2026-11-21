# Buoy Ring Course (time trials): spec v1

Source: docs/features/buoy-course-research.md. One builder. You swim (or paddle) through floating rings around the raft against the clock. You can't fail, take damage or lose anything. A stopped run just says "Run stopped". Content module name **`buoycourse`**.

## Files
- `dist/buoycourse-core.js`: pure, no THREE/DOM, side-effect free. All maths and validation.
- `dist/buoycourse.js`: `export function createBuoyCourse(ctx)`, the content module (`name:'buoycourse'`).
- `dist/buoycourse-model.js`: `export function buildCourseModels(T)` for the flag, scoreboard, rings and canvas textures.
- `tests/buoycourse.test.mjs`: node:test, imports only the core.
- Small edits: `dist/content.js`, `dist/content-items.js`, `dist/craft-book.js`, `dist/icons.svg`, `dist/survival-ui.js` and one line in `dist/game.js`.

## Ids (none may collide with paddleboard `driftboard`/`paddleboard.*`/`icon-driftboard` or gametable `gametable`/`gt.*`)
- Items: `courseflag` "Start Flag" (icon `icon-buoyflag`, `item('courseflag','Start Flag','icon-buoyflag',false)`) and `scoreboard` "Race Scoreboard" (icon `icon-scoreboard`, `false`).
- Recipes in CONTENT_RECIPES (glasscups style):
  `coursekit: Object.freeze({ id:'coursekit', name:'Course Kit', output:Object.freeze({kind:'courseflag',count:1}), cost:Object.freeze({plastic:4, rope:3, wood:3}) })`
  and `scoreboard: recipe('scoreboard','Race Scoreboard',1,{wood:3, scrap:1})`. Neither is gated (no craftLocked).
- Decor: append `'courseflag','scoreboard'` to CONTENT_DECOR. CONTENT_BLOCK_RADIUS: `courseflag: .15, scoreboard: .3`.
- craft-book.js (next to `goggles:`):
  `courseflag: { desc:'A start flag with a little course board.', use:'Place it, pick a course on the board, press E on the pole to race.' }`,
  `scoreboard: { desc:'A painted board for race times.', use:'Shows the best three times for the chosen course.' }`.
- Action kinds: `buoy.shape`, `buoy.finish`. Effect kind: `buoy`. Save key: `world.ext.buoycourse`. DOM: `#buoyTimer`, `<style id="buoyStyle">`.
- Icons (original art, 48x48 viewBox like neighbours): `icon-buoyflag` is a pole with a triangular pennant and a ring at its foot.
  `icon-scoreboard` is a board on two legs with three lines. Add `'buoyflag','scoreboard'` to `SPRITES` in survival-ui.js.
- content.js: `import { createBuoyCourse } from './buoycourse.js?build=v3-survival-ae77fa84ac2b';`, inserted in FEATURES
  **before `createCookpot`** (cookpot stays last). If paddleboard is already in FEATURES, put it after paddleboard.

## The one game.js edit (contentCtx)
Anchor: the line ending `get vitals() { return vitals; }, // [vitals] damage the LOCAL player; vitals is read-only for modules`.
Insert this single line directly after it, before the closing `};` of `contentCtx`:
```js
    note: (i, n, s) => note(i, n, s), get content() { return content; }, // [buoycourse] bell chime + registry view (board mode)
```
`note` is game.js:283's `sfx.note` wrapper and `content` is the registry (`let ... content = null`, game.js:257). The module must work
without this line: `ctx.note?.('bells', k, .8) || ctx.emit?.({kind:'buoy', sound:'ui'}, 'host')`. Mode then falls back to `'swim'`. (Locally, `emit(e,'host')` plays `effect()` only and sends nothing.)

## Pure core API (`dist/buoycourse-core.js`)
```
export const SHAPES = ['loop','sprint','zigzag','eight'];   NAMES = {loop:'Loop', sprint:'Sprint', zigzag:'Zigzag', eight:'Figure 8'}
export const MODES = ['swim','board'];   export const RING = {R:1.5, HIT:1.6, YLO:-1.6, YHI:1.4, YHI_BOARD:2.0, TELEPORT:3, CLEAR:5, FAR:20, LIM:40, MAXG:10, TOP:5}
export const MAX_MS = 600000, MIN_SPEED = 9;           // m/s ceiling for validation (fastest legit ~6 m/s; 1.5x margin)
bbox(tiles) -> {x0,x1,z0,z1} | null                    // metres; tile [tx,tz] covers tx*2±1, tz*2±1
clearOf(b, x, z) -> number                             // distance from point to bbox rectangle, 0 inside
nearestTile(tiles, x, z) -> number                     // distance to the nearest tile square
makeCourse(shape, tiles, flag:[fx,fz]) -> [[x,z,yaw],...] | null   // null if unknown shape, no tiles, or any gate fails bounds
crossGate(p0, p1, g, waterY, hi=RING.YHI) -> boolean                // p = {x,y,z} (eye), g = [x,z,yaw]
pathLength(gates, fx, fz) -> metres                    // flag (fx*2,fz*2) -> g0 -> g1 ... -> last
minMs(gates, fx, fz) -> Math.floor(pathLength / MIN_SPEED * 1000)
addBest(list, name, ms) -> {list, rank, best}          // new array, asc by ms, one row per name (keeps faster), TOP rows; rank 0-based or -1
cleanName(s, fallback) -> 1..16 chars, control chars stripped, trimmed, else fallback
cleanCourse(v) -> slice                                // never throws; see Save
fmt(ms) -> 'm:ss.t' (e.g. 41300 -> '0:41.3')
gateHash(g) -> int                                     // sum over gates of (i+1)*(round(x*10)*31 + round(z*10)*17 + round(yaw*100)), |0
validFinish(st, a) -> boolean                          // the buoy.finish predicate below
```
**Gate frame.** For a gate `[x,z,yaw]`, the normal is `n = (sin yaw, cos yaw)` (the travel direction) and the tangent is `t = (n.z, -n.x)`. Round x and z to 0.1 and yaw to 0.01.

**crossGate.** Return false if any value is not finite or the horizontal distance `|p1-p0| > TELEPORT`. Let `d0=(p0-c)·n` and `d1=(p1-c)·n`. A hit
needs `d0 < 0 && d1 >= 0`. Then `s=d0/(d0-d1)` and `q=lerp(p0,p1,s)`. Require `|(q-c)·t| <= HIT` and `waterY+YLO <= q.y <= waterY+hi`. The caller passes `hi = RING.YHI_BOARD` (2.0) when `ctx.physics.mount === 'driftboard'`, so the rider's eye (≈ waterY+1.72 plus swell lag, ≥ 1.9 per paddleboard.md) registers; otherwise 1.4 (swim/shallow dive). The deck is solid, so walkers never reach these gates.

**makeCourse.** Let `b = bbox(tiles)`, centre `(cx,cz)`, half sizes `hx,hz`. The flag side is the bbox side nearest the flag tile
centre. Its outward unit axis is `d` (±x or ±z), the along axis is `a = (d.z, -d.x)`, and `e` is that side's coordinate (e.g. `x1` for +x).
Every candidate gate is pushed radially away from `(cx,cz)` in 0.5 m steps (≤ 40 steps) until `clearOf ≥ CLEAR`. The course is
**rejected (null)** if any gate has `nearestTile > FAR`, `|x|` or `|z| > LIM`, or there are more than MAXG gates. The yaw of each gate is `atan2(dx, dz)` of the path tangent at that gate.
- `loop`: 6 gates on the ellipse `(cx + (hx+6) sinθ, cz + (hz+6) cosθ)`, θ = i·60°, counter-clockwise tangent `(cosθ·(hx+6), -sinθ·(hz+6))`. Then **gate 0 repeated** as the finish (7 entries).
- `sprint`: in the (d,a) frame measured from side `e`, with the along offset centred on the flag: out (5,-2.5), (10,-2.5), turn (16,0) facing +a, back (10,2.5), (5,2.5) facing -d. That is 5 gates, and the last one is the finish beside the flag.
- `zigzag`: 6 gates at along `-L/2 + k·L/5` (L = max(12, side length + 4)) and out `5` / `11` alternating, all facing +a.
- `eight`: a lemniscate centred at out 10 on the flag side: `(along, out) = (9 sinθ, 10 + 4.5 sinθ cosθ)` for θ = (i+.5)·45°, i=0..7. The tangent is `(9cosθ, 4.5cos2θ)`. Then gate 0 repeated (9 entries). The crossover is never a gate.

## Save slice `world.ext.buoycourse` (host-authoritative)
`{v:1, shape:'loop', f:[fx,fz]|null, g:[[x,z,yaw],...], best:{'loop:swim':[[name,ms],...], ...}, r:0}`
- `f` is the tile of the flag that owns the course: the **first** `courseflag` in `world.decor`. Extra flags are plain decor and their
  prompt is muted: "Another Start Flag runs the course". `g` is generated by the host only on `buoy.shape`, or when `f` no longer
  matches the first flag (moved, removed, or new). Adding tiles later never shifts a stored course. `r` increments on every change to `g`, `shape` or `best`.
- **cleanCourse:** a non-object gives defaults (`shape:'loop', f:null, g:[], best:{}, r:0`). An unknown shape becomes `'loop'`. `f` must be two
  integers in ±64, otherwise null. `g` must hold ≤ MAXG triples of finite numbers, clamped to ±LIM with yaw wrapped to ±π; on a bad row,
  `g=[]` (the host regenerates). `best` keeps only keys `${shape}:${mode}` from SHAPES×MODES, rows `[cleanName, int ms in 1..MAX_MS]`, sorted, unique names, at most TOP. `r` is a non-negative int, else 0.
- `load(data, from)`: `'net'` returns early if `data?.r === st.r && data?.f` equals the current `f`. Otherwise `st = cleanCourse(data)`, mark the textures
  dirty and rebuild the ring matrices. `serialize()` returns `st` (no copy; only the host mutates it). An old save gives `load(undefined)`: no course until a flag exists.

## Host actions (`action(a, actor, bag)`, return true only for `buoy.*`)
- `buoy.shape {shape}`: shape must be in SHAPES and a flag must exist. `g = makeCourse(shape, tiles, f)`. If that is null, emit to the actor
  `{kind:'buoy', text:'The raft is too big for ' + NAMES[shape], sound:'deny'}` and keep the old course. Else set shape/g, `r++`, and
  emit to all `{kind:'buoy', text:'Course: ' + NAMES[shape], sound:'ui'}`.
- `buoy.finish {shape, mode, ms, name, gk}`: reject silently unless `validFinish(st, a)`: `shape === st.shape`, `gk === st.shape + ':' + gateHash(st.g)`,
  mode in MODES, `ms` an int with `minMs(g,f) <= ms <= MAX_MS`, `g.length > 0`. Name = `cleanName(a.name, actor === 'host' ? 'Sailor' : 'Crewmate')`. Run `addBest`,
  store it, `r++` (no regenerate), then `ctx.emit({kind:'buoy', sound:'catch', text:\`${name} finished ${NAMES[shape]}${mode==='board'?' by board':''} in ${fmt(ms).replace(/^0:/,'')} s${best?' · new best!':''}\`}, 'all')`.
  `best` means rank 0 of that list. Also call `ctx.award?.({kind:'race'}, actor)` guarded (for crew tasks/logbook if they ever expose it).
- Guests never touch `st`. Both host and guest finish through `ctx.action(...)` (on the host, `action()` applies it locally).

## Local run state (per player, never synced)
`run = {phase:'idle'|'count'|'go', t:0, next:0, gk:'', shape, mode:'swim', deck:0, cd:0}`, plus `prev={x,y,z,ok:false}` and `showT` (look timer).
- **Start (E on the pole):** UI closed, `st.g.length > 0`, and the local player is within reach. Refused with a gentle `ctx.notice` if:
  `sail.raised && !sail.anchored` gives "Lower the sail or drop anchor to race", and `moving()` gives "Wait for the raft to slow down".
  E on the pole during count/go **stops** the run ("Run stopped").
- **Countdown:** `cd = 3`. The pill shows big "3", "2", "1" with `ctx.emit({kind:'buoy', sound:'ui'}, 'host')` on each tick, then "Go!",
  and the phase becomes `'go'` with `t = 0`, `next = 0`, `gk = st.shape + ':' + gateHash(st.g)`, `shape = st.shape`.
- **Timer:** in `update(dt)`, `t += dt` while phase is go (game dt is capped, so a stall can't add much). Stored ms = `Math.round(t*1000)`.
- **Detection** happens in `afterMove(physics, dt)` while phase is go: `p1 = physics`. If `prev.ok && crossGate(prev, p1, st.g[next], ctx.ocean.getHeight(g.x, g.z), ridingBoard() ? RING.YHI_BOARD : RING.YHI)`,
  then `ctx.note?.('bells', Math.min(next, 7), .8)`. If `ridingBoard()` is true, `run.mode = 'board'` (sticky). Then `next++`. When `next === g.length`, finish: send
  `ctx.action({kind:'buoy.finish', shape, mode, ms, name:readName(), gk})` and go idle. Copy p1 into `prev` with no allocation.
  Only `g[next]` is tested. A missed gate stays lit, so you can't skip ahead.
- **readName():** `try { (localStorage.getItem('little-raft-name')||'').trim().slice(0,16) } catch { '' }` (same source as coop.js:34). An empty name falls back on the host.
- **Stop conditions** (a quiet `ctx.notice('Run stopped')` plus 'ui', then idle): E on the pole again, `moving()` true, `t > 600`, the current gk (cached in load) `!== run.gk` (course or shape changed), the flag is gone,
  `ctx.physics.grounded && !swimming` on a deck tile for > 2 s after `next > 0`, or 90 s on deck without ever leaving after GO.
  We use gk, not `r`, because `r` also bumps when someone's finish is stored, and that must not stop the other player's run.
- **moving():** `const s = ctx.world?.sailing; return !!s && !s.anchored && Math.hypot(+s.vx||0, +s.vz||0) > 0.15;`.
  `world.sailing` holds the water-relative raft velocity (sailing-core.js: `vx/vz`, which includes engine push). It is synced to guests in hostState, so both
  sides read the same thing. While anchored, the water drifts at the current (0.3 m/s), which is fine for racing.
- **ridingBoard()** (board mode, defensive, no throw). The primary signal is docs/specs/paddleboard.md ("Buoy course" bullet): the board sets `ctx.physics.mount === 'driftboard'` while the local player rides. The fallback is the paddleboard module's own `riding()` through the registry view:
  ```js
  try { if (ctx.physics?.mount === 'driftboard') return true; const mods = ctx.content?.mods; if (!Array.isArray(mods)) return false;
    for (let i = 0; i < mods.length; i++) { const m = mods[i]; if (m?.name === 'paddleboard' && !m.dead) return typeof m.riding === 'function' && !!m.riding(); } } catch {} return false;
  ```
  Match by module name, never the registry-wide `riding()`, because zipline also answers it. ride() writes `physics.x/y/z` (eye at about waterY+1.72) before afterMove, so detection needs nothing else. With neither signal, the mode is always `'swim'`.

## Visibility, models and draw calls (`buoycourse-model.js`)
- `buildCourseModels(T)` returns `{ flag(), scoreboard(), rings, boardTex, scoreTex, paintBoard(info), paintScore(rows), dispose() }`.
- **Flag**: one merged vertex-colour geometry (merge-geo.js) for the pole (1.8 m), a ring buoy at the foot and the board frame. Add one
  CanvasTexture plane (256x128) on the board front for the shape name and your best, and one pennant mesh. Nothing else.
  **Scoreboard**: merged legs/frame plus one CanvasTexture plane (256x256) showing the shape name, "Swim" top 3 and "Board" top 3.
- **Textures**: `boardTex` and `scoreTex` are singletons shared by every instance (like signs' `texts` cache in decor-pack.js). Their `dispose`, and
  their materials' `dispose`, are set to a noop so rebuildRaft can't free them. Repaint the canvas and set `needsUpdate = true` only when `st.r` or the board
  content key changes, checked in update at most 2x/s. `dispose()` calls the real `Texture.prototype.dispose` / `Material.prototype.dispose`, as decor-pack.js `freeText` does.
- **Rings: ≤ 3 draw calls**, built once in `create()` and added to `ctx.scene` with `frustumCulled = false`:
  1. `InstancedMesh(TorusGeometry(1.5, .1, 8, 24), MeshLambertMaterial)` with capacity MAXG and `instanceColor`. The next gate is warm orange `#ff9a3c`,
     pending gates are white `#f4efe4`, cleared gates are faint `#7fa6b0` (local `next`), and the finish gate is gold `#ffd04a`.
  2. `InstancedMesh` of small float spheres or cylinders, 2 per gate (capacity 2·MAXG), red/white.
  3. One `Mesh` beam over the next gate: a thin open cylinder, additive, opacity .25, height 6.
  `count = g.length` (a repeated finish gate draws twice in the same place. That's fine, or skip a duplicate of gate 0 until it is the next one.)
- **Per frame while visible:** for each gate, `y = ocean.getHeight(x, z) + .3`. Tilt comes from one shared `ocean.getSlope` out object × .5, via a reused
  Object3D/Euler, then `setMatrixAt`. Set `needsUpdate` only while visible. No allocations.
- **Visible** when the flag exists, `g.length`, and `!moving()`, and (phase ≠ idle, or `showT > 0`). `showT = 20` is set whenever the board prompt is shown or the shape changes. While hidden, all 3 meshes have `visible = false`.

## Interaction and prompts
- Flag world position: `X = fx*2`, `Z = fz*2`, `Y = ctx.deckY()`. The aim targets are pole `(X-.25, Y+1.1, Z)` and board `(X+.3, Y+.85, Z)`.
  A target counts if `ctx.aim()` exists, the distance from the camera is ≤ 3 m, and the ray passes within .45 m. The closer one along the ray wins. No rotation in v1.
- Prompts: pole idle `<kbd>E</kbd>Start the ${NAME} race`, pole running `<kbd>E</kbd>Stop the run`, board
  `<kbd>E</kbd>Next course · ${NAME}` (cycles SHAPES and sends `buoy.shape`). Scoreboard: a muted `Best ${NAME}: ${fmt} · ${name}`.
  No course: board only. Cache the prompt strings and rebuild them only when the shape, best or phase changes.
- `interact(aim)` returns true for pole or board hits only.

## HUD pill `#buoyTimer`
Build it lazily like cookpot.js `ensureChip`: fixed, `top:48px`, centred under `#signalReadout`, pointer-events none, the same rounded dark pill style.
While go it shows `Ring ${next}/${g.length} · ${fmt(ms)} · best ${fmt}` (best = your row in `${shape}:${mode}`, else the list top, else omitted).
During the countdown it shows a big font (class `big`). It is hidden when idle (after a 3 s "Finished 0:41.3" tail). Write `textContent` only when the tenth of a second changes.

## Debug (`raftDebug.content.buoycourse`)
`place(x,z)` (host: push `{type:'courseflag',x,z}` onto world.decor + rebuildRaft), `shape(name)` (sends buoy.shape), `gates()` (copy of g),
`start()` (skips the countdown: phase go now), `teleportThrough(i, addS=8)` (adds addS s to t, then runs the detection step with
`p0 = c - 1·n`, `p1 = c + 1·n` at waterY, so the next gate must be `i`; returns true if hit), `finish(ms, name, mode='swim')` (sends buoy.finish
with the current gk), `stop()`, `state()` → `{phase, next, t, mode, visible, shape, gk, best, moving}`.
Example QA: `place`, `shape('sprint')`, `start()`, `teleportThrough(0..4)` → a finish notice and a board/score repaint.

## Tests (`tests/buoycourse.test.mjs`)
1. crossGate: a straight swim through the centre hits. The reverse direction misses. Parallel misses. Lateral 1.55 hits, 1.7 misses.
2. crossGate: an eye 1.7 under the water misses, an eye at +1.6 misses with the default hi and hits with YHI_BOARD; +1.9 hits and +2.1 misses with YHI_BOARD. A >3 m jump (teleport) misses. NaN misses. A start exactly on the plane (d0=0) misses, and ending on the plane hits.
3. makeCourse, for each shape on a 1-tile, 3x3, 6x2 and L-shaped raft: the right count (7/5/6/9), every gate `nearestTile ≥ 4` and `≤ 20`, |x|,|z| ≤ 40, deterministic.
4. makeCourse: a huge raft (40x40 tiles) gives null for every shape, unknown shape or empty tiles give null, and with the flag on an edge tile, the sprint finish is ≤ 7 m from it.
5. Gate yaw follows the path: a swimmer stepping gate→gate along the polyline hits every gate in order.
6. addBest: sorted, top 5, one row per name (a slower retry doesn't replace, a faster one does), rank/best flags, input not mutated.
7. minMs/pathLength: a known square path. `buoy.finish` below minMs is rejected and one at minMs is accepted (test the core predicate `validFinish(st, a)`, exported).
8. cleanCourse: undefined, an array, a bad shape, NaN gates, > MAXG gates, a long name with control chars, bad modes/keys, negative or huge ms, unsorted duplicates. Round trip is stable.
9. gateHash changes when a gate moves 0.1 m and stays the same on a best-only change. fmt: 0 → '0:00.0', 61234 → '1:01.2'.

## Checks for the builder
`npm test`, then shoot2.py with `errors: []`, then coop2.mjs (no new failures beyond tests 3 and 6). In co-op, the guest finish shows up on both screens and on the scoreboard.
Old saves load. Draw calls with rings visible go up by ≤ 3, plus flag/scoreboard meshes.

## Implementation notes
- **Frame for sprint/zigzag/eight.** A frame point `(out, along)` maps to `S + d·out + a·along`, where `S` is the point on the flag side's line
  whose along coordinate `p·a` is 0. Sprint centres `along` on the flag's own along coordinate; zigzag and the figure 8 centre it on the bbox
  centre (the spec only pins sprint to the flag). Ties between equally near sides resolve in the order +x, −x, +z, −z.
- **Test 5** starts the swimmer 2 m behind gate 0 instead of at the flag: the lead-in from the flag to gate 0 is free swimming (the zigzag's
  first gate faces +a, away from a straight line out of the flag). Each leg is stepped in ≤ 0.5 m moves, under the 3 m teleport skip.
- **Duplicate finish gate** (loop, figure 8): drawn once. Gate 0 is orange while it is next (at the start and again as the final gate) and
  gold (finish) in between; the beam follows.
- **Rings vs ring count:** the beam is a thin (r 0.22 m) additive cylinder: a 1.2 m one washed the sky out white on screen.
- **Prompts.** The board prompt names the shape E will switch to (`Next course · Zigzag` while Sprint is set); the board face and the pole
  prompt show the current one. The scoreboard prompt shows the top swim row (else board) or "No Sprint times yet". Extra flags answer E with
  the muted line as a notice. Models set `userData.ownRot` so a rotated placement still faces +z (aim targets assume it).
- **Flag sync** runs on the host every 0.05 s of game time (a scan of `world.decor`), not every frame. If the flag exists but `g` is empty
  (bad saved gates, or the raft was too big), the host retries once per tile-count/shape change.
- **craft-book CATEGORY_OF**: `courseflag`/`scoreboard` are filed under Building (not in the spec; without it they already fell back there).
- **Timer and slow machines.** The run clock is the real time between `afterMove` calls (capped .25 s per frame, the same cap
  as game.js `splitSteps`), i.e. the time base the player physics integrates, not the capped content `dt` (.05 s). Frames with no
  player move (not running) reset the clock, so a pause never counts. The deck timers use the same step. `MIN_SPEED` is 9 m/s (not 6)
  so a buffed fast dive (~6 m/s) plus current drift, a countdown head start and gate-edge corner cuts stays well above `minMs`.
- `debug.placeScore(x,z)` and `debug.show(s)` were added for QA; `state()` also reports `f`, `r` and `riding`.
