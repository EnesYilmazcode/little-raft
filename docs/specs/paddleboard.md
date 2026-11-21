# Driftboard (paddleboard): spec

Owner: one builder. Research: [docs/features/paddleboard-research.md](../features/paddleboard-research.md). Anchors below are quoted text, because line numbers move (a merge may still be in progress in game.js, content.js, content-items.js, craft-book.js and icons.svg).
Cozy: no damage, the board is never lost; host-authoritative except the ride pose (owned by the rider).

## Files
- `dist/paddleboard-core.js`: pure and side-effect free (no THREE, no DOM). `tests/paddleboard.test.mjs` tests it.
- `dist/paddleboard.js`: `export function createPaddleboard(ctx)`, a content module with name `'paddleboard'` and slice `world.ext.paddleboard`.
- `dist/paddleboard-model.js`: `createDriftboard(T, ropeMat?)` returns a Group with at most 3 draw calls.
- Small appends to `content.js`, `content-items.js`, `craft-book.js`, `icons.svg` and `survival-ui.js`, plus two lines in `game.js`.

## Item, recipe and reachability
- `content-items.js` CONTENT_ITEMS, appended at the end of the object: `driftboard: Object.freeze({ kind: 'driftboard', name: 'Driftboard', icon: 'icon-driftboard', maxStack: 1, tool: false, placeholder: false }),`
  The id `driftboard` is free (no matches in dist/ or tests/). It is not in CONTENT_DECOR or CONTENT_BLOCK_RADIUS, and it is not a TOOL_KIND.
- CONTENT_RECIPES: `driftboard: recipe('driftboard', 'Driftboard', 1, { wood: 6, plastic: 3, rope: 2 }),`
- Research gating: storage-research `learnedFrom` teaches the recipe once wood, plastic and rope are all `seen` at the Tinker's Desk (a starter item).
  All three are base materials and ingredients of existing recipes. `driftboard` is not in items.js PROG_ITEMS, so `setOwnedElsewhere` ignores it.
  Old progressed saves get it on load through `learnedFrom` (storage-research `load()`), so there is nothing extra to add.
- `craft-book.js`: in CATEGORY_OF next to `brush: 'tools'`, add `driftboard: 'tools'`. In ITEM_TEXT, after the `cushion:` line, add
  `driftboard: { desc: 'A plank board on two plastic floats, with a paddle.', use: 'Click the water by the raft to launch it, E to climb on.' },`
- Icon: add `<symbol id="icon-driftboard" viewBox="0 0 48 48">` to icons.svg, using the same stroke style as `icon-fins`: a long diagonal
  board in wood tones, two teal floats and a thin paddle. Append `'driftboard'` to the `SPRITES` Set in survival-ui.js. No SPRITE_FOR entry.

## Save slice and validation
`world.ext.paddleboard = { v:1, n, boards:[{ id, x, z, h, s, r }] }`, where `id` is an int ≥ 1, `n` is the next id, `s` is `'tied'|'adrift'`,
`r` is `null|'host'|'guest'`, and x/z are raft-local metres.
`cleanSlice(v, from)` returns a fresh object every time. Non-objects become `{v:1,n:1,boards:[]}`. It keeps at most `MAX_BOARDS = 4` boards and drops entries
that are non-objects, have non-finite x/z/h, or repeat an id. It clamps x/z to ±45, wraps h into (-π, π], and turns an unknown `s` into `'adrift'`.
`r` is kept only when `from === 'net'`. For `'save'` and `'restore'` it becomes `null`, and a ridden board becomes `'adrift'`. `n` becomes `max(n, maxId+1)`.
`load(undefined)` means no boards. `serialize()` writes the host's live board poses, reusing objects in the style of islands.js `serialize`.

## Core API (`dist/paddleboard-core.js`)
```
BOARD = { REACH:3, LAUNCH_EDGE:3, MAX_BOARDS:4, R:.45, HALF_LEN:1.1, TOP:.12, EYE:1.6, CRUISE:3.6, SPRINT:4.6, BACK:1,
          SCULL:.8, TURN:1.6, STROKE:.55, STROKE_FAST:.42, DRAG:.9, SLIP:4, TETHER_SOFT:38, TETHER_HARD:45, TETHER_PUSH:2,
          HOME:.4, AUTO_TIE:1.5, STEP_OFF:1.2 }
wrapAngle(a), angDiff(a, b)
cleanSlice(v, from)
nearestTile(tiles, x, z, out) -> out {d, tx, tz, px, pz}   // d = distance from (x,z) to the closest tile square (2 m tiles, centre t*2), 0 inside; Infinity if no tiles
pushOut(tiles, b, out) -> bool          // circles at the rider and at nose/tail (±HALF_LEN along b.h, r R) pushed out of tile squares,
                                        // the same math as PlayerPhysics._pushOutOfTiles; out {x,z,nx,nz}; the caller removes the into-hull velocity
tieSpot(tiles, x, z, boards, skipId, out) -> bool   // nearest outer tile edge (no neighbour tile on that side): point = edge midpoint + normal*(R+.05),
                                        // h parallel to the edge; it tries the next edge when another tied board is within 1.2 m
deckSpot(tiles, x, z, out) -> bool      // standing spot inside the nearest tile edge, inset .45, clamped to the tile like _beginClimb
canLaunch(tiles, px, pz, x, z) -> ''|reason   // the point is not on a tile, is ≤ LAUNCH_EDGE from a tile, and is ≤ 4 m from the player
stepRide(st, inp, dt) -> st             // st {x,z,h,v,lat,ph,side}; inp {forward,strafe,sprint,yaw}; no allocation; substeps ≤ .05; dt clamped ≤ .25
tether(d) -> m/s toward home            // 0 below TETHER_SOFT, ramps (smoothstep) to TETHER_PUSH at TETHER_HARD
homeStep(b, tiles, dt, boards) -> 'tied'|'adrift'   // adrift drift toward tieSpot at HOME m/s; within AUTO_TIE of the hull it snaps to tied
```
Stroke model (`stepRide`). While `forward !== 0`, phase `ph` advances by `dt/STROKE` (or `STROKE_FAST` when sprinting) and wraps, and `side` flips on each wrap.
Forward thrust is `k*sin(π*ph)`, with `k` chosen so that a steady W cruises at CRUISE (SPRINT with Shift). Apply `v *= exp(-DRAG*dt)`.
S brakes and then reverses to at most `-BACK`. Heading eases toward `inp.yaw` at TURN rad/s, but only while |v| > .3 or forward ≠ 0.
On a heading change, the old forward velocity partly becomes `lat`, which decays by `exp(-SLIP*dt)`. A/D scull sets lateral toward `strafe*SCULL`.
Idle with no input, the board coasts to rest. Constants are exported so tests and tuning share them.

## Content module (`dist/paddleboard.js`)
Local ride state `R = {on, id, phys, st, hold, lp, prevJump}`, with every object allocated once. Actions use the prefix `'paddleboard.'`,
and the host handles them in `action(a, actor, bag)` (guests call `ctx.action(a)`). The actor position is `actor === 'guest' ? ctx.other : ctx.physics`,
with 1 m slack for the guest, as in islands `GUEST_SLACK`.
- **Launch**: `use(aim, kind)` handles `kind === 'driftboard'`. If riding, it shows the notice "You're already on a board" and returns true.
  Otherwise it checks `canLaunch` with `aim.point`, then sends `{kind:'paddleboard.launch', x, z}`. The host re-checks canLaunch, requires
  `boards.length < 4` ("The sea is crowded with boards") and `bag.count('driftboard') ≥ 1`, then calls `bag.remove('driftboard',1)` and pushes
  `{id:n++, s:'tied', r:null}` at `tieSpot(x,z)`. It emits `{kind:'notice', sound:'splash'}`.
- **Prompt** (`prompt(aim)`): it takes a ray from `ctx.camera.position` along `aim.dir` and tests it against each board's capsule (±HALF_LEN, r .5 at the deck top), reach ≤ REACH + .5.
  A free board shows `<kbd>E</kbd>Board the Driftboard`. A tied board seen from the deck shows `<kbd>E</kbd>Board the Driftboard · hold E to pick up`.
  A board someone is riding shows nothing. While riding, the prompt with no aim target is the muted hint `Paddle W · E Step aboard / Hop off`.
  When the player is near the hull (≤ STEP_OFF), the hint reads `<kbd>E</kbd>Step onto the raft`.
- **Mount, tap and hold**: `interact(aim)` on a board under the aim, with the player grounded or swimming, not diving, the UI closed and not riding,
  sets `R.hold = {id, t:0}` and returns true. Every frame `ride()` runs (it always runs, see the game.js hook). While `inp.interact` is held,
  `hold.t += dt`. If it reaches 0.8 s on a tied board and the player is on deck, the module sends `paddleboard.stow {id}`. The host checks reach
  and checks the board is not ridden. If `bag.add('driftboard',1) !== 0` it rolls back and shows "Your bag is full". Otherwise it removes the board.
  If E is released before 0.8 s, the module sends `paddleboard.ride {id}`. The host requires the board to be free and the actor not to be riding another board,
  then sets `r = actor`. The host starts the ride right away. A guest starts when the slice shows `r === 'guest'`. Guests do not predict.
  After 2 s with no confirmation the guest drops the request with the notice "Someone is already on it".
- **Ride start (local)**: set `R.phys = ctx.physics` and `R.st` from the board, with `v` = the player's horizontal speed projected onto h.
  Set `R.lp = getHeight` and `R.prevJump = inp.jump`. Set `physics.mount = 'driftboard'` (a duck-typed flag that other modules can read).
- **ride(dt, physics, inp)**: return false fast when not riding (after hold tracking). If `physics !== R.phys`, the player respawned or was restored,
  swimAt ran, or similar: end the ride silently, leaving the board adrift at its last pose. If the UI is open, zero the input.
  On a Space press edge (`inp.jump && !R.prevJump`), end the ride in mode `swim`. Otherwise run `stepRide`, apply `tether(nearestTile.d)` pushing home
  (show the notice "The current tugs you back toward the raft" once per 6 s), clamp at TETHER_HARD, run `pushOut` and remove the velocity
  into the hull. Then write `physics.x/z` = board, `physics.y` = eye (see Camera), `physics.vx/vz` = board velocity, `vy = 0`, `grounded = false`,
  `swimming = false`, and `climbing = false` if present. Play a local stroke sound on each stroke wrap with `ctx.emit({kind:'notice', sound:'swim'}, 'host')`
  (on both roles this calls effect() locally and sends nothing). Return true, which skips PlayerPhysics.
- **E while riding**: `interact` returns true. If `nearestTile.d ≤ STEP_OFF` the mode is `deck`, otherwise `swim`.
  Pick-up and sailing E targets still take E first, because game.js checks them before content.
- **End ride `leave(mode)`**: send `{kind:'paddleboard.leave', id, x, z, h, mode}`. The host requires `r === actor`, cleans x/z/h finite and ≤ 45,
  sets `r = null`, uses `s = 'tied'` at tieSpot for mode `deck` and `'adrift'` for the other modes. Local physics by mode:
  `deck` uses `deckSpot`: `x/z` = spot, `y = ctx.deckY() + 1.6`, `grounded = true`, `swimming = false`.
  `swim` sets `swimming = true`, `y = getHeight + .45`, and keeps vx/vz at half.
  `sand` and `snap` leave the player where the other module put them.
  In every mode, delete `physics.mount`, set `physics._prevJump = inp.jump` and `physics._jumpBuffer = 0` when those fields exist (zipline hygiene), and clear `R.on`.
- **afterMove(physics, dt)**: when riding and `physics === R.phys`, check whether `physics.grounded` turned true. Only an earlier module can have set it,
  because ride() cleared it: islands `standOnSand` or sleep's bed snap. If so, the mode is `sand` with the notice "You hop onto the sand" when the board is
  within 1.5 m of the player, else `snap`. The board stays adrift at its last pose. Otherwise copy `physics.x/z` back into `R.st`,
  because islands rock push-outs move the player, and the board follows.
- **update(dt)**: the host runs `homeStep` for adrift boards and re-ties a tied board whose tile is gone (checked every 1 s). The host copies
  `ctx.other` x/z into a board with `r === 'guest'` (heading eased toward `other.yaw` at TURN). The host's own ridden board takes R.st.
  Every client then poses all meshes: y = `ocean.getHeight + TOP`. Pitch and roll come from `ocean.sample(x,z,S,undefined,1.2)`, with along = sx·sin h + sz·cos h,
  across = sx·cos h − sz·sin h, pitch = −atan(along)·.7, roll = atan(across)·.7, eased by `min(1, dt*3)` like `updateRaft`. The board whose `r` is the peer's role
  follows `ctx.other` smoothed with `damp(…,10,dt)`. Guests ease other boards toward the slice at `min(1, dt*6)`. The local rider's board uses R.st directly.
  The paddle swings with `R.st.ph`/`side` for the local rider and with a 0.55 s clock while the peer is moving. Do not allocate per frame. Build meshes lazily per id and remove them when the board is gone.
- **load(data, from)**: `cleanSlice`. If the local ride's board vanished or `r` is no longer us (a guest on 'net'), end the ride with mode `snap`, as an adrift board.
- **Feature order**: in content.js FEATURES, insert `createPaddleboard` right before `createCookpot` (cookpot stays last). That puts it after
  createIslands and createSleep, so the sand and bed snaps happen before our afterMove. Import it as `import { createPaddleboard } from './paddleboard.js?build=v3-survival-ae77fa84ac2b'; // [paddleboard]`.

## Tools, camera and the world while riding
- Hook, fishing rod, spear, instruments, eating, binoculars and debris pickup all work, because they use the camera and handPos and need no physics changes.
  Hammer and decor placement keep game.js's own reach rules, the same as a swimmer, so there is no game.js gate. Launching a second board is refused.
- Shark: it ignores the rider (`swimming = false`). Diving: it cannot start while riding (swimming false), and the ride hook is skipped while `dive` is true.
- Sailing: the raft frame never moves. sailing-world only leashes `swimming` players beyond 10 m, so the board and rider keep pace with a sailing raft.
- Camera: game.js puts the camera at `physics.y` plus the controls bob, and adds raft roll only when grounded, so a rider gets none.
  The eye is `lerp(R.lp, h, m) + TOP + EYE`, where `h = getHeight(x,z)`, `R.lp` = h low-passed at 1.5 /s, and `m = clamp(.4 + cameraMotion*1.7, 0, 1)`.
  That gives a full gentle swell at the default 0.35 and 40% of it at 0. A stroke dip of `-.015*sin(π·ph)*cameraMotion` is added. The board mesh tilts and the camera does not roll.
- **Buoy course (parallel feature)** detects gates from `physics.x/y/z`, read after `content.afterMove`. ride() writes exactly those fields every frame
  before afterMove, so crossings register while riding. y is the EYE, at about waterY + 1.72, which is above the course's planned upper band of waterY + 1.4.
  The course must therefore raise its upper band to waterY + 1.9 when `ctx.physics.mount === 'driftboard'`. That same flag is its `board` mode signal.
  Per-frame motion is ≤ 1.2 m, under its 3 m teleport skip. (The registry `riding()` is also true while riding, but modules cannot reach the registry.)

## game.js and content.js hooks (shared with the zipline branch)
Copy these byte-identical from `origin/claude/loop-features-202611210753-zfs`, so merging zipline later conflicts at most on the one extra line.
content.js, in the registry return, right after `    prompt: aim => first('prompt', aim),`:
```js
    ride: (dt, p, inp) => !!first('ride', dt, p, inp), riding: () => !!first('riding'), // [zipline] content hook: glide line ride (game.js movePlayer)
```
game.js, right after `  const steps = {n:0, step:0}; // splitSteps fills this every frame (no allocation)`:
```js
  const rideIn = {forward:0, jump:false, crouch:false}; // [zipline] reused ride input
```
game.js movePlayer, right after the `const dive = diving?.move(` line: first our extra line, then zipline's identical line.
```js
    rideIn.strafe = side; rideIn.sprint = !!(ci ? ci.sprint : input && held('ShiftLeft', 'ShiftRight')); rideIn.yaw = yaw; rideIn.interact = !!(input && (controls ? controls.input.down('interact') : held('KeyE'))); // [paddleboard] extra ride input
    rideIn.forward = fwd; rideIn.jump = !!(ci ? ci.jump : input && held('Space')); rideIn.crouch = !!(ci ? ci.crouch : input && held('KeyC')); const ride = !dive && !!content?.ride?.(dt, physics, rideIn); // [zipline] content hook: hanging on a glide line skips PlayerPhysics
```
Then change `    if (!dive) for (let i = 0; i < steps.n; i++) {` to `    if (!dive && !ride) for (let i = 0; i < steps.n; i++) { // [zipline] && !ride`.
Do NOT add zipline's coop `riding:` field to `local()`. If zipline has landed first, add only the `[paddleboard]` line. The module's `riding()` returns `R.on`.

## Co-op
The pose protocol is unchanged. The peer's avatar stands at `other.y − 1.6`, which is the deck top, because the rider's eye is TOP+1.6 above the water.
Every client draws all boards from the slice. The board ridden by the peer follows `ctx.other` as described above. A late joiner gets the slice in hostState.
If the guest leaves or goes stale (`ctx.other` null for 3 s), the host frees `r === 'guest'` boards as adrift. Guests never mutate the slice locally.

## Model (`dist/paddleboard-model.js`)
`createDriftboard(T)` returns a Group (origin at the deck top centre, +z = nose) with three draw calls:
(1) the hull, one `mergeGeometries` mesh made of a rounded plank board 2.6×0.1×0.7 with a raised nose, two plastic float pontoons
under it and a woven pad, using vertex colours on one MeshStandardMaterial (roughness .85);
(2) the paddle, a shaft plus blade merged, in a pivot group `userData.paddle` at the rider's hand height on the right side, with `userData.setStroke(ph, side)`;
(3) the tie rope, a 2-point `T.Line` with a shared LineBasicMaterial `#e9d39a`, `userData.rope`, and `userData.setTie(x,z)` in board-local coords, visible only while tied.
Cache the geometry and materials at module scope and share them across boards. Use castShadow on the hull only.

## Debug (`raftDebug.content.paddleboard`)
`give(n=1)`, `spawn(x=0, z=-3)` (host: launch at the nearest valid water spot and return the id), `mount(id?)` (move the player next to the board and ride,
skipping reach), `setPos(x, z, h)` (while riding, set the board and physics), `leave(mode='swim')`,
`step(sec, inp={forward:1})` (fast-forward the ride through the same stepRide/tether/pushOut in .05 s steps, for slow swiftshader),
`home(sec)` (fast-forward homeStep), and `state()` returning `{riding, id, st:{x,z,h,v}, boards:[...copies]}`.

## Tests (`tests/paddleboard.test.mjs`)
1. cleanSlice: undefined/garbage, the cap of 4, duplicate ids, non-finite values dropped, clamping to ±45, h wrapped, an unknown s becomes adrift, `r` cleared for save and kept for net, `n` repaired.
2. stepRide: steady W cruises at 3.6±.2 m/s and Shift at 4.6±.2; S reverses to ≤1 m/s; heading eases toward yaw at ≤1.6 rad/s; no input coasts to rest; dt clamped (a 10 s step does not teleport).
3. tether: 0 at 37 m, rising, 2 at 45 m, and a ride never passes 45 m (< MAX_RAFT_DISTANCE 50).
4. pushOut: a board driven into a 3×3 raft ends outside every tile and slides along the side; the nose circle collides too.
5. tieSpot: the result is on an outer edge (no neighbour tile), h is parallel, and a second board picks a slot ≥ 1.2 m away. deckSpot: inside a tile, inset from the edge.
6. canLaunch: on a tile is refused, more than 3 m from the edge is refused, too far from the player is refused, and a valid water point passes.
7. homeStep: an adrift board at 20 m reaches tied within about 55 s at 0.4 m/s, and a raft with no tiles stays adrift with no NaN.
8. Guard: the driftboard recipe's cost kinds are all in `ingredientKinds()` and none of them is `driftboard`. CONTENT_ITEMS has the entry and SPRITES has 'driftboard'.
9. Registry: `createContent(ctx,[fake])` with `ride` true or false, and `riding()` reflecting it (in the style of content.test.mjs).

## Done when
`npm test` is green. shoot2.py reports `errors: []`. In a browser QA run via debug: launch, ride 20 m, step onto the deck (the board ties), hold E to pick up,
hop off at sea, and the board drifts home. A save then reload gives a tied or adrift board and the player on deck. With coop2.mjs, the peer sees the board under the rider,
and only tests 3 and 6 fail, as on the base.

## Implementation notes
Built as specified; the hook lines in content.js and game.js are byte-identical to `origin/claude/loop-features-202611210753-zfs` (plus the one `[paddleboard]` input line). Deviations and additions:
- **Heading convention.** The board nose points along `(sin h, cos h)` (a THREE `rotation.y` of h), but the game camera looks along `(-sin yaw, -cos yaw)`.
  `stepRide` therefore takes the camera yaw in `inp.yaw` and eases h toward `headingOf(yaw) = wrapAngle(yaw + π)`, so W paddles where you look.
  The host eases a guest's board toward `headingOf(other.yaw)` in the same way.
- **Feature order.** The buoy course (built in parallel) also inserted itself before cookpot. FEATURES now ends with `…, createPaddleboard, createBuoyCourse, createCookpot`.
  Paddleboard still runs after islands and sleep, cookpot is still last, and the course's afterMove runs after ours (it reads the pose we wrote). The test checks this order, not adjacency.
- **Extra core exports.** `headingOf`, `parallel` (an edge-parallel heading close to the current one), `THRUST`, `rideState()`, `rideVel(st,out)` and `rideTick(st, inp, dt, tiles, info)`.
  `rideTick` is stepRide plus tether, the hard clamp at 45 m and pushOut with the into-hull velocity removed. The module, `debug.step` and the tests all share it.
  `stepRide` also sets `st.wraps`, the number of stroke wraps this call, which drives the splash sound.
- **Extra BOARD keys.** `LAUNCH_PLAYER` (4), `CLAMP` (45), `BRAKE` (2.5 m/s², the S deceleration), `IDLE_FRICTION` (.15 m/s², so an idle board actually stops), `KEEP_LAT` (.6, the share of forward speed that becomes slip on a turn) and `TIE_GAP` (1.2).
- **pushOut.** When a circle centre is already inside a tile, pushOut leaves by the nearest side that has no neighbour tile, instead of pushing deeper into the raft.
- **Texts not given by the spec.** An empty bag on launch shows "You need a Driftboard". A stow shows "Driftboard packed away" with the collect sound. A refused guest ride sends nothing, so the guest's 2 s timeout shows "Someone is already on it".
  Opening a UI while holding E cancels the hold without boarding.
- **Guest ride go-live (host).** After the host accepts a guest's ride, it copies `ctx.other` into the board only after the guest's pose has come within .3 m of the board.
  The guest's first ride frame writes exactly that pose. Without this gate, the board was dragged to wherever the guest stood while the confirmation was in flight, and pushOut then shoved it out the far side.
  If the guest never arrives, the host frees the board after 6 s. The host draws the guest-ridden mesh from `ctx.other` only once the ride is live.
- **Model.** `setTie(x, z, y = .2)` takes an optional height, so the rope reaches the deck edge. `userData.rest()` lays the paddle flat on the deck while nobody rides.
- **Debug.** Also `meshes()`, which returns the drawn poses that co-op QA uses. `state()` also returns the last rideTick `info` `{tug, push, d}`.
- **Tests.** There is one extra test for wrapAngle/angDiff/headingOf, and the survival.test.mjs tools-tab list now includes `driftboard` after `scraper`.
